-- ============================================================
-- STOCK NOTIFICATIONS (back-in-stock waitlist)
-- ============================================================
--
-- Customers subscribe to an out-of-stock product; when it is restocked
-- (0 -> positive edge) the admin product PATCH fans out an email to every
-- pending row and flips it to 'notified'. Emails are stored lower-cased so
-- the partial-unique index gives case-insensitive idempotent subscribes.

CREATE TABLE IF NOT EXISTS stock_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'notified' | 'cancelled'
  created_at TIMESTAMPTZ DEFAULT now(),
  notified_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_stock_notifications_pending
  ON stock_notifications (product_id, email) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_stock_notifications_product
  ON stock_notifications (product_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_stock_notifications_status
  ON stock_notifications (status);

ALTER TABLE stock_notifications ENABLE ROW LEVEL SECURITY;

-- Service-role routes are the boundary; allow service-role full access.
DROP POLICY IF EXISTS "Service role full access on stock notifications" ON stock_notifications;
CREATE POLICY "Service role full access on stock notifications"
  ON stock_notifications FOR ALL USING (true) WITH CHECK (true);
