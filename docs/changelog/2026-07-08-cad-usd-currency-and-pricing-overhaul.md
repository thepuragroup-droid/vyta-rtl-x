# 2026-07-08 — CAD/USD Currency Support & Customer-Pricing Overhaul

## Summary
Added first-class **CAD vs USD** support across invoices, customers and analytics, and rebuilt the **Customer Pricing** admin experience. Every customer now carries a billing currency (CAD or USD, default CAD); invoices are denominated in a currency and default to the linked customer's; and analytics tracks CAD and USD revenue separately (never converted or mixed). The Customer Pricing page moved from a flat table to a grouped card grid with dedicated "see all" detail pages, and the add/edit/bulk override flows were reworked. Several other admin tables gained pagination and skeleton loading.

Requires the new migration to be run before deploy (see below).

---

## What Changed

### Currency data model
- **`invoices.currency`** and **`customers.preferred_currency`** columns added, both default `'CAD'` and constrained to `('CAD','USD')`; index on `invoices.currency` for reporting. Ships as `currency-support-migration.sql`.
- Shared helper `lib/currency.ts` (`formatMoney`, `normalizeCurrency`, `Currency` type). Invoices with no currency set are treated as CAD everywhere.

### Per-customer currency tag
- The New/Edit customer (user-management) modals gained a **CAD/USD billing-currency toggle** ("New invoices for this customer default to this currency"), wired through the users create/update APIs.
- The customer detail page (`/admin/customers/[id]`) has an editable CAD/USD control; the customers list shows an inline CAD/USD badge beside each name.

### Invoices
- The invoice form has a **CAD/USD toggle**. Selecting a customer switches the invoice to that customer's currency and **re-prices product-linked line items** into their pricing (admin can still override).
- Currency is persisted on create and edit, and shown on the invoice detail page (badge), the invoice list (per-row currency + per-day totals split by currency), the printable PDF, and the invoice email.

### Analytics
- The revenue summary API now returns revenue **split by currency** (`revenue.by_currency.CAD` / `.USD`): invoiced, paid, outstanding, and paid/total counts.
- **Earnings are differentiated by currency, never combined.** The two top revenue KPI cards are now **"Earnings — CAD"** and **"Earnings — USD"** (each showing paid + outstanding for that currency), replacing the previous combined "Revenue Paid" / "Outstanding" cards that mixed CAD and USD dollars into one meaningless figure.
- A **"Revenue by currency"** section (side-by-side CAD and USD cards: invoiced, paid, outstanding, paid/total) sits before Open Purchase Orders.

### Customer Pricing page overhaul
- Flat overrides table replaced by a **two-column card grid** with a **By Customer / By Product** grouping toggle and a live count; search filters the cards.
- **By Customer** lists every customer (overrides-first, then alphabetical); pagination **10/page** (customers) and **6/page** (products); page resets on search/grouping change; **skeleton cards** while loading.
- Customer cards carry an inline **CAD/USD toggle** that saves optimistically (reverts on failure); non-admins see it read-only.
- New **"See all" detail pages**: per-customer (`/admin/pricing/customers/[id]`) and per-product (`/admin/pricing/products/[id]`) with add/edit/delete override modals — the product page's add uses a multi-customer selector to price several customers at once.

### Add/Edit & Bulk override flows
- Add/Edit override modal widened and made scrollable; the **customer multi-select is now a floating dropdown** (fixed positioning, flips up when there's no room below) so it is never clipped by the modal edge.
- **Bulk Edit Pricing**: step 1 enlarged; step 2 drops the Status column, keeps a sticky header, and supports **↑/↓/Enter** navigation between price fields; new **step 3 Review & Confirm** shows exactly which customers and prices will change and only writes rows that actually differ.

### Customers list cleanup
- Removed the Joined and Role columns (role now shown as an inline tag for non-customer roles).
- Actions are now **icon-only, right-aligned** — take over, send sign-in link, edit, make/remove admin, delete — each with a custom hover tooltip. New customer sign-in-link API route added.

### Loading & pagination polish
- **Products**: shimmering skeleton rows while loading.
- **Commissions, Sales People, Affiliates**: 20-per-page pagination + skeleton loading rows (reset to page 1 on filter/search change).

---

## Setup / Deploy Notes
1. Run **`currency-support-migration.sql`** in the Supabase SQL Editor before deploying. It is additive and safe to re-run (adds columns with `CAD` defaults, so existing invoices/customers keep their current meaning).
2. No environment variables changed. The customer sign-in-link route reuses the existing SMTP config; if SMTP is not configured it returns the link for the admin to deliver manually.

---

## Files Touched

**Added**
- `currency-support-migration.sql`
- `lib/currency.ts`
- `app/(admin)/admin/pricing/customers/[id]/page.tsx`
- `app/(admin)/admin/pricing/products/[id]/page.tsx`
- `app/api/admin/customers/[id]/magic-link/route.ts`

**Modified**
- `lib/supabase.ts`, `lib/types/ecommerce.ts` (currency fields on `Customer` / `Invoice`)
- `lib/admin/api.ts`, `lib/admin/analytics.ts`, `lib/admin/invoices.ts`, `lib/invoice-email-templates.ts`
- `components/admin/InvoiceForm.tsx`, `components/admin/MultiSelectCustomer.tsx`, `components/admin/NumericStepper.tsx`
- `app/(admin)/admin/analytics/page.tsx`, `app/(admin)/admin/customers/page.tsx`, `app/(admin)/admin/customers/[id]/page.tsx`, `app/(admin)/admin/pricing/page.tsx`
- `app/(admin)/admin/invoices/page.tsx`, `app/(admin)/admin/invoices/[id]/page.tsx`
- `app/(admin)/admin/users/_components/CreateUserModal.tsx`, `app/(admin)/admin/users/_components/EditUserModal.tsx`
- `app/(admin)/admin/products/page.tsx`, `app/(admin)/admin/commissions/page.tsx`, `app/(admin)/admin/sales-persons/page.tsx`, `app/(admin)/admin/affiliates/page.tsx`
- `app/api/admin/analytics/summary/route.ts`, `app/api/admin/customers/route.ts`, `app/api/admin/customers/[id]/route.ts`, `app/api/admin/customers/[id]/insights/route.ts`, `app/api/admin/invoices/route.ts`, `app/api/admin/invoices/[id]/route.ts`, `app/api/admin/invoices/[id]/pdf/route.ts`, `app/api/admin/invoices/[id]/email/route.ts`, `app/api/admin/price-overrides/route.ts`, `app/api/admin/users/route.ts`, `app/api/admin/users/[id]/route.ts`
- `_live-schema-snapshot.sql`
