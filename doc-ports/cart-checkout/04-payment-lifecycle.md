# 04 — Payment lifecycle (after the shopper leaves for the hosted payment page)

Scope: everything after `POST /api/checkout/puramass` returns `{ payment_link, ... }` and the browser does
`window.location.href = json.payment_link` (app/checkout/PuramassCheckoutContent.tsx:923).

Naming: the processor is called **Puramass / PuraMass** in code identifiers (`puramass_*` tables, `lib/payments/puramass*.ts`)
and **Stealth Health** in comments, log prefixes, admin UI and env-facing text. They are the same partner. The
partner API base URL is `https://api.stealth.health`. Webhook path is `/api/webhooks/stealth-health`.

Two independent order systems exist in this repo — keep them apart when porting:

| System | Table | Paid signal | Relevant to the Puramass port? |
|---|---|---|---|
| Hosted checkout (Puramass / Stealth Health) | `puramass_orders` (the "hand-off ledger") + a linked `invoices` row (`source = 'stealth_health'`) | webhook `store_order.payment_complete`, pg_cron poller, admin refresh/sync | **YES — this is the live checkout** |
| Legacy crypto storefront | `orders` | blockchain check (`/api/orders/check-payment`, `/api/cron/check-payments`) | No (legacy; documented only for completeness, §Routes) |

All server code in this section uses the **service-role** Supabase client: either `getSupabase()` from `lib/supabase.ts`
(`createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken:false, persistSession:false } })`)
or a module-scope `createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)`.
No anon-key client is used anywhere in the post-payment path. `puramass_orders` RLS policy is
`"Service role full access" FOR ALL USING (true) WITH CHECK (true)` (no role clause — see porting note 14).

---

## Lifecycle — order status state machine

### Tables and the status-bearing columns

**`puramass_orders`** (created by `puramass-hosted-checkout-migration.sql`, extended by many later migrations):

| Column | Type | Meaning / writer |
|---|---|---|
| `id` | uuid PK | |
| `partner_reference` | text NOT NULL UNIQUE | our id sent to the partner (idempotency key) |
| `transaction_id` | text | partner order id (`GET /partner/store/orders/{transaction_id}`) |
| `payment_link` | text | hosted payment URL |
| `status` | text NOT NULL DEFAULT `'payment_pending'` | **free text, no CHECK** — values seen: `payment_pending`, `paid`, `expired`, `cancelled` (copied verbatim from the partner) |
| `subtotal_cents` | int | |
| `customer_id` | uuid → customers ON DELETE SET NULL | |
| `customer_email` | text | the email typed at our checkout (never overwritten by partner) |
| `items` | jsonb NOT NULL DEFAULT '[]' | lines sent at hand-off: `{ sku, quantity, unit_price_cents, product_id, pack_size, list_unit_price_cents }` |
| `referral_code` | text | |
| `paid_at` | timestamptz | set when status → paid |
| `currency` | text | lower-case, e.g. `'cad'` |
| `last_event_id` | text | last processed webhook `event_id` (dedupe) |
| `invoice_id` | uuid (no FK) | linked `invoices.id` |
| `created_at`, `updated_at` | timestamptz | `updated_at` maintained by trigger `puramass_orders_updated_at` |
| `shipping_address` jsonb, `customer_name`, `customer_phone` | | puramass-shipping-address-migration.sql |
| `shipping_address_source` (`'puramass'`/`'customer'`), `shipping_address_updated_at`, `address_requested_at` | | puramass-missing-address-migration.sql |
| `expires_at`, `refunded_total_cents`, `refunds` jsonb, `paid_items` jsonb | | puramass-order-details-migration.sql |
| `shipping_total_cents`, `shipping_courier`, `shipping_courier_id` | | puramass-hosted-shipping-migration.sql |
| `recovery_email_sent_at`, `recovery_email_count` int NOT NULL DEFAULT 0, `recovery_promo_code`, `recovery_discount_type` (`'percentage'`/`'fixed'`), `recovery_discount_value` numeric(10,2) | | abandoned-checkout-recovery-migration.sql |
| `confirmation_email_sent_at` | timestamptz | order-confirmation-email-migration.sql — customer email claim |
| `admin_paid_alert_sent_at` | timestamptz | stealth-health-admin-paid-alert-migration.sql — admin email claim |
| `attribution_channel`, `attribution_campaign`, `attribution` jsonb | | marketing-attribution-migration.sql |
| `discount_code_id`, `discount_code`, `discount_code_percent`, `discount_code_cents`, `ad_discount_percent`, `ad_discount_cents`, `cart_offer_percent`, `cart_offer_min_items`, `landing_page` | | written at hand-off (see checkout section); read post-payment for commission + email discount label |
| `settlement_invoice_id` uuid → stealth_health_invoices, `settlement_excluded` bool NOT NULL DEFAULT false | | stealth-health-settlement-migration.sql |

**`invoices`** (the fulfillment record behind a Stealth Health order, `source = 'stealth_health'`):
- `status` CHECK ∈ `draft, sent, partial, paid, overdue, cancelled, pending_payment, expired` (stock-ledger-migration.sql).
  Stealth Health invoices only ever use `pending_payment`, `expired`, `paid` automatically (admins can set others manually).
- `fulfillment_status` text NOT NULL DEFAULT `'pending'`; warehouse moves it to `packed`, `shipped`, `picked_up`, `dropped_off` (lib/warehouse/server.ts).
- `stock_adjusted boolean NOT NULL DEFAULT false` — stock idempotency flag.
- `invoice_number` default `'VYTA-' || nextval('invoice_number_seq')`.

**`orders`** (legacy crypto): `pending → received → confirmed`, `pending → expired`; tracker UI also knows `processing, shipped, delivered, cancelled`.

### Diagram — `puramass_orders.status`

```
                       (hand-off insert by POST /api/checkout/puramass:
                        status = partnerOrder.status || 'payment_pending')
                                        |
                                        v
                              +-------------------+
                              |  payment_pending  |
                              +-------------------+
          remote 'paid'        |       |        |   remote 'cancelled'
   (webhook / poll / sync /    |       |        +-----------------------------+
    admin refresh)             |       |  created_at < now-7d-6h              |
                               |       |  (poll cron expiry sweep)            |
                               v       |  or remote 'expired'                 v
                          +--------+   |                               +-----------+
                          |  paid  |   +--------------> +---------+    | cancelled |
                          +--------+                    | expired |    +-----------+
                               ^                        +---------+
                               |  remote 'paid' on an expired row:          |
                               +--- ONLY webhook or admin refresh ----------+
                                    (poll + sync treat expired/cancelled/paid as terminal)
```

Terminal set used by poll + sync (`PURAMASS_TERMINAL_STATUSES` in lib/payments/puramass-poll.ts): `['paid', 'expired', 'cancelled']`.
The **webhook and the admin refresh do NOT honour terminal states** — they write whatever `status` the partner reports
(see Unverified/porting notes).

### Diagram — linked `invoices` row (source = 'stealth_health')

```
 hand-off (createPendingStealthHealthInvoice) ──> pending_payment ──(markInvoicePaid)──> paid
                                                       │                                ^
          sweep / remote expired|cancelled             │                                │
          (expireStealthHealthInvoices: only           v                                │
           WHERE status='pending_payment')          expired ────(markInvoicePaid)───────┘
                                                                (late payment in grace window)

 no invoice at paid time (legacy hand-off / invoice deleted) ──> createPaidInvoice ──> paid (inserted directly)
 admin PATCH /api/admin/invoices/[id] {status:'cancelled'} on a stocked invoice ──> restore_stock_for_invoice
```

### Who sets each transition (exhaustive)

| Transition | Who | Guard |
|---|---|---|
| insert `payment_pending` (or partner-returned status) | `POST /api/checkout/puramass` | `partner_reference` UNIQUE |
| `payment_pending → paid/expired/cancelled/<any>` | webhook `POST /api/webhooks/stealth-health` | only `last_event_id !== event_id`; **no status guard** |
| `payment_pending → <remote status>` | `applyPuramassStatus` (poll cron, admin sync) | skip if local status ∈ terminal, remote empty, or equal; conditional update `.eq('status', order.status)` |
| `payment_pending → expired` (time) | poll cron step 1 | `.eq('status','payment_pending').lt('created_at', now − 7d − 6h)` |
| `<any> → <remote status>` | admin refresh `POST /api/admin/puramass/orders/refresh` | none (update by `transaction_id`) |
| invoice `pending_payment|expired → paid` | `markInvoicePaid` inside `materializeStealthHealthFulfillment` | `.in('status', ['pending_payment','expired'])`; returns true only for the call that changed the row (`firstPaid`) |
| invoice `pending_payment → expired` | `expireStealthHealthInvoices` (poll sweep; webhook & poll on remote `expired`/`cancelled`) | `.eq('status','pending_payment')` |
| invoice `→ paid` manually | admin `PATCH /api/admin/invoices/[id]` or `POST /api/admin/invoices/[id]/payments` (full payment) | `!wasPaid`; **does not** change `puramass_orders.status` |

`paid_at` is set: webhook → `data.occurred_at ?? payload.created_at ?? now`; poll/sync → `remote.paid_at ?? now`; refresh → `status.paid_at ?? now`.

---

## Lifecycle — payment confirmation paths

There are four paths that observe a payment for a hosted order, plus the admin manual mark-paid. All paid paths
converge on `materializeStealthHealthFulfillment(db, ledger, paidItems)` (lib/payments/puramass-fulfillment.ts), which is
idempotent and re-runnable.

### Partner API used by polling paths

`fetchPuramassOrderStatus(transactionId)` — `GET {PURAMASS_API_BASE_URL || 'https://api.stealth.health'}/partner/store/orders/{encodeURIComponent(transactionId)}`
headers `X-Partner-ID: PURAMASS_PARTNER_ID || 'ptr_puramass'`, `X-Api-Key: PURAMASS_API_KEY`, `cache: 'no-store'`, 20 000 ms timeout (AbortController).
Errors → `PuramassApiError(status, detail)`: no key → 503 `'Stealth Health is not configured'`; timeout → 504 `'Stealth Health request timed out'`;
network → 502 `'Could not reach Stealth Health'`; non-2xx → `(res.status, body.error ?? body.message ?? body.detail ?? JSON(errors) (≤300 chars) ?? 'Stealth Health API error <status>')`.
Response envelope: `json.order ?? json`. Normalized to:

```ts
interface PuramassOrderStatus {
  transaction_id: string; status: string /* '' if absent */; partner_reference: string|null;
  currency: string|null; subtotal_cents: number|null; payment_link: string|null;
  created_at: string|null; paid_at: string|null; expires_at: string|null;
  items: { sku?, name?, quantity?, unit_price_cents? }[];
  refunded_total_cents: number|null; refunds: unknown[];
  shipping: { address, address2, city, state, zip, country } | null;   // normalizePuramassShipping(order.shipping ?? order.shipping_address)
  customer: { name, email, phone };                                     // normalizePuramassContact(order.customer)
}
```
`normalizePuramassShipping` accepts aliases `address|address1|line1`, `address2|line2`, `state|province|region`, `zip|postal_code|postcode`; all-blank → null.
`normalizePuramassContact`: `name` = `r.name` else `first_name + ' ' + last_name`.

