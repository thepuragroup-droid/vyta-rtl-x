/**
 * Unit tests for the vial ⇄ case pricing rule.
 *
 * `products.price` is the pack price and equals `vial_price × vials_per_box`
 * — there is no pack discount, so the two columns have to convert straight
 * into each other in both directions.
 *
 * The repo has no test runner wired up, so these use Node's built-in
 * `node:test` + `node:assert` (zero dependencies). Run with a TS-aware
 * loader, e.g.
 *   node --test --experimental-strip-types lib/pricing.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  casePriceFor,
  casePriceFromVial,
  fallbackVialPrice,
  formatPackSizes,
  normalizePackSizes,
  packPriceFor,
  packSizesFor,
  packsInStock,
  parsePackSizesInput,
  samePackSizes,
  vialPriceFor,
  vialsPerBoxOf,
} from './pricing.ts';

test('case price is vial × N, with no pack discount', () => {
  assert.equal(casePriceFromVial(100, 10), 1000);
  assert.equal(casePriceFromVial(80, 10), 800);
  assert.equal(casePriceFromVial(12.5, 10), 125);
  assert.equal(casePriceFromVial(599, 10), 5990);
  // Non-standard box sizes honour vials_per_box.
  assert.equal(casePriceFromVial(50, 5), 250);
});

test('fallbackVialPrice inverts the pack rule', () => {
  assert.equal(fallbackVialPrice(1000, 10), 100);
  assert.equal(fallbackVialPrice(125, 10), 12.5);
  assert.equal(fallbackVialPrice(0, 10), 0);
});

test('a derived vial price round-trips back to the catalog price', () => {
  for (const price of [100, 125, 500, 800, 1000, 1400, 2950, 4800, 5990]) {
    const vial = fallbackVialPrice(price, 10);
    assert.equal(
      casePriceFromVial(vial, 10),
      price,
      `pack price drifted for a $${price} case`,
    );
  }
});

test('an explicit vial_price wins over the derived one', () => {
  assert.equal(vialPriceFor({ price: 1000, vial_price: 100, vials_per_box: 10 }), 100);
  assert.equal(casePriceFor({ price: 1000, vial_price: 100, vials_per_box: 10 }), 1000);
  // A vial override that disagrees with the stored pack price still drives
  // the pack figure the site quotes.
  assert.equal(casePriceFor({ price: 225, vial_price: 112.5, vials_per_box: 10 }), 1125);
});

test('vial_price 0 on a priced product falls back instead of quoting $0', () => {
  // Real catalog rows (Semx + Selnk, Oxytocin 10mg) carry vial_price = 0.
  assert.equal(vialPriceFor({ price: 1250, vial_price: 0, vials_per_box: 10 }), 125);
  assert.equal(casePriceFor({ price: 1250, vial_price: 0, vials_per_box: 10 }), 1250);
  assert.equal(vialPriceFor({ price: 1400, vial_price: 0, vials_per_box: 10 }), 140);
});

test('a genuinely unpriced product stays at 0', () => {
  assert.equal(vialPriceFor({ price: 0, vial_price: 0, vials_per_box: 10 }), 0);
  assert.equal(casePriceFor({ price: 0, vial_price: null, vials_per_box: 10 }), 0);
});

test('a null / absent vials_per_box means the standard 10', () => {
  assert.equal(vialsPerBoxOf(null), 10);
  assert.equal(vialsPerBoxOf(0), 10);
  assert.equal(vialsPerBoxOf(undefined), 10);
  assert.equal(vialsPerBoxOf(5), 5);
  assert.equal(vialPriceFor({ price: 1000, vial_price: null }), 100);
});

// ---------------------------------------------------------------------------
// Pack options
// ---------------------------------------------------------------------------

test('normalizePackSizes cleans, dedupes and sorts', () => {
  assert.deepEqual(normalizePackSizes([10, 1, 3, 3, 5]), [1, 3, 5, 10]);
  assert.deepEqual(normalizePackSizes(['3', 1, 2.7]), [1, 2, 3]);
  assert.deepEqual(normalizePackSizes([0, -4, NaN, null]), []);
  assert.deepEqual(normalizePackSizes(null), []);
  assert.deepEqual(normalizePackSizes('1,3'), []);
});

test('packSizesFor falls back to the legacy single-vial + full-case pair', () => {
  assert.deepEqual(packSizesFor({ price: 1000, vials_per_box: 10 }), [1, 10]);
  assert.deepEqual(packSizesFor({ price: 1000, vials_per_box: 10, pack_sizes: null }), [1, 10]);
  assert.deepEqual(packSizesFor({ price: 1000, vials_per_box: 10, pack_sizes: [] }), [1, 10]);
  // A one-vial "case" collapses to a single option rather than [1, 1].
  assert.deepEqual(packSizesFor({ price: 100, vials_per_box: 1 }), [1]);
  // An explicit list always wins.
  assert.deepEqual(
    packSizesFor({ price: 1000, vials_per_box: 10, pack_sizes: [5, 1, 3, 10] }),
    [1, 3, 5, 10],
  );
});

test('a pack costs the vial price × its size, with no pack discount', () => {
  const product = { price: 1000, vial_price: 100, vials_per_box: 10, pack_sizes: [1, 3, 5, 10] };
  assert.equal(packPriceFor(product, 1), 100);
  assert.equal(packPriceFor(product, 3), 300);
  assert.equal(packPriceFor(product, 5), 500);
  // A full case priced through the pack rule lands back on products.price.
  assert.equal(packPriceFor(product, 10), casePriceFor(product));
  assert.equal(packPriceFor(product, 10), 1000);
});

test('pack prices derive from the case price when there is no vial override', () => {
  const product = { price: 125, vial_price: null, vials_per_box: 10, pack_sizes: [1, 3] };
  assert.equal(packPriceFor(product, 1), 12.5);
  assert.equal(packPriceFor(product, 3), 37.5);
});

test('packsInStock counts whole packs only', () => {
  assert.equal(packsInStock(10, 3), 3);
  assert.equal(packsInStock(2, 3), 0);
  assert.equal(packsInStock(30, 10), 3);
  assert.equal(packsInStock(-5, 1), 0);
});

test('parsePackSizesInput accepts the shapes a spreadsheet paste produces', () => {
  assert.deepEqual(parsePackSizesInput('1, 3, 5, 10'), [1, 3, 5, 10]);
  assert.deepEqual(parsePackSizesInput('1/3/5/10'), [1, 3, 5, 10]);
  assert.deepEqual(parsePackSizesInput('10 5 3 1'), [1, 3, 5, 10]);
  assert.deepEqual(parsePackSizesInput('1|10'), [1, 10]);
  // An empty cell means "back to the default", not "no packs at all".
  assert.deepEqual(parsePackSizesInput(''), []);
  assert.deepEqual(parsePackSizesInput('   '), []);
});

test('formatPackSizes round-trips through parsePackSizesInput', () => {
  for (const sizes of [[1], [1, 10], [1, 3, 5, 10], [2, 4]]) {
    assert.deepEqual(parsePackSizesInput(formatPackSizes(sizes)), sizes);
  }
});

test('samePackSizes treats null and empty as the same "not opted in"', () => {
  assert.ok(samePackSizes(null, []));
  assert.ok(samePackSizes([1, 3], [3, 1]));
  assert.ok(!samePackSizes([1, 3], [1, 3, 5]));
  assert.ok(!samePackSizes(null, [1, 10]));
});
