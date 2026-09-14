/**
 * Unit tests for the PuraMass create-order payload builder.
 *
 * The repo has no test runner wired up, so these use Node's built-in
 * `node:test` + `node:assert` (zero dependencies). Run with a TS-aware loader,
 * e.g. `node --test --import tsx lib/payments/puramass-order-body.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPuramassOrderBody, PURAMASS_CURRENCY } from './puramass';

const BASE = {
  items: [{ sku: 'puramass-5-amino-1mq-10mg-vial', quantity: 1, unit_price_cents: 15600 }],
  customer: { email: 'test@aminocan.com' },
  partnerReference: 'amc_test',
};

test('sends the partner contract shape, priced in CAD', () => {
  const body = buildPuramassOrderBody({ ...BASE, shippingTotalCents: 12300 });
  assert.deepEqual(body, {
    items: [{ sku: 'puramass-5-amino-1mq-10mg-vial', quantity: 1, unit_price_cents: 15600 }],
    currency: 'cad',
    customer: { email: 'test@aminocan.com' },
    payment: { mode: 'customer' },
    partner_reference: 'amc_test',
    shipping_total_cents: 12300,
  });
});

test('currency defaults to CAD and is always lower-cased', () => {
  assert.equal((buildPuramassOrderBody(BASE) as any).currency, PURAMASS_CURRENCY);
  assert.equal((buildPuramassOrderBody(BASE) as any).currency, 'cad');
  assert.equal(
    (buildPuramassOrderBody({ ...BASE, currency: ' USD ' }) as any).currency,
    'usd',
  );
});

test('free shipping is sent as an explicit zero', () => {
  // The promo resolves to a zero charge; omitting it would let PuraMass quote
  // its own shipping and bill a buyer who was shown $0.00.
  const body = buildPuramassOrderBody({ ...BASE, shippingTotalCents: 0 });
  assert.deepEqual(body, {
    items: [{ sku: 'puramass-5-amino-1mq-10mg-vial', quantity: 1, unit_price_cents: 15600 }],
    currency: 'cad',
    customer: { email: 'test@aminocan.com' },
    payment: { mode: 'customer' },
    partner_reference: 'amc_test',
    shipping_total_cents: 0,
  });
});

test('an unusable shipping figure is omitted so PuraMass quotes it', () => {
  for (const shippingTotalCents of [undefined, -50, Number.NaN]) {
    const body = buildPuramassOrderBody({ ...BASE, shippingTotalCents });
    assert.equal('shipping_total_cents' in body, false, String(shippingTotalCents));
  }
});

test('an unpriced line falls back to the partner catalog price', () => {
  const body = buildPuramassOrderBody({
    ...BASE,
    items: [
      { sku: 'a-vial', quantity: 2 },
      { sku: 'b-vial', quantity: 1, unit_price_cents: 0 },
      { sku: 'c-vial', quantity: 3, unit_price_cents: 8712.4 },
    ],
  });
  assert.deepEqual((body as any).items, [
    { sku: 'a-vial', quantity: 2 },
    { sku: 'b-vial', quantity: 1 },
    { sku: 'c-vial', quantity: 3, unit_price_cents: 8712 },
  ]);
});

test('customer block keeps only the fields that carry a value', () => {
  const body = buildPuramassOrderBody({
    ...BASE,
    customer: { email: ' test@aminocan.com ', first_name: 'Ada', last_name: '  ', phone: '' },
  });
  assert.deepEqual((body as any).customer, { email: 'test@aminocan.com', first_name: 'Ada' });
});
