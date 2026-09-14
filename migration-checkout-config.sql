-- ============================================================
-- CHECKOUT CONFIG — pickup + guest checkout
-- ============================================================
--
-- Adds storefront checkout knobs to the site_settings singleton and the
-- per-customer pickup/shipping allowances consumed by checkout.

ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS pickup_address TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS guest_checkout_enabled BOOLEAN DEFAULT true;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS allow_pickup BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_shipping BOOLEAN DEFAULT true;
