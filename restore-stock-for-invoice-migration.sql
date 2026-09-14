-- ============================================================
-- INVOICE STOCK RESTORE (cancellation)
-- ============================================================
--
-- The inverse of `adjust_stock_for_invoice`. When an invoice is cancelled
-- after having decremented stock, the goods must return to inventory
-- exactly once — otherwise cycling paid → cancelled → paid would
-- gradually leak stock.
--
-- Guarded on `invoices.stock_adjusted`: only invoices that actually took
-- stock are restored, and the flag is cleared in the same claim so a
-- second cancel is a no-op.
--
-- Mirrors the `product_history` logging added by product-history-migration.sql
-- (change_source = 'invoice_cancel') so admin activity reports can trace
-- each restore back to the invoice that triggered it.

DROP FUNCTION IF EXISTS restore_stock_for_invoice(uuid);
DROP FUNCTION IF EXISTS restore_stock_for_invoice(uuid, text);

CREATE OR REPLACE FUNCTION restore_stock_for_invoice(
  p_invoice_id  uuid,
  p_actor_email text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_adjusted boolean;
BEGIN
  -- Atomic claim: only proceed when stock had actually been taken, and
  -- clear the flag in the same statement so a concurrent second cancel
  -- sees no work to do. If the invoice doesn't exist or its stock was
  -- never adjusted, RETURN with no side effect.
  UPDATE invoices
     SET stock_adjusted = false
   WHERE id = p_invoice_id
     AND stock_adjusted = true
  RETURNING stock_adjusted INTO v_adjusted;

  IF NOT FOUND THEN
    RETURN;
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
    'invoice_cancel', 'invoice', p_invoice_id::text,
    'Stock restored (+' || b.qty || ') when invoice was cancelled',
    p_actor_email
  FROM before b;
END;
$$;
