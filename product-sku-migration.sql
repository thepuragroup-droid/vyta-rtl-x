-- ============================================================
-- PRODUCT SKU
-- ============================================================
--
-- Adds an optional stock-keeping unit to products for catalogue and
-- import workflows. Nullable; not unique (legacy rows may share blanks).

ALTER TABLE products ADD COLUMN IF NOT EXISTS sku VARCHAR(50);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);

COMMENT ON COLUMN products.sku IS 'Optional stock-keeping unit / product code.';
