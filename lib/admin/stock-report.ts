/**
 * Stock Report — a quantities-only view of the catalog for warehouse /
 * purchasing use. Deliberately money-free: no price, no stock value, no
 * revenue, which is what makes it safe to email to a fulfillment partner or
 * a buyer.
 *
 * `computeStockReport` gathers the numbers; `stockReportPrintHtml` renders the
 * branded printable document. Both are pure (they accept an injected Supabase
 * client) so the same code runs from an admin request handler, the scheduled
 * email job, or a test.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  reportShell, statsGrid, table, escapeHtml, formatStockDisplay, readableDateTime,
  type Column, type Stat, type StockUnit,
} from './report-html';

/**
 * A purchase order only contributes to "On Order" while it is still expected
 * to arrive. `fulfilled` / `paid` have already landed (receiving increments
 * stock), and `cancelled` never will.
 */
export const ON_ORDER_STATUSES = new Set(['pending', 'partially_fulfilled']);

export const PO_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  partially_fulfilled: 'Partially Fulfilled',
};

export const STOCK_REPORT_COLUMN_KEYS = [
  'sku', 'description', 'strength', 'stock', 'minQty', 'onOrder', 'needToOrder',
] as const;
export type StockReportColumnKey = typeof STOCK_REPORT_COLUMN_KEYS[number];

export interface StockReportFilters {
  /** Free-text search across name + slug + sku + category + strength. */
  search?: string;
  /** Filter by product.category ('all' or empty = every category). */
  category?: string;
  /** all (default) | active | inactive. */
  status?: string;
}

export interface StockReportRow {
  id: string;
  name: string;
  sku: string;
  strength: string | null;
  category: string | null;
  active: boolean;
  /** On hand, in vials. */
  stock: number;
  /** Low-stock threshold, in vials. 0 when unset. */
  minQty: number;
  vialsPerBox: number;
  /** Not-yet-received units across open purchase orders, in vials. */
  onOrder: number;
  /** max(0, minQty − (stock + onOrder)). */
  needToOrder: number;
}

export interface StockReportTotals {
  products: number;
  active: number;
  units: number;
  onOrder: number;
  needToOrder: number;
  /** How many products need ordering at all. */
  needCount: number;
  outOfStock: number;
  lowStock: number;
}

export interface ContributingPo {
  poNumber: string;
  status: string;
  units: number;
}

export interface StockReport {
  rows: StockReportRow[];
  totals: StockReportTotals;
  /** The open POs whose outstanding units make up the On Order column. */
  contributingPos: ContributingPo[];
  filters: StockReportFilters;
  generatedAt: string;
}

export interface StockReportRenderOptions {
  autoPrint?: boolean;
  stockUnit?: StockUnit;
  showRemainder?: boolean;
  showCards?: boolean;
  showOnOrder?: boolean;
  columns?: readonly string[];
}

/**
 * Build the stock report: load products + every PO line item in parallel,
 * then tally outstanding quantities per product.
 *
 * Products are filtered FIRST and On Order is tallied only for the products
 * that survive, so the column total and the "purchase orders considered" note
 * stay consistent with what the reader can actually see.
 */
