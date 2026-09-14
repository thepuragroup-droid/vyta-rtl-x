-- ============================================================
-- ABANDONED CHECKOUT RECOVERY
-- ============================================================
--
-- A PuraMass (Stealth Health) hand-off that never gets paid is a cart the buyer
-- walked away from: we already hold their email, their line items and — the
-- part that matters — the hosted `payment_link` that still takes payment. This
-- migration adds the bookkeeping for emailing that link back to them with a
-- discount code, from /admin/puramass-orders.
--
-- Nothing here issues a promo code. Codes are generated on the Stealth Health
-- platform (app.puramass.com) and pasted into the composer; these columns only
-- record which code was offered, so a redemption can be traced back to the send
-- that caused it.
--
-- "Recovered" is deliberately NOT a column: an order is recovered when it is
-- paid and `paid_at` is later than `recovery_email_sent_at`, which is derivable
-- from what is already stored and can never drift out of step with the ledger.
--
-- Idempotent: safe to re-run.
-- Run this in the Supabase SQL editor (same as every other *-migration.sql).

ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS recovery_email_sent_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recovery_email_count    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_promo_code     TEXT,
  ADD COLUMN IF NOT EXISTS recovery_discount_type  TEXT,
  ADD COLUMN IF NOT EXISTS recovery_discount_value NUMERIC(10,2);

COMMENT ON COLUMN puramass_orders.recovery_email_sent_at IS
  'When the most recent abandoned-checkout recovery email went out. NULL means the buyer has never been chased.';
COMMENT ON COLUMN puramass_orders.recovery_email_count IS
  'How many recovery emails this hand-off has had. Surfaced in the admin so nobody sends a fourth.';
COMMENT ON COLUMN puramass_orders.recovery_promo_code IS
  'The promo code offered in the last recovery email. Generated on app.puramass.com — recorded here, never issued here.';
COMMENT ON COLUMN puramass_orders.recovery_discount_type IS
  '''percentage'' or ''fixed'' — how recovery_discount_value should be read.';
COMMENT ON COLUMN puramass_orders.recovery_discount_value IS
  'Percent off (0-100) when recovery_discount_type is ''percentage''; a money amount in the order currency when ''fixed''.';

-- Only rows that have actually been chased are ever filtered on, so the index
-- is partial and stays small next to the ledger itself.
CREATE INDEX IF NOT EXISTS idx_puramass_orders_recovery_sent
  ON puramass_orders (recovery_email_sent_at DESC)
  WHERE recovery_email_sent_at IS NOT NULL;

-- The abandoned list is "unpaid, oldest first" — this is the index behind it.
CREATE INDEX IF NOT EXISTS idx_puramass_orders_status_created
  ON puramass_orders (status, created_at DESC);

-- How long a hand-off sits unpaid before the admin list calls it abandoned.
-- A knob rather than a constant because it depends on how the storefront's
-- buyers actually behave — 60 minutes is a starting point, not a truth.
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS abandoned_checkout_hours INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN site_settings.abandoned_checkout_hours IS
  'Hours a PuraMass hand-off must sit unpaid before /admin/puramass-orders lists it as an abandoned checkout.';

-- Make PostgREST pick the new columns up immediately. Supabase normally reloads
-- its schema cache on DDL via an event trigger, but when that lags, every query
-- naming these columns fails with "column ... does not exist" even though the
-- ALTER succeeded. This forces the reload. Safe to run any time.
NOTIFY pgrst, 'reload schema';

-- Verification: all five columns should come back.
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'puramass_orders'
--   AND column_name LIKE 'recovery%';
