-- ============================================================
-- MARKETING — branding + tracking columns on the site_settings singleton
-- ============================================================
--
-- `site_settings` is a singleton row (see migration-site-settings.sql). These
-- columns are edited through the SEPARATE /api/admin/marketing endpoint (gated
-- by canManageMarketing), NOT the main admin-only /api/admin/settings — so the
-- marketing role never gains access to API keys / operational emails.
--
-- Branding: store_name / store_tagline / logo_url / favicon_url.
-- Tracking:  ga4_measurement_id (G-XXXXXXXXXX) / meta_pixel_id (numeric) /
--            tracking_consent_required (GDPR consent gate; default true).

ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS store_name    text,
  ADD COLUMN IF NOT EXISTS store_tagline text,
  ADD COLUMN IF NOT EXISTS logo_url      text,
  ADD COLUMN IF NOT EXISTS favicon_url   text,
  ADD COLUMN IF NOT EXISTS ga4_measurement_id text,        -- G-XXXXXXXXXX
  ADD COLUMN IF NOT EXISTS meta_pixel_id       text,        -- numeric pixel id
  ADD COLUMN IF NOT EXISTS tracking_consent_required boolean NOT NULL DEFAULT true;
