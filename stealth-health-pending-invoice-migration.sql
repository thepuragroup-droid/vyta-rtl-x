-- ============================================================================
-- STEALTH HEALTH — INVOICE AT HAND-OFF, VIAL-AWARE STOCK ON PAYMENT
-- ============================================================================
--
-- WHY
-- ---
-- A Stealth Health order used to get an invoice only once it was paid. It now
-- gets one the moment the buyer is handed off to the hosted checkout, carrying
-- the exact lines, shipping and courier they chose, in status
-- `pending_payment`. When payment is confirmed it flips to `paid` (and stock
-- is taken); when the payment link lapses or is cancelled unpaid it becomes
-- `expired`. Neither unpaid status reaches the warehouse queue, the customer's
-- account, or any revenue figure.
--
-- Stock is counted in VIALS, but a Stealth Health line is sold per pack: one
-- unit of a "pack of 5" line is five vials. `invoice_line_items.vials_per_unit`
-- records that, and adjust/restore_stock_for_invoice now take
-- `qty * vials_per_unit` instead of raw `qty`. The column defaults to 1, so
-- every existing line — and every line any other writer creates — decrements
-- exactly as it did before.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

-- 1. Two new invoice statuses -------------------------------------------------
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status = ANY (ARRAY[
    'draft'::text,
    'sent'::text,
    'partial'::text,
    'paid'::text,
    'overdue'::text,
    'cancelled'::text,
    'pending_payment'::text,
    'expired'::text
  ]));

-- 2. Vials per invoice line unit ---------------------------------------------
ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS vials_per_unit integer NOT NULL DEFAULT 1;

DO $$ BEGIN
  ALTER TABLE invoice_line_items
    ADD CONSTRAINT invoice_line_items_vials_per_unit_positive CHECK (vials_per_unit >= 1);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3. Stock decrement, vial-aware ---------------------------------------------
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
    SELECT product_id, SUM(qty * COALESCE(vials_per_unit, 1))::int AS qty
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

-- 4. Stock restore (cancellation), vial-aware --------------------------------
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
  UPDATE invoices
     SET stock_adjusted = false
   WHERE id = p_invoice_id
     AND stock_adjusted = true
  RETURNING stock_adjusted INTO v_adjusted;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  WITH agg AS (
    SELECT product_id, SUM(qty * COALESCE(vials_per_unit, 1))::int AS qty
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

NOTIFY pgrst, 'reload schema';
