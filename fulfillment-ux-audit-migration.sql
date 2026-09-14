-- ============================================================
-- FULFILLMENT / UX AUDIT — order integrity migration
-- ============================================================
--
-- Adds two things the storefront order path was missing:
--
--   1. orders.idempotency_key — a client-supplied key so a retried / double
--      submitted checkout (dropped response, flaky mobile network) resolves to
--      the SAME order instead of creating a duplicate. Unique, nullable so
--      legacy rows and any non-idempotent caller are unaffected.
--
--   2. restore_stock_for_order() — the missing inverse of adjust_stock_for_order().
--      Storefront orders decrement products.stock_quantity from the items JSONB
--      when confirmed; there was no path to give that stock back on cancellation,
--      so a confirm→cancel cycle leaked inventory permanently. This RPC re-reads
--      the same JSONB, increments products.stock_quantity, records a
--      product_history row (source 'order_cancelled'), and clears
--      orders.stock_adjusted so the order can be re-confirmed cleanly.
--
-- Safe to run more than once.

-- 1. Idempotency key -----------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_key_uidx
  ON orders (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 2. Stock restore -------------------------------------------------------------
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
    'Stock restored (+' || b.qty || ') when order was cancelled',
    p_actor_email
  FROM before b;

  UPDATE orders SET stock_adjusted = false WHERE id = p_order_id;
END;
$$;
