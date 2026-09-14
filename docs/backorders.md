# Backorders — Complete Documentation

This document is the single, comprehensive reference for the **Backorders**
feature in the aminocan admin app: what it is, the data model, every function and
API route involved, and the admin-panel **Backorders** page. It complements the
shorter coverage in [`module-ports/02-inventory-and-stock.md`](./module-ports/02-inventory-and-stock.md)
and [`module-ports/09-purchase-orders-and-suppliers.md`](./module-ports/09-purchase-orders-and-suppliers.md).

---

## 1. What a backorder is

A **backorder** records the portion of an invoice that was ordered *beyond* the
product's currently available stock. When an invoice line item's quantity exceeds
the product's `stock_quantity`, the shortfall is captured as a backorder so staff
have a worklist of "things customers paid/asked for that we still owe them" and a
one-click path to order the missing stock from a supplier.

There are **two ways** a backorder comes into existence:

1. **At invoice creation (invoice split).** When a new invoice is created with
   over-stock lines, the order is split into a primary (in-stock) invoice and a
   separate **backorder invoice** holding only the exceeding quantities. A
   `backorders` row is created against the backorder invoice. (See §4.1.)
2. **On invoice edit (recompute).** When an existing non-backorder invoice's line
   items change, its **open** backorder is recomputed from current lines vs.
   current stock. (See §4.2.)

A backorder is **fulfilled** by creating a Purchase Order from it: the PO's
creation "flushes" the backorder — marks it `fulfilled`, links the PO, and stamps
`fulfilled_at`. (See §4.3.)

Backorders are an **admin/assistant-only** tool. The API comment is explicit:
*"Backorders are an admin/assistant tool — hidden from affiliates."* There is no
affiliate or customer-facing surface.

---

## 2. Lifecycle at a glance

```
                 over-stock line on new invoice
                            │
                            ▼
        invoice split  ──►  backorder invoice (is_backorder=true,
        (POST invoices)     parent_invoice_id → primary, status='draft')
                            │
                            ▼
                  backorders row (status='open')  ◄── also created/recomputed
                            │                          by syncInvoiceBackorder
                            │                          on invoice edit
              ┌─────────────┴──────────────┐
              ▼                            ▼
   "Fulfill" → PO draft prefilled   invoice edited again →
   (new?backorder=<id>)             open backorder replaced
              │
              ▼
   POST purchase-orders with backorder_id
              │
              ▼
   backorders row  status='fulfilled', purchase_order_id set, fulfilled_at stamped
              │
              ▼
        appears under the "History" tab, linked to the PO
```

Status values: **`open`**, **`fulfilled`**, **`cancelled`** (the schema allows
`cancelled`, though no current code path sets it).

---

## 3. Data model

Two migrations define the backorder schema. Both are **idempotent** (safe to run
multiple times).

### 3.1 `backorders-migration.sql`

**Table `backorders`**

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | `uuid` | `gen_random_uuid()` | PK |
| `invoice_id` | `uuid` | — | `NOT NULL REFERENCES invoices(id) ON DELETE CASCADE` |
| `status` | `text` | `'open'` | `NOT NULL CHECK (status IN ('open','fulfilled','cancelled'))` |
| `purchase_order_id` | `uuid` | `null` | `REFERENCES purchase_orders(id) ON DELETE SET NULL` — set when fulfilled |
| `created_at` | `timestamptz` | `now()` | `NOT NULL` |
| `fulfilled_at` | `timestamptz` | `null` | Stamped when the fulfilling PO is created |

Indexes: `idx_backorders_status (status)`, `idx_backorders_invoice (invoice_id)`.

**Table `backorder_items`**

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | `uuid` | `gen_random_uuid()` | PK |
| `backorder_id` | `uuid` | — | `NOT NULL REFERENCES backorders(id) ON DELETE CASCADE` |
| `product_id` | `uuid` | `null` | `REFERENCES products(id) ON DELETE SET NULL` |
| `description` | `text` | — | `NOT NULL` |
| `qty_ordered` | `numeric` | — | `NOT NULL` — total quantity the customer ordered |
| `qty_available` | `numeric` | — | `NOT NULL` — units that were in stock |
| `qty_backordered` | `numeric` | — | `NOT NULL` — the shortfall (`qty_ordered − qty_available`) |
| `unit_price` | `numeric` | `0` | `NOT NULL` |
| `created_at` | `timestamptz` | `now()` | `NOT NULL` |

Index: `idx_backorder_items_backorder (backorder_id)`.

**RLS:** Both tables have **RLS enabled with NO policies**. All access happens via
the Supabase **service role** inside API routes; anon/authenticated clients cannot
read or write these tables directly.

