-- Currency support: track CAD vs USD on invoices and tag each customer with
-- the currency they are billed in.
--
-- • invoices.currency        — the currency an invoice is denominated in.
-- • customers.preferred_currency — the currency a customer sees prices in;
--   new invoices default to this when the customer is linked.
--
-- Both default to 'CAD' so existing rows keep their current (Canadian) meaning.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'CAD';

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS preferred_currency text NOT NULL DEFAULT 'CAD';

-- Constrain to the two supported currencies.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_currency_check'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_currency_check CHECK (currency IN ('CAD', 'USD'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_preferred_currency_check'
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT customers_preferred_currency_check CHECK (preferred_currency IN ('CAD', 'USD'));
  END IF;
END $$;

-- Reporting helper: revenue by currency benefits from an index on invoices.currency.
CREATE INDEX IF NOT EXISTS idx_invoices_currency ON invoices (currency);
