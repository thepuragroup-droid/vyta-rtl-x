# 2026-08-18 — PuraMass orders with no shipping address: ask the customer

## Summary

Some PuraMass (Stealth Health) hand-offs land with `shipping_address` NULL — the
partner never reported one, the admin PuraMass Orders page shows "No address
yet", and the order can't be packed. Syncing doesn't help when PuraMass simply
doesn't have it.

Concretely, the order payload comes back complete except for the address — the
`customer` block, the items and the totals are all there, and `shipping` is
`null`:

```json
{ "transaction_id": "…", "status": "paid",
  "customer": { "first_name": "…", "last_name": "…", "email": "…", "phone": null },
  "shipping": null,
  "items": [ … ] }
```

So we know exactly who to ask and what they bought; we just don't know where to
send it.

This adds the missing loop: an admin sends the buyer a friendly email from
`/admin/puramass-orders`, the buyer fills in their address on a private page,
and it is written straight back onto the hand-off ledger.

1. **Email** — restates the whole order (invoice number, line items, totals,
   transaction id and its link) so the ask is recognisable rather than
   phishy, then a single button: *Add my shipping address*.
2. **Page** — `/shipping-address/<token>` shows that same order summary, an
   address form with country-aware region/postal labels, and a thank-you state
   with a "what happens next" timeline. The customer can come back and fix a
   typo with the same link.
3. **Write-back** — the submitted address lands on `puramass_orders`
   (`shipping_address`, `customer_name`, `customer_phone`), stamped as
   customer-provided, and the linked fulfillment invoice's contact block is
   kept in step.

---

## Database Migration

**Run in the Supabase SQL editor before deploying.** File:
`puramass-missing-address-migration.sql` (additive / idempotent — safe to
re-run).

```sql
-- Provenance + "when did we last ask" on the hand-off ledger
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS shipping_address_source     TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS address_requested_at        TIMESTAMPTZ;

-- One row per "please send us your address" email
CREATE TABLE IF NOT EXISTS puramass_address_requests ( … );
```

Existing addresses are labelled `shipping_address_source = 'puramass'` by the
migration. Until it runs, the admin page and webhook keep working exactly as
before (the same missing-column fallback the earlier address migration uses);
the new request action reports that the migration is needed.

---

## How it works

### Sending the request

`/admin/puramass-orders` gains a mail action on every row. It opens a dialog
showing who the email goes to, an optional note, and a warning when an address
is already on file. On send, `POST /api/admin/puramass/orders/request-address`
mints a token, emails the customer and stamps `address_requested_at`. The link
is handed back so an admin can also paste it into a chat.

The recipient is prefilled from the ledger and is normally correct: PuraMass
reports the buyer's email on every order (its `customer` block), and the ledger
is keyed on `transaction_id` / `partner_reference`, never on the email. It stays
editable only for a hand-off with no email on the row, or a customer who asks
for the link somewhere else.

Re-sending re-uses the outstanding request row, so a customer who kept the first
email is not stranded by a second one.

### The token

32 random bytes, URL-safe, stored **only** as a SHA-256 hash, scoped to one
order, expiring after 30 days. A leaked link exposes one order's summary and can
set that one order's address — nothing else. The buyer's email is masked on the
page (`da••••@gmail.com`).

### Writing the address back

`POST /api/shipping-address/<token>` validates with the same
`validateShippingAddress()` the form uses, writes the ledger row, closes out the
request (keeping a verbatim copy of what was typed), and syncs the invoice's
`customer_name` / `customer_phone`.

A PuraMass poll or webhook will **not** overwrite an address the customer typed
(`buildPuramassContactPatch` skips it when the source is `customer`) — that flow
only exists because the partner had none, so the buyer is the better source.
The admin table marks those rows *From customer*.

---

## Files

| File | What |
| --- | --- |
| `puramass-missing-address-migration.sql` | Request table + provenance columns |
| `lib/payments/puramass-address-request.ts` | Tokens, request lifecycle, write-back |
| `lib/payments/puramass-order-summary.ts` | The order summary shared by email + page |
| `lib/payments/puramass-address-email.ts` | The email (HTML + plain text) |
| `lib/payments/puramass-address.ts` | `validateShippingAddress()` alongside the display helpers |
| `lib/shipping/regions.ts` | Country / state reference data |
| `app/api/admin/puramass/orders/request-address/route.ts` | Admin send endpoint |
| `app/api/shipping-address/[token]/route.ts` | Public read + submit endpoint |
| `app/shipping-address/[token]/page.tsx` | The customer-facing page |
| `app/(admin)/admin/puramass-orders/RequestAddressDialog.tsx` | Admin send dialog |

## Tests

`lib/payments/puramass-missing-address.test.ts` — validation, token shape and
hashing, and the provenance guard. Run with:

```bash
npx tsx --test lib/payments/puramass-missing-address.test.ts
```
