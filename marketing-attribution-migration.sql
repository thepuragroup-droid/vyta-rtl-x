-- ============================================================
-- Marketing attribution + anonymous storefront tracking
-- ============================================================
--
-- Before this migration the site could not tell a Google Ads visitor from an
-- organic one in its own data. GA4 / GTM reported campaigns inside Google's UI,
-- but nothing reached Supabase, `orders.source` was always 'website', and
-- `customer_activity` only recorded signed-in customers — so the entire
-- pre-signup journey, which is most of the funnel, was invisible.
--
-- Three changes fix that:
--
--   1. `visitor_attribution` — one row per anonymous visitor, holding the
--      first and last touch (channel / campaign / click id) that brought them
--      in, and the customer + email it later resolved to.
--   2. `customer_activity` gains an `anonymous_id`, so page views, product
--      views, searches and COA opens are recorded before signup and adopted by
--      the customer when they register or sign in.
--   3. `customers`, `orders` and `puramass_orders` each gain a channel, a
--      campaign and a JSONB attribution snapshot, taken at the moment the row
--      was created so reporting never has to re-derive it.
--
-- Channel values come from lib/analytics/attribution.ts (CHANNELS):
--   google_ads, meta_ads, bing_ads, tiktok_ads, linkedin_ads, other_paid,
--   google_organic, meta_organic, email, affiliate, referral, direct
--
-- Deliberately NOT constrained to an enum or CHECK: adding a network would
-- otherwise need a migration before the code that emits it could ship, and an
-- unknown value should degrade to "shows up in reports under its own name"
-- rather than reject the write and lose the order.
--
-- Idempotent throughout — safe to re-run.

