# 2026-09-24 — Stealth Health: invoice at hand-off, stock on payment, admin alert

## Summary

A Stealth Health order used to get its local invoice only once it was paid,
and that invoice was stamped USD with a flat $35 shipping and no courier —
the webhook, the poller and the admin refresh never passed the hand-off's own
currency, shipping or courier through.

Now:

1. **Invoice at hand-off.** `POST /api/checkout/puramass` writes the invoice as
   soon as the buyer is sent to pay, in status **`pending_payment`**: the exact
   lines (with product and pack size), the discount, the shipping the buyer was
   charged, and — when Easyship live rates are on — the courier they picked
   (`invoices.easyship_courier_id`). Always CAD.
2. **Paid.** The webhook / poller / admin refresh flip it to **`paid`**. The pass
   that wins the flip takes the stock, runs the low-stock check, and emails the
   admins (`sendStealthHealthOrderAlert`, recipients from
   `getAdminAlertEmails`). The affiliate credit and the Easyship draft
   shipment (booked with the paid-for courier) run as before.
3. **Lapsed.** When the payment link expires or is cancelled unpaid the invoice
   moves to **`expired`**.
4. Unpaid invoices (`pending_payment`, `expired`) are kept out of the warehouse
   queue, the customer's account, the outstanding-balance stat and customer
   spend.
5. **Stock in vials.** `invoice_line_items.vials_per_unit` records how many vials
   one unit of a line is (a pack of 5 → 5), and `adjust_stock_for_invoice` /
   `restore_stock_for_invoice` now take `qty × vials_per_unit`. Existing lines
   default to 1, so nothing else changes.
6. **Naming.** Every user-facing "PuraMass" now reads "Stealth Health",
   including the stock report and packing-list branding (matching the admin
   report shell renamed on main).

## Migration

Run `stealth-health-pending-invoice-migration.sql`. Until it runs, hand-offs
skip the up-front invoice (the new status is rejected) and are invoiced on
payment as before — now in CAD with the real shipping — without stock being
taken for pack lines.

Hand-offs created before this deploy that are paid afterwards are invoiced on
payment; only their single-vial lines take stock, since their pack size was
never recorded.
