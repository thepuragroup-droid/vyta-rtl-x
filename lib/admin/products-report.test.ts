/**
 * Tests for the Products Report.
 *
 *   node --test --import tsx lib/admin/products-report.test.ts
 *
 * The properties that matter:
 *   • Price is always the catalog's own `products.price`, in CAD. There is one
 *     price per product and no pricing-source picker.
 *   • Revenue is history and is NOT the catalog price — it comes from
 *     `order_items.price_at_time`, which is what was actually charged.
 *   • Sales join by product_id (TEXT, a uuid-as-string) with a product_name
 *     fallback for lines that never carried an id.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeProductsReport,
  productsReportPrintHtml,
} from './products-report';

const PRODUCTS = [
  {
    id: 'p1', name: 'BPC-157', slug: 'bpc-157', sku: 'B1', strength: '5mg',
    category: 'Peptides', active: true, price: 40,
    stock_quantity: 243, low_stock_threshold: 300, vials_per_box: 10,
  },
  {
    id: 'p2', name: 'TB-500', slug: null, sku: 'T5', strength: null,
    category: 'Other', active: false, price: 60,
    stock_quantity: 0, low_stock_threshold: null, vials_per_box: 10,
  },
  {
    id: 'p3', name: 'Ipamorelin', slug: 'ipa', sku: null, strength: '2mg',
    category: 'Peptides', active: true, price: 20,
    stock_quantity: 5, low_stock_threshold: null, vials_per_box: 10,
  },
];

const ORDER_ITEMS = [
  { product_id: 'p1', product_name: 'BPC-157', quantity: 3, price_at_time: 35 },
  // No product_id — this line can only be matched by name.
  { product_id: null, product_name: 'Ipamorelin', quantity: 2, price_at_time: 15 },
];

const BASE_TABLES: Record<string, any[]> = {
  products: PRODUCTS,
  order_items: ORDER_ITEMS,
};

function fakeDb(overrides: Record<string, any[]> = {}): any {
  const tables = { ...BASE_TABLES, ...overrides };
  const build = (name: string) => {
    const api: any = {
      _single: false,
      select() { return api; },
      order() { return api; },
      eq() { return api; },
      maybeSingle() { api._single = true; return api; },
      then(res: any) {
        const rows = tables[name] ?? [];
        return Promise.resolve({ data: api._single ? (rows[0] ?? null) : rows, error: null }).then(res);
      },
    };
    return api;
  };
  return { from: (n: string) => build(n) };
}

test('sales join by product_id, falling back to product_name', async () => {
  const { rows } = await computeProductsReport(fakeDb(), {});
  const p1 = rows.find((r) => r.id === 'p1')!;
  const p3 = rows.find((r) => r.id === 'p3')!;
  assert.equal(p1.unitsSold, 3);
  assert.equal(p1.revenue, 105, '3 × 35');
  assert.equal(p3.unitsSold, 2, 'matched by name — the line carried no id');
  assert.equal(p3.revenue, 30);
  assert.equal(rows.find((r) => r.id === 'p2')!.revenue, 0, 'no sales');
});

test('SKU prefers the slug and falls back to the sku column', async () => {
  const { rows } = await computeProductsReport(fakeDb(), {});
  assert.equal(rows.find((r) => r.id === 'p1')!.sku, 'bpc-157');
  assert.equal(rows.find((r) => r.id === 'p2')!.sku, 'T5', 'slug is null');
});

test('an unset low_stock_threshold behaves as 10 on THIS report', async () => {
  const { rows, totals } = await computeProductsReport(fakeDb(), {});
  const p3 = rows.find((r) => r.id === 'p3')!;
  assert.equal(p3.minQty, 10);
  assert.equal(p3.isLow, true, '5 vials is under the default of 10');
  // p1 (243 ≤ 300) and p3 (5 ≤ 10). p2 is out, not low.
  assert.equal(totals.lowStock, 2);
  assert.equal(totals.outOfStock, 1);
});

test('the stock-status filter narrows to low / out / either', async () => {
  const db = fakeDb();
  assert.equal((await computeProductsReport(db, { stockStatus: 'low' })).rows.length, 2);
  assert.equal((await computeProductsReport(db, { stockStatus: 'out' })).rows.length, 1);
  assert.equal((await computeProductsReport(db, { stockStatus: 'lowout' })).rows.length, 3);
  assert.equal((await computeProductsReport(db, { stockStatus: 'all' })).rows.length, 3);
});

test('search covers name, category and strength', async () => {
  const db = fakeDb();
  assert.equal((await computeProductsReport(db, { search: 'bpc' })).rows.length, 1);
  assert.equal((await computeProductsReport(db, { search: 'peptides' })).rows.length, 2, 'category');
  assert.equal((await computeProductsReport(db, { search: '2mg' })).rows.length, 1, 'strength');
  assert.equal((await computeProductsReport(db, { search: 'zzz' })).rows.length, 0);
});

test('Price is the catalog price and Stock Value follows it', async () => {
  const { rows } = await computeProductsReport(fakeDb(), {});
  const p1 = rows.find((r) => r.id === 'p1')!;
  assert.equal(p1.price, 40, "products.price, nothing else");
  assert.equal(p1.stockValue, 243 * 40);
});

test('Revenue is historical and does NOT follow the catalog price', async () => {
  // p1 sells at 40 today but those 3 units went out at 35. Revenue is what was
  // charged, not what the catalog says now.
  const { rows, totals } = await computeProductsReport(fakeDb(), {});
  const p1 = rows.find((r) => r.id === 'p1')!;
  assert.equal(p1.price, 40);
  assert.equal(p1.revenue, 105, '3 × 35, not 3 × 40');
  assert.equal(totals.revenue, 135);
});

test('the analytics loader replaces the order_items scan entirely', async () => {
  const report = await computeProductsReport(fakeDb(), {
    orderItemsLoader: async () => [
      { product_id: 'p2', product_name: 'TB-500', quantity: 1, price_at_time: 50 },
    ],
  });
  assert.equal(report.totals.revenue, 50, 'only what the loader returned');
  assert.equal(report.rows.find((r) => r.id === 'p1')!.revenue, 0);
});

// ---- rendering ----

test('the default render names the full catalog and the "None" filter chip', async () => {
  const html = productsReportPrintHtml(await computeProductsReport(fakeDb(), {}));
  assert.ok(html.includes('All products (3)'));
  assert.ok(html.includes('None — all products'));
  assert.ok(html.includes('Pricing in CAD'));
  assert.ok(html.includes('$105.00'), 'revenue cell');
  assert.ok(html.includes('24 boxes (3 vials)'), 'stock in boxes by default');
});

test('a stock-status filter retitles the table and adds a chip', async () => {
  const report = await computeProductsReport(fakeDb(), { stockStatus: 'out' });
  const html = productsReportPrintHtml(report);
  assert.ok(html.includes('Out of stock (1)'));
  assert.ok(html.includes('Stock: Out of stock only'));
});

test('a report with no money columns drops the currency chip and the card sub-line', async () => {
  const report = await computeProductsReport(fakeDb(), {});
  const html = productsReportPrintHtml(report, { columns: ['sku', 'product'], cards: ['products', 'stock'] });
  assert.ok(!html.includes('$'), 'a catalog-only report carries no money at all');
  assert.ok(!html.includes('Pricing in'));
});

test('the currency is stated only when the report carries money', async () => {
  const report = await computeProductsReport(fakeDb(), {});
  assert.ok(productsReportPrintHtml(report).includes('Pricing in CAD'));
  // A catalog-only report has no dollar figures to attribute.
  const noMoney = productsReportPrintHtml(report, { columns: ['sku'], cards: ['products'] });
  assert.ok(!noMoney.includes('Pricing in'));
});

test('columns render in canonical order regardless of the order requested', async () => {
  const report = await computeProductsReport(fakeDb(), {});
  const html = productsReportPrintHtml(report, { columns: ['revenue', 'sku'] });
  const head = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));
  assert.equal(head, '<thead><tr><th>SKU</th><th class="num">Revenue</th></tr>');
});

test('an empty or unrecognised column selection falls back to every column', async () => {
  const report = await computeProductsReport(fakeDb(), {});
  for (const columns of [[], ['bogus']]) {
    const html = productsReportPrintHtml(report, { columns });
    assert.ok(html.includes('>Description<') && html.includes('>Revenue<'),
      `columns=${JSON.stringify(columns)} should render every column`);
  }
});

test('an empty card selection means NO cards, not all of them', async () => {
  // The Pricing section contributes a column but no cards, so a report built
  // from Pricing alone asks for zero cards. Falling back to "all" there would
  // print the Revenue card to an admin who deselected revenue.
  const report = await computeProductsReport(fakeDb(), {});
  const html = productsReportPrintHtml(report, { cards: [], columns: ['price'] });
  assert.ok(!html.includes('class="stat"'), 'no stat grid at all');
  assert.ok(!html.includes('Low / Out Of Stock'));
  assert.ok(html.includes('>Price<'), 'the requested column still renders');

  // Absent (undefined) still means every card.
  assert.ok(productsReportPrintHtml(report, {}).includes('Low / Out Of Stock'));
});

test('stock display follows the unit and remainder options', async () => {
  const report = await computeProductsReport(fakeDb(), {});
  assert.ok(productsReportPrintHtml(report, { stockUnit: 'vials' }).includes('243 vials'));
  assert.ok(productsReportPrintHtml(report, { stockUnit: 'vials' }).includes('Stock in vials'));
  assert.ok(productsReportPrintHtml(report, { showRemainder: false }).includes('Low · 24 boxes<'));
});

test('status and stock cells render as pills', async () => {
  const html = productsReportPrintHtml(await computeProductsReport(fakeDb(), {}));
  assert.ok(html.includes('<span class="pill red">Out of stock</span>'));
  assert.ok(html.includes('<span class="pill red">Inactive</span>'));
  assert.ok(html.includes('<span class="pill green">Active</span>'));
  assert.ok(html.includes('class="pill amber">Low · '));
});

test('no matching rows still renders the cards, with zeros', async () => {
  const html = productsReportPrintHtml(await computeProductsReport(fakeDb(), { search: 'zzz' }));
  assert.ok(html.includes('No products match the filters.'));
  assert.ok(html.includes('class="stat"'));
  assert.ok(html.includes('All products (0)'));
});

test('extra filter chips (the ad-scope note) reach the printed copy', async () => {
  const html = productsReportPrintHtml(await computeProductsReport(fakeDb(), {}), {
    extraFilterChips: ['Paid ads only'],
  });
  assert.ok(html.includes('Paid ads only'));
});

test('print=0 drops the auto-print script', async () => {
  const report = await computeProductsReport(fakeDb(), {});
  assert.ok(productsReportPrintHtml(report).includes('window.print()'));
  assert.ok(!productsReportPrintHtml(report, { autoPrint: false }).includes('window.print()'));
});

test('a catalog-only report skips the sales scan entirely', async () => {
  let scanned = false;
  const db = fakeDb();
  const origFrom = db.from;
  db.from = (n: string) => { if (n === 'order_items') scanned = true; return origFrom(n); };

  const report = await computeProductsReport(db, { includeSales: false });
  assert.equal(scanned, false, 'order_items was never queried');
  assert.equal(report.totals.revenue, 0);
  assert.equal(report.totals.unitsSold, 0);
});

test('the sales scan runs by default', async () => {
  let scanned = false;
  const db = fakeDb();
  const origFrom = db.from;
  db.from = (n: string) => { if (n === 'order_items') scanned = true; return origFrom(n); };

  await computeProductsReport(db, {});
  assert.equal(scanned, true);
});
