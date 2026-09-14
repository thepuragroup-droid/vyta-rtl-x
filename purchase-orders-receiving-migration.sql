-- ============================================================
-- PURCHASE ORDER — RECEIVING MIGRATION
-- Depends on: purchase-orders-migration.sql, products, inventory_log
-- ============================================================
--
-- Adds incremental "receiving" of stock against a purchase order:
--   * purchase_order_items.qty_received  — how much of a line has landed
--   * purchase_order_receipts            — one row per dated receiving event
--   * purchase_order_receipt_items       — what was received in that event
--   * receive_po_items()                 — atomic receive (stock + status + log)
--   * apply_po_inventory()               — all-at-once apply for create-as-fulfilled
--
-- Stock is the source of truth on products.stock_quantity (the rest of the
-- platform moved off product_variants — see simplify-product-stock-migration).

-- ---- 1. Line-level received counter -------------------------------------
ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS qty_received integer NOT NULL DEFAULT 0
    CHECK (qty_received >= 0),
  ADD COLUMN IF NOT EXISTS created_at   timestamptz NOT NULL DEFAULT now();

-- ---- 2. inventory_log shape (products-based ledger) ---------------------
-- The legacy inventory_log predates this module (variant-based, NOT NULL).
-- Reshape it so the PO functions can write product-keyed restock rows.
ALTER TABLE inventory_log
  ADD COLUMN IF NOT EXISTS product_id     uuid REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reference_type text,
  ADD COLUMN IF NOT EXISTS delta          integer;

ALTER TABLE inventory_log ALTER COLUMN variant_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_log_product_id ON inventory_log(product_id);

