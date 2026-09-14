# Fixes — PuraMass checkout, customer orders & cron reliability

A spec of every fix made in this work session, written so the **same fixes can be
re-applied to a sibling website** running the same stack. Each section is:
**Symptom → Root cause → Fix (files + code/SQL) → Verify.**

## Stack these fixes assume
- **Next.js (App Router)** hosted on **Vercel**.
- **Supabase / Postgres** with the `pg_cron`, `pg_net`, and **Vault** extensions.
- **PuraMass (a.k.a. "Stealth Health")** hosted-checkout integration.
- Customer accounts are Supabase auth users; `customers.id == auth.users.id`.
- Two order stores:
  - `orders` (+ `order_items`) — the **customer-facing** record the account UI reads.
  - `invoices` (+ `invoice_line_items`) — the **fulfillment** record; paid PuraMass
    sales are materialised here with `source = 'stealth_health'`.

---

## Table of contents
1. [Cron poller returns 401 — the `Authorization` header is dropped](#fix-1)
2. [Paid PuraMass orders don't show in the customer account](#fix-2)
3. [Flat $35 USD shipping fee on PuraMass sales](#fix-3)
4. [Backfill migration for historical paid orders](#fix-4)
5. [Materialise a stuck "paid but no invoice" order](#fix-5)
6. [Admin ledger: "Customer view" column + faithful quickview](#fix-6)
7. [PuraMass checkout redesign (3-col, BAC water, loading/motion)](#fix-7)
8. [Reusable diagnostic playbook for the cron 401](#playbook)

---

<a name="fix-1"></a>
## 1. Cron poller returns 401 — the `Authorization` header is dropped

**This was the big one.** The scheduled PuraMass payment poller
(`GET /api/cron/puramass-poll`, invoked by Supabase `pg_cron` + `pg_net`) returned
**HTTP 401 on every run**, so no PuraMass order ever got its payment status
confirmed / materialised.

### Symptom
- `net._http_response` shows a steady stream of `401 {"error":"Unauthorized"}`,
  one every schedule tick.
- The endpoint works fine from a browser/curl for public paths.

### Root cause
The endpoint authenticated **only** via `Authorization: Bearer <secret>`. On this
Vercel deployment the **`Authorization` header value never reached the function**
(arrived empty) — some proxy/edge layer strips/reserves `Authorization`. Proven by
a temporary debug endpoint:
- the request **did** reach our route (custom marker body came back), and
- the configured secret matched the sent secret by fingerprint, yet
- the received bearer length was **0**.

So it was never a secret mismatch, a firewall, or an allowlist — it was the
**transport dropping one specific header**.

> Diagnostic tip that made this unambiguous: the app's own 401 JSON body proves the
> request reached your function (an edge/firewall block returns a *Vercel* page, not
> your JSON). See the [playbook](#playbook).

### Fix
Authenticate through **multiple channels**, preferring ones proxies don't touch:
`x-cron-key` header → `?key=` query param → `Authorization` bearer (back-compat).

`app/api/cron/puramass-poll/route.ts` — replace the single-header check:

```ts
const cronSecret = process.env.PURAMASS_CRON_SECRET || process.env.CRON_SECRET;

// Accept the secret via, in priority order: custom header, query param, bearer.
// Some edge/proxy layers strip or reserve `Authorization`, which 401'd this
// endpoint even with the correct secret.
const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
const headerKey = req.headers.get('x-cron-key') || '';
const queryKey = req.nextUrl.searchParams.get('key') || '';
const provided = headerKey || queryKey || bearer;

if (!cronSecret || provided !== cronSecret) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

Then **reschedule the cron to send the custom header** (Supabase SQL editor):

```sql
select cron.unschedule('puramass-poll');
select cron.schedule('puramass-poll', '*/2 * * * *', $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
           || '/api/cron/puramass-poll',
    headers := jsonb_build_object(
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'))
  );
$$);
```

Query-param fallback (only if the custom header is *also* stripped):
```sql
url := (select decrypted_secret from vault.decrypted_secrets where name='app_base_url')
       || '/api/cron/puramass-poll?key='
       || (select decrypted_secret from vault.decrypted_secrets where name='cron_secret')
-- and no headers arg
```

### Also check on the other site (cheap wins before code changes)
- **`app_base_url` in Vault** must be the **canonical production domain**
  (`https://<domain>`, https, no `www`, no trailing slash, **not** a `*.vercel.app`
  deployment URL). A redirect to a different host/scheme *also* strips
  `Authorization`, and `*.vercel.app` URLs are behind Vercel Deployment Protection.
- The app env var the route reads (`PURAMASS_CRON_SECRET`, else `CRON_SECRET`) must
  equal the Vault `cron_secret`, with **no trailing newline** (a common paste bug,
  invisible when the Vercel var is marked "Sensitive").
- Env-var changes on Vercel require a **redeploy** to take effect.

### Verify
```sql
-- fire the exact cron request, then read the reply
select net.http_get(
  url := (select decrypted_secret from vault.decrypted_secrets where name='app_base_url')
         || '/api/cron/puramass-poll',
  headers := jsonb_build_object('x-cron-key',
    (select decrypted_secret from vault.decrypted_secrets where name='cron_secret')));
-- wait ~8s
select id, status_code, left(content,300) body, created
from net._http_response order by id desc limit 3;
```
Want `200 {"polled":N,...}`. Then confirm the *scheduled* rows go 200 too.

---

<a name="fix-2"></a>
## 2. Paid PuraMass orders don't show in the customer account

### Symptom
A customer pays via the PuraMass hosted checkout, but the order never appears on
`/account/orders` or `/account/dashboard`.

### Root cause
Paid PuraMass sales are materialised into **`invoices`** (`source='stealth_health'`),
but the account UI reads only the **`orders`** table. Different store → invisible.

### Fix (read invoices into the account; do **not** duplicate into `orders`)
`lib/customer/api.ts`:
- Add a mapper `mapInvoiceToOrder(inv, lineItems)` that shapes a paid
  `stealth_health` invoice like an `Order` (status → `processing`, `crypto` null,
  `shipping_address` null; carry `source`, `currency`, `subtotal`, `shipping_cost`).
- `getCustomerOrders(customerId)` — also query
  `invoices where customer_id = :id and source='stealth_health' and status <> 'draft'`,
  map + merge with `orders`, sort by `created_at` desc.
- `getOrderWithItems(orderId)` — if the id isn't a native order, fall back to a
  `stealth_health` invoice + its `invoice_line_items`, mapped the same way.

`app/(customer)/account/orders/page.tsx` and `.../orders/[id]/page.tsx`:
- Show **"Secure checkout"** as the payment method and the invoice **currency**
  (USD) for `source === 'stealth_health'`.
- Replace the orders-only *Download Invoice* button with a "receipt emailed by our
  checkout partner" note (the invoice route only serves native orders).

> RLS note: both `orders` and `invoices` had wide-open `USING (true)` policies, so the
> browser client can read them; the query filters by `customer_id`. Confirm the same
> on the other site or route through a service-role API instead.

### Verify
Log in as a customer with a paid PuraMass order → it appears as **Processing** with
the USD total; clicking it shows the line items.

---

<a name="fix-3"></a>
## 3. Flat $35 USD shipping fee on PuraMass sales

### Symptom / requirement
PuraMass invoices were created with `shipping_cost = 0`, currency defaulting to CAD,
so the total the customer saw didn't include shipping and was mis-denominated.

### Fix
`lib/payments/puramass-fulfillment.ts` — in `materializeStealthHealthFulfillment`:
```ts
export const PURAMASS_SHIPPING_USD = 35;
// ...
const total = +(subtotal + PURAMASS_SHIPPING_USD).toFixed(2);
await db.from('invoices').insert({
  // ...
  currency: 'USD',
  shipping_cost: PURAMASS_SHIPPING_USD,
  total,
  // ...
});
```
`invoice_number` and `due_date` are omitted on purpose — the table has DB defaults
(`'INV-' || nextval('invoice_number_seq')` and `CURRENT_DATE + 30 days`).

---

<a name="fix-4"></a>
## 4. Backfill migration for historical paid orders

Idempotent, one-time, run in the Supabase SQL editor. Ships as
`puramass-account-orders-migration.sql`.

```sql
-- 1. Link historical paid PuraMass invoices to a customer account by email.
UPDATE invoices AS i
SET customer_id = c.id, updated_at = now()
FROM customers AS c
WHERE i.source = 'stealth_health'
  AND i.customer_id IS NULL
  AND i.customer_email IS NOT NULL
  AND lower(i.customer_email) = lower(c.email);

-- 2. Stamp the flat $35 USD shipment fee + USD currency on pre-fee invoices.
UPDATE invoices
SET shipping_cost = 35,
    currency      = 'USD',
    total         = round((COALESCE(subtotal,0) + 35 + COALESCE(tax_total,0))::numeric, 2),
    updated_at    = now()
WHERE source = 'stealth_health' AND COALESCE(shipping_cost,0) = 0;

-- 3. Speed up the per-customer lookup used by the account page.
CREATE INDEX IF NOT EXISTS idx_invoices_source ON invoices (source);
```

> Reviewer note: step 2 flips historical `stealth_health` invoices to `currency='USD'`
> (they were created as the default CAD though PuraMass charges USD). Drop the
> `currency` line if you want to leave historical denomination untouched.

---

<a name="fix-5"></a>
## 5. Materialise a stuck "paid but no invoice" order

Some orders sit at `puramass_orders.status = 'paid'` with `invoice_id IS NULL`
(the paid side-effect never ran). The poller **won't** fix these — it only processes
`payment_pending`. Reproduce the materialisation for one order (one-off script,
`simulate-puramass-paid.sql`): flip the ledger to paid, create the USD invoice
(+ $35 shipping) linked to the customer, create line items (name + catalog price
resolved by SKU), and link `puramass_orders.invoice_id`. Idempotent on `invoice_id`.

Find them:
```sql
select id, status, paid_at, invoice_id, customer_email, created_at
from puramass_orders
where status = 'paid' and invoice_id is null
order by created_at desc;
```

---

<a name="fix-6"></a>
## 6. Admin ledger: "Customer view" column + faithful quickview

On `/admin/puramass-orders`, staff couldn't tell whether an order is visible to the
customer, or preview what they see.

- `app/api/admin/puramass/orders/route.ts` — select `invoice_id` and attach a linked
  invoice summary (`customer_id`, `status`, `invoice_number`, `currency`, totals).
- `app/(admin)/admin/puramass-orders/page.tsx` — a **"Customer view"** badge computed
  from the invoice: **Visible** (invoice exists + linked to a customer) / **Not
  linked** (guest email) / **Hidden** (not paid or not materialised); plus a
  **Quickview** button.
- `app/(admin)/admin/puramass-orders/CustomerOrderQuickview.tsx` — a modal that
  renders the order **exactly as the customer sees it**, guaranteed by loading through
  the **same `getOrderWithItems` path** the customer detail page uses.

---

<a name="fix-7"></a>
## 7. PuraMass checkout redesign (3-col, BAC water, loading/motion)

`app/checkout/PuramassCheckoutContent.tsx` + `app/checkout/page.tsx`:
- 3-column layout on desktop: **Contact** · **Complete your order** · **Order summary + CTA** (sticky).
- "Complete your order" leads with *why* bacteriostatic water is needed (peptides ship
  lyophilized), counts the peptide vials in the cart, and features BAC water first with
  an **"Essential"** badge.
- framer-motion staggered entrance, shimmer skeletons while add-ons load, email-valid
  check, card hover-lift, CTA shine; the bare "Loading checkout…" spinner is replaced by
  a branded skeleton screen reused by the router and the `Suspense` fallback.

---

<a name="playbook"></a>
## 8. Reusable diagnostic playbook for a cron 401

Apply this on the other site if its poller is 401'ing:

1. **See the raw HTTP replies** the cron is getting:
   ```sql
   select id, status_code, left(content,300) body, created
   from net._http_response order by id desc limit 15;
   ```
   - `401 {"error":"Unauthorized"}` (your app's JSON) → request **reaches your
     function**; it's an auth-value/header problem (continue below).
   - HTML / a login page → the URL is behind Vercel Deployment Protection; use the
     production domain, not `*.vercel.app`.
2. **Prove it's your code vs the edge**: temporarily give the route's 401 a distinctive
   body (e.g. `{"error":"MYAPP_ROUTE_401"}`). If the cron's reply shows it, the request
   reaches your route (secret/header issue). If it stays generic, the edge is answering.
3. **See what the function actually receives** with a gated, *safe* debug branch — never
   log the secret, only lengths + a truncated SHA-256 fingerprint:
   ```ts
   if (req.nextUrl.searchParams.get('debug') === '1') {
     const fp = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0,8);
     return NextResponse.json({ error:'Unauthorized', debug: {
       configuredLen: (cronSecret||'').length,
       bearerLen, headerKeyLen, queryKeyLen,
       configuredFp: cronSecret ? fp(cronSecret) : null,
       providedFp: provided ? fp(provided) : null,
     }}, { status: 401 });
   }
   ```
   Confirm `configuredFp` (app) == `sha256(vault_secret)`:
   ```bash
   printf '%s' 'THE_VAULT_SECRET' | sha256sum | cut -c1-8
   ```
   - Fingerprints match but `bearerLen: 0` → the `Authorization` header is being
     dropped → **apply Fix 1** (custom header / query param).
   - Fingerprints differ → the app env and the Vault secret aren't the same value.
4. **Fire the exact cron request from SQL** (not a browser — browsers send no auth):
   ```sql
   select net.http_get(url := '<app_base_url>/api/cron/<job>?debug=1',
     headers := jsonb_build_object('x-cron-key','<vault_secret>'));
   ```

### Cleanup after diagnosing
Remove the temporary `?debug=1` block and any distinctive 401 marker once the cron is
green; keep only the multi-channel auth from Fix 1.

---

## Order of operations to apply on the other site
1. Deploy the code changes (Fixes 1–3, 6, 7) to the production domain.
2. Set `PURAMASS_CRON_SECRET` (or `CRON_SECRET`) == the Vault `cron_secret`, no trailing
   newline; ensure `app_base_url` is the canonical `https://<domain>`.
3. Reschedule the cron with the `x-cron-key` header (Fix 1). Verify `200 {"polled":…}`.
4. Run the backfill migration (Fix 4) and, if needed, the stuck-order materialiser (Fix 5).
5. Remove the temporary debug/marker code.