### Shared patch builders (lib/payments/puramass.ts)

`buildPuramassContactPatch(row, { shipping, customer })` — additive:
- writes `shipping_address` (+ `shipping_address_source:'puramass'`, `shipping_address_updated_at: now`) only if the incoming normalized address is non-null, differs (JSON compare) from the stored normalized address, AND the row is NOT customer-owned (`shipping_address_source === 'customer' && shipping_address` → never overwritten).
- `customer_name` / `customer_phone` written when non-empty and different.
- `customer_email` only filled when the row has none.

`buildPuramassOrderDetailPatch({ expires_at, refunded_total_cents, refunds, items })`:
`expires_at` if non-empty string; `refunded_total_cents` if number; `refunds` if array; `paid_items` = items that have `unit_price_cents` or `name` (if ≥1).

Missing-column tolerance (lib/payments/puramass-columns.ts): `isMissingColumnError(err)` = code `42703` or `PGRST204`, or message matches `/\bcolumn\b/i && /does not exist/i` or `/in the schema cache/i`. `stripUnmigratedFields(patch)` drops every key in `PURAMASS_OPTIONAL_COLUMNS` (address, order-detail, shipping and recovery column groups listed in that file). Every write path retries once with the stripped patch.

### Path A — Webhook `POST /api/webhooks/stealth-health` (push)

File: app/api/webhooks/stealth-health/route.ts. `export const runtime = 'nodejs'`. Public; HMAC is the auth.

1. `raw = await req.text()`.
2. `handle()`:
   1. If `PURAMASS_WEBHOOK_SECRET` unset → outcome `not_configured`, **500** `{ "error": "webhook not configured" }` (console: `[stealth-health] PURAMASS_WEBHOOK_SECRET not set — rejecting`).
   2. Verify header `x-stealth-signature`: value `sha256=<hex>` (prefix optional). Expected = `HMAC_SHA256(PURAMASS_WEBHOOK_SECRET, rawBody utf8).hex`; length-guarded `timingSafeEqual` on the hex strings. Fail → `bad_signature`, **401** `{ "error": "bad signature" }`.
   3. `JSON.parse(raw)` fails → `unparseable`, **200** `{ "received": true, "matched": false }`.
   4. Extract: `eventId = payload.event_id`, `partnerReference = payload.partner_reference`, `data = payload.data ?? {}`,
      `orderBody = data.order ?? payload.order ?? data`, `transactionId = data.transaction_id ?? data.order_id`,
      `status = data.status`, `currency = data.currency`, `occurredAt = data.occurred_at ?? payload.created_at`.
   5. Match ledger row: by `transaction_id`, then by `partner_reference`. Select ladder (first that does not raise a missing-column error):
      - `id, status, last_event_id, transaction_id, customer_id, customer_email, items, subtotal_cents, invoice_id, referral_code, currency, shipping_total_cents, shipping_courier_id, shipping_address, shipping_address_source, customer_name, customer_phone`
      - same minus `shipping_total_cents, shipping_courier_id`
      - base only (`id … currency`).
   6. No row → `unmatched`, **200** `{ "received": true, "matched": false }`.
   7. `eventId && row.last_event_id === eventId` → `deduped`, **200** `{ "received": true, "deduped": true }`.
   8. Build `update`: `status`, `last_event_id`, `currency`, `paid_at` (if status==='paid'), `transaction_id` (if matched by reference and row had none), + contact patch (from `orderBody.shipping/customer`) + detail patch (from `orderBody.expires_at/refunded_total_cents/refunds/items`).
   9. `UPDATE puramass_orders SET … WHERE id = row.id`; on missing-column error retry with `stripUnmigratedFields`. Any other error → `update_failed`, **500** `{ "error": "update failed" }` (partner retries).
   10. If `status === 'paid'`: `attributeHostedPurchase(db, { id, customer_email, attribution_channel: row.attribution_channel ?? null })` then `materializeStealthHealthFulfillment(db, {id, customer_id, customer_email, customer_name, items, subtotal_cents, invoice_id, referral_code}, orderBody.items ?? [])`. Runs on **every** paid delivery (idempotent).
   11. If `status === 'expired' || 'cancelled'`: `expireStealthHealthInvoices(db, [row.invoice_id])`.
   12. → `matched`, **200** `{ "received": true, "matched": true }`.
3. Any throw → `error`, **500** `{ "error": "internal error" }`.
4. **Every** delivery (any outcome) is logged via `logWebhookEvent` → INSERT `puramass_webhook_events` (best-effort, never changes the response).

Sample authentic payload (from lib/payments/puramass-webhook-log.test.ts):
```json
{ "event_id":"evt_b275e85d6d491024c589b486", "event_type":"store_order.payment_complete", "referral_id":null,
  "partner_reference":"amc_f71956b5-09c6-435c-99d5-2b1793fe3a75",
  "data":{ "status":"paid", "product_category":null, "occurred_at":"2026-09-24T04:38:42.083Z",
    "transaction_id":"7ylSVLdOqhvvc9BRZPt9", "order_id":"7ylSVLdOqhvvc9BRZPt9", "payment_mode":"customer", "currency":"cad",
    "customer":{"first_name":"Test","last_name":"Buyer","email":"buyer@example.com","phone":null},
    "shipping":{"address":"6 Milepost Place","address2":"206","city":"Toronto","state":"ON","zip":"M4H 1C9","country":"CA"},
    "items":[{"sku":"aminocan-retatrutide-10mg-vial","name":"Retatrutide 10mg","quantity":2,"unit_price_cents":15000}] },
  "metadata":{}, "created_at":"2026-09-24T04:38:42.083Z", "patient_id":null, "appointment_id":null }
```
Note: `customer`/`shipping`/`items` sit directly under `data` (the `orderBody = data` fallback); `occurred_at` is under `data`.

`puramass_webhook_events` row (`buildWebhookEventRow`, puramass-webhook-events-migration.sql):
`event_id, event_type, partner_reference` (top level); `transaction_id = data.transaction_id ?? data.order_id`; `status, currency` from `data`;
`customer_email = (data.order ?? payload.order ?? data).customer.email`; `occurred_at = valid-date(data.occurred_at) ?? valid-date(payload.created_at)`;
`signature_valid`; `payload` (parsed object or null); `raw_body` = raw (≤ 64×1024 chars) **only when nothing parsed**; `puramass_order_id`; `outcome`
∈ `matched|unmatched|deduped|bad_signature|not_configured|unparseable|update_failed|error`; `response_status`; `response_body`; `error`.
Table also has `id BIGSERIAL`, `received_at DEFAULT now()`; FK `puramass_order_id → puramass_orders ON DELETE SET NULL`; RLS enabled with no policy (service role only). Note: payload is not passed to the logger for `bad_signature` (ctx.payload unset) so `raw_body` holds the raw text.

### Path B — Poll cron `GET /api/cron/puramass-poll` (pull fallback)

File: app/api/cron/puramass-poll/route.ts. Constants: `SEVEN_DAYS_MS = 7*24*3600*1000`, `GRACE_MS = 6*3600*1000`, `CONCURRENCY = 8`, `MAX_PER_RUN = 200`.

1. Auth: `cronSecret = PURAMASS_CRON_SECRET || CRON_SECRET`; provided = `x-cron-key` header || `?key=` query || `Authorization: Bearer …`. Missing secret or mismatch → **401** `{ "error": "Unauthorized" }` (fails closed).
2. `!isPuramassConfigured()` (needs `PURAMASS_API_KEY` and partner id) → **200** `{ "skipped": "not_configured" }`.
3. `windowStart = now − 7d − 6h`.
4. **Expiry sweep**: `UPDATE puramass_orders SET status='expired' WHERE status='payment_pending' AND created_at < windowStart RETURNING id, invoice_id`; then `expireStealthHealthInvoices(those invoice_ids)`.
5. **Self-heal**: `healStealthHealthPaidOrders(db)` (defaults `days=14`, `limit=50`) — runs before polling so a 429 can't skip it:
   - Read `puramass_orders` `status='paid' AND invoice_id NOT NULL AND created_at >= now−14d` ORDER BY created_at DESC LIMIT 200; read their invoices; for those whose invoice status ∈ `pending_payment|expired` (first 50) re-run `materializeStealthHealthFulfillment(..., null)`. Rows with no invoice or a deleted invoice are deliberately skipped.
   - `invoices WHERE source='stealth_health' AND status='paid' AND stock_adjusted=false AND created_at >= since LIMIT 50` → `takeStealthHealthStock`.
6. **Poll set**: `puramass_orders WHERE status='payment_pending' AND created_at >= windowStart AND transaction_id IS NOT NULL ORDER BY created_at ASC LIMIT 200`, select ladder:
   full (`id, status, transaction_id, customer_id, customer_email, customer_name, customer_phone, items, subtotal_cents, invoice_id, referral_code, currency, shipping_total_cents, shipping_courier_id, shipping_address, shipping_address_source, created_at`) → minus shipping cols → minimal. Other error → **500** `{ "error": <message> }`.
7. Chunks of 8 in parallel: `fetchPuramassOrderStatus` → `applyPuramassStatus`. A `PuramassApiError` with status 429 sets `rateLimited` and stops further chunks.
8. **200** response:
```json
{ "polled": n, "paid": n, "expired": n, "cancelled": n, "errors": n, "rate_limited": bool,
  "pending_total": n, "healed_invoices": n, "healed_stock": n }
```
(`expired` = swept + polled-to-expired.)

`applyPuramassStatus(db, order, remote)` (lib/payments/puramass-poll.ts) → `{ changed, status, materialized, contactUpdated }`:
- Build contact + detail patches.
- **No-op path** (local status terminal, or remote status empty, or equal): if patches non-empty, `UPDATE … WHERE id` (retry stripped; errors ignored). Returns `changed:false`. This is how an address/refund gets back-filled onto a paid order.
- **Flip path**: `update = {...contact, ...detail, status: remote.status, currency?, subtotal_cents?, paid_at? }` then
  `UPDATE puramass_orders SET … WHERE id = order.id AND status = order.status RETURNING id` (`maybeSingle`); retry stripped on missing column. Error or no row returned → lost the race → `changed:false`, **no side-effects**.
- On `paid`: `attributeHostedPurchase(db, {id, customer_email})` then `materializeStealthHealthFulfillment(db, {..., subtotal_cents: remote.subtotal_cents ?? order.subtotal_cents}, remote.items)`; `materialized = res.created`.
- On `expired`/`cancelled`: `expireStealthHealthInvoices(db, [order.invoice_id])`.

