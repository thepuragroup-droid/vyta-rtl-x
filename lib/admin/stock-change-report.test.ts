/**
 * Tests for the Stock Change Report.
 *
 *   node --test --import tsx lib/admin/stock-change-report.test.ts
 *
 * The properties that matter:
 *   • Opening comes from the FIRST ledger row's old_value in the window, not
 *     from a stock snapshot — a snapshot would report today's number for a
 *     range that ended last month.
 *   • Sunday belongs to the week that started the prior Monday. Getting this
 *     backwards prints an empty "this week" every Sunday.
 *   • A ledger row whose product was deleted is skipped rather than rendering
 *     a nameless row.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStockChangeReport,
  stockChangeReportPrintHtml,
  currentWeekRange,
  resolveRange,
  toDateInput,
} from './stock-change-report';

function fakeDb(rows: any[]): any {
  const api: any = {
    select: () => api,
    eq: () => api,
    gte: () => api,
    lt: () => api,
    order: () => api,
    then: (res: any) => Promise.resolve({ data: rows, error: null }).then(res),
  };
  return { from: () => api };
}

const product = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: id, slug: id, sku: id, strength: null,
  category: 'Peptides', active: true, vials_per_box: 10, ...over,
});

const LEDGER = [
  { id: 'h1', product_id: 'p1', old_value: '100', new_value: '90',  source: 'order_confirmed', created_at: '2026-07-14T10:00:00Z', product: product('p1') },
  { id: 'h2', product_id: 'p1', old_value: '90',  new_value: '190', source: 'po_receipt',      created_at: '2026-07-15T10:00:00Z', product: product('p1') },
  { id: 'h3', product_id: 'p1', old_value: '190', new_value: '185', source: 'admin_edit',      created_at: '2026-07-16T10:00:00Z', product: product('p1') },
  // First-ever row for a product: old_value is null.
  { id: 'h4', product_id: 'p2', old_value: null,  new_value: '50',  source: 'admin_edit',      created_at: '2026-07-16T10:00:00Z', product: product('p2', { category: 'Other' }) },
  // Orphaned history — the product row is gone.
  { id: 'h5', product_id: 'x',  old_value: '5',   new_value: '1',   source: 'invoice_paid',    created_at: '2026-07-16T11:00:00Z', product: null },
];

const RANGE = { from: '2026-07-13', to: '2026-07-19' };

test('Opening and Closing bracket the window from the ledger itself', async () => {
  const { rows } = await computeStockChangeReport(fakeDb(LEDGER), RANGE);
  const p1 = rows.find((r) => r.id === 'p1')!;
  assert.equal(p1.opening, 100, "the first row's old_value");
  assert.equal(p1.closing, 185, "the last row's new_value");
  assert.equal(p1.net, 85, 'closing − opening');
  assert.equal(p1.changes, 3);
});

test('movements are bucketed by ledger source', async () => {
  const { rows } = await computeStockChangeReport(fakeDb(LEDGER), RANGE);
  const p1 = rows.find((r) => r.id === 'p1')!;
  assert.equal(p1.sold, 10, 'order_confirmed / invoice_paid');
  assert.equal(p1.received, 100, 'po_receipt');
  assert.equal(p1.adjusted, -5, 'everything else, signed');
});

test('a null old_value on the first row reads as an opening of zero', async () => {
  const { rows } = await computeStockChangeReport(fakeDb(LEDGER), RANGE);
  const p2 = rows.find((r) => r.id === 'p2')!;
  assert.equal(p2.opening, 0);
  assert.equal(p2.closing, 50);
});

test('history for a deleted product is skipped', async () => {
  const { rows } = await computeStockChangeReport(fakeDb(LEDGER), RANGE);
  assert.equal(rows.length, 2);
  assert.ok(!rows.some((r) => r.id === 'x'));
});

test('rows are sorted most-active first', async () => {
  const { rows, totals } = await computeStockChangeReport(fakeDb(LEDGER), RANGE);
  assert.equal(rows[0].id, 'p1', '3 changes beats 1');
  assert.equal(totals.productsChanged, 2);
  assert.equal(totals.sold, 10);
  assert.equal(totals.received, 100);
  assert.equal(totals.changes, 4, 'the orphaned row is not counted');
});

test('search and category filter after aggregation', async () => {
  const bySearch = await computeStockChangeReport(fakeDb(LEDGER), { ...RANGE, search: 'p2' });
  assert.deepEqual(bySearch.rows.map((r) => r.id), ['p2']);

  const byCategory = await computeStockChangeReport(fakeDb(LEDGER), { ...RANGE, category: 'Other' });
  assert.deepEqual(byCategory.rows.map((r) => r.id), ['p2']);
});

test('currentWeekRange runs Monday to Sunday, with Sunday closing the prior week', () => {
  // Sun 19 Jul 2026 ends the week that began Mon 13 Jul.
  assert.deepEqual(currentWeekRange(new Date(2026, 6, 19)), { from: '2026-07-13', to: '2026-07-19' });
  assert.deepEqual(currentWeekRange(new Date(2026, 6, 15)), { from: '2026-07-13', to: '2026-07-19' });
  assert.deepEqual(currentWeekRange(new Date(2026, 6, 13)), { from: '2026-07-13', to: '2026-07-19' });
});

test('toDateInput uses the local calendar, not a UTC shift', () => {
  assert.equal(toDateInput(new Date(2026, 0, 1)), '2026-01-01');
  assert.equal(toDateInput(new Date(2026, 11, 31)), '2026-12-31');
});

test('a reversed range is swapped and a malformed one falls back to this week', () => {
  assert.deepEqual(resolveRange('2026-07-19', '2026-07-13'), { from: '2026-07-13', to: '2026-07-19' });
  assert.deepEqual(resolveRange('not-a-date', null), currentWeekRange());
  assert.deepEqual(resolveRange('2026-07-13', '2026-07-19'), RANGE);
});

test('the range label collapses a shared year', async () => {
  const same = await computeStockChangeReport(fakeDb([]), RANGE);
  assert.equal(same.rangeLabel, 'Jul 13 – Jul 19, 2026');

  const crossing = await computeStockChangeReport(fakeDb([]), { from: '2025-12-28', to: '2026-01-03' });
  assert.equal(crossing.rangeLabel, 'Dec 28, 2025 – Jan 3, 2026');
});

test('movement columns stay in vials while Opening and Closing follow the toggle', async () => {
  const report = await computeStockChangeReport(fakeDb(LEDGER), RANGE);
  const html = stockChangeReportPrintHtml(report, { stockUnit: 'boxes' });
  assert.ok(html.includes('Opening (boxes)') && html.includes('Closing (boxes)'));
  assert.ok(html.includes('>Sold</th>'), 'Sold carries no unit in its header');
  assert.ok(html.includes('10 boxes'), 'opening 100 vials at 10/box');
  assert.ok(html.includes('−10'), 'sold prints as a raw vial count with a minus');
  assert.ok(html.includes('+100'), 'received prints as a raw vial count');
});

test('a range with no movement renders the empty state', async () => {
  const report = await computeStockChangeReport(fakeDb([]), RANGE);
  assert.equal(report.rows.length, 0);
  assert.ok(stockChangeReportPrintHtml(report).includes('No stock changes in this date range.'));
});
