# 2026-09-11 — The ad offer moves into the disclaimer row, and the white bar goes

## Summary

The paid-ads welcome offer was rendering as its own full-width strip at the
bottom of the fixed nav, and it put a white bar across the top of the homepage.
It now sits inline in the research-disclaimer row, next to "Research Only •
Shipping to Canada Only", and adds no height to the nav at all.

## What was actually wrong

Two separate causes, both from the offer being a strip rather than a line of
text.

**1. It ignored the nav's scroll state.** On the homepage the nav is transparent
over the video hero and solidifies to white once the page scrolls — `overlay` in
`Navigation`, applied to the main bar and the disclaimer row with a 300ms colour
transition. The strip was never given that treatment: it painted
`bg-emerald-50`, or a bronze gradient, unconditionally. Over the dark hero that
is a solid light band across the top of the page, and it stayed light while
everything above it was transparent.

**2. It pushed the whole page down.** Because the strip made the fixed nav
taller, `app/globals.css` carried a rule —
`html[data-promo-strip='1'] body { padding-top: 2.25rem }` — set from a
`document.documentElement.dataset` side-effect in the component. Body padding
above a full-bleed hero shows as a band of page background at the very top of
the screen. That rule and the side-effect that set it are both gone.

## What it looks like now

The row reads:

> 🧪 Research Only • Shipping to Canada Only • 🏷 **25% off** your first order — sign up →

and once the customer has the discount:

> 🧪 Research Only • Shipping to Canada Only • ✓ **25% off** your first order — applied at checkout

Every colour has an `overlay` counterpart and the same 300ms transition as the
rest of the nav, so the offer solidifies on scroll with everything else instead
of being the one element that jumps. The guest form is the whole line as a link
to `/signup` rather than a button — a 10px row is too tight for one.

On a phone the row is already the width of the screen, so it gives up "Canada
Only" while the offer is running rather than wrapping. A second line would make
the fixed nav taller than the literal top padding each storefront screen sets
aside (`pt-28` and friends), which is the same class of bug as the body-padding
rule this change removes. `useAdOfferNotice` is exported so `Navigation` can ask
the same question the notice asks and lay the row out accordingly.

## Files

`components/AdDiscountBanner.tsx` is replaced by
`components/AdDiscountNotice.tsx`, which renders a fragment — no wrapper, no
background, no spacing of its own — for the caller to place inside the
disclaimer row.

## Verified in a browser

Driven with Playwright against the dev server, with the attribution cookie set
and the promo settings stubbed:

- Homepage unscrolled (nav transparent over the hero) and scrolled (nav white),
  at 1280px, 390px and 320px — no white bar in any of them, and the offer
  tracks the nav's colours through the transition.
- Both states of the offer — the guest invitation and the applied confirmation.
- Nav height is **identical** with and without the offer (110px desktop, 114px
  mobile), and `body` padding-top is `0px` with no `data-promo-strip` flag.
- With no offer running, the row is unchanged: "Research Only • Canada Only".
- A non-homepage route (`/products`), where the nav is always solid.

The homepage has a pre-existing horizontal overflow (`scrollWidth` 417 vs 390 at
phone width) from an `animate-ticker` marquee further down the page. It is
identical with and without the offer and is not touched here.
