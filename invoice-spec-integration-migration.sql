-- ============================================================================
--  INVOICE SYSTEM — SPEC INTEGRATION MIGRATION
--  Date: 2026-07-16
-- ============================================================================
--
--  Brings the live schema up to the "Admin Invoice System — Complete
--  Specification" (2026-07-16). It adds only the DELTAS that are missing from
--  the current live shape; every statement is idempotent (IF NOT EXISTS /
--  guarded DO blocks) so the file is safe to run more than once.
--
--  NAMING NOTE (deliberate — honoring pre-existing columns):
--    * The spec's `customers.price_currency` is the live `customers.preferred_currency`.
--      We do NOT create a second column — the existing one is used as-is.
--    * The spec's `product_change_history` is the live `product_history` table,
--      whose `source`/`field` columns carry NO CHECK constraint. There is
--      therefore nothing to widen for the new `invoice_cancel` / `vial_price`
--      values — they already insert freely. (`restore_stock_for_invoice` shipped
--      in restore-stock-for-invoice-migration.sql and is unchanged here.)
--
--  What this migration adds:
--    1. invoices.customer_deleted + the customer-deletion snapshot trigger
--    2. invoices status CHECK widened to include 'cancelled'
--    3. uniq_invoices_order_id partial UNIQUE index (1 invoice : 1 order)
--    4. customers.alternate_email, customers.applied_pricelist_id (+FK)
--    5. pricelists.description, pricelists.created_by (+FK pricelists_created_by_fkey)
--    6. products.vials_per_box (+CHECK) and the USD/vial pricing inputs the
--       invoice form relies on (price_usd, vial_price, site_settings.usd_exchange_rate)
--    7. invoice_line_items.price_type (+CHECK box/vial)
--    8. order_items.price_type (+CHECK, nullable)
--    9. customer_clients (defensive create — already present via invoices FK)
--
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. invoices.customer_deleted  (invoice-customer-deleted-tag)
-- ----------------------------------------------------------------------------
-- UI-only tag: flipped by the trigger below when a customer row is deleted.
-- Never rendered on the printed/emailed document — admin views only.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS customer_deleted boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN invoices.customer_deleted IS
  'True once this invoice''s customer row was deleted. Identity is snapshotted into customer_name/email/phone by trg_mark_invoices_customer_deleted. UI tag only — never printed.';


-- ----------------------------------------------------------------------------
-- 2. invoices status CHECK — add 'cancelled'  (invoice-cancel-stock-restore)
-- ----------------------------------------------------------------------------
-- The PATCH route sets status='cancelled' (→ restore_stock_for_invoice); the
-- live CHECK omitted it, so cancels would fail. Widen the allowed set. Every
-- existing status is a subset of the new list, so revalidation cannot fail.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status = ANY (ARRAY[
    'draft'::text,
    'sent'::text,
    'partial'::text,
    'paid'::text,
    'overdue'::text,
    'cancelled'::text
  ]));


-- ----------------------------------------------------------------------------
-- 3. uniq_invoices_order_id — enforce 1 invoice : 1 order
-- ----------------------------------------------------------------------------
-- Partial unique index (the live schema only had a plain btree on order_id).
-- Guarded: if legacy duplicate order_ids exist the CREATE would abort the whole
-- migration, so we catch it and emit a NOTICE instead of failing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'uniq_invoices_order_id') THEN
    BEGIN
      CREATE UNIQUE INDEX uniq_invoices_order_id
        ON invoices (order_id)
        WHERE order_id IS NOT NULL;
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'uniq_invoices_order_id NOT created: duplicate order_id values exist. Resolve the duplicates, then re-run this migration.';
    END;
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 3b. Customer-deletion snapshot trigger  (mark_invoices_customer_deleted)
-- ----------------------------------------------------------------------------
-- BEFORE DELETE on customers — runs before the FK's ON DELETE SET NULL clears
-- invoices.customer_id, so OLD identity is still reachable. For every invoice
-- pointing at the doomed customer, backfill any blank denormalized field from
-- the customer record (COALESCE(NULLIF(existing,''), OLD.*)) and raise the tag.
CREATE OR REPLACE FUNCTION mark_invoices_customer_deleted()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE invoices
     SET customer_name    = COALESCE(
                              NULLIF(customer_name, ''),
                              NULLIF(TRIM(CONCAT_WS(' ', OLD.first_name, OLD.last_name)), '')
                            ),
         customer_email   = COALESCE(NULLIF(customer_email, ''), OLD.email),
         customer_phone   = COALESCE(NULLIF(customer_phone, ''), OLD.phone),
         customer_deleted = true,
         updated_at       = now()
   WHERE customer_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_invoices_customer_deleted ON customers;
CREATE TRIGGER trg_mark_invoices_customer_deleted
  BEFORE DELETE ON customers
  FOR EACH ROW
  EXECUTE FUNCTION mark_invoices_customer_deleted();


