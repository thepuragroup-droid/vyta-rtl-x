-- ============================================================
-- Stealth Health — last polled order snapshot
-- ============================================================
--
-- When we poll `GET /partner/store/orders/{transaction_id}` (the cron poller,
-- or Sync on the Orders tab), the order body Stealth Health returned is kept
-- here as is. The Payouts tab reads the customer and the amount charged from
-- Stealth Health's own records first — the signed webhook, then this — before
-- falling back to what our ledger recorded at hand-off.
--
-- Idempotent: safe to re-run. Only adds columns.
-- Run this in the Supabase SQL editor (same as every other *-migration.sql).

ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS portal_order    JSONB;
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS portal_order_at TIMESTAMPTZ;

COMMENT ON COLUMN puramass_orders.portal_order IS
  'The order body Stealth Health returned the last time we polled it (GET /partner/store/orders/{id}).';

NOTIFY pgrst, 'reload schema';
