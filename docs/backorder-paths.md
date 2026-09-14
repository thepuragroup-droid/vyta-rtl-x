# Backorder paths — two systems, clear demarcation

Aminocan has **two distinct code paths** that touch `backorders` /
`backorder_items` / child invoices. They serve different stories and must
not be conflated. This doc documents the boundary so future contributors
don't merge them by mistake.

## Path A — Invoice-driven backorder (Cluster 6)

**Owner:** the admin invoice flow.
**Lib:** `lib/admin/backorder-sync.ts → syncInvoiceBackorder(db, invoiceId, lineItems)`.
**Trigger:** `POST /api/admin/invoices` (split-on-stock) and
`PATCH /api/admin/invoices/[id]` (edit recompute).
**What it writes:** rows in `backorders` + `backorder_items` describing the
demand shortfall for an existing parent invoice. No child invoice. The
admin will later open a Purchase Order from the backorders list to
restock and clear it.

**Lifecycle:**
1. Admin creates/edits an invoice with qty > stock.
2. `syncInvoiceBackorder` writes the `backorders` row + per-line shortfalls.
3. PO receiving (Cluster 7) increments stock + sets the backorder to
   `fulfilled`.

## Path B — Warehouse per-line backorder (Cluster 8)

**Owner:** the warehouse fulfillment flow.
**Lib:** `lib/warehouse/server.ts → getOrCreateBackorderInvoice(db, parentInvoiceId)`
+ `applyLineAction(action='backorder')`.
**Trigger:** `POST /api/warehouse/queue/[id]/line` with `action='backorder'`.
**What it writes:** a **non-payable draft child invoice**
(`parent_invoice_id`, `is_backorder=true`, `non_payable=true`) plus its own
`invoice_line_items` for the held-back qty, AND a `backorders` ledger row
linking the parent to the child.

**Lifecycle:**
1. Warehouse staff hits "Backorder N" on a line they can't fully fulfill.
2. A single bound child invoice is created (or reused) under
   `parent_invoice_id`. The held qty is moved into a line on the child;
   the original line gets `qty_backordered` bumped.
3. Stock arrives later → admin issues the child invoice as its own
   document. The original parent ships its fulfilled portion immediately.

## Boundary rule

**Both paths write to `backorders`.** That's intentional — the table is
the unified ledger. But they answer different questions:

| Question | Path | Source |
|---|---|---|
| "Why is this invoice short on stock when issued?" | A | invoice split / edit |
| "What can the warehouse skip and hold for later shipment?" | B | per-line backorder during pick |

A single parent invoice can have **both**: an A-row from the original
split, plus a B-row + child invoice if the warehouse can't fulfill the
remaining portion. They don't conflict because they describe different
shortfall sources.

## Don't do this

- ❌ Do not call `syncInvoiceBackorder` from the warehouse routes — it
  belongs to the admin flow and assumes invoice-level demand math.
- ❌ Do not call `getOrCreateBackorderInvoice` from `/api/admin/invoices`
  — it assumes a fulfillment-time context where a child invoice makes
  sense.
- ❌ Do not unify into a single helper without first agreeing on the
  semantics: a unified helper would have to know which trigger fired,
  which gets you back to the same two branches anyway.

## Open follow-ups

- Cancellation of a `backorders` row was missing until this work;
  `PATCH /api/admin/backorders/[id]` now supports `status='cancelled'`.
  Neither Path A nor Path B sets it automatically — admins do this when
  the underlying need disappears.
- Path B's `getOrCreateBackorderInvoice` does NOT delete the child
  invoice if all of its lines are later removed (rare). The empty child
  stays as a draft and admins can delete it manually.
