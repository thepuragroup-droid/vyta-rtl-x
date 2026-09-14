-- ============================================================
-- PURCHASE ORDER RECEIPT → PRODUCT HISTORY MIGRATION
-- Depends on: purchase-orders-receiving-migration.sql, product-history-migration.sql
-- ============================================================
--
-- Receiving stock against a purchase order already increments
-- products.stock_quantity and appends an inventory_log row, but it never
-- wrote to product_history. That left a hole in the ledger the Stock Change
-- Report reads from: sales showed up (source 'order_confirmed' /
-- 'invoice_paid') while the stock arriving to cover them did not, so the
-- report's "Received" column was permanently zero and every restock landed
-- in "Adjusted" only if an admin happened to type it in by hand.
--
-- This migration redefines the two receiving functions so each stock
-- increment also appends a product_history row with source 'po_receipt'.
-- Nothing else about them changes: same signatures, same idempotency guards,
-- same status derivation, same over-receipt checks.
--
-- product_history.source carries no CHECK constraint (see
-- invoice-spec-integration-migration.sql), so 'po_receipt' inserts freely and
-- there is nothing to widen.
--
-- Safe to run more than once — both statements are CREATE OR REPLACE.

-- ---- 1. apply_po_inventory() — all-at-once apply ------------------------
CREATE OR REPLACE FUNCTION apply_po_inventory(p_po_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_applied     boolean;
  v_actor       uuid;
  v_actor_email text;
  v_old         integer;
  v_new         integer;
  r             record;
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

  SELECT email INTO v_actor_email FROM customers WHERE id = v_actor;

  FOR r IN
    SELECT product_id, qty
      FROM purchase_order_items
     WHERE purchase_order_id = p_po_id
       AND product_id IS NOT NULL
  LOOP
    UPDATE products
       SET stock_quantity = COALESCE(stock_quantity, 0) + r.qty
     WHERE id = r.product_id
    RETURNING stock_quantity - r.qty, stock_quantity INTO v_old, v_new;

    INSERT INTO inventory_log
      (product_id, change_qty, delta, reason, reference_type, reference_id, created_by)
    VALUES
      (r.product_id, r.qty, r.qty, 'restock', 'purchase_order', p_po_id::text, v_actor);

    INSERT INTO product_history
      (product_id, change_type, field, old_value, new_value,
       source, reference_type, reference_id, note, actor_id, actor_email)
    VALUES
      (r.product_id, 'stock', 'stock_quantity', v_old::text, v_new::text,
       'po_receipt', 'purchase_order', p_po_id::text,
       'Stock increased by ' || r.qty || ' when the purchase order was applied',
       v_actor, v_actor_email);
  END LOOP;

  UPDATE purchase_orders
     SET inventory_applied = true,
         inventory_applied_at = now()
   WHERE id = p_po_id;
END;
$$;

-- ---- 2. receive_po_items() — incremental receive ------------------------
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
  v_status      text;
  v_receipt_id  uuid;
  v_count       integer := 0;
  v_total       integer;
  v_received    integer;
  v_new_status  text;
  v_actor_email text;
  v_old         integer;
  v_new         integer;
  elem          jsonb;
  v_item_id     uuid;
  v_qty         integer;
  v_remaining   integer;
  v_item_qty    integer;
  v_item_recv   integer;
  v_prod        uuid;
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

  SELECT email INTO v_actor_email FROM customers WHERE id = p_actor;

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
         SET stock_quantity = COALESCE(stock_quantity, 0) + v_qty
       WHERE id = v_prod
      RETURNING stock_quantity - v_qty, stock_quantity INTO v_old, v_new;

      INSERT INTO inventory_log
        (product_id, change_qty, delta, reason, reference_type, reference_id, created_by)
      VALUES
        (v_prod, v_qty, v_qty, 'restock', 'purchase_order_receipt', v_receipt_id::text, p_actor);

      INSERT INTO product_history
        (product_id, change_type, field, old_value, new_value,
         source, reference_type, reference_id, note, actor_id, actor_email)
      VALUES
        (v_prod, 'stock', 'stock_quantity', v_old::text, v_new::text,
         'po_receipt', 'purchase_order_receipt', v_receipt_id::text,
         'Stock increased by ' || v_qty || ' when the purchase order was received',
         p_actor, v_actor_email);
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