### 3.2 `invoice-split-backorder-migration.sql` — columns added to `invoices`

| Column | Type | Default | Notes |
|---|---|---|---|
| `is_backorder` | `boolean` | `false` | `NOT NULL`. True when this invoice holds the exceeding-stock (backordered) portion of a split invoice. Index `idx_invoices_is_backorder`. |
| `parent_invoice_id` | `uuid` | `null` | `REFERENCES invoices(id) ON DELETE SET NULL`. For a backorder invoice, the primary (in-stock) invoice it was split from. Index `idx_invoices_parent`. |

> The backorder invoice is the one that shows up in the Backorders tab — a
> `backorders` row is created against it, not against the primary invoice.

---

## 4. Functions and server logic

### 4.1 `computeStockSplit(lines, stockMap)` — `lib/admin/invoice-split.ts`

Splits an invoice's line items into in-stock and backordered portions at creation
time.

```ts
function computeStockSplit(lines: SplitLine[], stockMap: Map<string, number>): StockSplit
```

**Behavior:**

- Allocates `stockMap` (product_id → available units) across `lines` **greedily in
  line order**, so multiple lines referencing the same product never over-allocate
  the same units (`remaining` is decremented as it goes).
- Lines **without** a `product_id` (custom items) are always treated as fully in
  stock.
- For each product line: `inQty = min(li.qty, available)`, `backQty = li.qty − inQty`.
  - `inQty > 0` → pushed to `inStock` with `line_total` recomputed.
  - `backQty > 0` → pushed to `backordered` (recomputed `line_total`) **and** a
    `backorderItems` entry is produced (`qty_ordered`, `qty_available = inQty`,
    `qty_backordered = backQty`, `unit_price`).
- `lineTotal(qty, unitPrice, discountPct) = qty * unitPrice * (1 − discountPct/100)`
  rounded to 2 decimals.

**Returns** `{ inStock, backordered, backorderItems }`.

### 4.2 `syncInvoiceBackorder(db, invoiceId, lineItems)` — `lib/admin/backorder-sync.ts`

Recomputes the **open** backorder for an existing invoice from its current line
items. Called when an invoice is edited.

```ts
async function syncInvoiceBackorder(
  db: SupabaseClient,
  invoiceId: string,
  lineItems: BackorderLineInput[],   // { product_id, description, qty, unit_price? }
): Promise<void>
```

**Behavior:**

1. Deletes any existing **open** backorder(s) for the invoice (cascades to items).
   Already-`fulfilled` backorders are **left untouched as history**.
2. Considers only lines with a `product_id`. Looks up each product's current
   `stock_quantity`.
3. A line is backordered when `qty − available > 0`; builds `backorder_items`
   accordingly.
4. If any items are backordered, inserts a new `backorders` row (`status='open'`)
   and its items.

**Best-effort contract:** it must **never** fail the surrounding invoice operation
— callers wrap it in `.catch()` and it logs errors rather than throwing upward.

### 4.3 Backorder "flush" on PO creation — `app/api/admin/purchase-orders/route.ts`

When a Purchase Order is created with a `backorder_id` in the body, after the PO
and its items are inserted the route flushes the backorder:

```ts
await supabase
  .from("backorders")
  .update({
    status: "fulfilled",
    purchase_order_id: po.id,
    fulfilled_at: new Date().toISOString(),
  })
  .eq("id", backorder_id)
  .eq("status", "open");   // only an OPEN backorder is flushed
```

This is guarded by `.eq("status", "open")` so re-submission can't re-flush an
already-fulfilled backorder. Errors are logged, not fatal.

---

## 5. API endpoints

All routes use the Supabase **service role** client and an admin/assistant guard.
The backorders routes (`/api/admin/backorders/**`) authorize via a local
`requireStaff(request)` helper: Bearer token → `supabase.auth.getUser(token)` →
look up `customers.role` → allow when role is `admin` or `assistant` (else 403).

### 5.1 `GET /api/admin/backorders?status=open|fulfilled|cancelled`

List backorders for a status (defaults to `open`; invalid values fall back to
`open`). Joins each row to its invoice (with customer fallback), its
`backorder_items`, and the fulfilling purchase order. Ordered by `created_at`
descending.

Each returned row is augmented with:
- `customer_name_display` — `invoice.customer_name`, else joined customer first/last name.
- `customer_email_display` — `invoice.customer_email`, else joined `customer.email`.
- `item_count` — number of backorder items.
- `total_backordered` — sum of `qty_backordered` across items.

Response: `{ backorders: [...] }`. Errors → 500 `{ error }`.

