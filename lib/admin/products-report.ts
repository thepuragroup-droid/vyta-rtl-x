/**
 * Products Report — catalog + inventory + pricing + revenue, one row per
 * product.
 *
 * `computeProductsReport` gathers the numbers; `productsReportPrintHtml`
 * renders the branded printable document. Both are pure (the Supabase client
 * is injected), so the route handler is left with nothing but auth and query
 * parsing.
 *
 * Prices are the catalog's own `products.price`, in CAD. There is deliberately
 * no price-list / per-customer pricing source here: the business runs one
 * price per product, so a source picker would only be a way to print a number
 * that is not the price.
 *
 * Revenue is separate and stays historical — `order_items.price_at_time` is
 * what was actually charged, which is not necessarily today's catalog price.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  reportShell, statsGrid, table, pill, escapeHtml, money,
  formatStockDisplay, readableDateTime,
  type Column, type Stat, type StockUnit,
} from './report-html';

export const PRODUCTS_REPORT_CARD_KEYS = ['products', 'stock', 'lowout', 'revenue'] as const;
export const PRODUCTS_REPORT_COLUMN_KEYS = [
  'sku', 'product', 'strength', 'price', 'stock',
  'stockValue', 'unitsSold', 'revenue', 'status',
] as const;

export type ProductsReportCardKey = typeof PRODUCTS_REPORT_CARD_KEYS[number];
export type ProductsReportColumnKey = typeof PRODUCTS_REPORT_COLUMN_KEYS[number];
export type ProductsReportStockStatus = 'all' | 'low' | 'out' | 'lowout';

/**
 * An unset low_stock_threshold behaves as 10 vials HERE. The Stock Report
 * uses 0 for the same column, deliberately: this report is a catalog view
 * where "under ten and nobody set a floor" is worth flagging, while the Stock
 * Report drives purchasing and must not invent a reorder point.
 */
const DEFAULT_LOW_THRESHOLD = 10;

export interface ProductsReportFilters {
  search?: string;
  category?: string;
  /** all (default) | active | inactive. */
  status?: string;
  stockStatus?: ProductsReportStockStatus;
}

export interface ProductsReportOptions extends ProductsReportFilters {
  /**
   * Replaces the default `order_items` scan. Used by the analytics/marketing
   * role, which may only read the sales its ads won.
   */
  orderItemsLoader?: () => Promise<any[]>;
  /**
   * Skip the sales scan entirely. A catalog-only report renders no Units Sold
   * or Revenue, so scanning every order line for it is pure cost — the caller
   * knows which columns it asked for, this function does not. Defaults to true.
   */
  includeSales?: boolean;
}

export interface ProductsReportRow {
  id: string;
  name: string;
  sku: string;
  strength: string | null;
  category: string | null;
  active: boolean;
  price: number;
  stock: number;
  minQty: number;
  vialsPerBox: number;
  stockValue: number;
  unitsSold: number;
  revenue: number;
  isOut: boolean;
  isLow: boolean;
}

export interface ProductsReportTotals {
  products: number;
  active: number;
  units: number;
  stockValue: number;
  outOfStock: number;
  lowStock: number;
  unitsSold: number;
  revenue: number;
}

export interface ProductsReport {
  rows: ProductsReportRow[];
  totals: ProductsReportTotals;
  filters: ProductsReportFilters;
  generatedAt: string;
}

export interface ProductsReportRenderOptions {
  autoPrint?: boolean;
  stockUnit?: StockUnit;
  showRemainder?: boolean;
  cards?: readonly string[];
  columns?: readonly string[];
  /** Extra filter chips (e.g. an access-scope note) appended to the card. */
  extraFilterChips?: string[];
}

const STOCK_STATUS_LABEL: Record<Exclude<ProductsReportStockStatus, 'all'>, string> = {
  low: 'Low stock only',
  out: 'Out of stock only',
  lowout: 'Low or out of stock',
};

const STOCK_STATUS_HEADING: Record<Exclude<ProductsReportStockStatus, 'all'>, string> = {
  low: 'Low stock',
  out: 'Out of stock',
  lowout: 'Low or out of stock',
};

