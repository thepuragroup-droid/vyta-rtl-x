-- ============================================================
-- PuraMass orders in the customer account + default shipping fee
-- ============================================================
--
-- Paid PuraMass (Stealth Health) sales are materialised as `invoices`
-- (source = 'stealth_health'). The customer account/dashboard now surfaces
-- those invoices as orders (see lib/customer/api.ts). This migration makes the
-- HISTORICAL paid orders show up too, and brings older rows in line with the
-- new go-forward behaviour:
--
--   1. Link paid PuraMass invoices to a customer account by email, so they
--      appear under that customer's orders (many were placed before the
--      account link existed, or as a guest with a since-registered email).
--   2. Stamp the flat $35 USD shipment fee (and USD currency) on existing
--      PuraMass invoices that predate the fee, matching the value the
--      materialiser now writes for new orders.
--   3. Index invoices.source so the account query stays fast.
--
-- Idempotent: safe to re-run. Only touches source = 'stealth_health' rows.
-- Run this in the Supabase SQL editor (same as every other *-migration.sql).

-- 1. Link historical paid PuraMass invoices to a customer account by email ---
-- Only fills a missing customer_id; never overwrites an existing link. Matches
-- case-insensitively against the customers table (auth-backed accounts).
UPDATE invoices AS i
SET customer_id = c.id,
    updated_at  = now()
FROM customers AS c
WHERE i.source = 'stealth_health'
  AND i.customer_id IS NULL
  AND i.customer_email IS NOT NULL
  AND lower(i.customer_email) = lower(c.email);

-- 2. Backfill the flat $35 USD shipment fee on older PuraMass invoices --------
-- Go-forward, the materialiser writes shipping_cost = 35 / currency = 'USD'.
-- Bring existing rows (which were created with 0 shipping) up to the same shape.
-- Guarded on shipping_cost = 0 so re-running is a no-op once stamped.
UPDATE invoices
SET shipping_cost = 35,
    currency      = 'USD',
    total         = round((COALESCE(subtotal, 0) + 35 + COALESCE(tax_total, 0))::numeric, 2),
    updated_at    = now()
WHERE source = 'stealth_health'
  AND COALESCE(shipping_cost, 0) = 0;

-- 3. Speed up the per-customer PuraMass lookup on the account page -----------
CREATE INDEX IF NOT EXISTS idx_invoices_source ON invoices (source);

-- Verification (optional): paid PuraMass invoices now linked to a customer.
-- SELECT invoice_number, customer_email, customer_id, currency, shipping_cost, total
-- FROM invoices WHERE source = 'stealth_health' ORDER BY created_at DESC LIMIT 20;
