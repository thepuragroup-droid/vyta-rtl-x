# 2026-04-27 — First Order Discount (20% Off)

## Summary
Implemented the 20% first-order discount that was previously marketing copy only. New customers now receive a 20% discount on their subtotal at checkout. The discount is tracked per customer and automatically disabled after their first confirmed order.

---

## Database Migration

**Run in Supabase SQL Editor before deploying code changes.**

```sql
DO $$ BEGIN
    ALTER TABLE customers
    ADD COLUMN has_completed_first_order BOOLEAN NOT NULL DEFAULT false;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

UPDATE customers
SET has_completed_first_order = true
WHERE id IN (
    SELECT DISTINCT customer_id
    FROM orders
    WHERE status = 'confirmed'
      AND customer_id IS NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customers_first_order
    ON customers(has_completed_first_order)
    WHERE has_completed_first_order = false;
```

The back-fill ensures existing customers with confirmed orders start with `has_completed_first_order = true` and never see the discount banner.

---

## How It Works

1. **Checkout arrival** — A fresh Supabase query checks `has_completed_first_order` for the logged-in customer (not the cached context, to avoid stale reads).
2. **UI** — If eligible, a green banner appears on the order summary card. The original subtotal is shown with a strikethrough, a discount line shows the savings, and the final total reflects 20% off the subtotal (shipping stays at $20).
3. **Order creation** — The client sends `firstOrderDiscount: true` to `POST /api/orders`. The server independently re-verifies eligibility by querying the DB before applying the discount. Guests and returning customers are blocked even if the flag is sent.
4. **After payment confirmed** — `GET /api/orders/check-payment` sets `has_completed_first_order = true` on the customer when their payment reaches the required confirmation count. The write is idempotent (no-op if already `true`).

---

## Discount Calculation

```
discountedSubtotal = subtotal × 0.8
total = discountedSubtotal + $20 (shipping)
```

Shipping is never discounted.

---

## Files Changed

| File | Change |
|------|--------|
| `lib/supabase.ts` | Added `has_completed_first_order: boolean` to `Customer` interface |
| `app/checkout/page.tsx` | Fresh eligibility fetch on arrival, discount banner UI, updated price display, `firstOrderDiscount` in POST body |
| `app/api/orders/route.ts` | Server-side re-verification, conditional discount applied to subtotal, updated email with discounted subtotal |
| `app/api/orders/check-payment/route.ts` | Marks `has_completed_first_order = true` on payment confirmation |

---

## Security Notes

- The discount cannot be forced by a client-side flag — the server always re-queries the DB.
- Guest checkouts (no `customerId`) never receive the discount.
- Returning customers (`has_completed_first_order = true`) are blocked server-side even if the client sends `firstOrderDiscount: true`.
