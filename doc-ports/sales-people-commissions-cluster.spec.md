# Sales People & Commissions — Build Spec

> **Cluster 9.** Internal sales reps + the unified commissions ledger.
> Sales-people are **independent of the affiliate program** — a rep need
> not be an affiliate, and stripping affiliates leaves this cluster
> intact (see also `affiliate-program-cluster.spec.md` §8).

---

## 0. The traps, up front

1. **`sales_persons.user_id` can be null.** A rep can exist without an
   auth user (e.g. a rep who never signs into `/admin`). The link is
   used only for the affiliate-overlap case where the same UUID identifies
   the auth user, the customer row, AND the sales person.
2. **Commission is snapshotted on the invoice header.** `invoices.sales_person_commission_rate`
   and `sales_person_commission_amount` are written at invoice create/edit
   time; changing the rep's master rate later does NOT retroactively
   re-rate existing invoices.
3. **`sales_commissions.status` is independent of `invoices.status`.**
   Marking an invoice paid does not mark its sales commission paid; admins
   flip commission status separately from the unified report.
4. **The Affiliate commission ledger (`commissions`) is a separate table.**
   The unified commissions report (Cluster 9 + 8) merges both. Don't try
   to dual-write — each table owns its own world.

---

## 1. Overview

| Surface | Files |
|---|---|
| Admin Sales People list / create / edit / deactivate | `app/(admin)/admin/sales-persons/page.tsx`, `_components/*` |
| Admin Commissions ledger (unified) | `app/(admin)/admin/commissions/page.tsx` |
| Sales person CRUD API | `app/api/admin/sales-persons/route.ts`, `[id]/route.ts` |
| Unified commissions report | `app/api/admin/commissions/report/route.ts` |
| Client lib | `lib/admin/sales-persons.ts`, `lib/admin/api.ts` |

---

## 2. Schema

### `sales_persons` (`invoice-sales-features-migration.sql`)

```
id              uuid primary key default gen_random_uuid()
user_id         uuid references customers(id) on delete set null  -- nullable
first_name      text not null
last_name       text not null
email           text
phone           text
commission_rate numeric(5,2) not null default 0   -- percent, e.g. 5.00 = 5%
notes           text
active          boolean not null default true
total_earnings  numeric(10,2) not null default 0  -- trigger-maintained
created_at      timestamptz not null default now()
updated_at      timestamptz not null default now()
```

### `sales_commissions` (same migration)

```
id              uuid primary key default gen_random_uuid()
sales_person_id uuid not null references sales_persons(id) on delete cascade
invoice_id      uuid references invoices(id) on delete set null
amount          numeric(10,2) not null
invoice_total   numeric(10,2) not null
commission_rate numeric(5,2) not null            -- snapshot at create
status          text not null default 'pending'  -- pending | paid | cancelled
paid_at         timestamptz
created_at      timestamptz not null default now()
```

**Trigger maintenance:**
- `sales_persons.total_earnings` is incremented on insert of a
  `sales_commissions` row with `status='paid'` (and decremented on a
  paid→cancelled or paid→pending transition). App code never sets
  `total_earnings` directly.

### Schema usage map

| Table.column | Read by | Written by |
|---|---|---|
| `sales_persons.*` | sales-persons page, InvoiceForm picker | `/api/admin/sales-persons` POST/PATCH |
| `sales_commissions.*` | commissions page + report, sales-person row stats | invoice POST/PATCH (auto-create), `/api/admin/commissions/*` (mark paid) |
| `invoices.sales_person_id/commission_rate/commission_amount` | sales person stats | invoice POST/PATCH |

---

## 3. Components

### `lib/admin/sales-persons.ts`
- `searchSalesPersons(query)` → fuzzy match by name/email; used by the
  InvoiceForm picker.
- `createSalesPerson(data)` → POST `/api/admin/sales-persons`.
- `updateSalesPerson(id, patch)` → PATCH `/api/admin/sales-persons/[id]`.
- `deactivateSalesPerson(id)` → soft delete via PATCH `{active:false}`.

### `GET /api/admin/sales-persons`
- admin/assistant only.
- Returns list with derived `total_earnings` (sum of paid `sales_commissions`).

### `POST /api/admin/sales-persons`
- admin only. Validates required fields + 0 ≤ commission_rate ≤ 100.

### `PATCH /api/admin/sales-persons/[id]`
- admin only. Editable: `first_name`, `last_name`, `email`, `phone`,
  `commission_rate`, `notes`, `active`. Changing `commission_rate` does
  NOT touch existing commissions.

### `DELETE /api/admin/sales-persons/[id]`
- admin only. Sets `active=false` if any commissions reference the rep
  (avoids data loss); hard delete otherwise.

### `GET /api/admin/commissions/report`
- admin/assistant only.
- Merges `commissions` (affiliate, source='affiliate') with
  `sales_commissions` (source='sales') into a unified table.
- Filters: `source`, `status`, `recipient`, `q` (free text).
- Returns HTML report via `lib/admin/report-html.ts`.

### Admin pages
- **`/admin/sales-persons`** — table + create/edit modal.
- **`/admin/commissions`** — unified ledger; mark-paid + CSV export.

---

## 4. Data flow

1. **Invoice create with sales_person_id** → invoice POST snapshots
   `commission_rate` from the rep (or admin override) into invoice header
   + creates a `sales_commissions` row in `pending`.
2. **Invoice edit** → if sales_person_id or rate changed, the existing
   commission row is updated (still pending). If invoice is deleted, the
   commission is deleted (FK CASCADE).
3. **Invoice paid** → does NOT auto-mark commission paid (intentional;
   payout is an out-of-band ops decision).
4. **Mark commission paid** (commissions page) → status=paid, paid_at=now;
   trigger bumps `sales_persons.total_earnings`.

---

## 5. Authorization

| Action | admin | assistant | affiliate | warehouse | customer |
|---|---|---|---|---|---|
| List sales-persons | ✔ | ✔ | – | – | – |
| Create/edit/delete sales-person | ✔ | – | – | – | – |
| View commissions report | ✔ | ✔ | (own only via portal) | – | – |
| Mark commission paid | ✔ | – | – | – | – |

---

## 6. Edge cases

- Rep deactivated mid-quarter → existing invoices keep them as
  `sales_person_id`; new invoices can't pick them (filtered by `active`).
- Commission rate edited mid-quarter → only future invoices use the new
  rate (per snapshot rule).
- Invoice deleted → `sales_commissions` cascade-deletes. `total_earnings`
  trigger reverses the paid contribution.
- Same UUID used for `affiliates`/`customers`/`sales_persons` (4-row
  affiliate flow): rep stats reflect both affiliate commissions and sales
  commissions because the unified report merges by recipient (or by
  source filter, if needed).

---

## 7. Open questions & unverified items

- **`total_earnings` trigger body** is not in committed SQL. Behavior
  inferred from app code (the app never writes the column directly).
  Confirm against the live trigger before relying on edge cases (e.g.
  paid→cancelled reversal).
- **`sales_commissions.invoice_id` SET NULL on invoice delete** keeps
  the historical record; admins can later filter "orphan" commissions in
  the report. Confirm the FK is actually SET NULL on the live table.
- **Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
