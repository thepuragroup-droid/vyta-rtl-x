-- ============================================================
-- INVOICE SPLIT (BACKORDER)
-- ============================================================
--
-- When an invoice is created with over-stock lines it is split into a primary
-- (in-stock) invoice and a separate backorder invoice holding only the
-- exceeding quantities. These columns flag the backorder invoice and link it
-- back to the primary it was split from.
--
-- Idempotent: safe to run multiple times.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_backorder boolean NOT NULL DEFAULT false;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS parent_invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_is_backorder ON invoices (is_backorder);
CREATE INDEX IF NOT EXISTS idx_invoices_parent ON invoices (parent_invoice_id);

COMMENT ON COLUMN invoices.is_backorder IS 'True when this invoice holds the exceeding-stock (backordered) portion of a split invoice.';
COMMENT ON COLUMN invoices.parent_invoice_id IS 'For a backorder invoice, the primary (in-stock) invoice it was split from.';
