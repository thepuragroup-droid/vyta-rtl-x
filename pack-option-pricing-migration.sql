-- ============================================================
-- PACK OPTION PRICING — a price, a label and a compare-at per pack
-- ============================================================
--
-- Additive and idempotent: safe on a live database and safe to re-run.
--
-- Background. `products.pack_sizes` (pack-options-content-migration.sql) says
-- WHICH quantities a product is sold in — `{1,3,5,10}` — and the storefront
-- priced every one of them at `vial_price × size`, with no way to make a
-- 10-pack cheaper per vial than a single one.
--
-- This column says what each of those packs COSTS and what it is CALLED:
--
--   [
--     {"size":1,  "label":null,          "price":null, "compare_at":null, "enabled":true},
--     {"size":3,  "label":"3-pack",      "price":249,  "compare_at":267,  "enabled":true},
--     {"size":10, "label":"Best value",  "price":749,  "compare_at":null, "enabled":true}
--   ]
--
--   size        the pack quantity, in vials. Required, 1..1000, unique.
--   label       the storefront button's wording. NULL → "Single vial" / "Pack of N".
--   price       the pack's price. NULL → the derived vial price × size, so a
--               product whose price changes still reprices its packs at once.
--   compare_at  the struck-through "was" price. NULL and a discounted `price`
--               → the undiscounted vial × size figure is used automatically,
--               which is what puts a "save $18" under the pack on the PDP.
--   enabled     false keeps a pack configured but off the storefront.
--
-- Precedence (lib/pricing.ts): pack_options → pack_sizes → the historical pair
-- (a single vial plus one full case of vials_per_box). Nothing is backfilled,
-- so a catalog that never touches this column behaves exactly as it does now.
--
-- `pack_sizes` is NOT dropped: the cell-edit grid and the bulk Pack options
-- dialog still write it, and the product form keeps the two in sync.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS pack_options jsonb;

COMMENT ON COLUMN products.pack_options IS
  'Per-pack configuration: [{size, label, price, compare_at, enabled}]. NULL = fall back to pack_sizes, then to single vial + one case. A NULL price means the derived vial price x size.';

-- Shape guard. The API normalises before writing, so this is the backstop for
-- anything reaching the table another way: an array, every entry an object
-- carrying a positive whole `size`, and no negative money.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_pack_options_shape_chk'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_pack_options_shape_chk
      CHECK (
        pack_options IS NULL
        OR (
          jsonb_typeof(pack_options) = 'array'
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(pack_options) AS entry
            WHERE jsonb_typeof(entry) <> 'object'
               OR jsonb_typeof(entry -> 'size') <> 'number'
               OR (entry ->> 'size')::numeric < 1
               OR (entry ->> 'size')::numeric > 1000
               OR (entry ->> 'size')::numeric <> floor((entry ->> 'size')::numeric)
               OR (entry -> 'price' IS NOT NULL
                   AND jsonb_typeof(entry -> 'price') = 'number'
                   AND (entry ->> 'price')::numeric < 0)
               OR (entry -> 'compare_at' IS NOT NULL
                   AND jsonb_typeof(entry -> 'compare_at') = 'number'
                   AND (entry ->> 'compare_at')::numeric < 0)
          )
        )
      );
  END IF;
END $$;


-- ============================================================
-- VERIFY
-- ============================================================
--
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'products' AND column_name = 'pack_options';
--
-- SELECT name, pack_sizes, jsonb_pretty(pack_options)
--   FROM products WHERE pack_options IS NOT NULL;
