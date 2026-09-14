# Spec vs. Implementation — Conflict Report

## ✅ Resolution log #2 — Settings / Orders / Analytics docs (build pass)

> Branch `claude/gracious-johnson-4jntwa`. Three new architecture docs (Admin
> Settings, Admin Orders, Admin Analytics) were analyzed against the code and built
> up to the docs where safe. `npm run build` **compiles successfully** and all new
> routes collect. Pre-existing TS errors in untouched files remain (build ignores
> them via `next.config.ts`).

### Settings — BUILT IN FULL ✅
- **Migrations** (additive/idempotent — `site_settings` already existed via
  `invoice-email-migration.sql`): `migration-site-settings.sql` (checkout_type +
  admin_emails + singleton index + RLS + seed), `migration-checkout-config.sql`
  (pickup_address, guest_checkout_enabled, customers.allow_pickup/allow_shipping),
  `easyship-settings-migration.sql` (easyship_* + shipping_* + orders tracking cols).
- **Type**: `SiteSettings` (+ `ShippingOrigin`/`ShippingBox`) added to `lib/supabase.ts`.
- **API**: `app/api/admin/settings/route.ts` — `GET` (unauthenticated, shaped,
  key-redacted as `easyship_api_key_set`, graceful Easyship-column fallback) and
  `PUT` (admin-only, assistants excluded; validates/whitelists every field; API key
  write-only; upserts the singleton).
- **Templates lib**: `lib/invoice-email-templates.ts` — `MERGE_VARS` upgraded to the
  rich `{ token, description, sample }` descriptor list; `buildInvoiceMergeVars`
  extended (customer_first/last_name, customer_email, invoice_total alias,
  amount_paid, currency, sent_by_email). Existing `{{total}}` templates still work.
- **Pages**: `app/(admin)/admin/settings/page.tsx` (all 9 sections, save-on-change +
  explicit Save for pickup/shipping, assistant read-only) and
  `email-templates/page.tsx` (customer/admin tabs, live preview, insertable merge-var
  chips, reset, admin-only).
- **Nav**: `Settings` entry added to `app/(admin)/admin/layout.tsx`.

> ⚠️ **Action required:** run the three SQL migrations against Supabase. The
> settings API reads/writes columns they add (it degrades gracefully if the Easyship
> columns are missing, but checkout/pickup/guest columns are required for full use).

### Analytics — REWRITTEN to match doc ✅
- `app/api/admin/analytics/summary/route.ts`: `revalidate = 30`,
  `isAdminOrAssistant`, `from`/`to` range params, constants (`LOW_STOCK_THRESHOLD=5`,
  `OPEN_PO_STATUSES`, `REVENUE_INVOICE_STATUSES`), **inventory from
  `products(id, price, stock_quantity)`** (not variants), revenue with **per-invoice
  payment clamp** (joined `payments`), returns **`{ summary }`** with `revenue.range`.
- `lib/admin/analytics.ts`: `getAnalyticsSummary(range?)` + `AnalyticsRange`,
  `cache:'no-store'`, builds `?from=&to=`, unwraps `{ summary }`.
- `app/(admin)/admin/analytics/page.tsx`: rewritten with `KpiCard`/`DetailCard`/
  `DateField` sub-components, From/To/Clear/Refresh header, `PO_STATUS_META` badges,
  links now point to `/admin/products` (was `/admin/inventory`).
- **CONFLICT resolved by aligning to the doc:** analytics previously aggregated the
  **variant** model (`product_variants.qty_on_hand * cost_price`,
  `reorder_threshold`). It now uses `products.stock_quantity * price`, consistent with
  the prior decision to retire the variant inventory surface. **If you want to keep
  the variant-valuation behavior, this is the spot to revert.**

### Orders — PARTIAL (additive only); shipping subsystem flagged for your review ⚠️
- **BUILT:** `lib/orderSource.ts` (`sourceLabel` / `sourceBadgeClasses`, tolerant of
  unknown/empty). Orders tracking columns are added by the Easyship migration above.
