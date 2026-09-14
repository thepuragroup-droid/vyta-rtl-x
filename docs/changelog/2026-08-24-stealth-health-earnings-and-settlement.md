# 2026-08-24 — Stealth Health earnings, balance owed, and settlement invoices

## Summary

Stealth Health (PuraMass) runs a hosted checkout: the buyer pays **them**, and we
ship the goods from our warehouse. Every paid row in the hand-off ledger
(`puramass_orders`) is therefore money they are holding on our behalf.

Until now the admin could see that revenue — `/admin/analytics` already showed
paid hand-offs, gross, refunds and net — but nothing turned it into a
receivable. There was no answer to *how much do they owe us*, no record of what
they had actually remitted, and no way to bill them for it.

This adds `/admin/stealth-health`: a settlement dashboard that computes what
each paid hand-off is worth to us under configurable commercial terms, tracks
payouts received, and raises settlement invoices against the outstanding
earnings.

```
buyer pays Stealth Health          gross
  − refunded on their side         refunds
  + shipment fee remitted to us    shipping
  − commission + per-order fee     their cut
  ─────────────────────────────────────────
  = what they owe us               earned
  − payouts received
  ─────────────────────────────────────────
  = outstanding balance
```

---

## Database Migration

**Run in the Supabase SQL editor before deploying.** File:
`stealth-health-settlement-migration.sql` (additive / idempotent — safe to
re-run).

Three new tables plus two columns on the hand-off ledger:

- **`stealth_health_settings`** — the commercial terms (commission %, flat fee
  per order, the shipment fee and whether it is remitted, payment terms,
  partner billing details). Deliberately *not* on `site_settings`:
  `GET /api/admin/settings` is a public unauthenticated read of checkout config,
  and what we pay a partner is not public.
- **`stealth_health_invoices`** — one settlement invoice per period, numbered
  `SH-1000` upward from its own sequence. Every money figure **and the terms
  that produced it** are frozen onto the row at creation, so changing the
  commission later never silently restates an invoice already sent.
- **`stealth_health_payouts`** — what they have actually remitted. Optionally
  applied to an invoice; otherwise recorded on account.
- **`puramass_orders.settlement_invoice_id`** — the invoice that billed this
  hand-off. `NULL` means unbilled, and that is what stops a sale being billed
  twice.
- **`puramass_orders.settlement_excluded`** — hold a disputed or test hand-off
  back from settlement without deleting the ledger row.

All three tables are service-role only (single RLS policy), matching
`puramass_orders`. Until the migration runs, the dashboard still loads: earnings
are computed live from the ledger and a banner explains that nothing can be
billed or marked paid yet. Every read and write tolerates the tables/columns
being absent, the same way the existing PuraMass surfaces tolerate their
optional address columns.

---

## How it works

### The arithmetic

`lib/admin/stealth-health.ts` is the single place the money math lives —
deliberately pure (no Supabase, no React), so the dashboard, the settlement
invoice and the tests can never drift apart. Everything is integer cents; a
percentage is applied once, per order, and rounded there, so a total is always
exactly the sum of the lines behind it.

Per paid hand-off:

```
net      = max(0, gross − refunds)
fee      = min(net + shipping, round(net × commission%) + flat fee)
shipping = flat shipment fee, when remitted AND the sale wasn't fully refunded
due      = max(0, net + shipping − fee)
```

The order matters: commission comes off **net** goods (after refunds), not
gross; a fully refunded sale owes us nothing, shipment fee included; and the
flat fee is capped at what is actually collectable so a tiny order can never
produce a negative balance that quietly nets off a real one elsewhere.

Defaults are 0% commission, no flat fee, shipment fee remitted — i.e. *they
remit everything they collected*, the figure that needs no agreement to be true.
Set the real terms under the **Terms** tab.

### `/admin/stealth-health`

Four tabs behind one always-visible balance strip:

- **Overview** — earned / their cut / units, the split spelled out line by line,
  billed vs not-yet-billed, and a per-day earnings chart. A date range scopes
  the earnings; **the balance strip is always all-time**, because "what do they
  owe us" has one answer, not one per date filter.
- **Invoices** — the settlement invoices, each with amount due, received and
  balance. Creating one previews exactly which orders it would bill and what
  they come to *before* anything is written.
