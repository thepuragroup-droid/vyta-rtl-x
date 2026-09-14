# 2026-09-11 — One welcome offer: 25% off, ad traffic, first order only

## Summary

The store was running two first-order discounts at once, and only one of them
was the one anybody meant to run.

1. **A blanket 20% off everyone's first order.** Advertised on the sign-in modal
   and the login page ("20% off your first order — sign in or create an account
   to claim your discount"), and applied for real: the legacy
   crypto/e-transfer checkout took 20% off the subtotal, and
   `/api/orders-email` re-applied it server-side so a tampered browser could not
   change the figure. It went to every new customer regardless of how they found
   the store — including the ones who cost nothing to acquire.

2. **25% off for visitors who arrived on a paid ad**, the offer the ad spend was
   actually buying — but with no first-order limit on it, so an ad-acquired
   customer kept getting 25% off every order they ever placed.

Now there is one offer: **25% off, for visitors a paid ad won, on their first
order.** The blanket 20% is gone — copy, arithmetic and all.

## What changed

**The 20% first-order discount is removed entirely.**

- The promo banner is gone from `components/LoginModal.tsx` and the login page.
- The legacy checkout (`app/checkout/page.tsx`) no longer computes, displays or
  sends a first-order discount — no strike-through subtotal, no "First order
  discount (20%)" line, no `discountTotal` in the order payload.
- `app/api/orders-email/route.ts` no longer applies `FIRST_ORDER_DISCOUNT_RATE`.
  Orders placed through that checkout are at list price, and the
  `discount_total` / `discount_amount` columns record zero rather than
  disappearing, so nothing downstream that reads them has to change.

**The ad discount is now first-order only.** `qualifiesForAdDiscount` takes a
third condition alongside "from a paid ad" and "signed in". It is a required
argument, not an optional one: it decides whether money comes off a repeat
buyer's order, and a call site that forgot it should not silently default to
discounting.

## Who still counts as a first-time buyer

`lib/promos/first-order.ts` answers it in one place, and both the storefront and
the checkout hand-off call it — so the strip under the nav bar and the prices
actually charged cannot drift apart.

A customer has spent their welcome offer when either is true:

- `customers.has_completed_first_order` is set. This is the flag the legacy
  checkout already maintains, flipped when an order is paid or confirmed.
- They have a row in `puramass_orders` that is `paid` **or**
  `payment_pending`. The hosted checkout never writes the legacy flag, so its
  ledger row is the only record that the order happened.

`payment_pending` counts deliberately. The discount is applied at hand-off,
before anything is paid, so counting only `paid` would let someone hand off ten
discounted checkouts before settling any of them. It is not a one-way door: an
unpaid hand-off becomes `expired` or `cancelled` once `puramass-poll.ts` catches
up with it, and neither status consumes the offer — a buyer who simply abandoned
a checkout gets it back.

Every read fails **closed**: a signed-out visitor, or a query that errors,
returns "not a first order" and discounts nothing. That matches how the rest of
the promo already behaves (`DEFAULT_AD_DISCOUNT` is off).

## What the buyer sees

The strip under the nav bar now says "your first order" in both states. A
signed-in customer only sees it while the offer is still theirs — once they have
ordered it disappears, rather than inviting them to claim a discount the
checkout would refuse. A signed-in customer is never shown the guest "sign up
and save" call to action. Guests from an ad see the invitation as before.

The cart and checkout lines now read "25% first-order discount".

## Nothing is trusted from the browser

`/api/promos/first-order` is a new read-only endpoint that tells the storefront
what to *show*. `/api/checkout/puramass` calls `isCustomerFirstOrder` again at
hand-off and prices from that answer, so a tampered response changes the wording
of a banner and not a cent of the total.

## Database

**No migration.** Both records the first-order rule reads already exist
(`customers.has_completed_first_order`, and `puramass_orders.status`). The
comments in `ad-discount-promo-migration.sql` were updated to describe the
first-order rule, but it adds no new columns and re-running it is unnecessary.

## Admin

Unchanged. The offer is still switched on and sized in **Admin → Promotions**;
25% is still the configured default. Setting it to 0 still forces the promo off.

## Tests

`lib/promos/ad-discount.test.ts` covers the new condition, including that
dropping any one of the three conditions removes the discount.
`lib/promos/first-order.test.ts` is new and covers the legacy flag, hosted
orders, the pending-hand-off rule, abandoned checkouts giving the offer back,
and both fail-closed paths. 372 tests pass across the suite.
