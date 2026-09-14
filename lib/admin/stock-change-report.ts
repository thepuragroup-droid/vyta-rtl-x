/**
 * Stock Change Report — how stock moved over a date range.
 *
 * Reads the append-only `product_history` ledger rather than the products
 * table, so a product that did not move in the window is absent from the
 * report entirely. Opening is derived from the `old_value` of the FIRST
 * ledger row in the window (not from a stock snapshot), and Closing from the
 * `new_value` of the last.
 *
 * Movement figures (Sold / Received / Adjusted / Net) are always raw vial
 * counts — only Opening and Closing respect the boxes/vials toggle, because a
 * movement of "half a box" is not a thing anyone wants to read. The report
 * says so in its own footnote.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  reportShell, statsGrid, table, escapeHtml, pill, formatStockDisplay, readableDateTime,
  type Column, type Stat, type StockUnit,
} from './report-html';

/**
 * Ledger sources that mean "stock left because it was sold". Everything the
 * platform writes for a confirmed order or a paid invoice lands here.
 */
export const SOLD_SOURCES = new Set(['order_confirmed', 'invoice_paid', 'order', 'invoice']);

/** Ledger sources that mean "stock arrived from a supplier". */
export const RECEIVED_SOURCES = new Set(['po_receipt', 'restock']);

export interface StockChangeFilters {
  from?: string;
  to?: string;
  search?: string;
  category?: string;
}

export interface StockChangeRow {
  id: string;
  name: string;
  sku: string;
  strength: string | null;
  category: string | null;
  active: boolean;
  vialsPerBox: number;
  opening: number;
  closing: number;
  /** Vials that left through a sale (positive number). */
  sold: number;
  /** Vials that arrived from a supplier (positive number). */
  received: number;
  /** Signed sum of every other movement (manual edits, imports, restores). */
  adjusted: number;
  /** closing − opening. */
  net: number;
  /** How many ledger rows this product has in the window. */
  changes: number;
}

export interface StockChangeTotals {
  productsChanged: number;
  sold: number;
  received: number;
  adjusted: number;
  net: number;
  changes: number;
}

export interface StockChangeReport {
  rows: StockChangeRow[];
  totals: StockChangeTotals;
  from: string;
  to: string;
  /** "Jul 13 – Jul 19, 2026" */
  rangeLabel: string;
  filters: StockChangeFilters;
  generatedAt: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Local-calendar YYYY-MM-DD (never shifted by a timezone conversion). */
export function toDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Monday…Sunday for the week containing `now`. Sunday counts as the END of
 * the week that started the prior Monday, not the start of a new one.
 */
export function currentWeekRange(now: Date = new Date()): { from: string; to: string } {
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { from: toDateInput(monday), to: toDateInput(sunday) };
}

/** Normalise a requested range: malformed falls back to this week, reversed swaps. */
export function resolveRange(from?: string | null, to?: string | null): { from: string; to: string } {
  const week = currentWeekRange();
  let start = from && DATE_RE.test(from) ? from : week.from;
  let end = to && DATE_RE.test(to) ? to : week.to;
  if (start > end) [start, end] = [end, start];
  return { from: start, to: end };
}

function rangeLabelFor(from: string, to: string): string {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return `${from} – ${to}`;
  const sameYear = start.getFullYear() === end.getFullYear();
  const startLabel = start.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  const endLabel = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${startLabel} – ${endLabel}`;
}

interface Accumulator {
  product: any;
  opening: number | null;
  closing: number;
  sold: number;
  received: number;
  adjusted: number;
  changes: number;
}

/**
 * Aggregate the stock ledger over an inclusive day range.
 *
 * The window is `[from 00:00, to+1day 00:00)` in SERVER-LOCAL time. On a UTC
 * host that is UTC midnight, which is not necessarily the warehouse's
 * midnight — worth pinning explicitly if the two ever diverge.
 */
export async function computeStockChangeReport(
  db: SupabaseClient,
  filters: StockChangeFilters = {},
): Promise<StockChangeReport> {
  const { from, to } = resolveRange(filters.from, filters.to);

  const startIso = new Date(`${from}T00:00:00`).toISOString();
  const endDate = new Date(`${to}T00:00:00`);
  endDate.setDate(endDate.getDate() + 1);
  const endIso = endDate.toISOString();

  const { data, error } = await db
    .from('product_history')
    .select(
      'id, product_id, old_value, new_value, source, created_at, ' +
      'product:products (id, name, slug, sku, strength, category, active, vials_per_box)',
    )
    .eq('change_type', 'stock')
    .eq('field', 'stock_quantity')
    .gte('created_at', startIso)
    .lt('created_at', endIso)
    .order('created_at', { ascending: true });

  const ledger = !error && Array.isArray(data) ? (data as any[]) : [];

  const byProduct = new Map<string, Accumulator>();
  for (const entry of ledger) {
    const product = Array.isArray(entry.product) ? entry.product[0] : entry.product;
    // Orphaned history (the product row was deleted) has nothing to name.
    if (!product?.id) continue;

    const key = String(product.id);
    let acc = byProduct.get(key);
    if (!acc) {
      acc = { product, opening: null, closing: 0, sold: 0, received: 0, adjusted: 0, changes: 0 };
      byProduct.set(key, acc);
    }

    // `old_value` is null only on the very first ('create') row for a product.
    const oldValue = entry.old_value == null ? 0 : Number(entry.old_value) || 0;
    const newValue = Number(entry.new_value) || 0;
    if (acc.opening === null) acc.opening = oldValue;
    acc.closing = newValue;
    acc.changes += 1;

    const delta = newValue - oldValue;
    const source = String(entry.source ?? '');
    if (SOLD_SOURCES.has(source)) acc.sold += Math.max(0, -delta);
    else if (RECEIVED_SOURCES.has(source)) acc.received += Math.max(0, delta);
    else acc.adjusted += delta;
  }

  const search = (filters.search ?? '').trim().toLowerCase();
  const category = (filters.category ?? '').trim();

  // Filters run AFTER aggregation — the ledger query is keyed by date, and
  // narrowing it by product first would cost a second round trip for nothing.
  const rows: StockChangeRow[] = [...byProduct.values()]
    .map((acc): StockChangeRow => {
      const p = acc.product;
      const opening = acc.opening ?? 0;
      return {
        id: String(p.id),
        name: p.name ?? '',
        sku: p.slug || p.sku || '',
        strength: p.strength ?? null,
        category: p.category ?? null,
        active: p.active !== false,
        vialsPerBox: Number(p.vials_per_box) || 10,
        opening,
        closing: acc.closing,
        sold: acc.sold,
        received: acc.received,
        adjusted: acc.adjusted,
        net: acc.closing - opening,
        changes: acc.changes,
      };
    })
    .filter((r) => {
      if (search) {
        const hay = `${r.name} ${r.sku} ${r.category ?? ''} ${r.strength ?? ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      if (category && category !== 'all' && (r.category ?? '') !== category) return false;
      return true;
    })
    // Most-active first — the products that moved are the reason to read this.
    .sort((a, b) => b.changes - a.changes || a.name.localeCompare(b.name));

