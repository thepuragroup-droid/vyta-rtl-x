-- ============================================================
-- PuraMass (Stealth Health) Hosted Checkout
-- ============================================================
--
-- Adds everything the PuraMass hosted-checkout integration needs:
--   1. products.puramass_sku            — per-product PuraMass SKU mapping
--   2. site_settings.puramass_checkout_enabled — admin opt-in toggle
--   3. puramass_orders                  — hand-off ledger (one row per hand-off)
--
-- Idempotent: safe to re-run. All access is server-side (service role),
-- so puramass_orders is locked to a single service-role RLS policy.
--
-- Run this in the Supabase SQL editor (same as every other *-migration.sql).

-- 1. Per-product PuraMass SKU mapping ------------------------------------
-- Each product maps to up to two PuraMass SKUs: a 10-pack (…-10-pack) and a
-- single vial (…-vial). The hand-off route picks by cart-line type.
ALTER TABLE products ADD COLUMN IF NOT EXISTS puramass_sku      VARCHAR(80);  -- 10-pack SKU
ALTER TABLE products ADD COLUMN IF NOT EXISTS puramass_sku_vial VARCHAR(80);  -- single-vial SKU
CREATE INDEX IF NOT EXISTS idx_products_puramass_sku
  ON products (puramass_sku) WHERE puramass_sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_puramass_sku_vial
  ON products (puramass_sku_vial) WHERE puramass_sku_vial IS NOT NULL;

-- 1b. Checkout add-on flag — products offered as an upsell on the PuraMass
-- checkout screen (e.g. bacteriostatic water). Store stock is ignored for
-- these (PuraMass fulfils them).
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_checkout_addon BOOLEAN NOT NULL DEFAULT false;

-- 2. Admin toggle on the singleton site_settings row ---------------------
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS puramass_checkout_enabled BOOLEAN NOT NULL DEFAULT false;

-- 3. Hand-off ledger -----------------------------------------------------
CREATE TABLE IF NOT EXISTS puramass_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_reference TEXT NOT NULL UNIQUE,       -- our id, echoed back; unique => safe retry
  transaction_id    TEXT,                       -- PuraMass id
  payment_link      TEXT,
  status            TEXT NOT NULL DEFAULT 'payment_pending',
  subtotal_cents    INTEGER,
  customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_email    TEXT,
  items             JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ sku, quantity }, …] sent to PuraMass
  referral_code     TEXT,                       -- captured for manual reconciliation
  -- Payment-status columns (webhook + polling):
  paid_at           TIMESTAMPTZ,                -- set when status → paid
  currency          TEXT,                       -- e.g. 'usd'
  last_event_id     TEXT,                       -- last processed webhook event_id (dedupe)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Columns added by later runs on tables that predate the payment-status
-- work — additive so an older ledger picks them up on re-run.
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS paid_at       TIMESTAMPTZ;
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS currency      TEXT;
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS last_event_id TEXT;

CREATE INDEX IF NOT EXISTS idx_puramass_orders_transaction
  ON puramass_orders (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_customer
  ON puramass_orders (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_created
  ON puramass_orders (created_at DESC);

-- updated_at trigger -----------------------------------------------------
CREATE OR REPLACE FUNCTION update_puramass_orders_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS puramass_orders_updated_at ON puramass_orders;
CREATE TRIGGER puramass_orders_updated_at
  BEFORE UPDATE ON puramass_orders
  FOR EACH ROW EXECUTE FUNCTION update_puramass_orders_updated_at();

-- RLS: service-role only (all access is server-side) ---------------------
ALTER TABLE puramass_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON puramass_orders;
CREATE POLICY "Service role full access" ON puramass_orders FOR ALL USING (true) WITH CHECK (true);

-- 4. Fulfillment-queue surfacing ----------------------------------------
-- When a PuraMass order is paid, a fulfillment invoice is materialised so the
-- warehouse can see it. `invoices.source` marks its origin ('stealth_health');
-- `puramass_orders.invoice_id` links the ledger row to that invoice (dedupe so
-- the webhook + polling refresh can't create it twice).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS invoice_id UUID;
