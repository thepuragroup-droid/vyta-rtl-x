-- ============================================================
-- EMAIL FLOWS — welcome series + cart abandonment
-- ============================================================
--
-- Automated email sequences, sent from our own SMTP server and managed at
-- /admin/email-flows. Two flows share these tables, told apart by `flow`:
--
--   welcome  new consenting signups      1: now, 2: day 2, 3: day 4, 4: day 6, 5: day 9
--   cart     abandoned carts/checkouts   1: 1h,  2: 24h,  3: 48h,  4: 72h,  5: 5 days
--
-- Every email after the first goes only if the person still hasn't purchased.
--
-- Tables:
--   email_flow_settings      one row per flow — on/off, send window, re-entry, footer.
--   email_flow_steps         the five emails of each flow — timing and content.
--   email_flow_entries       one row per person per pass through a flow.
--   email_flow_sends         one row per email sent — opens, clicks, failures.
--   email_flow_suppressions  everyone who unsubscribed, by email — covers guests too.
--   saved_carts              the storefront cart, mirrored server-side, so a cart
--                            email can show what's in it and "Return to cart"
--                            restores it on any device.
--
-- Idempotent: safe to re-run.
-- Run this in the Supabase SQL editor, then supabase-cron-email-flows.sql.

-- ------------------------------------------------------------
-- 1. Settings — one row per flow
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_flow_settings (
  flow                TEXT PRIMARY KEY CHECK (flow IN ('welcome', 'cart')),
  enabled             BOOLEAN NOT NULL DEFAULT false,
  -- When it was last switched on. Nothing from before this is enrolled, so
  -- switching a flow on never emails the back catalogue.
  enabled_at          TIMESTAMPTZ,
  -- Emails 2-5 go out between these local hours (24h clock, end exclusive).
  -- Email 1 is never held for the window.
  send_window_start   SMALLINT NOT NULL DEFAULT 9  CHECK (send_window_start BETWEEN 0 AND 23),
  send_window_end     SMALLINT NOT NULL DEFAULT 11 CHECK (send_window_end BETWEEN 1 AND 24),
  default_timezone    TEXT NOT NULL DEFAULT 'America/Toronto',
  -- Never two flow emails (of ANY flow) to one person closer than this.
  min_gap_hours       INTEGER NOT NULL DEFAULT 20 CHECK (min_gap_hours BETWEEN 0 AND 168),
  -- Cart flow: a new abandonment restarts the series only this long after the
  -- last one began.
  reentry_days        INTEGER NOT NULL DEFAULT 30 CHECK (reentry_days BETWEEN 0 AND 365),
  -- CASL: every commercial email names the sender and a mailing address.
  footer_address      TEXT NOT NULL DEFAULT '',
  footer_disclaimer   TEXT NOT NULL DEFAULT 'For research use only. Not for human consumption.',
  updated_by_email    TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO email_flow_settings (flow, min_gap_hours) VALUES ('welcome', 20), ('cart', 12)
ON CONFLICT (flow) DO NOTHING;

-- ------------------------------------------------------------
-- 2. Steps — the five emails of each flow
-- ------------------------------------------------------------
-- Seeded by the app on first load from lib/email-flows/defaults.ts, so the
-- default copy is stated once.
CREATE TABLE IF NOT EXISTS email_flow_steps (
  flow              TEXT NOT NULL CHECK (flow IN ('welcome', 'cart')),
  step              SMALLINT NOT NULL CHECK (step BETWEEN 1 AND 5),
  enabled           BOOLEAN NOT NULL DEFAULT true,
  -- Hours after the trigger (signup, or the cart's last change).
  delay_hours       INTEGER NOT NULL DEFAULT 0 CHECK (delay_hours BETWEEN 0 AND 2160),
  -- Per-recipient deadline, this many hours after the email is sent
  -- ({{offer_ends}} and the countdown). NULL = no deadline.
  deadline_hours    INTEGER CHECK (deadline_hours IS NULL OR deadline_hours BETWEEN 1 AND 336),
  -- Cart flow: show the cart's contents, under this heading and text.
  show_cart         BOOLEAN NOT NULL DEFAULT false,
  cart_title        TEXT NOT NULL DEFAULT '',
  cart_body         TEXT NOT NULL DEFAULT '',
  subject           TEXT NOT NULL DEFAULT '',
  preheader         TEXT NOT NULL DEFAULT '',
  eyebrow           TEXT NOT NULL DEFAULT '',
  headline          TEXT NOT NULL DEFAULT '',
  subheadline       TEXT NOT NULL DEFAULT '',
  body              TEXT NOT NULL DEFAULT '',
  highlights        JSONB NOT NULL DEFAULT '[]'::jsonb,
  cta_label         TEXT NOT NULL DEFAULT '',
  cta_url           TEXT NOT NULL DEFAULT '',
  hero_image_url    TEXT NOT NULL DEFAULT '',
  card_title        TEXT NOT NULL DEFAULT '',
  card_body         TEXT NOT NULL DEFAULT '',
  card_link_label   TEXT NOT NULL DEFAULT '',
  card_link_url     TEXT NOT NULL DEFAULT '',
  card_image_url    TEXT NOT NULL DEFAULT '',
  -- A code from discount_codes. {{discount}} prints its real value at send time.
  promo_code        TEXT,
  fine_print        TEXT NOT NULL DEFAULT '',
  updated_by_email  TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (flow, step)
);

-- ------------------------------------------------------------
-- 3. Saved carts — the storefront cart, mirrored server-side
-- ------------------------------------------------------------
-- Written by POST /api/cart/sync whenever the cart changes: for a signed-in
-- customer, or for a guest who accepted the cookie banner (the same rule as
-- the rest of the storefront tracking). A guest's email arrives when they
-- start checkout or sign in (visitor_attribution links it).
CREATE TABLE IF NOT EXISTS saved_carts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Unguessable token behind /cart?restore=… links. Restores product lines
  -- only — never anything about the person.
  restore_token   TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
  anonymous_id    TEXT,
  email           TEXT,
  -- [{ productId, packSize, quantity }] — product lines only; names and prices
  -- are always read from `products`, never trusted from the browser.
  items           JSONB NOT NULL DEFAULT '[]'::jsonb,
  item_count      INTEGER NOT NULL DEFAULT 0,
  -- open       has items
  -- emptied    the shopper removed everything
  -- purchased  a paid order followed
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'emptied', 'purchased')),
  -- Set for a cart rebuilt from an unpaid Stealth Health checkout.
  checkout_ref    TEXT UNIQUE,
  -- When the CONTENTS last changed — the abandonment clock. Re-syncing an
  -- unchanged cart does not move it.
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_carts_customer ON saved_carts (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_saved_carts_anon ON saved_carts (anonymous_id) WHERE anonymous_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_saved_carts_open ON saved_carts (status, updated_at) WHERE status = 'open';

-- ------------------------------------------------------------
-- 4. Entries — one per person per pass through a flow
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_flow_entries (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow                 TEXT NOT NULL CHECK (flow IN ('welcome', 'cart')),
  customer_id          UUID REFERENCES customers(id) ON DELETE SET NULL,
  email                TEXT NOT NULL,
  first_name           TEXT,
  timezone             TEXT NOT NULL DEFAULT 'America/Toronto',
  -- active | converted | completed | unsubscribed | exited
  status               TEXT NOT NULL DEFAULT 'active',
  -- welcome: 'signup' | 'manual'.  cart: 'cart' | 'checkout' | 'manual'.
  source               TEXT NOT NULL DEFAULT 'signup',
  -- Why we may email them: 'express' (ticked the marketing box), 'implied'
  -- (started a checkout in the last 6 months — CASL inquiry), 'manual'
  -- (an admin attested consent).
  consent_basis        TEXT NOT NULL DEFAULT 'express',
  tags                 TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- The trigger time: signup, or the cart's last change. Delays count from here.
  enrolled_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  cart_id              UUID REFERENCES saved_carts(id) ON DELETE SET NULL,
  last_step            SMALLINT NOT NULL DEFAULT 0,
  last_sent_at         TIMESTAMPTZ,
  -- Welcome only: emails held while this person is in an active cart flow.
  paused_reason        TEXT,
  converted_at         TIMESTAMPTZ,
  converted_order_ref  TEXT,
  converted_amount     NUMERIC(12,2),
  converted_currency   TEXT,
  attributed_step      SMALLINT,
  exit_reason          TEXT,
  exited_at            TIMESTAMPTZ,
  unsubscribed_at      TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE email_flow_entries DROP CONSTRAINT IF EXISTS email_flow_entries_status_chk;
ALTER TABLE email_flow_entries
  ADD CONSTRAINT email_flow_entries_status_chk
  CHECK (status IN ('active', 'converted', 'completed', 'unsubscribed', 'exited'));

-- The welcome series is once per account, ever.
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_flow_entries_welcome_customer
  ON email_flow_entries (customer_id) WHERE flow = 'welcome' AND customer_id IS NOT NULL;
-- At most one live pass per person per flow — also what stops two overlapping
-- cron runs enrolling the same abandoned cart twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_flow_entries_active_email
  ON email_flow_entries (flow, lower(email)) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_email_flow_entries_flow_status
  ON email_flow_entries (flow, status, enrolled_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_flow_entries_email
  ON email_flow_entries (lower(email), enrolled_at DESC);

-- ------------------------------------------------------------
-- 5. Sends — one per email per entry
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_flow_sends (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id        UUID NOT NULL REFERENCES email_flow_entries(id) ON DELETE CASCADE,
  flow            TEXT NOT NULL,
  step            SMALLINT NOT NULL CHECK (step BETWEEN 1 AND 5),
  -- sending | sent | failed (retried up to 3 attempts) | skipped
  status          TEXT NOT NULL DEFAULT 'sending',
  attempts        INTEGER NOT NULL DEFAULT 0,
  to_email        TEXT NOT NULL,
  subject         TEXT,
  promo_code      TEXT,
  offer_ends_at   TIMESTAMPTZ,
  message_id      TEXT,
  error           TEXT,
  sent_at         TIMESTAMPTZ,
  opened_at       TIMESTAMPTZ,
  open_count      INTEGER NOT NULL DEFAULT 0,
  clicked_at      TIMESTAMPTZ,
  click_count     INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Claimed BEFORE the SMTP call: two overlapping runs both try to insert, one
  -- loses here, and nobody gets an email twice.
  UNIQUE (entry_id, step)
);

ALTER TABLE email_flow_sends DROP CONSTRAINT IF EXISTS email_flow_sends_status_chk;
ALTER TABLE email_flow_sends
  ADD CONSTRAINT email_flow_sends_status_chk
  CHECK (status IN ('sending', 'sent', 'failed', 'skipped'));

CREATE INDEX IF NOT EXISTS idx_email_flow_sends_flow_step ON email_flow_sends (flow, step, status);
CREATE INDEX IF NOT EXISTS idx_email_flow_sends_recent ON email_flow_sends (lower(to_email), sent_at DESC) WHERE status = 'sent';

-- ------------------------------------------------------------
-- 6. Suppressions — unsubscribed, by email, across every flow
-- ------------------------------------------------------------
-- Guests have no customers row to clear contact_consent on, so the
-- unsubscribe is recorded here and every flow checks it before enrolling and
-- before every send.
CREATE TABLE IF NOT EXISTS email_flow_suppressions (
  email        TEXT PRIMARY KEY,
  reason       TEXT NOT NULL DEFAULT 'unsubscribed',
  source_flow  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 7. Lock it down — service role only
-- ------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['email_flow_settings', 'email_flow_steps', 'email_flow_entries',
                           'email_flow_sends', 'email_flow_suppressions', 'saved_carts']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_service_only', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO public USING (false) WITH CHECK (false)', t || '_service_only', t);
  END LOOP;
END $$;

-- Open/click counters bump atomically, so two pixel loads at once both count.
CREATE OR REPLACE FUNCTION email_flow_track(p_send_id UUID, p_kind TEXT)
RETURNS VOID AS $$
BEGIN
  IF p_kind = 'open' THEN
    UPDATE email_flow_sends
       SET open_count = open_count + 1,
           opened_at  = COALESCE(opened_at, now()),
           updated_at = now()
     WHERE id = p_send_id;
  ELSIF p_kind = 'click' THEN
    -- A click proves an open, even when the client blocked the pixel.
    UPDATE email_flow_sends
       SET click_count = click_count + 1,
           clicked_at  = COALESCE(clicked_at, now()),
           opened_at   = COALESCE(opened_at, now()),
           open_count  = GREATEST(open_count, 1),
           updated_at  = now()
     WHERE id = p_send_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION email_flow_track(UUID, TEXT) FROM public, anon, authenticated;

-- ------------------------------------------------------------
-- 8. Carry over an earlier welcome-only install (welcome_flow_* tables), if
--    welcome-flow-migration.sql from the first draft was ever run.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.welcome_flow_settings') IS NOT NULL THEN
    UPDATE email_flow_settings s SET
      enabled = o.enabled, enabled_at = o.enabled_at,
      send_window_start = o.send_window_start, send_window_end = o.send_window_end,
      default_timezone = o.default_timezone, min_gap_hours = o.min_gap_hours,
      footer_address = o.footer_address, footer_disclaimer = o.footer_disclaimer
    FROM welcome_flow_settings o WHERE s.flow = 'welcome' AND o.id = 1;
  END IF;

  IF to_regclass('public.welcome_flow_subscribers') IS NOT NULL THEN
    INSERT INTO email_flow_entries (id, flow, customer_id, email, first_name, timezone, status, source,
      consent_basis, tags, enrolled_at, last_step, last_sent_at, converted_at, converted_order_ref,
      converted_amount, converted_currency, attributed_step, exit_reason, exited_at, unsubscribed_at,
      created_at, updated_at)
    SELECT id, 'welcome', customer_id, email, first_name, timezone, status, source,
      CASE WHEN source = 'manual' THEN 'manual' ELSE 'express' END, tags, enrolled_at, last_step,
      last_sent_at, converted_at, converted_order_ref, converted_amount, converted_currency,
      attributed_step, exit_reason, exited_at, unsubscribed_at, created_at, updated_at
    FROM welcome_flow_subscribers
    ON CONFLICT DO NOTHING;

    INSERT INTO email_flow_suppressions (email, reason, source_flow)
    SELECT lower(email), 'unsubscribed', 'welcome' FROM welcome_flow_subscribers WHERE status = 'unsubscribed'
    ON CONFLICT DO NOTHING;
  END IF;

  IF to_regclass('public.welcome_flow_sends') IS NOT NULL THEN
    INSERT INTO email_flow_sends (id, entry_id, flow, step, status, attempts, to_email, subject, promo_code,
      offer_ends_at, message_id, error, sent_at, opened_at, open_count, clicked_at, click_count, created_at, updated_at)
    SELECT s.id, s.subscriber_id, 'welcome', s.step, s.status, s.attempts, s.to_email, s.subject, s.promo_code,
      s.offer_ends_at, s.message_id, s.error, s.sent_at, s.opened_at, s.open_count, s.clicked_at, s.click_count,
      s.created_at, s.updated_at
    FROM welcome_flow_sends s
    WHERE EXISTS (SELECT 1 FROM email_flow_entries e WHERE e.id = s.subscriber_id)
    ON CONFLICT DO NOTHING;
  END IF;
  -- The welcome_flow_* tables are left in place; once you have checked the
  -- carry-over they can be dropped.
END $$;

NOTIFY pgrst, 'reload schema';

-- Verification:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_name LIKE 'email_flow%' OR table_name = 'saved_carts';
