-- ============================================================
-- PACK OPTION BADGE — a merchandising tag per pack
-- ============================================================
--
-- Additive, idempotent, and NO schema change: `products.pack_options` is
-- already jsonb (pack-option-pricing-migration.sql) and its shape constraint
-- only checks `size` and the money keys, so an extra `badge` key on each row
-- stores without touching the table.
--
-- This file exists to record the key and refresh the column comment.
--
--   [
--     {"size":1,  "label":null, "badge":null,           "price":null, "compare_at":null, "enabled":true},
--     {"size":3,  "label":null, "badge":"Most Popular", "price":249,  "compare_at":267,  "enabled":true},
--     {"size":10, "label":null, "badge":"Best Value",   "price":749,  "compare_at":null, "enabled":true}
--   ]
--
--   badge  the chip pinned to that pack's corner on the product page. NULL or
--          blank = no chip. Free text, trimmed and capped at 24 characters by
--          lib/pricing.ts `normalizePackOptions`; "Most Popular" and "Best
--          Value" are one-click presets in Admin → Products → Pack options &
--          pricing → Tag, not an enum.
--
-- Nothing is backfilled: every existing row keeps behaving exactly as it does
-- now, with no tag until an operator sets one.

COMMENT ON COLUMN products.pack_options IS
  'Per-pack configuration: [{size, label, badge, price, compare_at, enabled}]. NULL = fall back to pack_sizes, then to single vial + one case. A NULL price means the derived vial price x size. badge is the storefront chip on the pack picker (e.g. "Most Popular", "Best Value"), NULL for none.';


-- ============================================================
-- VERIFY
-- ============================================================
--
-- SELECT name, jsonb_pretty(pack_options)
--   FROM products
--  WHERE pack_options @> '[{"badge": "Most Popular"}]';
