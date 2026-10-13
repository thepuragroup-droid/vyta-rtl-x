# Stealth Health Payouts (Module 13) — VYTA port

Admin → **Stealth Health Payouts** (`/admin/stealth-health/payouts`).

Customers pay Stealth Health; Stealth Health keeps a processing fee (3.2% at the
catalog price, 6% at a custom price) and pays the rest out to us in batches
when we ask. This page tracks which customer-paid orders they still owe us for,
builds a numbered, branded **payout request** PDF (`VY-PAY-2026-0001`), and
marks orders **paid out** when the money arrives.

This is the PuraMass module ported to this site. The behaviour follows the
PuraMass guide; the differences below exist because this site already had a
Stealth Health settlement dashboard when the module arrived.

## Setup

1. Run `stealth-health-payouts-migration.sql` in the Supabase SQL editor.
2. Run `stealth-health-portal-snapshot-migration.sql` (optional, but without it
   the "polled order" source is skipped).
3. Open the Payouts page, check the fee rates (**Fees 3.2% / 6%**), and mark old
   history paid out: filter to the old range, select all, **Mark paid**.
4. Create one test request and download the PDF to check the branding.

## Differences from the PuraMass guide

| Guide | Here | Why |
|---|---|---|
| Table `stealth_health_payouts` | `stealth_health_payout_requests` | `stealth_health_payouts` already holds the settlement dashboard's remittances. |
| Column `puramass_orders.payout_id` | `payout_request_id` | Points at the table above. |
| Sequence `stealth_health_payout_seq` | `stealth_health_payout_request_seq` | Same. |
| API `/api/admin/stealth-health/payouts/**` | `/api/admin/stealth-health/payout-requests/**` | `/payouts` is the remittance API. Same bodies and actions. |
| Overview \| Payouts tabs | **Settlement \| Payouts** switch in both headers | The settlement page already has its own tab row starting with "Overview". Its old "Payouts" tab is now labelled **Remittances** (same `?tab=payouts` deep link). |
| Overview orders carry `customer_name` / `customer_email` (`lib/admin/stealth-health.ts`) | Customer and amount resolved in `lib/admin/stealth-health-data.ts` | This site's Overview is the settlement summary and has no order list. |
| Guest placeholder `@aminocan.local` | Any `*.local` address (`guest+…@vyta.local`) | This site's placeholders. |
| — | A refund reported by Stealth Health shows under the total | This ledger records `refunded_total_cents`. It is informational only: the fee is still worked out on the total charged, so handle refunds by hand as the guide says. |

Function names (`sh_create_payout`, `sh_mark_paid_out`, `sh_unmark_paid_out`,
`sh_void_payout`, `sh_refresh_payout_status`), the `site_settings` rate columns
and the other `puramass_orders` columns match the guide.

The Payouts page and the settlement dashboard track Stealth Health money
separately. **Mark received** here does not add a remittance on the
settlement dashboard's Remittances tab.

## Where the figures come from

Stealth Health's own record first, matched by transaction ID:

1. **The payment webhook**: the latest signed delivery in `puramass_webhook_events`
   reporting the order paid. That webhook lists the priced lines but not the
   shipping charge, so shipping comes from what we sent at hand-off
   (`shipping_total_cents`). An explicit total or subtotal + shipping in the
   payload wins.
2. **The polled order**: `puramass_orders.portal_order`, written each time the
   cron poller, **Sync** or **Refresh** reads the order from the portal.
3. **Our records**: the ledger (`subtotal_cents + shipping_total_cents`,
   `customer_name`, `customer_email`), then the fulfillment invoice's customer.

Hover a customer or a total to see its source. A heart marks a customer
Stealth Health named.

## Money

- Everything is CAD. USD orders are converted at the Settings rate
  (`site_settings.usd_exchange_rate`, USD per 1 CAD): CAD = USD ÷ rate. Each
  request stores the rate it used.
- `fee = round(gross × rate)` in cents, `net = gross − fee`.
- The rate and figures are locked on an order when it is marked paid out. Until
  then the fee type can be switched, and changing the Settings rates moves it.
- A request snapshots its totals. If a fee on it changes afterwards it shows
  **Changed since requested**; the PDF always shows the orders as they stand.

## Files

| Path | Role |
|---|---|
| `lib/brand.ts` | Site brand for the PDF (the only file that differs per site) |
| `lib/admin/stealth-health-payouts.ts` | Pure rules (tested in `stealth-health-payouts.test.ts`) |
| `lib/payments/stealth-health-portal.ts` | Customer and total from a webhook or polled payload (tested) |
| `lib/admin/stealth-health-data.ts` | Server reads (`loadPayoutData`), error responses, audit |
| `lib/admin/stealth-health-payout-pdf.ts` | pdfkit payout request |
| `lib/admin/stealth-health-payouts-client.ts` | Browser calls |
| `app/api/admin/stealth-health/payout-requests/**` | API |
| `app/(admin)/admin/stealth-health/payouts/page.tsx` | The page |
| `app/(admin)/admin/stealth-health/_components/payouts/*` | Page pieces and dialogs |
| `app/(admin)/admin/stealth-health/_components/StealthHealthTabs.tsx` | Settlement / Payouts switch |
| `app/(admin)/admin/layout.tsx` | Sidebar item; only the most specific nav item is highlighted |
| `lib/payments/puramass-poll.ts`, `app/api/admin/puramass/orders/refresh/route.ts` | Store the polled order snapshot (best-effort, own write) |

## API

Reads: admin and assistant. Writes: admin.

| Method & path | Body | Does |
|---|---|---|
| `GET /api/admin/stealth-health/payout-requests` | | Orders, requests, rates, CAD→USD rate. 409 `setup_required` before the migration. |
| `POST /api/admin/stealth-health/payout-requests` | `{order_ids, period_start?, period_end?, notes?}` | Create a request. Ineligible orders come back as `skipped`. |
| `POST …/payout-requests/orders` | `{action: 'fee', order_ids, fee_type}` · `{action: 'paid', order_ids}` · `{action: 'unpaid', order_ids}` | Fee type, mark paid out, undo. |
| `POST …/payout-requests/:id` | `{action: 'receive', amount?, reference?}` · `{action: 'void'}` | Mark received, void. |
| `GET …/payout-requests/:id/pdf` | | `{payout_number}.pdf` |
| `PUT …/payout-requests/rates` | `{catalog, custom}` as fractions | Save the fee rates. |

Audit actions: `stealth_health.payout_create`, `.paid_out`, `.unpaid_out`,
`.payout_receive`, `.payout_void`, `.fee_change`, `.fee_rates`.

Tests: `node --test --import tsx lib/admin/stealth-health-payouts.test.ts lib/payments/stealth-health-portal.test.ts`.
