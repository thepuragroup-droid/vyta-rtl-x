-- ============================================================
-- CASE/VIAL-AWARE STOCK DECREMENT — count a case as N vials
-- ============================================================
--
-- The storefront now lets a shopper buy a product either as a single vial or
-- as a full case (box of `vials_per_box` vials). Each order line in
-- `orders.items` carries a `unit` ('vial' | 'case') and `vials_per_box`, e.g.
--   [{ "id": "<uuid>", "quantity": 2, "unit": "case",  "vials_per_box": 10 },
--    { "id": "<uuid>", "quantity": 3, "unit": "vial",  "vials_per_box": 10 }]
--
-- `products.stock_quantity` is measured in VIALS, so the demand a line places on
-- stock is:
--     quantity × (unit = 'case' ? vials_per_box : 1)
--
-- This redefines adjust_stock_for_order() and restore_stock_for_order() to use
-- that vial-equivalent quantity instead of the raw line quantity. Legacy lines
-- (written before this feature, with no `unit`) fall through to the ELSE branch
-- and decrement `quantity` vials exactly as before — so this is a safe drop-in
-- replacement for the versions in order-stock-decrement-jsonb-migration.sql and
-- fulfillment-ux-audit-migration.sql. Signatures and the idempotency guard
-- (orders.stock_adjusted) are unchanged.

CREATE OR REPLACE FUNCTION adjust_stock_for_order(
  p_order_id    uuid,
  p_actor_email text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_already boolean;
  v_items   jsonb;
BEGIN
  -- Lock the order row and short-circuit if it has already decremented.
  SELECT stock_adjusted, items INTO v_already, v_items
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_already IS DISTINCT FROM false THEN
    RETURN;  -- not found, or already adjusted
  END IF;

  -- Nothing to do if there are no line items to read.
  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' THEN
    UPDATE orders SET stock_adjusted = true WHERE id = p_order_id;
    RETURN;
  END IF;

  WITH agg AS (
    -- One row per product, summing VIAL-equivalent quantities across duplicate
    -- line items. A 'case' line counts as `vials_per_box` vials; every other
    -- line (including legacy lines with no `unit`) counts as one vial each.
    SELECT
      (elem->>'id')::uuid AS pid,
      SUM(
        GREATEST(0, COALESCE(NULLIF(elem->>'quantity', ''), '0')::numeric)
        * CASE
            WHEN elem->>'unit' = 'case'
              THEN GREATEST(1, COALESCE(NULLIF(elem->>'vials_per_box', ''), '1')::numeric)
            ELSE 1
          END
      )::int AS qty
    FROM jsonb_array_elements(v_items) AS elem
    WHERE elem->>'id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    GROUP BY elem->>'id'
  ),
  before AS (
    SELECT p.id, COALESCE(p.stock_quantity, 0) AS old_qty, agg.qty
    FROM products p
    JOIN agg ON p.id = agg.pid
    WHERE agg.qty > 0
  ),
  upd AS (
    UPDATE products p
    SET stock_quantity = GREATEST(0, b.old_qty - b.qty)
    FROM before b
    WHERE p.id = b.id
    RETURNING p.id
  )
  INSERT INTO product_history (
    product_id, change_type, field, old_value, new_value,
    source, reference_type, reference_id, note, actor_email
  )
  SELECT
    b.id, 'stock', 'stock_quantity',
    b.old_qty::text,
    GREATEST(0, b.old_qty - b.qty)::text,
    'order_confirmed', 'order', p_order_id::text,
    'Stock decremented by ' || b.qty || ' vials when order was confirmed',
    p_actor_email
  FROM before b;

  UPDATE orders SET stock_adjusted = true WHERE id = p_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION restore_stock_for_order(
  p_order_id    uuid,
  p_actor_email text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_adjusted boolean;
  v_items    jsonb;
BEGIN
  -- Lock the order and only restore if it had previously been decremented.
  SELECT stock_adjusted, items INTO v_adjusted, v_items
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_adjusted IS DISTINCT FROM true THEN
    RETURN;  -- not found, or never decremented — nothing to give back
  END IF;

  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' THEN
    UPDATE orders SET stock_adjusted = false WHERE id = p_order_id;
    RETURN;
  END IF;

  WITH agg AS (
    -- Mirror the decrement: give back VIAL-equivalent quantities so a cancelled
    -- case order restores a full box of vials, not a single vial.
    SELECT
      (elem->>'id')::uuid AS pid,
      SUM(
        GREATEST(0, COALESCE(NULLIF(elem->>'quantity', ''), '0')::numeric)
        * CASE
            WHEN elem->>'unit' = 'case'
              THEN GREATEST(1, COALESCE(NULLIF(elem->>'vials_per_box', ''), '1')::numeric)
            ELSE 1
          END
      )::int AS qty
    FROM jsonb_array_elements(v_items) AS elem
    WHERE elem->>'id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    GROUP BY elem->>'id'
  ),
  before AS (
    SELECT p.id, COALESCE(p.stock_quantity, 0) AS old_qty, agg.qty
    FROM products p
    JOIN agg ON p.id = agg.pid
    WHERE agg.qty > 0
  ),
  upd AS (
    UPDATE products p
    SET stock_quantity = b.old_qty + b.qty
    FROM before b
    WHERE p.id = b.id
    RETURNING p.id
  )
  INSERT INTO product_history (
    product_id, change_type, field, old_value, new_value,
    source, reference_type, reference_id, note, actor_email
  )
  SELECT
    b.id, 'stock', 'stock_quantity',
    b.old_qty::text,
    (b.old_qty + b.qty)::text,
    'order_cancelled', 'order', p_order_id::text,
    'Stock restored (+' || b.qty || ' vials) when order was cancelled',
    p_actor_email
  FROM before b;

  UPDATE orders SET stock_adjusted = false WHERE id = p_order_id;
END;
$$;
