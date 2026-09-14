-- ============================================================
-- CASE PRICING — REMOVE THE 20% PACK DISCOUNT
-- ============================================================
--
-- The catalog pricing rule is now:
--
--     products.price = vial_price * vials_per_box
--
-- Previously the pack carried a 20% discount, so `products.price`
-- held `vial_price * vials_per_box * 0.8`. Dropping that discount
-- means every pack price rises 25% back to its list figure while
-- the per-vial price is unchanged:
--
--     vial $12.50  ->  pack $100.00 (old)  ->  pack $125.00 (new)
--
-- The app no longer applies or displays a pack discount, so the
-- catalog rows have to be recomputed to match.

-- ------------------------------------------------------------
-- 1. `vial_price = 0` on a product that HAS a pack price
-- ------------------------------------------------------------
-- A stored zero is not a real per-vial price — it is an unset
-- override that was written as 0 instead of NULL. Taken literally
-- the storefront quotes those products at $0.00 / vial and
-- $0.00 / pack. NULL is the column's "auto" value, so the vial
-- price is derived from the pack price instead:
--
--   Semx 10mg + Selnk 10mg   $1000 pack -> $100.00 / vial
--   Oxytocin Acetate 10mg    $1120 pack -> $112.00 / vial
--
-- Their pack prices are left as-is — with no explicit vial price
-- there is nothing to recompute them from, and they already read
-- as the pack figure. Products with no pack price either (MISC,
-- Tirz 50mg, Testagen 20mg, Alprostadil 20mcg, Tirz 60mg) are
-- untouched and still resolve to 0.

UPDATE products
   SET vial_price = NULL
 WHERE vial_price = 0
   AND price > 0;

-- ------------------------------------------------------------
-- 2. Drop the 20% out of every pack price
-- ------------------------------------------------------------
-- Only rows that currently satisfy the OLD rule are recomputed —
-- those are the ones we know were priced as "vial x N less 20%",
-- so re-deriving them is safe and loses nothing. 116 of the 126
-- catalog rows qualify.
--
-- The three rows whose two price columns disagree are deliberately
-- NOT matched by this WHERE clause; see section 3.
--
-- Safe to re-run: after the update `price` no longer equals
-- `vial_price * vials_per_box * 0.8`, so a second run matches
-- nothing.

UPDATE products
   SET price = ROUND(vial_price * vials_per_box, 2)
 WHERE vial_price IS NOT NULL
   AND vial_price > 0
   AND price > 0
   AND ABS(price - ROUND(vial_price * vials_per_box * 0.8, 2)) <= 0.01;

-- ------------------------------------------------------------
-- 3. STILL NEEDS A DECISION — rows whose columns disagree
-- ------------------------------------------------------------
-- These three never satisfied the old rule either, so we cannot
-- tell which column is stale. Section 2 skips them on purpose:
-- applying the rule blind would move a live price by a large
-- multiple in each case.
--
--                  current pack   current vial   if vial is right   if pack is right
--   Pinaleon 20mg   $800.00        $6.80          pack -> $68.00     vial -> $80.00
--   DSIP 15mg       $225.00        $112.50        pack -> $1125.00   vial -> $22.50
--   Aicar 50mg      $490.00        $65.00         pack -> $650.00    vial -> $49.00
--
-- Pinaleon's $6.80 in particular looks like a typo — taking it at
-- face value turns an $800 product into a $68 one.
--
-- Uncomment the line that is correct for each product.

-- -- Trust the VIAL price (pack price recomputed):
-- UPDATE products SET price = ROUND(vial_price * vials_per_box, 2)
--  WHERE name = 'DSIP 15mg';
-- UPDATE products SET price = ROUND(vial_price * vials_per_box, 2)
--  WHERE name = 'Aicar 50mg';
-- UPDATE products SET price = ROUND(vial_price * vials_per_box, 2)
--  WHERE name = 'Pinaleon 20mg';

-- -- Trust the PACK price (vial price recomputed):
-- UPDATE products SET vial_price = ROUND(price / vials_per_box, 2)
--  WHERE name = 'Pinaleon 20mg';
-- UPDATE products SET vial_price = ROUND(price / vials_per_box, 2)
--  WHERE name = 'DSIP 15mg';
-- UPDATE products SET vial_price = ROUND(price / vials_per_box, 2)
--  WHERE name = 'Aicar 50mg';

-- ------------------------------------------------------------
-- 4. VERIFY
-- ------------------------------------------------------------
-- Should return only the rows from section 3 that are still
-- awaiting a decision, and nothing else.
--
-- SELECT name, price, vial_price, vials_per_box,
--        ROUND(vial_price * vials_per_box, 2) AS expected_pack_price
-- FROM products
-- WHERE vial_price IS NOT NULL
--   AND vial_price > 0
--   AND price > 0
--   AND ABS(price - ROUND(vial_price * vials_per_box, 2)) > 0.01
-- ORDER BY name;