### 5.2 `GET /api/admin/backorders/[id]`

A single backorder with `invoice(id, invoice_number)` and its `items` — used to
**prefill a PO draft**. Returns `{ backorder }`. Missing → 404 `{ error: "Not found" }`.

### 5.3 `GET /api/admin/backorders/count`

`{ count }` of **open** backorders (`head: true, count: 'exact'`). Powers the nav
badge. Errors → 500 `{ error }`.

### 5.4 Where backorders are written

- **`POST /api/admin/invoices`** — at creation, runs `computeStockSplit`; if there
  is a shortfall, creates the backorder invoice and the `backorders` +
  `backorder_items` rows. (See §6.)
- **`PATCH /api/admin/invoices/[id]`** — on edit of a **non-backorder** invoice,
  calls `syncInvoiceBackorder(...)` to recompute the open backorder. Backorder
  invoices are skipped (their backorder was created at split time).
- **`POST /api/admin/purchase-orders`** — when `backorder_id` is present, flushes
  the backorder to `fulfilled`. (See §4.3.)

---

## 6. Invoice-creation split flow (`POST /api/admin/invoices`)

1. Look up current `stock_quantity` for all product-bearing lines into `stockMap`.
2. `const { inStock, backordered, backorderItems } = computeStockSplit(cleaned, stockMap)`.
3. **No shortfall** (`backordered.length === 0`): insert a single invoice exactly
   as before; return `{ invoice }` (201).
4. **Shortfall** — split:
   - If `inStock.length > 0`, insert the **primary** invoice with the requested
     `status`, shipping, `is_backorder=false`, `parent_invoice_id=null`.
   - Insert the **backorder invoice**: `status` is forced to **`draft`** regardless
     of the requested status (the backordered portion can't be fulfilled yet, so no
     stock is decremented), `is_backorder=true`, `parent_invoice_id = primary?.id`.
     Shipping rides on the primary; if everything is backordered (no primary),
     shipping defaults onto the backorder invoice.
   - Insert a `backorders` row (`status='open'`) against the backorder invoice and
     insert `backorder_items` from `backorderItems`.
   - Return `{ invoice: primary ?? backInvoice, backorder_invoice: backInvoice, split: true }` (201).

Per-invoice side effects (shared by both halves via `insertInvoice`): commission
row (when a sales person + amount), stock decrement via `adjust_stock_for_invoice`
+ low-stock check when `status === 'paid'`, and an `invoice.create` audit entry.

### Invoice form behavior (`components/admin/InvoiceForm.tsx`)

