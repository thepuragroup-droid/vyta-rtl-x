/**
 * Saved carts — the storefront cart mirrored server-side, so a cart email can
 * show what was left behind and its "Return to cart" button can put it back
 * on any device.
 *
 * Only product lines are kept: `{ productId, packSize, quantity }`. Names,
 * images, pack labels and prices are always read from `products`, never taken
 * from the browser — a cart is written by an unauthenticated client, and what
 * it says ends up in an email.
 *
 * Pure (no I/O) so it can be unit-tested; the queries live in the engine and
 * the /api/cart routes, which pass product rows in.
 */
import { packOptionsFor, packsInStock, vialsPerBoxOf } from '@/lib/pricing';
import type { CartLineView } from './types';

export interface SavedCartLine {
  productId: string;
  packSize: number;
  quantity: number;
}

export const MAX_CART_LINES = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whatever the browser sent, as clean lines: UUID product ids, whole pack
 * sizes and quantities in range, duplicates merged, at most MAX_CART_LINES.
 * Anything malformed is dropped rather than failing the whole cart.
 */
export function sanitizeCartLines(raw: unknown): SavedCartLine[] {
  if (!Array.isArray(raw)) return [];
  const merged = new Map<string, SavedCartLine>();
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const productId = String(o.productId ?? '').toLowerCase();
    const packSize = Math.floor(Number(o.packSize));
    const quantity = Math.floor(Number(o.quantity));
    if (!UUID.test(productId)) continue;
    if (!Number.isFinite(packSize) || packSize < 1 || packSize > 1000) continue;
    if (!Number.isFinite(quantity) || quantity < 1) continue;
    const key = `${productId}::${packSize}`;
    const prev = merged.get(key);
    merged.set(key, { productId, packSize, quantity: Math.min(999, (prev?.quantity ?? 0) + quantity) });
    if (merged.size >= MAX_CART_LINES) break;
  }
  return [...merged.values()];
}

/** Order-independent fingerprint — a re-sync of the same cart is not a change. */
export function cartSignature(lines: SavedCartLine[]): string {
  return lines
    .map((l) => `${l.productId}:${l.packSize}:${l.quantity}`)
    .sort()
    .join('|');
}

export function itemCount(lines: SavedCartLine[]): number {
  return lines.reduce((n, l) => n + l.quantity, 0);
}

/** The product columns this module reads. */
export const CART_PRODUCT_COLUMNS =
  'id, name, price, vial_price, vials_per_box, pack_sizes, pack_options, stock_quantity, strength, image_url, active';

export interface CartProductRow {
  id: string;
  name: string;
  price: number | string;
  vial_price?: number | string | null;
  vials_per_box?: number | null;
  pack_sizes?: number[] | null;
  pack_options?: unknown;
  stock_quantity?: number | null;
  strength?: string | null;
  image_url?: string | null;
  active?: boolean | null;
}

function packLabel(product: CartProductRow, size: number): string {
  const option = packOptionsFor(product as any).find((o) => o.size === size);
  if (option?.label) return option.label;
  return size > 1 ? `Pack of ${size}` : 'Single vial';
}

/** Cart lines for an email: name, pack, quantity and picture, from `products`. */
export function cartLineViews(lines: SavedCartLine[], products: CartProductRow[]): CartLineView[] {
  const byId = new Map(products.map((p) => [String(p.id).toLowerCase(), p]));
  const out: CartLineView[] = [];
  for (const l of lines) {
    const p = byId.get(l.productId);
    if (!p) continue;
    out.push({
      productId: l.productId,
      name: p.name,
      packLabel: packLabel(p, l.packSize),
      quantity: l.quantity,
      imageUrl: p.image_url || null,
    });
  }
  return out;
}

/** A line the storefront cart can take as-is (CartContext adds the line id). */
export interface RestoredCartLine {
  productId: string;
  unit: 'vial' | 'case';
  packSize: number;
  vialsPerBox: number;
  name: string;
  price: number;
  quantity: number;
  strength: string;
  image_url?: string;
  stock_quantity: number;
}

/**
 * Rebuild cart lines exactly as the product page would add them — today's
 * pack price, today's stock ceiling — skipping anything no longer sold or out
 * of stock, and clamping quantities to what is in stock.
 */
export function restoreCartLines(
  lines: SavedCartLine[],
  products: CartProductRow[],
): { lines: RestoredCartLine[]; dropped: number } {
  const byId = new Map(products.map((p) => [String(p.id).toLowerCase(), p]));
  const out: RestoredCartLine[] = [];
  let dropped = 0;
  for (const l of lines) {
    const p = byId.get(l.productId);
    if (!p || p.active === false) {
      dropped++;
      continue;
    }
    const option = packOptionsFor(p as any).find((o) => o.size === l.packSize);
    const cap = packsInStock(Number(p.stock_quantity) || 0, l.packSize);
    if (!option || cap < 1) {
      dropped++;
      continue;
    }
    out.push({
      productId: String(p.id),
      unit: l.packSize > 1 ? 'case' : 'vial',
      packSize: l.packSize,
      vialsPerBox: vialsPerBoxOf(p.vials_per_box),
      name: p.name,
      price: option.price,
      quantity: Math.min(l.quantity, cap),
      strength: p.strength ?? '',
      image_url: p.image_url || undefined,
      stock_quantity: cap,
    });
  }
  return { lines: out, dropped };
}

/** Lines from an unpaid hosted-checkout ledger row (`puramass_orders.items`). */
export function linesFromCheckout(items: unknown): SavedCartLine[] {
  if (!Array.isArray(items)) return [];
  return sanitizeCartLines(
    items.map((i: any) => ({ productId: i?.product_id, packSize: i?.pack_size ?? 1, quantity: i?.quantity })),
  );
}

/** /cart?restore=… — and, for "Complete my order", straight on to checkout with a code. */
export function restoreUrls(siteUrl: string, token: string, code: string | null): { cartUrl: string; checkoutUrl: string } {
  const base = `${siteUrl.replace(/\/$/, '')}/cart?restore=${encodeURIComponent(token)}`;
  return {
    cartUrl: base,
    checkoutUrl: `${base}&next=checkout${code ? `&discount=${encodeURIComponent(code)}` : ''}`,
  };
}