- **NOT BUILT — architectural CONFLICT (decision needed).** The Orders doc specs a
  whole shipping stack that **already exists in a different shape** in the repo. I did
  not build a second parallel stack on top of working code. The conflict:

  | Doc says (target) | Repo has (current) |
  |---|---|
  | `lib/shipping/easyship.ts` — 9 exports (rates/shipment/label/docs, `getShippingConfig`, `resolveShippingCost`, `getShippingQuoteOrFallback`) | `lib/easyship.ts` — 3 fns (`fetchEasyshipRates`, `createEasyshipShipment`, `getEasyshipTracking`) + `lib/admin/orders-extended.ts` (`getShippingRates`/`createShipment`) |
  | Per-order routes `/api/admin/orders/[id]/{label-readiness,shipping-address,create-shipment,buy-label,label}` | `/api/admin/easyship/{rates,shipments}` (not per-order) |
  | `POST /api/webhooks/easyship` (HMAC, forward-only tracking) | **absent** |
  | `ShippingLabelPanel` on the order detail page (readiness checklist, address editor, buy/print label) | **absent** — order detail has only a tracking-number input |
  | Orders list **Source** column + **Download Report** + `min-w-[860px]` | list has neither; `min-w` absent |
  | Payment monitor creates an Easyship shipment at confirmation | `check-payments` cron does **not** create shipments |
  | `orders.source` / `label_url` / `label_state` columns | **not in any migration** |

  **Why deferred, not done:** replacing the existing Easyship implementation +
  building the readiness/label UI, HMAC webhook, and source/report columns is a large
  net-new subsystem that would either duplicate or rip out currently-working code —
  exactly the kind of conflict you asked me to bring over. **Decision needed:** adopt
  the doc's `lib/shipping/easyship.ts` + per-order routes + webhook + ShippingLabelPanel
  (retiring `lib/easyship.ts` and `/api/admin/easyship/*`), or keep the current stack
  and reconcile the doc to it?

---

## ✅ Resolution log (build pass — docs treated as source of truth)

Per the decision to build the code up to the docs, the following were implemented
on branch `claude/dreamy-curie-8ra7p1`:

- **Migrations added** (must be applied to the DB — see "Action required" below):
  `low-stock-alerts-migration.sql` (threshold + alerted + `site_settings.admin_emails`),
  `product-sku-migration.sql`, `stock-notifications-migration.sql`; orders side added to
  `stock-decrement-migration.sql`.
- **Types**: `Product` now has `low_stock_threshold` and `sku` (P11).
- **Email**: `sendBackInStockNotification` / `sendLowStockAlert` added to `lib/email.ts`;
  `lib/email-smtp.ts` re-exports them (transport is Resend, not SMTP — see deviation note).
- **Low-stock engine**: `lib/admin/low-stock.ts` rewritten (cross-below/recover, alerted
  flag, admin email dispatch); `getLowStockProducts()` added to `lib/admin/api.ts`.
- **Products API**: `POST` defaults (threshold 10, sku, coa_url array coercion);
  `[id]` is now `PATCH` (PUT kept as alias) with restock waitlist fan-out + low-stock
  recheck (P5–P10, P7).
- **New APIs**: public + admin `stock-notifications`, public `/api/products` + `featured`,
  printable `report` (P1–P3, S5, S6).
- **Products page**: title/subtitle, Download Report, flex-wrap/flex-1, `min-w-[720px]`,
  ellipsis, dashed-underline+Pencil idle edit, **Alert at** column, threshold inline edit,
  PATCH switch, restock confirm dialog, import template download, SKU + threshold fields
  (P13–P23).
- **Stock Requests page** + nav entry + `LoadingFeedback` + `useSmartLoad` upgrade
  (S11–S14).
- **Pricing**: 3 shared components, Discount column, bronze override price, View-only
  fallback, modal sizing/labels/icons, AlertCircle success, import validate/preview
  (PR1–PR19).
- **Inventory**: variant-based `/admin/inventory` flagged `@deprecated` (retire later).

### ⚠️ Action required by you
1. **Run the new SQL migrations** against Supabase (low-stock, sku, stock-notifications,
   updated stock-decrement). The code expects these columns/tables.
2. **Customer-facing "notify me" widget is NOT built.** The public subscribe API exists
   (`/api/stock-notifications`) but no storefront UI calls it yet — none of the three docs
   specced that component. The waitlist won't populate until a subscribe entry point is
   added to the storefront product page. **Decision needed.**

