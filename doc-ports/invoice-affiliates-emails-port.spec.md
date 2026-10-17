# Invoice Page + Affiliates Page + Shipped / Commission Emails — Build Spec

> Definitive spec for porting this feature cluster from **vyta-rtl-x** into **aminocan-cad**
> (Next.js + Supabase). Generated 2026-10-14 from `main` @ `6397ef9`.
>
> **Examined:** `app/(admin)/admin/invoices/[id]/page.tsx`, `app/(admin)/admin/invoices/page.tsx`,
> `app/(admin)/admin/affiliates/page.tsx`, `app/(admin)/admin/affiliates/[id]/page.tsx`,
> `app/(admin)/admin/affiliates/_components/*`, `app/(admin)/admin/commissions/page.tsx`,
> `components/admin/{InvoiceEasyshipPanel,LiveShipmentTracking,FulfillmentEmailCard,EasyshipShipmentPicker,OrderManagementPanel}.tsx`,
> `components/FulfillmentEmailModal.tsx`, `components/admin/affiliates/AffiliateCodesPayouts.tsx`,
> `components/affiliate/ReferralCodeField.tsx`, `lib/fulfillment-email.ts`, `lib/affiliate-commission-email.ts`,
> `lib/affiliate/{commission,commission-email,payouts,referral-code-service,discount-codes,utils}.ts`,
> `lib/warehouse/server.ts` (shipped-email sender), `lib/shipping/*`, `lib/easyship.ts`,
> `lib/admin/{invoices,invoice-breakdown,invoice-status,alert-recipients,invoice-access}.ts`,
> `lib/order-confirmation-email.ts` (shared email helpers), `lib/email.ts`, `lib/smtp.ts`,
> every route under `app/api/admin/invoices/[id]/*`, `app/api/admin/affiliates/**`,
> `app/api/admin/commissions/**`, `app/api/warehouse/queue/[id]/notify`, `app/api/webhooks/easyship`,
> `app/api/affiliate/*`, `app/order/track/page.tsx`.
>
> **Stack:** Next.js 15.5 **App Router**, Supabase JS 2.83 (service-role in every route, browser anon
> client on some reads), Tailwind 3.4, lucide-react, nodemailer 8 (SMTP), pdf-lib + pdfjs-dist (labels),
> leaflet (map).
>
> **Schema source:** no schema was pasted for this spec, so §2 is built from the repo's migration files.
> `_live-schema-snapshot.sql` (2026-06-23) is **stale** for every shipment/commission column below; the
> migration file named next to each column is the authority. Verify against the live DB before porting
> (§7).
>
> This supersedes the email/shipping/commission parts of `invoicing-ar-cluster.spec.md` and
> `affiliate-program-cluster.spec.md` (2026-09-29), which predate the shipped email, the commission
> email, the auto-send on label, and the invoice rail tabs.

---

## 1. Overview

Two admin screens and the two transactional emails that hang off them:

- **Invoice detail page** (`/admin/invoices/[id]`) — the operational record of one sale. A summary
  strip (status / amount due / customer / shipping), a live shipment-tracking card, line items + totals
  on the left, and a **tabbed right rail** (Shipping · Emails · Sales · Details). From here an admin
  creates/rebooks the Easyship shipment, buys and prints the 4x6 label, previews/sends the
  **"Your Order Has Shipped!"** email, and sees/books/emails the **affiliate commission**.
- **Affiliates pages** (`/admin/affiliates`, `/admin/affiliates/[id]`) — a directory of partners with
  filters, lead-claiming, and actions; and a "Partner 360" profile with stats, referral code, discount
  codes, payouts, commissions and email history. A sibling **commissions desk**
  (`/admin/commissions`) groups pending/paid commissions and marks them paid.
- **Shipped email** — the one customer shipping email. Sent **automatically once per invoice** the first
  time an Easyship label exists, and **manually** (preview, edit recipients/tracking, send/resend) from
  the invoice page. It carries the **tracking number, carrier (+logo), Track Your Order button, and
  estimated delivery window**. Admins get a flagged copy.
- **Affiliate commission email** — "You earned a new commission". Sent **automatically once** when a
  paid order books a commission, and **manually** from the invoice page's "Email affiliate & admins"
  button. Admins get a copy under their own subject.
- **Tracking of both emails** — every send attempt (success or failure, auto or manual, with sender and
  provider message-id) is logged to **`fulfillment_email_log`**; the shipped email additionally stamps
  `invoices.shipped_emailed_at`, which drives the "Sent {date}" / "Not sent" UI and the dedupe.

How the pieces connect:

```
Paid order ─► invoices.status='paid' ─► recordAffiliateCommission() ─► commissions row (pending)
                                                  │ recorded:true only
                                                  ▼
                                   notifyAffiliateOfCommission() ─► affiliate email + admin copy
                                                                     └► fulfillment_email_log ×2
Easyship label generated (buy-label / webhook / auto-create / override / sync / live refresh)
   ─► onShipmentLabelGenerated() ─► mirror shipment record onto invoice(s)
                                  ─► sendShippedEmailOnce() ─► sendFulfillmentEmail()
                                       (claim shipped_email_auto_claimed_at)   ├► customer email
                                                                               ├► admin copy
                                                                               ├► fulfillment_email_log
                                                                               └► invoices.shipped_emailed_at
Invoice page ─► "Preview & send" ─► /api/warehouse/queue/[id]/notify (same sendFulfillmentEmail)
            ─► "Email affiliate & admins" ─► /api/admin/invoices/[id]/commission/email
```

---

## 2. Database schema

### 2.1 `invoices` (only the columns this cluster reads/writes)

```sql
-- core (snapshot)
id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
invoice_number         text NOT NULL,                       -- 'VYTA-####' (invoice-number-vyta-prefix-migration.sql)
order_id               uuid,                                -- storefront order; NULL for hosted-checkout / manual
customer_id            uuid REFERENCES customers(id),       -- FK name: invoices_customer_id_fkey
customer_name          text, customer_email text, customer_phone text,
issue_date             date NOT NULL DEFAULT CURRENT_DATE,
due_date               date NOT NULL,
subtotal               numeric NOT NULL DEFAULT 0,
tax_total              numeric NOT NULL DEFAULT 0,
shipping_cost          numeric NOT NULL DEFAULT 0,
total                  numeric NOT NULL DEFAULT 0,
currency               text NOT NULL DEFAULT 'CAD',
status                 text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','sent','partial','paid','overdue','cancelled','pending_payment','expired')),
notes                  text,
source                 text,                                -- hosted-checkout marker (puramass-hosted-checkout-migration.sql)
fulfillment_type       text NOT NULL DEFAULT 'shipment',    -- 'shipment' | 'pickup'
fulfillment_status     text NOT NULL DEFAULT 'pending',     -- pending | packed | shipped | picked_up | dropped_off (see §7)
stock_adjusted         boolean NOT NULL DEFAULT false,
is_backorder           boolean NOT NULL DEFAULT false,
sales_person_id        uuid REFERENCES sales_persons(id),
sales_person_commission_rate   numeric DEFAULT 0,
sales_person_commission_amount numeric DEFAULT 0,
ships_to_client        boolean NOT NULL DEFAULT false,      -- invoice-ships-to-client-columns-migration.sql
client_id              uuid REFERENCES customer_clients(id) ON DELETE SET NULL,
last_emailed_at        timestamptz, last_emailed_by uuid, last_emailed_by_email text,  -- invoice-email-migration.sql
created_at timestamptz, updated_at timestamptz,

-- shipped email (warehouse-emails-orders-migration.sql, easyship-label-sync-migration.sql)
packed_emailed_at              timestamptz,                 -- legacy; unused now
shipped_emailed_at             timestamptz,                 -- set on ANY successful shipped send (manual or auto)
shipped_email_auto_claimed_at  timestamptz,                 -- auto-send claim; released on failure

-- shipment mirror (easyship-invoice-shipment-migration.sql)
easyship_shipment_id   text,         -- partial index WHERE NOT NULL
easyship_courier_id    text,
tracking_number        text,
tracking_status        text,
tracking_url           text,
carrier                text,
label_state            text,         -- 'not_created' | 'pending' | 'generated' | 'failed' | 'cancelled'
label_url              text,
tracking_checkpoints   jsonb,        -- [{message, occurred_at, location, primary_status}]
auto_shipment_status   text,         -- 'success' | 'skipped' | 'failed'
auto_shipment_stage    text,         -- 'create' | 'rate' | 'buy-label'
auto_shipment_error    text,
auto_shipment_attempted_at timestamptz,

-- shipment record (easyship-label-sync-migration.sql)
shipping_service       text,
shipping_label_cost    numeric(10,2),
shipping_label_currency text,
est_delivery_min_days  integer,
est_delivery_max_days  integer,
label_generated_at     timestamptz,
easyship_synced_at     timestamptz,

-- no migration found (see §7): processing_fee, show_processing_fee, with_labels
```

`orders` carries the same shipment columns (`tracking_*`, `carrier`, `shipping_carrier`,
`easyship_shipment_id`, `easyship_courier_id`, `label_*`, `auto_shipment_*`, `tracking_checkpoints`,
`shipping_service`, `shipping_label_cost`, `shipping_label_currency`, `est_delivery_*`,
`label_generated_at`, `easyship_synced_at`) plus `order_number`, `status`, `email`,
`shipping_address jsonb`, `items jsonb`, `shipped_at`, `delivered_at`.

### 2.2 Email send log — `fulfillment_email_log` (the "tracking" for both emails)

```sql
CREATE TABLE IF NOT EXISTS fulfillment_email_log (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id    uuid,
  order_id      uuid,
  kind          text NOT NULL,   -- NO CHECK constraint (dropped by order-confirmation-email-migration.sql)
  to_email      text NOT NULL,   -- comma-joined when several
  subject       text,
  message_id    text,            -- SMTP message id
  success       boolean NOT NULL DEFAULT false,
  error         text,
  sent_by       uuid,            -- NULL = automatic
  sent_by_email text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fulfillment_email_log_kind_order   ON fulfillment_email_log (kind, order_id)   WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fulfillment_email_log_kind_invoice ON fulfillment_email_log (kind, invoice_id) WHERE invoice_id IS NOT NULL;
```

`kind` values in this cluster: `shipped`, `affiliate_commission`, `affiliate_commission_admin_copy`.
Siblings using the same table: `order_confirmation`, `admin_paid_alert`, `packed`, `etransfer_*`.

