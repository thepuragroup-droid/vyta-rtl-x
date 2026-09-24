/**
 * GET /api/products/recommendations?ids=<uuid>,<uuid>
 *
 * The two upsell blocks on the cart, in one round trip:
 *
 *   • `frequentlyBoughtTogether` — the operator's own pairings for the
 *     products in the cart (`product_recommendations`, edited in
 *     /admin/cart-upsells), in the order they set, de-duplicated across cart
 *     lines and never repeating something already in the cart.
 *
 *   • `youMayAlsoLike` — computed, not configured: the catalog ranked against
 *     the cart by what people have actually bought together. The ranking is
 *     `lib/products/recommendations.ts`; everything this route adds is the
 *     reading.
 *
 * Both lists come back as full product rows with per-customer pricing already
 * resolved (same chain as /api/products: customer override > pricelist >
 * catalog), so the cart can price a suggestion exactly as the product page
 * would, and adding one to the cart cannot quote a price the checkout then
 * disagrees with.
 *
 * Public and unauthenticated, like the catalogue read it sits beside. An
 * Authorization header is honoured when present so a signed-in customer sees
 * their own prices.
 *
 * Failure is never fatal: a missing `product_recommendations` table (migration
 * not yet run), an unreadable order history or a settings row that switches a
 * block off all return an empty list for that block, and the cart simply does
 * not render it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { applyResolvedPrices } from '@/lib/pricing/resolve';
import {
  rankRecommendations,
  type PurchaseLine,
  type RecommendableProduct,
} from '@/lib/products/recommendations';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** Most curated pairings to show — three cards fit the cart's row. */
const FBT_LIMIT = 3;
/** Most computed suggestions to show — the carousel scrolls past four. */
const SIMILAR_LIMIT = 8;
/**
 * How much purchase history the ranking reads.
 *
 * Recent rather than complete: what sold together last quarter is a better
 * guide than what sold together three years ago, and it keeps the query a
 * bounded one however large the ledger grows.
 */
const HISTORY_ROWS = 4000;

async function resolveCustomerId(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;
  try {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await db.auth.getUser(token);
    return user?.id ?? null;
  } catch {
    return null;
  }
}

/** The cart's product ids, as sent. Anything malformed is dropped. */
function readIds(request: NextRequest): string[] {
  const raw = request.nextUrl.searchParams.get('ids') ?? '';
  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  return [...new Set(ids)].slice(0, 50);
}

/**
 * Which blocks the operator has left switched on. Defaults to both: the
 * columns arrive with cart-upsells-migration.sql, and an install that has not
 * run it yet should still get the cart it had before being asked.
 */
async function readToggles(): Promise<{ fbt: boolean; similar: boolean }> {
  try {
    const { data } = await db.from('site_settings').select('*').limit(1).maybeSingle();
    return {
      fbt: (data as any)?.cart_fbt_enabled ?? true,
      similar: (data as any)?.cart_similar_enabled ?? true,
    };
  } catch {
    return { fbt: true, similar: true };
  }
}

/**
 * The operator's pairings for these cart products, in their order.
 *
 * Read directionally (`product_id IN (cart)`), so a pairing set on a flagship
 * does not also make the flagship an upsell under its own add-on. A product
 * paired from two different cart lines appears once, at its best position.
 */
async function curatedIds(cartIds: string[]): Promise<Map<string, string | null>> {
  const picked = new Map<string, string | null>();
  if (cartIds.length === 0) return picked;
  try {
    const { data, error } = await db
      .from('product_recommendations')
      .select('recommended_product_id, sort_order, badge, enabled')
      .in('product_id', cartIds)
      .eq('enabled', true)
      .order('sort_order', { ascending: true });
    if (error) return picked;
    for (const row of data ?? []) {
      const id = String((row as any).recommended_product_id);
      if (!id || picked.has(id)) continue;
      picked.set(id, ((row as any).badge as string | null) ?? null);
    }
  } catch {
    /* Table not migrated yet — the block simply does not render. */
  }
  return picked;
}

/**
 * Recent purchase lines, from every place an order is recorded.
 *
 * `order_items` covers the crypto/e-transfer checkout, and `puramass_orders`
 * the hosted one — which is the live checkout, so leaving it out would mean
 * ranking today's carts on history that stopped being written. Its lines carry
 * Stealth Health SKUs rather than product ids, so they are mapped back through the
 * catalog's `puramass_sku` / `puramass_sku_vial` columns.
 */
