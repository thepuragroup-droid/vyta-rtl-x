-- ============================================================
-- PRODUCT HISTORY
-- ============================================================
--
-- Field-level change log for products. Where audit_logs only records
-- "product.update happened", product_history records WHAT changed:
-- the field, its old value, its new value, who changed it and how
-- (manual admin edit, CSV import, or an automatic stock deduction when
-- an invoice is marked paid).
--
-- change_type buckets a row for the admin UI's tabbed history view:
--   'price'   -> price changes
--   'stock'   -> stock_quantity changes (manual + invoice-driven)
--   'general' -> everything else (name, status, description, etc.)
--
-- source explains the origin of the change:
--   'admin_edit'      -> edited in the products admin (inline or modal)
--   'csv_import'      -> bulk CSV import
--   'invoice_paid'    -> stock decremented because an invoice became paid
--   'order_confirmed' -> stock decremented for a confirmed order (reserved)
--
-- reference_type / reference_id tie an automatic change back to the row
-- that caused it (e.g. the invoice whose payment decremented stock).

CREATE TABLE IF NOT EXISTS product_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  change_type    TEXT NOT NULL CHECK (change_type IN ('price', 'stock', 'general')),
  field          TEXT NOT NULL,
  old_value      TEXT,
  new_value      TEXT,
  source         TEXT NOT NULL DEFAULT 'admin_edit',
  reference_type TEXT,
  reference_id   TEXT,
  note           TEXT,
  actor_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  actor_email    TEXT
);

CREATE INDEX IF NOT EXISTS idx_product_history_product
  ON product_history (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_history_change_type
  ON product_history (change_type);
CREATE INDEX IF NOT EXISTS idx_product_history_created_at
  ON product_history (created_at DESC);

ALTER TABLE product_history ENABLE ROW LEVEL SECURITY;

-- Service-role only, mirroring audit_logs. Reads happen through admin
-- API routes that use the service-role client.
DROP POLICY IF EXISTS "product_history_service_only" ON product_history;
CREATE POLICY "product_history_service_only" ON product_history
  FOR ALL TO public USING (false) WITH CHECK (false);

-- ------------------------------------------------------------
-- Rewire the stock-decrement RPCs to record history rows.
-- ------------------------------------------------------------
--
-- Both functions keep their existing idempotency guard (the
-- stock_adjusted flag) and gain an optional actor_email argument so the
-- calling route can attribute the deduction. Adding a parameter changes
-- the function signature, so we drop the single-arg versions first to
-- avoid leaving a stale overload behind.

DROP FUNCTION IF EXISTS adjust_stock_for_invoice(uuid);
DROP FUNCTION IF EXISTS adjust_stock_for_order(uuid);

CREATE OR REPLACE FUNCTION adjust_stock_for_invoice(
  p_invoice_id  uuid,
  p_actor_email text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_already boolean;
BEGIN
  -- Lock the invoice row and short-circuit if it has already decremented.
  SELECT stock_adjusted INTO v_already
  FROM invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF v_already IS DISTINCT FROM false THEN
    RETURN;  -- not found, or already adjusted
  END IF;

  WITH agg AS (
    SELECT product_id, SUM(qty)::int AS qty
    FROM invoice_line_items
    WHERE invoice_id = p_invoice_id
      AND product_id IS NOT NULL
    GROUP BY product_id
  ),
  before AS (
    SELECT p.id, COALESCE(p.stock_quantity, 0) AS old_qty, agg.qty
    FROM products p
    JOIN agg ON p.id = agg.product_id
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
    'invoice_paid', 'invoice', p_invoice_id::text,
    'Stock decremented by ' || b.qty || ' when invoice was marked paid',
    p_actor_email
  FROM before b;

  UPDATE invoices SET stock_adjusted = true WHERE id = p_invoice_id;
END;
$$;

CREATE OR REPLACE FUNCTION adjust_stock_for_order(
  p_order_id    uuid,
  p_actor_email text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_already boolean;
BEGIN
  SELECT stock_adjusted INTO v_already
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_already IS DISTINCT FROM false THEN
    RETURN;  -- not found, or already adjusted
  END IF;

  WITH agg AS (
    SELECT oi.product_id::uuid AS pid, SUM(oi.quantity)::int AS qty
    FROM order_items oi
    WHERE oi.order_id = p_order_id
      AND oi.product_id IS NOT NULL
      AND oi.product_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    GROUP BY oi.product_id
  ),
  before AS (
    SELECT p.id, COALESCE(p.stock_quantity, 0) AS old_qty, agg.qty
    FROM products p
    JOIN agg ON p.id = agg.pid
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