> If aminocan-cad's `fulfillment_email_log` still has a `CHECK (kind IN (...))`, Supabase **reports**
> (doesn't throw) the rejected insert — the email goes out but the log stays empty. Drop the CHECK, as
> `order-confirmation-email-migration.sql` does.

### 2.3 Affiliate tables

```sql
-- affiliates
id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- = auth.users.id for admin/approved affiliates
email            varchar(255) UNIQUE NOT NULL,                 -- stored lowercased
first_name       varchar(100) NOT NULL,
last_name        varchar(100) NOT NULL,
wallet_address   varchar(42),
password_hash    text NOT NULL,                                -- LEGACY sha256; real auth = Supabase Auth
active           boolean DEFAULT true,                         -- false => auth user banned 876600h, codes not honoured
total_earnings   numeric(10,2) DEFAULT 0,                      -- TRIGGER: Σ amount of PAID commissions
commission_rate  numeric(5,4) NOT NULL DEFAULT 0.10 CHECK (commission_rate BETWEEN 0 AND 1),  -- FRACTION
created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()  -- updated_at trigger

-- commissions  (there is NO affiliate_commissions table)
id               uuid PRIMARY KEY,
affiliate_id     uuid NOT NULL REFERENCES affiliates ON DELETE CASCADE,
order_id         uuid REFERENCES orders,                       -- nullable (was NOT NULL)
invoice_id       uuid REFERENCES invoices ON DELETE CASCADE,   -- affiliate-commission-hosted-checkout-migration.sql
referral_code_id uuid REFERENCES referral_codes,
discount_code_id uuid REFERENCES discount_codes ON DELETE SET NULL,
payout_id        uuid REFERENCES affiliate_payouts ON DELETE SET NULL,
amount           numeric(10,2) NOT NULL,
order_total      numeric(10,2) NOT NULL,                       -- the commission BASE (discounted goods subtotal)
commission_rate  numeric(5,2) DEFAULT 10.00,                   -- PERCENT
status           varchar(20) DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled')),
paid_at          timestamptz,
created_at       timestamptz DEFAULT now(),
CONSTRAINT commissions_one_source CHECK (num_nonnulls(order_id, invoice_id) = 1)
-- UNIQUE idx_commissions_order_unique   (order_id)   WHERE order_id   IS NOT NULL
-- UNIQUE idx_commissions_invoice_unique (invoice_id) WHERE invoice_id IS NOT NULL   ← dedupes commission AND its email
-- idx on affiliate_id, status, discount_code_id, payout_id

-- affiliate_payouts (affiliate-discount-codes-payouts-migration.sql; RLS on, no policies)
id uuid PK, affiliate_id uuid NOT NULL REFERENCES affiliates ON DELETE CASCADE,
amount numeric(10,2) NOT NULL CHECK (amount > 0), method varchar(30) NOT NULL DEFAULT 'e_transfer',
reference varchar(255), notes text, paid_at timestamptz NOT NULL DEFAULT now(),
recorded_by uuid, recorded_by_name varchar(255), created_at timestamptz NOT NULL DEFAULT now()
-- index (affiliate_id, paid_at DESC)

-- referral_codes
id uuid PK, affiliate_id uuid NOT NULL REFERENCES affiliates ON DELETE CASCADE,
code varchar(32) UNIQUE NOT NULL, active boolean DEFAULT true,
uses_count integer DEFAULT 0,      -- TRIGGER: +1 per commission with this referral_code_id
created_at timestamptz

-- referral_code_requests (referral-code-requests-migration.sql; RLS on, zero policies)
id uuid PK, affiliate_id uuid NOT NULL REFERENCES affiliates ON DELETE CASCADE,
requested_code varchar(32) NOT NULL, previous_code varchar(32),
status varchar(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
source varchar(20) DEFAULT 'affiliate' CHECK (source IN ('affiliate','admin')),
decided_by uuid, decided_by_name varchar(255), decided_at timestamptz, decision_notes text, created_at timestamptz
-- UNIQUE partial: one pending per affiliate; one pending per requested_code

-- affiliate_requests (affiliate-program-migration.sql)
id uuid PK, customer_id uuid NOT NULL REFERENCES customers ON DELETE CASCADE,
status text DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
wallet_address text, message text, requested_code varchar(32),
reviewed_by uuid REFERENCES customers ON DELETE SET NULL, reviewed_at timestamptz, created_at timestamptz
-- UNIQUE partial: one pending per customer

-- discount_codes (affiliate-discount-codes-payouts-migration.sql; + landing-pages-migration.sql)
id uuid PK, code varchar(32) UNIQUE NOT NULL, affiliate_id uuid REFERENCES affiliates ON DELETE SET NULL,
discount_type varchar(10) DEFAULT 'percent' CHECK (discount_type IN ('percent','fixed')),
discount_value numeric(10,2) NOT NULL CHECK (> 0),
commission_rate numeric(5,2) NULL CHECK (0..100),   -- PERCENT override; NULL = affiliate's rate; 0 = discount only
min_subtotal numeric(10,2), max_uses integer CHECK (> 0), starts_at timestamptz, expires_at timestamptz,
active boolean NOT NULL DEFAULT true, notes text, created_by uuid, created_at, updated_at,
first_order_only boolean, excluded_product_ids (type unverified — §7)
```

**Triggers (must be ported; app code never bumps these counters):**

- `increment_code_on_commission_created` AFTER INSERT ON commissions →
  `UPDATE referral_codes SET uses_count = uses_count + 1 WHERE id = NEW.referral_code_id` (if not null).
- `update_earnings_on_commission_paid` AFTER UPDATE ON commissions → status → `paid` adds `NEW.amount`
  to `affiliates.total_earnings`; `paid` → other subtracts (`GREATEST(0, total_earnings - OLD.amount)`).
- `update_affiliates_updated_at` BEFORE UPDATE ON affiliates.

**Related:** `customers` (`role` enum incl. `admin|assistant|affiliate|customer|warehouse`,
`affiliate_id` = bound affiliate, `can_send_fulfillment_emails`, `active`), `sales_persons`,
`sales_commissions` (separate sales-rep stream), `puramass_orders` (hosted-checkout ledger:
`subtotal_cents`, `referral_code`, `discount_code_id`, `customer_id`, `invoice_id`, `status`),
`site_settings` (`admin_emails jsonb`, `invoice_cc_emails jsonb`, `easyship_*`, `shipping_*`),
`invoice_email_log`, `shipment_auto_logs`, `customer_leads`, `customer_emails`, `customer_activity`,
`audit_logs`.

### 2.4 Schema usage

| Table.column | Read by | Written by |
|---|---|---|
| `invoices.shipped_emailed_at` | invoice page (Emails tab dot, FulfillmentEmailCard, Easyship panel "Shipped email" row), `sendShippedEmailOnce`, redo-shipment response | `sendFulfillmentEmail` on success |
| `invoices.shipped_email_auto_claimed_at` | — | `sendShippedEmailOnce` (claim / release) |
| `invoices.tracking_*`, `carrier`, `label_*`, `easyship_*` | tracking route, Easyship panel, shipped-email builder, label route | `onShipmentLabelGenerated`, buy-label, create/redo/override shipment, webhook |
| `invoices.est_delivery_*`, `shipping_service`, `shipping_label_cost/_currency`, `label_generated_at`, `easyship_synced_at` | tracking route (`record`) | `onShipmentLabelGenerated` (`extendedShipmentPatch`) |
| `fulfillment_email_log` | email history cards (confirmation/paid alert), audit | `sendFulfillmentEmail` (`shipped`), `notifyAffiliateOfCommission` (both commission kinds) |
| `commissions` | invoice breakdown (Sales tab), affiliate insights, payouts panel, commissions desk, affiliate dashboard, manual commission email | `recordAffiliateCommission` (insert), payouts (status/paid_at/payout_id), desk "Mark paid" |
| `affiliates` | directory, insights, commission email | admin create/update/delete, request approve |
| `affiliate_payouts` | payouts panel | record / void payout |
| `referral_codes`, `referral_code_requests` | directory, profile, attribution | `assignReferralCode`, request approve/decline |
| `discount_codes` | breakdown, attribution, codes panel | discount-code CRUD |
| `site_settings.admin_emails / invoice_cc_emails` | `getAdminAlertEmails` (admin copies of both emails) | Admin → Settings |

---

## 3. Components

### 3.1 Invoice detail page

#### InvoiceDetailPage — `app/(admin)/admin/invoices/[id]/page.tsx`
- **Type:** Client component (`'use client'`). Rendered inside the admin layout `<main className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 py-8">`.
- **Purpose:** single-invoice view + all shipping, email and commission actions.
- **Props:** none (`useParams<{ id: string }>()`).
- **State / hooks:** `useUserRole()` (admin layout context) → `editable = canEdit(role)` and `deletable = canDelete(role)` (both `role === 'admin'`); `data {invoice, line_items, payments, amount_paid, amount_due}`; `loading`; `orderPanelVersion`; payment modal (`showPayment, payAmount, payMethod='card', payRef, paying`); `msg` (3s flash); `editingStatus, newStatus`; `tracking: InvoiceTrackingSnapshot|null`, `refreshingTracking`; `puramass, puramassLoading`; `breakdown, bookingCommission, emailingCommission`; `showEmail, emailTo, emailSending`; `deleting`; `printingLabel`; `railTabPref` persisted in `localStorage['admin.invoice.railTab']` (`shipping|emails|sales|details`, wrapped in try/catch).
- **Data access (effects, in order):**
  1. `getInvoice(id)` — **browser Supabase client** (anon + session, RLS `invoices_admin_read` = admin|assistant):
     `invoices.select('*, customers!invoices_customer_id_fkey (first_name, last_name, email, phone), sales_persons (first_name, last_name, email)').eq('id', id).single()`,
     `invoice_line_items.select('*').eq('invoice_id', id)`, `payments.select('*').eq('invoice_id', id).order('paid_at', {ascending:false})`.
     Derives `amount_paid = Σ payments.amount`, `amount_due = total − amount_paid`, customer name/email/phone from the join else the invoice's own columns.
  2. If hosted-checkout: `GET /api/admin/invoices/[id]/puramass` → `{puramass}`.
  3. On every `data` change: `GET /api/admin/invoices/[id]/breakdown` → `{breakdown}` (null on error).
  4. On mount: `GET /api/admin/invoices/[id]/tracking` (cached, no Easyship call).
  5. **Once per invoice id** (useRef guard): if `tracking.hasShipment && !tracking.tracking.checkpoints` → `GET …/tracking?refresh=1`. **For an admin this can auto-send the shipped email** (§5.2).
- **Handlers:** see §5.4.
- **Renders:** `LiveShipmentTracking`, `RailTabs`, `InvoiceEasyshipPanel`, `FulfillmentEmailCard`, `OrderConfirmationEmailCard` + `AdminPaidAlertEmailCard` (invoice without order), `PuramassInvoiceBlocks` (hosted-checkout only), `OrderManagementPanel` (invoice with order), modals.
- **Rendered by:** admin layout route.

#### InvoiceEasyshipPanel — `components/admin/InvoiceEasyshipPanel.tsx`
- **Type:** Client.
- **Purpose:** shipment status, label buy/print, create / rebook ("Change courier…") / override shipment.
- **Props:** `invoiceId, tracking: InvoiceTrackingSnapshot|null, items: {qty}[], fulfillmentType, editable, refreshing, onRefresh, onChanged, flash(msg), invoiceNumber?, customerName?, onShipmentReplaced?`.
- **State:** `readiness, readinessLoading, selectedRateId, courierPreference='best_value', handover='dropoff'|'collection'|'free_collection', insured, buyLabel, creating, buyingLabel, labelBusy, setupOpen, cancelBlocked, pickerOpen`.
- **Data access:** `POST /api/admin/invoices/shipping-readiness`, `POST …/[id]/create-shipment`, `POST …/[id]/redo-shipment` (raw fetch; 409 `cancel_failed` resolves), `POST …/[id]/buy-label`, `GET/POST …/[id]/easyship-shipment`; label print via `lib/shipping/label-print.ts`.
- **Renders:** `EasyshipShipmentPicker`. Returns `null` when `tracking` is null.

#### LiveShipmentTracking — `components/admin/LiveShipmentTracking.tsx`
- **Type:** Client. **Props:** `tracking, refreshing, onRefresh, editable`. Returns null unless `hasShipment && tracking`.
- **Purpose:** 4-stage progress bar, exception banner, facts row, map (`ShipmentMap`, `dynamic(..., {ssr:false})`, Leaflet; OSM tiles or Mapbox if `NEXT_PUBLIC_MAPBOX_TOKEN`; geocode via `POST /api/admin/geocode`), checkpoint "Journey" timeline.

#### FulfillmentEmailCard — `components/admin/FulfillmentEmailCard.tsx`
- **Type:** Client. **Props:** `invoiceId, invoiceNumber?, shippedEmailedAt?, canSend = true, onSent?`. **State:** `open`.
- **Purpose:** status of the shipped email + "Preview & send / Preview & resend" → opens `FulfillmentEmailModal`.

#### FulfillmentEmailModal — `components/FulfillmentEmailModal.tsx`
- **Type:** Client; **shared** with the warehouse queue (`app/(warehouse)/warehouse/_components/QueueDetail.tsx`) and the admin dashboard realtime banner (`app/(admin)/admin/_components/FulfillmentAlerts.tsx`).
- **Props:** `invoiceId, invoiceNumber?, onClose, onSent?({message_id, emailed_at})`.
- **State:** `loading, error, preview: NotificationPreview, to, subject, sending, carrier, trackingNumber, trackingUrl, deliveryFrom, deliveryTo, refreshing, customerEmail (on-file, for reset), sentWarning, requestId (ref)`.
- **Data access:** `GET /api/warehouse/queue/[id]/notify?preview=1[&tracking_number&carrier&tracking_url&delivery_from&delivery_to]`, `POST /api/warehouse/queue/[id]/notify`.

#### Invoice-page client lib — `lib/admin/invoices.ts`

| function | endpoint | method / body | timeout |
|---|---|---|---|
| `getInvoice` | browser Supabase | — | — |
| `updateInvoice(id,{status\|due_date\|notes})` | `/api/admin/invoices/[id]` | PATCH | 10s |
| `deleteInvoice` | `/api/admin/invoices/[id]` | DELETE | 10s |
| `recordPayment(id, amount, method, ref?)` | `…/payments` | POST `{amount, method, reference_note}` | 10s |
| `emailInvoice(id,{to?,bcc?})` | `…/email` | POST | 10s |
| `getInvoiceTracking(id,{refresh?})` | `…/tracking[?refresh=1]` | GET | 10s |
| `getInvoiceBreakdown` | `…/breakdown` | GET → `{breakdown}` | 10s |
| `bookInvoiceCommission` | `…/commission` | POST | 10s |
| `sendInvoiceCommissionEmail` | `…/commission/email` | POST → `{affiliate, admins}` | 10s |
| `getInvoicePuramass` | `…/puramass` | GET → `{puramass}` | 10s |
| `shippingReadiness` | `/api/admin/invoices/shipping-readiness` | POST `{destination:{}, invoice_id, items}` | 20s |
| `createInvoiceShipment` | `…/create-shipment` | POST `{courier_service_id, courier_preference, insured, handover, buy_label}` | 30s |
| `redoInvoiceShipment` | `…/redo-shipment` | POST `{…, replace_anyway}` | 75s |
| `buyInvoiceLabel` | `…/buy-label` | POST | 45s |
| `listInvoiceShipmentCandidates(id, days=30)` | `…/easyship-shipment?days=` | GET | 60s |
| `overrideInvoiceShipment(id, shipmentId, {allowShared})` | `…/easyship-shipment` | POST `{easyship_shipment_id, allow_shared}` | 45s |

All API calls go through `apiFetch` (`lib/api-fetch.ts`): attaches `Authorization: Bearer <supabase access_token>`, JSON content-type, 10s default timeout, throws `Error(json.error ?? 'Request failed: N')`.

`InvoiceTrackingSnapshot`:

```ts
{
  hasOrder: boolean; order_id: string|null; order_number: string|null; order_status: string|null;
  hasShipment: boolean; live: boolean;
  destination: string|null;                 // "City, State, Country" for the map
  tracking: {
    status, number, url, carrier, easyship_shipment_id, label_state, label_url: string|null;
    checkpoints?: Array<{ message: string; occurred_at: string; location?: string|null; primary_status?: string|null }>;
    refresh_error?: string;
    record?: { service, label_cost: number|null, label_currency, est_delivery_min_days: number|null,
               est_delivery_max_days: number|null, label_generated_at, synced_at, shipped_emailed_at } | null;
    auto_shipment?: { status: 'success'|'skipped'|'failed'|string; stage: string|null; error: string|null; attempted_at: string|null } | null;
  } | null;
}
```

### 3.2 Invoice API routes

Every route uses a module-level **service-role** client:
`createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`. Auth helper
`getInvoiceCaller` (`lib/admin/invoice-access.ts`): Bearer token → `db.auth.getUser(token)` →
`customers.select('id, email, role')`; `ok = role ∈ {admin, assistant}`, `callerCanWrite = role === 'admin'`.

#### `GET /api/admin/invoices/[id]/tracking`
- Auth: `ok`.
- `?refresh=1` **and role admin** → `onShipmentLabelGenerated(db, order ? {kind:'order'} : {kind:'invoice'})` (re-syncs the record **and may auto-send the shipped email**).
- Reads the invoice's shipment columns (missing-column → falls back to `id, order_id`).
- **Invoice-anchored** (no `order_id`): snapshot from the invoice; on refresh `getEasyshipTracking(id)` live and the admin persists changed `tracking_status / tracking_number / tracking_url / carrier` onto `invoices`.
- **Order-backed:** reads the order's shipment columns + `tracking_checkpoints`; `destination` = `[city, state, country]` from `orders.shipping_address`; on refresh persists to `orders`, keeping stored checkpoints when the live read has none.
- `tracking.record` = `invoices.shipping_service, shipping_label_cost, shipping_label_currency, est_delivery_min_days, est_delivery_max_days, label_generated_at, easyship_synced_at, shipped_emailed_at`.
- A live failure sets `tracking.refresh_error` instead of throwing.

#### `POST /api/admin/invoices/[id]/buy-label`
- Auth: admin. Pickup → 400 `'Pickup invoices do not need a label'`.
- Anchor = `orders` row when `order_id`, else `invoices`. Missing columns → 500 `'Invoice shipment columns are missing — run easyship-invoice-shipment-migration.sql.'`; no shipment → 400 `'No shipment yet — create one first'`; already generated → 400 `'Label already purchased'`; Easyship disabled/no key → 400 `'Easyship is disabled or missing an API key'`.
- `buyEasyshipLabel` (POST `/shipments/{id}/label`, then poll GET 6 × 1.5s) → update anchor `label_state, label_url, tracking_number, carrier`.
- If generated: `after(() => onShipmentLabelGenerated(db, anchor, {apiKey}))` → **auto shipped email**.
- 200 `{anchor:'order'|'invoice', label:{state, url, tracking_number, carrier}}`; 502 on Easyship error. Audit `invoice.buy_label`.

#### `POST /api/admin/invoices/[id]/create-shipment`
- Auth: admin. Body (optional) `{courier_service_id, courier_preference, insured, handover, buy_label}`. Pickup → 400 `'Pickup invoices are not shipped'`.
- `autoCreateShipmentForInvoice(db, id, force=true, …)` (§5.3). 200 `{anchor, shipment:{id, easyship_shipment_id, label_state, label_url, tracking_number, carrier, auto_shipment_status, auto_shipment_error}}`. Audit `invoice.create_shipment`.

#### `POST /api/admin/invoices/[id]/redo-shipment`
- Auth: admin. Body `{courier_service_id?, courier_preference?, insured?, handover?, buy_label?, replace_anyway?}`. No shipment → 400 `'No shipment to redo — create one instead'`.
- `cancelEasyshipShipment`; if it fails and the label was generated/pending and `!replace_anyway` → **409** `{error:'The current label could not be cancelled, so it would not be refunded. …', cancel_failed:true}`.
- `clearShipmentRecord` (anchor fatal, mirrors best-effort) → `autoCreateShipmentForInvoice(force=true)`.
- 200 `{anchor, previous_shipment_id, previous_cancelled, previous_cancel_error, shipment, shipped_email_was_sent: !!invoices.shipped_emailed_at}`. Audit `invoice.redo_shipment` / `invoice.redo_shipment_uncancelled`.
- Does **not** reset `shipped_emailed_at` / `shipped_email_auto_claimed_at` → the new label never auto-emails; UI tells the admin to resend (§7).

#### `GET|POST /api/admin/invoices/[id]/easyship-shipment` (override / link)
- Auth: admin.
- GET `?days=30` (clamped 1..180): `listEasyshipShipments(since)` (≤10 pages × 100) + owners (`orders`/`invoices` by `easyship_shipment_id`, chunks of 200) → `{anchor, current_shipment_id, since, lookbackDays, fetched, easyshipError, shipments, linked:{shipmentId → {kind, id, label}}}`.
- POST `{easyship_shipment_id, allow_shared?}`: `getEasyshipShipmentDetails` (502 on error); owned elsewhere and `!allow_shared` → 409 `{error:'That shipment is already attached to order|invoice X.', owner}`; `clearShipmentRecord` → set anchor `easyship_shipment_id` → **awaited** `onShipmentLabelGenerated(db, anchor, {apiKey, details})` (may send email) → `{ok, anchor, previous_shipment_id, easyship_shipment_id, label_state, email}`. Audit `invoice.easyship_override`.

#### `GET /api/admin/invoices/[id]/label`
- Auth: admin | assistant | warehouse, and `customers.active !== false`.
- Resolve anchor → `label_url` (404 `'No label available'`) → `fetchEasyshipDocument(url, apiKey)` (auth header, retry plain on 401) → binary, `Content-Disposition: inline; filename="label-{invoice_number}.{pdf|png|jpg}"`, `Cache-Control: no-store`.

#### `POST /api/admin/invoices/[id]/commission` ("Book commission")
- Auth: admin. `creditHostedSale(db, id)` → inserts a `commissions` row. **Sends no email.**
- Errors `{error, reason}`:

  | reason | message | status |
  |---|---|---|
  | `not-hosted` | `Only Stealth Health sales earn affiliate commission.` | 422 |
  | `not-paid` | `The invoice is not paid.` | 422 |
  | `no-attribution` | `No active affiliate is behind this sale’s codes.` | 422 |
  | `no-base` | `Stealth Health reported no subtotal for this sale.` | 422 |
  | `already-recorded` | `A commission is already recorded for this invoice.` | 409 |
  | `error` | `Could not record the commission.` | 500 |

- 200 `{commissionId, amount}`. Audit `commission.backfilled`.

#### `POST /api/admin/invoices/[id]/commission/email` ("Email affiliate & admins")
- Auth: admin. `sendCommissionEmailManually(db, invoiceId, {id: actor_id, email: actor_email})` (§5.6).
- Errors `{error, reason}`: `no_commission` → 422 `No commission is recorded for this invoice.`; `cancelled` → 422 `The commission is cancelled.`; `no_affiliate` → 422 `The affiliate on this commission no longer exists.`; `error` → 500 `Could not send the commission email.`
- 200 `{affiliate: 'sent'|'send_failed'|'no_email', admins: 'sent'|'send_failed'|'no_recipients'}`. Audit `commission.email_sent` (entity invoice). **No dedupe — can be resent any number of times.**

#### `GET|POST /api/warehouse/queue/[id]/notify` (the shipped-email endpoint)
- Auth `verifyWarehouse` (`lib/warehouse/server.ts`): Bearer → `customers.select('role, email, can_send_fulfillment_emails, active')`; `authorized = active && role ∈ {warehouse, admin}`; `canSendEmails = admin || (warehouse && can_send_fulfillment_emails)`. Fail → 403 `'Unauthorized'` / `'Forbidden (no email permission)'`. (Assistants cannot preview or send — §7.)
- GET `?preview=1[&tracking_number&carrier&tracking_url&delivery_from&delivery_to]` → `buildNotificationPreview` → `{subject, body (text), html, to, defaults:{subject}, trackingNumber, stored:{number, carrier, url}, adminRecipients}`. 404 `'invoice not found'`.
- POST `{subject?, to?, tracking_number?, carrier?, tracking_url?, delivery_from?, delivery_to?}` → `sendFulfillmentEmail` → `{ok, message_id, emailed_at, error?, admin_copy?:{sent, to[], error?}}`. 400 for `'no recipient'` / `'invalid recipient: …'`; other failures 500.
- `parseShipmentDetails`: trims; `tracking_number` ≤100, `carrier` ≤100, `tracking_url` ≤1000 and must be `^https?://`, dates must match `^\d{4}-\d{2}-\d{2}$` (else dropped).

#### `POST /api/webhooks/easyship`
- `EASYSHIP_WEBHOOK_SECRET` required, else **503** `'webhook not configured'`. Accepts any of: `x-easyship-signature` (JWT HS256, `exp` checked), `x-easyship-hmac-sha256` (HMAC-SHA256 of raw body, base64 or hex), `x-easyship-webhook-secret` (constant-time compare). Else 401 `'bad signature'`.
- Handled events: `shipment.label.created`, `shipment.label.failed`, `shipment.tracking.status.changed`, `shipment.tracking.checkpoints.created`, `shipment.cancelled`. Others → 200 `{ignored: eventType}`.
- Match order by `easyship_shipment_id` → `order_number` → `tracking_number`. No order but a shipment id → match `invoices.easyship_shipment_id`; nothing → 200 `{matched:false}`.
- Invoice match: update `tracking_number, tracking_status, tracking_url, carrier, label_url, label_state`; checkpoints → `invoices.tracking_checkpoints`; if `labelState === 'generated' && invoice.label_state !== 'generated'` → `after(onShipmentLabelGenerated({kind:'invoice'}))` → **auto shipped email**.
- Order match: update the order's tracking/label columns; advance status forward (`delivered` / `shipped` with `shipped_at`/`delivered_at`); checkpoints → `orders.tracking_checkpoints`; first time generated → `after(onShipmentLabelGenerated({kind:'order'}))` → mirrors onto invoices and **auto-sends**.
- Webhook URL is hard-coded: `EASYSHIP_WEBHOOK_URL = 'https://www.vytabio.com/api/webhooks/easyship'` (`lib/shipping/easyship-webhook.ts`). **Change for aminocan-cad.**

Other invoice routes used by the page (unchanged behaviour, see `invoicing-ar-cluster.spec.md`): `PATCH|DELETE /api/admin/invoices/[id]`, `POST …/payments`, `POST …/email` (invoice PDF email, logs to `invoice_email_log`), `GET …/pdf` (returns HTML), `GET …/breakdown`, `GET …/puramass`.

### 3.3 Affiliates pages

#### AdminAffiliates — `app/(admin)/admin/affiliates/page.tsx`
- **Type:** Client.
- **Purpose:** affiliate directory with segments, sort, lead filter, search, row actions.
- **State / hooks:** `useUserRole()`, `useRouter()`, `useToast()`; `editable = canEdit(role)`, `deletable = canDelete(role)`; `rows, counts {all, active, inactive, claimed, unclaimed}, leadsAvailable, loading, refreshing, error, search, segment ('all'|'active'|'inactive'), sort ('newest'|'oldest'|'earnings'|'customers'|'name'), leadFilter ('any'|'mine'|'unclaimed'|'hot'|'warm'|'cold'), meId, toggling, linking, downloading, showCreate, editAffiliate, deleteTarget, tip {x,y}`.
- **Data access:** `GET /api/admin/affiliates/directory` (`cache:'no-store'`); `supabase.auth.getUser()` for `meId`. All filtering/sorting client-side in `useMemo` (search: full name, email, referral_code, lowercase includes; sort earnings = `total_earnings` desc, customers = `bound_customers` desc, name = `localeCompare`).
- **Actions:** toggle active (PUT `{active}`), reset link (`POST /api/admin/affiliates/[id]/magic-link {redirectPath:'/reset-password', purpose:'reset'}`), report (`GET /api/admin/affiliates/report?status&q` → blob → new tab).
- **Renders:** `PendingAffiliateRequests`, `PendingReferralCodeRequests`, `CreateAffiliateModal`, `EditAffiliateModal`, `DeleteAffiliateDialog`.

#### AffiliateProfilePage — `app/(admin)/admin/affiliates/[id]/page.tsx`
- **Type:** Client.
- **Purpose:** "Partner 360": identity, actions, stats, CRM lead, payout/account details, codes & payouts, product mix, pages/journey, earnings by month, referral link, referred customers, commissions, email history.
- **State:** `data, loading, notFound, meId, meName, busy ('claim'|'lead'|'email'|'active'|'magic'|'reset'|'copy'|'code'), composing, editing, codeRequests, editingCode, decliningCode, notifyOnCodeApprove (true)`; `runAction(key, fn)` wraps busy + `toast.error`.
- **Data access:** `GET /api/admin/affiliates/[id]/insights` (404 → notFound); `getReferralCodeRequests({affiliateId: id, status:'all', limit:20})`; browser `supabase.auth.getUser()` + `customers.select('first_name,last_name')` for the composer sender name.
- **Derived:** `activeCode = codes.find(active) ?? codes[0]`; `referralLink = ${window.location.origin}?ref=${code}`; conversion % = `convertedCustomers / boundCustomers`.
- **Renders:** `LeadPanel` (`app/(admin)/admin/_components/LeadPanel.tsx`), `AffiliateCodesPayouts`, `EmailComposer`, `EditAffiliateModal`, `EditReferralCodeModal`, `DeclineReferralCodeDialog`.

#### AffiliateCodesPayouts — `components/admin/affiliates/AffiliateCodesPayouts.tsx`
- **Type:** Client. **Props:** `affiliateId, affiliateName, editable`.
- **Data access:** parallel `GET /api/admin/discount-codes?affiliate_id=` and `GET /api/admin/affiliates/[id]/payouts` via `adminFetch` (`components/admin/affiliates/api.ts`; returns `{ok, status, data}`, never throws).
- **Renders:** balance tiles, Discount codes table + `DiscountCodeModal`, Payments table + `RecordPayoutModal`.

#### Modals / sub-components — `app/(admin)/admin/affiliates/_components/*`
| Component | Props | Calls |
|---|---|---|
| `CreateAffiliateModal` | `{onClose, onCreated}` | `GET /api/affiliate/referral-code/check?code=&affiliate_id=none`; `POST /api/admin/affiliates`; then `POST …/[id]/magic-link {purpose:'welcome', redirectPath:'/reset-password'}` |
| `EditAffiliateModal` | `{affiliate {id, first_name, last_name, email, wallet_address, active}, onClose, onSaved}` | `PUT /api/admin/affiliates/[id]` |
| `DeleteAffiliateDialog` | `{affiliate {id, first_name, last_name, email}, onClose, onDone}` | PUT `{active:false}` or `DELETE /api/admin/affiliates/[id]` |
| `PendingAffiliateRequests` | `{canReview, onApproved?}` | `GET /api/admin/affiliate-requests?status=pending`; `PATCH …/[id] {action:'approve'|'deny'}` |
| `PendingReferralCodeRequests` | `{canReview, onDecided?}` | `GET /api/admin/referral-code-requests?status=pending`; `POST …/[id] {action, notes?, notify?}` |
| `DeclineReferralCodeDialog` | `{affiliateName, code, busy?, onClose, onConfirm(notes)}` | — |
| `EditReferralCodeModal` | `{affiliateId, affiliateName, currentCode, onClose, onSaved({code, notified, notifyError})}` | `GET/PUT /api/admin/affiliates/[id]/referral-code` |
| `components/affiliate/ReferralCodeField` | `{value, onChange(normalized), onAvailabilityChange?, suggestion?, check?, label='Referral code', disabled?, autoFocus?}` | debounced 400ms check, ticketed to drop stale replies |

#### AdminCommissions — `app/(admin)/admin/commissions/page.tsx`
- **Type:** Client. **Data:** `apiFetch('/api/admin/commissions', {timeoutMs: 30000})` → `{recipients, commissions}` (affiliate `commissions` + `sales_commissions`, via `loadCommissionLedger`).
- **State:** `statusView ('pending' default|'paid'|'all'), sourceFilter ('all'|'affiliate'|'sales'), search, expanded: Set, paying, printing, backfilling`.
- **Actions:** `POST /api/admin/commissions {source, ids}` (Mark paid), `GET /api/admin/commissions/report?...` (printable HTML), `POST /api/admin/commissions/backfill` ("Find missed commissions", 60s, **no emails**).

### 3.4 Affiliate API routes

Auth patterns: inline `verifyAdmin` (role admin), `verifyStaff` (admin|assistant), `resolveStaffCaller(db, req, {allowAssistant})` (`lib/affiliate/route-auth.ts`; 401/403), `verifyCrmActor` (`lib/admin/crm-actions.ts`), `resolveAffiliateCaller` (affiliate by `id = user.id`, fallback `email`; 403 `'No affiliate profile for this account.'`).

| Route | Auth | Request | Response / effect |
|---|---|---|---|
| `POST /api/admin/affiliates` | admin | `{first_name*, last_name*, email*, wallet_address?, active?, password?, referral_code?}` | Creates **4 rows sharing one UUID**: auth user (`email_confirm:true`, random password if none), `affiliates` (rate = DB default 0.10), `referral_codes` via `assignReferralCode` (or `proposeReferralCode`), `customers` upsert `{role:'affiliate', affiliate_id: uid, email_verified:true}`, `sales_persons {user_id: uid}`. 400 `'Missing required fields'`; code format 400; taken 409. → `{success:true, affiliate_id, referral_code}` |
| `PUT /api/admin/affiliates/[id]` | admin | `{first_name?, last_name?, email?, wallet_address?, active?, password?}` | `active` → `auth.admin.updateUserById(id, {ban_duration: active ? 'none' : '876600h'})`; updates `affiliates` + `customers`. Does **not** accept `commission_rate`. |
| `DELETE /api/admin/affiliates/[id]` | admin | — | deletes `commissions` → `referral_codes` → `sales_persons` → `affiliates` → `customers` → auth user |
| `GET /api/admin/affiliates/directory` | staff | — | `{affiliates: AffiliateDirectoryRow[], counts:{all, active, inactive, claimed, unclaimed}, leadsAvailable}`; row = `id, first_name, last_name, email, wallet_address, active, created_at, commission_rate, referral_code, referral_uses (Σ all codes), code_count, total_earnings, pending_earnings, paid_earnings, commission_count, bound_customers, customer_revenue, last_commission_at, lead` |
| `GET /api/admin/affiliates/report` | staff | `?status=active\|inactive&q=` | text/html "Affiliate Report" (cols Affiliate / Referral Code / Referrals / Total Earned / Pending / Status) |
| `GET /api/admin/affiliates/[id]/insights` | staff | — | `{affiliate, account, lead, emails, capabilities{claims, emailLog, activity}, codes[], commissions[≤200], customers[], products[], pages[], journey[≤60], earningsByMonth[{month:'YYYY-MM', earned, count}], stats{totalEarnings, pendingEarnings, paidEarnings, commissionCount, referralUses, activeCodes, boundCustomers, convertedCustomers, customerRevenue, lastCommissionAt}}` |
| `GET /api/admin/affiliates/[id]/payouts` | staff | — | `{migrationNeeded, summary: AffiliateBalance, payouts[], commissions[non-cancelled + reference + discount_code]}` |
| `POST /api/admin/affiliates/[id]/payouts` | admin | `{amount, method, reference?, notes?, paid_at?, commission_ids?}` | amount ≤0 → 400 `'Enter the amount that was paid.'`; invalid date → 400 `'Invalid payment date.'`; table missing → 503 `'Payouts are not set up yet — run affiliate-discount-codes-payouts-migration.sql.'`; insert payout, then selected **pending** commissions → `{status:'paid', paid_at, payout_id}`. 201 `{payout, settled}`. **No email.** |
| `DELETE /api/admin/affiliates/[id]/payouts/[payoutId]` | admin | — | revert commissions → `{status:'pending', paid_at:null, payout_id:null}`; delete payout. `{voided:true}` |
| `GET\|PUT /api/admin/affiliates/[id]/referral-code` | staff / admin | PUT `{code, notify? = true, notes?}` | `assignReferralCode` (rename in place); history row in `referral_code_requests {status:'approved', source:'admin'}`; optional email subject `Your VYTA referral code is now ${code}` |
| `POST /api/admin/affiliates/[id]/magic-link` | admin | `{redirectPath?, purpose?: 'welcome'\|'reset'}` | reset → Supabase reset email; welcome → `generateLink({type:'recovery'})` + branded mail, or returns `action_link` when SMTP unset (UI copies to clipboard) |
| `PATCH …/[id]/lead`, `POST\|DELETE …/[id]/claim`, `POST …/[id]/email` | staff (CRM) | — | shared CRM desk (`customer_leads`, `customer_emails`) |
| `GET /api/admin/affiliate-requests` / `PATCH …/[id]` | staff / admin | `{action:'approve'\|'deny', referral_code?}` | approve provisions the same 4 rows; emails `Your VYTA Affiliate Application is Approved!` / `VYTA Affiliate Application Update` |
| `GET\|POST /api/admin/commissions` | staff / admin | POST `{source:'affiliate'\|'sales', ids}` | ledger / mark pending → paid (no payout_id) |
| `POST /api/admin/commissions/backfill` | admin | — | `BackfillSummary {checked, recorded, amount, unattributed, failed}`. **No emails.** |
| `GET /api/affiliate/commissions` | affiliate | — | `{rows: AffiliateCommissionRow[], paid, pending, total, commissionCount, referrals, referredSales, codeUses, commissionRate}` — the dashboard the commission email links to |

---

## 4. UI/UX design overview

### Design tokens

**Tailwind theme (`tailwind.config.ts`):**

| Token | Hex | Use |
|---|---|---|
| `ink` | #07203A | primary text, primary button bg |
| `ink-muted` | #56707F | secondary text |
| `ink-light` | #6E8898 | tertiary text |
| `teal` | #438B9E | focus rings (`ring-teal/40`), bars, `accent-teal` checkboxes |
| `teal-dark` | #1B5D83 | icons, links, "Send Email" button |
| `teal-light` | #6EB2B8 | |
| `teal-50…900` | #F1F8F9 #E1EFF1 #C4DFE3 #9CCBD1 #6EB2B8 #438B9E #1B5D83 #0E3F5F #07203A #05182B | |
| `surface` | #F7FAFB | input bg, hover bg, table head |
| `surface-2` | #EDF3F5 | |
| `line` | #DCE7EB | all borders/dividers |

Radius overrides: `rounded-lg` 0.5rem (stock), **`rounded-xl` 0.875rem (14px)**, **`rounded-2xl` 1.125rem (18px)**, `rounded-3xl` 1.5rem. Shadows: page uses stock `shadow-sm` / `shadow-lg` / `shadow-xl`; theme `shadow-card` = `0 1px 2px rgba(7,32,58,.04), 0 8px 24px -12px rgba(7,32,58,.10)` (not used here). Font: Inter (`var(--font-inter)`).

**Stock Tailwind 3 colours in use:** gray 200 #E5E7EB, 300 #D1D5DB, 400 #9CA3AF, 500 #6B7280, 600 #4B5563 · slate 100 #F1F5F9, 600 #475569 · blue 200 #BFDBFE, 500 #3B82F6, 600 #2563EB · emerald 50 #ECFDF5, 100 #D1FAE5, 200 #A7F3D0, 500 #10B981, 600 #059669, 700 #047857, 800 #065F46 · amber 50 #FFFBEB, 100 #FEF3C7, 200 #FDE68A, 300 #FCD34D, 500 #F59E0B, 600 #D97706, 700 #B45309, 800 #92400E, 950 #451A03 · red 50 #FEF2F2, 100 #FEE2E2, 200 #FECACA, 300 #FCA5A5, 500 #EF4444, 600 #DC2626, 700 #B91C1C, 800 #991B1B · purple 500 #A855F7, 600 #9333EA, 700 #7E22CE, 800 #6B21A8 · indigo 400 #818CF8, 500 #6366F1, 600 #4F46E5. `/10` etc. = that colour at that alpha.

**Recurring patterns:**
- Card: `bg-white rounded-xl border border-line` (+ `p-5` or `overflow-hidden`).
- Modal overlay: `fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4`; panel `bg-white rounded-xl w-full max-w-md p-6 shadow-xl`.
- Input: `w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal/40`.
- Primary button: `bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/90 disabled:opacity-50`.
- Secondary button: `rounded-lg border border-line bg-white text-sm text-ink hover:bg-surface`.
- Field label: `block text-xs font-medium text-ink-muted mb-1`.
- Section eyebrow: `text-[10px] font-semibold uppercase tracking-wider text-ink-muted`.

### 4.1 Invoice detail page

**Header** — `flex flex-wrap items-center justify-between gap-3 mb-6`
- Left: back link (`ArrowLeft w-5 h-5`, `text-ink-muted hover:text-ink`) → `/admin/invoices`; `h1` invoice number `text-xl font-bold font-mono text-ink`; currency chip `inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-teal/10 text-teal-dark border border-teal/20`; source badge (`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide`; hosted: `bg-teal/10 text-teal-dark` + Store "Stealth Health"; manual: `bg-slate-100 text-slate-600` + PenLine "Manual"); subline `text-xs text-ink-muted` `Created {date}` [+ ` · Payment collected by Stealth Health`].
- Right (`flex flex-wrap items-center gap-2`):
  - Invoice PDF split button — wrapper `inline-flex rounded-lg border border-line bg-white divide-x divide-line overflow-hidden`; left `px-3 py-2 text-sm text-ink-muted hover:text-ink hover:bg-surface flex items-center gap-2` (Eye, "Invoice PDF"); right `px-2.5 py-2` (Download, title "Open print dialog — choose 'Save as PDF' to download").
  - **Print label** (only `labelReady`) — `px-3 py-2 bg-white border border-teal/40 rounded-lg text-sm font-medium text-teal-dark hover:bg-teal/5 flex items-center gap-2 disabled:opacity-50`, Printer (Loader2 while busy).
  - Edit (admin) — Link `px-3 py-2 bg-white border border-line rounded-lg text-sm text-ink-muted hover:text-ink`, Pencil.
  - Send Email (admin) — `px-3 py-2 bg-teal-dark text-white rounded-lg text-sm font-medium hover:bg-teal/90`, Send.
  - Record Payment (admin, not paid) — `px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700`, DollarSign.

**Flash strip** — `mb-4 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700` (used for success *and* error text; 3s).

**Summary strip** — `mb-6 grid grid-cols-2 lg:grid-cols-4 gap-px bg-line rounded-xl overflow-hidden border border-line`; cells `bg-white p-4`; cell header = section eyebrow.
1. **Status** — badge `inline-flex px-2 py-0.5 rounded text-xs font-medium border {statusColors}`; admin pencil opens inline `<select>` (draft/sent/paid/partial/overdue/cancelled, `flex-1 px-2 py-1 bg-surface border border-line rounded text-xs`) + ✓ (`px-2 bg-ink text-white rounded text-xs`) + ✕ (`px-2 border border-line rounded`); hints `text-[10px] text-amber-600` "Marking paid will decrement stock." / `text-emerald-600` "Cancelling will restore stock." (when `stock_adjusted`).
2. **Amount Due / Paid in full** — paid: `text-emerald-600` Check + amount `text-lg font-bold`; unpaid: `text-lg font-bold text-teal-dark tabular-nums`, `of {total} · {paid} paid` (`text-[11px] text-ink-muted`), text button "Record Payment" `text-xs font-medium text-emerald-700 hover:text-emerald-800`.
3. **Customer** — name `text-sm font-medium text-ink truncate`; email/phone `text-[11px] text-ink-muted`; hosted: "Captured by Stealth Health" `text-[10px] uppercase tracking-wider text-teal-dark`; empty "Guest / offline".
4. **Shipping** — pickup chip `bg-amber-100 text-amber-800` (Store, "Pickup"); none: "Not shipped yet" (has order) / "No shipment yet"; with shipment: `tracking.status` (`text-sm font-medium`), number (`text-[11px] font-mono`), `Track shipment →` (`text-[11px] text-teal-dark`, `target=_blank`, href `tracking.url`).

**Status badge colours (`statusColors`):**

| status | classes |
|---|---|
| draft | `bg-gray-500/10 text-gray-600 border-gray-300` |
| sent | `bg-blue-500/10 text-blue-600 border-blue-200` |
| paid | `bg-emerald-500/10 text-emerald-600 border-emerald-200` |
| partial | `bg-amber-500/10 text-amber-600 border-amber-200` |
| overdue | `bg-red-500/10 text-red-600 border-red-200` |
| cancelled | `bg-gray-500/10 text-gray-500 border-gray-200 line-through` |
| pending_payment | `bg-amber-500/10 text-amber-700 border-amber-200` |
| expired | `bg-gray-200 text-gray-600 border-gray-300` |

**LiveShipmentTracking card** (only with a shipment) — `mb-6 bg-white rounded-xl border border-line overflow-hidden`.
- Header: Radio icon (`text-emerald-500` when delivered, else `text-teal-dark`), "Live Shipment Tracking" · `{carrier}`; map toggle (on `bg-teal/10 border-teal text-teal-dark`, off `bg-surface border-line text-ink-muted`); "Refresh live" / "Refreshing…" (admin).
- Stage bar: status normalised (lowercase, strip `_`, spaces, `-`): contains `delivered` → 3, `outfordelivery` → 2, `transit` → 1, else 0. Stages `Info Received` (PackageCheck) · `In Transit` (Truck) · `Out for Delivery` (Navigation) · `Delivered` (Home). Circles `w-9 h-9 rounded-full`: done `bg-ink text-white` (final delivered `bg-emerald-500`), todo `bg-surface text-ink-muted`, current `ring-4 ring-teal/20`; connectors `h-0.5` `bg-ink`/`bg-surface`; labels `text-[10px] uppercase tracking-wider` (`text-teal-dark` when done).
- Exception: status matching `/(exception|fail|return|expired|lost|damage|held|customs|cancel)/` replaces the bar with `bg-red-50 border-red-200 text-red-700` "This shipment reports an exception ({status}). Check the checkpoints below or the carrier page for details."
- Current status = `t.status ?? newest checkpoint.primary_status`. Facts row: Status · Tracking (mono, ExternalLink when url) · Order status.
- Map: Leaflet, loading box `h-72`.
- Journey (newest first): dot latest `bg-teal ring-4 ring-teal/15`, others `bg-line`; message (or `primary_status`, or "Update"), MapPin location, `toLocaleString` time. Empty: admin `No checkpoints loaded yet. Click "Refresh live" to pull the latest journey from Easyship.` / else `No live checkpoints available.` Refresh error `Live refresh: …` `text-amber-600`.

**Main grid** — `grid lg:grid-cols-3 gap-6 items-start`.
- **Left** (`lg:col-span-2 space-y-6 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto`):
  - Line Items card — header `flex items-center gap-2 p-5 border-b border-line` (FileText, `h2 font-semibold text-ink text-sm`); table `w-full text-sm`, thead row `border-b border-line bg-surface`, th `px-4 py-2.5 text-xs text-ink-muted font-semibold uppercase`; cols Description · Qty (center) · Unit Price (right) · Disc. (center) · Total (right); tbody `divide-y divide-line/50`, td `px-4 py-3`. Price-type chip `ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide align-middle` (vial `bg-teal/10 text-teal-dark` Beaker; box `bg-slate-100 text-slate-600` Package). List price struck above unit price (`text-[11px] text-ink-light line-through`) when the breakdown has one. Disc. = `discount_pct%` → breakdown line % → `lineDiscountFallback` → `—`.
  - Totals footer `p-5 border-t border-line space-y-2`: Subtotal (or "Subtotal at list price" + Discount `(label)` `text-emerald-600` "– "), Tax, Shipping (shipment only), Processing Fee (pickup, `show_processing_fee !== false && processing_fee > 0`), **Total** `font-bold text-base pt-2 border-t`, optional "Affiliate cut (name · rate% of base)" `text-purple-700`, Paid `– amount` emerald-600, **Amount Due** `font-bold text-teal-dark`.
  - Payment History (if payments) — rows `px-5 py-4`: method (capitalize, `-`→space), reference, `paid_at` locale, amount `font-bold tabular-nums text-emerald-600`.
- **Right rail** (`space-y-4`):
  - Notes (if any) — `rounded-xl border border-amber-200 bg-amber-50/70 p-4`; header `text-[11px] font-semibold uppercase tracking-wider text-amber-800` StickyNote; body `text-sm text-amber-950/80 whitespace-pre-wrap`.
  - **RailTabs** — `role=tablist`, `grid gap-1 rounded-xl border border-line bg-surface p-1 lg:sticky lg:top-6 z-10`, inline `gridTemplateColumns: repeat(n, minmax(0,1fr))`. Tab `relative inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-teal/40`; active `bg-white text-ink shadow-sm`, inactive `text-ink-muted hover:text-ink`. ←/→ keys move focus to `#rail-tab-${key}`. Panels `role=tabpanel id=rail-panel-${key}` stay **mounted** (`hidden` attr). Tabs: **Shipping** (Truck; "Pickup" + Store for pickups) always · **Emails** (Mail) when `showShippedEmail || !order_id` · **Sales** (Handshake) when `showDiscountCard || sales_person_name` · **Details** (ClipboardList) always. Unknown remembered tab → `shipping`.
  - **Attention dots** — `absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500` with `title`:
    - Shipping: `isShipment && status==='paid' && tracking && labelState!=='generated'` → `Paid — label not bought yet` (shipment exists) / `Paid — no shipment yet`.
    - Emails: `showShippedEmail && labelState==='generated' && !invoice.shipped_emailed_at` → `Label is ready — the shipped email hasn’t been sent`.

**Shipping tab → InvoiceEasyshipPanel** (`bg-white rounded-xl border border-line p-5`)
- Header "Shipping"/"Pickup" (Truck); admin with shipment: link-button "Check for live updates" (RefreshCw) → `onRefresh`.
- Label box `mb-3 rounded-lg border border-line bg-surface p-3`: chip `inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium` (Tag):

  | label_state | text | classes |
  |---|---|---|
  | generated | Label ready | `bg-emerald-500/10 text-emerald-700 border-emerald-200` |
  | failed | Label failed | `bg-red-500/10 text-red-700 border-red-200` |
  | cancelled | Label cancelled | `bg-red-500/10 text-red-700 border-red-200` |
  | pending | Label pending | `bg-amber-500/10 text-amber-700 border-amber-200` |
  | other | No label yet | `bg-gray-500/10 text-ink-muted border-line` |

  Carrier on the right. With `label_url`: "Print label" `w-full … rounded-md bg-teal-dark px-2.5 py-1.5 text-xs font-medium text-white hover:bg-teal-dark/90`. Else text: pending "Easyship is still generating the label PDF — refresh in a moment." / "The shipment is a draft. Buying the label charges the Easyship wallet." + (not pending) **"Buy & print label"** `rounded-md border border-teal px-2.5 py-1.5 text-xs text-teal-dark hover:bg-teal/5` → flash "Label bought — opening the print dialog" (then prints) / "Label bought — Easyship is still generating the PDF".
- Auto-shipment box `mb-2 px-2.5 py-1.5 rounded-lg border text-[11px]`: success `bg-emerald-50 border-emerald-200 text-emerald-800` "Shipment created"; failed `bg-red-50 border-red-200 text-red-800` "Shipment failed"; else amber "Shipment skipped" / `Shipment: {status}`; + `stage: …`, error, `at …`.
- Detail rows (`space-y-2 text-sm`, `flex justify-between`): Order (mono) · Order Status · Tracking Status · Tracking # (`font-mono text-xs truncate max-w-[10rem]`) · Service · Label cost `$x.xx CUR` · Est. transit `{min}–{max} business days` · Label generated · **Shipped email** (when generated + record): `Sent {date}` `text-emerald-700` / `Not sent yet` `text-amber-600` · "Track shipment →" · refresh error amber-600.
- Create / redo form: "Create Easyship shipment" `w-full … rounded-lg border border-teal px-3 py-2 text-sm text-teal-dark hover:bg-teal/5`. Setup heading "New shipment" / "Redo with a new courier" + "Check rates". Redo warning (amber): "The current {carrier} label (${cost} CUR) is cancelled in Easyship and refunded to the wallet — only possible before the parcel is in transit." (or "The current draft shipment is cancelled…") + "The customer already has the old tracking number — resend the shipped email afterwards." when `record.shipped_emailed_at`. Readiness checklist (Check emerald-600 / X red-500): `easyship_enabled, easyship_api_key, origin, destination, items, parcel`. "Shipping to {City, State, Postal, Country} — {source}" (`from the linked order` / `reported by Stealth Health on the hosted checkout` / `from the drop-ship client` / `from the customer profile`). Courier select: `pref:best_value` "Best value — cheapest UPS / Canada Post within 2 days", `pref:ups` "UPS — best-value UPS service", `pref:canada_post` "Canada Post — best-value Canada Post service", optgroup "Quoted services" `rate:<courier_id>` "{courier} · {service} — ${total}". Handover toggles Drop off / Collection / Free pickup (active `bg-ink text-white border-ink`, inactive `bg-surface text-ink-muted border-line`). Checkboxes "Insure this shipment", "Buy & print label now" + "Charges Easyship wallet" (amber-600). `cancelBlocked` red box + "Replace anyway — old label not refunded" (confirm `Book the new shipment anyway? The old label stays charged until it is cancelled in Easyship.`). Primary `flex-1 … rounded-lg bg-ink px-3 py-2 text-sm text-white` "Create shipment" / "Cancel old & rebook" + Cancel.
- Footer (admin, not pickup, setup closed): "Change courier…" (Repeat; with shipment) · "Override shipment…" / "Link existing Easyship shipment…" (Link2).
- Flash copy: "Shipment created" / "Shipment created and label bought" / `Shipment not created: {err}` / "Shipment could not be created — check Easyship settings and the shipping address." / `Rebooked with {carrier}` [+ " · old label NOT refunded — cancel it in Easyship"] [+ " · the customer has the old tracking — resend the shipped email"] / "Old shipment cancelled, but the new one failed: …" / `Shipment replaced with {id}` or `Shipment {id} linked` [+ " — shipped email sent to the customer"].
- EasyshipShipmentPicker modal: overlay `fixed inset-0 z-50 … bg-black/40 p-4`, panel `max-h-[90vh] w-full max-w-4xl rounded-2xl bg-white shadow-2xl`; title "Override Easyship shipment" / "Link an Easyship shipment"; lookback 7/30/90/180 days; search; "Only “{customer}” (n)" filter; chips "Matches customer" (teal), "Current" (emerald), "On order X" / "On invoice X" (amber); confirm checkbox when shared; footer "Replaces {id} — its tracking, label and cost are cleared and the picked shipment’s record is pulled from Easyship. Nothing is cancelled in Easyship."; buttons "Re-sync this shipment" / "Use this shipment" / "Link this shipment".

**Emails tab**
- **FulfillmentEmailCard** (when `showShippedEmail`) — `bg-white rounded-xl border border-line p-5`, Truck, title "Order shipped email"; copy `text-[11px] text-ink-muted` "Sent by hand once the order is packed and shipped. Add the carrier, tracking number and estimated delivery in the preview; you can change who it goes to, and the admin team gets a copy." *(copy is stale — it is also auto-sent; reword in the port)*; status `text-xs text-emerald-700` ✓ `Sent {Mon D, h:mm}` / `text-xs text-amber-700` "Not sent"; button (canSend) `mt-3 w-full px-3 py-2 bg-teal/10 border border-teal/20 text-teal-dark rounded-lg text-sm hover:bg-teal/20 flex items-center justify-center gap-2` "Preview & send" (Mail) / "Preview & resend" (RotateCw).
- Invoice without order: `OrderConfirmationEmailCard target={{invoiceId}}` + `AdminPaidAlertEmailCard` (same button style; status box `bg-emerald-50 border-emerald-200 text-emerald-800` "Sent N times · Last … to … · by X / automatically on payment" or amber; "Show send history (n)" → `✓/✗ date · to · sender|automatic` from `fulfillment_email_log`). Invoice with order: `text-[11px] text-ink-muted` "The order confirmation and status emails live in the order panel below."

**FulfillmentEmailModal**
- Overlay `fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4` (click outside closes). Panel `bg-white rounded-2xl border border-line shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col`.
- Header `px-5 py-4 border-b`: Mail in `rounded-lg bg-indigo-500/10 p-1.5 text-indigo-600`, "Order shipped email", invoice number mono.
- Body `px-5 py-4 space-y-3 overflow-y-auto`:
  - Error `bg-red-50 border-red-200 text-red-700`.
  - Amber when no number: "No tracking number yet — add one below, or the email goes out without tracking and without the Track Your Order button."
  - **Send to** (inputMode email) + "Use customer's email" reset when redirected; hint "For this email only — the invoice and customer account aren't changed (on file: x). Separate several addresses with commas."; invalid → red `Not a valid email: …`.
  - Admin recipients box `bg-surface border border-line text-xs` (Users): "A copy also goes to the admin team: a, b" / "No admin alert emails are set in Admin → Settings, so no admin copy will be sent."
  - **Subject** + "Reset to default".
  - `<fieldset className="rounded-xl border border-line p-3 space-y-3">` legend "Shipment details" (Truck): **Carrier** (datalist `Canada Post, UPS, FedEx, Purolator, DHL, USPS`, placeholder "e.g. Canada Post") · **Tracking number** (mono, placeholder "e.g. 1Z9VYTA1234567890") · **Tracking link (optional)** (url, placeholder "Built automatically for Canada Post, UPS, FedEx, Purolator, DHL, USPS") · **Estimated delivery (optional)** two `type=date` with "to", second has `min` · footnote "Used in this email only — not saved to the order."
  - Live preview `<iframe srcDoc={preview.html} sandbox="" className="w-full h-[55vh] rounded-lg border border-line bg-[#EEF4F7]">`.
- Footer `px-5 py-4 border-t border-line bg-surface/50`: Cancel/Close `bg-white border border-line`; **Send email** `bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90` (Send).
- Inputs: `w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/40`.

**Sales tab**
- **Discount & Affiliate card** (Tag emerald-600): discount parts rows; "Referral link" (mono); "Customer saved X (Y%)". Affiliate block: name → `/admin/affiliates/{affiliateId}`; "Credited via" Discount code / Referral link / Assigned customer + code; "Rate" `{rate}% of {base}`; "Affiliate cut" `text-purple-700` + status pill `ml-2 inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase` (paid `bg-emerald-500/10 text-emerald-700`, cancelled `bg-red-500/10 text-red-600`, else `bg-amber-500/10 text-amber-700`).
  - **"Email affiliate & admins"** (Mail) — shown when `editable && commission.status !== 'cancelled'`; `inline-flex items-center gap-1.5 text-xs font-semibold text-purple-700 hover:text-purple-800 disabled:opacity-50`.
  - No commission: "No commission recorded — it is booked when the invoice is paid"; if invoice paid **and** hosted-checkout → **"Book commission"** (same style, DollarSign).
- **Sales Person card** (Briefcase purple-600): name, email, "Commission" `{amount} ({rate}%)` `text-purple-700`.

**Details tab** — dates card `bg-white rounded-xl border border-line p-5 space-y-3` (Source "Stealth Health hosted checkout" / "Created in this admin" + amber warning if hosted but no hand-off; Issue Date; Due Date `text-red-500` when overdue); `PuramassOrderPanel` (hosted); Danger zone (admin) `bg-white rounded-xl border border-red-200 p-5`, title `text-red-700`, "Delete invoice" `w-full … bg-white border border-red-200 text-red-700 rounded-lg text-sm font-medium hover:bg-red-50`.

**Below grid** — `OrderManagementPanel` (`section.mt-8`, "Order & Fulfillment") only when `order_id`.

**Modals** — Send invoice email (`max-w-md`; "Send invoice email" Send teal-dark; "We'll email the PDF as an attachment. BCCs from Site Settings are added automatically."; input "Send to" + hint "Leaving this blank sends to the invoice's customer email."; Cancel `flex-1 border border-line` / Send `flex-1 bg-teal-dark text-white`). Record Payment (`max-w-sm`; "Outstanding: {due} {CUR}"; amount min 0.01 step 0.01; method Card/Cash/Other; reference placeholder "Transaction ID, cheque #..."; Record `bg-emerald-600`, "Saving...").

**Responsive** — header wraps; summary 2 → 4 columns at `lg`; main grid single column below `lg`, 2/3 + 1/3 at `lg`; left column and RailTabs sticky only at `lg`.

### 4.2 Affiliates list page

Top to bottom:
1. `PendingAffiliateRequests` (null when empty) — `bg-white rounded-xl border border-teal/30 overflow-hidden mb-6`; header UserPlus "Affiliate Requests" (`text-lg font-bold`) + count pill `text-xs font-semibold bg-teal/10 text-teal-dark px-2 py-0.5 rounded-full`; row: name, email, wallet (Wallet, mono), message (`bg-surface border border-line rounded-lg px-3 py-2 text-xs`), "Requested {date}" `text-[11px] text-ink-light`; Approve `bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-emerald-600`; Deny `bg-white border border-line text-ink-muted hover:border-red-300 hover:text-red-500`; non-admin "Admin approval required".
2. `PendingReferralCodeRequests` (null when empty) — header Tag "REFERRAL CODE REQUESTS" (`text-[11px] font-semibold uppercase tracking-wider`) + count pill + checkbox "Email the affiliate on approve" (default on); row: name/email, `{previous_code}` struck → ArrowRight → requested code chip (`rounded bg-surface px-2 py-0.5 font-mono font-semibold`) or "First code ·"; "Asked {date}"; Approve (emerald) / Decline (→ dialog). Toasts: `{CODE} declined.` / `{CODE} is live, but the email did not go out: {err}` / `{CODE} is now live — affiliate emailed` / `{CODE} is now live`.
3. Header `mb-5 flex flex-wrap items-start justify-between gap-3`: Users `h-6 w-6 text-teal-dark` + `h1` "Affiliates" `text-xl font-bold text-ink`; subtitle `max-w-2xl text-sm text-ink-muted` "Claim an affiliate to own the relationship, track how it's going, and email them offers to push. Click any row to open their full profile." Buttons: secondary `inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface disabled:opacity-50` — "Refresh" (RefreshCw spins), "Report"/"Generating…" (FileText); primary (admin) `inline-flex items-center gap-2 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-white hover:bg-ink/90` "Add affiliate" (Plus).
4. Filters `mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between`: PillGroup "Show" (All / Active / Inactive + counts), PillGroup "Sort" (Newest / Oldest / Top earning / Most referrals / A–Z); row 2: PillGroup "Lead" (Any [all] / Mine / Unclaimed [n] / Hot / Warm / Cold) + search (`relative w-full max-w-md`; input `w-full rounded-lg border border-line bg-white py-2.5 pl-10 pr-4 text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-teal/40`, placeholder "Search name, email or referral code…", Search icon `left-3`).
   - PillGroup: label `text-[10px] font-semibold uppercase tracking-wider text-ink-muted`; track `flex flex-wrap items-center gap-0.5 rounded-full border border-line bg-white p-0.5`; pill `inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium`, active `bg-ink text-white`, idle `text-ink-muted hover:bg-surface hover:text-ink`; count bubble `rounded-full px-1 text-[10px] tabular-nums` (active `bg-white/25 text-white`, idle `bg-surface text-ink-muted`).
5. `!leadsAvailable` banner `mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800` "Lead management is not set up on this database yet, so every affiliate reads as unclaimed. Run customer-crm-migration.sql …". Error `mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700`.
6. Table card `overflow-hidden rounded-xl border border-line bg-white`; header `flex items-center justify-between border-b border-line p-5 md:p-6` — h2 "{All|Active|Inactive} affiliates" `text-lg font-bold text-ink` + "{n} result(s)" `text-sm text-ink-muted`; `overflow-x-auto` → `<table className="w-full min-w-[980px]">`; th `px-5 py-3 text-xs font-semibold uppercase tracking-wider text-ink-muted`; tbody `divide-y divide-line/50`.

   | Column | Content |
   |---|---|
   | Affiliate | name `text-sm font-medium text-ink` + chip Active `bg-emerald-500/10 text-emerald-600` / Inactive `bg-red-500/10 text-red-500` + rate chip `border border-line text-ink-muted` "{n}%" (rate ≤1 → ×100); email `text-xs text-ink-muted truncate`. Chip base `inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium` |
   | Referral code | Tag + `font-mono text-sm text-ink` or "No code"; "{n} referral(s)[ · {k} codes]" |
   | Customers (right) | `bound_customers` `text-sm font-semibold tabular-nums` + "$X sales" / "no sales yet" |
   | Earnings (right) | `total_earnings` `text-emerald-600 font-semibold` + "$X pending" / "nothing pending" `text-teal-dark` |
   | Joined | `toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'})` + "5m ago / 3d ago / 2mo ago / 1y ago" |
   | Claimed by | name/email + "(you)" `text-emerald-700`, lead chip + "via {method}"; else "Unclaimed" / "open to anyone". Lead chips: New `bg-gray-500/10 text-ink-muted`, Hot `bg-red-500/10 text-red-600`, Warm `bg-amber-500/10 text-amber-700`, Cold `bg-blue-500/10 text-blue-600`, Won `bg-emerald-500/10 text-emerald-600`, Lost `bg-gray-400/20 text-gray-500` |
   | Actions (right) | icon buttons `flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-40` with hover tooltip (`absolute bottom-full … rounded-lg border border-line bg-white px-2.5 py-1 text-xs shadow-lg`): Open profile (Send), Edit (Pencil), Send password reset link (KeyRound), Deactivate/Activate (Power; warning `hover:text-amber-600 hover:bg-amber-50` / teal `hover:text-teal-dark hover:bg-teal/10`), Delete (Trash2, `hover:text-red-600 hover:bg-red-50`, deletable only). Non-admin: "View only" `text-xs italic text-ink-muted`. Clicks `stopPropagation` |

   Row `<tr role="link" tabIndex=0>` `cursor-pointer transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal/50`; click/Enter/Space → `/admin/affiliates/{id}`; cursor-following tooltip "Click here to see more info" (`pointer-events-none fixed z-50 … rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink shadow-lg`, only for `(pointer: fine)`).
   Loading row: Loader2 spin "Loading affiliates…" (`px-5 py-16 text-center`). Empty: "No affiliates yet" / "No affiliates match your filters" (`py-12`).
7. Toasts: `Password reset link emailed to the affiliate` / `Mailer not configured — password reset link copied to clipboard` / `Password reset link generated` / `Failed to send password reset link` / `Could not generate report`.

**CreateAffiliateModal** — standard shell, title "Add Affiliate" (`font-bold text-ink`) + X. Fields: First name * / Last name * (2-col at `sm`), Email *, Wallet Address (mono, placeholder "0x…", hint `text-[11px]` "Where commission payouts will be sent. Optional."), `ReferralCodeField` (auto-follows `suggestReferralCode(first,last)` until edited), Active checkbox (`accent-teal`). Validation: `First name, last name and email are required`; `Wallet address must be a valid 0x… address` (`/^0x[a-fA-F0-9]{40}$/`). Submit disabled while saving or `code !== '' && availability !== 'free'`. Buttons Cancel `flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg text-sm font-medium hover:bg-line` / primary `flex-1 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/90 disabled:opacity-50` "Create Affiliate" / "Creating & sending…". Error `px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700`. Done view: `w-12 h-12 rounded-full bg-emerald-500/10` + Check `text-emerald-500` "Affiliate created" / "A set-password link was emailed to them." — or AlertTriangle `text-amber-500` "We couldn't email the set-password link. Send them a password reset manually." + "Referral code: {CODE}" + Done.

**ReferralCodeField** — input `w-full px-3 py-2.5 pr-10 bg-surface border border-line rounded-lg text-sm font-mono uppercase tracking-wider text-ink focus:ring-2 focus:ring-teal/40`, placeholder "AMCSMITH10", maxLength 20; right icon Loader2 / Check `text-emerald-600` / X `text-red-500`; chips `rounded-full border border-line bg-white px-2.5 py-1 text-[11px] font-medium text-ink-muted hover:border-teal/40` "✨ Use {suggestion}" (Sparkles) / "Random code" (Shuffle); helper `text-[11px]`: reason `text-red-600` / "{CODE} is available." `text-emerald-600` / "Letters and numbers, 20 characters or fewer."

**EditAffiliateModal** — same shell, "Edit Affiliate"; First/Last/Email/Wallet/"New Password (leave blank to keep current)" (text, mono)/Active; "Save Changes"/"Saving…".

**DeleteAffiliateDialog** — panel `max-w-sm`, "Remove Affiliate"; option cards: Deactivate (`border border-line rounded-lg p-4`, PowerOff amber-500, "Bans sign-in and hides them from active lists. Keeps all data and commissions.", button `w-full px-4 py-2 bg-amber-500/10 border border-amber-500/20 text-amber-600 rounded-lg text-sm font-medium hover:bg-amber-500/20`); Delete Permanently (`border border-red-200`, Trash2 red-500, "Removes the affiliate, referral codes, commissions and login. This cannot be undone.", `bg-red-500/10 border border-red-500/20 text-red-500 hover:bg-red-500/20`); Cancel `mt-4 w-full px-4 py-2 bg-surface border border-line rounded-lg text-sm text-ink-muted hover:text-ink`. No typed confirmation.

**DeclineReferralCodeDialog** — "Decline code request"; "{name} asked for {CODE}. They keep the code they have."; "Reason (optional)" textarea rows 3, placeholder "Kept for the desk — the affiliate is only told it was declined."; hint "Shown here with your name, never on the affiliate's screen."; Decline `bg-red-500 text-white hover:bg-red-600`.

**EditReferralCodeModal** — "Change referral code" / "Set referral code"; amber when current: "Saving retires {CODE} immediately — links and cards carrying it stop working. Uses and commissions already recorded stay with this partner."; checkbox "Email {name} their new code" + "Sent only if the change saves. Untick if you are telling them another way."; "Save code" disabled while saving, unchanged, or not free.

### 4.3 Affiliate detail page ("Partner 360")

Container `max-w-6xl space-y-6`:
1. BackLink "← Back to affiliates" `text-sm text-ink-muted hover:text-ink`.
2. Header card `rounded-xl border border-line bg-white p-5 md:p-6`: avatar `h-12 w-12 rounded-xl bg-teal/10` + Users teal-dark; h1 `text-xl font-bold sm:text-2xl` (fallback "Unnamed affiliate"); Mail email / Phone; badges `rounded-full px-2.5 py-1 text-xs font-medium` — Active `bg-emerald-100 text-emerald-700` (CheckCircle2) / Inactive `bg-red-100 text-red-700` (XCircle), code `bg-teal/10 text-teal-dark` (Tag, mono), "{n}% commission" `bg-gray-100 text-ink-muted` (Percent); wallet line mono xs; right meta rows Joined / Last sign-in ("No account") / Last commission. Actions `mt-5 flex flex-wrap gap-2 border-t border-line pt-4`: ActionButton `rounded-lg border px-3 py-2 text-sm font-medium border-line bg-white text-ink hover:bg-surface` (danger `border-amber-200 text-amber-700 hover:bg-amber-50`) — Copy email, Copy code; admin: **Send email** `bg-teal-dark px-3 py-2 text-sm font-semibold text-white hover:bg-teal/90`, Send sign-in link (welcome), Send password reset link, Edit affiliate, Deactivate/Activate; `mailto:` "Open in mail app".
3. Stat tiles `grid gap-4 sm:grid-cols-2 lg:grid-cols-4`; StatCard `rounded-xl border border-line bg-white p-4`, label `text-xs font-semibold uppercase tracking-wider text-ink-muted`, value `mt-2 text-lg font-bold text-ink`, hint `text-xs text-ink-muted`: **Total earned** (DollarSign emerald-600; "$paid paid · $pending pending") · **Customers referred** (UserPlus; "{converted} have ordered ({pct}%)") · **Customer sales** (TrendingUp; "Spend by everyone they referred") · **Referral uses** (Tag; "{activeCodes} active code(s) · {n} commissions").
4. `LeadPanel` (claim/release, status pills, contact method, last contacted / next follow-up `datetime-local` with overdue warning, notes, Save).
5. Two panels `grid gap-5 md:grid-cols-2`. Panel = `overflow-hidden rounded-xl border border-line bg-white`, header `flex items-center justify-between border-b border-line px-4 py-3`, icon tile `h-7 w-7 rounded-md bg-teal/10`, title `text-sm font-semibold text-ink`, count `text-xs tabular-nums text-ink-muted`; DetailRow `flex justify-between px-4 py-2.5`, dt `text-xs text-ink-muted`, dd `text-sm font-medium text-ink truncate`. **Payout details** (Wallet address / Commission rate "Default" or n% / Paid out / Owed / Commissions "{n} recorded"); **Account details** (Affiliate ID mono / Email / Status / Joined / Site sign-in / Last updated).
6. **AffiliateCodesPayouts:**
   - Amber banner if migration missing: "Discount codes and payouts need affiliate-discount-codes-payouts-migration.sql to be run in Supabase."
   - 4 tiles (`rounded-xl border bg-white p-4`; highlighted `border-teal/50` + value `text-teal-dark`): "Revenue brought in" ("{orders} credited sale(s)"), "Commission earned" ("{pendingCount} pending · $X"), "Paid out" ("$X marked paid without a payout record" / "{n} payment(s)"), "Balance owed" ("Overpaid" / "All settled" / "Earned, not yet paid"; highlighted when > 0). Money `$` + en-CA 2dp.
   - **Discount codes** (Ticket; "{orders} orders · $rev"; admin "+ New code" `rounded-lg border border-line px-2.5 py-1 text-xs`): Code (mono semibold) | Discount ("15% off" / "$20.00 off" + "{r}% commission" or "Default commission") | Uses ("n / max") | Revenue | Commission | Status pill `rounded-full px-2 py-0.5 text-[11px] font-medium` (Active `bg-emerald-100 text-emerald-700`, Inactive `bg-gray-100 text-ink-muted`, Scheduled `bg-amber-100 text-amber-700`, Expired/Used up `bg-red-100 text-red-700`) | Copy checkout link `/checkout?discount=CODE`, Edit. Empty: "No discount codes assigned. Create one and every paid order that uses it is credited to {name}."
   - **Payments to affiliate** (Banknote; admin "+ Record payment" `bg-ink text-white rounded-lg px-2.5 py-1 text-xs`): Date (+ "by {recorded_by_name}") | Amount (right) | Method | Reference (mono + notes) | Settled ("N commissions") | void (Trash2; confirm "Void the $X payout from {date}? The commissions it settled go back to pending."). Empty "No payments recorded yet."
   - **RecordPayoutModal** — `max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl`; "Record payment"; "To {name} · balance owed $X"; checklist "Commissions this payment settles" (select-all + total; rows date · reference [+ code teal-dark] · "on $base" · amount; pending pre-ticked); "Amount paid (CAD)" (step .01; defaults to selected sum or balance); "Date paid" (default today, sent as local noon ISO); "Method" (`e_transfer` Interac e-Transfer, `crypto`, `paypal`, `bank` Bank transfer, `cheque`, `store_credit` Store credit, `other`); "Reference" (placeholder "Transaction ID / tx hash"); "Notes" (textarea 2); mismatch hint `text-amber-700` "Differs from the selected commissions ($X). The balance will reflect the amount actually paid."; submit "Record $X" (disabled unless > 0). Inputs `w-full rounded-lg border border-line bg-white px-3 py-2 text-sm focus:border-teal`. Toast "Payment recorded · N commissions marked paid".
   - **DiscountCodeModal** — Code (placeholder SPRING20, random button; "Letters and numbers only. Buyers type it at checkout."), Assigned affiliate (hidden when fixed), Discount type (Percent off / Fixed amount off), Percent | Amount (CAD), Commission rate (%) (placeholder "Affiliate's default rate"; hint "Of the discounted goods subtotal (shipping and tax excluded). Leave blank to use the affiliate's own rate."), Minimum order (CAD), Usage limit ("Unlimited"), Starts / Ends (`datetime-local`), first-order-only, excluded products, Internal notes ("e.g. Podcast sponsorship, Oct 2026"), Active.
7. **What their referrals buy** (Package): top 12 products, bar track `h-2 rounded-full bg-surface`, fill `bg-teal` (min 4%), "{q} units $rev", "across N orders · last {date}". Empty "Nothing bought by their referrals yet — nothing to tell them to push."
8. **Pages they visit** (Route, `max-h-80 overflow-y-auto`; empty "No site account, so nothing is recorded for them." / "No page visits recorded yet. Only signed-in visits are tracked.") + **Recent journey** (History; "Nothing recorded yet.").
9. **Earnings by month** (BarChart3): "Aug 2026", bar, "$X · N commissions"; empty "No commissions earned yet."
10. **Referral link** (Tag): code chip `rounded bg-surface px-2.5 py-1 font-mono text-sm font-semibold`, "{n} uses", copy-link chip `rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-ink-muted hover:border-teal/40`, "Change" (admin); or "No referral code has been issued yet." + "Set code". Pending request box `rounded-lg border border-amber-200 bg-amber-50 p-3` ("Asked for {CODE}", date, Approve emerald / Decline `border-amber-300 bg-white text-amber-800`, "Email on approve"). History "{CODE} set by|approved by|declined by|withdrawn {name} · {notes}  {date}" (≤5).
11. **Customers referred** (UserPlus): Customer (link `/admin/customers/{id}` + ExternalLink; email + "· via code" when not bound) | Joined | Orders (right) | Spend (right). Th row `border-b border-line text-left text-xs uppercase tracking-wider text-ink-muted`, th `px-4 py-2 font-semibold`, td `px-4 py-3`, rows `hover:bg-surface`. Empty "Nobody has been referred by this affiliate yet."
12. **Commissions** (DollarSign, count): Earned (date) | Status | Order total | Rate (`(r ≤ 1 ? r*100 : r).toFixed(0)%`) | Amount (right, `text-emerald-600 font-semibold`). Badge `inline-flex rounded px-2 py-0.5 text-[11px] font-medium capitalize`: pending `bg-amber-500/10 text-amber-700`, paid `bg-emerald-500/10 text-emerald-600`, cancelled `bg-red-500/10 text-red-600`, fallback `bg-gray-500/10 text-gray-600`. Footer "Showing the most recent 200 of N." Empty "No commissions recorded yet." No per-row actions.
13. **Emails sent** (Send): subject, datetime, "Sent by X · CC …", promo chip `rounded bg-teal/10 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-teal-dark`, failure chip `bg-red-500/10 text-red-600` "Failed: …".
- Loading: centred Loader2 "Loading affiliate…" (`py-24`). Not found: BackLink + card "Affiliate not found." Errors → toast.

### 4.4 Commissions desk (`/admin/commissions`)

- Stat pills (`bg-white border border-line rounded-lg px-4 py-2.5`): amber dot "$X pending" (`text-teal-dark`), "{n} recipients owed", emerald dot "$X paid" (`text-emerald-500`), "{n} commissions".
- Segmented Pending / Paid / Show all (active `bg-ink text-white`); search "Search by name, email, code, customer or invoice…"; select "Affiliates & sales / Affiliates / Sales persons"; "Full report" (`bg-ink`); admin "Find missed commissions" (RefreshCw; confirm "Look for paid Stealth Health sales with no affiliate commission and book the ones that earned one?"; toasts "Booked N missed commission(s) ($X)" / "No missed commissions (N uncredited sale(s) checked)" / "N could not be booked — see the server log").
- Grouped table (`min-w-[820px]`), one row per recipient: chevron, name, source tag (Affiliate `bg-blue-500/10 text-blue-600` / Sales `bg-purple-500/10 text-purple-600`), code mono, email | count | Latest | Pending (amber-600) | Paid (emerald-600) | Profile link, "Print report". Expanded: Date | Invoice (mono teal-dark link) | Customer ("Guest" chip) | Base | Rate | Commission | Status (paid `bg-emerald-500/10 text-emerald-600` + date, pending `bg-amber-500/10 text-amber-600`, else `bg-red-500/10 text-red-500`) | "Mark paid" (`bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 rounded-lg text-xs`; confirm "Mark $X on REF as paid?").
- Loading 6 pulse rows. Empty "No commissions yet" / "Nothing pending — everyone is paid up" / "No commissions match your filters".

### 4.5 Shipped email — "Your Order Has Shipped!" (`lib/fulfillment-email.ts`)

**Email rules:** table layout, inline styles only, **no SVG, no web fonts**, absolute image URLs, `meta color-scheme: light only`. Pure module (renders under `node --test`).

**Constants:** NAVY `#07203A`, BLUE `#0E68AE`, MUTED `#56707F`, LINE `#DCE7EB`, SOFT `#F3F8FB`, PAGE `#EEF4F7`; body copy `#34495A`; footer legal `#8AA0AD`. FONT `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`; MONO `'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace`.

**Data contract:**

```ts
interface FulfillmentTracking { number: string|null; carrier: string|null; url: string|null }
interface FulfillmentEmailData {
  customerName: string;                       // 'there' when unknown
  orderNumber: string;
  orderDate?: string;                         // timestamp or YYYY-MM-DD
  items: ConfirmationLine[];                  // {name, quantity, price (unit), strength?, unit?: 'vial'|'case', vialsPerBox?, imageUrl?}
  shipTo?: { name: string|null; lines: string[]; phone: string|null };
  tracking?: FulfillmentTracking;
  estimatedDelivery?: { from: string|null; to: string|null } | null;   // YYYY-MM-DD each
  viewOrderUrl?: string;
}
```

**Copy:**
- Subject: `Your VYTA order ${orderNumber} has shipped`
- Preheader: `Order ${n} has shipped` + (`— tracking ${number}` when set) + `.`
- H1: `Your Order Has Shipped!`
- Intro (greeted `Hi {name}, great news! …` unless name is empty/'there'): with number — "Great news! Your order has been processed and is on its way to you. You can track your shipment using the tracking number below."; without — "Great news! Your order has been processed and is on its way to you."

**Shell `renderVytaEmailShell(site, {title, preheader, notice?, body, hero = 'shipped-hero.jpg'})`** (shared with the commission email):
- `<body>` bg PAGE; hidden preheader div; outer table `padding: 28px 10px`; inner column `width=640`, `max-width: 640px`.
- Optional admin notice row: table bg `#FFF7E6`, border `1px solid #F3D49B`, radius 12px, cell `padding: 12px 16px; font-size: 13px; line-height: 19px; color: #7A4B00` → `<strong>Admin copy</strong> — {notice}`.
- Cover: cell bg `#DCEBF4`, radius `20px 20px 0 0`, `<img src="{site}/images/email/{hero}" width="640">` full width, linked to site.
- Body: `class="body-pad"` bg white, radius `0 0 20px 20px`, padding `28px 28px 24px`.
- `@media (max-width:600px)`: `.stack` block 100%; `.stack-gap` padding-top 16; `.hide-sm` none; `.title` 28/34px; `.body-pad` 14px sides; `.card-pad` `18px 16px`; `.badge-cell` block left; `.show-sm` block; `.dl-label` 30%; `.dl-aside` 36px; `.mono` 13px; `.thumb` 60px / img 52px.

**Body, top to bottom:**
1. H1 `class="title"` centred, 34/40px, 800, letter-spacing −0.01em, NAVY.
2. Intro `max-width: 520px` centred, 16/25px, `#34495A`.
3. **CTA** (`padding: 26px 0 0`, centred):
   - Tracking URL resolvable → pill button **"Track Your Order"** + `12px MUTED` "Tracking information may take a few hours to update."
   - else `viewOrderUrl` → **"View Order Details"** + "Sign in or create an account to view it."
   - else nothing.
   - Button: `display:inline-block; padding: 15px 34px; border-radius: 999px; background: #12A9D6; background-image: linear-gradient(90deg, #22C1E0, #0E68AE); color:#FFF; font-size:17px; font-weight:700` + 3 nbsp + `arrow-right-white` icon 18px.
4. **Order card** (`cardTable`: white, `border: 1px solid LINE`, radius 16px, margin-top 16, cell `card-pad` padding `22px 24px`):
   - Left: "Order #{n}" 22px 800 NAVY; "Placed on {Month D, YYYY}" 14px MUTED (New York TZ; date-only values as UTC).
   - Right badge: pill `padding: 8px 16px; border-radius: 999px; background: #E3F2FA; border: 1px solid #C5E3F3; 14px 700 NAVY` → `truck-blue` 16px + "Shipped".
   - Detail rows (`detailRow(label, value, first, aside, labelWidth='38%')`: label cell 14px 700 NAVY `padding: 13px 12px 13px 0`; value 14px NAVY; aside cell 44px right-aligned; rows after the first get `border-top: 1px solid LINE`), shown only when present:
     - **Tracking Number** — MONO, 600, `word-break: break-all; user-select: all` (tap selects whole number — email can't run a clipboard script) + aside `copy-blue` 20px icon (alt "Copy").
     - **Carrier** — text + aside **carrier logo** 34×34 (`CARRIER_LOGOS`: only `/\bups\b/i` → `carrier-ups.png`; others show name only). To add a carrier: drop `carrier-<name>.png` (96px) in `public/images/email/` and add an entry.
     - **Estimated Delivery** — `formatDeliveryWindow`: `Mar 27, 2026 – Mar 31, 2026`, single date when only one is set or both equal, en-US, UTC.
5. **Items Shipped** card (only with items): "Items Shipped" 19px 800; per line: 72×72 thumb (radius 10, border LINE, bg SOFT) or `flask-conical-blue` 28px placeholder; name 17px 800; `{strength} · {packLabel}` 14px MUTED (`Pack of {vialsPerBox||10}` for case, `Single vial` for vial); "Research Use Only" 13px MUTED; `Qty: n` (desktop column `hide-sm`, mobile `show-sm`); line total `price × qty` 15px 700 right.
6. **Shipping Address** card (when `shipTo`): `map-pin-blue` 26px + "Shipping Address" 18px 800 + name and lines 15/22px MUTED.
7. **What Happens Next?** card on SOFT: 3 cells (31% each, `stack` on mobile) separated by `arrow-right-muted` 16px (hidden on mobile); each `iconCircle(icon, {size:48, bg:'#FFFFFF'})` + title 14px 700 + body 13/18px MUTED:
   - `truck-blue` "Order Shipped" / "Your order is on its way to you."
   - `map-pin-blue` "Track in Real Time" / "Click the button above to view tracking details." (when URL) or "Use the tracking number above with the carrier."
   - `package-open-blue` "Enjoy Your Order" / "Estimated delivery {window}." or "Thank you for choosing VYTA."
8. **Footer** (`margin-top: 24px; border-top: 1px solid LINE`): `vyta-mark.png` 34px + `vyta-wordmark.png` 104px (linked); "If you have any questions, please contact our support team at" + `support@vytabio.com` (BLUE underline); legal 10px, letter-spacing 0.14em, uppercase, `#8AA0AD` "For research purposes only. Not for human or veterinary use."

**Plain-text version** (`renderFulfillmentEmailText`): `YOUR ORDER HAS SHIPPED!`, greeting, intro, `Order #`, `Placed on`, `Tracking number:`, `Carrier:`, `Estimated delivery:`, `Track your order: {url}`, items `  {name} {strength} ({pack}) × {qty} — ${total}`, shipping address, view-order line (when no tracking URL), support line, legal line.

**Tracking link resolution (`trackingUrlFor`)** — stored URL if it matches `^https?://`; else needs both number and carrier, number URL-encoded:

| carrier regex | URL |
|---|---|
| `/\bups\b/i` | `https://www.ups.com/track?tracknum=${n}` |
| `/fedex/i` | `https://www.fedex.com/fedextrack/?trknbr=${n}` |
| `/canada\s*post\|postes?\s*canada/i` | `https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=${n}` |
| `/purolator/i` | `https://www.purolator.com/en/shipping/tracker?pin=${n}` |
| `/\bdhl\b/i` | `https://www.dhl.com/ca-en/home/tracking.html?tracking-id=${n}` |
| `/usps/i` | `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}` |

Easyship normally supplies `tracking_page_url`, stored as `tracking_url`, so the table is the fallback.

**Admin copy:** same HTML with `notice` = `this shipped email was sent to {to}{trigger | ' by {actorEmail}'}.`; subject `[Copy] {subject} → {to}`; text prefixed `ADMIN COPY — {notice}\n\n`. Auto-send trigger text: ` automatically when the Easyship label was generated`.

### 4.6 Affiliate commission email — "You earned a new commission" (`lib/affiliate-commission-email.ts`)

Same rules and shell (`renderVytaEmailShell`, hero **`affiliate-hero.jpg`** = the shipped cover with the truck removed), same `cardTable` / `detailRow` / `button` helpers.

**Data contract:**

```ts
interface AffiliateCommissionEmailData {
  affiliateName: string;        // "First Last"; '' when none
  orderNumber: string;          // invoices.invoice_number, else the invoice id
  orderTotal: number;           // the commission BASE (discounted goods subtotal), NOT the invoice total
  commission: number;
  referralCode: string|null;    // discount code that earned it, else referral code, else null
  dashboardUrl: string;         // `${SITE_URL}/affiliate/dashboard`
}
```

**Copy:**
- Subject (affiliate): `You earned a ${money(commission)} commission on order ${orderNumber}`
- Subject (admin copy, same body): `[Admin copy] ${affiliateName || 'An affiliate'} earned a ${money(commission)} commission on order ${orderNumber}`
- Preheader: `A customer just placed an order using your affiliate link or code. You earned ${money}.`
- `money(n)` = `${n<0?'-':''}$${abs.toFixed(2)}` → `$12.50`.

**Body, top to bottom:**
1. `affiliate-network.png` 120×102 centred.
2. Eyebrow "Affiliate Notification" — 13/18px, 600, letter-spacing 0.28em, uppercase, MUTED, margin-top 18.
3. H1 "You earned a new commission" — 34/40px 800 NAVY, margin-top 10.
4. Intro "A customer just placed an order using your affiliate link or code." — 16/25px `#34495A`, max-width 520.
5. Details card (margin-top 26, label width **46%**): **Order Number** (`user-select: all` + `copy-blue` aside) · **Order Total** · **Commission Earned** (20px 800 TEAL `#12A6CC`) · **Affiliate** (when name) · **Referral Code** (when set; letter-spacing 0.02em, `word-break: break-all`).
6. Recorded note: table bg `#EEF6FB`, radius 16, margin-top 16, padding `22px 24px`; left `iconCircle(coins-teal 44px, {size:72, bg:'#E0F0F8'})`; right cell `padding-left: 20px; border-left: 1px solid #CFE2EC` — "Your commission has been recorded" 18/24px 800 NAVY + "and will be included in your next payout." 15/22px MUTED.
7. Button **"View Affiliate Dashboard"** → `dashboardUrl` (`padding: 28px 0 0`, centred).
8. Footer (`margin-top: 28px; border-top: 1px solid LINE`): mark + wordmark, then the site host (scheme and `www.` stripped) as a BLUE link. (No support line, no legal line.)

**Plain text:** `YOU EARNED A NEW COMMISSION`, `Hi {name},`, intro, `Order number:`, `Order total:`, `Commission earned:`, `Affiliate:`, `Referral code:`, "Your commission has been recorded and will be included in your next payout.", `View your affiliate dashboard: {url}`, `Questions? Contact us at support@vytabio.com.`

**Note on "tracking" in this email:** it carries **no parcel tracking** — it is sent at payment time, before any label exists. Its "tracking" is the send log (§5.7). See §7 if parcel tracking was wanted here.

### 4.7 Email image assets (`public/images/email/`, all absolute URLs off `SITE_URL`)

`shipped-hero.jpg`, `affiliate-hero.jpg`, `affiliate-network.png` (320×272, shown 120×102), `carrier-ups.png`, and 96px transparent Lucide PNGs (lucide-static 0.546.0, stroke 1.75): `truck-blue`, `map-pin-blue`, `package-open-blue`, `copy-blue`, `flask-conical-blue`, `arrow-right-white`, `arrow-right-muted`, `coins-teal`. Plus `/images/vyta-mark.png`, `/images/vyta-wordmark.png`. **All brand art must be swapped for aminocan-cad.**

---

## 5. Data flow & behavior

### 5.1 Shipment anchor

The shipment lives on the **order** row when `invoice.order_id` is set; otherwise on the **invoice**
row (hosted-checkout / manual invoices). Whatever the anchor, the shipment record is **mirrored onto the
invoice(s)** so the invoice always carries its own copy. An order with several invoices: all get the
mirror; **the oldest invoice (by `created_at`) gets the shipped email**.

### 5.2 Shipped email — automatic send (`lib/shipping/label-generated.ts`)

`onShipmentLabelGenerated(db, anchor, {apiKey?, details?, skipEmail?})` — never throws; returns
`{synced, invoiceIds, email: 'sent'|'already_sent'|'not_ready'|'skipped'|'failed'|'no_invoice', error?}`.

1. Read anchor `id, easyship_shipment_id, label_state, label_url`.
2. If no `details`, `getEasyshipShipmentDetails(shipmentId, apiKey ?? settings key)`.
3. `invoiceIds` = `[anchor.id]` or every invoice on the order, oldest first.
4. With details: write `coreShipmentPatch` then `extendedShipmentPatch` (separately, so missing extended columns can't sink the core) to the anchor **and** mirror invoices; stamp `label_generated_at = now()` where null when generated. Without details on an order anchor: copy non-null `easyship_shipment_id, easyship_courier_id, tracking_number, tracking_url, carrier, label_url, label_state` from the order onto the invoices + `easyship_synced_at`.
5. `labelReady = details?.label_state === 'generated' || (!details && (row.label_state === 'generated' || !!row.label_url))`; else `not_ready`.
6. `sendShippedEmailOnce(db, invoiceIds[0], details)`:
   - pickup → `skipped`; `shipped_emailed_at` set → `already_sent`.
   - **Claim** (one conditional UPDATE so webhook and buy-label racing can't both send):
     ```sql
     UPDATE invoices SET shipped_email_auto_claimed_at = now()
      WHERE id = $1 AND shipped_emailed_at IS NULL AND shipped_email_auto_claimed_at IS NULL
      RETURNING id;   -- 0 rows → 'already_sent'
     ```
     Missing column → fall back to the `shipped_emailed_at` check only.
   - Delivery window: `estimatedDeliveryWindow(todayInAppTz(), min_delivery_days, max_delivery_days)` — adds **business days** (Mon–Fri) to today in **America/New_York**; one of min/max → both ends use it.
   - `sendFulfillmentEmail(db, SYSTEM_ACTOR, invoiceId, {details:{trackingNumber, carrier, trackingUrl, deliveryFrom, deliveryTo}, trigger:'automatically when the Easyship label was generated'})` with `SYSTEM_ACTOR = {authorized:true, canSendEmails:true, role:'admin', actorId:null, actorEmail:null}`.
   - Failure → release: `UPDATE invoices SET shipped_email_auto_claimed_at = NULL WHERE id = $1 AND shipped_email_auto_claimed_at = $claimedAt` (next label event retries).

**Every caller (each can trigger the auto email):**

| Caller | How |
|---|---|
| `POST /api/admin/invoices/[id]/buy-label` | `after()` |
| `POST /api/admin/orders/[id]/buy-label` | after |
| `POST /api/admin/invoices/[id]/easyship-shipment` | awaited |
| `GET /api/admin/invoices/[id]/tracking?refresh=1` (admin) | awaited — **including the page's automatic once-per-load refresh** |
| `POST /api/admin/invoices/easyship-sync` | `after()` |
| `POST /api/webhooks/easyship` (first time label → generated, invoice or order) | `after()` |
| `lib/shipping/auto-shipment.ts` (label at creation, or `buyLabelForAnchor`) | awaited |

> Several code comments (`lib/fulfillment-email.ts` header, `lib/warehouse/server.ts`,
> `FulfillmentEmailCard`, `FulfillmentEmailModal`) still say "manual only". That is true only for
> **status changes** (marking shipped never sends). **Label generation auto-sends.** Port the behaviour,
> not the comments.

### 5.3 Shipment creation (`lib/shipping/auto-shipment.ts`, `lib/easyship.ts`)

- Couriers restricted to UPS and Canada Post (`/\bups\b/`, `/\bcanada\s*post\b/` on `courier_name`). Preference `best_value` (default): cheapest rate with ≤2 delivery days, else fastest (cheaper wins ties); `ups` / `canada_post`: best_value within that carrier, fallback to overall. `site_settings.easyship_auto_courier_preference` is ignored (always best_value).
- Courier pick order: explicit override → stored courier (if still quoted and no preference passed) → `pickCourier`.
- Parcel: one line "Supplements", HS `17049000`, declared 1 CAD per unit, weight `max(unitWeightKg × Σqty, 0.05)`, box from `site_settings.shipping_box` (blank sides → 1 cm).
- `POST /shipments`: `incoterms 'DDU'`, `courier_settings {courier_service_id, allow_fallback:false, apply_shipping_rules:false, handover_method}`, `shipping_settings {units kg/cm, output_currency 'CAD', buy_label:false, printing_options:{label: EASYSHIP_LABEL_SIZE||'4x6'}}`.
- Destination (invoice path): order → hosted-checkout ledger → drop-ship client (`customer_clients`) → customer profile.
- Every attempt: anchor `auto_shipment_status/stage/error/attempted_at` + row in `shipment_auto_logs`.
- Label print: `GET …/label` → `toLabelPdf` (pages already 4x6 kept; others ink-trimmed and re-rendered at 300 dpi onto 288×432pt; images drawn onto 4x6; any failure returns the original) → new tab opened synchronously (`'Loading label…'`), object URL revoked after 60s.

### 5.4 Invoice page actions

| Action | Call | Result |
|---|---|---|
| Refresh tracking | `GET …/tracking?refresh=1` | flash `refresh_error` or "Tracking refreshed" |
| Send invoice email | `POST …/email` (`{to}` if typed) | "Invoice email sent", reload |
| Delete | confirm "Delete this invoice? Line items, payments and email history will be removed. The linked order is left intact. This cannot be undone." → DELETE | `router.push('/admin/invoices')` |
| Record payment | `POST …/payments {amount, method, reference_note}` | "Payment recorded" |
| Change status | `PATCH …/[id] {status}` | "Status updated" |
| Book commission | `POST …/commission` | `Commission of {amount} booked`, re-read breakdown |
| **Email commission** | confirm "Email this commission to the affiliate and send the admins a copy?" → `POST …/commission/email` | flash `Commission email — affiliate: {sent \| no email on file \| failed}, admins: {sent \| no recipients set \| failed}` |
| Print label | `printInvoiceLabel(id)` | new tab with 4x6 PDF |
| Invoice PDF | `fetch('/api/admin/invoices/{id}/pdf[?download=1]')` (Bearer) → HTML blob → `window.open`, URL revoked after 15s | |
| **Send shipped email** | FulfillmentEmailCard → modal → `POST /api/warehouse/queue/[id]/notify` | `onSent` re-reads the invoice (card shows "Sent …") |

### 5.5 Shipped email — manual send

1. Modal opens → `GET …/notify?preview=1`. Prefill `to = preview.to`, `subject = preview.subject`, carrier/number/url from `preview.stored` (what's on file); delivery dates blank.
2. Each detail edit → debounced **450ms** re-preview with only non-empty params; only the latest request id is applied.
3. Send → `POST …/notify {to?, subject?, carrier, tracking_number, tracking_url, delivery_from, delivery_to}`. `!ok` → show error. Else `onSent`; if `admin_copy.error` stay open with amber "Sent to …, but the admin copy failed: …", else close.
4. Client validation: `EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/`, recipients split on `/[\s,;]+/`. Send disabled when: sending, loading, refreshing, `to < from`, `sentWarning`, no preview, no recipients, any invalid recipient, empty subject.

**Server `buildFulfillmentEmail(db, invoiceId, details)`:**
- Reads `invoices.*`, `orders.*` (when `order_id`), and `loadOrderEmailForInvoice(db, invoiceId)` (`lib/order-confirmation.ts`; resolves storefront / hosted / manual → `customerName, orderNumber, orderDate, items (with absolute image URLs), shipTo, viewOrderUrl, to`).
- Stored tracking: `number = order.tracking_number ?? invoice.tracking_number`; `carrier = order.carrier ?? order.shipping_carrier ?? invoice.carrier`; `url = order.tracking_url ?? invoice.tracking_url`.
- Typed overrides: typed number wins; **if the typed number differs from the stored one, the stored URL is dropped** (stale link); typed carrier/URL win. Typed values are **never saved**.
- Fallbacks: `customerName` → `invoice.customer_name` → `'there'`; `orderNumber` → `order.order_number` → `invoice.invoice_number`; `to` → `pickDeliverableEmail(...emails, invoice.customer_email)` → `invoice.customer_email`.

**Server `sendFulfillmentEmail(db, actor, invoiceId, {subject?, to?, details?, trigger?})`:**
1. Recipients: typed `to` parsed by `parseRecipients` (split `/[\s,;]+/`, each must pass `deliverableEmail` — rejects placeholder TLDs `.local/.invalid/.test/.example` — deduped case-insensitively); any invalid → `invalid recipient: …`; none → `no recipient`. A redirect writes nothing back to the invoice/customer.
2. Subject: typed, else default.
3. Transport: nodemailer — requires `SMTP_HOST`; port `SMTP_PORT || 587`; `secure: SMTP_SECURE === 'true'`; auth `SMTP_USER/SMTP_PASSWORD`; From `SMTP_FROM || EMAIL_FROM || 'VYTA <orders@aminocan.com>'`. No transport → `'SMTP not configured'`.
4. **Always** insert `fulfillment_email_log {invoice_id, kind:'shipped', to_email, subject, message_id, success, error, sent_by, sent_by_email}`.
5. Admin copy only after the customer send succeeds: `getAdminAlertEmails(db)` minus customer recipients; one message, all admins in `to`; **not logged**; failure never fails the customer send.
6. On success: `invoices.shipped_emailed_at = sentAt`; audit `fulfillment.email_sent.shipped`.
7. Returns `{ok, message_id, emailed_at, error?, admin_copy?: {sent, to[], error?}}`.

### 5.6 Commission — computation, booking, and the email

**Computation (`recordAffiliateCommission(db, {invoiceId, subtotalCents, customerId, referralCode, discountCodeId})` — the only live writer; never throws):**
1. `commissions` row for `invoice_id` exists → `already-recorded`.
2. **Attribution priority:** (a) discount code typed at checkout whose `affiliate_id` is set and ≠ buyer (carries the code's `commission_rate` override) → (b) **bound customer** `customers.affiliate_id` (≠ buyer; uses their active referral code row) → (c) `ref_code` cookie: `trim().toUpperCase()` exact match on active `referral_codes.code`, else on an affiliate's `discount_codes.code` (affiliates share discount codes as `?ref=`); owner must be `active`. **Self-referral rejected everywhere.** None → `no-attribution`.
3. **Base** = `round2(subtotalCents / 100)` — partner-reported **goods subtotal after discounts; shipping and tax excluded**. ≤0 → `no-base` (no row).
4. **Rate** = code override `clamp(codeRate/100, 0, 1)` if not null (0 = "discount only"), else `normalizeCommissionRate(affiliates.commission_rate)` (non-finite/≤0 → 0.10; ≤1 fraction; >1 percent ÷100; result >1 → 0.10).
5. `amount = round2(base × rate)`; insert `{affiliate_id, invoice_id, order_id:null, referral_code_id, amount, order_total: base, commission_rate: round2(rate×100) /* percent */, status:'pending', discount_code_id}`. Postgres `23505` → `already-recorded` (webhook/poller race).
6. → `{recorded:true, commissionId, amount, affiliateId, orderTotal: base, code}`.
- `round2(n) = Math.round((n + Number.EPSILON) * 100) / 100`.

**When it's booked:** only on the hosted-checkout **paid** transition (`lib/payments/puramass-fulfillment.ts` `creditAffiliate`, run on **every** webhook / cron poll / admin refresh pass; idempotent through the unique index). Also by "Book commission" and "Find missed commissions" (no emails).

**Lifecycle:** `pending` (insert) → `paid` (payout recorded: `payout_id` + `paid_at`; or desk "Mark paid": `paid_at`, no `payout_id`) → back to `pending` if the payout is voided. `cancelled` is allowed by the CHECK and honoured by every reader, but **no code sets it** (SQL only). No "approved" state.

**Automatic email:** in `creditAffiliate`, **only when `recorded: true`** →
`notifyAffiliateOfCommission(db, {affiliateId, invoiceId, amount, orderTotal, code})`. The unique
index on `commissions.invoice_id` means only one pass ever gets `recorded: true`, so the email goes
out **once per order with no claim column of its own**. A failed send is logged, **not retried**.

**`notifyAffiliateOfCommission(db, notice, sentBy = null)`** (never throws):
1. Parallel: `affiliates.select('email, first_name, last_name')`, `invoices.select('invoice_number')`, `getAdminAlertEmails(db)`. No affiliate → `{sent:false, reason:'no_affiliate'}`.
2. `to = deliverableEmail(affiliate.email)`.
3. **Admin copy first** (so it goes out even when the affiliate has no address or their send fails): admins minus the affiliate's own address (case-insensitive); one message, all admins in `to`; logged as `affiliate_commission_admin_copy`. Outcome `'sent'|'send_failed'|'no_recipients'`.
4. No deliverable affiliate address → `{sent:false, reason:'no_email', adminCopy}`.
5. Send to affiliate; log `affiliate_commission`. → `{sent:true, adminCopy}` / `{sent:false, reason:'send_failed', adminCopy}`.
6. Log rows: `{invoice_id, to_email, subject, success, error, message_id, order_id:null, sent_by: sentBy?.id ?? null, sent_by_email: sentBy?.email ?? null, kind}`.
7. Transport: `lib/email.ts sendAffiliateCommissionEmail(to, data, {adminCopy})` → `getResend()` — **a Resend-shaped shim over nodemailer SMTP** (`lib/smtp.ts`), not Resend. From `SMTP_FROM || SMTP_USER || EMAIL_FROM || 'VYTA <noreply@aminocan.com>'`.

**Manual email (`sendCommissionEmailManually(db, invoiceId, sentBy)`):** reads `commissions.select('affiliate_id, amount, order_total, status, discount_code_id, referral_code_id').eq('invoice_id', invoiceId)`; none → `no_commission`; cancelled → `cancelled`; code = `discount_codes.code` else `referral_codes.code`; then `notifyAffiliateOfCommission(…, sentBy)`. Built from the **booked row**, so it states exactly what was booked. Logged with the admin's id/email.

**Admin recipients (`getAdminAlertEmails`, shared by both emails):** `site_settings.admin_emails` (jsonb array) → env `ADMIN_ALERT_EMAILS` (comma list) → `site_settings.invoice_cc_emails`.

### 5.7 "Tracking" of both emails (send history)

| | Shipped email | Commission email |
|---|---|---|
| Log table | `fulfillment_email_log` | `fulfillment_email_log` |
| `kind` | `shipped` (customer send only; admin copy **not** logged) | `affiliate_commission` + `affiliate_commission_admin_copy` (both logged) |
| Auto vs manual | `sent_by` NULL on auto, admin/warehouse id on manual | `sent_by` NULL on auto, admin id on manual |
| Logged on failure | yes (`success:false`, `error`) | yes |
| Sent marker | `invoices.shipped_emailed_at` (+ claim `shipped_email_auto_claimed_at`) | none — the `commissions` row's existence + unique index |
| Dedupe | auto: once per invoice; manual: unlimited resends | auto: once per commission; manual: unlimited resends |
| Retry on failure | auto: claim released → next label event retries | none |
| UI | Emails-tab card "Sent {date}" / "Not sent"; Easyship panel "Shipped email" row; amber tab dot | flash after the button; no persistent status on the invoice page |
| Audit log | `fulfillment.email_sent.shipped` | `commission.email_sent` (manual only) |

### 5.8 Parcel tracking surfaces

- Shipped email: tracking number row (select-all + copy icon), carrier row (+ UPS logo), estimated delivery, **Track Your Order** button → carrier page (§4.5 table).
- Admin: summary-strip "Track shipment →", Easyship panel rows, `LiveShipmentTracking` (stages, checkpoints, map). Checkpoints arrive via webhook (`shipment.tracking.checkpoints.created`) into `orders/invoices.tracking_checkpoints`, or via live refresh (needs Easyship's tracking add-on).
- Public `/order/track?order=&email=` (`GET /api/orders?orderNumber=&email=`): **orders only**; email must match case-insensitively (same 404 otherwise: `No order found matching that order number and email.`); 6-step progress (Placed → Delivered) + tracking number box. It does **not** render `tracking_url`, carrier or checkpoints, and the shipped email does not link to it.

### 5.9 Other affiliate rules (port verbatim)

- **One affiliate = four rows under one UUID:** `auth.users`, `affiliates`, `customers (role 'affiliate', affiliate_id = self)`, `sales_persons (user_id)` + a `referral_codes` row. Both creation paths (admin create, request approve) provision all of them.
- Referral code format `/^[A-Z0-9]{4,20}$/`; write paths normalize `toUpperCase().replace(/[^A-Z0-9]/g, '')`; attribution lookup only trims + uppercases (exact). Suggestion `'AMC' + surname…+ '10'` (e.g. `AMCSMITH10`); random 8 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. Messages: `That code is already taken.` / `That is already your code.` / `That code is already spoken for.` / `Enter a code using letters and numbers.` / `Codes must be at least 4 characters.` / `Codes can be at most 20 characters.` / `Use letters and numbers only.`
- `assignReferralCode` **renames the existing row in place** (keeps `uses_count` and commission history; the old string stops working).
- `?ref=` capture: `middleware.ts` sets cookie `ref_code` (not httpOnly, `sameSite=lax`, path `/`, 30 days, ≤64 chars, **latest link wins**) and redirects to strip the param.
- Payout balance (`summarizeAffiliateBalance`): over non-cancelled commissions `revenue += order_total`, `earned += amount`, `paidUnrecorded += amount` when paid without payout; `paidOut = Σ payouts + paidUnrecorded`; `balance = earned − paidOut` (negative = overpaid). Payout create/void are two non-transactional statements.
- Audit actions: `affiliate.create/update/delete`, `affiliate_request.approve/deny`, `referral_code.update/approve/reject`, `affiliate_payout.create/void`, `commission.marked_paid`, `commission.backfilled`, `commission.email_sent`, `fulfillment.email_sent.shipped`, `invoice.buy_label/create_shipment/redo_shipment/easyship_override`.

### 5.10 Suggested build order for aminocan-cad

1. Migrations: shipment columns on `invoices`/`orders`, `shipped_emailed_at`, `shipped_email_auto_claimed_at`, `fulfillment_email_log` (no kind CHECK), commissions hosted-checkout columns + unique index, payouts / discount codes / referral-code requests, triggers.
2. Pure email modules (`order-confirmation-email` helpers → `fulfillment-email` → `affiliate-commission-email`) with their `node --test` files (`lib/*email*.test.ts`) and the image assets; swap brand constants (§7).
3. `getAdminAlertEmails`, SMTP transport, `sendFulfillmentEmail` + `notifyAffiliateOfCommission` (+ log writes).
4. `onShipmentLabelGenerated` + claim, then wire every caller in §5.2.
5. `recordAffiliateCommission` → `creditAffiliate` on your paid path → auto email.
6. API routes, then the invoice page rail (Shipping → Emails → Sales), then the affiliates pages.

---

## 6. Edge cases & states

**Invoice page**
- Loading: `flex justify-center py-20`, Loader2 `w-6 h-6 animate-spin text-ink-muted`. Not found: centred "Invoice not found" + "Back to Invoices" (`text-teal-dark`).
- No shipment / pickup: Shipping tab reads "Pickup"; no Print label; `LiveShipmentTracking` hidden; shipped email card hidden when `status === 'cancelled'` or pickup.
- `tracking` null → Easyship panel renders nothing.
- Live refresh failure → `refresh_error` shown in amber, not thrown.
- Redo with an uncancellable label → 409 → red box + "Replace anyway — old label not refunded".
- Label still generating after buy → state `pending`, message "Easyship is still generating the label PDF — refresh in a moment."
- Unauthorized: non-admins see no Edit / Send / Record / Delete / shipment buttons; `FulfillmentEmailCard canSend=false` hides the button; assistants can read the invoice but `/notify` 403s them.
- Errors and successes share the green flash strip (no separate error style).

**Shipped email**
- No tracking number → modal warns; email omits the tracking rows and the Track button (falls back to "View Order Details" when `viewOrderUrl`, else no CTA).
- Number typed without carrier and no stored URL → no Track button (needs both).
- Pickup invoice → never auto-sent.
- No deliverable customer address → `no recipient` (400).
- SMTP missing → logged failure `'SMTP not configured'`; auto-send claim released.
- No admin recipients configured → no copy; modal says so.
- Admin copy fails → customer send still counts; modal stays open with an amber warning.
- Redo/override after a send → `shipped_emailed_at` stays set → no auto re-send; UI tells the admin to resend.

**Commission email**
- Affiliate without a deliverable email → admins still get their copy; result `affiliate: 'no_email'`.
- Affiliate deleted → `no_affiliate` (422).
- Cancelled commission → button hidden; route returns 422.
- No commission yet → "No commission recorded — it is booked when the invoice is paid"; "Book commission" only for paid hosted-checkout invoices.
- 0% discount-code rate → a $0.00 commission row is inserted **and** the "You earned a $0.00 commission" email is sent.
- Backfill / Book commission → never email (use the button afterwards).

**Affiliates pages**
- Loading / empty / filtered-empty rows as in §4.2; `!leadsAvailable` banner; directory error banner.
- Detail: loading `py-24`; not found card; every action error → toast.
- Payouts/discount-code tables missing → amber migration banner; POST 503.
- Assistants: "View only"; no create/edit/delete/payout/code changes.

---

## 7. Open questions & unverified items

**Decide before porting (behaviour in the source that is probably not what you want):**
1. **"Tracking on both emails."** The commission email has **no parcel tracking** (it fires at payment, before a label exists). If you want the affiliate told when their referral ships, that's a new email or a second trigger in `onShipmentLabelGenerated` — not in the source. Both emails *are* send-tracked in `fulfillment_email_log` (§5.7).
2. **Commission email fails on order-backed invoices.** `sendCommissionEmailManually` looks up `commissions.invoice_id` only, while the invoice breakdown falls back to `commissions.order_id = invoice.order_id`. An order-backed invoice can show a commission and the button, then 422 "No commission is recorded for this invoice." Fix by applying the same fallback.
3. **Redo/override never re-sends the shipped email** — `shipped_emailed_at` / `shipped_email_auto_claimed_at` aren't cleared. Consider clearing them on redo so the new tracking number goes out automatically.
4. **Live refresh ignores the Settings API key** — `getEasyshipTracking` in the tracking route is called without `apiKey`, so only env `EASYSHIP_API_KEY` works there.
5. **Second, legacy shipping email** — `OrderManagementPanel`'s "Send Shipping Notification" posts to `/api/email` (`sendShippingNotification`, subject `Your Order Has Shipped - {orderNumber}`): no `shipped_emailed_at`, no admin copy, no log. It also reads `order.customer_email` while the column is `orders.email` (mapping not verified). Recommend dropping it in the port.
6. **The page's auto live-refresh can send customer email** as a side effect of an admin simply opening an invoice (admin + label generated + not yet emailed). Intentional catch-up in the source; decide if you want it.
7. **Assistants** can view invoices but can't preview/send the shipped email (`verifyWarehouse` allows admin/warehouse only).
8. **Detail page shows stored status**, not `effectiveStatus()` — a past-due `sent` invoice isn't shown as overdue there (the list page does).
9. **Mislabelled totals:** affiliates list "Earnings" and profile "Total earned" both show `affiliates.total_earnings` = **paid only** (trigger). Directory/insights "pending" sums include `cancelled`. The payouts panel's "Commission earned" is the true lifetime figure.
10. **`affiliates.commission_rate`** CHECK is 0..1 (fraction), but code tolerates percents; no UI edits it. `normalizeCommissionRate` is also applied when *reading* `commissions.commission_rate` (stored as percent), so a stored `1` (1%) would display as 100%.
11. **Currency:** amounts are CAD with no currency column on affiliate tables; the affiliate dashboard formats as **USD**; admin shows bare `$`.
12. **Admin copies put every admin in `to`** (not BCC), so admins see each other's addresses.
13. `autoBuyLabelForPaidInvoice` (`lib/shipping/auto-shipment.ts`) has **no callers** — auto-buy on payment isn't wired up.
14. Public `/order/track` covers orders only and doesn't render the carrier link; the shipped email links straight to the carrier.

**Hard-coded brand values to swap for aminocan-cad:**
- `SITE_URL = "https://www.vytabio.com"` (`lib/config.ts`, a constant, not env) — drives every email image URL and `dashboardUrl`.
- `EASYSHIP_WEBHOOK_URL = 'https://www.vytabio.com/api/webhooks/easyship'` (`lib/shipping/easyship-webhook.ts`).
- `SUPPORT_EMAIL = 'support@vytabio.com'` (`lib/order-confirmation-email.ts`).
- From defaults `'VYTA <orders@aminocan.com>'` (shipped) and `'VYTA <noreply@aminocan.com>'` (`lib/smtp.ts`) — set `SMTP_FROM`.
- Copy: "Your VYTA order … has shipped", "Thank you for choosing VYTA.", "Your VYTA referral code is now …", "VYTA Affiliate Application …", "Stealth Health" labels, `AMC` referral-code prefix, `VYTA-####` invoice numbers.
- Images: `shipped-hero.jpg`, `affiliate-hero.jpg`, `affiliate-network.png`, `vyta-mark.png`, `vyta-wordmark.png`.

**Environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `EMAIL_FROM`, `SMTP_SECURE` (shipped-email transport only; `lib/smtp.ts` infers secure from port 465), `ADMIN_ALERT_EMAILS`, `EASYSHIP_API_KEY`, `EASYSHIP_API_URL` (default `https://public-api.easyship.com/2024-09`), `EASYSHIP_LABEL_SIZE` (default `4x6`), `EASYSHIP_WEBHOOK_SECRET` (required; else 503), `EASYSHIP_ORIGIN_*`, `NEXT_PUBLIC_MAPBOX_TOKEN` (optional). No `RESEND_*` vars are used.

**Unverified / not read in depth:**
- No schema was pasted; §2 comes from migration files. `_live-schema-snapshot.sql` is stale for every shipment, commission, payout, discount-code and code-request column.
- No migration found for `invoices.processing_fee`, `show_processing_fee`, `with_labels`, or for allowing `fulfillment_status = 'dropped_off'` (only `pending, packed, shipped, picked_up` in the CHECK found). The live DB may have been altered by hand.
- `discount_codes.excluded_product_ids` type.
- Internals of `OrderManagementPanel` (skimmed), `PuramassInvoiceBlocks`, `LeadPanel`, `EmailComposer`, `CodeRestrictionsFields`, `/api/admin/confirmation-email`, `/api/admin/paid-alert-email`, `/api/admin/invoices/easyship-sync` (only its `onShipmentLabelGenerated` call), `/api/admin/commissions/report` HTML, `lib/invoice-html.ts` / `lib/invoice-pdf.ts`, and the affiliate portal's code/settings/apply/signup page markup.
- The full `puramass_orders` column list and `fetchPuramassContext` shape.
- How aminocan-cad's paid-order path differs (it may not use the hosted-checkout ledger that supplies `subtotal_cents`); the commission base and the `creditAffiliate` hook must be mapped onto whatever aminocan-cad marks as paid.
