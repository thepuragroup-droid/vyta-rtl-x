/**
 * Unit tests for the "You may also like" ranking.
 *
 * The repo has no test runner wired up, so these use Node's built-in
 * `node:test` + `node:assert` (zero dependencies). Run with a TS-aware loader,
 * e.g. `node --test --import tsx lib/products/recommendations.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coPurchaseCounts,
  rankRecommendations,
  unitsSold,
  type PurchaseLine,
  type RecommendableProduct,
} from './recommendations';

function product(
  id: string,
  overrides: Partial<RecommendableProduct> = {},
): RecommendableProduct {
  return {
    id,
    name: id.toUpperCase(),
    category: 'Healing / Recovery',
    featured: false,
    stockQuantity: 50,
    ...overrides,
  };
}

const CATALOG = [
  product('ara290'),
  product('bpc'),
  product('tb500'),
  product('mots', { category: 'Weight Loss / Metabolic' }),
  product('nad', { category: 'Anti-Aging / Beauty' }),
];

const HISTORY: PurchaseLine[] = [
  // Three baskets pairing ARA290 with BPC-157, one of them also with TB500.
  { orderId: 'o1', productId: 'ara290', quantity: 1 },
  { orderId: 'o1', productId: 'bpc', quantity: 2 },
  { orderId: 'o2', productId: 'ara290', quantity: 1 },
  { orderId: 'o2', productId: 'bpc', quantity: 1 },
  { orderId: 'o3', productId: 'ara290', quantity: 1 },
  { orderId: 'o3', productId: 'bpc', quantity: 1 },
  { orderId: 'o3', productId: 'tb500', quantity: 1 },
  // A basket with nothing from the cart in it — must not move anything.
  { orderId: 'o4', productId: 'nad', quantity: 9 },
];

test('co-purchase counts baskets, not lines', () => {
  const counts = coPurchaseCounts(HISTORY, ['ara290']);
  // BPC appeared in three baskets with ARA290 — the 2-unit line is still one.
  assert.equal(counts.get('bpc'), 3);
  assert.equal(counts.get('tb500'), 1);
  // The cart's own product is never counted against itself.
  assert.equal(counts.has('ara290'), false);
  // A basket that never touched the cart contributes nothing.
  assert.equal(counts.has('nad'), false);
});

test('units sold totals every line, cart-related or not', () => {
  const sold = unitsSold(HISTORY);
  assert.equal(sold.get('bpc'), 4);
  assert.equal(sold.get('nad'), 9);
  // A missing quantity still counts as one purchase.
  assert.equal(unitsSold([{ orderId: 'o', productId: 'x' }]).get('x'), 1);
});

test('co-purchase outranks category, which outranks popularity', () => {
  const ranked = rankRecommendations({
    products: CATALOG,
    lines: HISTORY,
    cartProductIds: ['ara290'],
  });
  assert.deepEqual(
    ranked.map((r) => r.productId),
    // bpc (3 baskets) > tb500 (1 basket) > nad/mots on category+popularity.
    ['bpc', 'tb500', 'nad', 'mots'],
  );
  assert.equal(ranked[0].reason, 'bought-together');
  assert.equal(ranked[0].coPurchases, 3);
});

test('what is already in the cart is never suggested back', () => {
  const ranked = rankRecommendations({
    products: CATALOG,
    lines: HISTORY,
    cartProductIds: ['ara290', 'bpc'],
  });
  const ids = ranked.map((r) => r.productId);
  assert.equal(ids.includes('ara290'), false);
  assert.equal(ids.includes('bpc'), false);
});

test('the curated block\'s products are excluded so no card shows twice', () => {
  const ranked = rankRecommendations({
    products: CATALOG,
    lines: HISTORY,
    cartProductIds: ['ara290'],
    excludeProductIds: ['bpc', 'tb500'],
  });
  const ids = ranked.map((r) => r.productId);
  assert.deepEqual(ids, ['nad', 'mots']);
});

test('out-of-stock products are dropped, not merely ranked low', () => {
  const ranked = rankRecommendations({
    products: [...CATALOG.filter((p) => p.id !== 'bpc'), product('bpc', { stockQuantity: 0 })],
    lines: HISTORY,
    cartProductIds: ['ara290'],
  });
  assert.equal(
    ranked.some((r) => r.productId === 'bpc'),
    false,
  );
});

test('an empty purchase history still fills the block', () => {
  const ranked = rankRecommendations({
    products: CATALOG,
    lines: [],
    cartProductIds: ['ara290'],
  });
  assert.equal(ranked.length, 4);
  // Same category as the cart first, then the rest.
  assert.deepEqual(ranked.slice(0, 2).map((r) => r.productId), ['bpc', 'tb500']);
  assert.equal(ranked[0].reason, 'same-category');
});

test('featured breaks a tie between two otherwise equal products', () => {
  const ranked = rankRecommendations({
    products: [
      product('ara290'),
      product('plain', { category: 'Other' }),
      product('flagged', { category: 'Other', featured: true }),
    ],
    lines: [],
    cartProductIds: ['ara290'],
  });
  assert.deepEqual(ranked.map((r) => r.productId), ['flagged', 'plain']);
  assert.equal(ranked[0].reason, 'popular');
});

test('the ranking is stable and honours the limit', () => {
  const once = rankRecommendations({
    products: CATALOG,
    lines: HISTORY,
    cartProductIds: ['ara290'],
    limit: 2,
  });
  const twice = rankRecommendations({
    products: [...CATALOG].reverse(),
    lines: HISTORY,
    cartProductIds: ['ara290'],
    limit: 2,
  });
  assert.equal(once.length, 2);
  assert.deepEqual(once.map((r) => r.productId), twice.map((r) => r.productId));
});
