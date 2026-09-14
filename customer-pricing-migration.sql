-- ============================================================
-- CUSTOMER PRICE OVERRIDES MIGRATION
-- Depends on: customers, products, set_updated_at()
-- ============================================================
--
-- A specific price for a (customer, product) pair — the most specific tier
-- in the resolution order: override → active pricelist → products.price.

CREATE TABLE IF NOT EXISTS customer_price_overrides (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    uuid          NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id     uuid          NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  override_price numeric(10,2) NOT NULL DEFAULT 0 CHECK (override_price >= 0),
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (customer_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_cpo_customer ON customer_price_overrides(customer_id);
CREATE INDEX IF NOT EXISTS idx_cpo_product  ON customer_price_overrides(product_id);
CREATE INDEX IF NOT EXISTS idx_cpo_pair     ON customer_price_overrides(customer_id, product_id);

DROP TRIGGER IF EXISTS customer_price_overrides_updated_at ON customer_price_overrides;
CREATE TRIGGER customer_price_overrides_updated_at
  BEFORE UPDATE ON customer_price_overrides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- Row Level Security ----
ALTER TABLE customer_price_overrides ENABLE ROW LEVEL SECURITY;

-- Admin/assistant read; admin writes — mutations go through the service-role API.
DROP POLICY IF EXISTS cpo_admin_read ON customer_price_overrides;
CREATE POLICY cpo_admin_read ON customer_price_overrides
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM customers WHERE customers.id = auth.uid() AND customers.role IN ('admin','assistant')));

DROP POLICY IF EXISTS cpo_admin_write ON customer_price_overrides;
CREATE POLICY cpo_admin_write ON customer_price_overrides
  FOR ALL
  USING (EXISTS (SELECT 1 FROM customers WHERE customers.id = auth.uid() AND customers.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM customers WHERE customers.id = auth.uid() AND customers.role = 'admin'));

-- Customers may view their own overrides.
DROP POLICY IF EXISTS cpo_owner_read ON customer_price_overrides;
CREATE POLICY cpo_owner_read ON customer_price_overrides
  FOR SELECT
  USING (auth.uid() = customer_id);