-- ---- 3. Receiving events -------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_order_receipts (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid        NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  note              text,
  created_by        uuid        REFERENCES customers(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_order_receipt_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id  uuid        NOT NULL REFERENCES purchase_order_receipts(id) ON DELETE CASCADE,
  po_item_id  uuid        NOT NULL REFERENCES purchase_order_items(id) ON DELETE CASCADE,
  product_id  uuid        REFERENCES products(id) ON DELETE SET NULL,
  qty         integer     NOT NULL CHECK (qty > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_receipts_po_id        ON purchase_order_receipts(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_receipt_items_receipt ON purchase_order_receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_po_receipt_items_po_item ON purchase_order_receipt_items(po_item_id);

-- ---- 4. apply_po_inventory() — all-at-once apply ------------------------
-- Used when a PO is created directly as 'fulfilled'. Idempotent via
-- inventory_applied. Single SQL block so concurrent sales can't race the
-- read-modify-write.
CREATE OR REPLACE FUNCTION apply_po_inventory(p_po_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_applied boolean;
  v_actor   uuid;
  r         record;
BEGIN
  SELECT inventory_applied, created_by
    INTO v_applied, v_actor
    FROM purchase_orders
   WHERE id = p_po_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id;
  END IF;

  IF v_applied THEN
    RETURN;  -- already applied — idempotent
  END IF;

  FOR r IN
    SELECT product_id, qty
      FROM purchase_order_items
     WHERE purchase_order_id = p_po_id
       AND product_id IS NOT NULL
  LOOP
    UPDATE products
       SET stock_quantity = stock_quantity + r.qty
     WHERE id = r.product_id;

    INSERT INTO inventory_log
      (product_id, change_qty, delta, reason, reference_type, reference_id, created_by)
    VALUES
      (r.product_id, r.qty, r.qty, 'restock', 'purchase_order', p_po_id::text, v_actor);
  END LOOP;

  UPDATE purchase_orders
     SET inventory_applied = true,
         inventory_applied_at = now()
   WHERE id = p_po_id;
END;
$$;

-- ---- 5. receive_po_items() — incremental receive -----------------------
-- p_items :: [{ po_item_id, qty }, ...]. One transaction: lock PO, write a
-- receipt header, per-line guard against over-receipt, bump qty_received,
-- increment products.stock_quantity, append inventory_log, derive status.
CREATE OR REPLACE FUNCTION receive_po_items(
  p_po_id  uuid,
  p_actor  uuid,
  p_note   text,
  p_items  jsonb
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_status     text;
  v_receipt_id uuid;
  v_count      integer := 0;
  v_total      integer;
  v_received   integer;
  v_new_status text;
  elem         jsonb;
  v_item_id    uuid;
  v_qty        integer;
  v_remaining  integer;
  v_item_qty   integer;
  v_item_recv  integer;
  v_prod       uuid;
BEGIN
  SELECT status INTO v_status
    FROM purchase_orders
   WHERE id = p_po_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id;
  END IF;

  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot receive against a cancelled purchase order';
  END IF;

  INSERT INTO purchase_order_receipts (purchase_order_id, note, created_by)
  VALUES (p_po_id, p_note, p_actor)
  RETURNING id INTO v_receipt_id;

  FOR elem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := (elem->>'po_item_id')::uuid;
    v_qty     := COALESCE((elem->>'qty')::integer, 0);

    IF v_qty <= 0 THEN
      CONTINUE;
    END IF;

    SELECT qty, qty_received, product_id
      INTO v_item_qty, v_item_recv, v_prod
      FROM purchase_order_items
     WHERE id = v_item_id
       AND purchase_order_id = p_po_id
     FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_remaining := v_item_qty - v_item_recv;
    IF v_qty > v_remaining THEN
      RAISE EXCEPTION 'Over-receipt on line %: tried to receive %, only % remaining',
        v_item_id, v_qty, v_remaining;
    END IF;

    UPDATE purchase_order_items
       SET qty_received = qty_received + v_qty
     WHERE id = v_item_id;

    INSERT INTO purchase_order_receipt_items (receipt_id, po_item_id, product_id, qty)
    VALUES (v_receipt_id, v_item_id, v_prod, v_qty);

    IF v_prod IS NOT NULL THEN
      UPDATE products
         SET stock_quantity = stock_quantity + v_qty
       WHERE id = v_prod;

      INSERT INTO inventory_log
        (product_id, change_qty, delta, reason, reference_type, reference_id, created_by)
      VALUES
        (v_prod, v_qty, v_qty, 'restock', 'purchase_order_receipt', v_receipt_id::text, p_actor);
    END IF;

    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    DELETE FROM purchase_order_receipts WHERE id = v_receipt_id;
    RAISE EXCEPTION 'No valid items to receive';
  END IF;

  -- Derive status from totals received.
  SELECT COALESCE(SUM(qty), 0), COALESCE(SUM(qty_received), 0)
    INTO v_total, v_received
    FROM purchase_order_items
   WHERE purchase_order_id = p_po_id;

  IF v_status = 'paid' THEN
    v_new_status := 'paid';            -- paid stays paid (can still receive)
  ELSIF v_received >= v_total THEN
    v_new_status := 'fulfilled';
  ELSIF v_received > 0 THEN
    v_new_status := 'partially_fulfilled';
  ELSE
    v_new_status := 'pending';
  END IF;

  UPDATE purchase_orders
     SET status = v_new_status,
         inventory_applied = (v_received >= v_total),
         inventory_applied_at = CASE
           WHEN v_received >= v_total AND inventory_applied_at IS NULL THEN now()
           ELSE inventory_applied_at
         END
   WHERE id = p_po_id;

  RETURN v_receipt_id;
END;
$$;

-- ---- 6. Row Level Security ---------------------------------------------
ALTER TABLE purchase_order_receipts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_receipt_items ENABLE ROW LEVEL SECURITY;

-- Admin / assistant may read; writes happen only via service role / RPCs.
DROP POLICY IF EXISTS po_receipts_admin_read ON purchase_order_receipts;
CREATE POLICY po_receipts_admin_read ON purchase_order_receipts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM customers
      WHERE customers.id = auth.uid()
        AND customers.role IN ('admin', 'assistant')
    )
  );

DROP POLICY IF EXISTS po_receipt_items_admin_read ON purchase_order_receipt_items;
CREATE POLICY po_receipt_items_admin_read ON purchase_order_receipt_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM customers
      WHERE customers.id = auth.uid()
        AND customers.role IN ('admin', 'assistant')
    )
  );
