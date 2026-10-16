-- ============================================================
-- EMAIL FLOWS — post-send tracking (is a flow earning its keep?)
-- ============================================================
--
-- The flow tables already count opens and clicks per send and mark an entry
-- converted when the person buys. This adds what those counters can't say:
--
--   email_flow_events        one row per open, click, checkout and purchase
--                            that follows a flow email — with whether the hit
--                            looked like a person or a mail scanner, and where
--                            the click went. Read by Admin → Analytics
--                            (Organic & referral → Email flows) and the
--                            Email Flows overview.
--
--   email_flow_entries.converted_via
--                            'click'        the buyer clicked a flow email
--                                           before paying (or paid through the
--                                           checkout that click opened)
--                            'email_match'  they bought while in the flow but
--                                           never clicked — influenced at most
--                            NULL           converted before this migration
--
-- From this migration on, a click is only counted on email_flow_sends when it
-- looks like a person: mail security gateways that follow every link on
-- delivery are logged here with machine = true instead.
--
-- Optional: until it runs, flows send and convert exactly as before and the
-- analytics panel says it is not recording yet.
-- Run after email-flows-migration.sql. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS email_flow_events (
  id              BIGSERIAL PRIMARY KEY,
  -- NULL only for a checkout/purchase whose send has since been deleted.
  send_id         UUID REFERENCES email_flow_sends(id) ON DELETE SET NULL,
  entry_id        UUID REFERENCES email_flow_entries(id) ON DELETE SET NULL,
  flow            TEXT NOT NULL,
  step            SMALLINT,
  -- open | click | checkout | purchase
  kind            TEXT NOT NULL,
  -- Click: the path the link pointed at (never the query — a cart link's
  -- query is its restore token) and what kind of page that is.
  target_path     TEXT,
  link_kind       TEXT,
  -- Open/click: a mail scanner, link checker or privacy prefetch rather than
  -- a person. See lib/email-flows/engagement.ts.
  machine         BOOLEAN NOT NULL DEFAULT false,
  machine_reason  TEXT,
  -- The storefront visitor id, when the click came from a browser that had one.
  anonymous_id    TEXT,
  -- Checkout/purchase: the order, in the engine's own ref format
  -- ('puramass:<partner_reference>' or 'order:<order_number>').
  order_ref       TEXT,
  amount          NUMERIC(12,2),
  currency        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE email_flow_events DROP CONSTRAINT IF EXISTS email_flow_events_kind_chk;
ALTER TABLE email_flow_events
  ADD CONSTRAINT email_flow_events_kind_chk
  CHECK (kind IN ('open', 'click', 'checkout', 'purchase'));

CREATE INDEX IF NOT EXISTS idx_email_flow_events_flow_time ON email_flow_events (flow, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_flow_events_send ON email_flow_events (send_id);
CREATE INDEX IF NOT EXISTS idx_email_flow_events_order ON email_flow_events (order_ref) WHERE order_ref IS NOT NULL;
-- One purchase event per entry and order, so a re-run of the engine can't log a sale twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_flow_events_purchase
  ON email_flow_events (entry_id, order_ref) WHERE kind = 'purchase';

ALTER TABLE email_flow_entries ADD COLUMN IF NOT EXISTS converted_via TEXT;
ALTER TABLE email_flow_entries DROP CONSTRAINT IF EXISTS email_flow_entries_converted_via_chk;
ALTER TABLE email_flow_entries
  ADD CONSTRAINT email_flow_entries_converted_via_chk
  CHECK (converted_via IS NULL OR converted_via IN ('click', 'email_match'));

-- Service role only, like the rest of the flow tables.
ALTER TABLE email_flow_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_flow_events_service_only ON email_flow_events;
CREATE POLICY email_flow_events_service_only ON email_flow_events
  FOR ALL TO public USING (false) WITH CHECK (false);

NOTIFY pgrst, 'reload schema';

-- Verification:
--   SELECT kind, machine, count(*) FROM email_flow_events GROUP BY 1, 2 ORDER BY 1, 2;
--   SELECT flow, converted_via, count(*) FROM email_flow_entries WHERE status = 'converted' GROUP BY 1, 2;
