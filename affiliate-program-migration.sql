-- Affiliate program: role binding + request/approve lifecycle.
-- NOTE: run the ALTER TYPE statement on its own first — ADD VALUE cannot
-- share a transaction with the statements that use the new enum value.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'affiliate';

-- Bind a customer to the affiliate that referred them.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS affiliate_id uuid REFERENCES affiliates (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_customers_affiliate_id
  ON customers (affiliate_id) WHERE affiliate_id IS NOT NULL;

-- Link a sales_person row back to the customer/affiliate that owns it.
ALTER TABLE sales_persons
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES customers (id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sales_persons_user_id
  ON sales_persons (user_id) WHERE user_id IS NOT NULL;

-- Customer "apply to become an affiliate" requests.
CREATE TABLE IF NOT EXISTS affiliate_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied')),
  wallet_address text,
  message text,
  reviewed_by uuid REFERENCES customers (id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One pending request per customer (duplicate POSTs are idempotent).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_affiliate_request_pending
  ON affiliate_requests (customer_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_affiliate_requests_status ON affiliate_requests (status);

ALTER TABLE affiliate_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read affiliate_requests" ON affiliate_requests;
CREATE POLICY "Admins read affiliate_requests"
  ON affiliate_requests FOR SELECT USING (
    EXISTS (SELECT 1 FROM customers c
            WHERE c.id = auth.uid() AND c.role IN ('admin', 'assistant'))
  );
-- Writes happen via the service-role key (API routes); no client write policy.
