-- ============================================================
-- INVOICE EMAIL
-- ============================================================
--
-- Adds:
--   * site_settings singleton with invoice CC list + editable templates
--   * last-emailed tracking columns on invoices
--   * invoice_email_log (one row per send attempt, success or failure)
--
-- Email is sent via Resend (see lib/email.ts); templates also have
-- application-level defaults so the system works when columns are NULL.

-- ---- 1. site_settings (singleton) ----
CREATE TABLE IF NOT EXISTS site_settings (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_cc_emails             jsonb NOT NULL DEFAULT '[]'::jsonb,
  invoice_customer_email_subject text,
  invoice_customer_email_body    text,
  invoice_admin_email_subject    text,
  invoice_admin_email_body       text,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS site_settings_updated_at ON site_settings;
CREATE TRIGGER site_settings_updated_at
  BEFORE UPDATE ON site_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- 2. last-emailed tracking on invoices ----
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS last_emailed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS last_emailed_by       uuid,
  ADD COLUMN IF NOT EXISTS last_emailed_by_email text;

CREATE INDEX IF NOT EXISTS idx_invoices_last_emailed_at ON invoices(last_emailed_at);

-- ---- 3. send log ----
CREATE TABLE IF NOT EXISTS invoice_email_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  sent_by       uuid,
  sent_by_email text,
  to_email      text,
  bcc_emails    jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject       text,
  message_id    text,
  success       boolean NOT NULL DEFAULT false,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_email_log_invoice_id ON invoice_email_log(invoice_id);

-- ---- 4. RLS (service-role bypass; admin read) ----
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_email_log ENABLE ROW LEVEL SECURITY;
