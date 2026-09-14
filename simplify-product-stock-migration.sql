-- ============================================================
-- SIMPLIFY PRODUCT STOCK
-- ============================================================
--
-- Moves the source of truth for inventory off `product_variants`
-- and back onto `products.stock_quantity`. New flows reference
-- products directly via `invoice_line_items.product_id`.
--
-- We do NOT drop product_variants — existing rows stay so legacy
-- references (PO items, inventory_log, etc.) keep resolving. The
-- new code simply ignores variants.

ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS product_id uuid;

DO $$ BEGIN
  ALTER TABLE invoice_line_items
    ADD CONSTRAINT invoice_line_items_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_product_id
  ON invoice_line_items(product_id);
