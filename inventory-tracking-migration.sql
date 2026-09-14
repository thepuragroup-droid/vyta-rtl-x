-- ============================================================
-- PO FULFILLMENT → INVENTORY TRACKING
-- ============================================================
--
-- Marks a purchase order's `inventory_applied` flag so we only ever
-- increment stock once per PO, even if the status is toggled
-- fulfilled → pending → fulfilled. Stock decrements come from
-- existing `adjustInventory(... 'sale' ...)` flow.

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS inventory_applied boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS inventory_applied_at timestamptz;

-- Existing fulfilled POs were created before this column existed.
-- We DON'T retroactively apply them (could double-count); leave the
-- flag false so it's clear they were not run through the new flow.
