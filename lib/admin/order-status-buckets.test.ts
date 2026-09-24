/**
 * Tests for the shared order-outcome buckets.
 *
 *   node --test --import tsx lib/admin/order-status-buckets.test.ts
 *
 * The claim the stacked chart rests on is that the buckets are mutually
 * exclusive and total: every order lands in exactly one, so a column really is
 * the day's orders placed. These cases hold both classifiers to that.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORDER_STATUS_BUCKETS,
  ORDER_STATUS_META,
  RECOVERABLE_STATUS_BUCKETS,
  STOREFRONT_PAID_STATUSES,
  puramassStatusBucket,
  storefrontStatusBucket,
} from './order-status-buckets';

/** Every storefront status the app can write. */
const STOREFRONT_STATUSES = [
  'pending', 'received', 'confirmed', 'expired', 'processing', 'shipped',
  'delivered', 'cancelled', 'paid', 'refunded', 'partially_refunded',
];

const PURAMASS_STATUSES = ['payment_pending', 'paid', 'expired', 'cancelled', 'canceled'];

test('every bucket has a label, a description and a colour', () => {
  for (const bucket of ORDER_STATUS_BUCKETS) {
    const meta = ORDER_STATUS_META[bucket];
    assert.ok(meta.label.length > 0, bucket);
    assert.ok(meta.description.length > 0, bucket);
    assert.match(meta.color, /^#[0-9a-f]{6}$/i, bucket);
  }
});

test('every known status lands in a declared bucket', () => {
  for (const status of STOREFRONT_STATUSES) {
    assert.ok(
      ORDER_STATUS_BUCKETS.includes(storefrontStatusBucket(status)),
      `storefront ${status}`,
    );
  }
  for (const status of PURAMASS_STATUSES) {
    assert.ok(
      ORDER_STATUS_BUCKETS.includes(puramassStatusBucket(status)),
      `hosted ${status}`,
    );
  }
});

test('nothing known falls through to "other"', () => {
  for (const status of STOREFRONT_STATUSES) {
    assert.notEqual(storefrontStatusBucket(status), 'other', `storefront ${status}`);
  }
  for (const status of PURAMASS_STATUSES) {
    assert.notEqual(puramassStatusBucket(status), 'other', `hosted ${status}`);
  }
});

test('an unrecognised or empty status is "other" rather than silently paid', () => {
  assert.equal(storefrontStatusBucket(''), 'other');
  assert.equal(storefrontStatusBucket('on_hold'), 'other');
  assert.equal(puramassStatusBucket(''), 'other');
  assert.equal(puramassStatusBucket('disputed'), 'other');
});

test('the storefront paid list and the classifier agree', () => {
  for (const status of STOREFRONT_PAID_STATUSES) {
    assert.equal(storefrontStatusBucket(status), 'paid', status);
  }
});

test('a refund beats the fulfilment status it kept', () => {
  // An order refunded through the ledger stays `shipped`; the refund date is
  // the only signal, and the sales collector relies on this ordering.
  assert.equal(storefrontStatusBucket('shipped', '2026-03-04T00:00:00Z'), 'refunded');
  assert.equal(storefrontStatusBucket('refunded'), 'refunded');
  assert.equal(storefrontStatusBucket('partially_refunded'), 'refunded');
  assert.equal(storefrontStatusBucket('shipped', null), 'paid');
});

test('money still in flight is pending, a lapsed window is expired', () => {
  assert.equal(storefrontStatusBucket('pending'), 'pending');
  assert.equal(storefrontStatusBucket('received'), 'pending');
  assert.equal(storefrontStatusBucket('expired'), 'expired');
  assert.equal(puramassStatusBucket('payment_pending'), 'pending');
  assert.equal(puramassStatusBucket('expired'), 'expired');
});

test('both cancellation spellings land in the same bucket', () => {
  assert.equal(storefrontStatusBucket('cancelled'), 'cancelled');
  assert.equal(storefrontStatusBucket('canceled'), 'cancelled');
  assert.equal(puramassStatusBucket('cancelled'), 'cancelled');
  assert.equal(puramassStatusBucket('canceled'), 'cancelled');
});

test('a hosted-checkout refund stays under paid, so no order is counted twice', () => {
  // Stealth Health refunds are partial credits on an order that DID pay. If this ever
  // returned 'refunded', the stack would lose that order from `paid` while the
  // revenue figures still counted it.
  for (const status of PURAMASS_STATUSES) {
    assert.notEqual(puramassStatusBucket(status), 'refunded', status);
  }
  assert.equal(puramassStatusBucket('paid'), 'paid');
});

test('status matching is case-insensitive', () => {
  assert.equal(storefrontStatusBucket('SHIPPED'), 'paid');
  assert.equal(storefrontStatusBucket('Expired'), 'expired');
  assert.equal(puramassStatusBucket('PAYMENT_PENDING'), 'pending');
});

test('the recoverable buckets are the two with a buyer still to win', () => {
  assert.deepEqual([...RECOVERABLE_STATUS_BUCKETS], ['pending', 'expired']);
  for (const bucket of RECOVERABLE_STATUS_BUCKETS) {
    assert.ok(ORDER_STATUS_BUCKETS.includes(bucket), bucket);
  }
});

test('classifying a set of orders totals to the orders placed', () => {
  const orders = [
    ...STOREFRONT_STATUSES,
    ...STOREFRONT_STATUSES,
    'pending', 'pending', 'expired', 'who_knows',
  ];
  const counts = Object.fromEntries(ORDER_STATUS_BUCKETS.map((b) => [b, 0]));
  for (const status of orders) counts[storefrontStatusBucket(status)] += 1;
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  assert.equal(total, orders.length);
});