async function readHistory(products: any[]): Promise<PurchaseLine[]> {
  const lines: PurchaseLine[] = [];

  try {
    const { data } = await db
      .from('order_items')
      .select('order_id, product_id, quantity')
      .order('created_at', { ascending: false })
      .limit(HISTORY_ROWS);
    for (const row of data ?? []) {
      const productId = (row as any).product_id;
      const orderId = (row as any).order_id;
      if (!productId || !orderId) continue;
      lines.push({
        orderId: String(orderId),
        productId: String(productId),
        quantity: Number((row as any).quantity) || 1,
      });
    }
  } catch {
    /* No order history to read — popularity falls back to `featured`. */
  }

  const bySku = new Map<string, string>();
  for (const product of products) {
    for (const sku of [product.puramass_sku, product.puramass_sku_vial]) {
      if (sku) bySku.set(String(sku).toLowerCase(), product.id);
    }
  }
  if (bySku.size > 0) {
    try {
      const { data } = await db
        .from('puramass_orders')
        .select('id, items, status')
        .order('created_at', { ascending: false })
        .limit(HISTORY_ROWS);
      for (const order of data ?? []) {
        // Only orders that were actually paid for: an abandoned hosted
        // checkout is a cart, not evidence that two things sell together.
        if ((order as any).status !== 'paid') continue;
        const items = Array.isArray((order as any).items) ? (order as any).items : [];
        for (const item of items) {
          const productId = bySku.get(String(item?.sku ?? '').toLowerCase());
          if (!productId) continue;
          lines.push({
            orderId: String((order as any).id),
            productId,
            quantity: Number(item?.quantity) || 1,
          });
        }
      }
    } catch {
      /* Ledger not migrated / unreadable — the other source still ranks. */
    }
  }

  return lines;
}

export async function GET(request: NextRequest) {
  const cartIds = readIds(request);
  const customerId = await resolveCustomerId(request);
  const toggles = await readToggles();

  const { data: catalog, error } = await db
    .from('products')
    .select('*')
    .eq('active', true);
  if (error) {
    return NextResponse.json({ frequentlyBoughtTogether: [], youMayAlsoLike: [] });
  }
  const products = catalog ?? [];
  const byId = new Map(products.map((p: any) => [p.id, p]));

  // ---- Frequently bought together (curated) ----
  const curated = toggles.fbt ? await curatedIds(cartIds) : new Map<string, string | null>();
  const fbtRows = [...curated.entries()]
    .map(([id, badge]) => ({ product: byId.get(id), badge }))
    .filter(
      (row) =>
        row.product &&
        !cartIds.includes(row.product.id) &&
        Number(row.product.stock_quantity) > 0,
    )
    .slice(0, FBT_LIMIT);

  // ---- You may also like (computed) ----
  let similarRows: any[] = [];
  if (toggles.similar) {
    const history = await readHistory(products);
    const ranked = rankRecommendations({
      products: products.map(
        (p: any): RecommendableProduct => ({
          id: p.id,
          name: p.name ?? '',
          category: p.category ?? null,
          featured: !!p.featured,
          stockQuantity: Number(p.stock_quantity) || 0,
        }),
      ),
      lines: history,
      cartProductIds: cartIds,
      // Never the same card twice: what the curated block is already showing
      // is kept out of the computed one.
      excludeProductIds: fbtRows.map((row) => row.product.id),
      limit: SIMILAR_LIMIT,
    });
    similarRows = ranked
      .map((entry) => ({ product: byId.get(entry.productId), reason: entry.reason }))
      .filter((row) => row.product);
  }

  // One price resolution for both lists — the chain is a per-customer lookup,
  // and running it twice would double the work to reach the same answer.
  const priced = await applyResolvedPrices(db, customerId, [
    ...fbtRows.map((row) => row.product),
    ...similarRows.map((row) => row.product),
  ]);
  const pricedById = new Map(priced.map((p: any) => [p.id, p]));

  return NextResponse.json({
    frequentlyBoughtTogether: fbtRows.map((row) => ({
      ...(pricedById.get(row.product.id) ?? row.product),
      recommendation_badge: row.badge,
    })),
    youMayAlsoLike: similarRows.map((row) => ({
      ...(pricedById.get(row.product.id) ?? row.product),
      recommendation_reason: row.reason,
    })),
  });
}