-- ----------------------------------------------------------------------------
-- 4. customers — alternate_email + applied_pricelist_id
-- ----------------------------------------------------------------------------
-- alternate_email: backup / CC contact (customer-alternate-email). Non-unique,
-- NOT used for auth, and NOT consulted by the invoice email recipient fallback.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS alternate_email text;

COMMENT ON COLUMN customers.alternate_email IS
  'Optional backup/CC contact address. Non-unique, not an auth identity.';

-- applied_pricelist_id: last pricelist applied to this customer's overrides
-- (pricelist-enhancements). Stamped by the apply-to-customer route.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS applied_pricelist_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_applied_pricelist_id_fkey'
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT customers_applied_pricelist_id_fkey
      FOREIGN KEY (applied_pricelist_id) REFERENCES pricelists(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customers_applied_pricelist
  ON customers (applied_pricelist_id);


-- ----------------------------------------------------------------------------
-- 5. pricelists — description + created_by  (pricelist-enhancements)
-- ----------------------------------------------------------------------------
-- The FK MUST be named `pricelists_created_by_fkey` — the POST /api/admin/
-- pricelists route embeds `creator:customers!pricelists_created_by_fkey`, and
-- PostgREST resolves that embed by constraint name.
ALTER TABLE pricelists
  ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE pricelists
  ADD COLUMN IF NOT EXISTS created_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pricelists_created_by_fkey'
  ) THEN
    ALTER TABLE pricelists
      ADD CONSTRAINT pricelists_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES customers(id) ON DELETE SET NULL;
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 6. products — vials_per_box + USD/vial pricing inputs
-- ----------------------------------------------------------------------------
-- vials_per_box (stock-vials-per-box): stock is now counted in vials; PO
-- receiving converts box→vials. New column defaults to 10 for every existing row.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS vials_per_box integer NOT NULL DEFAULT 10;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_vials_per_box_check'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_vials_per_box_check CHECK (vials_per_box > 0);
  END IF;
END $$;

-- USD / vial pricing inputs the invoice form uses when re-pricing lines on a
-- currency toggle (§6 "Currency & pricing"). Additive & nullable; present on
-- most environments already — included so this migration is self-contained.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS price_usd  numeric;
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS vial_price numeric;

-- Single exchange rate consulted when a product has no explicit price_usd.
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS usd_exchange_rate numeric NOT NULL DEFAULT 1;


-- ----------------------------------------------------------------------------
-- 7. invoice_line_items.price_type  (vial-price-and-price-type)
-- ----------------------------------------------------------------------------
-- Per-line box vs vial pricing marker. New column → every existing line is 'box'.
ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS price_type text NOT NULL DEFAULT 'box';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_line_items_price_type_check'
  ) THEN
    ALTER TABLE invoice_line_items
      ADD CONSTRAINT invoice_line_items_price_type_check
      CHECK (price_type = ANY (ARRAY['box'::text, 'vial'::text]));
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 8. order_items.price_type  (carried from the invoice line on order sync)
-- ----------------------------------------------------------------------------
-- Nullable: legacy website orders have no price_type. CHECK allows NULL or box/vial.
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS price_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_items_price_type_check'
  ) THEN
    ALTER TABLE order_items
      ADD CONSTRAINT order_items_price_type_check
      CHECK (price_type IS NULL OR price_type = ANY (ARRAY['box'::text, 'vial'::text]));
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 9. customer_clients  (customer-clients-packing-list) — defensive
-- ----------------------------------------------------------------------------
-- Already present in live DB (invoices.client_id → customer_clients FK proves
-- it). Guarded on table existence so an environment that predates it still gets
-- the full table/index/trigger/RLS, while established DBs are left untouched.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'customer_clients'
  ) THEN
    CREATE TABLE public.customer_clients (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      first_name  text,
      last_name   text,
      address     text NOT NULL,
      city        text,
      state       text,
      postal_code text,
      country     text DEFAULT 'CA',
      phone       text,
      email       text,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_customer_clients_customer
      ON customer_clients (customer_id, created_at DESC);

    CREATE TRIGGER customer_clients_updated_at
      BEFORE UPDATE ON customer_clients
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    ALTER TABLE customer_clients ENABLE ROW LEVEL SECURITY;

    CREATE POLICY customer_clients_staff_read ON customer_clients
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM customers
          WHERE customers.id = auth.uid()
            AND customers.role IN ('admin', 'assistant', 'warehouse', 'affiliate')
        )
      );

    CREATE POLICY customer_clients_admin_write ON customer_clients
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM customers
          WHERE customers.id = auth.uid() AND customers.role = 'admin'
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM customers
          WHERE customers.id = auth.uid() AND customers.role = 'admin'
        )
      );
  END IF;
END $$;


-- ============================================================================
--  END — invoice-spec-integration-migration.sql
-- ============================================================================
