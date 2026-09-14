/**
 * Unit tests for the PuraMass → invoice join: normalising a hand-off ledger row
 * into the block /admin/invoices, /admin/invoices/[id] and the printable
 * invoice render, and building the ledger patch that captures the rest of the
 * PuraMass order payload.
 *
 * The repo has no test runner wired up, so these use Node's built-in
 * `node:test` + `node:assert` (zero dependencies). Run with a TS-aware loader,
 * e.g. `node --test --import tsx lib/admin/puramass-invoice.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPuramassInvoice,
  normalizePuramassContext,
  centsToAmount,
  PURAMASS_INVOICE_SOURCE,
} from './puramass-invoice';
import { buildPuramassOrderDetailPatch } from '../payments/puramass';
import { puramassPriceType } from '../payments/puramass-fulfillment';
import { stripUnmigratedFields } from '../payments/puramass-columns';

/** A paid order exactly as PuraMass reports it. */
const ORDER_PAYLOAD = {
  transaction_id: 'jC0LrMp8pdipj7ky1u0k',
  status: 'paid',
  partner_reference: 'amc_587be30c-2259-431c-974c-c91bd550336e',
  currency: 'usd',
  subtotal_cents: 66700,
  payment_link: 'https://app.puramass.com/transaction/jC0LrMp8pdipj7ky1u0k',
  created_at: '2026-08-18T19:59:58.221Z',
  paid_at: '2026-08-18T20:04:30.392Z',
  expires_at: '2026-08-25T19:59:58.204Z',
  refunded_total_cents: 0,
  refunds: [],
  customer: {
    first_name: 'Jordan',
    last_name: 'Grosman',
    email: 'jgrosman7@gmail.com',
    phone: '+14167239851',
  },
  shipping: {
    address: '96 Chiltern Hill Road',
    address2: null,
    city: 'Toronto',
    state: 'ON',
    zip: 'M6C 3B8',
    country: 'CA',
  },
  items: [
    {
      sku: 'aminocan-bacteriostatic-water-10ml-case',
      name: 'Aminocan- Bacteriostatic Water 10mL (Case)',
      quantity: 1,
      unit_price_cents: 8700,
    },
    {
      sku: 'aminocan-hgh-191aa-somatropin-36-iu-vial',
      name: 'Aminocan- HGH 191AA (Somatropin) 36 IU (Single Vial)',
      quantity: 2,
      unit_price_cents: 14500,
    },
  ],
};

/** The ledger row that payload lands in, once the webhook/poll has applied it. */
const LEDGER_ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  invoice_id: '22222222-2222-2222-2222-222222222222',
  partner_reference: ORDER_PAYLOAD.partner_reference,
  transaction_id: ORDER_PAYLOAD.transaction_id,
  payment_link: ORDER_PAYLOAD.payment_link,
  status: 'paid',
  currency: 'usd',
  subtotal_cents: 66700,
  customer_email: 'jgrosman7@gmail.com',
  customer_name: 'Jordan Grosman',
  customer_phone: '+14167239851',
  shipping_address: ORDER_PAYLOAD.shipping,
  shipping_address_source: 'puramass',
  shipping_address_updated_at: '2026-08-18T20:04:31.000Z',
  address_requested_at: null,
  created_at: ORDER_PAYLOAD.created_at,
  paid_at: ORDER_PAYLOAD.paid_at,
  expires_at: ORDER_PAYLOAD.expires_at,
  refunded_total_cents: 0,
  refunds: [],
  paid_items: ORDER_PAYLOAD.items,
  items: [{ sku: 'aminocan-bacteriostatic-water-10ml-case', quantity: 1 }],
};

// ---- Source detection -----------------------------------------------------

test('only a stealth_health invoice counts as a PuraMass sale', () => {
  assert.equal(isPuramassInvoice({ source: PURAMASS_INVOICE_SOURCE }), true);
  assert.equal(isPuramassInvoice({ source: null }), false);
  assert.equal(isPuramassInvoice({}), false);
  assert.equal(isPuramassInvoice(null), false);
});

// ---- Normalisation --------------------------------------------------------

test('normalises a ledger row into the invoice block', () => {
  const ctx = normalizePuramassContext(LEDGER_ROW);

  assert.equal(ctx.transaction_id, 'jC0LrMp8pdipj7ky1u0k');
  assert.equal(ctx.partner_reference, ORDER_PAYLOAD.partner_reference);
  assert.equal(ctx.status, 'paid');
  // Currency is upper-cased for display; the ledger stores PuraMass's 'usd'.
  assert.equal(ctx.currency, 'USD');
  assert.equal(ctx.customer_name, 'Jordan Grosman');
  assert.equal(ctx.customer_phone, '+14167239851');
  assert.equal(ctx.shipping_address?.city, 'Toronto');
  assert.equal(ctx.shipping_address_source, 'puramass');
  assert.equal(ctx.refunded_total_cents, 0);
  assert.equal(centsToAmount(ctx.subtotal_cents), 667);
});

test('prefers the priced PuraMass items over the hand-off sku list', () => {
  const ctx = normalizePuramassContext(LEDGER_ROW);
  assert.equal(ctx.items.length, 2);
  assert.equal(ctx.items[1].sku, 'aminocan-hgh-191aa-somatropin-36-iu-vial');
  assert.equal(ctx.items[1].quantity, 2);
  assert.equal(ctx.items[1].unit_price_cents, 14500);
});

