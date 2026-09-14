-- ============================================================
-- PRODUCTS ↔ STORE_CATEGORIES — bind by id, keep the text column in sync
-- ============================================================
--
-- Run AFTER store-categories-migration.sql.
--
-- Adds a real foreign-key link (products.category_id) so a category can be
-- renamed / re-slugged and every bound product follows automatically, WHILE
-- the denormalised products.category text column is preserved and maintained
-- (the storefront filter + product form still read it, unchanged).
--
-- Source of truth is category_id; the text column mirrors the linked category's
-- slug. Two triggers keep them consistent:
--   * products_sync_category    — on a product write, mirror id→text or, when
--                                 only the text changed, resolve text→id.
--   * store_categories_cascade_slug — on a slug rename, push the new slug into
--                                 the text column of every linked product.

-- 1) The FK column. ON DELETE SET NULL: deleting a category unlinks products
--    (their text tag is kept — see below), it never deletes products.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES store_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_category_id ON products (category_id);

-- 2) Backfill the link from the existing text→slug match (idempotent: only
--    fills rows that aren't linked yet).
UPDATE products p
SET category_id = c.id
FROM store_categories c
WHERE p.category_id IS NULL
  AND p.category IS NOT NULL
  AND p.category = c.slug;

-- 3) Keep products.category (text) and products.category_id in sync on writes.
CREATE OR REPLACE FUNCTION products_sync_category()
RETURNS TRIGGER AS $$
DECLARE
  cat_slug text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.category_id IS NOT NULL THEN
      -- Linked by id → mirror its slug into the text column.
      SELECT slug INTO cat_slug FROM store_categories WHERE id = NEW.category_id;
      IF cat_slug IS NOT NULL THEN NEW.category := cat_slug; END IF;
    ELSIF NEW.category IS NOT NULL THEN
      -- Only text given (free-text form) → resolve the id from the slug.
      SELECT id INTO NEW.category_id FROM store_categories WHERE slug = NEW.category;
    END IF;
  ELSE  -- UPDATE
    IF NEW.category_id IS DISTINCT FROM OLD.category_id THEN
      -- id explicitly changed → id wins; mirror its slug into the text column.
      IF NEW.category_id IS NOT NULL THEN
        SELECT slug INTO cat_slug FROM store_categories WHERE id = NEW.category_id;
        IF cat_slug IS NOT NULL THEN NEW.category := cat_slug; END IF;
      END IF;
    ELSIF NEW.category IS DISTINCT FROM OLD.category THEN
      -- Only the text changed (free-text form / slug cascade) → re-resolve id.
      IF NEW.category IS NULL THEN
        NEW.category_id := NULL;
      ELSE
        SELECT id INTO NEW.category_id FROM store_categories WHERE slug = NEW.category;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_sync_category_trg ON products;
CREATE TRIGGER products_sync_category_trg
  BEFORE INSERT OR UPDATE OF category, category_id ON products
  FOR EACH ROW EXECUTE FUNCTION products_sync_category();

-- 4) Cascade a category slug rename into every product bound to it by id, so
--    renames propagate while the text column stays maintained.
CREATE OR REPLACE FUNCTION store_categories_cascade_slug()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    UPDATE products SET category = NEW.slug WHERE category_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS store_categories_cascade_slug_trg ON store_categories;
CREATE TRIGGER store_categories_cascade_slug_trg
  AFTER UPDATE OF slug ON store_categories
  FOR EACH ROW EXECUTE FUNCTION store_categories_cascade_slug();