### Path C — Admin bulk sync `POST /api/admin/puramass/orders/sync`

Admin/assistant (Bearer Supabase JWT; `customers.role ∈ {admin, assistant}`) else **403** `{ "error": "Unauthorized" }`. Not configured → **503** `{ "error": "Stealth Health is not configured." }`.
Body (all optional, empty body allowed): `{ ids?: string[], statuses?: string[], limit?: number }`; `limit = min(250, max(1, limit||250))`.
Query: `transaction_id NOT NULL`, ORDER BY created_at DESC, `ids` (precedence) or `statuses` filter. Select `LEDGER_SELECT` → legacy fallback. Query error → **500** `{ "error": "Could not load orders: <msg>" }`.
Concurrency 6; same `applyPuramassStatus` (so terminal rows only get contact/detail patches); stops on 429.
Response **200** `{ total, polled, changed, paid, addresses, errors, rate_limited }` (`addresses` = rows with `contactUpdated`). Empty set returns all zeros.

### Path D — Admin per-row refresh `POST /api/admin/puramass/orders/refresh`

Admin/assistant else **403** `{ "error": "Unauthorized" }`; not configured **503** `{ "error": "Stealth Health is not configured." }`; bad JSON **400** `{ "error": "Invalid JSON" }`; missing **400** `{ "error": "transaction_id is required." }`.
Body `{ transaction_id: string }`.
1. `fetchPuramassOrderStatus` — `PuramassApiError` 4xx → `{ error: err.detail }` with that status; otherwise **502** `{ "error": "Could not reach Stealth Health." }`.
2. Read existing `shipping_address, shipping_address_source, customer_name, customer_phone, customer_email` by `transaction_id`.
3. `update` = `status`, `currency`, `subtotal_cents`, `paid_at` (if paid) + contact patch + detail patch. **No status guard.**
4. `UPDATE … WHERE transaction_id = $1 RETURNING id, status, paid_at, currency, subtotal_cents, shipping_total_cents, shipping_courier_id, customer_id, customer_email, customer_name, customer_phone, shipping_address, shipping_address_source, items, invoice_id, referral_code` with 2 fallbacks (drop shipping cols; then strip patch + minimal select). Error → **500** `{ "error": "Could not update the order: <msg>" }`; no row → **404** `{ "error": "No matching order found." }`.
5. If remote `paid` → `materializeStealthHealthFulfillment(db, row, status.items)` (**no** `attributeHostedPurchase`, **no** invoice expiry on expired/cancelled).
6. **200** `{ "success": true, "status": <remote status>, "order": <row> }`.

### Path E — Admin marks the linked invoice paid (manual)

`PATCH /api/admin/invoices/[id]` with `status:'paid'` (first transition) or `POST /api/admin/invoices/[id]/payments` that brings `totalPaid >= total − 0.001`:
`adjustInvoiceStock(db, id, actor_email)` (+ low-stock check), then `after(() => sendConfirmationForPaidInvoice(db, id))` and `after(() => sendStealthHealthPaidAlertForInvoice(db, id))` (`paidVia:'admin'`, `transition:true`).
It does **not** set `puramass_orders.status/paid_at`, does not credit the affiliate, does not send Klaviyo, does not book the Easyship shipment (unless the PATCH body sets `create_easyship_shipment`).

### `materializeStealthHealthFulfillment(db, ledger, paidItems)` — the convergence point

Signature: `(db: SupabaseClient, ledger: { id; customer_id?; customer_email?; customer_name?; items?; subtotal_cents?; invoice_id?; referral_code? }, paidItems: {sku?,name?,quantity?,unit_price_cents?}[] | null) => Promise<{ created: boolean; invoiceId?: string }>`. Never throws.

Steps, in order:
1. `stored = SELECT * FROM puramass_orders WHERE id` (tolerates unmigrated columns).
2. `invoiceId = ledger.invoice_id ?? stored.invoice_id`. If set, read `invoices(id,status)`; a deleted invoice → treated as none.
3. **No invoice** → `createPaidInvoice` (inserted already `status:'paid'`), `firstPaid = true`. Lines:
   - from `ledger.items` when every line has `product_id` and `pack_size ≥ 1`: `description = "<product name> — Pack of N"` or `"<name> — Single vial"`, `qty`, `unit_price = unit_price_cents/100`, `price_type = pack>1 ? 'box':'vial'`, `vials_per_unit = pack`;
   - else from `paidItems` (or ledger sku/qty): `price_type` from SKU suffix (`-vial` → vial) or name ending `(Single Vial)`; only vial SKUs are mapped to a product via `products.puramass_sku_vial`; `vials_per_unit = 1`.
   Header: `source:'stealth_health', customer_id, customer_email, customer_name, fulfillment_type:'shipment', fulfillment_status:'pending', status:'paid', currency:'CAD', subtotal = subtotal_cents/100 (else line sum), tax_total:0, shipping_cost = shipping_total_cents/100 (else 35), total, is_backorder:false, non_payable:false, notes:'Placed via the Stealth Health checkout. Payment and taxes are handled by Stealth Health.', issue_date: todayInAppTz()`, plus `easyship_courier_id = stored.shipping_courier_id` (dropped on missing column). Then link `puramass_orders.invoice_id` `WHERE invoice_id IS NULL`.
4. **Invoice in `pending_payment|expired`** → `markInvoicePaid`: `UPDATE invoices SET status='paid', customer_email?, customer_name? WHERE id AND status IN ('pending_payment','expired') RETURNING id` → `firstPaid = rows>0`.
5. `takeStealthHealthStock(db, invoiceId)` — **every pass** (see side-effects).
6. If `firstPaid`: `onFirstPaid` → Klaviyo `trackPlacedOrder`.
7. `creditAffiliate` — every pass (idempotent).
8. `bookShipment` — every pass (no-op once invoice has `easyship_shipment_id`).
9. `sendConfirmation` → `sendStealthHealthOrderConfirmationOnce` — every pass (claimed once).
10. `sendAdminAlert` → `sendStealthHealthPaidAlertOnce(db, ledgerId, { transition: firstPaid, paidVia: 'checkout' })` — every pass (claimed once).
Returns `{ created: firstPaid, invoiceId }`.

### Idempotency guards summary

| Effect | Guard |
|---|---|
| Webhook redelivery | `puramass_orders.last_event_id === event_id` |
| Poll/sync status flip | conditional `UPDATE … WHERE status = <old>`; terminal statuses skipped |
| Invoice → paid | `UPDATE … WHERE status IN ('pending_payment','expired')` returns rows |
| Invoice creation on paid | link `UPDATE puramass_orders SET invoice_id WHERE invoice_id IS NULL` (two racing creators could each insert an invoice — see notes) |
| Stock | `adjust_stock_for_invoice` locks `invoices` row `FOR UPDATE` and returns if `stock_adjusted IS DISTINCT FROM false` |
| Klaviyo Placed Order | only when `firstPaid`; Klaviyo `unique_id = invoiceId` (`<invoiceId>:<idx>` for Ordered Product) |
| Affiliate commission | pre-check `commissions.invoice_id`; partial UNIQUE index `idx_commissions_invoice_unique`; `23505` treated as already-recorded |
| Customer confirmation email | claim `puramass_orders.confirmation_email_sent_at NULL → now()`; released on send failure |
| Admin paid alert | claim `puramass_orders.admin_paid_alert_sent_at NULL → now()`; released on send failure |
| Easyship shipment | skipped when invoice `easyship_shipment_id` already set |
| Attribution | `visitor_attribution.purchased_at` only set where null; `puramass_orders.attribution_channel` only where null |

---

## Lifecycle — post-paid side-effects

### 1. Stock decrement

`takeStealthHealthStock(db, invoiceId): Promise<{ taken: boolean; unlinked: string[] }>` (puramass-fulfillment.ts):
1. `SELECT status, stock_adjusted FROM invoices WHERE id`. Not found or `status !== 'paid'` → `{taken:false}`.
2. If `stock_adjusted !== true` → `adjustInvoiceStock(db, invoiceId, 'stealth-health')` (lib/admin/stock-ledger.ts):
   `db.rpc('adjust_stock_for_invoice', { p_invoice_id, p_actor_email: 'stealth-health' })`; if the RPC is missing (`PGRST202`/`42883`/message `could not find the function|function .* does not exist`) retry `rpc('adjust_stock_for_invoice', { p_invoice_id })`.
3. Reads lines; lines with `product_id IS NULL` are logged (`[stealth-health] invoice %s has lines with no product — no stock taken for: …`) and returned as `unlinked` (`"<description> × <qty>"`). They surface in Stock Ledger → Needs attention (`take_stock_for_invoice_lines` RPC links them later).
4. If taken: `checkLowStockForProducts(db, productIds)` (lib/admin/low-stock.ts — sets `products.low_stock_alerted=true` then emails admin list when `stock_quantity <= low_stock_threshold ?? 10`; resets when recovered).

Current RPC body (stock-ledger-migration.sql — supersedes stock-decrement-migration.sql / product-history-migration.sql / stealth-health-pending-invoice-migration.sql versions; all define the same 2-arg signature):

```sql
CREATE OR REPLACE FUNCTION adjust_stock_for_invoice(p_invoice_id uuid, p_actor_email text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_already boolean;
BEGIN
  SELECT stock_adjusted INTO v_already FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_already IS DISTINCT FROM false THEN RETURN; END IF;   -- not found, or already adjusted
  WITH agg AS (
    SELECT product_id, SUM(qty * COALESCE(vials_per_unit, 1))::int AS qty
    FROM invoice_line_items WHERE invoice_id = p_invoice_id AND product_id IS NOT NULL GROUP BY product_id
  ), before AS (
    SELECT p.id, COALESCE(p.stock_quantity, 0) AS old_qty, agg.qty FROM products p JOIN agg ON p.id = agg.product_id
  ), upd AS (
    UPDATE products p SET stock_quantity = GREATEST(0, b.old_qty - b.qty) FROM before b WHERE p.id = b.id RETURNING p.id
  )
  INSERT INTO product_history (product_id, change_type, field, old_value, new_value, source, reference_type, reference_id, note, actor_email)
  SELECT b.id, 'stock', 'stock_quantity', b.old_qty::text, GREATEST(0, b.old_qty - b.qty)::text,
         'invoice_paid', 'invoice', p_invoice_id::text,
         'Stock decremented by ' || b.qty || ' when invoice was marked paid', p_actor_email
  FROM before b;
  UPDATE invoices SET stock_adjusted = true WHERE id = p_invoice_id;
END; $$;
```
Key facts: stock unit is **vials**; a pack line takes `qty × vials_per_unit`; floor at 0; one `product_history` row per product; the flag is set even when no line has a product.
Inverse `restore_stock_for_invoice(p_invoice_id, p_actor_email)`: `UPDATE invoices SET stock_adjusted=false WHERE id AND stock_adjusted=true` (returns if not found), adds the same vial sums back, history `source 'invoice_cancel'`, note `'Stock restored (+' || qty || ') when invoice was cancelled'`. Called only by admin `PATCH /api/admin/invoices/[id]` on transition to `cancelled`. **Refunds/cancellations reported by the partner never restore stock.**

