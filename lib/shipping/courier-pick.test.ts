/**
 * Unit tests for picking a courier when nobody chose one.
 *
 * Run with a TS-aware loader, e.g.
 * `node --test --import tsx lib/shipping/courier-pick.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickCourier, deliveryDays, type PickableRate } from '@/lib/shipping/courier-pick';

const rate = (
  courier_id: string,
  courier_name: string,
  total_charge: number,
  min: number,
  max: number,
): PickableRate => ({
  courier_id,
  courier_name,
  total_charge,
  min_delivery_time: min,
  max_delivery_time: max,
});

const quote = [
  rate('ups-ground', 'UPS', 12, 3, 5),
  rate('fedex-express', 'FedEx', 40, 1, 1),
  rate('ups-express', 'UPS', 35, 1, 1),
  rate('fedex-ground', 'FedEx', 14, 2, 6),
];

test('fastest picks the quickest service, cheaper on a tie', () => {
  assert.equal(pickCourier(quote, 'fastest')?.courier_id, 'ups-express');
});

test('fastest ranks on the worst-case estimate', () => {
  const r = [rate('a', 'UPS', 10, 1, 7), rate('b', 'FedEx', 20, 2, 2)];
  assert.equal(pickCourier(r, 'fastest')?.courier_id, 'b');
});

test('an unknown estimate sorts last for fastest', () => {
  const r = [rate('unknown', 'UPS', 5, 0, 0), rate('known', 'FedEx', 50, 4, 4)];
  assert.equal(pickCourier(r, 'fastest')?.courier_id, 'known');
  assert.equal(deliveryDays(r[0]), Number.POSITIVE_INFINITY);
});

test('cheapest and carrier preferences still pick on price', () => {
  assert.equal(pickCourier(quote, 'cheapest')?.courier_id, 'ups-ground');
  assert.equal(pickCourier(quote, 'fedex')?.courier_id, 'fedex-ground');
});

test('does not reorder the caller\'s array; empty yields null', () => {
  const copy = [...quote];
  pickCourier(quote, 'fastest');
  assert.deepEqual(quote, copy);
  assert.equal(pickCourier([], 'fastest'), null);
});
