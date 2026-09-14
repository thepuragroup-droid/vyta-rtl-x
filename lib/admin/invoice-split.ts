/**
 * Stock-split helper used at invoice creation. Given an invoice's line items
 * and a map of available stock per product, splits the lines into an in-stock
 * portion and a backordered portion (the quantity ordered beyond stock), and
 * produces the backorder_items rows describing the shortfall.
 *
 * Stock is allocated greedily in line order so multiple lines referencing the
 * same product never over-allocate the same units.
 */

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function lineTotal(qty: number, unitPrice: number, discountPct: number): number {
  return round2(qty * unitPrice * (1 - (discountPct || 0) / 100));
}

export interface SplitLine {
  product_id: string | null;
  product_variant_id?: string | null;
  description: string;
  qty: number;
  unit_price: number;
  discount_pct: number;
  /** Whether the line is priced/labeled as a full box or a single vial. */
  price_type?: 'box' | 'vial';
}

/** A split line with its recomputed `line_total`. */
export type ComputedLine = SplitLine & { line_total: number };

export interface BackorderItem {
  product_id: string | null;
  description: string;
  qty_ordered: number;
  qty_available: number;
  qty_backordered: number;
  unit_price: number;
}

export interface StockSplit {
  inStock: ComputedLine[];
  backordered: ComputedLine[];
  backorderItems: BackorderItem[];
}

/**
 * Split `lines` into in-stock / backordered portions against `stockMap`
 * (product_id → available units). Lines without a product_id are always
 * treated as fully in stock.
 */
export function computeStockSplit(
  lines: SplitLine[],
  stockMap: Map<string, number>,
): StockSplit {
  const inStock: ComputedLine[] = [];
  const backordered: ComputedLine[] = [];
  const backorderItems: BackorderItem[] = [];

  // Track remaining stock as we allocate greedily across lines.
  const remaining = new Map<string, number>();
  for (const [pid, qty] of stockMap) remaining.set(pid, Math.max(0, Number(qty) || 0));

  for (const li of lines) {
    const qty = Number(li.qty) || 0;
    const unit = Number(li.unit_price) || 0;
    const disc = Number(li.discount_pct) || 0;

    // Custom/untracked lines (no product) are always fully in stock.
    if (!li.product_id) {
      inStock.push({ ...li, line_total: lineTotal(qty, unit, disc) });
      continue;
    }

    const available = remaining.get(li.product_id) ?? 0;
    const inQty = Math.min(qty, available);
    const backQty = qty - inQty;
    remaining.set(li.product_id, available - inQty);

    if (inQty > 0) {
      inStock.push({ ...li, qty: inQty, line_total: lineTotal(inQty, unit, disc) });
    }
    if (backQty > 0) {
      backordered.push({ ...li, qty: backQty, line_total: lineTotal(backQty, unit, disc) });
      backorderItems.push({
        product_id: li.product_id,
        description: li.description,
        qty_ordered: qty,
        qty_available: inQty,
        qty_backordered: backQty,
        unit_price: unit,
      });
    }
  }

  return { inStock, backordered, backorderItems };
}
