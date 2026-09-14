-- ============================================================
-- PURCHASE ORDER — DISCOUNT / SHIPPING / ORDER DATE MIGRATION
-- Depends on: purchase-orders-migration.sql, purchase-orders-receiving-migration.sql
-- ============================================================
--
-- Layers the richer financial summary onto purchase orders:
--   subtotal -> + shipping_fee -> - discount -> + tax = total
-- (discount and tax each support percentage OR fixed input).
--
-- Also normalises the status vocabulary to the fulfilment-derived set and
-- re-asserts the inventory_log shape used by the receiving RPCs.

-- ---- 1. Money + dates ---------------------------------------------------
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS shipping_fee   numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_type  text          NOT NULL DEFAULT 'percentage'
    CHECK (discount_type IN ('percentage','fixed')),
  ADD COLUMN IF NOT EXISTS discount_value numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount       numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS order_date     date;

-- ---- 2. Status vocabulary ----------------------------------------------
-- The base migration shipped a CHECK that predated receiving
-- ('partially_paid'). Replace it with the fulfilment-derived set.
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('pending','partially_fulfilled','fulfilled','paid','cancelled'));

-- ---- 3. inventory_log shape (idempotent re-assert) ---------------------
-- Receiving migration already reshapes inventory_log; re-assert here so this
-- migration is safe to run against an older inventory_log too. The RPCs write
-- change_qty (NOT NULL) + delta + reference_type and cast reference_id to text.
ALTER TABLE inventory_log
  ADD COLUMN IF NOT EXISTS product_id     uuid REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reference_type text,
  ADD COLUMN IF NOT EXISTS delta          integer;

DO $$ BEGIN
  ALTER TABLE inventory_log ALTER COLUMN variant_id DROP NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

-- ---- 4. RPCs ------------------------------------------------------------
-- receive_po_items() and apply_po_inventory() are defined in their final
-- form in purchase-orders-receiving-migration.sql: they already increment
-- products.stock_quantity, write the reshaped inventory_log, and allow
-- receiving against a 'paid' PO (which stays 'paid'). No rewrite needed here
-- now that the columns above exist.
