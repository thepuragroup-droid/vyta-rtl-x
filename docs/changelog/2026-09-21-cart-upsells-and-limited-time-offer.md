# 2026-09-21 — The cart earns its place: a limited-time offer, curated pairings, and suggestions that are actually computed

## Summary

The cart was a list and a total. It is now the page where the order gets
finished — four changes, three of them operator-controlled from
**Admin → Promotions** and **Admin → Cart Upsells**.

1. **A limited-time offer.** A strip at the top of the order summary: *"Add one
   more item and get 10% OFF your order!"*, and once the cart is over the
   minimum, the saving itself, already in the total below. On/off, the item
   minimum, the percentage and an optional end date are all set in Promotions.

2. **Frequently bought together.** The operator's own pairings, set per product
   in the new Cart Upsells screen. The cards tick on and off and one button adds
   the ticked ones, because the point of the block is the stack.

3. **You may also like.** Computed, not configured: the catalog ranked against
   the cart by what people have actually bought together, falling back through
   category kinship to popularity so the block is never blank.

4. **Free shipping, restated.** The promo already existed and needed no changes
   to work; what it gets here is the inline bar the design asks for, under the
   line items rather than above the totals.

**Needs `cart-upsells-migration.sql`.** Until it is run the offer stays switched
off — money fails closed — the curated row is empty, and everything else on the
cart, "You may also like" included, works exactly as it does after.

---

## The countdown is real

The design has a clock next to the offer, and a clock is the one part of a
"limited time" offer that can quietly become a lie: the usual implementation
counts down a per-session timer, expires into nothing, and starts again on the
next page load.

This one counts down to `site_settings.cart_offer_ends_at` — a timestamp the
operator sets — and `/api/checkout/puramass` checks the same timestamp before it
discounts anything. When it reaches zero the discount stops on the cart and at
the checkout together. An offer with no end date shows **no clock at all**,
which is the honest rendering of "this runs until we switch it off".

## Two promos on one order

The welcome discount for paid-ad traffic can land on the same order as the cart
offer. The two percentages **compose** rather than add: 25% then 10% is 32.5%
off, not 35%.

That is not a rounding preference. The hosted order has no discount field — the
saving travels as lowered `unit_price_cents` — and PuraMass reads a zero unit
price as *"no price given"*, charging its own list price instead. Two added
percentages can reach 100 and hand a buyer full list where they were promised
free; composed ones cannot reach it at all. `combineDiscountPercents` does the
composition and caps the result at 99 for the same reason the individual
percentages are capped there.

The two are also split **once**, at the composed percentage, rather than run
through `distributeAdDiscount` twice — two splits would round twice.

---

## What changed

### The offer's arithmetic — `lib/promos/cart-offer.ts`

Pure and isomorphic, like the welcome discount it sits beside: the cart imports
it to draw the offer and the hand-off imports the same functions to decide the
money, so the two cannot drift into disagreeing about who qualifies or for how
much. `shapeCartOfferSettings` (a zero percentage forces the promo off),
`qualifiesForCartOffer`, `itemsToUnlockCartOffer`, `cartOfferExpired`,
`cartOfferAmount` and `combineDiscountPercents`. Unit tests in
`cart-offer.test.ts` pin the boundaries: the zero percentage, the just-passed
expiry, the unparseable end date, and the composition of stacked discounts.

The minimum counts cart **units** — a line of "3 × pack of 5" is 3, not 15 —
because that is what the shopper sees and what "add one more item" asks of them.
The hand-off re-derives the same count from the quantities it is actually
ordering.

### The ranking — `lib/products/recommendations.ts`

Three signals, in the order they are trusted: co-purchase (counted per basket,
not per line — three vials bought alongside your cart's product is one vote),
then same-category, then units sold with a nudge for `featured`. Out-of-stock
products are dropped rather than ranked low: a recommendation that cannot be
added to the cart is not a recommendation. Ties break deterministically, so the
same cart always produces the same list.

`/api/products/recommendations` does the reading — recent `order_items` plus
**paid** `puramass_orders` (mapped back from SKUs, because the hosted checkout
is the live one and leaving it out would rank today's carts on history that
stopped being written) — and returns both cart blocks in one round trip, priced
through the customer pricing chain.

### The curated pairings — `product_recommendations`

Directional: what you set on a flagship is shown when the flagship is in the
cart, and does not make the flagship an upsell under its own add-on. Edited a
product at a time in `/admin/cart-upsells`; the whole list is replaced in one
request, so a half-applied reorder never reaches the storefront. Reading is open
to admin + assistant, writing is admin-only, and both are audit-logged.

### The cart — `app/cart/page.tsx`

Two columns: the lines and what to add next on the left, the money and the way
out on the right, sticky, because the left column now scrolls well past a fold
and the checkout button must not scroll away from a buyer who is ready.

The scarcity note ("Only 3 left in stock") is taken from the tightest line's
real stock cap rather than invented, and the per-line badge switches from "In
Stock – Ships in 24h" to "Only N left" on the same number.

The referral field writes the `ref_code` cookie both checkouts already read, and
says plainly that it credits a referrer rather than changing the total.

### What is *not* here

The design's express-checkout row (Shop Pay / PayPal / Google Pay) is not
implemented. Those payment methods do not exist on this store — the hosted
PuraMass checkout and e-Transfer are what there is — and buttons for payment
methods a buyer cannot use are worse than no buttons.

---

## Settings added

| Setting | Column | Default |
|---|---|---|
| Limited-time offer on/off | `site_settings.cart_offer_enabled` | off |
| Items that unlock it | `site_settings.cart_offer_min_items` | 2 |
| Percent off | `site_settings.cart_offer_percent` | 10 (capped at 99) |
| When it ends | `site_settings.cart_offer_ends_at` | none (no countdown) |
| Show "Frequently bought together" | `site_settings.cart_fbt_enabled` | on |
| Show "You may also like" | `site_settings.cart_similar_enabled` | on |

Like the free-shipping promo and the welcome discount, the offer is forced off
unless the PuraMass hosted checkout is the live one: the saving is applied by
lowering the line prices sent to it, so there is nowhere else to put it.
