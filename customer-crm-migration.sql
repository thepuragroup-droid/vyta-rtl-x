-- ============================================================
-- CRM: LEAD MANAGEMENT, JOURNEY TRACKING, PROMO EMAIL
-- ============================================================
--
-- Turns /admin/customers into a lead desk. Three additions:
--
--   1. customer_leads   — who claimed a customer, how they're contacting them,
--                         and how the lead is doing (hot / warm / cold / …).
--   2. customer_activity — the storefront journey: pages visited on top of the
--                         existing searches / product views / cart adds.
--   3. customer_emails  — every promo/outreach email an admin sends, so the
--                         customer page can show who sent what, and when.
--
-- WHY customer_leads IS KEYED BY EMAIL
-- ------------------------------------
-- Half the people on the customers page have no `customers` row at all: buyers
-- who only ever went through the Stealth Health hosted checkout exist purely as
-- rows in `puramass_orders`. A claim stored as `customers.claimed_by_id` can
-- never reach them. So the lead record hangs off the email address — which both
-- populations always have — and links to `customers.id` when there is one.
--
-- The same table backs the AFFILIATES desk, but NOT the same rows:
-- affiliate-crm-migration.sql adds a `scope` column and makes the key
-- (email, scope), so the customer desk and the affiliate desk hold separate
-- claims, statuses and notes for the same person. Run that migration too.
-- `affiliate_id` is stamped alongside `customer_id` for provenance.
--
-- This migration is self-contained: it creates `customer_activity` if
-- registration-alerts-migration.sql has not been run, and does not depend on
-- the `customers.claimed_by_*` columns that migration adds.
--
-- Idempotent: safe to re-run.
-- Run this in the Supabase SQL editor (same as every other *-migration.sql).

-- ------------------------------------------------------------
-- 1. customer_leads — claim + lead state
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_leads (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The join key. Always lowercase — see the trigger below.
  email               TEXT NOT NULL UNIQUE,
  -- Set when the lead corresponds to a real account; NULL for a Stealth Health
  -- buyer who never registered. ON DELETE SET NULL so deleting the account
  -- keeps the lead history rather than silently dropping it.
  customer_id         UUID REFERENCES customers(id) ON DELETE SET NULL,

  -- Claim: which admin is the point of contact. NULL = unclaimed.
  claimed_by_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  claimed_by_email    TEXT,
  claimed_by_name     TEXT,
  claimed_at          TIMESTAMPTZ,

  -- How the lead is doing. 'new' until someone triages it.
  status              TEXT NOT NULL DEFAULT 'new',
  -- How the claiming admin is actually reaching this person.
  contact_method      TEXT,
  -- Free-text working notes for whoever holds the claim.
  notes               TEXT,
  last_contacted_at   TIMESTAMPTZ,
  next_follow_up_at   TIMESTAMPTZ,

  -- Set when this person is also an affiliate. Independent of customer_id:
  -- an affiliate created outside the normal flow may have no `customers` row.
  affiliate_id        UUID REFERENCES affiliates(id) ON DELETE SET NULL,

  -- Who last touched the lead fields (for the "updated by" line in the UI).
  updated_by_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  updated_by_name     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Columns added by later runs, so an existing table picks them up on re-run.
ALTER TABLE customer_leads
  ADD COLUMN IF NOT EXISTS affiliate_id      UUID,
  ADD COLUMN IF NOT EXISTS contact_method    TEXT,
  ADD COLUMN IF NOT EXISTS notes             TEXT,
  ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_follow_up_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_by_id     UUID,
  ADD COLUMN IF NOT EXISTS updated_by_name   TEXT;

-- Allowed values, added as named constraints so a re-run can replace them.
ALTER TABLE customer_leads DROP CONSTRAINT IF EXISTS customer_leads_status_chk;
ALTER TABLE customer_leads
  ADD CONSTRAINT customer_leads_status_chk
  CHECK (status IN ('new', 'hot', 'warm', 'cold', 'won', 'lost'));

ALTER TABLE customer_leads DROP CONSTRAINT IF EXISTS customer_leads_contact_method_chk;
ALTER TABLE customer_leads
  ADD CONSTRAINT customer_leads_contact_method_chk
  CHECK (contact_method IS NULL OR contact_method IN (
    'email', 'phone', 'sms', 'whatsapp', 'instagram', 'in_person', 'other'
  ));

CREATE INDEX IF NOT EXISTS idx_customer_leads_customer
  ON customer_leads (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_leads_affiliate
  ON customer_leads (affiliate_id) WHERE affiliate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_leads_claimed_by
  ON customer_leads (claimed_by_id) WHERE claimed_by_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_leads_status
  ON customer_leads (status);
CREATE INDEX IF NOT EXISTS idx_customer_leads_follow_up
  ON customer_leads (next_follow_up_at) WHERE next_follow_up_at IS NOT NULL;

-- The email is a join key matched against `customers.email` and
-- `puramass_orders.customer_email`, so it is normalised in the database rather
-- than trusting every call site to remember.
CREATE OR REPLACE FUNCTION customer_leads_normalize()
RETURNS TRIGGER AS $$
BEGIN
  NEW.email := lower(trim(NEW.email));
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS customer_leads_normalize_trg ON customer_leads;
CREATE TRIGGER customer_leads_normalize_trg
  BEFORE INSERT OR UPDATE ON customer_leads
  FOR EACH ROW EXECUTE FUNCTION customer_leads_normalize();

-- Carry over any claims already recorded on `customers` (from
-- registration-alerts-migration.sql). Guarded on the columns existing, since
-- that migration may not have been run. Never overwrites an existing lead.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers' AND column_name = 'claimed_by_id'
  ) THEN
    INSERT INTO customer_leads (email, customer_id, claimed_by_id, claimed_by_email, claimed_by_name, claimed_at, status)
    SELECT lower(c.email), c.id, c.claimed_by_id, c.claimed_by_email, c.claimed_by_name, c.claimed_at, 'new'
    FROM customers c
    WHERE c.claimed_by_id IS NOT NULL
    ON CONFLICT (email) DO NOTHING;
  END IF;
END $$;

-- Stamp affiliate_id on any lead whose email is an affiliate's. Guarded on the
-- affiliates table existing so this migration stands alone.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'affiliates') THEN
    UPDATE customer_leads AS l
    SET affiliate_id = a.id
    FROM affiliates AS a
    WHERE l.affiliate_id IS NULL AND lower(a.email) = l.email;
  END IF;
