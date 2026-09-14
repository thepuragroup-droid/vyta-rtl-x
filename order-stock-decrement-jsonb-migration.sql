-- ============================================================
-- ORDER STOCK DECREMENT — read line items from orders.items JSONB
-- ============================================================
--
-- Storefront checkout (both the e-Transfer and MetaCortex crypto flows)
-- persists an order's line items as a JSONB array on `orders.items`, e.g.
--   [{ "id": "<product-uuid>", "name": "...", "price": 1, "quantity": 2 }]
-- It never writes rows into the relational `order_items` table. The prior
-- adjust_stock_for_order() read from order_items, so it was a no-op for
-- every real customer order — stock was only ever decremented when an
-- admin marked an *invoice* paid.
--
-- This redefines adjust_stock_for_order() to read products + quantities out
-- of the JSONB array, so a confirmed/paid order finally decrements
-- products.stock_quantity and records a product_history row (source
-- 'order_confirmed'). The idempotency guard (orders.stock_adjusted) and the
-- (uuid, text) signature are unchanged, so this is a drop-in replacement for
-- the version in product-history-migration.sql.

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
    -- One row per product, summing quantities across duplicate line items.
    -- Only elements whose `id` is a well-formed UUID are counted.
    SELECT
      (elem->>'id')::uuid AS pid,
      SUM(GREATEST(0, COALESCE(NULLIF(elem->>'quantity', ''), '0')::numeric))::int AS qty
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
    'Stock decremented by ' || b.qty || ' when order was confirmed',
    p_actor_email
  FROM before b;

  UPDATE orders SET stock_adjusted = true WHERE id = p_order_id;
END;
$$;
