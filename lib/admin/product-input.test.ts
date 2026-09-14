/**
 * Unit tests for the admin product numeric-field parsing — the rules that
 * decide whether a saved vial price lands in the DB, clears back to "auto",
 * or is rejected as a 400.
 *
 * The repo has no test runner wired up, so these use Node's built-in
 * `node:test` + `node:assert` (zero dependencies). Run with a TS-aware
 * loader, e.g.
 *   node --test --experimental-strip-types lib/admin/product-input.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePriceOverride, parseVialsPerBox } from './product-input';

test('parsePriceOverride accepts numbers and numeric strings', () => {
  assert.deepEqual(parsePriceOverride(42.5, 'Vial price'), { ok: true, value: 42.5 });
  assert.deepEqual(parsePriceOverride('42.5', 'Vial price'), { ok: true, value: 42.5 });
  assert.deepEqual(parsePriceOverride(' 42.5 ', 'Vial price'), { ok: true, value: 42.5 });
});

test('parsePriceOverride treats zero as a real price, not a cleared override', () => {
  assert.deepEqual(parsePriceOverride(0, 'Vial price'), { ok: true, value: 0 });
  assert.deepEqual(parsePriceOverride('0', 'Vial price'), { ok: true, value: 0 });
});

test('parsePriceOverride clears the override on null / empty string', () => {
  assert.deepEqual(parsePriceOverride(null, 'Vial price'), { ok: true, value: null });
  assert.deepEqual(parsePriceOverride('', 'Vial price'), { ok: true, value: null });
});

test('parsePriceOverride rejects negatives and non-numbers', () => {
  assert.equal(parsePriceOverride(-1, 'Vial price').ok, false);
  assert.equal(parsePriceOverride('abc', 'Vial price').ok, false);
  assert.equal(parsePriceOverride(undefined, 'Vial price').ok, false);
  const rejected = parsePriceOverride(-1, 'Vial price');
  assert.equal(rejected.ok === false && rejected.error, 'Vial price must be non-negative');
});

test('parseVialsPerBox defaults to 10 and floors to whole vials', () => {
  assert.deepEqual(parseVialsPerBox(null), { ok: true, value: 10 });
  assert.deepEqual(parseVialsPerBox(''), { ok: true, value: 10 });
  assert.deepEqual(parseVialsPerBox('12'), { ok: true, value: 12 });
  assert.deepEqual(parseVialsPerBox(12.9), { ok: true, value: 12 });
});

test('parseVialsPerBox rejects values the DB CHECK would reject', () => {
  assert.equal(parseVialsPerBox(0).ok, false);
  assert.equal(parseVialsPerBox(-5).ok, false);
  assert.equal(parseVialsPerBox('many').ok, false);
});
