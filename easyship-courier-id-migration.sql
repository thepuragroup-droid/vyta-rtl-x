-- ============================================================
-- EASYSHIP SELECTED COURIER ID ON ORDERS
-- ============================================================
--
-- Stores the Easyship courier_service id chosen for an order (by the customer
-- at checkout or by an admin) so it can be applied as courier_service_id when
-- the shipping label is purchased. Without this, Easyship auto-assigns the
-- cheapest courier (often Canada Post) and the customer's UPS/FedEx choice is
-- lost.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS easyship_courier_id TEXT;

COMMENT ON COLUMN orders.easyship_courier_id IS
  'Easyship courier_service id selected for this order; applied as courier_service_id when buying the label.';
