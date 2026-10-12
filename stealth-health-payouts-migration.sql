-- ============================================================
-- Stealth Health Payouts (Module 13)
-- ============================================================
--
-- Stealth Health collects from the customer, keeps a processing fee and pays
-- the rest out to us in batches, when we ask. This migration adds what the
-- Payouts tab (/admin/stealth-health/payouts) needs to track that:
--
--   1. site_settings.sh_fee_rate_catalog / sh_fee_rate_custom — the two
--      processing-fee rates (3.2% catalog price, 6% custom price).
--   2. stealth_health_payout_requests — a numbered payout request we send to
--      Stealth Health (VY-PAY-2026-0001).
--   3. puramass_orders — fee type, the request an order is on, and the
--      paid-out stamp with the CAD figures locked in.
--   4. sh_* functions — the writes, each one locking the orders it touches.
--
-- Naming note for this site: the PuraMass guide calls the request table
-- `stealth_health_payouts` and the link column `payout_id`. Here
-- `stealth_health_payouts` already exists — it is the remittance log behind
-- the settlement dashboard's Remittances tab — so the request table is
-- `stealth_health_payout_requests` and the link is `payout_request_id`.
-- Nothing in the settlement tables changes.
--
-- Idempotent: safe to re-run. Only adds things.
-- Run this in the Supabase SQL editor (same as every other *-migration.sql).

-- 1. Fee rates ----------------------------------------------------------
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS sh_fee_rate_catalog NUMERIC(6,4) NOT NULL DEFAULT 0.0320;
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS sh_fee_rate_custom  NUMERIC(6,4) NOT NULL DEFAULT 0.0600;

-- 2. Payout requests ----------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS stealth_health_payout_request_seq;

