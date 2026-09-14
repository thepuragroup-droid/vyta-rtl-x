-- ============================================================
-- PuraMass (Stealth Health) hosted checkout — buyer-picked shipping
-- ============================================================
--
-- PuraMass now accepts `shipping_total_cents` on the order it creates, so the
-- shipping a hosted buyer pays is ours to set rather than a flat fee. The
-- checkout quotes Easyship for the address the buyer types, offers the fastest
-- UPS / FedEx / Canada Post services, and sends the chosen amount with the
-- hand-off.
--
-- Adds:
--   1. site_settings.puramass_shipping_rates_enabled   — the admin toggle
--   2. site_settings.puramass_flat_shipping            — the flat fee amount
--   3. site_settings.puramass_free_shipping_enabled    — free-shipping promo
--   4. site_settings.puramass_free_shipping_threshold  — subtotal that unlocks it
--   5. puramass_orders.shipping_total_cents            — what we charged
--   6. puramass_orders.shipping_courier                — who they picked
--   7. puramass_orders.shipping_courier_id             — the service to book
--
-- The processing fee folded into every quoted rate is NOT new: it reuses the
-- existing site_settings.shipping_handling_fee_type / _value pair from
-- shipping-handling-fee-migration.sql, shown in Site Settings as
-- "Processing fee". It defaults to 0 and is never itemised for the buyer.
--
-- Idempotent: safe to re-run. Every call site reads these columns defensively
-- (see lib/payments/puramass-settings.ts and lib/payments/puramass-columns.ts),
-- so the checkout keeps working on the flat fee until this has been run.
--
-- Run this in the Supabase SQL editor (same as every other *-migration.sql).

-- 1. Admin toggle on the singleton site_settings row ---------------------
-- Off by default: an existing store keeps charging the flat fee until an admin
-- turns live rates on and has confirmed the Easyship origin/box settings.
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS puramass_shipping_rates_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN site_settings.puramass_shipping_rates_enabled IS
  'Let hosted-checkout buyers pick a live courier rate. Off = flat shipping fee.';

-- 1b. The flat fee itself, in CAD -----------------------------------------
-- Charged when live rates are off, and as the fallback when a quote can't be
-- had. 35 keeps the amount every hosted sale has been recorded with; it is a
-- setting rather than a constant so it can be changed without a deploy.
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS puramass_flat_shipping NUMERIC NOT NULL DEFAULT 35;

COMMENT ON COLUMN site_settings.puramass_flat_shipping IS
  'Flat hosted-checkout shipping fee in CAD, used when live courier rates are off or unavailable.';

-- 1c. Free-shipping promo -------------------------------------------------
-- Spend `puramass_free_shipping_threshold` (CAD, before shipping) and the
-- shipping total sent to PuraMass is zero, whichever courier the buyer picked.
--
-- Only meaningful with live rates on: with the flat fee there is no address
-- and no courier, so the promo is forced off in code whenever
-- puramass_shipping_rates_enabled is false (see lib/payments/puramass-settings.ts)
-- regardless of what is stored here.
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS puramass_free_shipping_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS puramass_free_shipping_threshold NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN site_settings.puramass_free_shipping_enabled IS
  'Free shipping once the cart subtotal reaches puramass_free_shipping_threshold. Requires live courier rates.';
COMMENT ON COLUMN site_settings.puramass_free_shipping_threshold IS
  'Cart subtotal in CAD (goods only) that unlocks free shipping on the hosted checkout.';

-- 2. What the buyer actually paid for shipping ---------------------------
-- Recorded at hand-off, in cents of the order currency, so the fulfillment
-- invoice can stamp the real shipping cost instead of the flat fallback.
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS shipping_total_cents INTEGER;

COMMENT ON COLUMN puramass_orders.shipping_total_cents IS
  'Shipping sent to PuraMass with the hand-off, in cents of `currency`.';

-- 3. Which courier they chose -------------------------------------------
-- Free text ("UPS · Express Saver"), for the warehouse and for reconciling a
-- label against what the buyer was quoted. Null on older hand-offs.
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS shipping_courier TEXT;

COMMENT ON COLUMN puramass_orders.shipping_courier IS
  'Courier + service the buyer chose at checkout, or null for the flat fee.';

-- 4. The Easyship service id behind that choice --------------------------
-- The buyer paid for a specific service, so the shipment booked when the order
-- is paid is booked with that same one rather than re-picking by preference.
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS shipping_courier_id TEXT;

COMMENT ON COLUMN puramass_orders.shipping_courier_id IS
  'Easyship courier_service_id the buyer paid for, booked when the order is paid. Null for the flat fee.';