test('falls back to the hand-off items, which carry no prices', () => {
  const ctx = normalizePuramassContext({ ...LEDGER_ROW, paid_items: null });
  assert.equal(ctx.items.length, 1);
  assert.equal(ctx.items[0].unit_price_cents, null);
  assert.equal(ctx.items[0].quantity, 1);
});

test('an order with no address reported yet normalises to null, not a shell', () => {
  const ctx = normalizePuramassContext({
    ...LEDGER_ROW,
    shipping_address: { address: null, city: null, state: null, zip: null, country: null },
    shipping_address_source: null,
  });
  assert.equal(ctx.shipping_address, null);
  assert.equal(ctx.shipping_address_source, null);
});

test('reads refunds under any of the names PuraMass may use', () => {
  const ctx = normalizePuramassContext({
    ...LEDGER_ROW,
    refunded_total_cents: 14500,
    refunds: [
      { id: 're_1', amount_cents: 8700, reason: 'Damaged vial', created_at: '2026-08-20T10:00:00Z' },
      { refund_id: 're_2', amount: 5800, note: 'Goodwill', refunded_at: '2026-08-21T10:00:00Z' },
    ],
  });
  assert.equal(ctx.refunded_total_cents, 14500);
  assert.deepEqual(ctx.refunds.map((r) => r.id), ['re_1', 're_2']);
  assert.deepEqual(ctx.refunds.map((r) => r.amount_cents), [8700, 5800]);
  assert.equal(ctx.refunds[1].reason, 'Goodwill');
});

test('missing ledger columns degrade to empty rather than throwing', () => {
  // What a row looks like before puramass-order-details-migration.sql runs.
  const ctx = normalizePuramassContext({
    id: 'x',
    partner_reference: 'amc_1',
    status: 'payment_pending',
  });
  assert.equal(ctx.refunded_total_cents, 0);
  assert.deepEqual(ctx.refunds, []);
  assert.deepEqual(ctx.items, []);
  assert.equal(ctx.expires_at, null);
  assert.equal(ctx.currency, 'USD');
});

// ---- Ledger patch ---------------------------------------------------------

test('captures expiry, refunds and the priced items from a payload', () => {
  const patch = buildPuramassOrderDetailPatch(ORDER_PAYLOAD);
  assert.equal(patch.expires_at, ORDER_PAYLOAD.expires_at);
  assert.equal(patch.refunded_total_cents, 0);
  assert.deepEqual(patch.refunds, []);
  assert.equal((patch.paid_items as unknown[]).length, 2);
});

test('a payload without those blocks writes nothing, so it cannot clear them', () => {
  assert.deepEqual(buildPuramassOrderDetailPatch({}), {});
  // The bare { sku, quantity } list is the hand-off form we already store.
  assert.deepEqual(
    buildPuramassOrderDetailPatch({ items: [{ sku: 'a', quantity: 1 }] }),
    {},
  );
});

test('the missing-column fallback drops the order-detail columns too', () => {
  assert.deepEqual(
    stripUnmigratedFields({
      status: 'paid',
      paid_at: 'now',
      expires_at: 'later',
      refunded_total_cents: 100,
      refunds: [],
      paid_items: [],
    }),
    { status: 'paid', paid_at: 'now' },
  );
});

// ---- Price type (box vs vial) ---------------------------------------------

test('the SKU suffix decides the pricing unit', () => {
  // `…-vial` is PuraMass's single-vial listing; everything else is a box.
  assert.equal(
    puramassPriceType({ sku: 'aminocan-retatrutide-10mg-vial' }),
    'vial',
  );
  assert.equal(
    puramassPriceType({ sku: 'aminocan-bacteriostatic-water-10ml-case' }),
    'box',
  );
  assert.equal(puramassPriceType({ sku: 'puramass-semaglutide-5mg-10-pack' }), 'box');
  // Case and stray whitespace must not change the verdict.
  assert.equal(puramassPriceType({ sku: '  AMINOCAN-TIRZEPATIDE-10MG-VIAL ' }), 'vial');
});

test('the SKU wins over the free-text name', () => {
  assert.equal(
    puramassPriceType({ sku: 'aminocan-x-case', name: 'Thing (Single Vial)' }),
    'box',
  );
});

test('a line with no SKU falls back to the name suffix', () => {
  // Ledger rows predating `paid_items` carry a name but no per-line SKU.
  assert.equal(
    puramassPriceType({ name: 'Aminocan- Retatrutide 10mg (Single Vial)' }),
    'vial',
  );
  assert.equal(puramassPriceType({ sku: '', name: 'Aminocan- HGH 10 IU ( single vial )' }), 'vial');
  assert.equal(puramassPriceType({ name: 'Aminocan- Bacteriostatic Water 10mL (Case)' }), 'box');
  // Only a trailing "(Single Vial)" counts — not a mention mid-name.
  assert.equal(puramassPriceType({ name: 'Single Vial Starter Kit (Case)' }), 'box');
});

test('an item with nothing to go on stays a box', () => {
  // Matches the column default, so the fallback never invents a vial sale.
  assert.equal(puramassPriceType({}), 'box');
  assert.equal(puramassPriceType({ sku: null, name: null }), 'box');
});
