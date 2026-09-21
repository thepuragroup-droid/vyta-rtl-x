-- ============================================================
-- CART UPSELLS — limited-time offer + frequently bought together
-- ============================================================
--
-- Three things the cart page needs, two of them operator-controlled:
--
--   1. The LIMITED-TIME OFFER strip at the top of the order summary: spend a
--      minimum number of items and a percentage comes off the order. On/off,
--      the minimum, the percentage and an optional end date all live on the
--      singleton `site_settings` row next to the promos that were already
--      there (free shipping, the paid-ads welcome discount).
--
--   2. FREQUENTLY BOUGHT TOGETHER — the operator's own pairings, curated per
--      product in /admin/cart-upsells and stored in `product_recommendations`.
--
--   3. "You may also like" needs no storage: it is computed from what people
--      actually buy together (see lib/products/recommendations.ts), so there
--      is nothing here for it beyond the toggle that hides the block.
--
-- All of it is additive and re-runnable.

-- ---- 1. Limited-time offer + which cart blocks are shown -------------------

ALTER TABLE site_settings
  -- The offer itself. Off by default: an install that has not configured a
  -- percentage must not start discounting orders on upgrade.
  ADD COLUMN IF NOT EXISTS cart_offer_enabled   boolean NOT NULL DEFAULT false,
  -- How many items (vials/packs counted as cart units) unlock it. Below this
  -- the strip shows how many more to add; at or above it the discount applies.
  ADD COLUMN IF NOT EXISTS cart_offer_min_items integer NOT NULL DEFAULT 2,
  -- Percent off the goods subtotal. Capped at 99 by the API for the same
  -- reason the ad discount is: a zero line price reads as "no price given" to
  -- the hosted checkout, which then charges its own list price.
  ADD COLUMN IF NOT EXISTS cart_offer_percent   numeric(5,2) NOT NULL DEFAULT 10,
  -- When the offer really stops. NULL = it runs until switched off and the
  -- cart shows no countdown; a timestamp is counted down on the cart AND
  -- enforced at hand-off, so the clock never lies about what will be charged.
  ADD COLUMN IF NOT EXISTS cart_offer_ends_at   timestamptz,

  -- The two merchandising blocks on the cart, independently switchable.
  ADD COLUMN IF NOT EXISTS cart_fbt_enabled     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cart_similar_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN site_settings.cart_offer_percent IS
  'Percent off the goods subtotal once a cart carries cart_offer_min_items. Stacks with ad_discount_percent — the two COMPOSE (25% then 10% = 32.5%), never add. See lib/promos/cart-offer.ts.';
COMMENT ON COLUMN site_settings.cart_offer_ends_at IS
  'When the offer stops. Counted down on the cart AND enforced at hand-off; NULL runs it until switched off, with no countdown shown.';

-- What a hosted order actually got, recorded next to the welcome discount's
-- own pair so a discounted order can be told from a cheaper cart when the
-- ledger is reconciled against the catalog. NULL on orders that earned none.
--
-- `ad_discount_cents` keeps its meaning: what the whole split took off. When
-- both promos land on one order the cents live there (the split is a single
-- one, at the composed percentage) and these two record the offer's own share
-- of the reason.
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS cart_offer_percent   numeric(5,2),
  ADD COLUMN IF NOT EXISTS cart_offer_min_items integer;

COMMENT ON COLUMN puramass_orders.cart_offer_percent IS
  'The limited-time cart offer applied to this order, in percent. NULL when it was not earned.';
COMMENT ON COLUMN puramass_orders.cart_offer_min_items IS
  'The item minimum in force when this order earned the offer — what the percentage was granted for.';

-- ---- 2. Frequently bought together ----------------------------------------
--
-- One row per pairing, directional: the recommendations shown for product A
-- are the rows with `product_id = A`. Directional rather than symmetric so an
-- operator can pair a cheap add-on onto a flagship without the flagship
-- turning up as an upsell under the add-on.
--
-- All writes go through service-role admin API routes (RLS bypass); the only
-- policy is public SELECT, so the cart can read the pairings.

CREATE TABLE IF NOT EXISTS product_recommendations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id             uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  recommended_product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- Display order within one product's list, ascending.
  sort_order             integer NOT NULL DEFAULT 0,
  -- Optional merchandising tag on the card ("Most Popular", "Best Value").
  badge                  text,
  -- Unticked pairings stay configured but are not offered.
  enabled                boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  -- A product cannot recommend itself, and a pairing exists at most once.
  CONSTRAINT product_recommendations_not_self CHECK (product_id <> recommended_product_id),
  CONSTRAINT product_recommendations_unique UNIQUE (product_id, recommended_product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_recommendations_product
  ON product_recommendations (product_id, sort_order);

CREATE OR REPLACE FUNCTION update_product_recommendations_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS product_recommendations_updated_at ON product_recommendations;
CREATE TRIGGER product_recommendations_updated_at
  BEFORE UPDATE ON product_recommendations
  FOR EACH ROW EXECUTE FUNCTION update_product_recommendations_updated_at();

ALTER TABLE product_recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Product recommendations are viewable by everyone" ON product_recommendations;
CREATE POLICY "Product recommendations are viewable by everyone" ON product_recommendations
  FOR SELECT USING (true);
-- No write policy: all writes go through service-role API routes (RLS bypass).
