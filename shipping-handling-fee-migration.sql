-- Shipping handling/packing fee
-- Adds an admin-configurable markup applied on top of live Easyship rates to
-- cover packing and other manual labour. The fee is folded into the quoted
-- shipping price at checkout — it is never shown to the customer as a separate
-- line item.
--
-- NOTE: lib/easyship.ts reads these columns defensively (via select '*'), so
-- shipping still works if this migration has not been run — the handling fee
-- simply defaults to 0. Run this in the Supabase SQL editor to enable the fee.

ALTER TABLE site_settings
  -- 'flat' = a fixed CAD amount, 'pct' = a percentage of the live rate.
  ADD COLUMN IF NOT EXISTS shipping_handling_fee_type TEXT DEFAULT 'flat',
  -- CAD dollars when type is 'flat', percentage points when type is 'pct'.
  ADD COLUMN IF NOT EXISTS shipping_handling_fee_value NUMERIC DEFAULT 0;

COMMENT ON COLUMN site_settings.shipping_handling_fee_type IS 'Handling fee mode: "flat" (CAD amount) or "pct" (% of live rate).';
COMMENT ON COLUMN site_settings.shipping_handling_fee_value IS 'Handling fee added on top of live Easyship rates; baked into the quoted price, never shown separately.';
