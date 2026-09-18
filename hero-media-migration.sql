-- ============================================================
-- HOME-PAGE HERO MEDIA — editable background clip + still
-- ============================================================
--
-- Additive and idempotent: safe on a live database and safe to re-run.
--
-- The hero's background video and still were constants in components/Hero.tsx,
-- so changing the first screen of the site meant a code change and a deploy.
-- These two columns move them onto the `site_settings` singleton, beside the
-- rest of the branding, and they are edited in Admin → Branding & Tracking
-- (the /api/admin/marketing endpoint, gated by canManageMarketing — never the
-- admin-only settings route that holds API keys).
--
--   hero_video_url  the background clip. NULL runs the hero on the still
--                   alone, which is also what phones, reduced-motion visitors
--                   and slow connections get regardless.
--   hero_image_url  the still behind it. NULL uses the shipped
--                   /images/hero-bg.jpeg.
--
-- Both NULL by default, so a store that never touches them looks exactly as it
-- does today.

ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS hero_video_url text,
  ADD COLUMN IF NOT EXISTS hero_image_url text;

COMMENT ON COLUMN site_settings.hero_video_url IS
  'Home-page hero background clip (muted, looping MP4/WebM). NULL = still image only.';
COMMENT ON COLUMN site_settings.hero_image_url IS
  'Home-page hero still, and the mobile / reduced-motion / slow-connection fallback. NULL = the shipped image.';


-- ============================================================
-- VERIFY
-- ============================================================
--
-- SELECT hero_video_url, hero_image_url FROM site_settings;
