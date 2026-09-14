-- ============================================================
-- PuraMass (Stealth Health) — order details for the invoice pages
-- ============================================================
--
-- The PuraMass order payload (both the `store_order.*` webhook events and
-- `GET /partner/store/orders/{id}` polling) carries more than the hand-off
-- ledger has been storing:
--
--   "expires_at": "2026-08-25T19:59:58.204Z",
--   "refunded_total_cents": 0,
--   "refunds": [ … ],
--   "items": [{ "sku": …, "name": …, "quantity": …, "unit_price_cents": … }]
--
-- /admin/invoices and /admin/invoices/[id] surface the PuraMass side of a
-- materialised invoice (source = 'stealth_health'), and a refunded sale must
-- not read as fully paid there. These columns capture the rest of the payload
-- so the invoice table, the detail view and the printable invoice can show it.
--
-- Everything stays optional: an order PuraMass has not reported these for keeps
-- NULL, and the UI simply omits the block.
--
-- Idempotent: safe to re-run.
-- Run this in the Supabase SQL editor (same as every other *-migration.sql).

ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS expires_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_total_cents  INTEGER,
  ADD COLUMN IF NOT EXISTS refunds               JSONB,
  ADD COLUMN IF NOT EXISTS paid_items            JSONB;

COMMENT ON COLUMN puramass_orders.expires_at IS
  'When the PuraMass hosted payment link stops accepting payment, as PuraMass reports it.';
COMMENT ON COLUMN puramass_orders.refunded_total_cents IS
  'Total refunded on the PuraMass side, in cents. 0 (or NULL) means nothing refunded.';
COMMENT ON COLUMN puramass_orders.refunds IS
  'Refund records exactly as PuraMass reports them, newest payload wins.';
COMMENT ON COLUMN puramass_orders.paid_items IS
  'Priced line items from the PuraMass payload: [{ sku, name, quantity, unit_price_cents }]. The ledger''s `items` column only holds what we sent at hand-off (sku + quantity); this is what PuraMass actually charged for, and is what the invoice line items were materialised from.';

-- Make PostgREST pick the new columns up immediately. Supabase normally reloads
-- its schema cache on DDL via an event trigger, but when that lags, every query
-- naming these columns fails with "column ... does not exist" even though the
-- ALTER succeeded. This forces the reload. Safe to run any time.
NOTIFY pgrst, 'reload schema';

-- Backfill note: these arrive with the next webhook event or poll for an order.
-- Orders already in a terminal state (paid/expired/cancelled) are not polled by
-- the cron job — use the per-row "Refresh" action on /admin/puramass-orders to
-- pull them from PuraMass on demand.

-- Verification: all four columns should come back.
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'puramass_orders'
--   AND column_name IN ('expires_at', 'refunded_total_cents', 'refunds', 'paid_items');
