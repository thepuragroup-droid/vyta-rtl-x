-- ============================================================
-- KLAVIYO — email/SMS marketing integration settings
-- ============================================================
--
-- Adds the Klaviyo configuration to the site_settings singleton. Edited in
-- Admin → Settings → Klaviyo (PUT /api/admin/settings, admin only).
--
--   klaviyo_private_api_key  SECRET (pk_…). Write-only: the settings API only
--                            ever reports whether it is set, never its value.
--                            KLAVIYO_PRIVATE_API_KEY in the environment is the
--                            fallback when this is empty.
--   klaviyo_public_key       PUBLIC 6-character "Site ID" / company id. Served
--                            by /api/site-config so the storefront can load
--                            klaviyo.js (onsite tracking + signup forms).
--   klaviyo_list_id          The list consenting signups are subscribed to.
--
-- Idempotent: safe to re-run.

ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS klaviyo_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS klaviyo_private_api_key TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS klaviyo_public_key TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS klaviyo_list_id TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS klaviyo_onsite_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS klaviyo_server_events_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS klaviyo_sync_signups BOOLEAN DEFAULT true;

COMMENT ON COLUMN site_settings.klaviyo_private_api_key IS
  'Klaviyo private API key (pk_…). Never returned by any settings endpoint.';
COMMENT ON COLUMN site_settings.klaviyo_public_key IS
  'Klaviyo public API key / Site ID (6 chars). Public client-side identifier.';
COMMENT ON COLUMN site_settings.klaviyo_list_id IS
  'Klaviyo list id that customers who gave marketing consent are subscribed to.';
