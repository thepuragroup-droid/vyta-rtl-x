// Unified pricing resolver — Hybrid H.
//
// Chain (per product, per customer):
//   1. customer_price_overrides.override_price          (per-customer override)
//   2. pricelist_items.price on the active pricelist    (global default for the active list)
//   3. products.price                                    (catalog base)
//
// Used by:
//   - /api/products + /api/products/featured (storefront)
//   - /api/admin/pricelists/active?customer_id=... (invoice form)
//
// The customer override layer is also the seam used by applyAffiliatePricelist
// to propagate an affiliate's pricelist into their bound customers.

import type { SupabaseClient } from '@supabase/supabase-js';
import { round2, vialsPerBoxOf } from '@/lib/pricing';

export type PriceSource = 'override' | 'pricelist' | 'base';

export interface ResolvedPrice {
  price: number;
  source: PriceSource;
  base: number; // products.price (always populated)
}

interface ResolveBatchOptions {
  customerId: string | null;
  productIds: string[];
}

/**
 * Resolve final prices for a known list of product IDs. Returns a Map keyed
 * by product_id; products without a base price (or unknown to the catalog)
 * are simply omitted from the result.
 */
export async function resolvePriceMap(
  db: SupabaseClient,
  opts: ResolveBatchOptions,
): Promise<Map<string, ResolvedPrice>> {
  const out = new Map<string, ResolvedPrice>();
  const ids = opts.productIds.filter(Boolean);
  if (ids.length === 0) return out;

  // 1. Load base prices for the requested products.
  const { data: prods } = await db
    .from('products')
    .select('id, price')
    .in('id', ids);
  for (const p of prods ?? []) {
    out.set(p.id, { price: Number(p.price ?? 0), source: 'base', base: Number(p.price ?? 0) });
  }

  // 2. Layer the active pricelist (if any).
  const { data: active } = await db
    .from('pricelists')
    .select('id')
    .eq('is_active', true)
    .maybeSingle();
  if (active?.id) {
    const { data: items } = await db
      .from('pricelist_items')
      .select('product_id, price')
      .eq('pricelist_id', active.id)
      .in('product_id', ids);
    for (const it of items ?? []) {
      const cur = out.get(it.product_id);
      const base = cur?.base ?? Number(it.price);
      out.set(it.product_id, { price: Number(it.price), source: 'pricelist', base });
    }
  }

  // 3. Layer customer overrides (highest priority).
  if (opts.customerId) {
    const { data: overrides } = await db
      .from('customer_price_overrides')
      .select('product_id, override_price')
      .eq('customer_id', opts.customerId)
      .in('product_id', ids);
    for (const o of overrides ?? []) {
      const cur = out.get(o.product_id);
      const base = cur?.base ?? Number(o.override_price);
      out.set(o.product_id, { price: Number(o.override_price), source: 'override', base });
    }
  }

  return out;
}

/**
 * Apply resolved prices to a list of catalogue rows in-place. Mutates `price`
 * on each row, and stamps `base_price` + `price_source` so the storefront can
 * show "was $X" badges when desired.
 *
 * A pricelist / customer override restates the per-vial price and drops the
 * catalog's fixed pack prices — the rule the checkout hand-off prices by
 * (`priceCartLines` in /api/checkout/puramass). So an overridden row also
 * carries `vial_price = price / vials_per_box` and no `pack_options`;
 * otherwise the storefront would keep quoting the catalog's own vial and pack
 * prices, and the cart would show one figure while the buyer is charged another.
 */
export async function applyResolvedPrices<
  T extends { id: string; price: number },
>(
  db: SupabaseClient,
  customerId: string | null,
  products: T[],
): Promise<Array<T & { base_price?: number; price_source?: PriceSource }>> {
  if (products.length === 0) return products as any;
  const map = await resolvePriceMap(db, {
    customerId,
    productIds: products.map((p) => p.id),
  });
  return products.map((p) => {
    const r = map.get(p.id);
    if (!r) return p as any;
    if (r.source === 'base') return p as any;
    const vialsPerBox = vialsPerBoxOf((p as { vials_per_box?: number | null }).vials_per_box);
    return {
      ...p,
      price: r.price,
      vial_price: round2(r.price / vialsPerBox),
      pack_options: null,
      base_price: r.base,
      price_source: r.source,
    };
  });
}

/**
 * Build a flat { product_id: finalPrice } map suitable for the invoice
 * form's price lookup. Only includes products whose resolved price differs
 * from the catalog base — the form falls back to product.price otherwise.
 */
export async function getActivePricelistPriceMap(
  db: SupabaseClient,
  customerId: string | null,
): Promise<{
  pricelist: { id: string; name?: string } | null;
  prices: Record<string, number>;
}> {
  const { data: pricelist } = await db
    .from('pricelists')
    .select('id, name')
    .eq('is_active', true)
    .maybeSingle();

  const prices: Record<string, number> = {};

  if (pricelist?.id) {
    const { data: items } = await db
      .from('pricelist_items')
      .select('product_id, price')
      .eq('pricelist_id', pricelist.id);
    for (const it of items ?? []) prices[it.product_id] = Number(it.price);
  }

  // Customer overrides override the pricelist entry (or insert a new one).
  if (customerId) {
    const { data: overrides } = await db
      .from('customer_price_overrides')
      .select('product_id, override_price')
      .eq('customer_id', customerId);
    for (const o of overrides ?? []) {
      prices[o.product_id] = Number(o.override_price);
    }
  }

  return { pricelist: pricelist ?? null, prices };
}
