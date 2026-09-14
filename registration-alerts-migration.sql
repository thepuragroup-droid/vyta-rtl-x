-- ============================================================
-- REGISTRATION ALERTS + CUSTOMER CLAIMING + ACTIVITY TRACKING
-- ============================================================
--
-- Powers three related features:
--
--   1. An admin email alert fired the moment a customer registers.
--   2. A follow-up "abandoned registration" alert fired by cron when a
--      registered customer has not checked out after a configurable delay
--      (default 12 hours).
--   3. An admin "customer insights" page (linked from those emails) showing
--      what the customer searched for, viewed, and added to cart, plus a
--      "claim" workflow so one admin can mark that they'll be the point of
--      contact for that customer.
--
-- All additions are written additively / idempotently so this migration is
-- safe to run in any order and more than once.

-- ------------------------------------------------------------
-- 1. customers: consent, claim ownership, alert de-dup stamps
-- ------------------------------------------------------------
ALTER TABLE customers
  -- Customer ticked the "you may contact me" box at registration.
  ADD COLUMN IF NOT EXISTS contact_consent BOOLEAN NOT NULL DEFAULT false,
  -- Which admin has claimed this customer (point of contact). NULL = unclaimed.
  ADD COLUMN IF NOT EXISTS claimed_by_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_by_email TEXT,
  ADD COLUMN IF NOT EXISTS claimed_by_name TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  -- De-dup stamps so each alert email is only ever sent once per customer.
  ADD COLUMN IF NOT EXISTS registration_alert_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS abandoned_alert_sent_at TIMESTAMPTZ;

-- ------------------------------------------------------------
-- 2. site_settings: registration-alert configuration
-- ------------------------------------------------------------
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS registration_alert_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS abandoned_registration_enabled BOOLEAN NOT NULL DEFAULT true,
  -- Hours a customer may go without checking out before the abandoned-
  -- registration alert fires. Default 12h.
  ADD COLUMN IF NOT EXISTS abandoned_registration_hours INTEGER NOT NULL DEFAULT 12;

-- Guard against silly values (must be at least 1 hour).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'site_settings_abandoned_hours_chk'
  ) THEN
    ALTER TABLE site_settings
      ADD CONSTRAINT site_settings_abandoned_hours_chk
      CHECK (abandoned_registration_hours >= 1);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. customer_activity: search / view / cart event log
-- ------------------------------------------------------------
--
-- One row per tracked interaction from a logged-in customer. Anonymous
-- traffic is not recorded (the feature is scoped to registered customers).
--
--   activity_type = 'search' -> search_query holds the term
--   activity_type = 'view'   -> product_id / product_name hold the product
--   activity_type = 'cart'   -> product_id / product_name / quantity hold the
--                               item added to cart
CREATE TABLE IF NOT EXISTS customer_activity (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('search', 'view', 'cart')),
  search_query  TEXT,
  product_id    UUID,
  product_name  TEXT,
  quantity      INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_activity_customer
  ON customer_activity (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_activity_type
  ON customer_activity (customer_id, activity_type, created_at DESC);

-- Service-role only, mirroring product_history / audit_logs. All reads and
-- writes happen through API routes that use the service-role client.
ALTER TABLE customer_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer_activity_service_only" ON customer_activity;
CREATE POLICY "customer_activity_service_only" ON customer_activity
  FOR ALL TO public USING (false) WITH CHECK (false);
