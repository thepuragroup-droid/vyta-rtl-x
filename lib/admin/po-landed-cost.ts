/**
 * Landed-cost math for purchase orders.
 *
 * The "true" per-unit cost of a PO line isn't just its supplier price — it
 * has to absorb its share of the order's shipping fee (added) and discount
 * (subtracted). We allocate both across lines by their share of the
 * subtotal so that:
 *
 *   Σ landed_line_total  ≡  subtotal + shipping − discount
 *
 * The same pure function is used by three call sites so the numbers stay
 * consistent:
 *
 *   - the create/edit form (live preview per line)
 *   - the POST/PATCH API (persisted to purchase_order_items)
 *   - the printable PDF (computed live so pre-migration POs still render)
 *
 * When the subtotal is $0 (every line is free) we fall back to allocating
 * by quantity so a shipping fee still spreads sensibly. If there aren't any
 * units either, shares are simply 0.
 */

export interface LandedCostLine {
  qty: number;
  unit_price: number;
  /** Optional: caller-computed line_total. When omitted we derive it. */
  line_total?: number;
}

export interface LandedCostAllocation {
  /** landed cost per unit, 4dp — persisted to landed_unit_cost. */
  landed_unit_cost: number;
  /** landed line total, 2dp — persisted to landed_line_total. Sums back to
   *  subtotal + shipping − discount across all lines (up to rounding). */
  landed_line_total: number;
  /** The line's share of the order's shipping fee (added into the line). */
  shipping_share: number;
  /** The line's share of the order's discount (subtracted from the line). */
  discount_share: number;
}

export interface LandedCostInputs {
  shipping: number;
  /** Resolved dollar amount (not a percentage). Callers must resolve %-based
   *  discounts to a dollar figure before calling. */
  discount: number;
}

export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function round4(n: number): number {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

function lineSubtotalOf(li: LandedCostLine): number {
  if (typeof li.line_total === 'number' && Number.isFinite(li.line_total)) {
    return Number(li.line_total) || 0;
  }
  return (Number(li.qty) || 0) * (Number(li.unit_price) || 0);
}

/**
 * Allocate shipping + discount across `lines` in order. Returns one entry
 * per input line, in the same order. Callers merge the result back onto
 * their own line records via `landed_unit_cost` / `landed_line_total`.
 *
 * Weighting rules:
 *   - subtotal > 0            → weight by lineSubtotal / subtotal
 *   - subtotal = 0, qty > 0   → weight by lineQty     / totalQty
 *   - both zero               → zero shares for every line
 */
export function allocateLandedCost(
  lines: LandedCostLine[],
  { shipping, discount }: LandedCostInputs,
): LandedCostAllocation[] {
  const ship = Math.max(0, Number(shipping) || 0);
  const disc = Math.max(0, Number(discount) || 0);

  const subtotals = lines.map(lineSubtotalOf);
  const qtys = lines.map((li) => Number(li.qty) || 0);
  const subtotal = subtotals.reduce((s, x) => s + x, 0);
  const totalQty = qtys.reduce((s, x) => s + x, 0);

  return lines.map((li, i) => {
    const lineSubtotal = subtotals[i];
    const qty = qtys[i];
    let weight = 0;
    if (subtotal > 0) {
      weight = lineSubtotal / subtotal;
    } else if (totalQty > 0) {
      weight = qty / totalQty;
    }
    const shippingShare = round2(ship * weight);
    const discountShare = round2(disc * weight);
    const landedLineTotal = round2(lineSubtotal + shippingShare - discountShare);
    const landedUnitCost = qty > 0 ? round4(landedLineTotal / qty) : 0;
    return {
      landed_unit_cost: landedUnitCost,
      landed_line_total: landedLineTotal,
      shipping_share: shippingShare,
      discount_share: discountShare,
    };
  });
}

/**
 * Resolve a percentage-or-fixed discount amount against a subtotal. The PO
 * form and API both store `discount_type` + `discount_value`; the resolved
 * dollar amount lives in `discount` and drives both totals and landed cost.
 */
export function resolveDiscountAmount(
  type: 'percentage' | 'fixed' | string | null | undefined,
  value: number | string | null | undefined,
  subtotal: number,
): number {
  const v = Math.max(0, Number(value) || 0);
  if (type === 'percentage') {
    return round2((Number(subtotal) || 0) * (v / 100));
  }
  return round2(v);
}

/**
 * Resolve a percentage-or-fixed tax amount against the taxable base
 * (subtotal + shipping − discount). Kept next to the discount helper so
 * both financial resolutions live in one place.
 */
export function resolveTaxAmount(
  type: 'percentage' | 'fixed' | string | null | undefined,
  value: number | string | null | undefined,
  taxableBase: number,
): number {
  const v = Math.max(0, Number(value) || 0);
  if (type === 'percentage') {
    return round2((Number(taxableBase) || 0) * (v / 100));
  }
  return round2(v);
}
