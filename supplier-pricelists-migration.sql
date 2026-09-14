-- ============================================================
-- SUPPLIER PRICELISTS MIGRATION
-- Depends on: ecommerce-backend-migration.sql (suppliers), products
-- ============================================================
--
-- One negotiated price per (supplier, product). Missing rows fall back to
-- products.price everywhere. Seeded from products.price for every active
-- product (existing suppliers seeded here; POST /suppliers seeds new ones).

-- ---- 1. Supplier columns the module relies on --------------------------
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS notes      text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_suppliers_lower_name ON suppliers (lower(name));

DROP TRIGGER IF EXISTS suppliers_updated_at ON suppliers;
CREATE TRIGGER suppliers_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- 2. supplier_prices -------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_prices (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid          NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  product_id  uuid          NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  price       numeric(10,2) NOT NULL DEFAULT 0,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_prices_supplier ON supplier_prices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_prices_product  ON supplier_prices(product_id);

DROP TRIGGER IF EXISTS supplier_prices_updated_at ON supplier_prices;
CREATE TRIGGER supplier_prices_updated_at
  BEFORE UPDATE ON supplier_prices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- 3. Seed existing suppliers from products.price --------------------
INSERT INTO supplier_prices (supplier_id, product_id, price)
SELECT s.id, p.id, COALESCE(p.price, 0)
  FROM suppliers s
  CROSS JOIN products p
 WHERE p.active = true
ON CONFLICT (supplier_id, product_id) DO NOTHING;

-- ---- 4. Row Level Security ---------------------------------------------
ALTER TABLE supplier_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_prices_admin_read ON supplier_prices;
CREATE POLICY supplier_prices_admin_read ON supplier_prices
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM customers
      WHERE customers.id = auth.uid()
        AND customers.role IN ('admin', 'assistant')
    )
  );

DROP POLICY IF EXISTS supplier_prices_admin_write ON supplier_prices;
CREATE POLICY supplier_prices_admin_write ON supplier_prices
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM customers
      WHERE customers.id = auth.uid()
        AND customers.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM customers
      WHERE customers.id = auth.uid()
        AND customers.role = 'admin'
    )
  );
