-- ============================================================
-- WELCOME EMAIL FLOW
-- ============================================================
--
-- A 5-email welcome series for new subscribers, sent from our own SMTP server
-- and managed at /admin/welcome-flow:
--
--   Email 1  Welcome     immediately after signup
--   Email 2  Education   day 2   (only if no purchase yet)
--   Email 3  Trust       day 4   (only if no purchase yet)
--   Email 4  Offer       day 6   (only if no purchase yet)
--   Email 5  Reminder    day 9   (only if no purchase yet)
--
-- Who enters: new 'customer' accounts that ticked the marketing-consent box
-- (customers.contact_consent), created after the flow was switched on. CASL
-- needs express consent for promotional email; nobody else is ever enrolled.
--
-- Four tables:
--   welcome_flow_settings    one row — on/off, send window, offer length, footer.
--   welcome_flow_steps       the 5 emails — timing and editable content.
--   welcome_flow_subscribers one row per person in the flow — the tracking record.
--   welcome_flow_sends       one row per email sent — opens, clicks, failures.
--
-- Idempotent: safe to re-run.
-- Run this in the Supabase SQL editor (same as every other *-migration.sql),
-- then run supabase-cron-welcome-flow.sql to schedule the sender.

-- ------------------------------------------------------------
-- 1. Settings — a single row (id is always 1)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS welcome_flow_settings (
  id                  SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled             BOOLEAN NOT NULL DEFAULT false,
  -- When it was last switched on. Only signups at or after this are enrolled
  -- automatically, so switching it on never emails the whole back catalogue.
  enabled_at          TIMESTAMPTZ,
  -- Emails 2-5 go out between these local hours (24h clock, end exclusive).
  -- Email 1 is sent immediately, whatever the hour.
  send_window_start   SMALLINT NOT NULL DEFAULT 9  CHECK (send_window_start BETWEEN 0 AND 23),
  send_window_end     SMALLINT NOT NULL DEFAULT 11 CHECK (send_window_end BETWEEN 1 AND 24),
  -- Used when a subscriber's province/state does not tell us their time zone.
  default_timezone    TEXT NOT NULL DEFAULT 'America/Toronto',
  -- The countdown in the reminder email: hours from its send to its deadline.
  final_offer_hours   INTEGER NOT NULL DEFAULT 24 CHECK (final_offer_hours BETWEEN 1 AND 336),
  -- Never two flow emails to one person closer together than this.
  min_gap_hours       INTEGER NOT NULL DEFAULT 20 CHECK (min_gap_hours BETWEEN 0 AND 168),
  -- CASL: every commercial email names the sender and a mailing address.
  footer_address      TEXT NOT NULL DEFAULT '',
  footer_disclaimer   TEXT NOT NULL DEFAULT 'For research use only. Not for human consumption.',
  updated_by_email    TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO welcome_flow_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 2. Steps — the five emails
-- ------------------------------------------------------------
-- Rows are seeded by the app the first time /admin/welcome-flow loads (the
-- default copy lives in lib/welcome-flow/types.ts), so the copy is stated once.
CREATE TABLE IF NOT EXISTS welcome_flow_steps (
  step              SMALLINT PRIMARY KEY CHECK (step BETWEEN 1 AND 5),
  enabled           BOOLEAN NOT NULL DEFAULT true,
  -- Days after enrolment the email becomes due. 0 = immediately.
  delay_days        INTEGER NOT NULL DEFAULT 0 CHECK (delay_days BETWEEN 0 AND 90),
  subject           TEXT NOT NULL DEFAULT '',
  preheader         TEXT NOT NULL DEFAULT '',
  eyebrow           TEXT NOT NULL DEFAULT '',
  headline          TEXT NOT NULL DEFAULT '',
  subheadline       TEXT NOT NULL DEFAULT '',
  body              TEXT NOT NULL DEFAULT '',
  -- Badge / benefit labels — one per line in the editor.
  highlights        JSONB NOT NULL DEFAULT '[]'::jsonb,
  cta_label         TEXT NOT NULL DEFAULT '',
  cta_url           TEXT NOT NULL DEFAULT '',
  hero_image_url    TEXT NOT NULL DEFAULT '',
  card_title        TEXT NOT NULL DEFAULT '',
  card_body         TEXT NOT NULL DEFAULT '',
  card_link_label   TEXT NOT NULL DEFAULT '',
  card_link_url     TEXT NOT NULL DEFAULT '',
  card_image_url    TEXT NOT NULL DEFAULT '',
  -- A code from discount_codes. The email states that code's real discount,
  -- read at send time, so the copy can't promise 20% on a 15% code.
  promo_code        TEXT,
  fine_print        TEXT NOT NULL DEFAULT '',
  updated_by_email  TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 3. Subscribers — one per person in the flow
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS welcome_flow_subscribers (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id          UUID UNIQUE REFERENCES customers(id) ON DELETE SET NULL,
  email                TEXT NOT NULL,
  first_name           TEXT,
  -- IANA zone the send window is read in (e.g. America/Vancouver).
  timezone             TEXT NOT NULL DEFAULT 'America/Toronto',
  -- active       moving through the emails
  -- converted    purchased — flow stopped
  -- completed    received every email without purchasing
  -- unsubscribed clicked unsubscribe
  -- exited       removed by an admin, or consent / account withdrawn
  status               TEXT NOT NULL DEFAULT 'active',
  -- 'signup' (automatic) or 'manual' (added by an admin).
  source               TEXT NOT NULL DEFAULT 'signup',
  -- Segmentation tags. Every row carries 'Welcome Flow'.
  tags                 TEXT[] NOT NULL DEFAULT ARRAY['Welcome Flow']::TEXT[],
  enrolled_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Highest step that has been sent (or skipped). 0 = nothing yet.
  last_step            SMALLINT NOT NULL DEFAULT 0,
  last_sent_at         TIMESTAMPTZ,
  converted_at         TIMESTAMPTZ,
  -- The purchase that stopped the flow: 'order:<id>' or 'puramass:<ref>'.
  converted_order_ref  TEXT,
  converted_amount     NUMERIC(12,2),
  converted_currency   TEXT,
  -- The last flow email sent before the purchase — what gets the credit.
  attributed_step      SMALLINT,
  exit_reason          TEXT,
  exited_at            TIMESTAMPTZ,
  unsubscribed_at      TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE welcome_flow_subscribers DROP CONSTRAINT IF EXISTS welcome_flow_subscribers_status_chk;
ALTER TABLE welcome_flow_subscribers
  ADD CONSTRAINT welcome_flow_subscribers_status_chk
  CHECK (status IN ('active', 'converted', 'completed', 'unsubscribed', 'exited'));

CREATE INDEX IF NOT EXISTS idx_welcome_flow_subscribers_status
  ON welcome_flow_subscribers (status, enrolled_at DESC);
CREATE INDEX IF NOT EXISTS idx_welcome_flow_subscribers_email
  ON welcome_flow_subscribers (lower(email));

-- ------------------------------------------------------------
-- 4. Sends — one per email per subscriber
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS welcome_flow_sends (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id   UUID NOT NULL REFERENCES welcome_flow_subscribers(id) ON DELETE CASCADE,
  step            SMALLINT NOT NULL CHECK (step BETWEEN 1 AND 5),
  -- sending  claimed by a run, SMTP not answered yet
  -- sent     accepted by the mail server
  -- failed   rejected — retried by later runs up to 3 attempts
  -- skipped  not sent (step switched off, or its code unusable) — flow moved on
  status          TEXT NOT NULL DEFAULT 'sending',
  attempts        INTEGER NOT NULL DEFAULT 0,
  to_email        TEXT NOT NULL,
  subject         TEXT,
  promo_code      TEXT,
  -- Email 5's per-recipient deadline.
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
  -- At most one row per email per person: two overlapping cron runs both try
  -- to insert, one loses on this constraint, and nobody gets an email twice.
  UNIQUE (subscriber_id, step)
);

ALTER TABLE welcome_flow_sends DROP CONSTRAINT IF EXISTS welcome_flow_sends_status_chk;
ALTER TABLE welcome_flow_sends
  ADD CONSTRAINT welcome_flow_sends_status_chk
  CHECK (status IN ('sending', 'sent', 'failed', 'skipped'));

CREATE INDEX IF NOT EXISTS idx_welcome_flow_sends_step
  ON welcome_flow_sends (step, status);

-- ------------------------------------------------------------
-- 5. Lock it down — every read and write goes through an admin route or the
--    cron, both using the service role.
-- ------------------------------------------------------------
ALTER TABLE welcome_flow_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE welcome_flow_steps       ENABLE ROW LEVEL SECURITY;
ALTER TABLE welcome_flow_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE welcome_flow_sends       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "welcome_flow_settings_service_only" ON welcome_flow_settings;
CREATE POLICY "welcome_flow_settings_service_only" ON welcome_flow_settings
  FOR ALL TO public USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "welcome_flow_steps_service_only" ON welcome_flow_steps;
CREATE POLICY "welcome_flow_steps_service_only" ON welcome_flow_steps
  FOR ALL TO public USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "welcome_flow_subscribers_service_only" ON welcome_flow_subscribers;
CREATE POLICY "welcome_flow_subscribers_service_only" ON welcome_flow_subscribers
  FOR ALL TO public USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "welcome_flow_sends_service_only" ON welcome_flow_sends;
CREATE POLICY "welcome_flow_sends_service_only" ON welcome_flow_sends
  FOR ALL TO public USING (false) WITH CHECK (false);

-- Open/click counters bump atomically, so two pixel loads at once both count.
CREATE OR REPLACE FUNCTION welcome_flow_track(p_send_id UUID, p_kind TEXT)
RETURNS VOID AS $$
BEGIN
  IF p_kind = 'open' THEN
    UPDATE welcome_flow_sends
       SET open_count = open_count + 1,
           opened_at  = COALESCE(opened_at, now()),
           updated_at = now()
     WHERE id = p_send_id;
  ELSIF p_kind = 'click' THEN
    -- A click proves an open, even when the client blocked the pixel.
    UPDATE welcome_flow_sends
       SET click_count = click_count + 1,
           clicked_at  = COALESCE(clicked_at, now()),
           opened_at   = COALESCE(opened_at, now()),
           open_count  = GREATEST(open_count, 1),
           updated_at  = now()
     WHERE id = p_send_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION welcome_flow_track(UUID, TEXT) FROM public, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- Verification: four tables should come back.
-- SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'welcome_flow%';
