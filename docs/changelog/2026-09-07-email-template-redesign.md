# 2026-09-07 — The outreach emails, redrawn

## Summary

The discount nudge — the abandoned-checkout email that carries the cart, the
amount off and the payment link — was drawn in the chrome every Aminocan email
has always used: nested `div`s at `max-width: 600px`, a 24px wordmark over a
grey rule, and each block fenced in a box of its own. Three stacked boxes
(cart, promo, button) on a white page read like a form, the offer sat halfway
down past the cart, and Outlook ignores `max-width` on a `div`, so the whole
thing went full-bleed at whatever width the reading pane happened to be.

This is a redesign of that template. Nothing about *what* the email says
changed — the same figure still comes from the same structured discount, the
copy is untouched, and the plain-text alternative is as it was. What changed is
how it looks, and where the offer sits.

## What's different

- **The offer is the masthead.** A near-black band opens the card: the wordmark
  in a display serif, a gold rule, then the figure itself — "15%" at 58px in
  champagne with a small italic "off" beside it, and under it what that takes
  off *this* cart. A recovery email competes with an inbox, and the first thing
  in the reading pane is now the reason to open it rather than a logo.
- **Stated once.** Because the figure lives in the masthead, the body no longer
  carries a promo box repeating it. What survives lower down is the code, on a
  cream field beside the button — which is the order the customer works in:
  read the offer, check the cart, copy the code, click through.
- **Display serif for the numbers that matter.** Didot and Bodoni ship with
  macOS and iOS, where most of these are opened; Georgia catches everything
  else. It sets the wordmark, the figure, the estimated total and the
  signature — the four places a serif reads as composed rather than tabulated.
- **The cart is ruled, not boxed.** Hairline rows and a right-aligned totals
  column, with the quantity trailing the product name instead of taking a
  column of its own. The saving stays green; the estimated total is ruled off.
- **The button is a mark, not a sentence.** Small letterspaced caps in a
  near-black pill, echoing the eyebrows above it instead of shouting in 15px
  bold.
- **One card, and it holds its width.** White card on `#F2F0EB` with the footer
  outside it, table-built with a `width="600"` attribute alongside the
  `max-width` so Outlook keeps the measure, and the radius split across the
  masthead and body cells so the corners meet.
- **One palette, stated once.** Every colour, face, rule and radius now comes
  from a `T` token object at the top of the render section — an email can't
  carry a stylesheet, and a hex code retyped in nine places is a redesign that
  ends up half-applied.

## What it covers

`renderPromoEmail` in `lib/customer/promo-email.ts` builds every email in the
outreach set, so the redesign lands on all of them at once: the discount nudge,
the plain reminder and last chance, the promo offer, new product, restock and
personal check-in, and anything sent from the blank template — from the customer
desk, the Stealth Health Orders tab (single and bulk), the affiliate composer,
and the automated recovery path. The admin composer's live preview is rendered
by that same function, so it shows the new design too.

An email with no discount gets the masthead as a masthead — wordmark only, no
hole where an offer would have been.

`aminocanShell` in `lib/email.ts` — the chrome around the transactional emails
(order acknowledgement, payment instructions, admin alerts) — gets the same
masthead and card, so a customer who gets a recovery email and then an order
confirmation gets two emails that look like they came from the same company.
Callers still supply their own padded inner block; the card adds none.

## Not changed

- The copy of any template, the merge fields, and the subject lines.
- `renderPromoEmailText` — the plain-text alternative was already the right
  shape, and it carries no styling to redesign.
- Every rule about what the customer is told they will pay: the discount
  arithmetic, the "estimated total" label, and the http(s)-only check on the
  payment link are untouched, and their tests still pass unchanged.

## Tests

`lib/customer/promo-email.test.ts` was updated where it asserted on the old
markup, and gained three cases: the figure is set once, in the masthead; a
discount with no code states the offer without rendering an empty code block
(the expiry rides in the masthead instead); and every layout table is
`role="presentation"`, so a screen reader reads the message rather than
announcing a grid.

```
npx tsx --test lib/customer/promo-email.test.ts   # 24 pass
npx tsx --test lib/customer/outreach.test.ts      # 11 pass
```
