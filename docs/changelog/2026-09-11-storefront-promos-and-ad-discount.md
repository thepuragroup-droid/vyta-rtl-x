# 2026-09-11 — A free-shipping nudge that follows the shopper, and 25% off for ad traffic

## Summary

Two storefront offers, both driven from **Admin → Promotions**.

1. **The free-shipping promo now follows the shopper.** The progress bar only
   existed on the cart and checkout screens — by which point the decision to buy
   was already made. A corner toast now carries the same fact onto every
   storefront page: *"You're $38.50 away from free shipping"*, or *"You've got
   free shipping"* once the cart is over the line. Dismissible, and dismissed
   against the state it showed — someone who waved away "spend $38.50 more" is
   still told when they have crossed the line and earned it.

2. **Visitors who arrive on a paid ad are offered 25% off for signing up.** A
   strip under the nav bar makes the offer to guests; once they have an account
   it turns into confirmation that the discount is on their order. No code to
   enter — the saving is taken off the line prices sent to the hosted checkout,
   and the checkout screen says so in as many words before the redirect, because
   PuraMass's own page has no discount line to look at.

Who counts as "from an ad" is the classification that already exists
(`lib/analytics/attribution.ts` `PAID_CHANNELS`: Google, Meta, Microsoft,
TikTok, LinkedIn and anything tagged with a paid medium). Nothing new is
captured to support this.

**Needs `ad-discount-promo-migration.sql`.** Until it is run the discount stays
switched off — money fails closed — and the free-shipping toast, which needs no
new columns, works either way.

---

## What changed

### The discount arithmetic — `lib/promos/ad-discount.ts`

The PuraMass hosted order has no discount field. It has `unit_price_cents` per
line, and that is the only lever there is, so the discount is taken off the
lines themselves before the payload goes out.

`distributeAdDiscount` does the split. The interesting part is that an exact
percentage is frequently **not payable**: a line of 3 units can only move in
3-cent steps, so a target between two reachable totals has to be rounded. It is
rounded the buyer's way — floor every unit price at its exact discounted value
(which can only take off too much), then hand whole cents back, largest
remainder first, while a line's quantity still fits under the target. The result
is the closest payable total at or below the target, so the discount actually
taken is never smaller than the one advertised, and never more than about a cent
per unit larger. No line is ever marked up above its list price.

Covered by `lib/promos/ad-discount.test.ts` — run it with
`node --test --import tsx lib/promos/ad-discount.test.ts`.

### Who qualifies

Two conditions, both required, both settled server-side in
`/api/checkout/puramass`:

- **Arrived on a paid ad.** Read from both places that fact is recorded — the
  first/last-touch cookies `middleware.ts` writes, and
  `customers.attribution_channel` frozen at signup. Either is proof: someone who
  cleared their cookies since creating the account is still a buyer that ad won.
- **Signed in.** The offer is *"sign up and get 25% off"*, so a guest sees the
  invitation rather than the discount.

The browser is asked for nothing and believed about nothing. `PromosContext`
decides the same thing client-side purely to know what to display.

### The zero-price trap

`unit_price_cents` is optional on the partner API, and
`buildPuramassOrderBody` omits a zero — at which point PuraMass charges its
**own** catalog price. So a zero does not mean "free", it means "you price it",
and two things follow:

- The hand-off refuses to send a split when the catalog could not price every
  line, or when the split would zero one. Either way out is a hand-off with no
  prices at all, which is exactly what an undiscounted order has always been:
  the buyer pays list rather than being handed free product by a pricing
  failure. Both paths log.
- `ad_discount_percent` is capped at **99**, not 100, so the case cannot be
  reached by configuration.

### Goods prices on the hand-off

Lines are still sent **without** a price on an undiscounted order, leaving goods
pricing to PuraMass's catalog exactly as before. Our prices appear only when
there is something to take off them, so this changes nothing for any order that
does not earn the discount.

The free-shipping threshold is still measured at **list** price, before the
discount — it is what the cart's progress bar counts toward, and a buyer
watching that bar fill must not lose the free shipping at the last step.

### What the buyer sees

- `components/FreeShippingToast.tsx` — the corner toast. Hidden in the admin,
  warehouse and affiliate portals, and on the cart and checkout screens, which
  already draw the full progress bar.
- `components/AdDiscountBanner.tsx` — the strip under the nav. It is an extra
  row inside the *fixed* nav, so it flags itself on `<html>` and one rule in
  `globals.css` pushes the page content down by its height; every storefront
  screen hard-codes its own top padding and had no room to spare on a phone.
- The cart and checkout summaries grow a `-$X` discount line, and the checkout
  adds a green panel above the CTA naming both figures before the redirect.

### Admin → Promotions

A second card: toggle, percentage, and a live summary. Locked with the reason
shown when the PuraMass hosted checkout is off, because that is the only
checkout that carries our own line prices and there is nowhere else for the
discount to land — the same pattern the free-shipping card uses for live courier
rates.

### Plumbing

- `contexts/PromosContext.tsx` resolves both promos once per app load instead of
  each screen fetching `/api/admin/settings` for itself.
- `lib/analytics/attribution-client.ts` reads the attribution cookies in the
  browser, so the offer strip is right on first paint without a round trip.
- `/api/checkout/puramass` now reads `site_settings` **once** with `select('*')`
  and shapes the checkout toggle, shipping and both promos off that one row,
  replacing two separate reads.

### The ledger

`puramass_orders.ad_discount_percent` and `ad_discount_cents` record what was
applied. The discount reaches PuraMass baked into the line prices, so without
them there is no way to tell a discounted order from a cheaper cart when
settlement is reconciled against the catalog. `ad_discount_cents` is what the
split really took, not the nominal percentage.
