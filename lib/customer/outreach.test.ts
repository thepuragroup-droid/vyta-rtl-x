/**
 * Unit tests for the rules behind a bulk abandoned-cart send.
 *
 * These cover the decisions that pick WHICH cart a buyer is chased about and
 * WHO is addressed, because getting either wrong is a customer-visible mistake
 * rather than a broken page:
 *   - a cancelled hand-off is never picked up automatically as "your cart is
 *     still waiting";
 *   - a buyer with several dead checkouts is chased about the one that can
 *     still take payment, not just the newest;
 *   - merging two template sets cannot produce two templates with one key;
 *   - the id a bulk send addresses somebody by is built one way only.
 *
 * The repo has no test runner wired up, so these use Node's built-in
 * `node:test` + `node:assert` (zero dependencies). Run with a TS-aware loader,
 * e.g. `node --test --import tsx lib/customer/outreach.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  abandonedPriority,
  byAbandonedPriority,
  hasReusablePaymentLink,
  isRecoverableStatus,
  PAYMENT_LINK_STATUSES,
} from '../payments/puramass-abandoned';
import { outreachIdFor, puramassId, isPuramassId, emailFromPuramassId } from '../admin/customer-id';
import { mergeTemplates, PROMO_TEMPLATES, RECOVERY_TEMPLATES } from './promo-email';
import { cartAmount, cartStatusLabel, recipientLabel } from './outreach-types';

// ---- which carts a bulk send may pick up ----------------------------------

test('only pending and expired checkouts carry a live payment link', () => {
  assert.deepEqual([...PAYMENT_LINK_STATUSES], ['payment_pending', 'expired']);
  assert.equal(hasReusablePaymentLink('payment_pending'), true);
  assert.equal(hasReusablePaymentLink('expired'), true);
  assert.equal(hasReusablePaymentLink('paid'), false);
});

test('a cancelled hand-off stays recoverable by hand but is never picked up in bulk', () => {
  // The per-order dialog still offers it — the email there says the order was
  // cancelled. A bulk chase must not tell that buyer their cart is waiting.
  assert.equal(isRecoverableStatus('cancelled'), true);
  assert.equal(hasReusablePaymentLink('cancelled'), false);
});

// ---- choosing one cart per buyer ------------------------------------------

const cart = (status: string, created_at: string) => ({ status, created_at });

test('a payable checkout beats a newer dead one', () => {
  const pending = cart('payment_pending', '2026-01-01T00:00:00Z');
  const expired = cart('expired', '2026-06-01T00:00:00Z');
  assert.ok(byAbandonedPriority(pending, expired) < 0);
  assert.deepEqual([expired, pending].sort(byAbandonedPriority)[0], pending);
});

test('within one status the newest cart wins — it is the one they remember', () => {
  const older = cart('expired', '2026-01-01T00:00:00Z');
  const newer = cart('expired', '2026-06-01T00:00:00Z');
  assert.deepEqual([older, newer].sort(byAbandonedPriority)[0], newer);
});

test('anything not payable sorts last', () => {
  assert.ok(abandonedPriority('payment_pending') < abandonedPriority('expired'));
  assert.ok(abandonedPriority('expired') < abandonedPriority('cancelled'));
});

// ---- addressing a recipient ------------------------------------------------

test('an account is addressed by its id, a Stealth Health buyer by their email', () => {
  assert.equal(
    outreachIdFor({ customer_id: 'e5a2b1c4-0000-4000-8000-000000000000', customer_email: 'a@b.com' }),
    'e5a2b1c4-0000-4000-8000-000000000000',
  );
  assert.equal(outreachIdFor({ customer_id: null, customer_email: 'Buyer@Example.com' }), 'pm:buyer@example.com');
  // Nobody to write to.
  assert.equal(outreachIdFor({ customer_id: null, customer_email: null }), null);
  assert.equal(outreachIdFor({ customer_id: null, customer_email: '   ' }), null);
});

test('a puramass id round-trips through its email', () => {
  const id = puramassId('  Buyer@Example.com ');
  assert.equal(id, 'pm:buyer@example.com');
  assert.equal(isPuramassId(id), true);
  assert.equal(emailFromPuramassId(id), 'buyer@example.com');
  assert.equal(isPuramassId('e5a2b1c4-0000-4000-8000-000000000000'), false);
});

// ---- offering both template sets at once ------------------------------------

test('merging template sets keeps one template per key', () => {
  const merged = mergeTemplates(RECOVERY_TEMPLATES, PROMO_TEMPLATES);
  const keys = merged.map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length, 'a duplicated key would render two identical buttons');
  // Both sets end with `custom`; the recovery one is listed first, so it wins.
  assert.equal(keys.filter((k) => k === 'custom').length, 1);
  // Recovery wording leads, because there is a cart to recover.
  assert.equal(merged[0].key, RECOVERY_TEMPLATES[0].key);
  // Nothing from either set is lost.
  for (const t of [...RECOVERY_TEMPLATES, ...PROMO_TEMPLATES]) {
    assert.ok(keys.includes(t.key), `${t.key} should survive the merge`);
  }
});

// ---- what the picker says ---------------------------------------------------

test('a recipient is labelled by name, falling back to their address', () => {
  assert.equal(recipientLabel({ name: 'Jordan Grosman', email: 'j@x.com' }), 'Jordan Grosman');
  assert.equal(recipientLabel({ name: '   ', email: 'j@x.com' }), 'j@x.com');
  assert.equal(recipientLabel({ name: null, email: 'j@x.com' }), 'j@x.com');
});

test('the picker and the status tab use the same word for a pending cart', () => {
  assert.equal(cartStatusLabel('payment_pending'), 'pending');
  assert.equal(cartStatusLabel('expired'), 'expired');
});

test('a cart with no amount on the ledger shows no amount at all', () => {
  const base = {
    orderId: '1', reference: 'amc_1', status: 'expired', createdAt: '2026-01-01T00:00:00Z',
    hasPaymentLink: true, itemCount: 1, chased: 0, lastChasedAt: null,
  };
  assert.equal(cartAmount({ ...base, total: 240, currency: 'usd' }), '$240.00 USD');
  // Defaults to USD rather than printing a bare number with no currency.
  assert.equal(cartAmount({ ...base, total: 240, currency: null }), '$240.00 USD');
  assert.equal(cartAmount({ ...base, total: null, currency: 'USD' }), null);
});
