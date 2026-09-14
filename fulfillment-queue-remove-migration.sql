-- ============================================================
-- INVOICES — "Remove from queue" fulfillment columns
-- ============================================================
--
-- The warehouse queue supports removing an invoice from the active worklist
-- (a warehouse-only soft hide, distinct from cancelling the customer's order).
-- The PATCH /api/warehouse/queue/[id] route already writes these columns; this
-- migration guarantees they exist so bulk "Remove from queue" cannot fail on a
-- database that never received them.
--
-- Every add is idempotent (ADD COLUMN IF NOT EXISTS), so this is safe to re-run.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS removed_from_queue boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS removed_at timestamptz,
  ADD COLUMN IF NOT EXISTS removed_by uuid;

COMMENT ON COLUMN invoices.removed_from_queue IS
  'True when warehouse staff removed this invoice from the active fulfillment queue. Reversible via the Removed tab. Warehouse-only — does not cancel the linked order.';
