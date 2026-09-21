-- ============================================================
-- PRODUCT REVIEWS + TESTIMONIALS
-- ============================================================
--
-- Additive and idempotent: safe on a live database and safe to re-run.
--
-- Two separate things that both put a star rating on the storefront, and they
-- are separate on purpose:
--
--   product_reviews  written by customers, about ONE product, and only after
--                    they have actually bought it. The storefront shows the
--                    average and the count on every product card; the product
--                    page shows the reviews themselves.
--
--   testimonials     written by staff in Admin → Testimonials, about the shop
--                    rather than a product. Nothing on the storefront can
--                    create one — it is marketing copy, and the homepage
--                    carousel reads it.
--
-- The "has actually bought it" check is NOT enforced here. It cannot be: the
-- purchase lives in `orders.items` (JSONB) or `order_items`, and proving it
-- needs the order rows, which a customer's own token cannot read. So the
-- insert goes through /api/reviews with the service role, which resolves the
-- buyer from their bearer token and refuses a product they never ordered.
-- The RLS below is written to match that: readable by everyone, writable by
-- nobody holding an anon or customer key.


-- ============================================================
-- 1. PRODUCT REVIEWS
-- ============================================================

CREATE TABLE IF NOT EXISTS product_reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_id  uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  -- The order the entitlement came from, kept so a dispute can be traced back
  -- to a real purchase. Nullable: an order can be deleted without taking an
  -- honest review with it.
  order_id     uuid REFERENCES orders(id) ON DELETE SET NULL,

  rating       integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title        text,
  body         text,

  -- Display name, snapshotted at write time: "Sarah M." rather than a join to
  -- customers, so the storefront never reads the customer table and a later
  -- name change does not silently rewrite an old review.
  author_name  text NOT NULL DEFAULT 'Verified Customer',

  -- Every row here is by definition a verified purchase (see above), but the
  -- column is explicit so a future "seeded review" import cannot quietly
  -- inherit the badge.
  verified     boolean NOT NULL DEFAULT true,

  -- 'published' | 'hidden'. Hiding is how a review comes off the storefront;
  -- deleting a customer's words should be a deliberate act, not moderation.
  status       text NOT NULL DEFAULT 'published',

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- One review per customer per product. A second submission updates the
  -- first (the API upserts on this), so nobody can stack five-star ratings.
  CONSTRAINT product_reviews_one_per_customer UNIQUE (product_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_product_reviews_product
  ON product_reviews (product_id, status);
CREATE INDEX IF NOT EXISTS idx_product_reviews_customer
  ON product_reviews (customer_id);

CREATE OR REPLACE FUNCTION update_product_reviews_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS product_reviews_updated_at ON product_reviews;
CREATE TRIGGER product_reviews_updated_at
  BEFORE UPDATE ON product_reviews
  FOR EACH ROW EXECUTE FUNCTION update_product_reviews_updated_at();

ALTER TABLE product_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Published reviews are viewable by everyone" ON product_reviews;
CREATE POLICY "Published reviews are viewable by everyone" ON product_reviews
  FOR SELECT USING (status = 'published');


-- ------------------------------------------------------------
-- The rollup every product card reads
-- ------------------------------------------------------------
--
-- A card needs "4.8 (128)", not 128 rows. `security_invoker` keeps the view
-- honest: it applies the caller's RLS, so a hidden review is excluded from
-- the average for the public exactly as it is from the list.

DROP VIEW IF EXISTS product_review_stats;
CREATE VIEW product_review_stats
  WITH (security_invoker = true)
AS
  SELECT
    product_id,
    COUNT(*)::integer                     AS review_count,
    ROUND(AVG(rating)::numeric, 2)        AS average_rating
  FROM product_reviews
  WHERE status = 'published'
  GROUP BY product_id;

GRANT SELECT ON product_review_stats TO anon, authenticated;


-- ============================================================
-- 2. TESTIMONIALS
-- ============================================================
--
-- `enabled` IS the storefront toggle, the same way it is for announcements:
-- turning a quote off never means deleting it.

CREATE TABLE IF NOT EXISTS testimonials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote         text NOT NULL,
  author_name   text NOT NULL DEFAULT 'Verified Customer',
  -- The line under the name — "Verified Customer", "Clinic Partner", a city.
  author_label  text,
  rating        integer NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  enabled       boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_testimonials_enabled
  ON testimonials (enabled, sort_order);

CREATE OR REPLACE FUNCTION update_testimonials_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS testimonials_updated_at ON testimonials;
CREATE TRIGGER testimonials_updated_at
  BEFORE UPDATE ON testimonials
  FOR EACH ROW EXECUTE FUNCTION update_testimonials_updated_at();

ALTER TABLE testimonials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Testimonials are viewable by everyone" ON testimonials;
CREATE POLICY "Testimonials are viewable by everyone" ON testimonials
  FOR SELECT USING (true);


-- ============================================================
-- VERIFY
-- ============================================================
--
-- SELECT COUNT(*) FROM product_reviews;
-- SELECT * FROM product_review_stats ORDER BY review_count DESC LIMIT 10;
-- SELECT quote, author_name, enabled, sort_order FROM testimonials ORDER BY sort_order;
