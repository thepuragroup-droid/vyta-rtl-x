-- ============================================================
-- ORDERS — fulfillment + ecommerce columns
-- ============================================================
--
-- The storefront order insert (/api/orders-email) and the warehouse /
-- auto-shipment flows reference columns that some databases never received,
-- producing errors like:
--   "Could not find the 'fulfillment_type' column of 'orders' in the schema cache"
--
-- Every add below is idempotent (ADD COLUMN IF NOT EXISTS), so this is safe to
-- run on any orders table regardless of which columns already exist.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS subtotal numeric,
  ADD COLUMN IF NOT EXISTS shipping_cost numeric,
  ADD COLUMN IF NOT EXISTS shipping_method text,
  ADD COLUMN IF NOT EXISTS shipping_carrier text,
  ADD COLUMN IF NOT EXISTS discount_total numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_total numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'website',
  ADD COLUMN IF NOT EXISTS fulfillment_type text,
  ADD COLUMN IF NOT EXISTS billing_address jsonb,
  ADD COLUMN IF NOT EXISTS staff_notes text,
  ADD COLUMN IF NOT EXISTS stock_adjusted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS easyship_shipment_id text,
  ADD COLUMN IF NOT EXISTS tracking_status text,
  ADD COLUMN IF NOT EXISTS tracking_url text,
  ADD COLUMN IF NOT EXISTS carrier text,
  ADD COLUMN IF NOT EXISTS label_state text,
  ADD COLUMN IF NOT EXISTS label_url text,
  ADD COLUMN IF NOT EXISTS packed_at timestamptz,
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_shipment_status text,
  ADD COLUMN IF NOT EXISTS auto_shipment_stage text,
  ADD COLUMN IF NOT EXISTS auto_shipment_error text,
  ADD COLUMN IF NOT EXISTS auto_shipment_attempted_at timestamptz;

-- The legacy `crypto` column is NOT NULL in some databases, but the current
-- e-Transfer checkout never sets it, causing:
--   null value in column "crypto" of relation "orders" violates not-null constraint
-- Make it nullable (no-op if it is already nullable / absent).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'crypto'
  ) THEN
    ALTER TABLE orders ALTER COLUMN crypto DROP NOT NULL;
  END IF;
END $$;

-- Backfill existing rows and constrain fulfillment_type to known values.
UPDATE orders SET fulfillment_type = 'shipment' WHERE fulfillment_type IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_fulfillment_type_chk'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_fulfillment_type_chk
      CHECK (fulfillment_type IN ('shipment', 'pickup'));
  END IF;
END $$;
