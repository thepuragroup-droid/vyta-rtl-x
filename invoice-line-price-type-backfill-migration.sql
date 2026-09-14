-- ============================================================================
-- INVOICE LINE price_type — BACKFILL (vial lines mis-tagged as "Box")
-- ============================================================================
--
-- WHY
-- ---
-- `invoice_line_items.price_type` was added as NOT NULL DEFAULT 'box'
-- (invoice-spec-integration-migration.sql, section 7). Two writers created
-- invoice lines without ever setting the column, so Postgres stamped 'box' on
-- every one of them:
--
--   * lib/payments/puramass-fulfillment.ts — PuraMass / Stealth Health
--     hand-offs (`invoices.source = 'stealth_health'`)
--   * lib/admin/order-invoice-server.ts    — storefront order → draft invoice
--
-- Every render surface treats the column as a two-state fact
-- (`price_type === 'vial' ? 'vial' : 'box'`), with no "unknown" branch, so an
-- unset value printed a confident "Box" chip on the admin invoice detail page,
-- the customer-facing invoice PDF/HTML, and the warehouse packing list — even
-- for a line whose own description said "(Single Vial)".
--
-- Both writers now set the column explicitly. This migration repairs the rows
-- they already wrote.
--
-- SAFETY
-- ------
-- Only ever promotes 'box' → 'vial', and only where the row carries positive
-- evidence that a single vial was sold. Nothing is demoted, so a deliberate
-- admin choice can never be clobbered and re-running is a no-op. No stock
-- figures move: adjust_stock_for_invoice() sums raw qty by product_id and does
-- not read price_type.
--
-- Idempotent and tolerant of un-migrated databases (the puramass_orders ledger
-- and its paid_items column are both existence-checked).
-- ============================================================================

DO $$
DECLARE
  v_pm_named   bigint := 0;
  v_pm_sku     bigint := 0;
  v_pm_name    bigint := 0;
  v_order_desc bigint := 0;
  v_has_ledger boolean;
  v_has_paid   boolean;
BEGIN
  -- Nothing to do if the invoice line table never got the column.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoice_line_items' AND column_name = 'price_type'
  ) THEN
    RAISE NOTICE 'invoice_line_items.price_type missing — run invoice-spec-integration-migration.sql first. Skipping.';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'puramass_orders'
  ) INTO v_has_ledger;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'puramass_orders' AND column_name = 'paid_items'
  ) INTO v_has_paid;

  -- --------------------------------------------------------------------
  -- 1. PuraMass lines — authoritative: the ledger's paid_items SKU.
  -- --------------------------------------------------------------------
  -- PuraMass encodes the unit in the SKU suffix ('…-vial' vs '…-case').
  -- Invoice lines carry no product_id, so match the line description against
  -- the paid_items name — exactly how /admin/invoices/[id] already resolves a
  -- line back to its PuraMass SKU.
  IF v_has_ledger AND v_has_paid THEN
    WITH vial_names AS (
      SELECT DISTINCT
        po.invoice_id,
        lower(btrim(pi.item->>'name')) AS item_name
      FROM puramass_orders po
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(po.paid_items) = 'array'
             THEN po.paid_items ELSE '[]'::jsonb END
      ) AS pi(item)
      WHERE po.invoice_id IS NOT NULL
        AND btrim(COALESCE(pi.item->>'name', '')) <> ''
        AND lower(btrim(COALESCE(pi.item->>'sku', ''))) LIKE '%-vial'
    )
    UPDATE invoice_line_items li
    SET price_type = 'vial'
    FROM invoices inv
    JOIN vial_names vn ON vn.invoice_id = inv.id
    WHERE li.invoice_id = inv.id
      AND inv.source = 'stealth_health'
      AND li.price_type IS DISTINCT FROM 'vial'
      AND lower(btrim(li.description)) = vn.item_name;
    GET DIAGNOSTICS v_pm_named = ROW_COUNT;
  ELSE
    RAISE NOTICE 'puramass_orders.paid_items unavailable — skipping the SKU-matched pass.';
  END IF;

  -- --------------------------------------------------------------------
  -- 2. PuraMass lines — the description IS the SKU.
  -- --------------------------------------------------------------------
  -- materializeStealthHealthFulfillment() falls back to `it.sku` when PuraMass
  -- reported no name, so some descriptions are the raw '…-vial' slug.
  UPDATE invoice_line_items li
  SET price_type = 'vial'
  FROM invoices inv
  WHERE li.invoice_id = inv.id
    AND inv.source = 'stealth_health'
    AND li.price_type IS DISTINCT FROM 'vial'
    AND lower(btrim(li.description)) LIKE '%-vial';
  GET DIAGNOSTICS v_pm_sku = ROW_COUNT;

  -- --------------------------------------------------------------------
  -- 3. PuraMass lines — the partner's own name suffix.
  -- --------------------------------------------------------------------
  -- Covers ledger rows predating paid_items, e.g.
  -- 'Aminocan- Retatrutide 10mg (Single Vial)'. Scoped to stealth_health so it
  -- can't catch a hand-typed admin description.
  UPDATE invoice_line_items li
  SET price_type = 'vial'
  FROM invoices inv
  WHERE li.invoice_id = inv.id
    AND inv.source = 'stealth_health'
    AND li.price_type IS DISTINCT FROM 'vial'
    AND btrim(li.description) ~* '\(\s*single\s+vial\s*\)$';
  GET DIAGNOSTICS v_pm_name = ROW_COUNT;

  -- --------------------------------------------------------------------
  -- 4. Storefront order → invoice lines.
  -- --------------------------------------------------------------------
  -- createInvoiceForOrder() already spelled the unit into the description as
  -- '<name> — Single vial' (em dash) for a `unit: 'vial'` cart line, then
  -- dropped the fact before the insert. Anchored to that exact suffix.
  UPDATE invoice_line_items li
  SET price_type = 'vial'
  WHERE li.price_type IS DISTINCT FROM 'vial'
    AND btrim(li.description) ~ '—\s*Single vial$';
  GET DIAGNOSTICS v_order_desc = ROW_COUNT;

  RAISE NOTICE 'price_type backfill → vial: % (puramass sku-matched), % (puramass sku-as-description), % (puramass name suffix), % (storefront order lines)',
    v_pm_named, v_pm_sku, v_pm_name, v_order_desc;
END $$;

-- ----------------------------------------------------------------------------
-- Verify — should return zero rows once the backfill has run.
-- ----------------------------------------------------------------------------
-- SELECT li.invoice_id, li.description, li.price_type
-- FROM invoice_line_items li
-- WHERE li.price_type = 'box'
--   AND (
--     btrim(li.description) ~* '\(\s*single\s+vial\s*\)$'
--     OR btrim(li.description) ~ '—\s*Single vial$'
--     OR lower(btrim(li.description)) LIKE '%-vial'
--   );