Legacy crypto `orders`: `adjustStockForConfirmedOrder(db, orderId, actorEmail=null)` (lib/order-stock.ts) → short-circuit on `orders.stock_adjusted`, then `rpc('adjust_stock_for_order', { p_order_id, p_actor_email })`. Current definition (case-vial-stock-decrement-migration.sql) reads `orders.items` JSONB: per element with uuid `id`, qty = `quantity × (unit='case' ? GREATEST(1, vials_per_box) : 1)`; floor at 0; history `source 'order_confirmed'`, note `'Stock decremented by N vials when order was confirmed'`; sets `orders.stock_adjusted = true`. (order-stock-decrement-jsonb-migration.sql and product-history-migration.sql hold older versions; product-history's reads `order_items` instead.)

### 2. Customer confirmation email (Stealth Health)

`sendStealthHealthOrderConfirmationOnce(db, puramassOrderId): Promise<ConfirmationOutcome>` (lib/order-confirmation.ts). `ConfirmationOutcome = {sent:true} | {sent:false, reason:'not_found'|'not_eligible'|'already_sent'|'no_email'|'not_migrated'|'send_failed'|'error'}`.
1. Load `puramass_orders.*`; if `invoice_id`: `invoices.*` and `invoice_line_items.*`. `paid = invoice exists && (ledger.status==='paid' || invoice.status==='paid')`. Customer row = `customers.*` by `invoice.customer_id ?? ledger.customer_id`.
2. Not paid / no invoice → `not_eligible`. Column `confirmation_email_sent_at` absent from row → `not_migrated` (console warning). Already set → `already_sent`. No deliverable address → `no_email`.
3. **Claim**: `UPDATE puramass_orders SET confirmation_email_sent_at = now() WHERE id AND confirmation_email_sent_at IS NULL RETURNING id`. No row → `already_sent`.
4. `deliver` → `enrichForEmail` (product images: `products.image_url` → absolute `SITE_URL + encodeURI(path)`; `viewOrderUrl` via `buildViewOrderUrl`) → `sendOrderConfirmation(data)`.
5. Log every attempt: INSERT `fulfillment_email_log { order_id:null, invoice_id, to_email, subject, message_id, success, error, sent_by:null, sent_by_email:null, kind:'order_confirmation' }`.
6. Failure → release claim (`SET confirmation_email_sent_at = NULL`) → `send_failed` (retried next pass).

Payload `stealthHealthOrderSummary(ledger, invoice, lines, customer)` (lib/order-confirmation-data.ts):
- `to` = first deliverable of `[customer.email, invoice.customer_email, ledger.customer_email]`; deliverable = matches `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` and does not end in `.local|.invalid|.test|.example`.
- `customerName` = `ledger.customer_name || invoice.customer_name || 'there'`.
- `orderNumber` = `invoice.invoice_number || ledger.partner_reference || ledger.id`.
- items from invoice lines; description `"Name — Pack of N"` / `"Name — Single vial"` split into name + `unit` (`case`/`vial`) + `vialsPerBox`.
- `shipping = invoice.shipping_cost`, `tax = invoice.tax_total`, `total = invoice.total`.
- If every line has a list price in `ledger.items[].list_unit_price_cents` (matched by `product_id|pack_size`) and list sum − charged subtotal ≥ 0.01 → lines shown at list price, `subtotal = listSum`, `discount = difference`, `discountLabel = discountLabelFor(ledger)` = join(' + ') of `discount_code` (if `discount_code_percent>0`), `"<ad_discount_percent>% first-order discount"`, `"<cart_offer_percent>% limited-time offer"`.
- `orderDate = invoice.paid_at || ledger.paid_at || invoice.created_at`; `paymentStatus = 'Paid'`; `currency` = invoice/ledger currency upper-case, default `'CAD'`.
- `shipTo` from `ledger.shipping_address` (country `CA` → `Canada`, `US` → `United States`).
- `accountOrderId = invoice.id`.

Sender: `sendOrderConfirmation` (lib/email.ts) → `sendMail({ from: defaultFrom(), to, subject, html, text })` via nodemailer SMTP (lib/smtp.ts). `defaultFrom() = SMTP_FROM || SMTP_USER || EMAIL_FROM || 'VYTA <noreply@aminocan.com>'`.

Template (lib/order-confirmation-email.ts), verbatim strings:
- Subject: `` `Order Confirmed - ${orderNumber}` ``
- `<title>` = subject; preheader: `` `Your payment has been received — order ${orderNumber}.` ``
- Eyebrow: `Order confirmed`; H1: `Thank you<br>for <span style="color: #0E68AE;">your order.</span>`
- Intro: `` `Hi ${customerName}, your payment has been received and your order is being processed. We’ll send you another email with tracking information once your order ships.` ``
- Header strip cells: `Order Number`, `Order Date` (formatted `en-US` long date in `America/New_York`, e.g. "October 4, 2026"), `Payment Status` (`paymentStatus || 'Paid'`).
- Items section heading `Your Order`; columns `Product`, `Qty`, `Unit price`, `Total`; sub-line `Pack of N` (default 10 if unknown) / `Single vial` · strength.
- `Order Summary`: `Subtotal`, `Discount (<label>)` as `-$x` in green `#047857`, `Shipping` (`Free` when 0), `Tax`, `Total` `$x.xx CUR`. Right column `Shipping Address` with name/lines/phone.
- `What Happens Next?`: `1. Order Processing` / `We’re preparing your order.`; `2. Order Ships` / `You’ll receive a tracking email once it ships.`; `3. Delivery` / `Your order will be on its way to you soon.`
- `Need Help?`: `If you have any questions about your order, reply to this email or contact us at support@vytabio.com. We’re happy to help.` + button `View Order Details` → `viewOrderUrl`, under it `Sign in or create an account to view it.`
- Footer badges `Third-party<br>lab tested`, `High purity<br>&amp; quality`, `Canadian<br>owned &amp; operated`; footer line `For research purposes only. Not for human or veterinary use.`
- Assets: `${SITE_URL}/images/email/order-hero.jpg`, `/images/vyta-mark.png`, `/images/vyta-wordmark.png`, icons `/images/email/<icon>.png` (file-text-blue, calendar-blue, check-teal, map-pin-blue, package-blue, truck-blue, package-open-blue, mail-blue, flask-conical-blue/white, shield-check-white, canadian-maple-leaf-white, arrow-right-white, arrow-right-muted).
- Plain text: first line `ORDER CONFIRMED — Thank you for your order.`, then `Hi <name>, your payment has been received and your order is being processed.`, `We’ll email you tracking information once it ships.`, `Order number: …`, `Order date: …`, `Payment status: …`, `Your order:` lines `  <name> (<pack>) × <qty> — $x`, totals, `Shipping address:` block, `View your order (sign in or create an account first): <url>`, `Questions? Reply to this email or write to support@vytabio.com.`, `For research purposes only. Not for human or veterinary use.`

"View Order Details" link (lib/customer/order-link.ts): `buildViewOrderUrl(db, SITE_URL, invoiceId, email)` →
`${SITE_URL}/${hasAccount ? 'login' : 'signup'}?redirect=<encoded /account/orders/<invoiceId>?claim=<token>>&email=<email>`, where `hasAccount` = a `customers` row `ilike email`. Token `signOrderClaim(orderId, email) = base64url(HMAC_SHA256(ORDER_LINK_SECRET || SUPABASE_SERVICE_ROLE_KEY, "order-claim:v1:<orderId>:<lowercased email>"))`. The order page POSTs it to `/api/customer/orders/[id]/claim` (see Routes).

Admin manual send: `sendConfirmationManually` (POST `/api/admin/confirmation-email`) — not once-only; for Stealth Health requires paid + invoice (else 422 `This order isn’t paid yet — the confirmation goes out once it’s paid.`); logs with `sent_by`/`sent_by_email`; stamps `confirmation_email_sent_at` afterwards.
Storefront `orders` auto-send (`sendStorefrontOrderConfirmationOnce`) only for `source` starting with `e-transfer` — none on this site.

Migration `order-confirmation-email-migration.sql` back-stamps `confirmation_email_sent_at = now()` on existing paid rows (so the deploy doesn't mass-mail history) and drops any CHECK on `fulfillment_email_log.kind`.

### 3. Admin "new order paid" email

`sendStealthHealthPaidAlertOnce(db, puramassOrderId, { transition, paidVia })` (lib/admin/stealth-health-paid-alert.ts). Outcome reasons: `not_found|not_paid|already_sent|no_recipients|not_migrated|send_failed|error`.
- Requires ledger with `invoice_id`, invoice exists, and (`invoice.status==='paid' || ledger.status==='paid'`).
- If column `admin_paid_alert_sent_at` absent: send only when `transition` is true, unclaimed. Else skip if set; claim `NULL → now()` like the customer email; release on failure.
- Recipients `getAdminAlertEmails(db)`: `site_settings.admin_emails` (array) → env `ADMIN_ALERT_EMAILS` (comma-separated) → `site_settings.invoice_cc_emails`. Empty → `no_recipients`.
- Send `sendAdminOrderPaidAlert(to[], data)`: one email to all recipients; subject
  `` `${source==='manual' ? 'Invoice paid' : 'New order'}: ${orderNumber || 'Stealth Health order'} · ${customer.name || customer.email || 'Guest'} · ${money(total)} ${currency}` `` (money = `$x.xx`, sign-aware).
  Body = **identical to the customer confirmation HTML/text** (`renderAdminOrderPaidHtml` returns `renderOrderConfirmationHtml(data.order)`).
- Log `fulfillment_email_log { invoice_id, to_email: to.join(', '), subject, success, error, order_id:null, message_id:null, kind:'admin_paid_alert', sent_by, sent_by_email }`.
- Manual: `POST /api/admin/paid-alert-email { invoiceId }` (Routes).

### 4. Klaviyo events

- At hand-off (checkout route, `after()`): `trackStartedCheckout` metric `Started Checkout`, `unique_id = partner_reference`, `CheckoutURL = payment_link`.
- On first paid (only `firstPaid` passes): `trackPlacedOrder(db, { orderId: invoiceId, orderNumber: invoice_number, email: invoice.customer_email ?? ledger.customer_email, firstName/lastName: splitName(customer_name), customerId, items: lines→{productId, name: description, quantity: qty, price: unit_price, variant: price_type==='vial' ? 'Single vial' : 'Box'}, subtotal, shipping: shipping_cost, discountCode: stored.discount_code, total, currency (default 'CAD'), source: 'stealth_health' })`.
  Sends metric `Placed Order` (`value = total`, `unique_id = invoiceId`, properties `OrderId, OrderNumber, Source, Categories, ItemNames, ItemCount, Items[], Subtotal, Shipping, DiscountCode, DiscountValue, Currency, ShippingAddress, OrderURL: SITE_URL + '/account'`) and one `Ordered Product` per line (`unique_id = "<invoiceId>:<idx>"`).
- Gate: `site_settings.klaviyo_enabled === true && klaviyo_server_events_enabled !== false && privateKey` where privateKey = `site_settings.klaviyo_private_api_key || env KLAVIYO_PRIVATE_API_KEY`. All Klaviyo calls are best-effort and never throw.
- No Klaviyo event is sent by the manual invoice-paid path. `trackOrderStatus` (Confirmed/Fulfilled/Delivered/Cancelled/Refunded Order) is only wired for `orders`, not for hosted orders.

### 5. Attribution (analytics)

`attributeHostedPurchase(db, { id, customer_email, attribution_channel? })` (lib/analytics/attribution-server.ts), called by webhook and poll (not refresh) just before materialize:
`attributeEmailPurchase` → `SELECT anonymous_id, first_channel, first_campaign, purchased_at, first_seen_at FROM visitor_attribution WHERE customer_email = lower(trim(email)) ORDER BY first_seen_at ASC LIMIT 20`; sets `purchased_at = updated_at = now` on rows where null; returns earliest row's channel/campaign. Then, if a channel was found and the order has none, `UPDATE puramass_orders SET attribution_channel, attribution_campaign WHERE id AND attribution_channel IS NULL`. Best-effort.
Client side: GA4 `begin_checkout` fires before redirect; no client `purchase` event is possible.

### 6. Affiliate commission

`creditAffiliate` → `recordAffiliateCommission(db, { invoiceId, subtotalCents: ledger.subtotal_cents, customerId: ledger.customer_id, referralCode: ledger.referral_code, discountCodeId: stored.discount_code_id })` (lib/affiliate/commission.ts). Returns `{recorded:true, commissionId, amount, affiliateId, orderTotal, code}` or `{recorded:false, reason:'no-attribution'|'no-base'|'already-recorded'|'error'}`.
1. Pre-check `commissions WHERE invoice_id` → `already-recorded`.
2. Attribution priority: (a) `discount_codes` row `discountCodeId` with `affiliate_id` ≠ customerId (code's `commission_rate` is a percentage override); (b) bound customer `customers.affiliate_id` (≠ customer id) + its active `referral_codes` row; (c) `resolveReferralCodeOwner(referralCode)`: exact upper-cased match on active `referral_codes.code`, else affiliate-assigned active `discount_codes.code`; owner `affiliates.active !== false`; self-referral rejected.
3. `base = subtotal_cents/100` (goods only, no shipping/tax); `base <= 0` → `no-base`.
4. `rate` = code rate/100 clamped [0,1] if present, else `normalizeCommissionRate(affiliates.commission_rate)` (≤1 = fraction, >1 = percent, invalid/≤0 → 0.10; >100% → 0.10). `amount = round2(base × rate)`.
5. INSERT `commissions { affiliate_id, invoice_id, order_id:null, referral_code_id, amount, order_total: base, commission_rate: round2(rate*100), status:'pending', discount_code_id? }`. `23505` → `already-recorded`.
6. If `recorded`: `notifyAffiliateOfCommission` (lib/affiliate/commission-email.ts) → `affiliates.email/first_name/last_name`, deliverable check, `sendAffiliateCommissionEmail` subject `` `You earned a ${money(commission)} commission on order ${orderNumber}` `` (orderNumber = invoice_number ?? invoiceId), intro `A customer just placed an order using your affiliate link or code.`, dashboard `${SITE_URL}/affiliate/dashboard`; text body ends `Your commission has been recorded and will be included in your next payout.`; logged to `fulfillment_email_log` kind `affiliate_commission`. Failed send is logged, not retried.

DB (affiliate-commission-hosted-checkout-migration.sql): `commissions.invoice_id uuid REFERENCES invoices ON DELETE CASCADE`; `order_id` made nullable; CHECK `commissions_one_source: num_nonnulls(order_id, invoice_id) = 1`; partial unique indexes `idx_commissions_order_unique (order_id) WHERE order_id IS NOT NULL`, `idx_commissions_invoice_unique (invoice_id) WHERE invoice_id IS NOT NULL`.
Backfill for missed commissions: lib/affiliate/commission-backfill.ts via `app/api/admin/commissions/backfill/route.ts` and `app/api/admin/invoices/[id]/commission/route.ts` (no affiliate email).

### 7. Fulfillment hand-off (warehouse + Easyship)

- Warehouse queue `app/api/warehouse/queue/route.ts` excludes `invoices.status IN (pending_payment, expired)` and `is_backorder = true`; so the invoice appears in the pick/pack queue the moment it flips to `paid`. Ship-to is attached from `puramass_orders.shipping_address` (`attachPuramassShipTo`).
- Customer account pages exclude `(draft, pending_payment, expired)` (lib/customer/api.ts).
- `bookShipment(db, invoiceId, courierId)` → `autoCreateShipmentForInvoice(db, invoiceId, force=true, courierId ? { courierIdOverride: courierId } : { courierPreference: 'best_value' })` (lib/shipping/auto-shipment.ts). Creates an Easyship **draft** shipment (label purchase governed by `easyship_auto_buy_label` setting). Skips (recorded as attempt) when: invoice already has `easyship_shipment_id`, pickup, Easyship disabled, or no destination/postal code (`destinationReason`). Destination resolved from the ledger's `shipping_address`.
- No `backorders` rows are created by the payment path (`is_backorder:false`, `qty_backordered:0` on every line).

### 8. Settlement (partner money)

Not triggered by payment; admin-driven reconciliation.
- Live partner ledger: `fetchPartnerSettlement({ start?, end?, year?, limit? })` (lib/payments/puramass-settlement.ts) → `GET /partner/settlement?start=YYYY-MM-DD&end=YYYY-MM-DD&limit=N[&cursor=…]`, following `pagination.next_cursor ?? next_cursor` until null; stops on a repeated cursor or after 200 pages (`truncated:true`). Window: `year` → `YYYY-01-01..YYYY-12-31` (2000–2999); else valid start/end, end ≥ start, ≤ 400 days inclusive; violations throw `PuramassApiError(400, …)` with messages `year must be a four-digit calendar year`, `start and end must be YYYY-MM-DD dates`, `end must be on or after start`, `` `window is ${days} days; the settlement endpoint accepts at most 400` ``. Page size default 100, clamp 1–500. Rows from first of `json`, `appointments`, `rows`, `data`, `results`, `settlements`; deduped by `appointment_id`; money → integer cents once (`Math.round(n*100)`); `shipping` null stays null; `totals`/`caveats` taken from first page; `split_model_unconfigured` = caveat code `split_model_unconfigured` or any row with null `split_model`.
- Admin route `GET|POST /api/admin/stealth-health/partner-settlement` (GET reads stored pulls only; POST admin-only live pull + reconcile + snapshot into `stealth_health_settlement_pulls` / `stealth_health_settlement_rows`, audit `action:'read'`, entity `stealth_health_settlement_pull`). Partner 401/403/404 → **409** with hint `The settlement endpoint is not enabled for this account. It is off by default and switched on per partner account, requires clinical tier, and is not available in sandbox. Ask Stealth Health to enable it.`; not configured → 409 `No Stealth Health partner API key is configured in this environment.`
- Internal receivable (stealth-health-settlement-migration.sql): `stealth_health_settings` (terms singleton: `commission_pct`, `flat_fee_cents`, `shipping_fee_cents` DEFAULT 3500, `shipping_remitted`, `payment_terms_days` 14, `currency` 'USD'), `stealth_health_invoices` (`invoice_number` DEFAULT `'SH-' || nextval(stealth_health_invoice_seq START 1000)`, status `draft|sent|partial|paid|void`, frozen cent totals), `stealth_health_payouts`; `puramass_orders.settlement_invoice_id` (prevents double billing) and `settlement_excluded` (`PATCH /api/admin/stealth-health/orders/[id] { settlement_excluded }`, admin only; 400 `This order is already on a settlement invoice — void that invoice first.` when excluding a billed order).

### 9. Legacy crypto side-effects (orders table only)

On `confirmed`: `adjustStockForConfirmedOrder`, `attributeEmailPurchase(email)`, (check-payment route only) `customers.has_completed_first_order = true WHERE id AND has_completed_first_order = false`, `sendPaymentConfirmed` (subject `` `Payment Confirmed - ${orderNumber}` ``), `sendAdminPaymentNotification` (to hard-coded `info@aminocan.com`, subject `` `Payment Received - ${orderNumber} - $${total.toFixed(2)} CAD` ``).

---

## Lifecycle — abandoned checkout recovery

There is **no automatic recovery email from this app**. Recovery is (a) Klaviyo's own flow triggered by the `Started Checkout` event at hand-off (resume URL = `payment_link`; Klaviyo stops the flow on `Placed Order`), and (b) admin-sent emails from `/admin/stealth-health` (Orders tab) and the customer desk.

### Detection rules (lib/payments/puramass-abandoned.ts — client-safe, shared with the admin table)

- `RECOVERABLE_STATUSES = ['payment_pending', 'expired', 'cancelled']` — chaseable from the per-order dialog.
- `PAYMENT_LINK_STATUSES = ['payment_pending', 'expired']` — eligible for bulk outreach / "live link" (`hasReusablePaymentLink`).
- Abandoned = status ∈ RECOVERABLE and `created_at <= abandonedCutoff(hours)` where `abandonedCutoff(h) = new Date(now − max(0,h)×3600000).toISOString()`.
- `hours = loadAbandonedHours(db)` = `site_settings.abandoned_checkout_hours` (INTEGER NOT NULL DEFAULT 1); invalid/≤0/missing → `DEFAULT_ABANDONED_HOURS = 1`; capped at `24*30 = 720`.
- Priority for one cart per buyer (`byAbandonedPriority`): `payment_pending`(0) < `expired`(1) < other(2), then newest `created_at` first.
- `wasRecovered(row)` (derived, never stored) = `status==='paid' && recovery_email_sent_at && (!paid_at || paid_at >= recovery_email_sent_at)`.
- `recoveryOffer(row)` → `"<v>% off"` or `"$<v.toFixed(2)> off"` from `recovery_discount_type/value`, else null.
- Admin list `GET /api/admin/puramass/orders?abandoned=1` applies `.in('status', RECOVERABLE_STATUSES).lte('created_at', cutoff)`; response includes `abandonedHours` and `counts.abandoned`.
- Admin UI shows the recover (cart) button on every row with `status !== 'paid'`.

### Per-order recovery `GET|POST /api/admin/puramass/orders/recover` (runtime nodejs)

Auth: Bearer JWT, `customers.role ∈ {admin, assistant}` else **403** `{ "error": "Unauthorized" }`.

GET `?id=<puramass_orders.id>` → 400 `{ "error": "id is required." }` / 404 `{ "error": "No matching order found." }` / 200:
```json
{ "order": { "id", "reference", "status", "payment_link", "customer_email", "customer_name", "created_at", "recoverable": bool },
  "firstName": "<first token of customer_name> | null",
  "cart": { "items":[{"name","quantity","lineTotal"}], "subtotal", "currency", "reference" },
  "checkoutNote": "<see below>", "senderName": "<admin first last> | null",
  "recovery": { "recovery_email_sent_at", "recovery_email_count", "recovery_promo_code", "recovery_discount_type", "recovery_discount_value" } }
```

POST body:
```ts
{ id: string; subject: string; body: string; templateKey?: string /* default 'custom' */;
  email?: string; cc?: string | string[]; promoCode?: string; discountType?: 'percentage'|'fixed';
  discountValue?: number|string; promoDetails?: string; promoExpires?: string; includeCart?: boolean /* default true */ }
```
Validation (in order; all 400 unless noted): `Invalid JSON`; `id is required.`; `A subject is required.`; `The message body is empty.`; `Unknown template` (key not in RECOVERY_TEMPLATE_MAP); 404 `No matching order found.`; **409** `This checkout was paid — there is nothing to recover.` (paid) or `` `A ${status.replace(/_/g,' ')} order cannot be recovered.` ``; `That email address is not valid.`; `This hand-off has no customer email — there is nobody to email.`; CC: `` `Not a valid email address: ${invalid.join(', ')}` `` (`field:'cc'`), `You can copy at most 5 people on one email.` (`field:'cc'`); discount: `The discount must be a positive amount, and a percentage cannot be more than 100.` (`field:'discount'`); `Add the promo code the discount belongs to, or describe the offer, so the customer knows how to claim it.` (`field:'promoCode'`).
`promoCode` is trimmed + upper-cased. `normalizeDiscount(type, value)`: type ∈ {percentage, fixed}, value finite > 0, percentage ≤ 100, rounded to 2 dp.

Processing: `buildOrderSummary` → `buildRecoveryEmailInput` → `sendRecoveryEmail({ to, cc, replyTo: admin email, input })` → `sendMail({ to, cc?, subject: renderSubject(input), html: renderPromoEmail(input), text: renderPromoEmailText(input), from: defaultFrom(), replyTo? })`.
Always logs INSERT `customer_emails { scope:'customer', customer_id, to_email, cc_emails, subject, body_html, template, promo_code, promo_details, promo_expires, sent_by_id, sent_by_email, sent_by_name, success, error, message_id }` (missing table tolerated).
Send failure → **502** `` `The recovery email could not be sent: ${error ?? 'the mail server rejected it.'}` ``.
Success → `stampRecoverySend`: `UPDATE puramass_orders SET recovery_email_sent_at=now, recovery_email_count=prev+1, recovery_promo_code, recovery_discount_type, recovery_discount_value WHERE id` (best-effort) → audit `puramass.recovery_email_sent` (entity `puramass_order`) → **200**
`{ ok:true, to, cc, subject, sent_at, attempt: prev+1, promo_code, discount, recorded: bool, logged: bool }`.

Codes are never issued here — they are generated on app.vytabio.com and pasted in; the discount only affects wording/"estimated" totals (`PROMO_SOURCE_NOTE`: `Promo codes are generated in app.vytabio.com (the Stealth Health platform). Create the code there first, then paste it below to include it in this email.`).

### Recovery email content (lib/customer/promo-email.ts + lib/payments/puramass-recovery.ts)

Recovery link = the partner's hosted `payment_link` itself (no new link is minted). Button label `Complete your order`; rendered only if `safeHttpUrl` (http/https).
`checkoutNote(status)`:
- `expired` → `This checkout link has expired — open it anyway and we will send you a fresh one, or just reply to this email.`
- `cancelled` → `This order was cancelled. Reply to this email and we will set it up again for you.`
- otherwise → `Secure checkout — your cart is exactly as you left it.`

Templates (`RECOVERY_TEMPLATES`; merge fields `{{first_name}}` → first name or `there`, `{{discount}}` → `"15% off"`/`"$25.00 off"` or `a discount`):

| key | label | subject | body |
|---|---|---|---|
| `recovery_discount` | Discount nudge | `Here is {{discount}} to finish your order, {{first_name}}` | `Hi {{first_name}},` / blank / `You were part-way through an order with us and did not quite make it to the end — no problem at all, it happens to the best of us.` / blank / `To help you finish your checkout, here is {{discount}}. Your cart is saved exactly as you left it, so it is waiting whenever you are ready.` / blank / `If something went wrong at checkout, or you just want to ask us about anything first, hit reply — we are always happy to help.` |
| `recovery_reminder` | Plain reminder | `You left something in your cart` | `Hi {{first_name}},` / blank / `We noticed you did not finish checking out. Your cart is saved, so you can pick up exactly where you left off.` / blank / `If something went wrong at payment, just reply to this email and we will sort it out.` |
| `recovery_last_chance` | Last chance | `Last chance on your cart` | `Hi {{first_name}},` / blank / `This is the last reminder about the order you started — after this we will leave you alone.` / blank / `The link below still works, so if you want it, it is one click away.` |
| `custom` | Blank | `` | `` |

HTML structure: 600px table; dark hero (`#05182B`) with wordmark `VYTA` + `Canadian Peptides`; when a discount is set the hero shows eyebrow `Your discount`, large figure (`15%` + italic `off`) and subline (`promoDetails` or `` `That is $X CUR off this cart.` `` or `Applies to your whole order.`); white card with paragraphs (blank-line split), cart block (eyebrow `Your cart · <reference>`; lines; `Subtotal`; `Discount (15% off)` in green `#0F7A57`; `Estimated total`/`Total`; note `The discount is applied at checkout once you enter the code.`), promo code block (eyebrow `Your code`, monospace code, `Enter at checkout · Valid <expires>`), checkout button, signature `— <senderName>` + `VYTA Biosciences`; footer `VYTA · Canadian research peptides`. Zero/unknown amounts are never printed (`knownAmount` > 0). Currency label default `USD` when cart currency missing (the summary passes `order.currency.toUpperCase()`, default `'USD'` in `buildOrderSummary`).

### Bulk recovery from the customer desk

`/api/admin/customers/outreach` (lib/customer/outreach.ts): one cart per email among `PAYMENT_LINK_STATUSES` rows (`fetchAbandonedOrders` limit 5000), chosen by `byAbandonedPriority`; at send time `loadRecipientCheckout` re-reads the ledger and drops the cart/button if the status left `payment_pending|expired`; each recipient gets an individual email; `MAX_BULK_RECIPIENTS = 40`, `SEND_CONCURRENCY = 5`, `CANDIDATE_LIMIT = 50`; CC only on the first recipient's message; each successful send calls `stampRecoverySend` on that cart.

### Missing-column tolerance
`loadRecoveryState`/`loadRecoveryStates` return "never chased" (`EMPTY_RECOVERY_STATE`) if the recovery columns are missing; admin list reports `recoveryAvailable:false`.

---

## Lifecycle — missing shipping address flow

### Detection
- No automatic detection or email. An order lacks an address when `toShippingAddress(puramass_orders.shipping_address) === null` (accepts object or JSON string; a bare non-JSON string becomes `{address: <string>}`; all-blank → null).
- Admin Orders tab shows `No address yet` (tooltip: pending → `Stealth Health reports the address once the order is paid. Sync to re-check.`; else `Stealth Health has not returned a shipping address for this order. Sync to re-check, or ask the customer directly.`) and `Asked <timeAgo>` when `address_requested_at` set. The request button is shown on every row (highlighted when no address and never asked).
- Addresses normally arrive via webhook/poll contact patches, or are captured at our own checkout (`shipping_address_source:'customer'`).

### Token generation / expiry (lib/payments/puramass-address-request.ts, server-only)
- `generateAddressToken()` = `randomBytes(32).toString('base64url')`; only `hashAddressToken(token) = sha256(token).hex` is stored.
- `looksLikeAddressToken(t)` = `/^[A-Za-z0-9_-]{20,120}$/`.
- `ADDRESS_REQUEST_TTL_DAYS = 30` (`expires_at = now + 30d`; table default identical).
- Link: `` `${SITE_URL.replace(/\/+$/,'')}/shipping-address/${token}` `` (SITE_URL = `"https://www.vytabio.com"` constant in lib/config.ts).
- `createAddressRequest(db, order, email)`: if an open request (`submitted_at IS NULL`, newest) exists → rewrite `token_hash, email, expires_at` in place (`reused:true`; old link dies); else INSERT. Returns `{ request, token, link, reused }` or `{ error }`.
- Table `puramass_address_requests` (puramass-missing-address-migration.sql): `id uuid PK, puramass_order_id uuid NOT NULL → puramass_orders ON DELETE CASCADE, token_hash text NOT NULL UNIQUE, email text NOT NULL, expires_at timestamptz NOT NULL DEFAULT now()+30 days, sent_at, sent_count int NOT NULL DEFAULT 0, sent_by uuid, sent_by_email, submitted_at, submitted_ip, submitted_address jsonb, created_at, updated_at (trigger)`; RLS "Service role full access".

### Admin send `POST /api/admin/puramass/orders/request-address`
Auth admin/assistant (403 `{ "error": "Unauthorized" }`). Body `{ id: string, email?: string, cc?: string|string[], note?: string }` (note trimmed, ≤500 chars).
Errors: 400 `Invalid JSON`; 400 `id is required.`; 404 `No matching order found.`; 400 `That email address is not valid.`; 400 `This order has no customer email — there is nobody to ask.`; 400 `` `Not a valid email address: …` `` (`field:'cc'`); 400 `You can copy at most 5 people on one request.` (`field:'cc'`); 500 `` `Could not create the address request: ${error}. If this mentions a missing table, run puramass-missing-address-migration.sql.` ``; 502 `` { error: `The address request could not be emailed: ${error}`, link } `` (link returned so it can be sent another way).
CC parsing `parseCcList(raw, primary)`: array or string split on `[,;\n]`, regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, case-insensitive dedupe excluding primary, max `MAX_CC_RECIPIENTS = 5` (excess → `truncated`), invalid entries (≤80 chars) reported.
Success: `markAddressRequestSent` → `UPDATE puramass_address_requests SET sent_at=now, sent_count=+1, sent_by, sent_by_email`; `UPDATE puramass_orders SET address_requested_at = sent_at` (missing column ignored); audit `puramass.address_request_sent`. Response **200**
`{ success:true, email, cc, link, reused, sent_at, expires_at, had_address: bool }`.

### The email (lib/payments/puramass-address-email.ts)
`sendMissingAddressEmail({ to, summary, link, note?, replyTo?: adminEmail, cc? })` → `sendMail({ from: defaultFrom(), to, cc?, subject, html, text, replyTo? })`. CC is visible (not BCC) by design.
- Subject: `` `Quick one about your order ${id} — we need your shipping address` `` with `id = invoice_number || transaction_id?.slice(0,10) || reference`.
- HTML wrapped in `vytaShell(...)` (lib/email.ts). Heading `` `Hey ${firstName || 'there'} — where should we send this?` ``;
  `Thanks for ordering with us! Everything went through on our side — we just didn't catch a shipping address with your order, so we can't get it moving yet.`;
  `Tap the button below, fill in where you'd like it delivered, and we'll have your order processed and on its way <strong>within the next business day</strong>.`;
  optional note box (`#F1F8F9`, left border `#438B9E`); button `Add my shipping address` (bg `#07203A`); `Takes about a minute. The link is private to your order.`;
  `Your order` table (Item / Qty / Amount; empty → `Your order items`), totals `Subtotal`, `Shipping`, `Total paid` (`$x.xx CUR`, unknown → `—`);
  reference rows `Invoice`, `Transaction` (linked to `payment_link`), `Order reference`, `Placed` (`en-CA` long date);
  if an address is on file: `We have this on file — is it still right?` + lines;
  `Something look off, or would you rather just reply with the address? Hit reply to this email and a real person will sort it out with you.`
- Text: `Hey <first>,` … `Add your address here and we'll have the order processed and on its way within the next business day:` + link … `YOUR ORDER` … `Prefer to just reply with the address? Reply to this email and we will sort it out.`
- Summary source `buildOrderSummary(db, order)` (lib/payments/puramass-order-summary.ts): invoice header + `invoice_line_items(description, qty, unit_price, line_total)` when invoiced; else ledger SKUs named via `products.puramass_sku` (`name`) / `puramass_sku_vial` (`"<name> (single vial)"`); `currency = (order.currency || 'USD').toUpperCase()`; `total` falls back to subtotal(+shipping).

### Public API `GET|POST /api/shipping-address/[token]`
File app/api/shipping-address/[token]/route.ts; module-scope service-role client; no login (token is the credential). In-memory rate limiter (lib/rate-limit.ts, per process) keyed by `x-forwarded-for` first IP → `x-real-ip` → `127.0.0.1`:
GET `shipping-address:get:<ip>` 30/60 s; POST `shipping-address:post:<ip>` 10/60 s. Exceeded → **429** `{ error:'rate_limited', message:'Too many requests. Please wait a moment.' }` (POST: `Too many submissions. Please wait a moment.`) + `Retry-After` seconds.

Lookup `loadAddressRequestByToken`: bad shape / unknown hash / DB error → `not_found` → **404** `{ error:'not_found', message:"We couldn't find an order for this link. Double-check you copied the whole link, or just reply to our email and we'll sort it out." }`; `expires_at < now` → **410** `{ error:'expired', message:'This link has expired. Reply to the email we sent you and we will send a fresh one right away.' }`; ledger missing → `order_missing` (also 404 not_found). A request already submitted is still readable/resubmittable until expiry.

GET 200 (header `Cache-Control: no-store`):
```json
{ "order": { "reference","transaction_id","transaction_link","invoice_number","status","placed_at","paid_at","currency",
             "customer_name","customer_phone","customer_email_masked","items":[{"name","sku","quantity","unit_price","line_total"}],
             "subtotal","shipping","total","shipping_address": {address,address2,city,state,zip,country}|null },
  "request": { "submitted_at", "expires_at" } }
```
`customer_email_masked`: first ≤2 chars of local part + `•` × max(2, rest) + `@domain`.

POST body `{ full_name, phone?, address, address2?, city, state, zip, country }`:
- Invalid JSON → 400 `{ error:'invalid', message:'Invalid request.' }`.
- `validateShippingAddress` (lib/payments/puramass-address.ts): trims and caps (`full_name` 120, `phone` 40, `address` 200, `address2` 200, `city` 100, `state` 80, `zip` 20, `country` 40, upper-cased). Errors: `full_name` `Please tell us who the parcel is addressed to.`; `address` `Please enter a street address.`; `city` `Please enter a city.`; `zip` `Please enter a postal or ZIP code.`; `country` `Please choose a country.`; `state` required for US/CA: `Please choose a state.` / `Please choose a province.`. Empty `address2`/`phone` → null.
- Valid but `!isShippableCountry(country)` (only `CA`) → 400 `{ error:'invalid', message:'We only ship within Canada.', errors:{ country:'We only ship within Canada.' } }`.
- Invalid → 400 `{ error:'invalid', message:'Please check the highlighted fields.', errors }`.
- `applySubmittedAddress` failure → **500** `{ error:'save_failed', message }` where message is `We could not save the address right now. Please contact us and we will take it down manually.` (columns missing) or `We could not save the address right now. Please try again.`
- 200 `{ success:true, address, full_name, phone, submitted_at }`.

### How the address is written back (`applySubmittedAddress`)
1. `UPDATE puramass_orders SET shipping_address = {address,address2,city,state,zip,country}, shipping_address_source='customer', shipping_address_updated_at=now, customer_name=full_name[, customer_phone=phone] WHERE id` — must succeed.
2. `UPDATE puramass_address_requests SET submitted_at=now, submitted_ip, submitted_address = {...address, full_name, phone} WHERE id` (best-effort).
3. If `order.invoice_id`: `UPDATE invoices SET customer_name[, customer_phone] WHERE id` (best-effort). The invoice has no address column for hosted orders — warehouse and Easyship read the ledger's `shipping_address`.
4. A later partner payload can never overwrite it (provenance guard in `buildPuramassContactPatch`).
The submission does **not** trigger shipment booking (see notes).

---

## Lifecycle — routes & crons

### GET /api/cron/puramass-poll
- Schedule: Supabase **pg_cron** job `puramass-poll`, `*/2 * * * *` (every 2 minutes), via `supabase-cron-puramass-poll.sql`: `net.http_get(url := vault 'app_base_url' || '/api/cron/puramass-poll', headers := {'Authorization': 'Bearer ' || vault 'cron_secret'})`. Requires extensions `pg_cron`, `pg_net`; Vault secrets `app_base_url` (no trailing slash) and `cron_secret`. **Not** in vercel.json.
- Auth: `PURAMASS_CRON_SECRET || CRON_SECRET` via `x-cron-key` / `?key=` / `Authorization: Bearer`.
- Request: none. Response: see Path B. Status codes 200/401/500.

### GET /api/cron/check-payments (legacy crypto `orders`)
- Schedule: **none found in repo** (not in vercel.json, no SQL). Auth: `Authorization === 'Bearer ' + CRON_SECRET` exactly, else 401 `{ "error": "Unauthorized" }`.
- Reads `orders` (`id, order_number, email, crypto, payment_address, payment_amount_expected, payment_expires_at, total, items, status`) where `status IN ('pending','received') AND payment_address IS NOT NULL`. Fetch error → 500 `{ "error": "Failed to fetch orders" }`.
- Per order (sequential, 250 ms sleep): expire pending past `payment_expires_at`; `checkPayment(crypto, address, expected)` (lib/payment-monitor.ts; `REQUIRED_CONFIRMATIONS = { btc:1, eth:12, sol:1 }`); confirmed → `status:'confirmed', payment_amount_received, payment_tx_hash, payment_confirmations, payment_confirmed_at` + side-effects (§9); seen but unconfirmed → `received` (or update `payment_confirmations`).
- 200 `{ checked, received, confirmed, expired, total }`.

### GET /api/orders/check-payment?orderNumber= (legacy crypto, public client poller)
- No auth. 400 `{ "error": "Order number required" }`; 404 `{ "error": "Order not found" }`.
- Same logic as the cron for one order; also sets `customers.has_completed_first_order`. Responses `{ status, confirmations, requiredConfirmations }` (expired → `{status:'expired', confirmations:0, requiredConfirmations:1}`).
- Not used by the Puramass flow.

### POST /api/webhooks/stealth-health
See Path A. Runtime nodejs; public; HMAC header `x-stealth-signature`. Every delivery logged to `puramass_webhook_events`.

### POST /api/webhooks/easyship
Shipping/tracking webhook (Easyship HMAC/JWT `X-EASYSHIP-SIGNATURE`); **not a payment webhook** — it updates shipment/tracking state on orders/invoices after fulfillment. Out of scope for this section.

### POST /api/admin/puramass/orders/refresh
See Path D. Admin/assistant.

### POST /api/admin/puramass/orders/sync
See Path C. Admin/assistant.

### GET /api/admin/puramass/orders
Admin/assistant. Query: `page` (0-based), `pageSize` (1–100, default 25), `status` (comma list), `abandoned=1`, `q` (≤120 chars; `,()*` stripped; ilike over `customer_email, partner_reference, transaction_id, referral_code[, customer_name]`). Column ladder (core + address + recovery → … → core). Attaches `invoice` (`id, invoice_number, customer_id, customer_email, status, fulfillment_status, fulfillment_type, due_date, packed_at, fulfilled_at, currency, subtotal, shipping_cost, total, created_at`), `confirmation` (summary from `fulfillment_email_log` kind `order_confirmation` by invoice), `affiliate` (`{id, name, active}` from referral code). Response `{ orders, total, page, pageSize, addressesAvailable, recoveryAvailable, abandonedHours, counts:{ all, payment_pending, paid, expired, cancelled, abandoned } }`; 500 `{ "error": "Could not load orders: <msg>" }`.

### DELETE /api/admin/puramass/orders
Admin only. Body `{ ids: string[], cascadeInvoice?: boolean }`. 400 `Invalid JSON body` / `ids[] is required.`; 404 `No matching orders found.`; 500 `Could not load the orders to delete.` / `Could not delete the orders.`. Deletes ledger rows; with `cascadeInvoice` also deletes linked invoices (lines cascade). Audit `puramass.order_delete` / `puramass.order_delete_cascade`. 200 `{ ok, deleted, linkedInvoices, invoicesDeleted, warning? }`. Note: deleting the invoice of a paid order makes heal skip it (no recreation).

### GET|POST /api/admin/puramass/orders/recover
See Abandoned checkout recovery.

### POST /api/admin/puramass/orders/request-address
See Missing shipping address flow.

### GET|POST /api/shipping-address/[token]
See Missing shipping address flow. Page `app/shipping-address/[token]/page.tsx` calls only these two endpoints.

### GET|POST /api/admin/confirmation-email
Staff check: Bearer JWT → `customers.role`. GET (admin or assistant) `?orderId=|invoiceId=|puramassOrderId=` (first valid UUID wins) → 400 `{ "error": "Pass orderId, invoiceId or puramassOrderId." }`; `{ applicable:false }` when target not found; else `{ applicable:true, kind, summary:{sendCount,lastSentAt,lastSentTo,lastSentBy,lastAttemptFailed,lastError}, history:[{created_at,to_email,success,error,sent_by_email}] (≤50), recipient, orderNumber, blockedReason }`. blockedReason strings: `Not paid yet — the confirmation goes out once the order is paid.`, `Mark the invoice paid first — this email tells the customer their payment was received.`, `No email address on this order or its customer account — add one to send the confirmation.`, `` `“${email}” can’t receive email — update the customer’s email address to send the confirmation.` ``.
POST (admin only, 403 otherwise) body `{ orderId | invoiceId | puramassOrderId }` → `sendConfirmationManually`; errors with status from the lib (404/422/502) or 500; success audit `order.confirmation_email_sent` → `{ success:true, to, sent_at }`.

### GET|POST /api/admin/paid-alert-email
GET staff `?invoiceId=` (400 `{ "error": "Pass invoiceId." }`) → `{ applicable:false }` for storefront-order invoices, else `{ applicable:true, kind, summary, history, recipients, blockedReason }` (`Mark the invoice paid first — this email tells the team an order was paid.` / `No admin recipients — add them under Settings → Admin Email Notifications.`).
POST admin only `{ invoiceId }` → `sendAdminPaidAlertManually` (404 `Invoice not found, or it belongs to a storefront order.`, 422 not paid / no recipients, 502 send failure); stamps `admin_paid_alert_sent_at` if null; audit `invoice.admin_paid_alert_sent`; `{ success:true, to, sent_at }`.

### POST /api/customer/orders/[id]/claim
Service-role client. Bearer Supabase session required (401 `{ "error": "Unauthorized" }`). Body `{ token }`. `id` must be a UUID and `verifyOrderClaim(id, user.email, token)` true, else **403** `{ "error": "This order link was sent to a different email address than the one you are signed in with." }`. No `customers` row for `user.id` → **409** `Finish setting up your account, then try again.`
Stealth Health: `invoices WHERE id AND source='stealth_health'` — owned by someone else → 409 `This order belongs to another account.`; else `UPDATE invoices SET customer_id = user.id WHERE id AND customer_id IS NULL` and `UPDATE puramass_orders SET customer_id = user.id WHERE invoice_id = id AND customer_id IS NULL`. Fallback to `orders`. 404 `Order not found`; 500 `Could not link this order. Please try again.`; success `{ linked: true }`.

### GET /api/admin/invoices/[id]/puramass
Invoice caller check (`getInvoiceCaller`) → 403; 404 `Invoice not found`; `{ puramass: null }` if not a Stealth Health invoice; else `{ puramass: fetchPuramassContext(db, id) }` (ledger context incl. address/phone; internals not read for this section).

### GET|POST /api/admin/stealth-health/partner-settlement, PATCH /api/admin/stealth-health/orders/[id]
See Settlement.

### Customer-facing order pages
- `app/order/success/page.tsx`: makes **no server call**; client-redirects to `/order/track?order=&email=`.
- `app/order/track/page.tsx`: calls `GET /api/orders?orderNumber=<n>&email=<e>` which reads **only the `orders` table** (`order_number, status, items, totals, shipping_*, tracking_*, created_at, shipped_at, delivered_at`; email must match, uniform 404 `No order found matching that order number and email.`). Hosted (Stealth Health) orders are **not trackable here**; they appear in `/account/orders` (invoices with `source='stealth_health'`, excluding `draft/pending_payment/expired`) after the claim flow.

### vercel.json crons
Only `{ "path": "/api/cron/stock-report", "schedule": "0 13 * * *" }` (daily stock report email; unrelated to payment). `/api/cron/abandoned-registrations` (hourly via `supabase-cron-abandoned-registrations.sql`, Bearer `CRON_SECRET`) is an admin alert for registered customers who never ordered — **not** abandoned checkout.

---

## Lifecycle — env vars

| Var | Used by | Notes |
|---|---|---|
| `PURAMASS_API_KEY` | lib/payments/puramass.ts (`X-Api-Key`) | required for poll/refresh/sync/settlement; missing → `isPuramassConfigured()` false |
| `PURAMASS_PARTNER_ID` | `X-Partner-ID` | default `ptr_puramass` |
| `PURAMASS_API_BASE_URL` | base URL | default `https://api.stealth.health`; trailing slashes stripped |
| `PURAMASS_WEBHOOK_SECRET` | webhook HMAC | missing → webhook 500 `not_configured` |
| `PURAMASS_CRON_SECRET` | /api/cron/puramass-poll | falls back to `CRON_SECRET`; must equal Vault `cron_secret` |
| `CRON_SECRET` | puramass-poll fallback, check-payments, abandoned-registrations, stock-report | |
| `NEXT_PUBLIC_SUPABASE_URL` | all clients | lib/supabase.ts has a hard-coded fallback project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | all post-payment DB access; also order-claim HMAC fallback | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `getSupabase()` falls back to it if service key missing | |
| `SMTP_HOST`, `SMTP_PORT` (default 587; 465 = implicit TLS, else STARTTLS required), `SMTP_USER`, `SMTP_PASSWORD` | lib/smtp.ts | all emails |
| `SMTP_FROM` → `SMTP_USER` → `EMAIL_FROM` | `defaultFrom()` | final fallback `VYTA <noreply@aminocan.com>` |
| `ADMIN_ALERT_EMAILS` | admin paid alert / low-stock recipients | used only when `site_settings.admin_emails` empty |
| `ORDER_LINK_SECRET` | claim-token HMAC | falls back to `SUPABASE_SERVICE_ROLE_KEY` |
| `KLAVIYO_PRIVATE_API_KEY` | Klaviyo server events | used only when `site_settings.klaviyo_private_api_key` empty |

Non-env config: `SITE_URL = "https://www.vytabio.com"` (constant, lib/config.ts) — used for email links/images and the address link. `SUPPORT_EMAIL = 'support@vytabio.com'`. DB settings: `site_settings.abandoned_checkout_hours`, `admin_emails`, `invoice_cc_emails`, `klaviyo_*`, `easyship_auto_buy_label` (and other Easyship settings).

---

## Lifecycle — unverified / porting notes

### Unverified
- **Where the buyer lands after paying.** `buildPuramassOrderBody` sends no return/success URL; the post-payment redirect (if any) is configured on the partner side. Not determinable from the repo.
- The full set of partner `status` values. Code only special-cases `paid`, `expired`, `cancelled`, `payment_pending`; any other string (e.g. a refund status) would be written verbatim. Whether the partner sends events other than `store_order.payment_complete` (e.g. expiry/cancel/refund events) is not documented in the repo.
- The signature header encoding beyond `sha256=<hex>` (code also accepts bare hex).
- Schedule for `/api/cron/check-payments` (legacy) — no scheduler config found.
- Internals of `lib/admin/stealth-health-reconcile.ts`, `lib/admin/partner-settlement-server.ts`, `lib/admin/stealth-health-server.ts`, `lib/admin/puramass-invoice.ts` (`fetchPuramassContext`), `lib/shipping/auto-shipment.ts` destination resolution and Easyship payloads — not read in full for this section.
- `invoice_line_items.vials_per_unit` and `invoices.stock_adjusted` existence is assumed migrated (stock-ledger-migration.sql); without `vials_per_unit` the insert fallback drops `product_id` from pack lines (they then take no stock).
- Whether Klaviyo's own abandoned-checkout flow is configured in the Klaviyo account (outside repo).

### Porting notes / gotchas (as the code behaves today)
1. **Webhook has no terminal-status guard.** Dedupe is only `last_event_id === event_id`; a delayed or replayed event with a *different* `event_id` (e.g. an older `payment_pending`) can move a `paid` row backwards. The poll/sync path guards this; the webhook and admin refresh do not. A port may want `paid` to be sticky.
2. **Late payment after the 7d+6h sweep** is only confirmed by the webhook or the per-row admin refresh — `applyPuramassStatus` treats `expired` as terminal, and the poller only selects `payment_pending`. `markInvoicePaid` does accept `expired` invoices.
3. **Admin refresh skips** `attributeHostedPurchase` and invoice expiry on remote `expired`/`cancelled`; it also updates by `transaction_id` with `maybeSingle()` (duplicate transaction ids would error).
4. **Manual "mark invoice paid"** stocks + emails but does not set the ledger to `paid`, credit affiliates, send Klaviyo, or book shipment.
5. **Invoice creation race:** two concurrent first-paid passes on a hand-off with no invoice can both `createPaidInvoice`; only one wins the `invoice_id IS NULL` link, the other invoice is orphaned but already `paid` and will take stock when its own pass calls `takeStealthHealthStock`. Since invoices are created at hand-off now, this only affects legacy rows / failed hand-off invoice writes.
6. **Address submitted after payment does not book the shipment.** `bookShipment` only runs inside `materializeStealthHealthFulfillment`; the cron heal only re-materializes when the invoice is still unpaid. An order paid without an address will have its Easyship attempt recorded as skipped; after the customer submits, a shipment must be created from the admin (`/api/admin/invoices/[id]/create-shipment`) or by an admin refresh/webhook redelivery that re-runs materialize.
7. **Admin paid-alert body ignores** `courier`, `discountCode`, `stockWarnings`, `invoiceUrl`, `paidVia` fields of `AdminOrderPaidEmailData` — it renders the customer email verbatim; only the subject differs.
8. **Partner refunds/cancellations never restore stock**; only an admin cancelling the invoice calls `restore_stock_for_invoice`.
9. **`/order/track` cannot find hosted orders** (reads `orders` only). Hosted buyers get the account link in the confirmation email instead.
10. The shipping-address rate limiter is in-memory per server instance (not shared across serverless instances).
11. Every optional-column read/write has a "strip and retry" fallback — when porting to a fresh schema with all migrations applied, these ladders can be dropped, but keep the rule "payment status write must never fail because of an optional column".
12. Migrations that back-stamp `confirmation_email_sent_at` / `admin_paid_alert_sent_at` on existing paid rows must run before enabling the automatic sends, or historical orders will be emailed on the next poll/heal pass.
13. Currency: hand-offs are CAD (`PURAMASS_CURRENCY = 'cad'`, invoices `currency:'CAD'`), but `buildOrderSummary` (address email, recovery cart) defaults to `'USD'` when the ledger currency is null, and the Stealth Health settlement tables default to `'USD'`; `puramass-account-orders-migration.sql` stamped legacy invoices with `USD` and $35 shipping.
14. `getSupabase()` silently falls back to the anon key if `SUPABASE_SERVICE_ROLE_KEY` is unset. RLS as written: `puramass_orders` and `puramass_address_requests` have a policy named "Service role full access" that is `FOR ALL USING (true) WITH CHECK (true)` **with no `TO service_role` clause** — as written it does not restrict by role (it would also admit anon/authenticated if table grants allow). Only server code reads these tables, but a port should scope the policy `TO service_role` (or drop it; the service role bypasses RLS anyway). `puramass_webhook_events` and `product_history` have RLS enabled with no permissive policy (service role only).
