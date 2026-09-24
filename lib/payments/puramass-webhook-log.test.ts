/**
 * Unit tests for the PuraMass webhook delivery-log row builder.
 * Run with `node --test --import tsx lib/payments/puramass-webhook-log.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWebhookEventRow } from './puramass-webhook-log';

const PAID = {
  event_id: 'evt_b275e85d6d491024c589b486',
  event_type: 'store_order.payment_complete',
  referral_id: null,
  partner_reference: 'amc_f71956b5-09c6-435c-99d5-2b1793fe3a75',
  data: {
    status: 'paid',
    product_category: null,
    occurred_at: '2026-09-24T04:38:42.083Z',
    transaction_id: '7ylSVLdOqhvvc9BRZPt9',
    order_id: '7ylSVLdOqhvvc9BRZPt9',
    payment_mode: 'customer',
    currency: 'cad',
    customer: { first_name: 'Test', last_name: 'Buyer', email: 'buyer@example.com', phone: null },
    shipping: { address: '6 Milepost Place', address2: '206', city: 'Toronto', state: 'ON', zip: 'M4H 1C9', country: 'CA' },
    items: [{ sku: 'aminocan-retatrutide-10mg-vial', name: 'Retatrutide 10mg', quantity: 2, unit_price_cents: 15000 }],
  },
  metadata: {},
  created_at: '2026-09-24T04:38:42.083Z',
  patient_id: null,
  appointment_id: null,
};

test('copies the filterable fields out of a payment_complete event', () => {
  const row = buildWebhookEventRow({
    raw: JSON.stringify(PAID),
    payload: PAID,
    signatureValid: true,
    outcome: 'matched',
    responseStatus: 200,
    responseBody: { received: true, matched: true },
    puramassOrderId: '00000000-0000-0000-0000-000000000001',
  });
  assert.equal(row.event_id, PAID.event_id);
  assert.equal(row.event_type, 'store_order.payment_complete');
  assert.equal(row.partner_reference, PAID.partner_reference);
  assert.equal(row.transaction_id, '7ylSVLdOqhvvc9BRZPt9');
  assert.equal(row.status, 'paid');
  assert.equal(row.currency, 'cad');
  assert.equal(row.customer_email, 'buyer@example.com');
  assert.equal(row.occurred_at, '2026-09-24T04:38:42.083Z');
  assert.equal(row.signature_valid, true);
  assert.deepEqual(row.payload, PAID);
  assert.equal(row.raw_body, null);
  assert.equal(row.puramass_order_id, '00000000-0000-0000-0000-000000000001');
  assert.equal(row.response_status, 200);
});

test('handles the shorter shape (no shipping, no patient/appointment ids)', () => {
  const { patient_id, appointment_id, ...rest } = PAID;
  const payload = { ...rest, data: { ...PAID.data, shipping: null, transaction_id: undefined } };
  const row = buildWebhookEventRow({
    raw: JSON.stringify(payload),
    payload,
    signatureValid: true,
    outcome: 'unmatched',
    responseStatus: 200,
    responseBody: { received: true, matched: false },
  });
  assert.equal(row.transaction_id, '7ylSVLdOqhvvc9BRZPt9'); // falls back to order_id
  assert.equal(row.puramass_order_id, null);
});

test('keeps the raw body when nothing parsed', () => {
  const row = buildWebhookEventRow({
    raw: 'not json',
    signatureValid: false,
    outcome: 'bad_signature',
    responseStatus: 401,
    responseBody: { error: 'bad signature' },
  });
  assert.equal(row.payload, null);
  assert.equal(row.raw_body, 'not json');
  assert.equal(row.event_id, null);
  assert.equal(row.signature_valid, false);
});

test('drops an unparseable occurred_at rather than failing the insert', () => {
  const payload = { ...PAID, created_at: 'garbage', data: { ...PAID.data, occurred_at: 'nope' } };
  const row = buildWebhookEventRow({
    raw: '', payload, signatureValid: true, outcome: 'matched', responseStatus: 200, responseBody: {},
  });
  assert.equal(row.occurred_at, null);
});
