/**
 * Reading the customer and the amount charged out of Stealth Health's webhook
 * bodies and polled orders.
 *
 * Run with `node --test --import tsx lib/payments/stealth-health-portal.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPlaceholderEmail,
  portalCustomer,
  portalMoney,
  portalOrderBody,
} from './stealth-health-portal';

const webhook = {
  event_id: 'evt_1',
  event_type: 'store_order.payment_complete',
  data: {
    status: 'paid',
    transaction_id: 'txn_1',
    currency: 'cad',
    customer: { first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' },
    items: [
      { sku: 'a', quantity: 2, unit_price_cents: 4500 },
      { sku: 'b', quantity: 1, unit_price_cents: 1000 },
    ],
  },
};

test('portalOrderBody finds the order in a webhook, a polled response or a bare order', () => {
  assert.equal(portalOrderBody(webhook)?.transaction_id, 'txn_1');
  assert.equal(portalOrderBody({ data: { order: { id: 'x' } } })?.id, 'x');
  assert.equal(portalOrderBody({ order: { id: 'y' } })?.id, 'y');
  assert.equal(portalOrderBody({ id: 'z' })?.id, 'z');
  assert.equal(portalOrderBody(null), null);
});

test('portalCustomer joins the name and drops guest placeholder emails', () => {
  assert.deepEqual(portalCustomer(webhook), { name: 'Ada Lovelace', email: 'ada@example.com' });
  assert.deepEqual(
    portalCustomer({ customer: { first_name: 'Bo', email: 'guest+1@vyta.local' } }),
    { name: 'Bo', email: null },
  );
  assert.equal(portalCustomer({ customer: {} }), null);
  assert.equal(isPlaceholderEmail('guest+1@vyta.local'), true);
  assert.equal(isPlaceholderEmail('a@b.co'), false);
});

test('portalMoney: priced lines plus the hand-off shipping when the webhook has no shipping', () => {
  assert.deepEqual(portalMoney(webhook, 1500), { total_cents: 11500, currency: 'cad', shipping_from_ledger: true });
  assert.deepEqual(portalMoney(webhook, null), { total_cents: 10000, currency: 'cad', shipping_from_ledger: true });
});

test('portalMoney: an explicit total, or subtotal + shipping, wins', () => {
  assert.deepEqual(
    portalMoney({ order: { total_cents: 12345, currency: 'usd' } }, 1500),
    { total_cents: 12345, currency: 'usd', shipping_from_ledger: false },
  );
  assert.deepEqual(
    portalMoney({ subtotal_cents: 9000, shipping_total_cents: 2000, currency: 'USD' }, 1500),
    { total_cents: 11000, currency: 'usd', shipping_from_ledger: false },
  );
});

test('portalMoney: nothing priced means unknown', () => {
  assert.equal(portalMoney({ data: { items: [{ sku: 'a', quantity: 1 }] } }, 1500), null);
  assert.equal(portalMoney({ data: { status: 'paid' } }, 1500), null);
  assert.equal(portalMoney(null, 1500), null);
});
