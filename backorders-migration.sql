-- ============================================================
-- BACKORDERS
-- ============================================================
--
-- Captures the portion of an invoice that was ordered beyond the product's
-- currently available stock. A backorder gives staff a worklist of "things
-- we still owe the customer" and a one-click path to order the missing stock
-- from a supplier (see app/(admin)/admin/purchase-orders/new).
--
-- A backorder is created at invoice creation (invoice split) or recomputed on
-- invoice edit (lib/admin/backorder-sync.ts), and is "flushed" to `fulfilled`
-- when a purchase order is created from it.
--
-- Idempotent: safe to run multiple times. Resilient to a pre-existing,
-- partially-defined `backorders` table (each column is added if missing).

CREATE TABLE IF NOT EXISTS backorders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id         uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  status             text NOT NULL DEFAULT 'open',
  purchase_order_id  uuid REFERENCES purchase_orders(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  fulfilled_at       timestamptz
);

-- Backfill any columns missing from an older/partial `backorders` table.
ALTER TABLE backorders ADD COLUMN IF NOT EXISTS invoice_id        uuid;
ALTER TABLE backorders ADD COLUMN IF NOT EXISTS status            text NOT NULL DEFAULT 'open';
ALTER TABLE backorders ADD COLUMN IF NOT EXISTS purchase_order_id uuid;
ALTER TABLE backorders ADD COLUMN IF NOT EXISTS created_at        timestamptz NOT NULL DEFAULT now();
ALTER TABLE backorders ADD COLUMN IF NOT EXISTS fulfilled_at      timestamptz;

-- Constraints / FKs (added only if absent, so re-runs and fresh installs match).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'backorders_status_check') THEN
    ALTER TABLE backorders ADD CONSTRAINT backorders_status_check
      CHECK (status IN ('open', 'fulfilled', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'backorders_invoice_id_fkey') THEN
    ALTER TABLE backorders ADD CONSTRAINT backorders_invoice_id_fkey
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'backorders_purchase_order_id_fkey') THEN
    ALTER TABLE backorders ADD CONSTRAINT backorders_purchase_order_id_fkey
      FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_backorders_status ON backorders (status);
CREATE INDEX IF NOT EXISTS idx_backorders_invoice ON backorders (invoice_id);

COMMENT ON TABLE backorders IS 'Per-invoice record of line quantities ordered beyond available stock.';
COMMENT ON COLUMN backorders.purchase_order_id IS 'The PO that fulfilled this backorder; set when flushed. SET NULL on PO delete so history survives.';
COMMENT ON COLUMN backorders.fulfilled_at IS 'Stamped when the fulfilling purchase order is created.';

CREATE TABLE IF NOT EXISTS backorder_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backorder_id     uuid NOT NULL REFERENCES backorders(id) ON DELETE CASCADE,
  product_id       uuid REFERENCES products(id) ON DELETE SET NULL,
  description      text NOT NULL,
  qty_ordered      numeric NOT NULL,
  qty_available    numeric NOT NULL,
  qty_backordered  numeric NOT NULL,
  unit_price       numeric NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Backfill any columns missing from an older/partial `backorder_items` table.
ALTER TABLE backorder_items ADD COLUMN IF NOT EXISTS backorder_id    uuid;
ALTER TABLE backorder_items ADD COLUMN IF NOT EXISTS product_id      uuid;
ALTER TABLE backorder_items ADD COLUMN IF NOT EXISTS description     text;
ALTER TABLE backorder_items ADD COLUMN IF NOT EXISTS qty_ordered     numeric;
ALTER TABLE backorder_items ADD COLUMN IF NOT EXISTS qty_available   numeric;
ALTER TABLE backorder_items ADD COLUMN IF NOT EXISTS qty_backordered numeric;
ALTER TABLE backorder_items ADD COLUMN IF NOT EXISTS unit_price      numeric NOT NULL DEFAULT 0;
ALTER TABLE backorder_items ADD COLUMN IF NOT EXISTS created_at      timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'backorder_items_backorder_id_fkey') THEN
    ALTER TABLE backorder_items ADD CONSTRAINT backorder_items_backorder_id_fkey
      FOREIGN KEY (backorder_id) REFERENCES backorders(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'backorder_items_product_id_fkey') THEN
    ALTER TABLE backorder_items ADD CONSTRAINT backorder_items_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_backorder_items_backorder ON backorder_items (backorder_id);

COMMENT ON COLUMN backorder_items.qty_ordered IS 'Total quantity the customer ordered for this line.';
COMMENT ON COLUMN backorder_items.qty_available IS 'Units that were in stock at split time.';
COMMENT ON COLUMN backorder_items.qty_backordered IS 'The shortfall (qty_ordered - qty_available).';

-- RLS on with NO policies: all access flows through the Supabase service role
-- inside /api/admin/backorders/** routes. anon/authenticated clients are blocked.
ALTER TABLE backorders ENABLE ROW LEVEL SECURITY;
ALTER TABLE backorder_items ENABLE ROW LEVEL SECURITY;
