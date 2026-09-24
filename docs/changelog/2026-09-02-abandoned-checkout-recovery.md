# 2026-09-02 — Abandoned checkout recovery: email the payment link back

## Summary

A PuraMass (Stealth Health) hand-off that never reaches `paid` is a cart the
buyer walked away from. Until now those rows sat on `/admin/puramass-orders`
under the **Pending** tab with nothing to do about them — even though the ledger
already holds everything needed to go after the sale:

```json
{ "partner_reference": "amc_…", "status": "payment_pending",
  "customer_email": "…", "payment_link": "https://…",
  "items": [ { "sku": "…", "quantity": 2 } ], "subtotal_cents": 20000 }
```

The hosted `payment_link` keeps taking payment until PuraMass expires it, so the
whole recovery is: send that link back to the buyer, with a reason to use it.

This adds that loop, built on the outreach email builder the customer desk
already uses (`lib/customer/promo-email.ts` + the shared `EmailComposer`) rather
than a second one beside it.

1. **Abandoned tab** — a view over unpaid hand-offs older than a configurable
   window (default 1 hour). It cuts across statuses: a `payment_pending`,
   `expired` or `cancelled` cart is equally worth chasing.
2. **Recovery composer** — the existing email builder with three new blocks: the
   cart restated with line prices, a promo code with a **percentage or fixed**
   discount and its amount, and a **Complete your order** button carrying the
   payment link. The preview is rendered by the same function the send uses.
3. **Send history** — how many times a cart has been chased, when, with which
   code and what offer; and a **Recovered** badge once a chased cart is paid.

**No promo code is issued here.** Codes are generated on app.vytabio.com and
pasted into the composer, exactly as on the customer desk. The discount type and
amount only decide how the offer is *worded* and what the email's estimated
total says — Stealth Health applies the real discount when the buyer enters the code
on its checkout page, which is why the email labels the figure "Estimated
total".

---

## Database Migration

**Run in the Supabase SQL editor before deploying.** File:
`abandoned-checkout-recovery-migration.sql` (additive / idempotent — safe to
re-run).

```sql
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS recovery_email_sent_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recovery_email_count    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_promo_code     TEXT,
  ADD COLUMN IF NOT EXISTS recovery_discount_type  TEXT,
  ADD COLUMN IF NOT EXISTS recovery_discount_value NUMERIC(10,2);

ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS abandoned_checkout_hours INTEGER NOT NULL DEFAULT 1;
```

There is deliberately **no `recovered_at` column**. An order is recovered when
it is paid and `paid_at` is at or after `recovery_email_sent_at` — derivable
from what is already stored, so it can never drift out of step with the ledger.

Until the migration runs, everything still works: the list falls back through a
ladder of column sets (so a missing recovery column doesn't also cost the page
its shipping addresses), the email still sends, and the UI says plainly that the
send history isn't being recorded yet.

---

## What changed

### The email builder — `lib/customer/promo-email.ts`

Three optional blocks, all off unless a caller fills them in, so the customer
and affiliate desks render exactly what they did before:

- `cart` — line items, subtotal, the saving, and the estimated total.
- `discount` — `{ type: 'percentage' | 'fixed', value }`. States the offer once
  and renders it in the promo headline, the cart totals and the plain-text
  alternative, so the message can't say 20% while the box says 15%.
- `checkout` — the call-to-action button carrying a payment link.

Plus the arithmetic and its guard rails:

| Helper | Rule |
| --- | --- |
| `normalizeDiscount` | Rejects a typo rather than clamping it: `150` in a percentage field is far more likely `$150` than an intended free order. |
| `discountAmountOn` | A fixed amount larger than the cart caps at the cart — never a negative total. |
| `safeHttpUrl` | Only `http(s)` reaches an `href`. The link comes from a database column, so a stored `javascript:` value would otherwise be a click away from running in the preview. |

`RECOVERY_TEMPLATES` (discount nudge / plain reminder / last chance / blank) sit
beside `PROMO_TEMPLATES`; none of them describe the cart, the code or the link in
prose, because those are rendered from structured input.

### The composer — `app/(admin)/admin/_components/EmailComposer.tsx`

Now takes an optional template set, heading, promo note, cart, checkout CTA and
a `showDiscount` flag. With `showDiscount` on it renders a
**Percentage / Fixed amount** toggle and an amount field; a blank amount means
no discount, and a filled-in one that doesn't parse blocks the send rather than
being dropped on the way out. An amount with no code to type at checkout is
blocked too.

### Server

- `lib/payments/puramass-abandoned.ts` — client-safe vocabulary
  (`RECOVERABLE_STATUSES`, the cutoff, `wasRecovered`, `recoveryOffer`) so the
  admin table and the API can't disagree about what "abandoned" means.
- `lib/payments/puramass-recovery.ts` — reads/stamps the recovery columns,
  builds the renderer input from `buildOrderSummary`, and sends.
- `GET/POST /api/admin/puramass/orders/recover` — the draft payload (cart
  resolved to product names and prices, so the preview matches the send) and the
  send itself. Admin/assistant only. Refuses a paid order, requires a recipient,
  reports a mistyped CC, logs to `customer_emails` either way, and writes an
  audit entry (`puramass.recovery_email_sent`).
- `GET /api/admin/puramass/orders` — `abandoned=1`, an `abandoned` count, the
  configured window, and `recoveryAvailable`.

### Settings

**Settings → Abandoned checkout (started, never paid)** sets the window
(1–720 hours, default 1). Nothing is sent automatically — the tab is where an
admin picks a cart and chooses what to offer.

---

## Tests

`lib/customer/promo-email.test.ts` covers the rules that decide what a customer
is told they will pay — the typo rejection, the fixed-amount cap, one figure
across HTML and text, escaping, and the `javascript:` link. Run with:

```
node --test --import tsx lib/customer/promo-email.test.ts
```
