/**
 * The limited-time cart offer.
 *
 * "Add one more item and get 10% off your order" — the strip at the top of the
 * cart's order summary. Unlike the paid-ads welcome discount it is open to
 * everyone: what earns it is the CART, not the buyer. Three settings decide it,
 * all on the singleton `site_settings` row:
 *
 *   • `cart_offer_enabled`   — the operator's on/off switch;
 *   • `cart_offer_min_items` — how many cart units unlock it;
 *   • `cart_offer_percent`   — what comes off the goods subtotal;
 *   • `cart_offer_ends_at`   — optional, when it really stops (see below).
 *
 * Like every other promo here, everything in this file is pure and isomorphic:
 * the cart imports it to draw the offer and `/api/checkout/puramass` imports
 * the same functions to decide the money, so the two cannot drift into
 * disagreeing about who qualifies or for how much.
 *
 * ## The countdown is real
 *
 * The cart shows a clock next to the offer. That clock counts down to
 * `cart_offer_ends_at`, and the SAME timestamp is checked server-side at
 * hand-off — so when it hits zero the discount genuinely stops, rather than
 * resetting itself the moment the page is reloaded. An offer with no end date
 * shows no clock at all: a countdown that expires into nothing would be a lie
 * told to hurry someone along.
 *
 * ## Counting items
 *
 * The minimum counts cart UNITS — a line of "3 × pack of 5" is 3, not 15.
 * That is what the buyer sees in the cart and what "add one more item" asks
 * them to do, so it is what the threshold is measured in.
 *
 * ## Stacking
 *
 * This offer and the paid-ads welcome discount can both land on one order. The
 * two percentages are composed multiplicatively (25% then 10% off = 32.5%, not
 * 35%) rather than added, so stacking can never reach or exceed 100% and the
 * buyer is never charged a negative line. See `combineDiscountPercents`.
 */
import { clampDiscountPercent } from '@/lib/promos/ad-discount';

/** The default offer for a store that has not configured one. */
export const DEFAULT_CART_OFFER_PERCENT = 10;
export const DEFAULT_CART_OFFER_MIN_ITEMS = 2;

/**
 * The most a discount may ever be, in percent.
 *
 * 99 rather than 100 because the discount travels to the hosted checkout as
 * per-line `unit_price_cents`, and PuraMass reads a zero there as "no price
 * given" — giving the goods away would charge full list instead. See
 * lib/promos/ad-discount.ts.
 */
export const MAX_DISCOUNT_PERCENT = 99;

export interface CartOfferSettings {
  /** The promo is switched on and worth something. */
  enabled: boolean;
  /** Cart units needed to unlock it. Always >= 1. */
  minItems: number;
  /** Percentage off the goods subtotal, 0–99. */
  percent: number;
  /**
   * ISO timestamp the offer stops at, or null when it runs until switched off.
   * A string rather than a Date so the same value survives the wire unchanged.
   */
  endsAt: string | null;
}

/**
 * Off. Used when the promo columns have not been migrated yet, or the settings
 * read failed — money fails closed, so an unconfigured install discounts
 * nothing rather than everything.
 */
export const DEFAULT_CART_OFFER: CartOfferSettings = {
  enabled: false,
  minItems: DEFAULT_CART_OFFER_MIN_ITEMS,
  percent: DEFAULT_CART_OFFER_PERCENT,
  endsAt: null,
};

/** Clamp a stored/typed minimum into a whole number of items, at least 1. */
export function clampMinItems(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(99, n);
}

/** A stored timestamp, or null when absent/unparseable. */
function normaliseEndsAt(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  const time = date.getTime();
  return Number.isFinite(time) ? date.toISOString() : null;
}

/**
 * Normalise a raw `site_settings` row.
 *
 * A zero percentage forces the promo off, exactly as it does for the welcome
 * discount: "10% off" with nothing behind it would advertise an offer the
 * checkout then fails to honour.
 */
export function shapeCartOfferSettings(
  data: Record<string, any> | null | undefined,
): CartOfferSettings {
  const d = data ?? {};
  const percent = Math.min(
    MAX_DISCOUNT_PERCENT,
    clampDiscountPercent(d.cart_offer_percent ?? DEFAULT_CART_OFFER_PERCENT),
  );
  return {
    enabled: !!d.cart_offer_enabled && percent > 0,
    minItems: clampMinItems(d.cart_offer_min_items ?? DEFAULT_CART_OFFER_MIN_ITEMS),
    percent,
    endsAt: normaliseEndsAt(d.cart_offer_ends_at),
  };
}

/** Has the offer's end date passed? An offer with no end date never expires. */
export function cartOfferExpired(
  settings: CartOfferSettings,
  now: number = Date.now(),
): boolean {
  if (!settings.endsAt) return false;
  const end = new Date(settings.endsAt).getTime();
  if (!Number.isFinite(end)) return false;
  return end <= now;
}

/**
 * Does this cart earn the offer?
 *
 * Switched on, worth something, not expired, and carrying enough items. The
 * storefront asks this to decide whether to show the discount as applied, and
 * `/api/checkout/puramass` asks it again — from the settings row it reads
 * itself and an item count derived from the catalog — to decide the money.
 */
export function qualifiesForCartOffer(
  settings: CartOfferSettings,
  itemCount: number,
  now: number = Date.now(),
): boolean {
  if (!settings.enabled || settings.percent <= 0) return false;
  if (cartOfferExpired(settings, now)) return false;
  return Math.floor(Number(itemCount) || 0) >= settings.minItems;
}

/**
 * How many more items unlock the offer — what the cart's strip counts down.
 *
 * Zero once it is earned (or when the offer is not running at all, so callers
 * can render "add N more" on a positive number alone).
 */
export function itemsToUnlockCartOffer(
  settings: CartOfferSettings,
  itemCount: number,
  now: number = Date.now(),
): number {
  if (!settings.enabled || settings.percent <= 0) return 0;
  if (cartOfferExpired(settings, now)) return 0;
  const have = Math.floor(Number(itemCount) || 0);
  return Math.max(0, settings.minItems - have);
}

/**
 * What the offer takes off a subtotal, in CAD — what the storefront shows.
 *
 * As with the welcome discount, the figure actually charged is computed from
 * the line payload by `distributeAdDiscount` and can be a cent or two larger;
 * it is never smaller, so no buyer is charged more than the number they saw.
 */
export function cartOfferAmount(subtotal: number, percent: number): number {
  const pct = clampDiscountPercent(percent);
  const amount = Number(subtotal);
  if (pct <= 0 || !Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * pct) / 100;
}

/**
 * Compose two discount percentages into the single one that gets applied.
 *
 * Multiplicative, not additive: 25% off and then 10% off is 32.5% off, because
 * the second percentage applies to what is left after the first. Adding them
 * would let two generous promos reach 100% — a zero line price, which the
 * hosted checkout reads as "use your own price" and charges at full list.
 *
 * The result is capped at MAX_DISCOUNT_PERCENT for the same reason, and
 * rounded to two decimals so it survives the same clamp everything else uses.
 */
export function combineDiscountPercents(...percents: number[]): number {
  const remaining = percents.reduce((factor, percent) => {
    const pct = clampDiscountPercent(percent);
    return factor * (1 - pct / 100);
  }, 1);
  const combined = Math.round((1 - remaining) * 10000) / 100;
  return Math.min(MAX_DISCOUNT_PERCENT, Math.max(0, combined));
}
