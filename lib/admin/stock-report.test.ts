/**
 * Tests for the Stock Report computation + renderer.
 *
 *   node --test --import tsx lib/admin/stock-report.test.ts
 *
 * The properties that matter:
 *   • On Order counts only the OUTSTANDING part of an OPEN purchase order,
 *     and only for products the filters left visible — otherwise the column
 *     total and the "purchase orders considered" note disagree with the table.
 *   • The report is money-free. That is the whole reason it can be emailed to
 *     a warehouse, so it is asserted directly rather than assumed.
 *   • Column selection resolves through the canonical order, and an empty or
 *     unrecognised selection falls back to every column rather than rendering
 *     a table with no columns.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStockReport, stockReportPrintHtml } from './stock-report';
import { renderStockReportCsv } from './stock-report-csv';
import { renderStockReportPdf } from './stock-report-pdf';

/** Minimal thenable stub matching the PostgREST builder surface we use. */
function fakeDb(tables: Record<string, any[]>): any {
  const build = (name: string) => {
    const api: any = {
      select: () => api,
      order: () => api,
      eq: () => api,
      then: (res: any) => Promise.resolve({ data: tables[name] ?? [], error: null }).then(res),
    };
    return api;
  };
  return { from: (n: string) => build(n) };
}

const PRODUCTS = [
  {
    id: 'p1', name: 'BPC-157', slug: 'bpc-157', sku: 'B1', strength: '5mg',
    category: 'Peptides', active: true, price: 40,
    stock_quantity: 243, low_stock_threshold: 300, vials_per_box: 10,
  },
  {
    id: 'p2', name: 'TB-500', slug: 'tb-500', sku: 'T5', strength: '10mg',
    category: 'Peptides', active: true, price: 60,
    stock_quantity: 0, low_stock_threshold: 50, vials_per_box: 10,
  },
  {
    id: 'p3', name: 'No Threshold', slug: 'nt', sku: null, strength: null,
    category: 'Other', active: false, price: 10,
    stock_quantity: 5, low_stock_threshold: null, vials_per_box: 10,
  },
];

const PO_ITEMS = [
  // Partially received against an open PO — only the remaining 60 count.
  { product_id: 'p1', qty: 100, qty_received: 40, purchase_order: { id: 'a', po_number: 'PO-00002', status: 'partially_fulfilled' } },
  // Fully received — nothing outstanding, so it must not double-count.
  { product_id: 'p2', qty: 20, qty_received: 20, purchase_order: { id: 'b', po_number: 'PO-00001', status: 'pending' } },
  // Cancelled PO — never arriving.
  { product_id: 'p2', qty: 30, qty_received: 0, purchase_order: { id: 'c', po_number: 'PO-00003', status: 'cancelled' } },
  { product_id: 'p2', qty: 15, qty_received: 0, purchase_order: { id: 'd', po_number: 'PO-00001', status: 'pending' } },
];

const db = fakeDb({ products: PRODUCTS, purchase_order_items: PO_ITEMS });

test('On Order counts only outstanding units on open purchase orders', async () => {
  const report = await computeStockReport(db, {});
  const p1 = report.rows.find((r) => r.id === 'p1')!;
  const p2 = report.rows.find((r) => r.id === 'p2')!;

  assert.equal(p1.onOrder, 60, 'qty − qty_received');
  assert.equal(p2.onOrder, 15, 'fully-received line and cancelled PO both excluded');
});

test('Need To Order is minQty − (stock + onOrder), floored at zero', async () => {
  const report = await computeStockReport(db, {});
  const p1 = report.rows.find((r) => r.id === 'p1')!;
  const p2 = report.rows.find((r) => r.id === 'p2')!;

  assert.equal(p1.needToOrder, 0, '300 − (243 + 60) is negative → 0');
  assert.equal(p2.needToOrder, 35, '50 − (0 + 15)');
});

test('a null low_stock_threshold never reads as low and never needs ordering', async () => {
  const report = await computeStockReport(db, {});
  const p3 = report.rows.find((r) => r.id === 'p3')!;

  // The Products Report treats a null threshold as 10; this report treats it
  // as 0. The two disagree deliberately — a warehouse should not be told to
  // reorder a product nobody configured a reorder point for.
  assert.equal(p3.minQty, 0);
  assert.equal(p3.needToOrder, 0);
});

test('totals count low and out-of-stock separately', async () => {
  const { totals } = await computeStockReport(db, {});
  assert.equal(totals.products, 3);
  assert.equal(totals.active, 2);
  assert.equal(totals.lowStock, 1, 'only p1: stock > 0 and at/under its threshold');
  assert.equal(totals.outOfStock, 1, 'only p2');
  assert.equal(totals.units, 248);
  assert.equal(totals.onOrder, 75);
});