CREATE TABLE IF NOT EXISTS stealth_health_payout_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_number      TEXT NOT NULL UNIQUE,
  status             TEXT NOT NULL DEFAULT 'requested'
                       CHECK (status IN ('requested', 'received', 'void')),
  period_start       DATE,
  period_end         DATE,
  usd_rate           NUMERIC(10,6),
  order_count        INTEGER NOT NULL DEFAULT 0,
  requested_gross    NUMERIC(12,2) NOT NULL DEFAULT 0,
  requested_fees     NUMERIC(12,2) NOT NULL DEFAULT 0,
  requested_net      NUMERIC(12,2) NOT NULL DEFAULT 0,
  received_amount    NUMERIC(12,2),
  received_reference TEXT,
  received_at        TIMESTAMPTZ,
  notes              TEXT,
  created_by         UUID REFERENCES customers(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sh_payout_requests_created
  ON stealth_health_payout_requests (created_at DESC);

CREATE OR REPLACE FUNCTION update_sh_payout_requests_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sh_payout_requests_updated_at ON stealth_health_payout_requests;
CREATE TRIGGER sh_payout_requests_updated_at
  BEFORE UPDATE ON stealth_health_payout_requests
  FOR EACH ROW EXECUTE FUNCTION update_sh_payout_requests_updated_at();

-- Server-side only, like puramass_orders.
ALTER TABLE stealth_health_payout_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON stealth_health_payout_requests;
CREATE POLICY "Service role full access" ON stealth_health_payout_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. Order columns ------------------------------------------------------
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS sh_fee_type TEXT NOT NULL DEFAULT 'catalog';
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS sh_fee_rate NUMERIC(6,4);
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS payout_request_id UUID
    REFERENCES stealth_health_payout_requests(id) ON DELETE SET NULL;
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS paid_out_at TIMESTAMPTZ;
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS paid_out_by UUID REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS paid_out_gross NUMERIC(12,2);
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS paid_out_fee   NUMERIC(12,2);
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS paid_out_net   NUMERIC(12,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'puramass_orders_sh_fee_type_check'
  ) THEN
    ALTER TABLE puramass_orders
      ADD CONSTRAINT puramass_orders_sh_fee_type_check
      CHECK (sh_fee_type IN ('catalog', 'custom'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_puramass_orders_payout_request
  ON puramass_orders (payout_request_id) WHERE payout_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_paid_out
  ON puramass_orders (paid_out_at) WHERE paid_out_at IS NOT NULL;

-- 4. Functions ----------------------------------------------------------
-- The app works out each order's CAD figures and passes them in as p_rows,
-- a JSON array of {id, rate, gross, fee, net}. A refusal raises (P0001) with a
-- message the API shows to the admin as is.

-- received when nothing on the request is still owed, else requested.
CREATE OR REPLACE FUNCTION sh_refresh_payout_status(p_payout_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE stealth_health_payout_requests p
     SET status = CASE WHEN owed.n > 0 THEN 'requested' ELSE 'received' END,
         received_at = CASE WHEN owed.n > 0 THEN NULL ELSE COALESCE(p.received_at, now()) END
    FROM (
      SELECT r.id, COUNT(o.id) FILTER (WHERE o.paid_out_at IS NULL) AS n
        FROM stealth_health_payout_requests r
        LEFT JOIN puramass_orders o ON o.payout_request_id = r.id
       WHERE r.id = ANY(p_payout_ids)
       GROUP BY r.id
    ) owed
   WHERE p.id = owed.id
     AND p.status <> 'void';
END $$;

CREATE OR REPLACE FUNCTION sh_create_payout(
  p_prefix       TEXT,
  p_rows         JSONB,
  p_usd_rate     NUMERIC,
  p_period_start DATE,
  p_period_end   DATE,
  p_notes        TEXT,
  p_actor        UUID
)
RETURNS stealth_health_payout_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ids    UUID[];
  v_found  INTEGER;
  v_bad    INTEGER;
  v_number TEXT;
  v_row    stealth_health_payout_requests;
BEGIN
  SELECT ARRAY_AGG(DISTINCT (r->>'id')::UUID) INTO v_ids
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) r;
  IF v_ids IS NULL OR CARDINALITY(v_ids) = 0 THEN
    RAISE EXCEPTION 'Select at least one order to request a payout for.';
  END IF;

  -- Lock first, so two requests can never take the same order.
  PERFORM 1 FROM puramass_orders WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;

  SELECT COUNT(*) INTO v_found FROM puramass_orders WHERE id = ANY(v_ids);
  IF v_found <> CARDINALITY(v_ids) THEN
    RAISE EXCEPTION '% of the selected orders no longer exist.', CARDINALITY(v_ids) - v_found;
  END IF;

  SELECT COUNT(*) INTO v_bad FROM puramass_orders WHERE id = ANY(v_ids) AND status <> 'paid';
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% of the selected orders % not been paid by the customer.',
      v_bad, CASE WHEN v_bad = 1 THEN 'has' ELSE 'have' END;
  END IF;

  SELECT COUNT(*) INTO v_bad FROM puramass_orders WHERE id = ANY(v_ids) AND paid_out_at IS NOT NULL;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% of the selected orders % already paid out.',
      v_bad, CASE WHEN v_bad = 1 THEN 'is' ELSE 'are' END;
  END IF;

  SELECT COUNT(*) INTO v_bad
    FROM puramass_orders o
    JOIN stealth_health_payout_requests p ON p.id = o.payout_request_id
   WHERE o.id = ANY(v_ids) AND p.status <> 'void';
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% of the selected orders % already on a payout request.',
      v_bad, CASE WHEN v_bad = 1 THEN 'is' ELSE 'are' END;
  END IF;

  v_number := UPPER(COALESCE(NULLIF(TRIM(p_prefix), ''), 'SH')) || '-PAY-'
    || TO_CHAR(now() AT TIME ZONE 'America/New_York', 'YYYY') || '-'
    || LPAD(nextval('stealth_health_payout_request_seq')::TEXT, 4, '0');

  INSERT INTO stealth_health_payout_requests (
    payout_number, status, period_start, period_end, usd_rate, order_count,
    requested_gross, requested_fees, requested_net, notes, created_by
  )
  SELECT v_number, 'requested', p_period_start, p_period_end, p_usd_rate,
         CARDINALITY(v_ids),
         COALESCE(SUM(r.gross), 0), COALESCE(SUM(r.fee), 0), COALESCE(SUM(r.net), 0),
         NULLIF(TRIM(p_notes), ''), p_actor
    FROM jsonb_to_recordset(p_rows) AS r(id UUID, rate NUMERIC, gross NUMERIC, fee NUMERIC, net NUMERIC)
  RETURNING * INTO v_row;

  UPDATE puramass_orders SET payout_request_id = v_row.id WHERE id = ANY(v_ids);

  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION sh_mark_paid_out(
  p_rows      JSONB,
  p_actor     UUID,
  p_payout_id UUID DEFAULT NULL,
  p_amount    NUMERIC DEFAULT NULL,
  p_reference TEXT DEFAULT NULL
)
RETURNS UUID[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status   TEXT;
  v_marked   UUID[];
  v_requests UUID[];
BEGIN
  IF p_payout_id IS NOT NULL THEN
    SELECT status INTO v_status
      FROM stealth_health_payout_requests WHERE id = p_payout_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That payout request does not exist.';
    END IF;
    IF v_status = 'void' THEN
      RAISE EXCEPTION 'That payout request is void.';
    END IF;
  END IF;

  PERFORM 1 FROM puramass_orders
   WHERE id IN (SELECT (x->>'id')::UUID FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) x)
   ORDER BY id
   FOR UPDATE;

  -- Customer-paid and not already paid out; anything else is skipped.
  WITH r AS (
    SELECT DISTINCT ON (x.id) x.*
      FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::JSONB))
        AS x(id UUID, rate NUMERIC, gross NUMERIC, fee NUMERIC, net NUMERIC)
  ), done AS (
    UPDATE puramass_orders o
       SET paid_out_at    = now(),
           paid_out_by    = p_actor,
           sh_fee_rate    = r.rate,
           paid_out_gross = r.gross,
           paid_out_fee   = r.fee,
           paid_out_net   = r.net
      FROM r
     WHERE o.id = r.id AND o.status = 'paid' AND o.paid_out_at IS NULL
    RETURNING o.id, o.payout_request_id
  )
  SELECT ARRAY_AGG(id), ARRAY_AGG(DISTINCT payout_request_id) FILTER (WHERE payout_request_id IS NOT NULL)
    INTO v_marked, v_requests
    FROM done;

  IF p_payout_id IS NOT NULL THEN
    UPDATE stealth_health_payout_requests
       SET received_amount    = COALESCE(p_amount, received_amount),
           received_reference = COALESCE(NULLIF(TRIM(p_reference), ''), received_reference)
     WHERE id = p_payout_id;
    v_requests := ARRAY_APPEND(COALESCE(v_requests, ARRAY[]::UUID[]), p_payout_id);
  END IF;

  IF v_requests IS NOT NULL AND CARDINALITY(v_requests) > 0 THEN
    PERFORM sh_refresh_payout_status(v_requests);
  END IF;

  RETURN COALESCE(v_marked, ARRAY[]::UUID[]);
END $$;

CREATE OR REPLACE FUNCTION sh_unmark_paid_out(p_ids UUID[])
RETURNS UUID[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ids      UUID[];
  v_requests UUID[];
BEGIN
  WITH done AS (
    UPDATE puramass_orders
       SET paid_out_at = NULL, paid_out_by = NULL, sh_fee_rate = NULL,
           paid_out_gross = NULL, paid_out_fee = NULL, paid_out_net = NULL
     WHERE id = ANY(COALESCE(p_ids, ARRAY[]::UUID[])) AND paid_out_at IS NOT NULL
    RETURNING id, payout_request_id
  )
  SELECT ARRAY_AGG(id), ARRAY_AGG(DISTINCT payout_request_id) FILTER (WHERE payout_request_id IS NOT NULL)
    INTO v_ids, v_requests
    FROM done;

  IF v_requests IS NOT NULL AND CARDINALITY(v_requests) > 0 THEN
    PERFORM sh_refresh_payout_status(v_requests);
  END IF;

  RETURN COALESCE(v_ids, ARRAY[]::UUID[]);
END $$;

CREATE OR REPLACE FUNCTION sh_void_payout(p_payout_id UUID)
RETURNS stealth_health_payout_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row stealth_health_payout_requests;
  v_n   INTEGER;
BEGIN
  SELECT * INTO v_row FROM stealth_health_payout_requests WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That payout request does not exist.';
  END IF;
  IF v_row.status = 'void' THEN
    RAISE EXCEPTION '% is already void.', v_row.payout_number;
  END IF;

  PERFORM 1 FROM puramass_orders WHERE payout_request_id = p_payout_id FOR UPDATE;
  SELECT COUNT(*) INTO v_n
    FROM puramass_orders WHERE payout_request_id = p_payout_id AND paid_out_at IS NOT NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION '% order(s) on % are already paid out. Undo them first.', v_n, v_row.payout_number;
  END IF;

  UPDATE puramass_orders SET payout_request_id = NULL WHERE payout_request_id = p_payout_id;
  UPDATE stealth_health_payout_requests SET status = 'void' WHERE id = p_payout_id
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

-- Execute: service role only.
REVOKE ALL ON FUNCTION sh_refresh_payout_status(UUID[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sh_create_payout(TEXT, JSONB, NUMERIC, DATE, DATE, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sh_mark_paid_out(JSONB, UUID, UUID, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sh_unmark_paid_out(UUID[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sh_void_payout(UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION sh_refresh_payout_status(UUID[]) TO service_role;
GRANT EXECUTE ON FUNCTION sh_create_payout(TEXT, JSONB, NUMERIC, DATE, DATE, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION sh_mark_paid_out(JSONB, UUID, UUID, NUMERIC, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION sh_unmark_paid_out(UUID[]) TO service_role;
GRANT EXECUTE ON FUNCTION sh_void_payout(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';

-- Verification:
-- SELECT payout_number, status, order_count, requested_net, received_at
--   FROM stealth_health_payout_requests ORDER BY created_at DESC;
-- SELECT id, sh_fee_type, payout_request_id, paid_out_at, paid_out_net
--   FROM puramass_orders WHERE status = 'paid' ORDER BY paid_at DESC LIMIT 20;
