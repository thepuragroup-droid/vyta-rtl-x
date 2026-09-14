-- ============================================================
-- Stealth Health partner settlement feed — snapshots of GET /partner/settlement
-- ============================================================
--
-- The partner now exposes their own per-appointment financials read-only:
--
--   GET /partner/settlement?start=YYYY-MM-DD&end=YYYY-MM-DD
--
-- Those figures come from the same engine as the White Label Pay ledger they
-- invoice us from, so `partner_split` is the number we reconcile against —
-- more authoritative than the figure we compute ourselves in
-- stealth-health-settlement-migration.sql from `puramass_orders` and the terms
-- an admin typed in.
--
-- WHY WE STORE IT RATHER THAN READING IT LIVE
-- The feed is explicitly not stable over time. The partner's own caveats say
-- store cost is joined from the CURRENT catalog rather than stamped at
-- checkout, and that CAD-denominated store products are summed as their
-- USD-equivalent. So re-pulling January in March can legitimately return
-- different figures for the same appointments if a product price or an FX rate
-- moved in between. A number that moves under you cannot be reconciled against
-- unless you keep what you were shown, so every pull is snapshotted with its
-- own timestamp and the caveats that came with it. Comparing two pulls of the
-- same window is then how drift becomes visible instead of mysterious.
--
--   1. stealth_health_settlement_pulls    — one row per pull: window, when, the
--                                           partner's window totals, caveats.
--   2. stealth_health_settlement_rows     — the appointment rows as pulled.
--   3. stealth_health_appointment_links   — durable appointment ↔ hand-off
--                                           links, confirmed by an operator.
--
-- Idempotent: safe to re-run. All access is server-side (service role), so
-- every table is locked to a single service-role RLS policy, matching
-- puramass_orders and the other stealth_health_* tables.
--
-- Run this in the Supabase SQL editor (same as every other *-migration.sql).

