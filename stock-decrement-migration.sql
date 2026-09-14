-- ============================================================
-- INVOICE STOCK DECREMENT
-- ============================================================
--
-- Marking an invoice `paid` should decrement product stock exactly once.
-- A boolean guard column makes the RPC idempotent no matter which path
-- (create / PATCH / payment) flips the invoice to paid.
--
-- Stock lives on `products.stock_quantity` (see
-- simplify-product-stock-migration.sql) and line items reference
-- `invoice_line_items.product_id`.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS stock_adjusted boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_invoices_stock_adjusted ON invoices(stock_adjusted);

-- Decrement stock for every product-bearing line item, at most once.
CREATE OR REPLACE FUNCTION adjust_stock_for_invoice(p_invoice_id uuid)
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

  UPDATE products p
  SET stock_quantity = GREATEST(0, COALESCE(p.stock_quantity, 0) - agg.qty)
  FROM (
    SELECT product_id, SUM(qty)::int AS qty
    FROM invoice_line_items
    WHERE invoice_id = p_invoice_id
      AND product_id IS NOT NULL
    GROUP BY product_id
  ) AS agg
  WHERE p.id = agg.product_id;

  UPDATE invoices SET stock_adjusted = true WHERE id = p_invoice_id;
END;
$$;

-- ------------------------------------------------------------
-- ORDER STOCK DECREMENT (payment confirmed)
-- ------------------------------------------------------------
--
-- A confirmed/paid order should decrement product stock exactly once.
-- order_items.product_id is stored as text in this schema, so we guard
-- with a UUID-shape regex before casting.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS stock_adjusted boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_orders_stock_adjusted ON orders(stock_adjusted);

CREATE OR REPLACE FUNCTION adjust_stock_for_order(p_order_id uuid)
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

  UPDATE products p
  SET stock_quantity = GREATEST(0, COALESCE(p.stock_quantity, 0) - agg.qty)
  FROM (
    SELECT oi.product_id::uuid AS pid, SUM(oi.quantity)::int AS qty
    FROM order_items oi
    WHERE oi.order_id = p_order_id
      AND oi.product_id IS NOT NULL
      AND oi.product_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    GROUP BY oi.product_id
  ) AS agg
  WHERE p.id = agg.pid;

  UPDATE orders SET stock_adjusted = true WHERE id = p_order_id;
END;
$$;