### Intentional deviations from the docs
- `lib/email-smtp.ts` is a thin re-export; senders live in `lib/email.ts` (Resend, not SMTP).
- `PUT /api/admin/products/[id]` retained as an alias of `PATCH` for backward compatibility.
- **Backorders** (`backorders-migration.sql`, `lib/admin/backorder-sync.ts`) were left for
  their own separate doc (not provided) — S3/S9 remain open by design.

---



> Generated audit comparing the three architecture docs (Products, Stock Requests,
> Pricing) against the current code in this repo. Each item is tagged:
> **MISSING** (spec'd, not built) · **CONFLICT** (built differently than spec) ·
> **STYLING** (visual/class-level deviation) · **MINOR** (naming/cosmetic).
>
> ⚠️ The pasted architecture docs appear to be an **idealized spec**, not a
> description of the current build. An existing in-repo doc,
> `docs/superpowers/admin-products-page.md`, documents the *actual* products page
> and itself contradicts the new Products doc (e.g. PUT vs PATCH, "Product
> Management" vs "Products"). Decide which is the source of truth before fixing.

---

## 0. Cross-cutting architectural conflict (read first)

- **CONFLICT — inventory model.** `simplify-product-stock-migration.sql` intentionally
  moved the source of truth for stock **off `product_variants` back onto
  `products.stock_quantity`**. Yet a separate **variant-based** `/admin/inventory`
  page + `/api/admin/inventory` (using `product_variants.qty_on_hand`, `getLowStockAlerts`,
  valuation) still exists and is **not mentioned in any of the three docs**. The
  Stock Requests doc assumes the `products.stock_quantity` + waitlist model that was
  never finished. → **Need a decision: is the variant inventory page being retired in
  favour of the doc's `products.stock_quantity` model, or kept?**
- **CONFLICT — missing `Product` columns.** The Products doc's `Product` type lists
  `low_stock_threshold` and `sku`. Neither exists in `lib/supabase.ts` `Product`
  (lines 160-180) nor in any migration. Several doc features depend on these columns.

---

## 1. Products doc (`Admin / Products — Architecture`)

> The in-repo `docs/superpowers/admin-products-page.md` matches the code; the new
> Products doc does not. Items below are measured against the **new** doc.

### Backend
| # | Severity | Location | Spec says → Code does |
|---|----------|----------|------------------------|
| P1 | MISSING | `app/api/admin/products/report/route.ts` | Printable HTML report route → does not exist |
| P2 | MISSING | `app/api/products/route.ts` | Public active list, `?slug` single, price-override resolution → whole dir absent |
| P3 | MISSING | `app/api/products/featured/route.ts` | Public active+featured list → absent |
| P4 | MISSING | `lib/email-smtp.ts` | `sendBackInStockNotification` → file/fn absent (email lib is `lib/email.ts`) |
| P5 | MISSING | `app/api/admin/products/[id]/route.ts` | `notifyWaitlist` + restock 0→positive detection → absent (no `stock_notifications` anywhere) |
| P6 | MISSING | `[id]/route.ts` | `checkLowStockForProducts` call after update → never called by this route |
| P7 | CONFLICT | `[id]/route.ts:83` | Spec **PATCH** whitelisted merge → code exports **PUT** |
| P8 | CONFLICT | `[id]/route.ts:153-168` | Whitelist should include `low_stock_threshold`/`sku` → neither present, can't be updated |
| P9 | CONFLICT | `route.ts:169` | `coa_url` coerced to array in route → inserted as-is (works only because client sends array) |
| P10 | MISSING | `route.ts:151-170` | `low_stock_threshold` default 10 on create → no such field in insert |
| P11 | CONFLICT | `lib/supabase.ts:160` | `Product` includes `low_stock_threshold`, `sku` → both absent |
| P12 | MINOR | `lib/admin/low-stock.ts:11` | Threshold default 10 → code uses 5; reads no per-product column; never wired into `[id]` route |

### Frontend (`app/(admin)/admin/products/page.tsx`)
| # | Severity | Location | Spec says → Code does |
|---|----------|----------|------------------------|
| P13 | CONFLICT | `page.tsx:444` | `<h1>` "**Products**" + role-aware subtitle → "**Product Management**", static "Manage product catalog", no role awareness |
| P14 | MISSING | `page.tsx:447-464` | **Download Report** button (bg-white border, FileText) → absent (no `FileText`, no `downloading` state) |
| P15 | STYLING | `page.tsx:448` | Right cluster `flex items-center gap-2 flex-wrap` → missing `flex-wrap` |
| P16 | STYLING | `page.tsx:449-462` | Buttons `flex-1` full-width on mobile → no responsive width classes |
| P17 | MISSING | `page.tsx:509` | Table `min-w-[720px]` → `<table className="w-full">` only |
| P18 | STYLING | `page.tsx:591-597` | Idle price = dashed-underline button + faint `Pencil` → plain span, no underline, no Pencil icon |
| P19 | MISSING | `page.tsx` | **"Alert at" column** + "≤ threshold" amber label → no such column/label |
| P20 | MISSING | `page.tsx:31` | `inlineEdit` field union incl. `'low_stock_threshold'` → only `'price' | 'stock_quantity'` |
| P21 | MISSING | `page.tsx` | **Restock confirmation dialog** + `restockConfirm`/`restockSaving` state → none; stock edit PUTs directly |
| P22 | MISSING | `page.tsx:1094-1124` | Import step-1 "download template" helper → absent |
| P23 | STYLING | `page.tsx:498` | Placeholder "Search products**…**" → uses ASCII "..." |

**Compliant:** upload + upload-certificate routes (20MB, MIME allow-list, PDF-only),
import route POST/PUT logic, GET/POST list+create basics, inline price/stock edit
mechanics, status badges, actions column, alert banners, create/edit modal structure,
delete modal, import 2-step flow + toast. Note: cert bucket is **`certificates`**
(code) vs **`certificate`** (doc).

---

## 2. Stock Requests doc (`Stock Requests, Low-Stock Alerts & Fulfillment`)

> **~10-15% implemented.** The customer notify-me waitlist is 0% built.

| # | Severity | Location | Status |
|---|----------|----------|--------|
| S1 | MISSING | `stock-notifications-migration.sql` | No file; `stock_notifications` appears nowhere |
| S2 | MISSING | `low-stock-alerts-migration.sql` | No file; `low_stock_threshold`/`low_stock_alerted` columns absent |
| S3 | MISSING | `backorders-migration.sql` | No file; no `backorders`/`backorder_items` tables |
| S4 | CONFLICT | `stock-decrement-migration.sql` | Invoice side only (`adjust_stock_for_invoice`); **orders side absent** (no `orders.stock_adjusted`, no `adjust_stock_for_order`) |
| S5 | MISSING | `app/api/stock-notifications/route.ts` | Public GET/POST/DELETE subscribe → dir absent |
| S6 | MISSING | `app/api/admin/stock-notifications/route.ts` | Admin waitlist read (aggregated) → dir absent |
| S7 | CONFLICT | `lib/admin/low-stock.ts` | `checkLowStockForProducts` is a **console-only stub**: no threshold column, no alerted flag, no cross-below/recover edges, no email; default 5 not 10 |
| S8 | MISSING | `lib/admin/api.ts` | `getLowStockProducts()` (nav badge source) → absent |
| S9 | MISSING | `lib/admin/backorder-sync.ts` | `syncInvoiceBackorder` → file/fn absent |
| S10 | MISSING | `lib/email-smtp.ts` | `sendBackInStockNotification` + `sendLowStockAlert` → absent |
| S11 | MISSING | `app/(admin)/admin/stock-requests/page.tsx` | Whole page (Bell header, summary cards, waitlist table) → absent |
| S12 | MISSING | `app/(admin)/admin/layout.tsx` | Nav entry `{ Stock Requests, Bell }` → absent (also no Inventory entry) |
| S13 | MISSING | `components/LoadingFeedback` | `SlowLoadingNotice` / `LoadingError` → absent |
| S14 | CONFLICT | `lib/hooks/useSmartLoad.ts` | Exists but is `useSmartLoad<T>(url: string)` returning `{data,loading,error,reload}` — not the fetcher-fn + `slow` contract the doc implies |

**Off-spec alternative present:** `/admin/inventory` (variant-based) provides loose
admin low-stock *visibility* but no waitlist, no back-in-stock email, no alerted flag,
no backorders.

---

## 3. Pricing doc (`Admin / Pricing — Architecture`)

> **Backend + migrations faithful.** Divergence is in the frontend.

### Faithful
- All 4 API route files (resolution order, single-active invariant, seed/rollback,
  audit, affiliate scoping, import) match.
- `lib/admin/pricelists.ts` exports all functions; `getActivePricelist()` map correct.
- `pricelist-migration.sql` + `customer-pricing-migration.sql` match (single-active
  partial unique, upsert keys, RLS incl. own-row customer read).
- `PricelistsTab.tsx` exists and is wired into the Invoices page as a tab.

### Conflicts / gaps
| # | Severity | Location | Spec says → Code does |
|---|----------|----------|------------------------|
| PR1 | MISSING | `components/admin/` | `MultiSelectCustomer`, `ProductToggleSelector`, `NumericStepper` → none exist; page inlines checkboxes / native `<select>` / number input |
| PR2 | MISSING | `pricing/page.tsx` table | **Discount column** → entirely absent |
| PR3 | MISSING | `pricing/page.tsx` actions | "View only" fallback when no perms → absent |
| PR4 | CONFLICT | `pricing/page.tsx:35` | `mayEdit` gates Edit → no `mayEdit`; Edit gated by `mayCreate`; `canEdit` unused |
| PR5 | CONFLICT | `pricelists.ts:9` | Exported `apiFetch` (throw-on-error) → not exported; uses `{success,error}` returns |
| PR6 | CONFLICT | `PriceListImportModal.tsx` | Multi-customer select + **Validate/preview step** → single `<select>`, no preview, straight to Apply |
| PR7 | CONFLICT | `pricing/page.tsx` bulk step2 | SKU column + Status column ("Set"/blue) → no SKU column; status as inline badge |
| PR8 | CONFLICT | single modal | Uses shared components + in-modal error banner → inline controls, no in-modal error banner |
| PR9 | STYLING | `pricing/page.tsx:162` | Override Price cell **bronze** → `text-ink` bold |
| PR10 | STYLING | `pricing/page.tsx:122` | Success alert `AlertCircle` → `Check` icon |
| PR11 | STYLING | `pricing/page.tsx:257` | Single modal `max-w-md` → `max-w-lg` |
| PR12 | STYLING | `pricing/page.tsx:291` | Footer `flex-1`/`gap-3`/`bg-surface`, "Save Override" + Save icon → `justify-end`, "Save" + Check icon |
| PR13 | STYLING | `pricing/page.tsx:348` | Bulk step1 `max-w-md` / step2 `max-w-5xl` → shared `max-w-2xl` |
| PR14 | STYLING | `pricing/page.tsx:422,428` | Bulk Next/Save `bg-bronze` + ArrowRight/Save, "Next: Set Prices"/"Save Price Overrides" → `bg-ink`, "Next"/"Apply to N", Check icon, no ArrowLeft on Back |
| PR15 | STYLING | bulk step2 grid | Blue info note + `min-w-[640px]` + sticky head + `max-h-96` → plain note, no min-w/sticky/scroll wrapper |
| PR16 | STYLING | `pricing/page.tsx:171` | Delete `hover:text-red-600`, `p-2` → `hover:text-red-500`, `w-8 h-8` |
| PR17 | STYLING | `PriceListImportModal.tsx:65,67` | `max-w-2xl`, Upload icon, "Import price list (CSV)" → `max-w-lg`, `FileSpreadsheet`, "Import Price Overrides" |
| PR18 | MINOR | API routes | Mutation gate via `canCreate` → inlined `role === 'admin'` |
| PR19 | MINOR | `pricelists.ts:63` | Exported `PricelistPatch` type → inline param shape, no alias |

---

## Recommended decision points

1. **Source of truth:** treat the new docs as the target (build code up to them), or
   reconcile the docs to match reality? (They conflict with an existing in-repo doc.)
2. **Inventory model:** retire variant-based `/admin/inventory` in favour of the doc's
   `products.stock_quantity` + waitlist model, or keep variants?
3. **Scope/priority:** the Stock Requests subsystem and Products `low_stock_threshold`/
   `sku`/report/public-API work are large net-new features. The Pricing deltas and
   Products styling deltas are small, safe, and well-scoped — these can be done now.
