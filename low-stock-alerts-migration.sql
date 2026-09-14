-- ============================================================
-- LOW-STOCK ALERTS
-- ============================================================
--
-- Adds a per-product reorder threshold and a dedupe flag so the admin
-- low-stock alert system (lib/admin/low-stock.ts) can fire exactly one
-- email per downward crossing and re-arm when stock recovers.
--
-- Also adds a `site_settings.admin_emails` recipient list for operational
-- alerts (low-stock, etc.), distinct from the invoice CC list.

ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_threshold integer;
ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_alerted boolean NOT NULL DEFAULT false;

UPDATE products SET low_stock_threshold = 10 WHERE low_stock_threshold IS NULL;
ALTER TABLE products ALTER COLUMN low_stock_threshold SET DEFAULT 10;
ALTER TABLE products ALTER COLUMN low_stock_threshold SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_low_stock ON products (low_stock_threshold);

COMMENT ON COLUMN products.low_stock_threshold IS 'Stock level at/below which a low-stock alert fires. Defaults to 10.';
COMMENT ON COLUMN products.low_stock_alerted IS 'True once a low-stock alert has been sent; reset when stock rises above the threshold.';

-- Operational alert recipients (low-stock, etc.). Falls back to the
-- ADMIN_ALERT_EMAILS env var / invoice_cc_emails when empty (see lib/email.ts).
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS admin_emails jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN site_settings.admin_emails IS 'Recipient list for operational admin alerts such as low-stock notifications.';
