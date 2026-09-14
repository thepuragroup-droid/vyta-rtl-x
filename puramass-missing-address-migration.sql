-- ============================================================
-- PuraMass — "we didn't catch your shipping address" request flow
-- ============================================================
--
-- Some PuraMass (Stealth Health) hand-offs come back with no shipping address:
-- `puramass_orders.shipping_address` stays NULL and the admin PuraMass Orders
-- page shows "No address yet" even after a sync. Those orders can't be packed.
--
-- This migration adds the plumbing for asking the customer directly:
--
--   1. puramass_address_requests — one row per "please send us your address"
--      email. The emailed link carries a random token; only its SHA-256 hash is
--      stored, so a leaked table row can't be replayed as a valid link.
--   2. puramass_orders.shipping_address_source / _updated_at — provenance, so
--      the admin UI (and the PuraMass poller) can tell an address the customer
--      typed from one PuraMass reported.
--   3. puramass_orders.address_requested_at — when we last emailed the ask, so
--      the admin page can show "requested 2h ago" instead of re-sending blind.
--
-- Idempotent: safe to re-run.
-- Run this in the Supabase SQL editor (same as every other *-migration.sql).

-- 1. Provenance + last-asked columns on the ledger ------------------------
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS shipping_address_source     TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS address_requested_at        TIMESTAMPTZ;

COMMENT ON COLUMN puramass_orders.shipping_address_source IS
  'Where shipping_address came from: ''puramass'' (reported by the partner) or ''customer'' (typed into /shipping-address/<token>). NULL for rows written before this column existed.';
COMMENT ON COLUMN puramass_orders.shipping_address_updated_at IS
  'When shipping_address was last written, by either source.';
COMMENT ON COLUMN puramass_orders.address_requested_at IS
  'When the "we didn''t catch your address" email was last sent to the customer.';

-- Existing addresses all came from PuraMass — label them so the UI does not
-- mis-attribute them to the customer. Guarded, so re-running is a no-op.
UPDATE puramass_orders
SET shipping_address_source = 'puramass'
WHERE shipping_address IS NOT NULL
  AND shipping_address_source IS NULL;

-- 2. The address-request ledger -------------------------------------------
CREATE TABLE IF NOT EXISTS puramass_address_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  puramass_order_id UUID NOT NULL REFERENCES puramass_orders(id) ON DELETE CASCADE,
  -- SHA-256 (hex) of the token in the emailed link. The raw token is never
  -- stored; lookup hashes the incoming token and matches on this column.
  token_hash        TEXT NOT NULL UNIQUE,
  -- Address we emailed, captured at send time so a later ledger edit can't
  -- silently repoint an outstanding link.
  email             TEXT NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  -- Send bookkeeping. sent_count > 1 means the admin re-sent the same link.
  sent_at           TIMESTAMPTZ,
  sent_count        INTEGER NOT NULL DEFAULT 0,
  sent_by           UUID,
  sent_by_email     TEXT,
  -- Submission bookkeeping. submitted_address is kept verbatim next to the
  -- copy written onto the order, as an audit trail of what the customer typed.
  submitted_at      TIMESTAMPTZ,
  submitted_ip      TEXT,
  submitted_address JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_puramass_address_requests_order
  ON puramass_address_requests (puramass_order_id);
CREATE INDEX IF NOT EXISTS idx_puramass_address_requests_open
  ON puramass_address_requests (expires_at) WHERE submitted_at IS NULL;

-- updated_at trigger (mirrors puramass_orders) ----------------------------
CREATE OR REPLACE FUNCTION update_puramass_address_requests_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS puramass_address_requests_updated_at ON puramass_address_requests;
CREATE TRIGGER puramass_address_requests_updated_at
  BEFORE UPDATE ON puramass_address_requests
  FOR EACH ROW EXECUTE FUNCTION update_puramass_address_requests_updated_at();

-- RLS: service-role only. The public page reads and writes through server
-- routes that hold the token, never from the browser's anon client.
ALTER TABLE puramass_address_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON puramass_address_requests;
CREATE POLICY "Service role full access" ON puramass_address_requests
  FOR ALL USING (true) WITH CHECK (true);

-- Make PostgREST pick the new table + columns up immediately (same reason as
-- puramass-shipping-address-migration.sql). Safe to run any time.
NOTIFY pgrst, 'reload schema';

-- Verification:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'puramass_orders'
--   AND column_name IN ('shipping_address_source', 'shipping_address_updated_at', 'address_requested_at');
--
-- SELECT o.transaction_id, r.email, r.sent_at, r.sent_count, r.submitted_at, r.expires_at
-- FROM puramass_address_requests r
-- JOIN puramass_orders o ON o.id = r.puramass_order_id
-- ORDER BY r.created_at DESC LIMIT 20;
