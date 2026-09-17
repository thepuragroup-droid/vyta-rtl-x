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

// ---------------------------------------------------------------------------
// Pack options
// ---------------------------------------------------------------------------

/**
 * Pack options — how many vials a customer may buy in one go.
 *
 * `products.pack_sizes` holds the quantities a product is offered in, e.g.
 * `{1,3,5,10}`. It is an OPT-IN column: when it is NULL (or empty) the product
 * falls back to the historical pair — a single vial, plus one full case of
 * `vials_per_box` — so a catalog that never touches the column behaves exactly
 * as it did before pack options existed.
 *
 * Pricing stays derived and discount-free, the same rule as cases:
 *
 *     pack price = vial price × pack size
 *
 * so there is no per-pack price column to keep in sync and a price change on a
 * product reprices every one of its packs at once.
 */

/** The quantities the admin UI offers as one-click toggles. */
export const PACK_SIZE_OPTIONS = [1, 3, 5, 10] as const;

/** Upper bound on how many distinct packs one product may offer. */
export const MAX_PACK_OPTIONS = 8;

/**
 * Clean a raw list into a valid set of pack sizes: positive whole numbers,
 * de-duplicated, ascending, capped at MAX_PACK_OPTIONS. Returns [] for
 * anything unusable — callers treat [] and NULL identically.
 */
export function normalizePackSizes(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  for (const entry of raw) {
    const n = Math.floor(Number(entry));
    if (!Number.isFinite(n) || n < 1 || n > 1000) continue;
    seen.add(n);
  }
  return [...seen].sort((a, b) => a - b).slice(0, MAX_PACK_OPTIONS);
}

/** Product shape the pack rules need — a superset of VialPricedProduct. */
export type PackOptionProduct = VialPricedProduct & {
  pack_sizes?: number[] | null;
};

/** Has an admin explicitly chosen this product's pack options? */
export function hasCustomPackSizes(product: PackOptionProduct): boolean {
  return normalizePackSizes(product.pack_sizes).length > 0;
}

/**
 * The pack quantities this product is sold in, ascending.
 *
 * Explicit `pack_sizes` win. Otherwise the legacy pair: a single vial and one
 * full case (deduplicated, so a 1-vial "case" yields just `[1]`).
 */
export function packSizesFor(product: PackOptionProduct): number[] {
  const explicit = normalizePackSizes(product.pack_sizes);
  if (explicit.length > 0) return explicit;
  const per = vialsPerBoxOf(product.vials_per_box);
  return per > 1 ? [1, per] : [1];
}

/** Price of one pack of `size` vials: the vial price × size. */
export function packPriceFor(product: PackOptionProduct, size: number): number {
  const n = Math.max(1, Math.floor(Number(size) || 1));
  return round2(vialPriceFor(product) * n);
}

/** How many whole packs of `size` the on-hand vial stock covers. */
export function packsInStock(stockVials: number, size: number): number {
  const n = Math.max(1, Math.floor(Number(size) || 1));
  return Math.floor(Math.max(0, Number(stockVials) || 0) / n);
}

/** Customer-facing label for a pack option. */
export function packLabel(size: number): string {
  const n = Math.max(1, Math.floor(Number(size) || 1));
  return n === 1 ? 'Single vial' : `Pack of ${n}`;
}

/** Short form for tight spots (cart lines, order emails, admin tables). */
export function packShortLabel(size: number): string {
  const n = Math.max(1, Math.floor(Number(size) || 1));
  return n === 1 ? '1 vial' : `${n}-pack`;
}

/** "1, 3, 5, 10" — the cell-edit grid's text form of the column. */
export function formatPackSizes(sizes: number[]): string {
  return normalizePackSizes(sizes).join(', ');
}

/**
 * Parse the grid / bulk-editor text form. Accepts commas, spaces, slashes and
 * pipes, so pasting `1/3/5/10` or `1 3 5 10` from a spreadsheet works.
 *
 * Returns [] for an empty string — which is how an editor says "back to the
 * default (single vial + full case)".
 */
export function parsePackSizesInput(raw: string): number[] {
  const text = (raw ?? '').trim();
  if (text === '') return [];
  return normalizePackSizes(text.split(/[\s,/|]+/).filter(Boolean).map((part) => Number(part)));
}

/** Do two pack-size lists mean the same thing? (NULL and [] are equal.) */
export function samePackSizes(a: unknown, b: unknown): boolean {
  const na = normalizePackSizes(a);
  const nb = normalizePackSizes(b);
  return na.length === nb.length && na.every((v, i) => v === nb[i]);
}

/**
 * The biggest multi-vial pack a product is sold in, with its price — what the
 * catalog cards quote under the per-vial headline ("Pack of 10 · $1000.00").
 *
 * Null when the product is only sold as single vials, so a card can drop the
 * line entirely rather than printing a pack that cannot be bought.
 */
export function largestPackFor(
  product: PackOptionProduct,
): { size: number; price: number } | null {
  const sizes = packSizesFor(product).filter((size) => size > 1);
  if (sizes.length === 0) return null;
  const size = sizes[sizes.length - 1];
  return { size, price: packPriceFor(product, size) };
}
