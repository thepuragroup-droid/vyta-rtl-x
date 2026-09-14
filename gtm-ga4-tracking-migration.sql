-- ============================================================
-- GTM — Google Tag Manager container on the site_settings singleton
-- ============================================================
--
-- Adds the container column alongside the existing tracking columns from
-- marketing-branding-migration.sql, and seeds Aminocan's own tags:
--
--   GTM container      GTM-M2J3D7SG
--   GA4 measurement id G-F44F1BB1QV
--
-- Edited through /api/admin/marketing (Admin → Branding & Tracking), gated by
-- canManageMarketing. The value is a PUBLIC client-side identifier — it is
-- served by the public /api/site-config route, same as the GA4 / Pixel ids.
--
-- Seeding is idempotent: only rows that have no value yet are filled in, so
-- re-running never clobbers an id set through the admin UI.

ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS gtm_container_id text;   -- GTM-XXXXXXX

COMMENT ON COLUMN site_settings.gtm_container_id IS
  'Google Tag Manager container id (GTM-XXXXXXX). Public client-side identifier.';

-- Seed the singleton. `site_settings` holds exactly one row; if it does not
-- exist yet the row is created with the same defaults the app assumes.
UPDATE site_settings
   SET gtm_container_id    = COALESCE(NULLIF(TRIM(gtm_container_id), ''), 'GTM-M2J3D7SG'),
       ga4_measurement_id  = COALESCE(NULLIF(TRIM(ga4_measurement_id), ''), 'G-F44F1BB1QV');

INSERT INTO site_settings (checkout_type, gtm_container_id, ga4_measurement_id)
SELECT 'crypto', 'GTM-M2J3D7SG', 'G-F44F1BB1QV'
WHERE NOT EXISTS (SELECT 1 FROM site_settings);