-- ------------------------------------------------------------
-- 1. visitor_attribution — one row per anonymous visitor
-- ------------------------------------------------------------
-- Keyed by the `aminocan_vid` cookie the middleware mints. The first touch is
-- written once and never updated (the campaign that earned the visit keeps the
-- credit); the last touch is rewritten on every meaningful arrival.
CREATE TABLE IF NOT EXISTS visitor_attribution (
  anonymous_id      TEXT PRIMARY KEY,

  -- First touch — set on the visitor's first recorded event, never overwritten.
  first_channel     TEXT,
  first_source      TEXT,
  first_medium      TEXT,
  first_campaign    TEXT,
  first_term        TEXT,
  first_content     TEXT,
  first_click_id    TEXT,
  first_click_param TEXT,          -- 'gclid' | 'fbclid' | 'msclkid' | …
  first_referrer    TEXT,          -- referring host only, no path
  first_landing     TEXT,          -- landing path, no query string
  first_ref_code    TEXT,          -- affiliate ?ref= riding on the same URL
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Last touch — the most recent arrival that carried acquisition signal.
  last_channel      TEXT,
  last_source       TEXT,
  last_medium       TEXT,
  last_campaign     TEXT,
  last_click_id     TEXT,
  last_click_param  TEXT,
  last_referrer     TEXT,
  last_landing      TEXT,
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Resolution: who this visitor turned out to be. `customer_id` is set when
  -- they sign in or register; `customer_email` is set from a checkout even
  -- when no account exists, and is what joins a hosted-checkout purchase back
  -- to the ad that produced it.
  customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_email    TEXT,

  -- Funnel milestones, stamped once each. Kept on the visitor rather than
  -- derived from the event log so the acquisition report is a single scan.
  signed_up_at      TIMESTAMPTZ,
  checkout_at       TIMESTAMPTZ,   -- reached a checkout, paid or not
  purchased_at      TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visitor_attr_customer
  ON visitor_attribution (customer_id) WHERE customer_id IS NOT NULL;
-- The hosted-checkout join: PuraMass tells us an email paid, and this finds
-- the visitor (and therefore the campaign) it belongs to.
CREATE INDEX IF NOT EXISTS idx_visitor_attr_email
  ON visitor_attribution (lower(customer_email)) WHERE customer_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_visitor_attr_first_seen
  ON visitor_attribution (first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_attr_channel
  ON visitor_attribution (first_channel, first_seen_at DESC);

-- Service-role only, matching customer_activity: every read and write goes
-- through an API route holding the service key. Visitor rows are marketing
-- data about people who are not signed in, so nothing is exposed to anon.
ALTER TABLE visitor_attribution ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "visitor_attribution_service_only" ON visitor_attribution;
CREATE POLICY "visitor_attribution_service_only" ON visitor_attribution
  FOR ALL TO public USING (false) WITH CHECK (false);

COMMENT ON TABLE visitor_attribution IS
  'First/last marketing touch per anonymous visitor, resolved to a customer and email once known.';

-- ------------------------------------------------------------
-- 2. customer_activity — record anonymous visitors too
-- ------------------------------------------------------------
-- The table is created by registration-alerts-migration.sql and extended by
-- customer-crm-migration.sql; this block stands alone if neither has run.
CREATE TABLE IF NOT EXISTS customer_activity (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID REFERENCES customers(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  search_query  TEXT,
  product_id    UUID,
  product_name  TEXT,
  quantity      INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE customer_activity
  ADD COLUMN IF NOT EXISTS page_path    TEXT,
  ADD COLUMN IF NOT EXISTS page_title   TEXT,
  ADD COLUMN IF NOT EXISTS referrer     TEXT,
  -- The `aminocan_vid` cookie. Present on every row; the same value stays on
  -- the row after the visitor registers, so their pre-signup journey is still
  -- attributable to the visit that produced it.
  ADD COLUMN IF NOT EXISTS anonymous_id TEXT,
  -- Per-visit id (session cookie), so "how many sessions before they bought"
  -- is answerable without inferring sessions from timestamps.
  ADD COLUMN IF NOT EXISTS session_id   TEXT,
  -- Event-specific payload: the lab report opened, the element clicked, the
  -- checkout kind. Avoids a column per event type.
  ADD COLUMN IF NOT EXISTS metadata     JSONB;

-- customer_id becomes nullable: an anonymous row has no customer yet, and gets
-- one at signup/sign-in. Guarded so a re-run on an already-migrated table is a
-- no-op rather than an error.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'customer_activity'
       AND column_name = 'customer_id'
       AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE customer_activity ALTER COLUMN customer_id DROP NOT NULL;
  END IF;
END $$;

-- Every row must be attributable to somebody, even if only to a cookie.
ALTER TABLE customer_activity DROP CONSTRAINT IF EXISTS customer_activity_actor_chk;
ALTER TABLE customer_activity
  ADD CONSTRAINT customer_activity_actor_chk
  CHECK (customer_id IS NOT NULL OR anonymous_id IS NOT NULL);

-- Widen the event vocabulary. The original constraint is inline and
-- auto-named, so drop by both names it has had before re-adding.
ALTER TABLE customer_activity DROP CONSTRAINT IF EXISTS customer_activity_activity_type_check;
ALTER TABLE customer_activity DROP CONSTRAINT IF EXISTS customer_activity_type_chk;
ALTER TABLE customer_activity
  ADD CONSTRAINT customer_activity_type_chk
  CHECK (activity_type IN (
    'search',          -- search_query holds the term
    'view',            -- product_id / product_name hold the product
    'cart',            -- + quantity
    'page',            -- page_path / page_title / referrer
    'click',           -- metadata.label names what was clicked
    'lab_result',      -- a COA was opened; metadata holds lab id + product
    'checkout_start',  -- reached a checkout; metadata.kind = native|puramass
    'signup',          -- account created
    'purchase'         -- payment confirmed
  ));

CREATE INDEX IF NOT EXISTS idx_customer_activity_customer
  ON customer_activity (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_activity_type
  ON customer_activity (customer_id, activity_type, created_at DESC);
-- The stitch lookup (adopt this visitor's rows) and the anonymous funnel scan.
CREATE INDEX IF NOT EXISTS idx_customer_activity_anonymous
  ON customer_activity (anonymous_id, created_at DESC) WHERE anonymous_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_activity_created
  ON customer_activity (created_at DESC);

COMMENT ON COLUMN customer_activity.anonymous_id IS
  'Visitor cookie id. Set on every row, including after the visitor registers.';
COMMENT ON COLUMN customer_activity.session_id IS
  'Per-visit id, for counting sessions-to-purchase.';
COMMENT ON COLUMN customer_activity.metadata IS
  'Event-specific detail: lab report id, click label, checkout kind.';

ALTER TABLE customer_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer_activity_service_only" ON customer_activity;
CREATE POLICY "customer_activity_service_only" ON customer_activity
  FOR ALL TO public USING (false) WITH CHECK (false);

-- ------------------------------------------------------------
-- 3. Attribution snapshots on the rows that matter
-- ------------------------------------------------------------
-- Each row keeps the channel that produced it, frozen at creation. Copied
-- rather than joined so a report over a date range is one scan, and so
-- re-attributing a visitor later cannot silently rewrite past revenue.
--
--   *_channel   the reporting bucket ('google_ads', 'meta_ads', …)
--   *_campaign  utm_campaign, for drill-down inside a channel
--   attribution the full first/last touch pair as JSONB

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS attribution_channel  TEXT,
  ADD COLUMN IF NOT EXISTS attribution_campaign TEXT,
  ADD COLUMN IF NOT EXISTS attribution          JSONB,
  ADD COLUMN IF NOT EXISTS anonymous_id         TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_attribution_channel
  ON customers (attribution_channel, created_at DESC)
  WHERE attribution_channel IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_anonymous
  ON customers (anonymous_id) WHERE anonymous_id IS NOT NULL;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS attribution_channel  TEXT,
  ADD COLUMN IF NOT EXISTS attribution_campaign TEXT,
  ADD COLUMN IF NOT EXISTS attribution          JSONB;

CREATE INDEX IF NOT EXISTS idx_orders_attribution_channel
  ON orders (attribution_channel, created_at DESC)
  WHERE attribution_channel IS NOT NULL;

ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS attribution_channel  TEXT,
  ADD COLUMN IF NOT EXISTS attribution_campaign TEXT,
  ADD COLUMN IF NOT EXISTS attribution          JSONB;

CREATE INDEX IF NOT EXISTS idx_puramass_orders_attribution_channel
  ON puramass_orders (attribution_channel, created_at DESC)
  WHERE attribution_channel IS NOT NULL;
-- The email join used to attribute a hosted-checkout payment back to a visitor.
CREATE INDEX IF NOT EXISTS idx_puramass_orders_email
  ON puramass_orders (lower(customer_email)) WHERE customer_email IS NOT NULL;

COMMENT ON COLUMN customers.attribution_channel IS
  'Acquisition channel at signup, frozen. See lib/analytics/attribution.ts CHANNELS.';
COMMENT ON COLUMN orders.attribution_channel IS
  'Acquisition channel of the visitor who placed this order, frozen at creation.';
COMMENT ON COLUMN puramass_orders.attribution_channel IS
  'Acquisition channel of the visitor handed off to the hosted checkout.';