export async function computeStockReport(
  db: SupabaseClient,
  filters: StockReportFilters = {},
): Promise<StockReport> {
  const [productsRes, poItemsRes] = await Promise.all([
    db.from('products').select('*').order('name', { ascending: true }),
    // Best-effort: if the purchase-order tables aren't installed, On Order is
    // 0 everywhere rather than the whole report failing.
    db
      .from('purchase_order_items')
      .select('product_id, qty, qty_received, purchase_order:purchase_orders (id, po_number, status)'),
  ]);

  const products = (productsRes.data ?? []) as any[];

  const search = (filters.search ?? '').trim().toLowerCase();
  const category = (filters.category ?? '').trim();
  const status = (filters.status ?? 'all').trim() || 'all';

  const visible = products.filter((p) => {
    if (search) {
      const hay = `${p.name ?? ''} ${p.slug ?? ''} ${p.sku ?? ''} ${p.category ?? ''} ${p.strength ?? ''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (category && category !== 'all' && (p.category ?? '') !== category) return false;
    if (status === 'active' && p.active === false) return false;
    if (status === 'inactive' && p.active !== false) return false;
    return true;
  });

  const visibleIds = new Set(visible.map((p) => String(p.id)));

  const onOrderByProduct = new Map<string, number>();
  const poUnits = new Map<string, ContributingPo>();
  if (!poItemsRes.error && Array.isArray(poItemsRes.data)) {
    for (const item of poItemsRes.data as any[]) {
      const po = Array.isArray(item.purchase_order) ? item.purchase_order[0] : item.purchase_order;
      const poStatus = String(po?.status ?? '').toLowerCase();
      if (!ON_ORDER_STATUSES.has(poStatus)) continue;

      const productId = item.product_id ? String(item.product_id) : '';
      if (!productId || !visibleIds.has(productId)) continue;

      const outstanding = Math.max(0, (Number(item.qty) || 0) - (Number(item.qty_received) || 0));
      if (outstanding <= 0) continue;

      onOrderByProduct.set(productId, (onOrderByProduct.get(productId) ?? 0) + outstanding);

      const poNumber = String(po?.po_number ?? '—');
      const existing = poUnits.get(poNumber);
      if (existing) existing.units += outstanding;
      else poUnits.set(poNumber, { poNumber, status: poStatus, units: outstanding });
    }
  }

  const rows: StockReportRow[] = visible.map((p) => {
    const stock = Number(p.stock_quantity) || 0;
    // NOTE: `|| 0` (not `|| 10`) — an unset threshold means "no reorder point
    // configured", so this product never reads as low and never needs ordering.
    const minQty = Number(p.low_stock_threshold) || 0;
    const onOrder = onOrderByProduct.get(String(p.id)) ?? 0;
    return {
      id: String(p.id),
      name: p.name ?? '',
      sku: p.slug || p.sku || '',
      strength: p.strength ?? null,
      category: p.category ?? null,
      active: p.active !== false,
      stock,
      minQty,
      vialsPerBox: Number(p.vials_per_box) || 10,
      onOrder,
      needToOrder: Math.max(0, minQty - (stock + onOrder)),
    };
  });

  const totals: StockReportTotals = {
    products: rows.length,
    active: rows.filter((r) => r.active).length,
    units: rows.reduce((s, r) => s + r.stock, 0),
    onOrder: rows.reduce((s, r) => s + r.onOrder, 0),
    needToOrder: rows.reduce((s, r) => s + r.needToOrder, 0),
    needCount: rows.filter((r) => r.needToOrder > 0).length,
    outOfStock: rows.filter((r) => r.stock <= 0).length,
    lowStock: rows.filter((r) => r.stock > 0 && r.minQty > 0 && r.stock <= r.minQty).length,
  };

  const contributingPos = [...poUnits.values()].sort((a, b) =>
    a.poNumber.localeCompare(b.poNumber),
  );

  return { rows, totals, contributingPos, filters, generatedAt: new Date().toISOString() };
}

const ON_ORDER_NOTE =
  'On Order counts units from purchase orders that are still open — status ' +
  'Pending or Partially Fulfilled — and only the part that has not been ' +
  'received yet. A line that has fully landed already sits in Stock, so ' +
  'counting it again would double it. Need To Order is Min Quantity minus ' +
  '(Stock + On Order), floored at zero.';

/** Resolve a requested column set through the canonical order. */
function resolveColumns(requested?: readonly string[]): StockReportColumnKey[] {
  if (!requested || requested.length === 0) return [...STOCK_REPORT_COLUMN_KEYS];
  const wanted = new Set(requested);
  const picked = STOCK_REPORT_COLUMN_KEYS.filter((k) => wanted.has(k));
  // An empty or fully-unknown selection falls back to everything — a table
  // with zero columns is never a useful report.
  return picked.length > 0 ? picked : [...STOCK_REPORT_COLUMN_KEYS];
}

/** Render the money-free Stock Report as a complete branded HTML document. */
export function stockReportPrintHtml(
  data: StockReport,
  opts: StockReportRenderOptions = {},
): string {
  const {
    autoPrint = true,
    stockUnit = 'boxes',
    showRemainder = true,
    showCards = true,
    showOnOrder = true,
  } = opts;
  const columns = resolveColumns(opts.columns);
  const unitLabel = stockUnit === 'vials' ? 'vials' : 'boxes';

  // Header and body come from ONE definition list so they can never drift.
  const columnDefs: Record<StockReportColumnKey, { column: Column; cell: (r: StockReportRow) => string }> = {
    sku: {
      column: { header: 'SKU' },
      cell: (r) => `<span class="mono">${escapeHtml(r.sku || '—')}</span>`,
    },
    description: {
      column: { header: 'Description' },
      cell: (r) => escapeHtml(r.name),
    },
    strength: {
      column: { header: 'Strength' },
      cell: (r) => escapeHtml(r.strength || '—'),
    },
    stock: {
      column: { header: `Stock (${unitLabel})` },
      // Plain text, not a pill: Min Quantity and Need To Order already carry
      // the low-stock signal, and a third colour would only add noise.
      cell: (r) =>
        r.stock <= 0
          ? 'Out of stock'
          : escapeHtml(formatStockDisplay(r.stock, r.vialsPerBox, stockUnit, showRemainder)),
    },
    minQty: {
      column: { header: 'Min Quantity', num: true },
      cell: (r) => (r.minQty > 0 ? String(r.minQty) : '—'),
    },
    onOrder: {
      column: { header: 'On Order', num: true },
      cell: (r) => (r.onOrder > 0 ? String(r.onOrder) : '—'),
    },
    needToOrder: {
      column: { header: 'Need To Order', num: true },
      cell: (r) => (r.needToOrder > 0 ? `<strong>${r.needToOrder}</strong>` : '—'),
    },
  };

  const cards: Stat[] = [
    { label: 'Products', value: String(data.totals.products), meta: `${data.totals.active} active` },
    {
      label: 'Stock On Hand',
      value: `${data.totals.units} units`,
      meta: `${data.totals.lowStock} low · ${data.totals.outOfStock} out`,
      tone: data.totals.outOfStock > 0 ? 'danger' : 'default',
    },
    { label: 'On Order', value: `${data.totals.onOrder} units` },
    {
      label: 'Need To Order',
      value: `${data.totals.needToOrder} units`,
      meta: `${data.totals.needCount} product${data.totals.needCount === 1 ? '' : 's'}`,
      tone: data.totals.needToOrder > 0 ? 'danger' : 'default',
    },
  ];

  const rows = data.rows.map((r) => columns.map((key) => columnDefs[key].cell(r)));

  const noteHtml = showOnOrder
    ? `<div class="filters" style="margin-top:22px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#56707F;margin-bottom:6px">How "On Order" is calculated</div>
      <div style="font-size:11.5px;line-height:1.55;color:#0E3F5F">${escapeHtml(ON_ORDER_NOTE)}</div>
      ${
        data.contributingPos.length > 0
          ? `<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#56707F;margin:12px 0 6px">Purchase orders considered (${data.contributingPos.length})</div>
      <ul style="margin:0;padding-left:18px;font-size:11.5px;line-height:1.6;color:#0E3F5F">${data.contributingPos
        .map(
          (po) =>
            `<li>${escapeHtml(po.poNumber)} — ${escapeHtml(PO_STATUS_LABEL[po.status] ?? po.status)} · ${po.units} units</li>`,
        )
        .join('')}</ul>`
          : `<div style="font-size:11.5px;line-height:1.55;color:#0E3F5F;margin-top:8px">No open purchase orders are currently contributing to On Order.</div>`
      }
    </div>`
    : '';

  const body =
    (showCards ? statsGrid(cards) : '') +
    `<h2>Stock levels (${data.totals.products})</h2>` +
    table(columns.map((k) => columnDefs[k].column), rows, 'No products match the filters.') +
    noteHtml;

  const meta = [
    `Generated ${readableDateTime(new Date(data.generatedAt))}`,
    `${data.totals.products} products`,
    `Stock in ${unitLabel}`,
  ];

  return reportShell({
    title: 'Stock Report',
    body,
    meta,
    branded: true,
    autoPrint,
    footRight: `${data.totals.products} products`,
  });
}
