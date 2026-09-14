-- ============================================================
-- INVOICES — "Packing List emailed" delivery-metadata columns
-- ============================================================
--
-- When a client shipment (`ships_to_client = true`) first reaches a shipped
-- terminal state, PATCH /api/warehouse/queue/[id] auto-fires sendPackingList,
-- which stamps these three columns so the UI can show a "Sent" pill and the
-- auto-send guard (`packing_list_emailed_at`) can short-circuit on retries.
--
-- These columns were referenced in code (lib/admin/send-packing-list.ts and the
-- warehouse queue PATCH route) but never had a migration. On a database that
-- never received them, the PATCH pre-check
--   .select('status, ships_to_client, packing_list_emailed_at')
-- fails with "column invoices.packing_list_emailed_at does not exist", which the
-- route surfaced as a misleading "404 invoice not found" when marking an invoice
-- as packed. This migration guarantees the columns exist.
--
-- Every add is idempotent (ADD COLUMN IF NOT EXISTS), so this is safe to re-run.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS packing_list_emailed_at timestamptz,
  ADD COLUMN IF NOT EXISTS packing_list_emailed_by uuid,
  ADD COLUMN IF NOT EXISTS packing_list_emailed_to text;

COMMENT ON COLUMN invoices.packing_list_emailed_at IS
  'When the Packing List was last emailed for this invoice. Doubles as the auto-send guard so a repeated shipped/dropped_off transition never emails twice.';
COMMENT ON COLUMN invoices.packing_list_emailed_by IS
  'Actor (customers.id) who triggered the Packing List email, or null when auto-sent by the system.';
COMMENT ON COLUMN invoices.packing_list_emailed_to IS
  'Recipient address the Packing List was last emailed to.';
