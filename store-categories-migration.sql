-- ============================================================
-- STORE CATEGORIES — controlled storefront taxonomy
-- ============================================================
--
-- A controlled category list that drives the /products filter bar and the
-- homepage category grid. `slug` is the stable key and equals products.category
-- (a free-text string join — there is NO foreign key). `slug` is never edited
-- after creation, so renaming a category can never orphan products.
--
-- All writes go through service-role API routes (RLS bypass); the only RLS
-- policy is public SELECT so the storefront can read the list.

CREATE TABLE IF NOT EXISTS store_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,            -- stable key; equals products.category
  name        text NOT NULL,                   -- the single label: /products filter bar + homepage grid
  description text,                            -- optional homepage subtitle
  icon        text NOT NULL DEFAULT 'Beaker',  -- Lucide icon NAME, mapped on the client
  sort_order  integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,   -- show in the /products filter bar
  featured    boolean NOT NULL DEFAULT false,  -- show on the homepage grid
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The homepage grid now shows the same `name` as the filter bar (no separate
-- homepage label). Drop the legacy column for tables created before this change.
ALTER TABLE store_categories DROP COLUMN IF EXISTS home_label;

CREATE INDEX IF NOT EXISTS idx_store_categories_sort     ON store_categories (sort_order);
CREATE INDEX IF NOT EXISTS idx_store_categories_active   ON store_categories (active);
CREATE INDEX IF NOT EXISTS idx_store_categories_featured ON store_categories (featured);

-- Keep updated_at fresh on edits.
CREATE OR REPLACE FUNCTION update_store_categories_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS store_categories_updated_at ON store_categories;
CREATE TRIGGER store_categories_updated_at
  BEFORE UPDATE ON store_categories
  FOR EACH ROW EXECUTE FUNCTION update_store_categories_updated_at();

ALTER TABLE store_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Store categories are viewable by everyone" ON store_categories;
CREATE POLICY "Store categories are viewable by everyone" ON store_categories
  FOR SELECT USING (true);
-- No write policy: all writes go through service-role API routes (RLS bypass).

-- Seed the historical hardcoded lists exactly. The 6 `featured` rows are the
-- homepage grid (in sort_order); all 9 are the /products filter bar. Upsert on
-- slug so re-runs refresh descriptors without changing a slug's identity.
INSERT INTO store_categories (slug, name, description, icon, sort_order, active, featured) VALUES
  ('Weight Loss / Metabolic', 'Metabolic',      'GLP-1 Agonists',    'TestTube', 1, true, true),
  ('Healing / Recovery',      'Healing',        'Tissue Repair',     'Heart',    2, true, true),
  ('Anti-Aging / Beauty',     'Anti-Aging',     'Cellular Health',   'Sparkles', 3, true, true),
  ('Bodybuilding / Fitness',  'Performance',    'Growth Factors',    'Dna',      4, true, true),
  ('Cognitive / Focus',       'Cognitive',      'Neuropeptides',     'Brain',    5, true, true),
  ('Sexual Health',           'Sexual Health',  NULL,                'Zap',      6, true, false),
  ('General Health',          'General Health', 'Clinical Peptides', 'Pill',     7, true, true),
  ('Hormonal / Fertility',    'Hormonal',       NULL,                'Scale',    8, true, false),
  ('Beauty / Tanning',        'Tanning',        NULL,                'Sparkles', 9, true, false)
ON CONFLICT (slug) DO UPDATE SET
  name=EXCLUDED.name, description=EXCLUDED.description,
  icon=EXCLUDED.icon, sort_order=EXCLUDED.sort_order, active=EXCLUDED.active,
  featured=EXCLUDED.featured, updated_at=now();