  const totals: StockChangeTotals = {
    productsChanged: rows.length,
    sold: rows.reduce((s, r) => s + r.sold, 0),
    received: rows.reduce((s, r) => s + r.received, 0),
    adjusted: rows.reduce((s, r) => s + r.adjusted, 0),
    net: rows.reduce((s, r) => s + r.net, 0),
    changes: rows.reduce((s, r) => s + r.changes, 0),
  };

  return {
    rows,
    totals,
    from,
    to,
    rangeLabel: rangeLabelFor(from, to),
    filters,
    generatedAt: new Date().toISOString(),
  };
}

/** A signed movement figure: +N green, −N red, 0 plain. */
function signedPill(n: number): string {
  if (n > 0) return pill(`+${n}`, 'green');
  if (n < 0) return pill(`−${Math.abs(n)}`, 'red');
  return pill('0');
}

const MOVEMENT_NOTE =
  'Opening and Closing are the stock on hand at each end of the range. Sold, ' +
  'Received, Adjusted and Net are always raw vial counts, whichever display ' +
  'unit is selected. Products with no recorded stock movement in the range ' +
  'are not listed.';

/** Render the Stock Change Report as a complete branded HTML document. */
export function stockChangeReportPrintHtml(
  data: StockChangeReport,
  opts: { autoPrint?: boolean; stockUnit?: StockUnit; showRemainder?: boolean } = {},
): string {
  const { autoPrint = true, stockUnit = 'boxes', showRemainder = true } = opts;
  const unitLabel = stockUnit === 'vials' ? 'vials' : 'boxes';

  // Fixed column set — this report has no column toggles.
  const columns: Column[] = [
    { header: 'SKU' },
    { header: 'Description' },
    { header: 'Strength' },
    { header: `Opening (${unitLabel})`, num: true },
    { header: 'Sold', num: true },
    { header: 'Received', num: true },
    { header: 'Adjusted', num: true },
    { header: 'Net', num: true },
    { header: `Closing (${unitLabel})`, num: true },
  ];

  const rows = data.rows.map((r) => [
    `<span class="mono">${escapeHtml(r.sku || '—')}</span>`,
    escapeHtml(r.name),
    escapeHtml(r.strength || '—'),
    escapeHtml(formatStockDisplay(r.opening, r.vialsPerBox, stockUnit, showRemainder)),
    r.sold > 0 ? pill(`−${r.sold}`, 'red') : pill('0'),
    r.received > 0 ? pill(`+${r.received}`, 'green') : pill('0'),
    signedPill(r.adjusted),
    signedPill(r.net),
    `<strong>${escapeHtml(formatStockDisplay(r.closing, r.vialsPerBox, stockUnit, showRemainder))}</strong>`,
  ]);

  const cards: Stat[] = [
    {
      label: 'Products Moved',
      value: String(data.totals.productsChanged),
      meta: `${data.totals.changes} change${data.totals.changes === 1 ? '' : 's'}`,
    },
    { label: 'Sold', value: `${data.totals.sold} vials`, tone: 'pending' },
    { label: 'Received', value: `${data.totals.received} vials`, tone: 'paid' },
    {
      label: 'Net Change',
      value: `${data.totals.net > 0 ? '+' : data.totals.net < 0 ? '−' : ''}${Math.abs(data.totals.net)} vials`,
      meta: `${data.totals.adjusted >= 0 ? '+' : '−'}${Math.abs(data.totals.adjusted)} adjusted`,
      tone: data.totals.net < 0 ? 'danger' : 'paid',
    },
  ];

  const body =
    statsGrid(cards) +
    `<h2>Stock movement (${data.totals.productsChanged})</h2>` +
    table(columns, rows, 'No stock changes in this date range.') +
    `<div class="filters" style="margin-top:22px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#6E6E6E;margin-bottom:6px">How to read this report</div>
      <div style="font-size:11.5px;line-height:1.55;color:#374151">${escapeHtml(MOVEMENT_NOTE)}</div>
    </div>`;

  const meta = [
    `Generated ${readableDateTime(new Date(data.generatedAt))}`,
    data.rangeLabel,
    `${data.totals.productsChanged} products`,
    `Stock in ${unitLabel}`,
  ];

  return reportShell({
    title: 'Stock Change Report',
    body,
    meta,
    branded: true,
    autoPrint,
    footRight: `${data.totals.productsChanged} products`,
  });
}
