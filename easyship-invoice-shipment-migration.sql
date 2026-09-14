-- =====================================================================
-- Easyship shipments for invoices that have no order behind them
-- =====================================================================
-- A Stealth Health / PuraMass hosted-checkout sale is materialised as an
-- invoice (`invoices.source = 'stealth_health'`) and deliberately has NO
-- `orders` row — the storefront funnel and the PuraMass ledger are kept as
-- separate revenue streams (see lib/payments/puramass-fulfillment.ts and the
-- analytics summary route). Every Easyship column lived on `orders`, so those
-- invoices could never carry a shipment: the parcel had to be booked by hand.
--
-- This mirrors the shipment block from `orders` onto `invoices` so an invoice
-- can anchor its own Easyship shipment. Column names match `orders` exactly,
-- so lib/shipping/auto-shipment.ts writes the same patch to either table.
--
-- Idempotent: safe to re-run.
-- Run this in the Supabase SQL editor (same as every other *-migration.sql).

-- 0. Prerequisites from the order-side Easyship work -------------------
-- doc-ports/migrations-ref/easyship-auto-shipment-migration.sql introduced
-- these, and at least one live database never ran it (the missing
-- shipment_auto_logs table in section 3 is the same gap). All no-ops where they
-- already exist, and re-stated here so this file runs standalone.
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS easyship_auto_create_shipment    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS easyship_auto_courier_preference TEXT DEFAULT 'cheapest',
  ADD COLUMN IF NOT EXISTS easyship_auto_buy_label          BOOLEAN DEFAULT false;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS auto_shipment_status       TEXT,
  ADD COLUMN IF NOT EXISTS auto_shipment_stage        TEXT,
  ADD COLUMN IF NOT EXISTS auto_shipment_error        TEXT,
  ADD COLUMN IF NOT EXISTS auto_shipment_attempted_at TIMESTAMPTZ;

-- 1. Shipment / label / tracking block ---------------------------------
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS easyship_shipment_id TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS easyship_courier_id  TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tracking_number      TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tracking_status      TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tracking_url         TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS carrier              TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS label_state          TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS label_url            TEXT;

-- Checkpoint journey pushed by the Easyship tracking webhook, same shape as
-- orders.tracking_checkpoints (tracking-checkpoints-migration.sql).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tracking_checkpoints JSONB;

-- 2. Auto-shipment attempt snapshot ------------------------------------
-- Mirrors orders.auto_shipment_* so the invoice detail page can report
-- "created / skipped / failed (reason)" for an invoice-anchored attempt.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS auto_shipment_status       TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS auto_shipment_stage        TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS auto_shipment_error        TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS auto_shipment_attempted_at TIMESTAMPTZ;

-- The Easyship webhook matches an inbound shipment id back to whatever it
-- belongs to; without this index that lookup is a sequential scan.
CREATE INDEX IF NOT EXISTS idx_invoices_easyship_shipment
  ON invoices (easyship_shipment_id) WHERE easyship_shipment_id IS NOT NULL;

-- 3. Attempt log ---------------------------------------------------------
-- Append-only feed of shipment attempts, surfaced on the admin dashboard
-- (especially failures) and written only by the service-role key.
--
-- Created defensively: the table comes from easyship-auto-shipment-migration.sql
-- (doc-ports/migrations-ref/), which some databases never ran — the shipment
-- helper's logging is best-effort and swallows the missing table, so its absence
-- goes unnoticed until something like this ALTER asks for it. Definition matches
-- that migration exactly, so a database that already has the table is untouched.
CREATE TABLE IF NOT EXISTS shipment_auto_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID REFERENCES orders (id) ON DELETE CASCADE,
  order_number TEXT,
  stage        TEXT NOT NULL,          -- create | rate | buy-label
  ok           BOOLEAN NOT NULL,
  courier      TEXT,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipment_auto_logs_created
  ON shipment_auto_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipment_auto_logs_order
  ON shipment_auto_logs (order_id, created_at DESC);

ALTER TABLE shipment_auto_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shipment_auto_logs_admin_read ON shipment_auto_logs;
CREATE POLICY shipment_auto_logs_admin_read ON shipment_auto_logs
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role IN ('admin','assistant')
    )
  );
-- Writes happen only via the service-role key (API routes); no client policy.

-- order_id is nullable, so an invoice-anchored attempt logs against the invoice
-- instead and the admin feed still shows it.
ALTER TABLE shipment_auto_logs
  ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_shipment_auto_logs_invoice
  ON shipment_auto_logs (invoice_id, created_at DESC)
  WHERE invoice_id IS NOT NULL;
