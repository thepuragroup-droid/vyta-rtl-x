-- ============================================================
-- PURCHASE ORDER MODULE MIGRATION
-- Depends on: suppliers (inventory migration), products,
--             product_variants, customers
-- ============================================================

-- Auto-incrementing PO number sequence
CREATE SEQUENCE IF NOT EXISTS po_number_seq START 1001;

-- Purchase Orders
CREATE TABLE IF NOT EXISTS purchase_orders (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number    text        NOT NULL UNIQUE
                           DEFAULT ('PO-' || lpad(nextval('po_number_seq')::text, 5, '0')),
  supplier_id  uuid        NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  status       text        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','partially_fulfilled','fulfilled','paid','cancelled')),
  subtotal     numeric(10,2) NOT NULL DEFAULT 0,
  tax_type     text        NOT NULL DEFAULT 'percentage'
                           CHECK (tax_type IN ('percentage','fixed')),
  tax_value    numeric(10,2) NOT NULL DEFAULT 0,   -- the rate (13) or fixed amount (50.00)
  tax_total    numeric(10,2) NOT NULL DEFAULT 0,   -- computed & stored for history
  total        numeric(10,2) NOT NULL DEFAULT 0,
  notes        text,
  expected_date date,
  created_by   uuid        REFERENCES customers(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Purchase Order Line Items
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id  uuid        NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id         uuid        REFERENCES products(id) ON DELETE SET NULL,
  product_variant_id uuid        REFERENCES product_variants(id) ON DELETE SET NULL,
  description        text        NOT NULL,       -- snapshot: "BPC-157 — Size: 5mg"
  sku_snapshot       text,
  qty                integer     NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price         numeric(10,2) NOT NULL,     -- cost_price frozen at creation time
  line_total         numeric(10,2) NOT NULL
);

-- ---- Indexes ----
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_id  ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status       ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_at   ON purchase_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_items_po_id               ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_items_variant_id          ON purchase_order_items(product_variant_id);

-- ---- updated_at trigger ----
-- set_updated_at() function already exists from inventory migration.
-- If running standalone, uncomment the block below:
-- CREATE OR REPLACE FUNCTION set_updated_at()
-- RETURNS TRIGGER LANGUAGE plpgsql AS $$
-- BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS purchase_orders_updated_at ON purchase_orders;
CREATE TRIGGER purchase_orders_updated_at
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- Row Level Security ----
ALTER TABLE purchase_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;

-- NOTE: API routes use the SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS
-- entirely — so no blanket "USING (true)" policy is needed (and one would
-- wrongly grant every authenticated user full access). RLS below is
-- defense-in-depth for the anon/authenticated clients only.

-- Authenticated admin/assistant users can read all purchase orders
DROP POLICY IF EXISTS po_admin_read ON purchase_orders;
CREATE POLICY po_admin_read ON purchase_orders
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM customers
      WHERE customers.id = auth.uid()
        AND customers.role IN ('admin', 'assistant')
    )
  );

-- Only admin role can write purchase orders
DROP POLICY IF EXISTS po_admin_write ON purchase_orders;
CREATE POLICY po_admin_write ON purchase_orders
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

-- Same policies for line items
DROP POLICY IF EXISTS po_items_admin_read ON purchase_order_items;
CREATE POLICY po_items_admin_read ON purchase_order_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM customers
      WHERE customers.id = auth.uid()
        AND customers.role IN ('admin', 'assistant')
    )
  );

DROP POLICY IF EXISTS po_items_admin_write ON purchase_order_items;
CREATE POLICY po_items_admin_write ON purchase_order_items
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
