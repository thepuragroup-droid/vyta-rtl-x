-- Affiliate discount applied to referred orders. The affiliate commission is
-- computed on the discounted subtotal (see lib/affiliate/commission.ts).
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS discount_amount numeric(10,2) NOT NULL DEFAULT 0;
