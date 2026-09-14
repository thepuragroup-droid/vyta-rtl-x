# 2026-08-20 — PuraMass orders on the invoice pages

## Summary

A paid PuraMass (Stealth Health) hand-off is materialised into a local invoice
(`invoices.source = 'stealth_health'`) so it reaches the fulfilment queue and the
customer's account. That invoice deliberately carries almost nothing about the
buyer: PuraMass takes the payment on its own hosted checkout page and collects
the contact details and the shipping address there, then reports them back onto
the hand-off ledger (`puramass_orders`).

The result was an invoice you couldn't act on. `/admin/invoices` showed a name
and a total; `/admin/invoices/[id]` said *"No linked order"* — technically true
(PuraMass ships it), but it reads like a fault — and the printable invoice had an
empty Bill To block and no ship-to at all.

The order payload has all of it:

```json
{ "order": {
  "transaction_id": "jC0LrMp8pdipj7ky1u0k", "status": "paid",
  "partner_reference": "amc_587be30c-…", "currency": "usd",
  "subtotal_cents": 66700, "paid_at": "…", "expires_at": "…",
  "refunded_total_cents": 0, "refunds": [],
  "customer": { "first_name": "Jordan", "last_name": "Grosman",
                "email": "…", "phone": "+14167239851" },
  "shipping": { "address": "96 Chiltern Hill Road", "city": "Toronto",
                "state": "ON", "zip": "M6C 3B8", "country": "CA" },
  "items": [{ "sku": "…", "name": "…", "quantity": 2, "unit_price_cents": 14500 }]
} }
```

This wires that payload through to all three invoice surfaces — the table, the
detail view and the PDF — and labels every field with where it came from, so a
partner-reported address and one typed into this admin never look alike to
whoever is packing the parcel.

---

## Database Migration

**Run in the Supabase SQL editor before deploying.** File:
`puramass-order-details-migration.sql` (additive / idempotent — safe to re-run).

```sql
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS expires_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_total_cents  INTEGER,
  ADD COLUMN IF NOT EXISTS refunds               JSONB,
  ADD COLUMN IF NOT EXISTS paid_items            JSONB;
```

