-- ============================================================
-- PACK OPTIONS + STOREFRONT CONTENT (announcements, pages, articles)
-- ============================================================
--
-- One migration, four independent pieces. Every statement is additive and
-- idempotent, so this is safe to run on a live database and safe to re-run.
--
--   1. products.pack_sizes   — which pack quantities a product may be sold in
--   2. announcements         — the sticky site-wide banner
--   3. site_pages            — editable marketing pages (About Us is seeded)
--   4. articles              — the SEO article builder
--
-- Writes for 2-4 all go through service-role API routes (RLS bypass); the only
-- RLS policies here are public SELECT so the storefront can read them. The
-- admin routes do their own role checks (see lib/permissions.ts).


-- ============================================================
-- 1. PACK OPTIONS
-- ============================================================
--
-- A product is sold in packs of N vials. `pack_sizes` lists the pack
-- quantities the storefront offers for that product, e.g. '{1,3,5,10}'.
--
--   NULL  → the product has not been opted in; the storefront falls back to
--           the historical pair (single vial + one full case of
--           `vials_per_box`), so nothing changes for a catalog that never
--           touches this column.
--   '{}'  → treated exactly like NULL (the admin UI writes NULL instead).
--
-- Pricing is unchanged and stays derived: a pack of N costs
-- `vial_price × N` (lib/pricing.ts). There is no per-pack price column and no
-- pack discount — see case-price-remove-pack-discount-migration.sql.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS pack_sizes integer[];

COMMENT ON COLUMN products.pack_sizes IS
  'Pack quantities (in vials) this product may be sold in, e.g. {1,3,5,10}. NULL = fall back to single vial + one case of vials_per_box.';

-- Every entry must be a positive whole number. NULL and '{}' both pass.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_pack_sizes_positive_chk'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_pack_sizes_positive_chk
      CHECK (
        pack_sizes IS NULL
        OR NOT EXISTS (SELECT 1 FROM unnest(pack_sizes) AS s WHERE s < 1)
      );
  END IF;
END $$;


-- ============================================================
-- 2. ANNOUNCEMENTS — the sticky site-wide banner
-- ============================================================
--
-- Several announcements can exist at once; the storefront bar shows every row
-- that is `enabled` AND inside its optional start/end window, ordered by
-- sort_order. `scrolling` turns the bar into a marquee (which is also what a
-- long message wants on a phone).
--
-- `enabled` IS the storefront toggle the admin panel exposes.

CREATE TABLE IF NOT EXISTS announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message     text NOT NULL,
  -- Optional call to action rendered as a link at the end of the message.
  link_url    text,
  link_label  text,
  -- Presentation. `theme` picks one of the app's preset colour pairs
  -- (lib/content/announcements.ts); 'custom' uses bg_color / text_color.
  theme       text NOT NULL DEFAULT 'brand',
  bg_color    text,
  text_color  text,
  scrolling   boolean NOT NULL DEFAULT false,
  -- Marquee speed in seconds for one full pass (only read when scrolling).
  speed_seconds integer NOT NULL DEFAULT 24,
  dismissible boolean NOT NULL DEFAULT false,
  enabled     boolean NOT NULL DEFAULT false,   -- the storefront toggle
  sort_order  integer NOT NULL DEFAULT 0,
  starts_at   timestamptz,
  ends_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_announcements_enabled ON announcements (enabled);
CREATE INDEX IF NOT EXISTS idx_announcements_sort    ON announcements (sort_order);

CREATE OR REPLACE FUNCTION update_announcements_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS announcements_updated_at ON announcements;
CREATE TRIGGER announcements_updated_at
  BEFORE UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION update_announcements_updated_at();

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Announcements are viewable by everyone" ON announcements;
CREATE POLICY "Announcements are viewable by everyone" ON announcements
  FOR SELECT USING (true);


-- ============================================================
-- 3. SITE PAGES — editable marketing pages
-- ============================================================
--
-- `blocks` is the shared content-block document used by both pages and
-- articles (lib/content/blocks.ts): an ordered JSON array of typed blocks
-- (heading / paragraph / image / gallery / quote / list / callout / cta /
-- stats / video / divider). Editing and preview run off the same array, so
-- the admin preview is the storefront renderer.
--
-- `published` IS the storefront toggle: an unpublished page 404s for the
-- public and is still fully editable/previewable in the admin panel.

