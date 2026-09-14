-- ============================================================
-- Stealth Health (PuraMass) settlement — earnings, balance owed, payouts
-- ============================================================
--
-- Stealth Health runs the hosted checkout: the buyer pays THEM, we fulfil the
-- order from our warehouse. So every paid hand-off in `puramass_orders` is
-- money they are holding on our behalf. This migration adds the three things
-- needed to run that relationship as a real receivable:
--
--   1. stealth_health_settings  — the commercial terms (what they keep) so the
--                                 amount owed is computed, not typed.
--   2. stealth_health_invoices  — a settlement invoice we raise against them
--                                 for a period, with the money frozen on it.
--   3. stealth_health_payouts   — what they have actually remitted to us.
--
-- Balance owed = earned on paid orders − remitted. The dashboard at
-- /admin/stealth-health reads all three.
--
-- Idempotent: safe to re-run. All access is server-side (service role), so
-- every table is locked to a single service-role RLS policy, matching
-- puramass_orders.
--
-- Run this in the Supabase SQL editor (same as every other *-migration.sql).

-- 1. Commercial terms (singleton) ----------------------------------------
-- Deliberately NOT on site_settings: GET /api/admin/settings is a public,
-- unauthenticated read of checkout config, and the commission we pay a partner
-- is not public. This table is only ever read through the admin API.
CREATE TABLE IF NOT EXISTS stealth_health_settings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_name       TEXT NOT NULL DEFAULT 'Stealth Health',
  partner_email      TEXT,
  partner_address    TEXT,
  -- What Stealth Health keeps out of what it collects.
  commission_pct     NUMERIC NOT NULL DEFAULT 0,      -- % of net goods revenue
  flat_fee_cents     INTEGER NOT NULL DEFAULT 0,      -- per paid order
  -- The flat shipment fee we book on every PuraMass sale (see
  -- PURAMASS_SHIPPING_USD in lib/payments/puramass-fulfillment.ts). PuraMass
  -- collects it on the hosted page; `shipping_remitted` says whether it comes
  -- back to us or is theirs to cover the parcel.
  shipping_fee_cents INTEGER NOT NULL DEFAULT 3500,
  shipping_remitted  BOOLEAN NOT NULL DEFAULT true,
  payment_terms_days INTEGER NOT NULL DEFAULT 14,     -- due date on a new invoice
  currency           TEXT NOT NULL DEFAULT 'USD',     -- settlement currency
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the singleton on first run (default terms = they remit everything).
INSERT INTO stealth_health_settings (partner_name)
SELECT 'Stealth Health'
WHERE NOT EXISTS (SELECT 1 FROM stealth_health_settings);

-- 2. Settlement invoices -------------------------------------------------
-- One invoice covers a period of paid hand-offs. Every money figure is frozen
-- onto the row at creation (including the terms that produced it), so a later
-- change to commission_pct never silently rewrites an invoice already sent.
CREATE SEQUENCE IF NOT EXISTS stealth_health_invoice_seq START 1000;

