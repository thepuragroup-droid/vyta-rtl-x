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
  packOptionFor,
  packOptionsFor,
  packPriceFor,
  packSizesFor,
  normalizePackOptions,
  reconcilePackOptions,
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

// ---------------------------------------------------------------------------
// Per-pack pricing (`products.pack_options`)
// ---------------------------------------------------------------------------

const PRICED = { price: 1000, vial_price: 100, vials_per_box: 10 };

test('normalizePackOptions drops junk and keeps one row per size', () => {
  assert.deepEqual(
    normalizePackOptions([
      { size: 3, label: ' 3-pack ', price: '249', compare_at: 300 },
      { size: 0, price: 10 },          // size below 1
      { size: 'x' },                   // unparseable
      { size: 3, price: 199 },         // later duplicate wins
      { size: 1, price: -5 },          // negative money is "not set"
    ]),
    [
      { size: 1, label: null, price: null, compare_at: null, badge: null, enabled: true },
      { size: 3, label: null, price: 199, compare_at: null, badge: null, enabled: true },
    ],
  );
  assert.deepEqual(normalizePackOptions(null), []);
  assert.deepEqual(normalizePackOptions('1,3'), []);
  // A bare list of sizes is accepted, which is what makes the older
  // pack_sizes column readable through the same path.
  assert.deepEqual(
    normalizePackOptions([1, 10]).map((o) => o.size),
    [1, 10],
  );
});

test('a pack with no price set stays at vial price × size', () => {
  const product = {
    ...PRICED,
    pack_options: [{ size: 1 }, { size: 3 }, { size: 10 }],
  };
  assert.equal(packPriceFor(product, 3), 300);
  assert.equal(packPriceFor(product, 10), 1000);
  // ...and nothing is struck through, because nothing was discounted.
  assert.equal(packOptionFor(product, 3)?.compareAt, null);
  assert.equal(packOptionFor(product, 3)?.savings, 0);
});

test('an admin-set pack price wins over the derived one', () => {
  const product = {
    ...PRICED,
    pack_options: [
      { size: 1, price: null },
      { size: 3, price: 249 },
      { size: 10, price: 749 },
    ],
  };
  assert.equal(packPriceFor(product, 1), 100);
  assert.equal(packPriceFor(product, 3), 249);
  assert.equal(packPriceFor(product, 10), 749);
});

test('a discounted pack gets its compare-at and saving for free', () => {
  const option = packOptionFor(
    { ...PRICED, pack_options: [{ size: 10, price: 750 }] },
    10,
  );
  // Undiscounted would be 100 × 10 = 1000, so that becomes the "was" price.
  assert.equal(option?.price, 750);
  assert.equal(option?.compareAt, 1000);
  assert.equal(option?.savings, 250);
  assert.equal(option?.savingsPercent, 25);
  assert.equal(option?.perVialPrice, 75);
});

test('an explicit compare-at wins, and a useless one is dropped', () => {
  const explicit = packOptionFor(
    { ...PRICED, pack_options: [{ size: 3, price: 250, compare_at: 400 }] },
    3,
  );
  assert.equal(explicit?.compareAt, 400);
  assert.equal(explicit?.savings, 150);

  // A compare-at at or below the price is not a saving — never render it.
  const useless = packOptionFor(
    { ...PRICED, pack_options: [{ size: 3, price: 300, compare_at: 250 }] },
    3,
  );
  assert.equal(useless?.compareAt, null);
  assert.equal(useless?.savings, 0);
});

test('labels fall back to the derived wording, and an operator label wins', () => {
  const options = packOptionsFor({
    ...PRICED,
    pack_options: [{ size: 1 }, { size: 10, label: 'Best value' }],
  });
  assert.deepEqual(options.map((o) => o.label), ['Single vial', 'Best value']);
});

test('pack_options decides which packs are offered, minus unticked rows', () => {
  const product = {
    ...PRICED,
    // The older column disagrees on purpose: pack_options has to win.
    pack_sizes: [1, 10],
    pack_options: [{ size: 1 }, { size: 3 }, { size: 5, enabled: false }],
  };
  assert.deepEqual(packSizesFor(product), [1, 3]);
  assert.deepEqual(packOptionsFor(product).map((o) => o.size), [1, 3]);
});

test('a pack tag is trimmed, capped and carried through to the storefront', () => {
  const product = {
    ...PRICED,
    pack_options: [
      { size: 1 },
      { size: 3, badge: '  Most Popular  ' },
      { size: 10, badge: '   ' }, // whitespace only is "no tag"
      { size: 5, badge: 'x'.repeat(80) },
    ],
  };
  assert.deepEqual(
    packOptionsFor(product).map((o) => o.badge),
    [null, 'Most Popular', 'x'.repeat(24), null],
  );
  // A tag never invents a pack, and a non-string one is ignored.
  assert.equal(normalizePackOptions([{ size: 1, badge: 7 }])[0].badge, null);
});

test('a product with neither column keeps the legacy single-vial + case pair', () => {
  const options = packOptionsFor(PRICED);
  assert.deepEqual(options.map((o) => o.size), [1, 10]);
  assert.deepEqual(options.map((o) => o.price), [100, 1000]);
  assert.deepEqual(options.map((o) => o.compareAt), [null, null]);
});

test('a sizes-only edit keeps the prices of the packs that survive', () => {
  const stored = [
    { size: 1, price: null },
    { size: 3, price: 249, label: 'Starter' },
    { size: 10, price: 749 },
  ];
  // 3 stays (with its price and label), 10 goes, 5 arrives blank.
  assert.deepEqual(reconcilePackOptions(stored, [1, 3, 5]), [
    { size: 1, label: null, price: null, compare_at: null, badge: null, enabled: true },
    { size: 3, label: 'Starter', price: 249, compare_at: null, badge: null, enabled: true },
    { size: 5, label: null, price: null, compare_at: null, badge: null, enabled: true },
  ]);
});

test('a product with no per-pack pricing stays on the sizes-only column', () => {
  assert.equal(reconcilePackOptions(null, [1, 3, 5]), null);
  assert.equal(reconcilePackOptions([], [1, 3, 5]), null);
  // Clearing the sizes clears the pricing with them.
  assert.equal(reconcilePackOptions([{ size: 3, price: 249 }], []), null);
});