-- 1. One row per pull ----------------------------------------------------
-- The provenance record: what window was asked for, when, by whom, and what
-- the partner said about the figures at that moment.
CREATE TABLE IF NOT EXISTS stealth_health_settlement_pulls (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  window_start      DATE NOT NULL,
  window_end        DATE NOT NULL,
  pulled_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  pulled_by         UUID,
  pulled_by_email   TEXT,

  -- What we received.
  rows_returned     INTEGER NOT NULL DEFAULT 0,
  pages_fetched     INTEGER NOT NULL DEFAULT 0,
  -- True when we stopped following the cursor early; the snapshot is partial.
  truncated         BOOLEAN NOT NULL DEFAULT false,

  -- The partner's `totals` block. It covers the WHOLE window, not the page we
  -- happened to hold, so it is stored as reported and never re-summed from
  -- rows. `totals_reported` says whether the response carried one at all —
  -- without it these columns are a row sum, which is a weaker claim.
  totals_reported          BOOLEAN NOT NULL DEFAULT false,
  total_appointments       INTEGER,
  -- Money in integer cents throughout, matching the rest of the schema.
  -- Deliberately signed: a credit or reversal must survive as a negative
  -- rather than being floored to zero.
  revenue_cents            BIGINT NOT NULL DEFAULT 0,
  processing_fee_cents     BIGINT NOT NULL DEFAULT 0,
  consult_fee_cents        BIGINT NOT NULL DEFAULT 0,
  -- NULL when nothing in the window shipped. NULL is not zero: zero would mean
  -- free shipping, which is a different fact.
  shipping_cents           BIGINT,
  partner_split_cents      BIGINT NOT NULL DEFAULT 0,

  -- The caveats[] array verbatim. These footnotes describe exactly how the
  -- figures were constructed and are what prevent a disagreement later, so
  -- they are kept with the numbers they qualify rather than summarised away.
  caveats                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- True when the partner reports our revenue split is not configured on their
  -- side. Every partner_split is then 0 — a SETUP GAP, not a balance of zero.
  split_model_unconfigured BOOLEAN NOT NULL DEFAULT false,

  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sh_settlement_pulls_window
  ON stealth_health_settlement_pulls (window_start, window_end, pulled_at DESC);
CREATE INDEX IF NOT EXISTS idx_sh_settlement_pulls_pulled
  ON stealth_health_settlement_pulls (pulled_at DESC);

COMMENT ON TABLE stealth_health_settlement_pulls IS
  'One GET /partner/settlement pull: the window, the partner''s own totals for it, and the caveats that qualify them.';
COMMENT ON COLUMN stealth_health_settlement_pulls.split_model_unconfigured IS
  'Partner reports our revenue split is unconfigured; every partner_split is 0. A setup gap to raise with them, never a balance.';

-- 2. The appointment rows as pulled --------------------------------------
CREATE TABLE IF NOT EXISTS stealth_health_settlement_rows (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pull_id           UUID NOT NULL
                      REFERENCES stealth_health_settlement_pulls(id) ON DELETE CASCADE,
  appointment_id    TEXT NOT NULL,

  -- Reported by the partner, verbatim.
  partner_created_at TIMESTAMPTZ,
  condition         TEXT,
  medication        TEXT,
  visit_type        TEXT,
  source            TEXT,
  -- NULL means our split is not configured on their side (see the pull flag).
  split_model       TEXT,
  white_label_account_settled BOOLEAN NOT NULL DEFAULT false,

  revenue_cents         BIGINT NOT NULL DEFAULT 0,
  processing_fee_cents  BIGINT NOT NULL DEFAULT 0,
  consult_fee_cents     BIGINT NOT NULL DEFAULT 0,
  -- Nullable on purpose: NULL = nothing shipped, 0 = shipped free.
  shipping_cents        BIGINT,
  -- The figure to reconcile against. Note it does NOT net out prior credits,
  -- chargebacks or manual adjustments applied at invoicing, so it will not
  -- always tie to a specific remittance to the cent.
  partner_split_cents   BIGINT NOT NULL DEFAULT 0,

  -- Our hand-off this appointment was tied to, if any, and how. 'none' means
  -- it could not be placed — matching is exact-only and never guesses.
  puramass_order_id UUID REFERENCES puramass_orders(id) ON DELETE SET NULL,
  match_method      TEXT NOT NULL DEFAULT 'none',   -- stored|transaction_id|partner_reference|none

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One row per appointment per pull; makes a re-pull an upsert, not a
  -- duplicate that would double-count a split.
  UNIQUE (pull_id, appointment_id)
);

CREATE INDEX IF NOT EXISTS idx_sh_settlement_rows_pull
  ON stealth_health_settlement_rows (pull_id);
CREATE INDEX IF NOT EXISTS idx_sh_settlement_rows_appointment
  ON stealth_health_settlement_rows (appointment_id);
CREATE INDEX IF NOT EXISTS idx_sh_settlement_rows_order
  ON stealth_health_settlement_rows (puramass_order_id)
  WHERE puramass_order_id IS NOT NULL;

COMMENT ON COLUMN stealth_health_settlement_rows.shipping_cents IS
  'NULL = nothing shipped for this appointment. Distinct from 0, which would mean free shipping.';
COMMENT ON COLUMN stealth_health_settlement_rows.partner_split_cents IS
  'The contractual split for this appointment, as the partner computes it. Gross of credits, chargebacks and manual adjustments.';

-- 3. Durable appointment ↔ hand-off links --------------------------------
-- The snapshot rows record the match that applied at pull time. This table is
-- the durable fact underneath it, so a link an operator has confirmed survives
-- every later pull instead of being re-derived (or re-guessed) each time.
--
-- It exists because the two systems do not share an identifier: the settlement
-- feed keys on `appointment_id`, while our ledger knows a hand-off by
-- `transaction_id` (theirs, from the store API) and `partner_reference`
-- (ours). Where those happen to coincide the match is automatic; where they do
-- not, a row here is how the pairing gets recorded.
CREATE TABLE IF NOT EXISTS stealth_health_appointment_links (
  appointment_id    TEXT PRIMARY KEY,
  puramass_order_id UUID NOT NULL REFERENCES puramass_orders(id) ON DELETE CASCADE,
  note              TEXT,
  confirmed_by      UUID,
  confirmed_by_email TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A hand-off is settled once, so it can back at most one appointment. Without
-- this a mis-keyed link could quietly bill the same order twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sh_appointment_links_order
  ON stealth_health_appointment_links (puramass_order_id);

-- 4. updated_at trigger --------------------------------------------------
-- Reuses touch_stealth_health_updated_at() from
-- stealth-health-settlement-migration.sql; defined here too so this migration
-- stands on its own if run first.
CREATE OR REPLACE FUNCTION touch_stealth_health_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stealth_health_appointment_links_updated_at ON stealth_health_appointment_links;
CREATE TRIGGER stealth_health_appointment_links_updated_at
  BEFORE UPDATE ON stealth_health_appointment_links
  FOR EACH ROW EXECUTE FUNCTION touch_stealth_health_updated_at();

-- 5. RLS: service-role only (all access is server-side) ------------------
ALTER TABLE stealth_health_settlement_pulls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON stealth_health_settlement_pulls;
CREATE POLICY "Service role full access" ON stealth_health_settlement_pulls FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE stealth_health_settlement_rows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON stealth_health_settlement_rows;
CREATE POLICY "Service role full access" ON stealth_health_settlement_rows FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE stealth_health_appointment_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON stealth_health_appointment_links;
CREATE POLICY "Service role full access" ON stealth_health_appointment_links FOR ALL USING (true) WITH CHECK (true);

-- Make PostgREST pick the new tables up immediately. Supabase normally reloads
-- its schema cache on DDL via an event trigger; when that lags, every query
-- naming them fails even though the DDL succeeded.
NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------------------
-- Verification: the three tables should come back.
-- SELECT table_name FROM information_schema.tables
-- WHERE table_name LIKE 'stealth_health_settlement%'
--    OR table_name = 'stealth_health_appointment_links';
--
-- Drift check — has the partner's answer for one window changed between pulls?
-- Any variation here is the "store cost is joined from the current catalog"
-- caveat showing up in the money.
-- SELECT window_start, window_end, pulled_at, rows_returned, partner_split_cents
-- FROM stealth_health_settlement_pulls
-- ORDER BY window_start, pulled_at;
--
-- Per-appointment drift between the two most recent pulls of a window:
-- SELECT appointment_id, partner_split_cents, pull_id
-- FROM stealth_health_settlement_rows
-- WHERE pull_id IN (
--   SELECT id FROM stealth_health_settlement_pulls
--   WHERE window_start = '2026-01-01' AND window_end = '2026-01-31'
--   ORDER BY pulled_at DESC LIMIT 2
-- )
-- ORDER BY appointment_id, pull_id;