- **Payouts** — record money received, applied to an invoice or on account.
  Recording one against a draft moves that invoice to `sent`: if they've paid
  it, it plainly went out.
- **Terms** — the commercial terms, with a plain-English summary and a worked
  example on a $200 order so the effect of a change is visible before saving.

### Creating a settlement invoice

`POST /api/admin/stealth-health/invoices` bills every paid hand-off in the
period that is not already on an invoice and not held back, then stamps those
orders with the new invoice id — conditionally on the id still being `NULL`, so
two admins invoicing at once can't both claim the same sale. If a concurrent run
took some rows, the invoice is re-totalled from what was actually claimed rather
than overstating the claim; if the claim fails outright the invoice is rolled
back.

Invoices open as **draft**. `sent` → `partial` → `paid` then follows the money:
`partial` and `paid` are *derived* from the payouts, never set by hand, so
removing a payout recorded in error corrects the status automatically. Voiding
an invoice releases its orders back to unbilled. A draft can be deleted; a sent
invoice can only be voided, so the claim we made survives in the record.

`/admin/stealth-health/invoices/[id]` shows the claim, the hand-offs behind it,
the payouts against it, and a print view (`window.print()` → PDF) with none of
the admin chrome — that is the document Stealth Health receives. Its lines are
re-derived from the terms frozen on the invoice, not the current ones.

### Access

Read is admin + assistant, matching `/admin/puramass-orders` (the ledger these
figures come from). Every write — raising an invoice, recording a payout,
changing the terms, excluding an order — is **admin only**: these are financial
claims, and an assistant reconciling orders has no business creating them. All
writes are audit-logged.

### On the analytics page

`/admin/analytics` already showed what buyers paid Stealth Health. The PuraMass
section now also carries a **"What we earn on it"** strip — earned, their cut,
paid to us, and the outstanding balance — linking through to the settlement
dashboard. It loads separately, so an un-migrated database (or a role without
access) simply renders nothing there instead of breaking the page.

---

## Files

**New**
- `stealth-health-settlement-migration.sql` — terms, invoices, payouts, ledger
  settlement columns.
- `lib/admin/stealth-health.ts` — the settlement arithmetic (pure).
- `lib/admin/stealth-health.test.ts` — 18 tests over that arithmetic.
- `lib/admin/stealth-health-server.ts` — auth, ledger reads, missing-schema
  tolerance, invoice shaping.
- `lib/admin/stealth-health-client.ts` — typed browser data layer.
- `app/api/admin/stealth-health/summary/route.ts` — dashboard figures.
- `app/api/admin/stealth-health/settings/route.ts` — read/write the terms.
- `app/api/admin/stealth-health/invoices/route.ts` — list + create.
- `app/api/admin/stealth-health/invoices/[id]/route.ts` — detail, status, delete.
- `app/api/admin/stealth-health/payouts/route.ts` — list + record.
- `app/api/admin/stealth-health/payouts/[id]/route.ts` — remove.
- `app/api/admin/stealth-health/orders/route.ts` — hand-offs as money owed.
- `app/api/admin/stealth-health/orders/[id]/route.ts` — hold back / reinstate.
- `app/(admin)/admin/stealth-health/page.tsx` — the dashboard.
- `app/(admin)/admin/stealth-health/_components/{ui,InvoicesTab,PayoutsTab,TermsTab}.tsx`
- `app/(admin)/admin/stealth-health/invoices/[id]/page.tsx` — invoice + print view.

**Changed**
- `app/(admin)/admin/layout.tsx` — **Stealth Health** nav entry under Sales.
- `app/(admin)/admin/analytics/page.tsx` — the "What we earn on it" strip.

---

## Testing

```bash
node --test --import tsx lib/admin/stealth-health.test.ts
```

18 tests covering the default terms, commission on net vs gross, stacked flat
fees, partial and full refunds, over-refunds, the non-remitted shipment fee, the
flat-fee cap, missing/NaN inputs, the `paid_at` → `created_at` fallback, totals
matching the sum of their lines, settleability, status derivation (including
overpayment and a removed payout), currency normalisation, terms normalisation
from a junk row, and due-date arithmetic across a year boundary.
