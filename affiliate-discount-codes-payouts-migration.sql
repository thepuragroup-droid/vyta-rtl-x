-- ============================================================
-- AFFILIATE DISCOUNT CODES + PAYOUT LEDGER
-- ============================================================
--
-- Two things the affiliate program could not do before:
--
--   1. Discount codes an admin creates and hands to an affiliate. A referral
--      code (`referral_codes`) is a tracking link: one per affiliate, captured
--      from `?ref=`, and it takes nothing off. A discount code is typed at
--      checkout, takes a configurable amount off (percent or fixed CAD), and
--      credits the affiliate it is assigned to. An affiliate can hold several
--      ("SPRING20", "PODCAST15"), and a code with no affiliate is a plain
--      store-wide promo code whose revenue is still tracked.
--
--   2. A record of what was actually PAID to an affiliate. `commissions` says
--      what they earned; nothing said when, how or how much they were sent.
--      `affiliate_payouts` is that ledger. Recording a payout marks the
--      commissions it settles as paid and points them back at it, so every
--      paid commission can be traced to the transfer that paid it.
--
-- Revenue per code is read from the paid hosted orders that used it
-- (`puramass_orders.discount_code_id`), so a store-wide code with no affiliate,
-- and therefore no commission rows, still reports its sales.
--
-- Idempotent: safe to re-run.
-- Run this in the Supabase SQL editor (same as every other *-migration.sql).
-- Ship it BEFORE the application code: until it runs the checkout ignores
-- discount codes (the lookup fails closed) and the admin pages say so.

-- 1. Discount codes ------------------------------------------------------
CREATE TABLE IF NOT EXISTS discount_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stored normalised: uppercase A-Z / 0-9 only (normalizeDiscountCode).
  code            VARCHAR(32) NOT NULL UNIQUE,
  -- Who earns on it. NULL = a store promo with no affiliate.
  affiliate_id    UUID REFERENCES affiliates(id) ON DELETE SET NULL,
  discount_type   VARCHAR(10) NOT NULL DEFAULT 'percent'
                    CHECK (discount_type IN ('percent', 'fixed')),
  -- Percent (0-99) when discount_type = 'percent', CAD when 'fixed'.
  discount_value  NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
  -- Commission on orders using this code, as a percentage. NULL = the
  -- affiliate's own rate (affiliates.commission_rate, else the 10% default).
  commission_rate NUMERIC(5,2) CHECK (commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 100)),
  -- Goods subtotal (CAD, list price) the cart must reach. NULL/0 = none.
  min_subtotal    NUMERIC(10,2),
  -- Total paid orders allowed. NULL = unlimited.
  max_uses        INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  starts_at       TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  active          BOOLEAN NOT NULL DEFAULT true,
  notes           TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discount_codes_affiliate ON discount_codes (affiliate_id);

COMMENT ON TABLE discount_codes IS
  'Checkout discount codes. Optionally assigned to an affiliate, who then earns commission on every paid order that uses the code.';

-- Service role only, like referral_code_requests: every read and write goes
-- through an API route that authenticates the caller and chooses the columns.
ALTER TABLE discount_codes ENABLE ROW LEVEL SECURITY;

-- 2. Payouts -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS affiliate_payouts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id     UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  amount           NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  -- e_transfer | crypto | paypal | bank | cheque | store_credit | other
  method           VARCHAR(30) NOT NULL DEFAULT 'e_transfer',
  -- Transaction id, tx hash, cheque number — whatever proves it was sent.
  reference        VARCHAR(255),
  notes            TEXT,
  paid_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by      UUID,
  recorded_by_name VARCHAR(255),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_payouts_affiliate
  ON affiliate_payouts (affiliate_id, paid_at DESC);

ALTER TABLE affiliate_payouts ENABLE ROW LEVEL SECURITY;

-- 3. Commissions: which code earned it, which payout settled it ----------
ALTER TABLE commissions
  ADD COLUMN IF NOT EXISTS discount_code_id UUID REFERENCES discount_codes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payout_id UUID REFERENCES affiliate_payouts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_commissions_discount_code
  ON commissions (discount_code_id) WHERE discount_code_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commissions_payout
  ON commissions (payout_id) WHERE payout_id IS NOT NULL;

-- 4. Hosted orders: which code was used and what it took off -------------
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS discount_code_id UUID REFERENCES discount_codes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_code VARCHAR(32),
  ADD COLUMN IF NOT EXISTS discount_code_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS discount_code_cents INTEGER;

CREATE INDEX IF NOT EXISTS idx_puramass_orders_discount_code
  ON puramass_orders (discount_code_id) WHERE discount_code_id IS NOT NULL;

COMMENT ON COLUMN puramass_orders.discount_code_cents IS
  'This code''s share of the discount, in cents. When other promos stacked with it, ad_discount_cents is the whole saving.';

-- 5. total_earnings has to come back down when a payout is voided --------
-- The original trigger only ever adds. Voiding a payout returns its
-- commissions to pending, which must subtract what it added.
CREATE OR REPLACE FUNCTION update_affiliate_earnings()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS NULL OR OLD.status != 'paid') THEN
    UPDATE affiliates
    SET total_earnings = total_earnings + NEW.amount
    WHERE id = NEW.affiliate_id;
  ELSIF OLD.status = 'paid' AND NEW.status != 'paid' THEN
    UPDATE affiliates
    SET total_earnings = GREATEST(0, total_earnings - OLD.amount)
    WHERE id = OLD.affiliate_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
