# Admin Audit Log — Implementation Reference

Audience: an LLM (or engineer) extending, debugging, or auditing this
feature. Written to be self-contained: every file path, table column, and
action name is here so you can work without re-reading the conversation
that produced it.

---

## 1. Goal

Capture every mutation performed under `/admin` in a single append-only
table so we can later answer "who did what, to which entity, when?".

Scope:

- **Storage**: new Supabase table `audit_logs` (no external SaaS).
- **Capture mechanism**: explicit `logAudit(...)` helper called from each
  mutation site. **No DB triggers**, no middleware interception.
- **Granularity**: action + entity + actor only. **No** before/after
  JSON diffs.
- **Read auditing**: out of scope. Mutations only.

Failure mode: audit-log writes must never break the action they record.
All helpers swallow errors after `console.error`.

---

## 2. Storage schema

File: `audit-log-migration.sql` (repo root). Run once in Supabase SQL
editor before deploying the code.

```sql
CREATE TABLE IF NOT EXISTS audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
  actor_email  TEXT,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT
);
```

Indexes on `created_at DESC`, `actor_id`, `(entity_type, entity_id)`,
`action`. RLS enabled with a deny-all policy
(`audit_logs_service_only`) — all reads and writes go through the
service-role key via `getSupabase()`.

Design notes:

- `actor_id` is nullable so deleting a customer doesn't cascade-destroy
  their audit history (`ON DELETE SET NULL`).
- `actor_email` is denormalized so the audit view never has to join.
- `entity_id` is `TEXT`, not UUID — some entity ids are storage paths
  (CSV import filenames) or row counts, not UUIDs.

---

## 3. Helper module

File: `lib/admin/audit.ts`. Exports three functions.

### `logAuditServer(db, actor, entry)`

For server-side API routes (`app/api/admin/**/route.ts`). Caller has
already verified the bearer token and resolved actor. `db` is the
service-role client from `getSupabase()` (or the route's local
service-role client). Always awaited but never throws.

### `logAuditClient(entry)`

For browser-side mutations in `lib/admin/api.ts`. Uses the shared anon
`supabase` client and resolves the actor from the current session.

Under the deny-all RLS policy in §2, **the client insert will be
denied**. The shipped behaviour is "swallow + console.error" — the
audit row will be missing. Two options to close the gap:

1. **Accept silent failures** — current shipped behaviour.
2. **Move browser mutations behind admin API routes** and call
   `logAuditServer` from there. Recommended.

If you instead loosen RLS to allow authenticated inserts, scope it
tightly — admin/assistant role only, and force `actor_id = auth.uid()`
so the actor can't be forged.

### `getAuditLogs(limit = 200)`

Server-only read helper used by `/api/admin/audit-logs`. Uses the
service-role client. `limit` is clamped to `[1, 1000]`.

---

## 4. Action vocabulary

Format: `entity.verb` (snake_case verb).

| Action                                    | entity_type           | entity_id           |
| ----------------------------------------- | --------------------- | ------------------- |
| `product.create`                          | `product`             | new product id      |
| `product.update`                          | `product`             | product id          |
| `product.delete`                          | `product`             | product id          |
| `product.import_preview`                  | `product_import`      | storage CSV path    |
| `product.import_confirm`                  | `product_import`      | row count (string)  |
| `product.image_upload`                    | `product_image`       | storage filename    |
| `product.image_delete`                    | `product_image`       | storage path        |
| `product.coa_upload`                      | `product_certificate` | storage filename    |
| `product.coa_delete`                      | `product_certificate` | storage path        |
| `invoice.create`                          | `invoice`             | invoice id          |
| `invoice.update`                          | `invoice`             | invoice id          |
| `invoice.status_change`                   | `invoice`             | invoice id          |
| `invoice.delete`                          | `invoice`             | invoice id          |
| `invoice.payment_recorded`                | `invoice`             | invoice id          |
| `order.status_change`                     | `order`               | order id            |
| `order.tracking_update`                   | `order`               | order id            |
| `commission.marked_paid`                  | `commission`          | commission id       |
| `customer.admin_granted`                  | `customer`            | customer id         |
| `customer.admin_revoked`                  | `customer`            | customer id         |
| `affiliate.commission_rate_update`        | `affiliate`           | affiliate id        |

`invoice.update` vs `invoice.status_change`: the PATCH handler picks
`status_change` when the body contains a `status` key, else `update`.

`customer.admin_granted` vs `customer.admin_revoked`: the
`toggleCustomerAdmin(customerId, isAdmin)` call chooses the action by
the new boolean value.

---

## 5. Wiring map

### Server-side API routes

Each route's `verifyAdmin` helper was extended so it also returns
`actor_id` and `actor_email`. The selector on `customers` now reads
`id, email, role` (and any pre-existing columns). After the mutation
succeeds, the handler calls `logAuditServer`.

Files instrumented:

- `app/api/admin/products/route.ts` (POST → `product.create`)
- `app/api/admin/products/[id]/route.ts` (PUT → `product.update`,
  DELETE → `product.delete`)
- `app/api/admin/products/import/route.ts` (POST → `product.import_preview`,
  PUT → `product.import_confirm`)
- `app/api/admin/products/upload/route.ts` (POST → `product.image_upload`,
  DELETE → `product.image_delete`)
- `app/api/admin/products/upload-certificate/route.ts` (POST →
  `product.coa_upload`, DELETE → `product.coa_delete`)