The buyer's contact and shipping address were already captured by
`puramass-shipping-address-migration.sql`; this adds the rest of the payload —
the hosted link's expiry, refunds, and the priced line items PuraMass actually
charged for (the ledger's existing `items` column holds only the `{ sku,
quantity }` list we sent at hand-off).

Until the migration runs, every read and write tolerates the columns being
absent: reads use `select('*')`, and the webhook / poller / refresh strip
unmigrated fields and retry, exactly as they already do for the address columns.
The new fields simply render as empty. Values arrive with the next webhook event
or poll; a terminal (paid) order picks them up on the per-row **Refresh** action
on `/admin/puramass-orders`.

---

## How it works

### The join

`lib/admin/puramass-invoice.ts` is the one place invoices meet the hand-off
ledger. Given invoice ids it reads the matching `puramass_orders` rows and
normalises them into a flat `PuramassInvoiceContext` — transaction, reference,
payment link, PuraMass status, currency, goods charged, refunds, buyer contact,
shipping address with its provenance, and the priced SKUs. Every surface renders
that same shape, so the table, the detail view and the PDF cannot disagree.

The ledger is service-role only, so the join always happens on the server:

- `GET /api/admin/invoices` attaches `puramass` to each row in scope.
- `GET /api/admin/invoices/[id]/puramass` serves the detail view, which reads
  the invoice itself under the caller's RLS (mirrors the tracking route).
- The PDF and invoice-email routes fetch it before rendering.

### Table view (`/admin/invoices`)

- A **Stealth Health** chip and the transaction id sit on their own lines under
  the invoice number; invoices raised here are unchipped in the table and marked
  **Manual** wherever the badge is shown in full.
- The customer cell gains the buyer's phone and the ship-to address. Only an
  address the buyer typed in themselves on `/shipping-address/<token>` is
  chipped (*From customer*) — a partner-reported one is the norm on these
  orders, so it needs no label.
- A paid hand-off with no address yet flags **No address** in the Shipping
  column — it can't be packed until one arrives.
- A new **Source** filter scopes the list (and its summary cards) to PuraMass
  orders or to invoices created here.
- Search now also matches a PuraMass transaction id, our partner reference, the
  buyer's phone, and the destination city / region / postcode.
- The **Issue** column is gone: the table already groups by issue date, and
  each group's divider spells the day out in full.
- Rows are clickable end to end, and hovering one opens a preview card
  summarising the invoice (including the PuraMass ship-to) which opens the same
  invoice when clicked. The checkbox, the fulfilment select and the row actions
  opt out of the row click; the invoice number stays a real link for keyboard
  users and open-in-new-tab.

### Detail view (`/admin/invoices/[id]`)

- The header names the origin, and the Dates card carries an explicit **Source**
  row: *PuraMass hosted checkout* or *Created in this admin*.
- **Ship To** card — the recipient, address, phone and a copy button.
- **PuraMass Order** card — transaction id and our reference (both copyable),
  what PuraMass charged, paid / expiry timestamps, refunds, the SKUs it charged
  against, and links out to the PuraMass transaction and to PuraMass Orders.
- The shipping summary cell shows the destination instead of "No linked order",
  the customer blocks fall back to the PuraMass contact for guest buyers, line
  items show their PuraMass SKU, and a refund is shown against the total as
  *Refunded by PuraMass* + *Net of refunds* (refunds happen on the partner side,
  so they never alter the invoice total itself).

### The printed invoice

Both PDF paths carry it: the printer-ready HTML (`lib/invoice-html.ts`, used by
the admin View/Download PDF) and the pdfkit attachment on the invoice email
(`lib/invoice-pdf.ts`). Each gains a **Ship To** block with its provenance line,
the PuraMass transaction / reference / status / goods-charged, SKUs on the line
items, and refund rows in the totals. Non-PuraMass invoices render exactly as
before.

---

## Files

**New**
- `puramass-order-details-migration.sql` — expiry, refunds, priced items.
- `lib/admin/puramass-invoice.ts` — the invoice ↔ ledger join + display helpers.
- `lib/admin/puramass-invoice.test.ts` — normalisation + patch-builder tests.
- `components/admin/PuramassInvoiceBlocks.tsx` — source badge, ship-to, panels.
- `app/api/admin/invoices/[id]/puramass/route.ts` — hand-off for the detail view.

**Changed**
- `lib/payments/puramass.ts` — parse `refunded_total_cents` / `refunds`;
  `buildPuramassOrderDetailPatch`.
- `lib/payments/puramass-columns.ts` — `stripUnmigratedFields` now also covers
  the order-detail columns (`stripAddressFields` renamed).
- `lib/payments/puramass-poll.ts`, `app/api/webhooks/stealth-health/route.ts`,
  `app/api/admin/puramass/orders/refresh/route.ts` — capture the new fields.
- `app/api/admin/invoices/route.ts` — attach context, `source` filter, wider
  search.
- `app/api/admin/invoices/[id]/route.ts`, `.../pdf/route.ts`, `.../email/route.ts`
  — attach context; fall back to the PuraMass contact for guest buyers.
- `lib/invoice-html.ts`, `lib/invoice-pdf.ts` — Ship To, source strip, refunds.
- `app/(admin)/admin/invoices/page.tsx`, `app/(admin)/admin/invoices/[id]/page.tsx`,
  `lib/admin/invoices.ts` — the UI wiring above.

---

## Tests

`lib/admin/puramass-invoice.test.ts` covers the normalisation (currency casing,
priced items preferred over the hand-off list, an all-blank address treated as
none, refunds read under any of the names PuraMass may use, a pre-migration row
degrading to empty rather than throwing) and the ledger patch (a payload without
those blocks writes nothing, so a replayed event can't clear a refund).

The repo has no test runner wired up, so it uses Node's built-in `node:test`:

```bash
node --test --import tsx lib/admin/puramass-invoice.test.ts
```
