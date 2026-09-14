-- ============================================================
-- SITE SETTINGS — base singleton
-- ============================================================
--
-- Global site configuration lives in ONE row of `site_settings`.
-- The table may already exist (see invoice-email-migration.sql); this
-- migration is written additively so it is safe to run in any order.
--
-- Adds:
--   * checkout_type ('email' | 'crypto', default 'crypto')
--   * admin_emails (jsonb [])  — operational notification recipients
--   * a singleton unique index so only one row can ever exist
--   * an updated_at trigger + service-role RLS policy
--   * a seed row

CREATE TABLE IF NOT EXISTS site_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS checkout_type TEXT NOT NULL DEFAULT 'crypto',
  ADD COLUMN IF NOT EXISTS admin_emails JSONB NOT NULL DEFAULT '[]'::jsonb;

-- checkout_type must be one of email|crypto
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'site_settings_checkout_type_chk'
  ) THEN
    ALTER TABLE site_settings
      ADD CONSTRAINT site_settings_checkout_type_chk
      CHECK (checkout_type IN ('email', 'crypto'));
  END IF;
END $$;

-- Singleton: only one row may exist.
CREATE UNIQUE INDEX IF NOT EXISTS site_settings_singleton ON site_settings ((true));

CREATE OR REPLACE FUNCTION update_site_settings_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS site_settings_updated_at ON site_settings;
CREATE TRIGGER site_settings_updated_at
  BEFORE UPDATE ON site_settings
  FOR EACH ROW EXECUTE FUNCTION update_site_settings_updated_at();

ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON site_settings;
CREATE POLICY "Service role full access" ON site_settings FOR ALL USING (true) WITH CHECK (true);

INSERT INTO site_settings (checkout_type, admin_emails)
VALUES ('email', '["codogmjo@gmail.com"]'::jsonb)
ON CONFLICT DO NOTHING;
