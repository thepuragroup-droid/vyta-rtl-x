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
 * Pack options — how many vials a customer may buy in one go, at what price.
 *
 * Two columns, read in this order:
 *
 *   `products.pack_options` (jsonb) — the full description of each pack the
 *     product is sold in: its size, an optional storefront LABEL, an optional
 *     fixed PRICE and an optional COMPARE-AT price. This is what an operator
 *     edits when a 10-pack should be cheaper per vial than a single one.
 *
 *   `products.pack_sizes` (integer[]) — the older, quantities-only column.
 *     Still honoured, and still what the bulk editor and the cell grid write,
 *     so a product opted in before per-pack pricing existed keeps working.
 *
 * When neither is set the product falls back to the historical pair — a single
 * vial plus one full case of `vials_per_box` — so a catalog that never touches
 * either column behaves exactly as it always did.
 *
 * Pricing is DERIVED unless an operator overrides it:
 *
 *     pack price = vial price × pack size        (the default)
 *     pack price = pack_options[].price          (when one is set)
 *
 * Leaving the price blank is the sane default: a price change on the product
 * still reprices every one of its packs at once. Typing one in is how you sell
 * a 10-pack at a discount — and the savings then show on the storefront by
 * themselves, because an un-set compare-at falls back to the undiscounted
 * vial × size figure.
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

/**
 * One pack as an operator configured it. Every field but `size` is optional:
 * a blank price/label/compare-at means "use the derived default", which is how
 * a product opts into a pack without also pinning its price forever.
 */
export interface StoredPackOption {
  size: number;
  /** Storefront button label. Blank → the derived `packLabel(size)`. */
  label: string | null;
  /** Fixed pack price. Blank → vial price × size. */
  price: number | null;
  /** Struck-through "was" price. Blank → the undiscounted vial × size. */
  compare_at: number | null;
  /** Unticked packs stay configured but are not offered. */
  enabled: boolean;
}

/** A pack with every blank resolved — what the storefront actually renders. */
export interface ResolvedPackOption {
  size: number;
  label: string;
  price: number;
  /** Null when there is nothing to strike through (i.e. no saving). */
  compareAt: number | null;
  /** compareAt − price, or 0. */
  savings: number;
  /** Whole-percent saving off compareAt, or 0. */
  savingsPercent: number;
  /** price ÷ size — what this pack works out to per vial. */
  perVialPrice: number;
}

/** Product shape the pack rules need — a superset of VialPricedProduct. */
export type PackOptionProduct = VialPricedProduct & {
  pack_sizes?: number[] | null;
  pack_options?: unknown;
};

/** A money field that may legitimately be blank. Negatives are treated as unset. */
function optionalMoney(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return round2(n);
}

/**
 * Clean a raw `pack_options` value into storable rows: a valid size, at most
 * MAX_PACK_OPTIONS of them, one per size, ascending. Anything unusable is
 * dropped rather than defaulted, so a malformed document can't invent a pack.
 *
 * Accepts a bare list of numbers too (`[1,3,5,10]`), which is what makes the
 * older `pack_sizes` column readable through the same path.
 */
export function normalizePackOptions(raw: unknown): StoredPackOption[] {
  if (!Array.isArray(raw)) return [];
  const bySize = new Map<number, StoredPackOption>();
  for (const entry of raw) {
    const row: Record<string, unknown> =
      typeof entry === 'object' && entry !== null
        ? (entry as Record<string, unknown>)
        : { size: entry };
    const size = Math.floor(Number(row.size));
    if (!Number.isFinite(size) || size < 1 || size > 1000) continue;
    const label = typeof row.label === 'string' && row.label.trim().length > 0
      ? row.label.trim().slice(0, 60)
      : null;
    // A later duplicate wins, which matches how the editor rewrites a row.
    bySize.set(size, {
      size,
      label,
      price: optionalMoney(row.price),
      compare_at: optionalMoney(row.compare_at ?? row.compareAt),
      enabled: row.enabled !== false,
    });
  }
  return [...bySize.values()]
    .sort((a, b) => a.size - b.size)
    .slice(0, MAX_PACK_OPTIONS);
}

/** Has an admin configured this product's packs in the richer column? */
export function hasCustomPackOptions(product: PackOptionProduct): boolean {
  return normalizePackOptions(product.pack_options).length > 0;
}

/**
 * The configured packs for a product, whichever column they live in:
 * `pack_options` first, then `pack_sizes`, then the legacy default pair. Rows
 * an operator unticked are included — filter on `enabled` to drop them.
 */
export function storedPackOptions(product: PackOptionProduct): StoredPackOption[] {
  const rich = normalizePackOptions(product.pack_options);
  if (rich.length > 0) return rich;
  return packSizesFor(product).map((size) => ({
    size,
    label: null,
    price: null,
    compare_at: null,
    enabled: true,
  }));
}

/**
 * The packs the storefront offers, every blank filled in.
 *
 * The compare-at rule is the useful part: when an operator types a pack price
 * BELOW the undiscounted vial × size figure and leaves compare-at blank, that
 * undiscounted figure becomes the strike-through automatically — so setting a
 * discount is one number, and the "save $X" line follows from it. An explicit
 * compare-at wins, and one that isn't actually higher than the price is
 * dropped rather than rendered as a nonsense saving.
 */
