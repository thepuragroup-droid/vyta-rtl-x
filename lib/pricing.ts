/**
 * Product-side pricing helpers.
 *
 * CAD is the base price on every product row. USD is an optional override
 * (`products.price_usd`); when absent we compute it live from
 * `site_settings.usd_exchange_rate` so a single rate change reprices every
 * catalog SKU at once.
 */
import type { Product } from '@/lib/supabase';

/** Fallback FX rate when site_settings isn't loaded / missing the column. */
export const DEFAULT_USD_RATE = 0.73;

export type PriceCurrency = 'CAD' | 'USD';

export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Convert a CAD amount to USD at the given rate. */
export function usdFromCad(cad: number | null | undefined, rate: number): number {
  const n = Number(cad) || 0;
  const r = Number(rate) || DEFAULT_USD_RATE;
  return round2(n * r);
}

/**
 * Effective USD price for a product. Honors an explicit `price_usd`
 * override when present (unless the caller flagged `has_override` — used by
 * customer-price-override lookups where the CAD side already reflects the
 * override and shouldn't be layered twice), otherwise computes from CAD.
 */
export function productUsdPrice(
  product: Pick<Product, 'price' | 'price_usd'> & { has_override?: boolean },
  rate: number = DEFAULT_USD_RATE,
): number {
  if (!product.has_override && product.price_usd != null && Number(product.price_usd) >= 0) {
    return round2(Number(product.price_usd));
  }
  return usdFromCad(Number(product.price), rate);
}

/**
 * Return the amount denominated in the requested currency. `USD` returns
 * the same math as `productUsdPrice` when a product is passed; `CAD`
 * returns the CAD amount unchanged.
 */
export function inCurrency(
  amount: number,
  from: PriceCurrency,
  to: PriceCurrency,
  rate: number,
): number {
  if (from === to) return round2(amount);
  if (from === 'CAD' && to === 'USD') return usdFromCad(amount, rate);
  // USD -> CAD: divide by rate (guard against 0).
  const r = Number(rate) || DEFAULT_USD_RATE;
  return round2(amount / r);
}

/**
 * Currency-aware formatter used across the admin. Uses narrow symbol so
 * both CAD and USD render as `$` on-screen — the explicit currency code is
 * shown as a small badge next to the total in the UI.
 */
export function formatMoney(n: number, currency: PriceCurrency = 'CAD'): string {
  const code = currency === 'USD' ? 'USD' : 'CAD';
  return new Intl.NumberFormat(code === 'USD' ? 'en-US' : 'en-CA', {
    style: 'currency',
    currency: code,
    currencyDisplay: 'narrowSymbol',
  }).format(Number.isFinite(n) ? n : 0);
}

/**
 * Storefront case (pack) pricing rule: a pack of N vials sells for the
 * single-vial price × N. There is no pack discount — `products.price` IS
 * `vial_price × vials_per_box`, so the two columns convert straight into
 * each other in both directions.
 */

/** Vials in one case. Anything missing/invalid falls back to the standard 10. */
export function vialsPerBoxOf(vialsPerBox: number | null | undefined): number {
  return Number(vialsPerBox) > 0 ? Number(vialsPerBox) : 10;
}

/** Case (pack) price: the single-vial price × every vial in the box. */
export function casePriceFromVial(vialPrice: number, vialsPerBox: number = 10): number {
  return round2((Number(vialPrice) || 0) * vialsPerBoxOf(vialsPerBox));
}

/**
 * Fallback vial price when a product doesn't store an explicit one — the
 * inverse of `casePriceFromVial`, so a derived vial price fed back through
 * the pack rule lands on `products.price` again.
 */
export function fallbackVialPrice(boxPrice: number, vialsPerBox: number = 10): number {
  return round2((Number(boxPrice) || 0) / vialsPerBoxOf(vialsPerBox));
}

/** Product shape the vial/case rules need. */
export type VialPricedProduct = {
  price: number | null | undefined;
  vial_price?: number | null;
  vials_per_box?: number | null;
};

/**
 * The single-vial price the whole site quotes: the explicit `vial_price`
 * override when one is set, otherwise derived from the pack price.
 *
 * A stored `0` counts as "not set" whenever the product has a pack price —
 * a handful of catalog rows carry `vial_price = 0` alongside a real price,
 * and taking that literally quotes those products at $0.00 per vial and
 * $0.00 per pack. A genuinely free product (price 0) still resolves to 0.
 */
export function vialPriceFor(product: VialPricedProduct): number {
  const boxPrice = Number(product.price) || 0;
  const explicit = product.vial_price;
  if (explicit != null && Number(explicit) > 0) return round2(Number(explicit));
  return fallbackVialPrice(boxPrice, vialsPerBoxOf(product.vials_per_box));
}

/** The pack price the site charges for one case of `product`. */
export function casePriceFor(product: VialPricedProduct): number {
  return casePriceFromVial(vialPriceFor(product), vialsPerBoxOf(product.vials_per_box));
}
