/**
 * Unit tests for the affiliate balance. This is the "how much do we owe them"
 * number an admin pays from, so every way a commission can be settled is
 * pinned.
 *
 *   node --test --import tsx lib/affiliate/payouts.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { payoutMethodLabel, summarizeAffiliateBalance } from './payouts';

test('an affiliate with nothing has a zero balance', () => {
  const s = summarizeAffiliateBalance([], []);
  assert.equal(s.balance, 0);
  assert.equal(s.revenue, 0);
});

test('pending commissions are owed; payouts pay them down', () => {
  const s = summarizeAffiliateBalance(
    [
      { amount: 10, order_total: 100, status: 'paid', payout_id: 'p1' },
      { amount: 20, order_total: 200, status: 'pending' },
      { amount: '5.55', order_total: '55.50', status: 'pending' },
    ],
    [{ amount: 10 }],
  );
  assert.equal(s.revenue, 355.5);
  assert.equal(s.orders, 3);
  assert.equal(s.earned, 35.55);
  assert.equal(s.paidOut, 10);
  assert.equal(s.balance, 25.55);
  assert.equal(s.pendingCount, 2);
  assert.equal(s.pendingAmount, 25.55);
});

test('cancelled commissions are neither revenue nor owed', () => {
  const s = summarizeAffiliateBalance(
    [{ amount: 50, order_total: 500, status: 'cancelled' }],
    [],
  );
  assert.equal(s.revenue, 0);
  assert.equal(s.earned, 0);
  assert.equal(s.balance, 0);
});

test('commissions marked paid before the payout ledger are not owed again', () => {
  const s = summarizeAffiliateBalance(
    [{ amount: 12, order_total: 120, status: 'paid', payout_id: null }],
    [],
  );
  assert.equal(s.paidUnrecorded, 12);
  assert.equal(s.balance, 0);
});

test('an overpayment shows as a negative balance rather than vanishing', () => {
  const s = summarizeAffiliateBalance(
    [{ amount: 10, order_total: 100, status: 'paid', payout_id: 'p1' }],
    [{ amount: 15 }],
  );
  assert.equal(s.balance, -5);
});

test('payout methods read as labels', () => {
  assert.equal(payoutMethodLabel('e_transfer'), 'Interac e-Transfer');
  assert.equal(payoutMethodLabel('something'), 'something');
  assert.equal(payoutMethodLabel(null), 'Other');
});