- Over-stock lines surface an inline warning: `"Only {stock} in stock — will backorder"`.
- **Drafts** always allow over-stock (you may be invoicing arriving stock).
- **Sent** invoices warn-and-confirm rather than hard-blocking, via a
  **"Backorder confirmation"** modal ("One or more line items exceed available
  stock. Sending this invoice now will create a backorder.") with a primary
  **"Send and backorder"** action.
- After create, if the response has `split && backorder_invoice`, the form routes
  to `/admin/backorders`; otherwise to the new invoice.

---

## 7. Fulfilling a backorder → Purchase Order

The "Fulfill" button on an open backorder deep-links to:

```
/admin/purchase-orders/new?backorder=<backorder_id>
```

**`app/(admin)/admin/purchase-orders/new/page.tsx`:**

- Reads `?backorder=<id>`, fetches `GET /api/admin/backorders/[id]`, and maps each
  item into a prefilled PO draft line: `qty = qty_backordered` (the shortfall is
  what needs purchasing), `unit_price = 0` (staff fill in cost), description and
  `product_id` carried over.
- Shows a bronze banner: *"Fulfilling the backorder for invoice {invoice_number}.
  The backordered quantities are prefilled below — pick a supplier, set costs, and
  create the PO to clear the backorder."*
- Renders `<PurchaseOrderForm mode="create" backorder={prefill} />`.

**`PurchaseOrderForm`** includes `backorder_id: backorder?.backorder_id` in the
`POST /api/admin/purchase-orders` body. On the server, that triggers the flush
(§4.3). After create, the form routes to the new PO. The fulfilled backorder then
appears under the **History** tab, linked to the PO.

---

## 8. Admin panel — the Backorders page (`/admin/backorders`)

File: `app/(admin)/admin/backorders/page.tsx`. Client component.

### Header
`<PackageX>` (bronze) + **"Backorders"** title. Subtitle: *"Invoice line items
ordered beyond available stock."*

### Tabs
Two tabs: **Open** and **History** (`'fulfilled'`). Switching the tab refetches
`GET /api/admin/backorders?status=<tab>`. The auth header carries the current
Supabase session access token.

### Table (`min-w-[820px]`)
Columns: `Invoice`, `Customer`, `Backordered items`, `Invoice total`,
`Invoice status`, then `Created` (Open tab) or `Fulfilled` (History tab), then an
unlabeled action column.

- **Invoice** — `invoice_number` linking to `/admin/invoices/{invoice.id}` (mono
  font); `—` if no invoice.
- **Customer** — `customer_name_display`, with `customer_email_display` beneath.
- **Backordered items** — `"{item_count} item(s) · {total_backordered} unit(s)"`
  (pluralized) plus a muted comma-joined summary `"{description} ×{qty_backordered}"`.
- **Invoice total** — `$total` (2 dp); `—` if no invoice.
- **Invoice status** — `INVOICE_STATUS_META` badge (from `lib/admin/invoice-status`).
- **Created / Fulfilled** — locale date of `created_at` (Open) or `fulfilled_at` (History).
- **Action:**
  - **Open tab** → dark **"Fulfill"** button (`<Wrench>`) →
    `router.push('/admin/purchase-orders/new?backorder={id}')`.
  - **History tab** → if a PO is linked, a surface "{po_number}" link
    (`<ClipboardList>`) to `/admin/purchase-orders/{po.id}`; else muted
    **"PO removed"** (`<ExternalLink>`) when the PO was deleted (FK `SET NULL`).

### States
- **Loading:** spinner + "Loading…" row.
- **Empty:** Open → "No open backorders 🎉"; History → "No fulfilled backorders yet".

### Navigation badge (`app/(admin)/admin/layout.tsx`)
- Nav item: `{ href: '/admin/backorders', label: 'Backorders', icon: PackageX }`.
- A `useEffect` (admin/assistant only) fetches `GET /api/admin/backorders/count`
  and stores `backorderCount`; it re-runs on navigation (`pathname`) so the badge
  refreshes after fulfilling a backorder or editing an invoice.
- When `backorderCount > 0`, a red badge (`bg-red-500`) shows the open count next
  to the Backorders nav item.

---

## 9. File map

| File | Role |
|---|---|
| `backorders-migration.sql` | `backorders` + `backorder_items` tables, indexes, RLS |
| `invoice-split-backorder-migration.sql` | `invoices.is_backorder` + `invoices.parent_invoice_id` columns |
| `lib/admin/invoice-split.ts` | `computeStockSplit` — split lines into in-stock / backordered |
| `lib/admin/backorder-sync.ts` | `syncInvoiceBackorder` — recompute open backorder on edit |
| `app/api/admin/backorders/route.ts` | `GET` list by status |
| `app/api/admin/backorders/[id]/route.ts` | `GET` single backorder (PO prefill) |
| `app/api/admin/backorders/count/route.ts` | `GET` open count (nav badge) |
| `app/api/admin/invoices/route.ts` | `POST` create — split + create backorder |
| `app/api/admin/invoices/[id]/route.ts` | `PATCH` edit — `syncInvoiceBackorder` |
| `app/api/admin/purchase-orders/route.ts` | `POST` create — flush backorder via `backorder_id` |
| `app/(admin)/admin/backorders/page.tsx` | Backorders admin page (Open / History) |
| `app/(admin)/admin/purchase-orders/new/page.tsx` | PO draft prefilled from a backorder |
| `app/(admin)/admin/purchase-orders/PurchaseOrderForm.tsx` | Sends `backorder_id` on create |
| `components/admin/InvoiceForm.tsx` | Over-stock warning + "Backorder confirmation" modal |
| `app/(admin)/admin/layout.tsx` | Nav item + open-backorder count badge |

---

## 10. Key invariants & gotchas

- **Authorization:** all backorder access is admin/assistant only, via the service
  role; the tables have RLS on with no policies, so direct client access is blocked.
- **Open is unique-ish per invoice:** `syncInvoiceBackorder` and the split flow
  treat the **open** backorder as replaceable; fulfilled ones are permanent history.
- **Backorder invoices start as `draft`** and **never decrement stock** — only the
  in-stock primary invoice can be `paid`/decrement inventory.
- **Flush is idempotent-safe:** the PO flush only updates backorders that are still
  `open` (`.eq("status","open")`).
- **PO deletion is non-destructive to history:** `purchase_order_id` is
  `ON DELETE SET NULL`, so a fulfilled backorder survives PO deletion and the page
  shows "PO removed".
- **`cancelled` status exists in the schema** but no current code path sets it; it's
  reserved for future use.
- **Best-effort recompute:** `syncInvoiceBackorder` must never fail the invoice
  operation; callers wrap it in `.catch()`.