export async function computeProductsReport(
  db: SupabaseClient,
  opts: ProductsReportOptions = {},
): Promise<ProductsReport> {
  const includeSales = opts.includeSales !== false;
  const [productsRes, orderItems] = await Promise.all([
    db.from('products').select('*').order('name', { ascending: true }),
    !includeSales
      ? Promise.resolve([] as any[])
      : opts.orderItemsLoader
        ? opts.orderItemsLoader()
        : db
            .from('order_items')
            .select('product_id, product_name, quantity, price_at_time')
            .then((r: any) => (r.error ? [] : (r.data ?? []))),
  ]);

  const products = (productsRes.data ?? []) as any[];

  // `order_items.product_id` is TEXT (a uuid-as-string) while `products.id` is
  // uuid, so the join is by string key — with a product_name fallback for the
  // lines that never carried an id.
  const salesById = new Map<string, { units: number; revenue: number }>();
  const salesByName = new Map<string, { units: number; revenue: number }>();
  for (const it of orderItems as any[]) {
    const units = Number(it.quantity) || 0;
    const revenue = units * (Number(it.price_at_time) || 0);
    if (it.product_id) {
      const key = String(it.product_id);
      const cur = salesById.get(key) ?? { units: 0, revenue: 0 };
      cur.units += units; cur.revenue += revenue;
      salesById.set(key, cur);
    }
    if (it.product_name) {
      const key = String(it.product_name);
      const cur = salesByName.get(key) ?? { units: 0, revenue: 0 };
      cur.units += units; cur.revenue += revenue;
      salesByName.set(key, cur);
    }
  }

  const search = (opts.search ?? '').trim().toLowerCase();
  const category = (opts.category ?? '').trim();
  const status = (opts.status ?? 'all').trim() || 'all';
  const stockStatus = opts.stockStatus ?? 'all';

  const rows: ProductsReportRow[] = products
    .filter((p) => {
      if (search) {
        const hay = `${p.name ?? ''} ${p.category ?? ''} ${p.strength ?? ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      if (category && category !== 'all' && (p.category ?? '') !== category) return false;
      if (status === 'active' && p.active === false) return false;
      if (status === 'inactive' && p.active !== false) return false;
      if (stockStatus !== 'all') {
        const qty = Number(p.stock_quantity) || 0;
        const threshold = Number(p.low_stock_threshold) || DEFAULT_LOW_THRESHOLD;
        const isOut = qty <= 0;
        const isLow = qty > 0 && qty <= threshold;
        if (stockStatus === 'out' && !isOut) return false;
        if (stockStatus === 'low' && !isLow) return false;
        if (stockStatus === 'lowout' && !isOut && !isLow) return false;
      }
      return true;
    })
    .map((p): ProductsReportRow => {
      const id = String(p.id);
      const price = Number(p.price) || 0;
      const stock = Number(p.stock_quantity) || 0;
      const minQty = Number(p.low_stock_threshold) || DEFAULT_LOW_THRESHOLD;
      const sales = salesById.get(id) ?? salesByName.get(String(p.name)) ?? { units: 0, revenue: 0 };
      return {
        id,
        name: p.name ?? '',
        sku: p.slug || p.sku || '',
        strength: p.strength ?? null,
        category: p.category ?? null,
        active: p.active !== false,
        price,
        stock,
        minQty,
        vialsPerBox: Number(p.vials_per_box) || 10,
        stockValue: stock * price,
        unitsSold: sales.units,
        revenue: sales.revenue,
        isOut: stock <= 0,
        isLow: stock > 0 && stock <= minQty,
      };
    });

  const totals: ProductsReportTotals = {
    products: rows.length,
    active: rows.filter((r) => r.active).length,
    units: rows.reduce((s, r) => s + r.stock, 0),
    stockValue: rows.reduce((s, r) => s + r.stockValue, 0),
    outOfStock: rows.filter((r) => r.isOut).length,
    lowStock: rows.filter((r) => r.isLow).length,
    unitsSold: rows.reduce((s, r) => s + r.unitsSold, 0),
    revenue: rows.reduce((s, r) => s + r.revenue, 0),
  };

  return {
    rows,
    totals,
    filters: { search, category, status, stockStatus },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Resolve a requested key set through the canonical order (the print order),
 * not the order the caller happened to list them in.
 *
 * `undefined` — the param was absent — always means "everything".
 *
 * `emptyMeansAll` is where cards and columns deliberately part ways. An empty
 * COLUMN set falls back to everything, because a table with no columns is not
 * a report. An empty CARD set means exactly that: no cards. The Pricing
 * section contributes columns but no cards, so a report built from Pricing
 * alone legitimately asks for zero cards — falling back to "all" there would
 * print the Revenue card to an admin who deselected revenue.
 */
function resolveKeys<T extends string>(
  canonical: readonly T[],
  requested: readonly string[] | undefined,
  emptyMeansAll: boolean,
): T[] {
  if (!requested) return [...canonical];
  const wanted = new Set(requested);
  const picked = canonical.filter((k) => wanted.has(k));
  if (picked.length > 0) return picked;
  return emptyMeansAll ? [...canonical] : [];
}

export function productsReportPrintHtml(
  data: ProductsReport,
  opts: ProductsReportRenderOptions = {},
): string {
  const { autoPrint = true, stockUnit = 'boxes', showRemainder = true } = opts;
  const cards = resolveKeys(PRODUCTS_REPORT_CARD_KEYS, opts.cards, false);
  const columns = resolveKeys(PRODUCTS_REPORT_COLUMN_KEYS, opts.columns, true);
  const unitLabel = stockUnit === 'vials' ? 'vials' : 'boxes';

  // Does this report carry money at all? Drives the "Pricing in CAD" chip and
  // the Stock On Hand card's value sub-line.
  const showsPricing =
    cards.includes('revenue') ||
    columns.some((c) => c === 'price' || c === 'stockValue' || c === 'revenue');

  const columnDefs: Record<
    ProductsReportColumnKey,
    { column: Column; cell: (r: ProductsReportRow) => string }
  > = {
    sku: {
      column: { header: 'SKU' },
      cell: (r) => `<span class="mono">${escapeHtml(r.sku || '—')}</span>`,
    },
    product: { column: { header: 'Description' }, cell: (r) => escapeHtml(r.name) },
    strength: { column: { header: 'Strength' }, cell: (r) => escapeHtml(r.strength || '—') },
    price: { column: { header: 'Price', num: true }, cell: (r) => money(r.price) },
    stock: {
      column: { header: `Stock (${unitLabel})` },
      cell: (r) => {
        if (r.isOut) return pill('Out of stock', 'red');
        const display = formatStockDisplay(r.stock, r.vialsPerBox, stockUnit, showRemainder);
        return r.isLow ? pill(`Low · ${display}`, 'amber') : pill(display, 'green');
      },
    },
    stockValue: { column: { header: 'Stock Value', num: true }, cell: (r) => money(r.stockValue) },
    unitsSold: { column: { header: 'Units Sold', num: true }, cell: (r) => String(r.unitsSold) },
    revenue: { column: { header: 'Revenue', num: true }, cell: (r) => money(r.revenue) },
    status: {
      column: { header: 'Status' },
      cell: (r) => (r.active ? pill('Active', 'green') : pill('Inactive', 'red')),
    },
  };

  const cardDefs: Record<ProductsReportCardKey, Stat> = {
    products: {
      label: 'Products',
      value: String(data.totals.products),
      meta: `${data.totals.active} active`,
    },
    stock: {
      label: 'Stock On Hand',
      value: `${data.totals.units} units`,
      ...(showsPricing ? { meta: `${money(data.totals.stockValue)} value` } : {}),
    },
    lowout: {
      label: 'Low / Out Of Stock',
      value: `${data.totals.lowStock} / ${data.totals.outOfStock}`,
      tone: data.totals.outOfStock > 0 ? 'danger' : 'default',
    },
    revenue: {
      label: 'Revenue',
      value: money(data.totals.revenue),
      meta: `${data.totals.unitsSold} units sold`,
      tone: 'paid',
    },
  };

  const stockStatus = data.filters.stockStatus ?? 'all';
  const chips: string[] = [];
  if (data.filters.search) chips.push(`Search: "${data.filters.search}"`);
  if (data.filters.category && data.filters.category !== 'all') {
    chips.push(`Category: ${data.filters.category}`);
  }
  if (data.filters.status && data.filters.status !== 'all') {
    chips.push(`Status: ${data.filters.status}`);
  }
  if (stockStatus !== 'all') chips.push(`Stock: ${STOCK_STATUS_LABEL[stockStatus]}`);
  chips.push(...(opts.extraFilterChips ?? []));
  if (chips.length === 0) chips.push('None — all products');

  const meta = [
    `Generated ${readableDateTime(new Date(data.generatedAt))}`,
    `${data.totals.products} products`,
    `Stock in ${unitLabel}`,
    // Stated even though it never varies: a printed sheet of dollar figures
    // should say which dollars they are.
    ...(showsPricing ? ['Pricing in CAD'] : []),
  ];

  const heading =
    stockStatus === 'all'
      ? `All products (${data.totals.products})`
      : `${STOCK_STATUS_HEADING[stockStatus]} (${data.totals.products})`;

  const body =
    statsGrid(cards.map((c) => cardDefs[c])) +
    `<h2>${escapeHtml(heading)}</h2>` +
    table(
      columns.map((c) => columnDefs[c].column),
      data.rows.map((r) => columns.map((c) => columnDefs[c].cell(r))),
      'No products match the filters.',
    );

  return reportShell({
    title: 'Products Report',
    body,
    meta,
    filters: chips,
    branded: true,
    autoPrint,
    footRight: `${data.totals.products} products`,
  });
}