END $$;

-- Service-role only: every read and write goes through an admin-gated route.
ALTER TABLE customer_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer_leads_service_only" ON customer_leads;
CREATE POLICY "customer_leads_service_only" ON customer_leads
  FOR ALL TO public USING (false) WITH CHECK (false);

-- ------------------------------------------------------------
-- 2. customer_activity — storefront journey
-- ------------------------------------------------------------
-- Created here too, so this migration stands alone if
-- registration-alerts-migration.sql has not been run.
CREATE TABLE IF NOT EXISTS customer_activity (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  search_query  TEXT,
  product_id    UUID,
  product_name  TEXT,
  quantity      INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Page visits: which page, what it was called, and where they came from.
ALTER TABLE customer_activity
  ADD COLUMN IF NOT EXISTS page_path  TEXT,
  ADD COLUMN IF NOT EXISTS page_title TEXT,
  ADD COLUMN IF NOT EXISTS referrer   TEXT;

COMMENT ON COLUMN customer_activity.page_path IS
  'Path only (no origin, no query string) of a visited page, for activity_type = ''page''.';

-- Widen the type check to admit 'page'. The original constraint is inline and
-- auto-named, so it is dropped by that name and re-added explicitly.
ALTER TABLE customer_activity DROP CONSTRAINT IF EXISTS customer_activity_activity_type_check;
ALTER TABLE customer_activity DROP CONSTRAINT IF EXISTS customer_activity_type_chk;
ALTER TABLE customer_activity
  ADD CONSTRAINT customer_activity_type_chk
  CHECK (activity_type IN ('search', 'view', 'cart', 'page'));

CREATE INDEX IF NOT EXISTS idx_customer_activity_customer
  ON customer_activity (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_activity_type
  ON customer_activity (customer_id, activity_type, created_at DESC);

ALTER TABLE customer_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer_activity_service_only" ON customer_activity;
CREATE POLICY "customer_activity_service_only" ON customer_activity
  FOR ALL TO public USING (false) WITH CHECK (false);

-- ------------------------------------------------------------
-- 3. customer_emails — outreach log
-- ------------------------------------------------------------
--
-- One row per promo / outreach email an admin sends from the customer page.
-- Recorded whether or not the send succeeded, so a failure is visible in the
-- history rather than vanishing.
CREATE TABLE IF NOT EXISTS customer_emails (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL for a Stealth Health buyer with no account; `to_email` is the
  -- authoritative recipient either way.
  customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
  -- Set when the email went to an affiliate, so the affiliate page can show
  -- its own outreach history without depending on a `customers` row.
  affiliate_id    UUID REFERENCES affiliates(id) ON DELETE SET NULL,
  to_email        TEXT NOT NULL,
  cc_emails       JSONB NOT NULL DEFAULT '[]'::jsonb,
  subject         TEXT NOT NULL,
  -- The rendered HTML actually sent, so the history shows what they received
  -- even after the template changes.
  body_html       TEXT,
  -- Which builder template produced it ('promo', 'restock', 'custom', …).
  template        TEXT,
  -- Promo fields the builder merged into the body. Kept as columns (not just
  -- baked into the HTML) so the history is searchable by code.
  promo_code      TEXT,
  promo_details   TEXT,
  promo_expires   TEXT,

  sent_by_id      UUID REFERENCES customers(id) ON DELETE SET NULL,
  sent_by_email   TEXT,
  sent_by_name    TEXT,
  success         BOOLEAN NOT NULL DEFAULT false,
  error           TEXT,
  message_id      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_emails_customer
  ON customer_emails (customer_id, created_at DESC) WHERE customer_id IS NOT NULL;
ALTER TABLE customer_emails ADD COLUMN IF NOT EXISTS affiliate_id UUID;

CREATE INDEX IF NOT EXISTS idx_customer_emails_affiliate
  ON customer_emails (affiliate_id, created_at DESC) WHERE affiliate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_emails_to
  ON customer_emails (lower(to_email), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_emails_promo
  ON customer_emails (promo_code) WHERE promo_code IS NOT NULL;

ALTER TABLE customer_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer_emails_service_only" ON customer_emails;
CREATE POLICY "customer_emails_service_only" ON customer_emails
  FOR ALL TO public USING (false) WITH CHECK (false);

-- Make PostgREST pick everything up immediately instead of waiting out a
-- stale schema cache.
NOTIFY pgrst, 'reload schema';

-- Verification:
-- SELECT email, status, contact_method, claimed_by_name, affiliate_id FROM customer_leads ORDER BY updated_at DESC LIMIT 20;
-- SELECT activity_type, count(*) FROM customer_activity GROUP BY 1;
-- SELECT to_email, subject, sent_by_name, success, created_at FROM customer_emails ORDER BY created_at DESC LIMIT 20;
