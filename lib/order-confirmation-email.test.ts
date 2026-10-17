/**
 * Tests for the order confirmation email template.
 *
 *   node --test --import tsx lib/order-confirmation-email.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adminOrderPaidSubject,
  formatOrderDate,
  renderAdminOrderPaidHtml,
  renderAdminOrderPaidText,
  orderConfirmationSubject,
  renderOrderConfirmationHtml,
  renderOrderConfirmationText,
  type AdminOrderPaidEmailData,
} from './order-confirmation-email';
import type { ConfirmationEmailData } from './order-confirmation-data';

const base: ConfirmationEmailData = {
  to: 'm@buyer.ca',
  customerName: 'Marguerite <b>',
  orderNumber: 'VYTA-1016',
  items: [
    { name: 'GLP-3 20mg', quantity: 2, price: 133, unit: 'vial', imageUrl: 'https://www.vytabio.com/images/products/GLP-3%2020mg.png' },
    { name: 'MOTS C 40mg', quantity: 1, price: 214, unit: 'case', vialsPerBox: 5 },
  ],
  subtotal: 480,
  discount: 115.2,
  discountLabel: 'VYTA20 + 5% limited-time offer',
  shipping: 0,
  total: 364.8,
  currency: 'CAD',
  orderDate: '2026-10-04T18:00:00Z',
  paymentStatus: 'Paid',
  tax: 0,
  shipTo: { name: 'Marguerite P', lines: ['322 Locheed Dr', 'Hamilton, ON L8T 4Z6', 'Canada'], phone: '289-489-1471' },
  viewOrderUrl: 'https://www.vytabio.com/login?redirect=%2Faccount%2Forders%2Fabc%3Fclaim%3Dx&email=m%40buyer.ca',
};

test('dates render as the store-local long date', () => {
  assert.equal(formatOrderDate('2026-10-04T18:00:00Z'), 'October 4, 2026');
  assert.equal(formatOrderDate('2026-10-05'), 'October 5, 2026');
  // 02:00 UTC on Oct 5 is still Oct 4 in New York.
  assert.equal(formatOrderDate('2026-10-05T02:00:00Z'), 'October 4, 2026');
  assert.equal(formatOrderDate('nope'), null);
  assert.equal(formatOrderDate(undefined), null);
});

test('subject is unchanged', () => {
  assert.equal(orderConfirmationSubject(base), 'Order Confirmed - VYTA-1016');
});

test('html carries every section, escaped', () => {
  const html = renderOrderConfirmationHtml(base, 'https://www.vytabio.com/');
  assert.match(html, /Thank you<br>for <span[^>]*>your order\.<\/span>/);
  assert.match(html, /VYTA-1016/);
  assert.match(html, /October 4, 2026/);
  assert.match(html, /\$266\.00/); // 2 × 133
  assert.match(html, /Pack of 5/);
  assert.match(html, /Single vial/);
  assert.match(html, /\$364\.80 CAD/);
  assert.ok(!html.includes('You saved'));
  assert.match(html, /Discount <span[^>]*>\(VYTA20 \+ 5% limited-time offer\)<\/span>/);
  assert.match(html, /-\$115\.20/);
  // Lucide / Font Awesome icons as hosted PNGs, never emoji or inline SVG.
  for (const name of ['file-text-blue', 'calendar-blue', 'check-teal', 'map-pin-blue', 'package-blue', 'truck-blue', 'package-open-blue', 'mail-blue', 'shield-check-white', 'canadian-maple-leaf-white', 'arrow-right-white']) {
    assert.ok(html.includes(`src="https://www.vytabio.com/images/email/${name}.png"`), name);
  }
  assert.ok(!/<svg/i.test(html));
  assert.ok(!/&#1\d{5};/.test(html), 'no emoji entities');
  assert.match(html, /322 Locheed Dr/);
  assert.match(html, /View Order Details/);
  assert.ok(html.includes('href="https://www.vytabio.com/login?redirect=%2Faccount%2Forders%2Fabc%3Fclaim%3Dx&amp;email=m%40buyer.ca"'));
  assert.ok(html.includes('src="https://www.vytabio.com/images/vyta-mark.png"'));
  assert.ok(html.includes("url('https://www.vytabio.com/images/email/order-hero.jpg')"));
  assert.ok(html.includes('Marguerite &lt;b&gt;'));
  assert.ok(!html.includes('Marguerite <b>'));
  assert.match(html, /For research purposes only/);
});

test('optional sections drop out cleanly', () => {
  const { viewOrderUrl: _u, shipTo: _s, orderDate: _d, tax: _t, ...rest } = base;
  const { discountLabel: _l, ...noLabel } = rest;
  const html = renderOrderConfirmationHtml({ ...noLabel, discount: 10 }, 'https://www.vytabio.com');
  assert.ok(!html.includes('View Order Details'));
  assert.ok(!html.includes('Shipping Address'));
  assert.ok(!html.includes('Order Date'));
  assert.match(html, /-\$10\.00/);
  assert.ok(!html.includes('(VYTA20'));
  assert.match(html, /Free/);
});

test('plain-text body mirrors the html', () => {
  const text = renderOrderConfirmationText(base);
  assert.match(text, /Order number: VYTA-1016/);
  assert.match(text, /GLP-3 20mg \(Single vial\) × 2 — \$266\.00/);
  assert.match(text, /Discount \(VYTA20 \+ 5% limited-time offer\): -\$115\.20/);
  assert.match(text, /Total: \$364\.80 CAD/);
  assert.match(text, /View your order/);
});

const admin: AdminOrderPaidEmailData = {
  order: { ...base, to: '' },
  source: 'stealth_health',
  paidVia: 'checkout',
  customer: { name: 'Marguerite P', email: 'm@buyer.ca', phone: '289-489-1471' },
  courier: 'Canada Post Expedited',
  discountCode: 'VYTA20',
  stockWarnings: ['Custom blend × 1'],
  invoiceUrl: 'https://www.vytabio.com/admin/invoices/abc',
};

test('admin email: identical to the customer confirmation, admin subject', () => {
  const site = 'https://www.vytabio.com';
  assert.equal(renderAdminOrderPaidHtml(admin, site), renderOrderConfirmationHtml(admin.order, site));
  assert.equal(renderAdminOrderPaidText(admin), renderOrderConfirmationText(admin.order));
  assert.equal(adminOrderPaidSubject(admin), 'New order: VYTA-1016 · Marguerite P · $364.80 CAD');
});

test('admin email for a manual invoice', () => {
  const manual: AdminOrderPaidEmailData = {
    ...admin,
    source: 'manual',
    paidVia: 'admin',
    customer: { name: null, email: null, phone: null },
  };
  assert.equal(adminOrderPaidSubject(manual), 'Invoice paid: VYTA-1016 · Guest · $364.80 CAD');
  assert.equal(renderAdminOrderPaidHtml(manual, 'https://www.vytabio.com'), renderOrderConfirmationHtml(manual.order, 'https://www.vytabio.com'));
});

test('every pack ordered shows in the email at the price and amount charged', async () => {
  const { packPriceFor } = await import('./pricing');
  const { stealthHealthConfirmationData } = await import('./order-confirmation-data');
  const A = '11111111-1111-1111-1111-111111111111';
  const B = '22222222-2222-2222-2222-222222222222';
  // A: $25 vial with a discounted 3-pack and 10-pack. B: packs at vial × size.
  const productA = {
    price: 250, vial_price: 25, vials_per_box: 10,
    pack_options: [{ size: 1 }, { size: 3, price: 66, badge: 'Most Popular' }, { size: 10, price: 200 }],
  };
  const productB = { price: 400, vial_price: null, vials_per_box: 10, pack_sizes: [1, 5] };
  const order = [
    { product_id: A, product: productA, name: 'BPC-157 10mg', pack: 3, qty: 2 },
    { product_id: A, product: productA, name: 'BPC-157 10mg', pack: 1, qty: 1 },
    { product_id: A, product: productA, name: 'BPC-157 10mg', pack: 10, qty: 1 },
    { product_id: B, product: productB, name: 'TB-500 5mg', pack: 5, qty: 1 },
  ];
  // What the hand-off writes: list price per pack, then 10% off each line.
  const lines = order.map((o) => {
    const list = packPriceFor(o.product, o.pack);
    return {
      product_id: o.product_id,
      description: o.pack > 1 ? `${o.name} — Pack of ${o.pack}` : `${o.name} — Single vial`,
      qty: o.qty,
      unit_price: Math.round(list * 90) / 100,
      price_type: o.pack > 1 ? 'box' : 'vial',
      vials_per_unit: o.pack,
      list,
    };
  });
  const charged = Math.round(lines.reduce((s, l) => s + l.qty * l.unit_price, 0) * 100) / 100;
  const ledger = {
    customer_name: 'Sam',
    discount_code: 'VYTA10',
    discount_code_percent: 10,
    items: lines.map((l) => ({
      product_id: l.product_id,
      pack_size: l.vials_per_unit,
      quantity: l.qty,
      list_unit_price_cents: Math.round(l.list * 100),
    })),
  };
  const invoice = {
    id: 'inv-1', invoice_number: 'VYTA-2001', customer_email: 'sam@buyer.ca', status: 'paid',
    subtotal: charged, shipping_cost: 15, tax_total: 0, total: charged + 15, currency: 'CAD',
  };
  const data = stealthHealthConfirmationData(ledger, invoice, lines)!;
  const text = renderOrderConfirmationText(data);

  assert.match(text, /BPC-157 10mg \(Pack of 3\) × 2 — \$132\.00/);
  assert.match(text, /BPC-157 10mg \(Single vial\) × 1 — \$25\.00/);
  assert.match(text, /BPC-157 10mg \(Pack of 10\) × 1 — \$200\.00/);
  assert.match(text, /TB-500 5mg \(Pack of 5\) × 1 — \$200\.00/);
  assert.match(text, /Subtotal: \$557\.00/);
  assert.match(text, /Discount \(VYTA10\): -\$55\.70/);
  assert.match(text, /Total: \$516\.30 CAD/);
  // The lines add up to the subtotal, and the summary to what was charged.
  const lineSum = data.items.reduce((s, i) => s + i.price * i.quantity, 0);
  assert.equal(Math.round(lineSum * 100) / 100, data.subtotal);
  assert.equal(Math.round((data.subtotal - data.discount + data.shipping) * 100) / 100, data.total);
});
