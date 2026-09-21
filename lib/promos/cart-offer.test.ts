/**
 * Unit tests for the limited-time cart offer.
 *
 * The cart draws the offer from these functions and `/api/checkout/puramass`
 * decides the money with the same ones, so what is pinned here is mostly the
 * boundaries where the two could disagree: a zero percentage, an expiry that
 * has just passed, and the composition of two stacked discounts.
 *
 * The repo has no test runner wired up, so these use Node's built-in
 * `node:test` + `node:assert` (zero dependencies). Run with a TS-aware
 * loader, e.g.
 *   node --test --experimental-strip-types lib/promos/cart-offer.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cartOfferAmount,
  cartOfferExpired,
  clampMinItems,
  combineDiscountPercents,
  DEFAULT_CART_OFFER,
  itemsToUnlockCartOffer,
  MAX_DISCOUNT_PERCENT,
  qualifiesForCartOffer,
  shapeCartOfferSettings,
} from './cart-offer';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-09-21T12:00:00.000Z');

test('an unmigrated / unreadable settings row discounts nothing', () => {
  assert.equal(DEFAULT_CART_OFFER.enabled, false);
  assert.equal(shapeCartOfferSettings(null).enabled, false);
  assert.equal(shapeCartOfferSettings({}).enabled, false);
  assert.equal(qualifiesForCartOffer(shapeCartOfferSettings(null), 99, NOW), false);
});

test('a zero percentage forces the offer off however it is switched', () => {
  const settings = shapeCartOfferSettings({
    cart_offer_enabled: true,
    cart_offer_percent: 0,
  });
  assert.equal(settings.enabled, false);
  assert.equal(qualifiesForCartOffer(settings, 10, NOW), false);
});

test('the percentage is capped where a zero line price would start', () => {
  const settings = shapeCartOfferSettings({
    cart_offer_enabled: true,
    cart_offer_percent: 100,
  });
  assert.equal(settings.percent, MAX_DISCOUNT_PERCENT);
});

test('the minimum is a whole number of items, at least one', () => {
  assert.equal(clampMinItems(0), 1);
  assert.equal(clampMinItems(-4), 1);
  assert.equal(clampMinItems(2.7), 2);
  assert.equal(clampMinItems('3'), 3);
  assert.equal(clampMinItems(undefined), 1);
});

test('the offer unlocks at the minimum, not one item later', () => {
  const settings = shapeCartOfferSettings({
    cart_offer_enabled: true,
    cart_offer_percent: 10,
    cart_offer_min_items: 2,
  });
  assert.equal(qualifiesForCartOffer(settings, 1, NOW), false);
  assert.equal(qualifiesForCartOffer(settings, 2, NOW), true);
  assert.equal(qualifiesForCartOffer(settings, 5, NOW), true);

  assert.equal(itemsToUnlockCartOffer(settings, 0, NOW), 2);
  assert.equal(itemsToUnlockCartOffer(settings, 1, NOW), 1);
  assert.equal(itemsToUnlockCartOffer(settings, 2, NOW), 0);
});

test('an offer with no end date never expires and shows no clock', () => {
  const settings = shapeCartOfferSettings({
    cart_offer_enabled: true,
    cart_offer_percent: 10,
  });
  assert.equal(settings.endsAt, null);
  assert.equal(cartOfferExpired(settings, NOW), false);
  assert.equal(cartOfferExpired(settings, NOW + 5000 * HOUR), false);
});

test('an end date that has passed stops the discount, not just the clock', () => {
  const settings = shapeCartOfferSettings({
    cart_offer_enabled: true,
    cart_offer_percent: 10,
    cart_offer_min_items: 1,
    cart_offer_ends_at: new Date(NOW + HOUR).toISOString(),
  });
  assert.equal(qualifiesForCartOffer(settings, 3, NOW), true);
  assert.equal(qualifiesForCartOffer(settings, 3, NOW + 2 * HOUR), false);
  assert.equal(itemsToUnlockCartOffer(settings, 0, NOW + 2 * HOUR), 0);
});

test('an unparseable end date is treated as no end date, not as expired', () => {
  const settings = shapeCartOfferSettings({
    cart_offer_enabled: true,
    cart_offer_percent: 10,
    cart_offer_min_items: 1,
    cart_offer_ends_at: 'whenever',
  });
  assert.equal(settings.endsAt, null);
  assert.equal(qualifiesForCartOffer(settings, 1, NOW), true);
});

test('the advertised saving is a plain percentage of the subtotal', () => {
  assert.equal(cartOfferAmount(190, 10), 19);
  assert.equal(cartOfferAmount(199.99, 10), 20);
  assert.equal(cartOfferAmount(0, 10), 0);
  assert.equal(cartOfferAmount(190, 0), 0);
});

test('stacked discounts compose, so two promos can never reach 100%', () => {
  // 25% then 10%: the second applies to what is left of the first.
  assert.equal(combineDiscountPercents(25, 10), 32.5);
  assert.equal(combineDiscountPercents(10), 10);
  assert.equal(combineDiscountPercents(0, 0), 0);
  assert.equal(combineDiscountPercents(99, 99), MAX_DISCOUNT_PERCENT);
  // Additive would have been 100 here — and a free line is charged at list.
  assert.ok(combineDiscountPercents(50, 50) < 100);
  assert.equal(combineDiscountPercents(50, 50), 75);
});

test('a composed discount never exceeds what a single one may be', () => {
  for (const [a, b] of [[99, 50], [90, 90], [99, 99]] as const) {
    assert.ok(combineDiscountPercents(a, b) <= MAX_DISCOUNT_PERCENT);
  }
});
