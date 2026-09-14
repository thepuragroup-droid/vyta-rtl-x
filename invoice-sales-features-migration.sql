-- ============================================================
-- INVOICE FEATURES MIGRATION
-- Adds:
--   * customer_name / customer_email / customer_phone snapshot on invoices
--   * sales_persons table
--   * Sales-person link + commission fields on invoices
--   * sales_commissions table (paid out workflow mirrors affiliate commissions)
-- ============================================================

-- ---- 1. Invoices: snapshot fields + sales person link ----
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS customer_name             text,
  ADD COLUMN IF NOT EXISTS customer_email            text,
  ADD COLUMN IF NOT EXISTS customer_phone            text,
  ADD COLUMN IF NOT EXISTS sales_person_id           uuid,
  ADD COLUMN IF NOT EXISTS sales_person_commission_rate  numeric(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sales_person_commission_amount numeric(10,2) DEFAULT 0;

-- ---- 2. Sales Persons ----
CREATE TABLE IF NOT EXISTS sales_persons (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name      text NOT NULL,
  last_name       text NOT NULL,
  email           text,
  phone           text,
  commission_rate numeric(5,2) NOT NULL DEFAULT 5.00,  -- default percent
  notes           text,
  active          boolean NOT NULL DEFAULT true,
  total_earnings  numeric(10,2) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- updated_at trigger (re-using helper added by inventory migration)
DROP TRIGGER IF EXISTS sales_persons_updated_at ON sales_persons;
CREATE TRIGGER sales_persons_updated_at
  BEFORE UPDATE ON sales_persons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- FK on invoices.sales_person_id (added after sales_persons exists)
DO $$ BEGIN
  ALTER TABLE invoices
    ADD CONSTRAINT invoices_sales_person_id_fkey
    FOREIGN KEY (sales_person_id) REFERENCES sales_persons(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_sales_person_id ON invoices(sales_person_id);

-- ---- 3. Sales commissions (parallel to affiliate "commissions") ----
CREATE TABLE IF NOT EXISTS sales_commissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_person_id uuid NOT NULL REFERENCES sales_persons(id) ON DELETE CASCADE,
  invoice_id      uuid REFERENCES invoices(id) ON DELETE SET NULL,
  amount          numeric(10,2) NOT NULL,
  invoice_total   numeric(10,2) NOT NULL,
  commission_rate numeric(5,2) NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'paid', 'cancelled')),
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_commissions_sales_person_id ON sales_commissions(sales_person_id);
CREATE INDEX IF NOT EXISTS idx_sales_commissions_invoice_id ON sales_commissions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_sales_commissions_status ON sales_commissions(status);