- `app/api/admin/invoices/route.ts` (POST → `invoice.create`)
- `app/api/admin/invoices/[id]/route.ts` (PATCH → `invoice.update` or
  `invoice.status_change`, DELETE → `invoice.delete`)
- `app/api/admin/invoices/[id]/payments/route.ts` (POST →
  `invoice.payment_recorded`)

Untouched on purpose (read-only): all GET handlers, invoice PDF, aging
report.

### Browser-side mutations

`lib/admin/api.ts` runs in the browser using the shared anon
`supabase` client. There is no API route between the page and the
mutation. `logAuditClient` is called inline after success.

Functions instrumented:

- `updateOrderStatus` → `order.status_change`
- `updateOrderTracking` → `order.tracking_update`
- `markCommissionPaid` → `commission.marked_paid`
- `toggleCustomerAdmin` → `customer.admin_granted` or
  `customer.admin_revoked`
- `updateAffiliateCommissionRate` → `affiliate.commission_rate_update`

---

## 6. Reading the log

### API endpoint

File: `app/api/admin/audit-logs/route.ts`.

`GET /api/admin/audit-logs?limit=500`

- Admin-only (uses `canAccessAdmin`, so `admin` and `assistant` can
  read).
- `limit` clamped to `[1, 1000]`, default 200.
- Newest-first.

### Viewer page

File: `app/(admin)/admin/audit-log/page.tsx`. Client component.
Fetches up to 500 rows and filters in-memory by actor email
substring, action substring, and entity-type dropdown.

### Nav

`/admin/audit-log` is added to `navItems` in
`app/(admin)/admin/layout.tsx` with the `ScrollText` icon.

---

## 7. Known gaps and follow-ups

1. **Browser-side inserts vs RLS.** Under the shipped RLS policy,
   `logAuditClient` writes will fail (silent console error). The five
   mutations in `lib/admin/api.ts` will therefore not produce audit
   rows in production unless you either (a) move them behind admin
   API routes and call `logAuditServer`, or (b) loosen the RLS to
   allow admin/assistant inserts. Recommended: path (a).
2. **No diff capture.** Before/after state is not recorded. To add
   diffs without rewriting callers, attach `payload JSONB` to
   `audit_logs` and a `diff(old, new)` helper in `lib/admin/audit.ts`.
3. **No request-level metadata.** IP, user agent, request id are not
   captured. Add as new columns if needed; they're available on
   `NextRequest`.
4. **Suppliers CRUD is unaudited.** The suppliers admin page
   manipulates the `suppliers` table directly via the browser client
   and is not instrumented.
5. **Purchase-order routes are unaudited.** The existing PO routes
   (`app/api/admin/purchase-orders/route.ts` and
   `app/api/admin/purchase-orders/[id]/route.ts`) are not
   instrumented in this rollout — the original spec named
   `fulfill`/`receive` routes that don't exist in the codebase.
   Decide which PO actions matter and instrument them with the same
   pattern.
6. **Read auditing intentionally omitted.** If the business later
   needs PII access logs, add `entity.view` actions on sensitive
   pages. Watch for volume.
7. **Retention.** No cleanup policy. The table will grow indefinitely.

---

## 8. How to extend

### Adding a new mutation site

1. Server or client? Server (API route) is the strong default.
2. **Server**: extend the route's `verifyAdmin` helper so it returns
   `actor_id` and `actor_email` (selector must include `id, email`).
   Call `logAuditServer(db, { actor_id, actor_email }, { action,
   entity_type, entity_id })` after the mutation succeeds.
3. **Client**: import `logAuditClient` from `@/lib/admin/audit` and
   call it after success. Remember the RLS limitation in §7.1.
4. Add the new action to the table in §4.

### Adding a new viewer filter

`app/(admin)/admin/audit-log/page.tsx` filters in-memory. For
server-side filtering, extend `app/api/admin/audit-logs/route.ts` to
accept query params and translate them into Supabase
`.eq()`/`.ilike()` calls.

### Backfilling

There is no backfill. History begins at the first `logAudit*` call
after the migration runs.

---

## 9. File index

New:

- `audit-log-migration.sql`
- `lib/admin/audit.ts`
- `app/api/admin/audit-logs/route.ts`
- `app/(admin)/admin/audit-log/page.tsx`
- `docs/admin-audit-log.md`

Modified:

- `app/(admin)/admin/layout.tsx` — nav link.
- `lib/admin/api.ts` — five `logAuditClient` calls.
- `app/api/admin/products/route.ts`
- `app/api/admin/products/[id]/route.ts`
- `app/api/admin/products/import/route.ts`
- `app/api/admin/products/upload/route.ts`
- `app/api/admin/products/upload-certificate/route.ts`
- `app/api/admin/invoices/route.ts`
- `app/api/admin/invoices/[id]/route.ts`
- `app/api/admin/invoices/[id]/payments/route.ts`

---

## 10. Verification checklist

- [ ] Migration applied in Supabase (`audit_logs` table exists).
- [ ] Service role can `INSERT` (test from an API route).
- [ ] Anon client cannot `SELECT` or `INSERT` directly (RLS check).
- [ ] Hit each instrumented mutation in the admin UI; confirm a row
      appears in `/admin/audit-log` with the right action/entity/actor.
- [ ] Browser-side mutations: confirm either (a) they fail silently
      and you've accepted that, or (b) you've migrated them to API
      routes / loosened RLS per §7.1.
- [ ] Filters in `/admin/audit-log` work for actor, action, entity.
