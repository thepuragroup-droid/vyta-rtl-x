-- ============================================================
-- PRICELISTS MIGRATION
-- Depends on: products, customers (for RLS), set_updated_at()
-- ============================================================
--
-- Named pricelists; exactly one may be is_active. The active list's
-- per-product prices become the default unit price in the invoice line
-- editor. A product absent from the list falls back to products.price.

CREATE TABLE IF NOT EXISTS pricelists (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  is_active  boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- At most one active pricelist at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pricelists_active
  ON pricelists (is_active) WHERE is_active;

CREATE TABLE IF NOT EXISTS pricelist_items (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  pricelist_id uuid          NOT NULL REFERENCES pricelists(id) ON DELETE CASCADE,
  product_id   uuid          NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  price        numeric(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (pricelist_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_pricelist_items_pricelist ON pricelist_items(pricelist_id);
CREATE INDEX IF NOT EXISTS idx_pricelist_items_product   ON pricelist_items(product_id);

DROP TRIGGER IF EXISTS pricelists_updated_at ON pricelists;
CREATE TRIGGER pricelists_updated_at
  BEFORE UPDATE ON pricelists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pricelist_items_updated_at ON pricelist_items;
CREATE TRIGGER pricelist_items_updated_at
  BEFORE UPDATE ON pricelist_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- Row Level Security ----
-- API routes use the service-role client (bypasses RLS). Pricelists are not
-- customer-facing, so reads/writes go through admin API routes only.
ALTER TABLE pricelists      ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricelist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pricelists_admin_read ON pricelists;
CREATE POLICY pricelists_admin_read ON pricelists
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM customers WHERE customers.id = auth.uid() AND customers.role IN ('admin','assistant')));

DROP POLICY IF EXISTS pricelists_admin_write ON pricelists;
CREATE POLICY pricelists_admin_write ON pricelists
  FOR ALL
  USING (EXISTS (SELECT 1 FROM customers WHERE customers.id = auth.uid() AND customers.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM customers WHERE customers.id = auth.uid() AND customers.role = 'admin'));

DROP POLICY IF EXISTS pricelist_items_admin_read ON pricelist_items;
CREATE POLICY pricelist_items_admin_read ON pricelist_items
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM customers WHERE customers.id = auth.uid() AND customers.role IN ('admin','assistant')));

DROP POLICY IF EXISTS pricelist_items_admin_write ON pricelist_items;
CREATE POLICY pricelist_items_admin_write ON pricelist_items
  FOR ALL
  USING (EXISTS (SELECT 1 FROM customers WHERE customers.id = auth.uid() AND customers.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM customers WHERE customers.id = auth.uid() AND customers.role = 'admin'));