export function packOptionsFor(product: PackOptionProduct): ResolvedPackOption[] {
  const vialPrice = vialPriceFor(product);
  return storedPackOptions(product)
    .filter((option) => option.enabled)
    .map((option) => {
      const undiscounted = round2(vialPrice * option.size);
      const price = option.price ?? undiscounted;
      const rawCompare = option.compare_at ?? (price < undiscounted ? undiscounted : null);
      const compareAt = rawCompare != null && rawCompare > price ? rawCompare : null;
      const savings = compareAt != null ? round2(compareAt - price) : 0;
      return {
        size: option.size,
        label: option.label ?? packLabel(option.size),
        price,
        compareAt,
        savings,
        savingsPercent:
          compareAt != null && compareAt > 0 ? Math.round((savings / compareAt) * 100) : 0,
        perVialPrice: round2(price / Math.max(1, option.size)),
      };
    });
}

/**
 * Bring a stored `pack_options` document in line with a new list of SIZES.
 *
 * The cell grid and the bulk dialog edit which quantities a product is sold in
 * (`pack_sizes`) without touching per-pack pricing. Left alone, the two
 * columns would drift: the storefront reads `pack_options` first, so a size
 * removed in the grid would keep selling, and one added there would never
 * appear. So a sizes-only edit reconciles the richer column instead.
 *
 * A size that survives KEEPS its price, label and compare-at — a bulk tidy-up
 * of which packs exist must not silently wipe the pricing on the packs that
 * stayed. New sizes arrive blank (i.e. priced at vial × size), removed ones
 * are dropped.
 *
 * Returns null when the product had no per-pack pricing to begin with, which
 * leaves it on the plain `pack_sizes` path it was already using.
 */
export function reconcilePackOptions(
  storedPackOptions: unknown,
  sizes: number[],
): StoredPackOption[] | null {
  const existing = normalizePackOptions(storedPackOptions);
  if (existing.length === 0) return null;
  const bySize = new Map(existing.map((option) => [option.size, option]));
  const next = normalizePackSizes(sizes).map(
    (size) => bySize.get(size) ?? { size, label: null, price: null, compare_at: null, enabled: true },
  );
  return next.length > 0 ? next : null;
}

/** The resolved pack of `size`, or null when the product isn't sold in it. */
export function packOptionFor(
  product: PackOptionProduct,
  size: number,
): ResolvedPackOption | null {
  const n = Math.max(1, Math.floor(Number(size) || 1));
  return packOptionsFor(product).find((option) => option.size === n) ?? null;
}

/** Has an admin explicitly chosen this product's pack options, in either column? */
export function hasCustomPackSizes(product: PackOptionProduct): boolean {
  return (
    normalizePackOptions(product.pack_options).length > 0 ||
    normalizePackSizes(product.pack_sizes).length > 0
  );
}

/**
 * The pack quantities this product is sold in, ascending.
 *
 * `pack_options` wins (minus anything unticked), then the older `pack_sizes`,
 * then the legacy pair: a single vial and one full case (deduplicated, so a
 * 1-vial "case" yields just `[1]`).
 */
export function packSizesFor(product: PackOptionProduct): number[] {
  const rich = normalizePackOptions(product.pack_options).filter((o) => o.enabled);
  if (rich.length > 0) return rich.map((o) => o.size);
  const explicit = normalizePackSizes(product.pack_sizes);
  if (explicit.length > 0) return explicit;
  const per = vialsPerBoxOf(product.vials_per_box);
  return per > 1 ? [1, per] : [1];
}

/**
 * What one pack of `size` vials costs: the operator's fixed price for that
 * pack when there is one, otherwise the vial price × size.
 *
 * This is the single figure the storefront quotes, the cart charges and the
 * order route re-derives server-side, so an admin-set pack price is honoured
 * everywhere by changing it here alone.
 */
export function packPriceFor(product: PackOptionProduct, size: number): number {
  const n = Math.max(1, Math.floor(Number(size) || 1));
  const configured = normalizePackOptions(product.pack_options).find((o) => o.size === n);
  if (configured?.price != null) return configured.price;
  return round2(vialPriceFor(product) * n);
}

/** How many whole packs of `size` the on-hand vial stock covers. */
export function packsInStock(stockVials: number, size: number): number {
  const n = Math.max(1, Math.floor(Number(size) || 1));
  return Math.floor(Math.max(0, Number(stockVials) || 0) / n);
}

/**
 * Customer-facing label for a pack option, by size alone — the default when a
 * product has not been given its own wording. `packOptionsFor` applies the
 * operator's label on top of this.
 */
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
): { size: number; price: number; compareAt: number | null } | null {
  const options = packOptionsFor(product).filter((option) => option.size > 1);
  if (options.length === 0) return null;
  const option = options[options.length - 1];
  return { size: option.size, price: option.price, compareAt: option.compareAt };
}
