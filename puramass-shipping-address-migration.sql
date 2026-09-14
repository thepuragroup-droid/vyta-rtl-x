-- ============================================================
-- PuraMass (Stealth Health) — shipping address + customer contact
-- ============================================================
--
-- PuraMass collects the shipping address on its hosted checkout page and now
-- returns it on the order payload (both the `store_order.*` webhook events and
-- `GET /partner/store/orders/{id}` polling):
--
--   "customer": { "first_name": …, "last_name": …, "email": …, "phone": … },
--   "shipping": { "address": …, "address2": …, "city": …, "state": …,
--                 "zip": …, "country": … }
--
-- These columns capture that on the hand-off ledger so the admin PuraMass
-- Orders page can surface where each order actually shipped. Everything stays
-- optional: older orders (and any payload that omits the block) simply keep
-- NULL, and the UI renders "not provided" rather than failing.
--
-- Idempotent: safe to re-run.
-- Run this in the Supabase SQL editor (same as every other *-migration.sql).

ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS shipping_address JSONB,
  ADD COLUMN IF NOT EXISTS customer_name    TEXT,
  ADD COLUMN IF NOT EXISTS customer_phone   TEXT;

COMMENT ON COLUMN puramass_orders.shipping_address IS
  'Shipping address as returned by PuraMass: { address, address2, city, state, zip, country }. NULL until PuraMass reports one (webhook or poll).';
COMMENT ON COLUMN puramass_orders.customer_name IS
  'Buyer name from the PuraMass customer block (first + last), when provided.';
COMMENT ON COLUMN puramass_orders.customer_phone IS
  'Buyer phone from the PuraMass customer block, when provided.';

-- Make PostgREST pick the new columns up immediately. Supabase normally reloads
-- its schema cache on DDL via an event trigger, but when that lags, every query
-- naming these columns fails with "column ... does not exist" even though the
-- ALTER succeeded. This forces the reload. Safe to run any time.
NOTIFY pgrst, 'reload schema';

-- Backfill note: the address arrives with the next webhook event or poll for an
-- order. Historical orders that are already in a terminal state (paid/expired/
-- cancelled) are not polled by the cron job — use the per-row "Refresh" action
-- on /admin/puramass-orders to pull their address from PuraMass on demand.

-- Verification: all three columns should come back.
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'puramass_orders'
--   AND column_name IN ('shipping_address', 'customer_name', 'customer_phone');
--
-- SELECT transaction_id, customer_email, customer_name, customer_phone, shipping_address
-- FROM puramass_orders ORDER BY created_at DESC LIMIT 20;