CREATE TABLE IF NOT EXISTS site_pages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  title           text NOT NULL,
  subtitle        text,
  hero_image_url  text,
  blocks          jsonb NOT NULL DEFAULT '[]'::jsonb,
  seo_title       text,
  seo_description text,
  published       boolean NOT NULL DEFAULT false,  -- the storefront toggle
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_pages_published ON site_pages (published);

CREATE OR REPLACE FUNCTION update_site_pages_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS site_pages_updated_at ON site_pages;
CREATE TRIGGER site_pages_updated_at
  BEFORE UPDATE ON site_pages
  FOR EACH ROW EXECUTE FUNCTION update_site_pages_updated_at();

ALTER TABLE site_pages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Site pages are viewable by everyone" ON site_pages;
CREATE POLICY "Site pages are viewable by everyone" ON site_pages
  FOR SELECT USING (true);

-- Seed About Us with real starter copy so the page is editable (and
-- previewable) the moment the admin screen opens. ON CONFLICT DO NOTHING so a
-- re-run never overwrites edited copy.
INSERT INTO site_pages (slug, title, subtitle, blocks, seo_title, seo_description, published)
VALUES (
  'about',
  'About VYTA Biosciences',
  'Research-grade peptides, tested batch by batch.',
  '[
    {"id":"b1","type":"heading","level":2,"text":"Who we are"},
    {"id":"b2","type":"paragraph","text":"VYTA Biosciences supplies research-grade peptides to laboratories, clinics and independent researchers. Every product we list is sourced from vetted manufacturing partners and released only after third-party analysis."},
    {"id":"b3","type":"heading","level":2,"text":"What we stand for"},
    {"id":"b4","type":"list","style":"bullet","items":["Third-party tested — a certificate of analysis for every batch we ship.","Cold-chain handling from the moment a batch lands with us.","Clear documentation: purity, mass and identity, published alongside the product.","Fast, tracked worldwide shipping with responsive human support."]},
    {"id":"b5","type":"callout","tone":"info","title":"Research use only","text":"All products are intended strictly for laboratory research. They are not drugs, food additives or cosmetics, and are not for human or veterinary use."},
    {"id":"b6","type":"cta","text":"Questions about a batch or a certificate? Our team answers every message.","button_label":"Contact us","button_url":"/contact"}
  ]'::jsonb,
  'About VYTA Biosciences',
  'Who we are, how we test, and why researchers trust VYTA Biosciences for research-grade peptides.',
  true
)
ON CONFLICT (slug) DO NOTHING;


-- ============================================================
-- 4. ARTICLES — the SEO article builder
-- ============================================================
--
-- Same `blocks` document as site_pages. `status` is the storefront toggle:
-- only 'published' rows are served publicly, and only when published_at has
-- passed (a NULL published_at is stamped by the API on first publish).
--
-- `tags` drives the index page's filter chips; `featured` promotes an article
-- to the top of the index.

CREATE TABLE IF NOT EXISTS articles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE,
  title            text NOT NULL,
  excerpt          text,
  cover_image_url  text,
  author           text,
  category         text,
  tags             text[] NOT NULL DEFAULT '{}',
  blocks           jsonb NOT NULL DEFAULT '[]'::jsonb,
  status           text NOT NULL DEFAULT 'draft',   -- 'draft' | 'published'
  featured         boolean NOT NULL DEFAULT false,
  reading_minutes  integer NOT NULL DEFAULT 1,
  seo_title        text,
  seo_description  text,
  published_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'articles_status_chk') THEN
    ALTER TABLE articles
      ADD CONSTRAINT articles_status_chk CHECK (status IN ('draft', 'published'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_articles_status    ON articles (status);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_featured  ON articles (featured);

CREATE OR REPLACE FUNCTION update_articles_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS articles_updated_at ON articles;
CREATE TRIGGER articles_updated_at
  BEFORE UPDATE ON articles
  FOR EACH ROW EXECUTE FUNCTION update_articles_updated_at();

ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Articles are viewable by everyone" ON articles;
CREATE POLICY "Articles are viewable by everyone" ON articles
  FOR SELECT USING (true);


-- ============================================================
-- VERIFY
-- ============================================================
--
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'products' AND column_name = 'pack_sizes';
-- SELECT slug, published FROM site_pages;
-- SELECT count(*) FROM announcements;
-- SELECT slug, status FROM articles ORDER BY created_at DESC;
