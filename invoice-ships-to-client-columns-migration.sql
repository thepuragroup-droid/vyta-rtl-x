-- ============================================================
-- INVOICES — "Ships to Client" (drop-ship) columns
-- ============================================================
--
-- When an invoice is a shipment that drop-ships to one of the customer's saved
-- clients, `ships_to_client = true` and `client_id` references the chosen
-- customer_clients row. These columns are written by the invoice create/update
-- routes (app/api/admin/invoices/route.ts, app/api/admin/invoices/[id]/route.ts)
-- and read by the warehouse queue PATCH pre-check and by sendPackingList
-- (lib/admin/send-packing-list.ts).
--
-- The columns were assumed to be "already present in live DB" by
-- invoice-spec-integration-migration.sql, but they never had their own
-- migration. On a database that never received them, the warehouse queue PATCH
-- pre-check
--   .select('status, ships_to_client, packing_list_emailed_at')
-- fails with "column invoices.ships_to_client does not exist" when marking an
-- invoice as packed. This migration guarantees the columns (and the client_id
-- foreign key) exist.
--
-- Every step is idempotent (ADD COLUMN IF NOT EXISTS + guarded constraint add),
-- so this is safe to re-run.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS ships_to_client boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_id uuid;

COMMENT ON COLUMN invoices.ships_to_client IS
  'True when this shipment invoice drop-ships to one of the customer''s saved clients (client_id). Always false for pickup invoices.';
COMMENT ON COLUMN invoices.client_id IS
  'When ships_to_client is true, the customer_clients row this invoice drop-ships to. Null otherwise.';

-- FK invoices.client_id -> customer_clients(id). Guarded on the target table
-- existing (invoice-spec-integration-migration.sql creates it) and on the
-- constraint not already being present, so this is safe on any DB state.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'customer_clients'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_client_id_fkey'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES customer_clients(id) ON DELETE SET NULL;
  END IF;
END $$;
