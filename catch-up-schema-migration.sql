-- ============================================================
-- CATCH-UP SCHEMA MIGRATION
-- ============================================================
--
-- Reconciles the live database with every column the application reads/writes.
-- Several columns existed only in _live-schema-snapshot.sql or in
-- doc-ports/migrations-ref/ and were never applied to the real database, which
-- caused a string of runtime failures (fulfillment_type, crypto NOT NULL, etc.).
--
-- This script is fully idempotent (ADD COLUMN IF NOT EXISTS / guarded DO blocks)
-- and SUPERSEDES the per-feature migrations:
--   - orders-fulfillment-columns-migration.sql
--   - shipping-handling-fee-migration.sql
-- Running it is safe regardless of which migrations were applied before.

-- ---------- orders ----------
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
  ADD COLUMN IF NOT EXISTS payment_confirmations integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS easyship_shipment_id text,
  ADD COLUMN IF NOT EXISTS easyship_courier_id text,
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

-- crypto is legacy; the e-Transfer checkout never sets it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'crypto'
  ) THEN
    ALTER TABLE orders ALTER COLUMN crypto DROP NOT NULL;
  END IF;
END $$;

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

-- ---------- customers ----------
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS has_completed_first_order boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS website_accessed text,
  ADD COLUMN IF NOT EXISTS can_send_fulfillment_emails boolean NOT NULL DEFAULT false;

-- ---------- site_settings ----------
ALTER TABLE site_settings
  -- shipping processing/handling fee
  ADD COLUMN IF NOT EXISTS shipping_handling_fee_type text DEFAULT 'flat',
  ADD COLUMN IF NOT EXISTS shipping_handling_fee_value numeric DEFAULT 0,
  -- easyship auto-shipment
  ADD COLUMN IF NOT EXISTS easyship_auto_create_shipment boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS easyship_auto_courier_preference text DEFAULT 'cheapest',
  ADD COLUMN IF NOT EXISTS easyship_auto_buy_label boolean DEFAULT false,
  -- e-Transfer checkout config
  ADD COLUMN IF NOT EXISTS etransfer_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS etransfer_recipient_email text,
  ADD COLUMN IF NOT EXISTS etransfer_security_question text,
  ADD COLUMN IF NOT EXISTS etransfer_security_answer_hint text,
  ADD COLUMN IF NOT EXISTS etransfer_ack_subject text,
  ADD COLUMN IF NOT EXISTS etransfer_ack_body text,
  ADD COLUMN IF NOT EXISTS etransfer_instructions_subject text,
  ADD COLUMN IF NOT EXISTS etransfer_instructions_body text;

-- ---------- products ----------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS purity varchar,
  ADD COLUMN IF NOT EXISTS featured boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS coa_url text[],
  ADD COLUMN IF NOT EXISTS box_image_url text;
