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
--   size        the pack quantity, in vials. Required, a whole 1..1000.
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


-- ---- Shape guard -------------------------------------------------------
--
-- The API normalises before writing, so this is the backstop for anything
-- reaching the table another way (a SQL console, a restore, a future import):
-- an array, every entry an object carrying a whole `size` in range, and no
-- negative money.
--
-- It lives in a FUNCTION rather than inline in the CHECK because a CHECK
-- constraint may not contain a subquery — `NOT EXISTS (SELECT … FROM
-- jsonb_array_elements(…))` inline is rejected outright with "cannot use
-- subquery in check constraint", and there is no way to walk a jsonb array
-- without one. A CHECK may call an IMMUTABLE function, which is the standard
-- way around it, and this one depends on nothing but its argument.
--
-- Two details that are easy to get wrong and are deliberate here:
--
--   * `IS DISTINCT FROM` rather than `<>`. A MISSING key makes `entry -> 'size'`
--     SQL NULL, and `NULL <> 'number'` is NULL, not true — which in a
--     NOT EXISTS reads as "no violation" and lets an entry with no size at all
--     through the guard that exists to catch it.
--
--   * The range tests sit inside CASE. Postgres does not promise to evaluate
--     an OR left to right, so an unguarded `(entry ->> 'size')::numeric` can
--     be evaluated against a non-numeric entry and raise a cast error instead
--     of failing the constraint cleanly.

CREATE OR REPLACE FUNCTION products_pack_options_valid(options jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT options IS NULL
     OR (
       jsonb_typeof(options) = 'array'
       AND NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(options) AS entry
         WHERE jsonb_typeof(entry) IS DISTINCT FROM 'object'
            OR jsonb_typeof(entry -> 'size') IS DISTINCT FROM 'number'
            OR CASE WHEN jsonb_typeof(entry -> 'size') = 'number' THEN
                    (entry ->> 'size')::numeric < 1
                 OR (entry ->> 'size')::numeric > 1000
                 OR (entry ->> 'size')::numeric <> floor((entry ->> 'size')::numeric)
               ELSE false END
            OR CASE WHEN jsonb_typeof(entry -> 'price') = 'number'
                 THEN (entry ->> 'price')::numeric < 0 ELSE false END
            OR CASE WHEN jsonb_typeof(entry -> 'compare_at') = 'number'
                 THEN (entry ->> 'compare_at')::numeric < 0 ELSE false END
       )
     );
$fn$;

COMMENT ON FUNCTION products_pack_options_valid(jsonb) IS
  'Backstop shape check for products.pack_options. Called by products_pack_options_shape_chk; a CHECK cannot hold the subquery this needs.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_pack_options_shape_chk'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_pack_options_shape_chk
      CHECK (products_pack_options_valid(pack_options));
  END IF;
END $$;


-- ============================================================
-- VERIFY
-- ============================================================
--
-- Column present:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'products' AND column_name = 'pack_options';
--
-- Constraint present (this is the one an earlier, broken version of this file
-- failed to create — if it returns no row, re-run this migration):
--   SELECT conname FROM pg_constraint
--    WHERE conname = 'products_pack_options_shape_chk';
--
-- Guard works (both should say true, then false):
--   SELECT products_pack_options_valid('[{"size":3,"price":249}]'::jsonb);
--   SELECT products_pack_options_valid(NULL);
--   SELECT products_pack_options_valid('[{"label":"no size"}]'::jsonb);
--
-- What is configured:
--   SELECT name, pack_sizes, jsonb_pretty(pack_options)
--     FROM products WHERE pack_options IS NOT NULL;
