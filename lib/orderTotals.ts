/**
 * Canonical order-totals derivation.
 *
 * `orders` rows come from several checkouts (crypto, e-Transfer, admin
 * invoice-generated) with inconsistent completeness — some carry a full
 * `subtotal / tax_total / shipping_cost / total` breakdown; others only
 * store `total` and stash line items in the JSONB `items` column instead
 * of the relational `order_items` table.
 *
 * `computeOrderTotals` returns a normalized shape that both the admin
 * invoice-from-order flow and any report code can rely on, recovering
 * shipping as the residual when the order row didn't record it directly.
 */

export interface OrderTotalsInput {
  subtotal?: number | string | null;
  tax_total?: number | string | null;
  shipping_cost?: number | string | null;
  discount_amount?: number | string | null;
  total?: number | string | null;
  items?: Array<Record<string, any>> | null;
  order_items?: Array<Record<string, any>> | null;
}

export interface OrderTotals {
  subtotal: number;
  tax_total: number;
  shipping_cost: number;
  discount_amount: number;
  total: number;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function lineSubtotal(item: Record<string, any>): number {
  const qty = num(item.qty ?? item.quantity ?? 1);
  const unit = num(item.unit_price ?? item.price_at_time ?? item.price);
  const disc = num(item.discount_pct);
  const linePrice = qty * unit * (1 - disc / 100);
  return linePrice;
}

/**
 * Derive a subtotal from whichever line-item collection the order carries.
 * Falls back to 0 when the order has no lines at all.
 */
export function subtotalFromItems(order: OrderTotalsInput): number {
  const rows = (Array.isArray(order.order_items) && order.order_items.length > 0
    ? order.order_items
    : Array.isArray(order.items)
      ? order.items
      : []) as Array<Record<string, any>>;
  return round2(rows.reduce((s, li) => s + lineSubtotal(li), 0));
}

/**
 * Return a fully normalized totals block for an order row. Missing fields
 * are recovered where possible:
 *   - subtotal ← summed from items when the row didn't store it.
 *   - shipping_cost ← residual of (total − subtotal − tax + discount) when
 *     the row didn't store it directly. Never negative.
 *   - total ← subtotal + tax + shipping − discount when the row didn't
 *     store it.
 */
export function computeOrderTotals(order: OrderTotalsInput): OrderTotals {
  const explicitSubtotal = order.subtotal != null ? num(order.subtotal) : NaN;
  const subtotal = Number.isFinite(explicitSubtotal)
    ? round2(explicitSubtotal)
    : subtotalFromItems(order);

  const tax_total = round2(num(order.tax_total));
  const discount_amount = round2(num(order.discount_amount));
  const explicitTotal = order.total != null ? num(order.total) : NaN;

  let shipping_cost: number;
  if (order.shipping_cost != null) {
    shipping_cost = round2(num(order.shipping_cost));
  } else if (Number.isFinite(explicitTotal)) {
    // Recover shipping as the residual — never let it slip negative if the
    // recorded total happens to be less than the sum of parts (rounding, or
    // an old order with a discount we can't see).
    shipping_cost = Math.max(
      0,
      round2(explicitTotal - subtotal - tax_total + discount_amount),
    );
  } else {
    shipping_cost = 0;
  }

  const total = Number.isFinite(explicitTotal)
    ? round2(explicitTotal)
    : round2(subtotal + tax_total + shipping_cost - discount_amount);

  return { subtotal, tax_total, shipping_cost, discount_amount, total };
}
