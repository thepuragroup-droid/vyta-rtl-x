-- ============================================================
-- PuraMass (Stealth Health) — webhook delivery log
-- ============================================================
--
-- Every POST to /api/webhooks/stealth-health is recorded here, exactly as
-- received, together with what we answered. One row per delivery (retries of
-- the same event_id get their own row), including deliveries that failed the
-- signature check, did not parse, or matched no order — so a payment that
-- "never showed up" can always be traced back to what PuraMass actually sent.
--
-- Example payload (store_order.payment_complete):
--   { "event_id": "evt_…", "event_type": "store_order.payment_complete",
--     "referral_id": null, "partner_reference": "amc_…",
--     "data": { "status": "paid", "occurred_at": "…", "transaction_id": "…",
--               "order_id": "…", "payment_mode": "customer", "currency": "cad",
--               "customer": { "first_name", "last_name", "email", "phone" },
--               "shipping": { "address", "address2", "city", "state", "zip", "country" } | null,
--               "items": [{ "sku", "name", "quantity", "unit_price_cents" }] },
--     "metadata": {}, "created_at": "…", "patient_id": null, "appointment_id": null }
--
-- The full body is kept in `payload` (JSONB) — the other columns are copies of
-- the fields worth filtering on.
--
-- Idempotent: safe to re-run.
-- Run this in the Supabase SQL editor (same as every other *-migration.sql).

CREATE TABLE IF NOT EXISTS puramass_webhook_events (
  id                 BIGSERIAL PRIMARY KEY,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Copied out of the payload for filtering (NULL when absent/unparseable).
  event_id           TEXT,
  event_type         TEXT,
  partner_reference  TEXT,
  transaction_id     TEXT,
  status             TEXT,
  currency           TEXT,
  customer_email     TEXT,
  occurred_at        TIMESTAMPTZ,

  -- What arrived.
  signature_valid    BOOLEAN NOT NULL DEFAULT false,
  payload            JSONB,          -- parsed body; NULL if it did not parse
  raw_body           TEXT,           -- only kept when the body did not parse as JSON

  -- What we did with it.
  puramass_order_id  UUID REFERENCES puramass_orders(id) ON DELETE SET NULL,
  outcome            TEXT,           -- matched | unmatched | deduped | bad_signature | not_configured | unparseable | update_failed | error
  response_status    INTEGER,
  response_body      JSONB,
  error              TEXT
);

CREATE INDEX IF NOT EXISTS idx_puramass_webhook_events_received
  ON puramass_webhook_events (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_puramass_webhook_events_event
  ON puramass_webhook_events (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_webhook_events_partner_ref
  ON puramass_webhook_events (partner_reference) WHERE partner_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_webhook_events_transaction
  ON puramass_webhook_events (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_webhook_events_order
  ON puramass_webhook_events (puramass_order_id) WHERE puramass_order_id IS NOT NULL;

-- RLS: server-side only. The payloads carry customer names, emails and
-- addresses, so no anon/authenticated access at all — the service role
-- bypasses RLS, and with no policy nobody else can read or write.
ALTER TABLE puramass_webhook_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE puramass_webhook_events IS
  'One row per delivery to /api/webhooks/stealth-health: the payload PuraMass sent, whether its signature checked out, and the response we returned.';

NOTIFY pgrst, 'reload schema';

-- Verification / handy queries:
-- SELECT received_at, event_type, status, partner_reference, customer_email, outcome, response_status
--   FROM puramass_webhook_events ORDER BY received_at DESC LIMIT 50;
-- SELECT payload FROM puramass_webhook_events WHERE partner_reference = 'amc_…' ORDER BY received_at;