test('contributing POs are aggregated per PO number and sorted', async () => {
  const { contributingPos } = await computeStockReport(db, {});
  assert.deepEqual(contributingPos.map((p) => p.poNumber), ['PO-00001', 'PO-00002']);
  assert.equal(contributingPos[0].units, 15, 'the fully-received line contributes nothing');
});

test('On Order is tallied only for products the filters left visible', async () => {
  const report = await computeStockReport(db, { search: 'tb-500' });
  assert.equal(report.rows.length, 1);
  assert.equal(report.totals.onOrder, 15, "p1's 60 outstanding units are not in this report");
  assert.deepEqual(report.contributingPos.map((p) => p.poNumber), ['PO-00001']);
});

test('status filter matches active / inactive', async () => {
  assert.equal((await computeStockReport(db, { status: 'inactive' })).rows.length, 1);
  assert.equal((await computeStockReport(db, { status: 'active' })).rows.length, 2);
  assert.equal((await computeStockReport(db, { status: 'all' })).rows.length, 3);
});

test('the rendered report carries no money at all', async () => {
  const html = stockReportPrintHtml(await computeStockReport(db, {}));
  assert.ok(!html.includes('$'), 'a price anywhere would make this unsafe to email out');
});

test('the stock cell honours the boxes/vials toggle', async () => {
  const report = await computeStockReport(db, {});
  assert.ok(stockReportPrintHtml(report, { stockUnit: 'boxes' }).includes('24 boxes (3 vials)'));
  assert.ok(stockReportPrintHtml(report, { stockUnit: 'boxes', showRemainder: false }).includes('>24 boxes<'));
  assert.ok(stockReportPrintHtml(report, { stockUnit: 'vials' }).includes('243 vials'));
});

test('columns render in canonical order regardless of the order requested', async () => {
  const html = stockReportPrintHtml(await computeStockReport(db, {}), {
    columns: ['needToOrder', 'sku'],
  });
  const head = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));
  assert.equal(head, '<thead><tr><th>SKU</th><th class="num">Need To Order</th></tr>');
});

test('an empty or unrecognised column selection falls back to every column', async () => {
  const report = await computeStockReport(db, {});
  for (const columns of [[], ['bogus']]) {
    const html = stockReportPrintHtml(report, { columns });
    assert.ok(html.includes('>Min Quantity<'), `columns=${JSON.stringify(columns)}`);
    assert.ok(html.includes('>Need To Order<'));
  }
});

test('cards and the On Order note can each be switched off', async () => {
  const report = await computeStockReport(db, {});
  const bare = stockReportPrintHtml(report, { showCards: false, showOnOrder: false });
  assert.ok(!bare.includes('class="stat"'));
  assert.ok(!bare.includes('ON ORDER" IS CALCULATED') && !bare.includes('On Order is calculated'));
  assert.ok(stockReportPrintHtml(report, {}).includes('class="stat"'));
});

test('the empty catalog renders the empty state, not a broken table', async () => {
  const report = await computeStockReport(fakeDb({ products: [], purchase_order_items: [] }), {});
  const html = stockReportPrintHtml(report);
  assert.ok(html.includes('No products match the filters.'));
  assert.ok(html.includes('No open purchase orders are currently contributing to On Order.'));
});

test('the CSV is Excel-safe: BOM, CRLF, and quoted separators', async () => {
  const report = await computeStockReport(
    fakeDb({
      products: [{ ...PRODUCTS[0], name: 'BPC-157, "premium"' }],
      purchase_order_items: [],
    }),
    {},
  );
  const csv = renderStockReportCsv(report);
  assert.equal(csv.charCodeAt(0), 0xfeff, 'UTF-8 BOM so Excel reads accents');
  assert.ok(csv.includes('\r\n'));
  const [header, row] = csv.slice(1).split('\r\n');
  assert.equal(header, 'Product,Strength,Category,Stock,Min Quantity,On Order,Need To Order,Status,Active');
  assert.ok(row.startsWith('"BPC-157, ""premium"""'), `quoting (got ${row})`);
});

test('the PDF renders without emitting a blank page per page', async () => {
  const pdf = await renderStockReportPdf(await computeStockReport(db, {}));
  assert.ok(Buffer.isBuffer(pdf) && pdf.length > 1000);
  // The footer pass draws below the bottom margin; without lib/pdf-footer.ts
  // pdfkit reads that as overflow and doubles the page count.
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  assert.ok(pages >= 1 && pages <= 2, `expected no blank twins, got ${pages} pages`);
});
