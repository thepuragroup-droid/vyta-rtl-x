-- ============================================================
-- Paid-ads welcome discount
-- ============================================================
--
-- Someone who arrives on a Google / Meta / Bing / TikTok / LinkedIn ad and
-- creates an account gets a percentage off the goods subtotal of their FIRST
-- hosted checkout. The offer is advertised on a strip under the nav bar,
-- restated on the cart and checkout screens, and settled server-side at hand-off
-- by lowering each line's unit price before the PuraMass order is created (the
-- hosted order has no discount field — see lib/promos/ad-discount.ts).
--
-- Who qualifies is decided from the attribution already being collected by
-- marketing-attribution-migration.sql: the first/last touch cookies
-- `middleware.ts` writes, and `customers.attribution_channel` frozen at signup.
-- Nothing new is captured here.
--
-- It is a WELCOME offer, so it also has to be their first order. That is read
-- from records this store already keeps (lib/promos/first-order.ts): the
-- `customers.has_completed_first_order` flag the legacy checkout maintains, and
-- this customer's own rows in `puramass_orders`. No column is added for it.
--
-- Adds:
--   1. site_settings.ad_discount_enabled     — the admin toggle (Admin → Promotions)
--   2. site_settings.ad_discount_percent     — how much off, in percent
--   3. puramass_orders.ad_discount_percent   — what was applied to this order
--   4. puramass_orders.ad_discount_cents     — what it took off, in cents
--
-- Idempotent: safe to re-run. Every call site reads these columns defensively
-- (lib/promos/ad-discount.ts defaults the promo OFF when they are absent, and
-- the ledger insert sheds the columns it is told the database doesn't know), so
-- the storefront keeps working unchanged until this has been run.
--
-- Run this in the Supabase SQL editor (same as every other *-migration.sql).

-- 1. The promo itself, on the singleton site_settings row -----------------
-- ON by default: this migration exists because the store wants the offer
-- running. Turn it off in Admin → Promotions rather than by editing the column.
--
-- The code defaults it to OFF when the column is missing, so the window between
-- deploying and running this migration discounts nothing rather than
-- discounting blind.
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS ad_discount_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN site_settings.ad_discount_enabled IS
  'Give signed-in visitors who arrived on a paid ad ad_discount_percent off their FIRST hosted checkout.';

-- 1b. How much off -------------------------------------------------------
-- Percent of the goods subtotal, before shipping and before tax. 25 is the
-- launch offer; it is a setting rather than a constant so a marketer can change
-- it without a deploy. A zero forces the promo off in code no matter what the
-- toggle above says, so the storefront can never advertise an empty offer.
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS ad_discount_percent NUMERIC NOT NULL DEFAULT 25;

COMMENT ON COLUMN site_settings.ad_discount_percent IS
  'Percent off the goods subtotal for the paid-ads welcome discount. 0 disables it.';

-- 2. What was actually applied to each hosted order ----------------------
-- Recorded at hand-off. The discount reaches PuraMass baked into the line
-- prices, so without these columns there is no way to tell a discounted order
-- from a cheaper cart when reconciling settlement against the catalog.
--
-- `ad_discount_cents` is what the split really took off, which can be a cent or
-- two above the exact percentage: per-unit integer prices cannot always land on
-- it, and the rounding goes the buyer's way.
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS ad_discount_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS ad_discount_cents INTEGER;

COMMENT ON COLUMN puramass_orders.ad_discount_percent IS
  'Paid-ads welcome discount applied to this order, in percent. Null when none was.';
COMMENT ON COLUMN puramass_orders.ad_discount_cents IS
  'What that discount took off the goods subtotal, in cents of `currency`.';