CREATE TABLE IF NOT EXISTS stealth_health_invoices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number   TEXT NOT NULL UNIQUE
                     DEFAULT ('SH-' || nextval('stealth_health_invoice_seq')),
  status           TEXT NOT NULL DEFAULT 'draft',   -- draft|sent|partial|paid|void
  currency         TEXT NOT NULL DEFAULT 'USD',
  period_start     DATE,
  period_end       DATE,
  issue_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date         DATE,
  -- Frozen totals, in cents.
  order_count      INTEGER NOT NULL DEFAULT 0,
  units            INTEGER NOT NULL DEFAULT 0,
  gross_cents      INTEGER NOT NULL DEFAULT 0,   -- goods collected by PuraMass
  refunds_cents    INTEGER NOT NULL DEFAULT 0,   -- refunded on the PuraMass side
  shipping_cents   INTEGER NOT NULL DEFAULT 0,   -- shipment fees remitted to us
  fee_cents        INTEGER NOT NULL DEFAULT 0,   -- commission + flat fees kept
  amount_due_cents INTEGER NOT NULL DEFAULT 0,   -- what they owe us
  -- Terms snapshot, so the arithmetic on the invoice can always be re-derived.
  commission_pct   NUMERIC NOT NULL DEFAULT 0,
  flat_fee_cents   INTEGER NOT NULL DEFAULT 0,
  shipping_remitted BOOLEAN NOT NULL DEFAULT true,
  notes            TEXT,
  sent_at          TIMESTAMPTZ,
  voided_at        TIMESTAMPTZ,
  created_by       UUID,
  created_by_email TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sh_invoices_created ON stealth_health_invoices (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sh_invoices_status  ON stealth_health_invoices (status);

-- 3. Payouts received ----------------------------------------------------
-- What Stealth Health has actually remitted. `invoice_id` is optional: a
-- payout can be applied to an invoice, or recorded on account.
CREATE TABLE IF NOT EXISTS stealth_health_payouts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       UUID REFERENCES stealth_health_invoices(id) ON DELETE SET NULL,
  amount_cents     INTEGER NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'USD',
  received_at      DATE NOT NULL DEFAULT CURRENT_DATE,
  method           TEXT,      -- wire / e-transfer / crypto / …
  reference        TEXT,      -- their remittance reference
  notes            TEXT,
  created_by       UUID,
  created_by_email TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sh_payouts_invoice  ON stealth_health_payouts (invoice_id);
CREATE INDEX IF NOT EXISTS idx_sh_payouts_received ON stealth_health_payouts (received_at DESC);

-- 4. Link paid hand-offs to the invoice that billed them -----------------
-- `settlement_invoice_id` is what stops an order being billed twice: invoice
-- creation only picks up paid orders where it is still NULL.
-- `settlement_excluded` parks an order we are not billing (a disputed or
-- test hand-off) without deleting it.
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS settlement_invoice_id UUID
    REFERENCES stealth_health_invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS settlement_excluded BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_puramass_orders_settlement
  ON puramass_orders (settlement_invoice_id) WHERE settlement_invoice_id IS NOT NULL;
-- Covers the "what is still unbilled?" query the dashboard runs on every load.
CREATE INDEX IF NOT EXISTS idx_puramass_orders_unbilled
  ON puramass_orders (status, paid_at) WHERE settlement_invoice_id IS NULL;

COMMENT ON COLUMN puramass_orders.settlement_invoice_id IS
  'The stealth_health_invoices row that billed this hand-off. NULL = not yet billed.';
COMMENT ON COLUMN puramass_orders.settlement_excluded IS
  'Held back from settlement invoicing (disputed / test hand-off). Never picked up by invoice creation.';

-- 5. updated_at triggers -------------------------------------------------
CREATE OR REPLACE FUNCTION touch_stealth_health_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stealth_health_settings_updated_at ON stealth_health_settings;
CREATE TRIGGER stealth_health_settings_updated_at
  BEFORE UPDATE ON stealth_health_settings
  FOR EACH ROW EXECUTE FUNCTION touch_stealth_health_updated_at();

DROP TRIGGER IF EXISTS stealth_health_invoices_updated_at ON stealth_health_invoices;
CREATE TRIGGER stealth_health_invoices_updated_at
  BEFORE UPDATE ON stealth_health_invoices
  FOR EACH ROW EXECUTE FUNCTION touch_stealth_health_updated_at();

-- 6. RLS: service-role only (all access is server-side) ------------------
ALTER TABLE stealth_health_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON stealth_health_settings;
CREATE POLICY "Service role full access" ON stealth_health_settings FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE stealth_health_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON stealth_health_invoices;
CREATE POLICY "Service role full access" ON stealth_health_invoices FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE stealth_health_payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON stealth_health_payouts;
CREATE POLICY "Service role full access" ON stealth_health_payouts FOR ALL USING (true) WITH CHECK (true);

-- Make PostgREST pick the new tables/columns up immediately. Supabase normally
-- reloads its schema cache on DDL via an event trigger; when that lags, every
-- query naming them fails even though the DDL succeeded.
NOTIFY pgrst, 'reload schema';

-- Verification: the three tables and the two ledger columns should come back.
-- SELECT table_name FROM information_schema.tables
-- WHERE table_name LIKE 'stealth_health_%';
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'puramass_orders'
--   AND column_name IN ('settlement_invoice_id', 'settlement_excluded');
