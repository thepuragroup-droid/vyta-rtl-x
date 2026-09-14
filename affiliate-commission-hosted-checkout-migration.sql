-- ============================================================
-- AFFILIATE COMMISSION ON HOSTED (STEALTH HEALTH) CHECKOUT
-- ============================================================
--
-- Referral codes have been captured at checkout for a while — the storefront
-- reads `ref_code` and the hand-off route stores it on `puramass_orders` — but
-- nothing ever turned one into money. Both writers to `commissions`
-- (`createOrder` in lib/customer/api.ts and `createCommission` in
-- lib/affiliate/api.ts) are dead code with no callers, so every affiliate
-- dashboard has been summing a table nobody writes.
--
-- The blocker was structural, not just a missing call. A paid PuraMass sale
-- materialises as an INVOICE (`invoices`, source = 'stealth_health') — there is
-- no `orders` row for it — while `commissions.order_id` is NOT NULL and
-- references `orders`. So a hosted sale had nowhere to hang its commission.
--
-- This mirrors what `sales_commissions` already does for the sales-person
-- stream, which is keyed on `invoice_id`. After this migration a commission row
-- points at EXACTLY ONE of an order (legacy/storefront) or an invoice (hosted
-- checkout), enforced by a check constraint.
--
-- The two unique indexes are the idempotency guarantee the recording code
-- relies on: PuraMass webhooks retry, and the poller re-reads the same order,
-- so "one commission per sale" has to hold at the database, not just in code.
--
-- Idempotent: safe to re-run.
-- Run this in the Supabase SQL editor (same as every other *-migration.sql).

-- 1. Invoice-sourced commissions.
ALTER TABLE commissions
  ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE;

-- 2. `order_id` can no longer be required — a hosted sale has an invoice only.
--    Existing rows all carry an order_id, so nothing is invalidated.
ALTER TABLE commissions
  ALTER COLUMN order_id DROP NOT NULL;

-- 3. Exactly one source. Guards against a row that credits nothing (both NULL)
--    and against a row that would be counted twice (both set).
ALTER TABLE commissions
  DROP CONSTRAINT IF EXISTS commissions_one_source;
ALTER TABLE commissions
  ADD CONSTRAINT commissions_one_source
  CHECK (num_nonnulls(order_id, invoice_id) = 1);

-- 4. One commission per sale, whichever side it came from. This is what makes
--    a retried webhook or an overlapping poll safe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_commissions_order_unique
  ON commissions (order_id) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_commissions_invoice_unique
  ON commissions (invoice_id) WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_commissions_affiliate
  ON commissions (affiliate_id);

COMMENT ON COLUMN commissions.invoice_id IS
  'The invoice this commission was earned on. Set for hosted (Stealth Health) checkout, where the sale materialises as an invoice and never as an orders row. Mutually exclusive with order_id.';
COMMENT ON COLUMN commissions.order_id IS
  'The order this commission was earned on. Set for storefront/legacy orders. Mutually exclusive with invoice_id.';
COMMENT ON COLUMN commissions.order_total IS
  'The base the commission was calculated from — the goods subtotal, excluding shipping and tax. Named order_total for backwards compatibility.';
