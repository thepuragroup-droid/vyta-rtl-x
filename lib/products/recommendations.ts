/**
 * "You may also like" — what the cart suggests when nobody has curated
 * anything.
 *
 * The block next to it, "Frequently bought together", is the operator's own
 * list (`product_recommendations`, edited in /admin/cart-upsells). This one is
 * earned rather than configured: it ranks the rest of the catalog against
 * whatever is in the cart, using what people have actually bought.
 *
 * Three signals, in the order they are trusted:
 *
 *   1. CO-PURCHASE — how often a product has appeared in the same order as
 *      something in this cart. The strongest signal by far, and the only one
 *      that is about these two products rather than about one of them.
 *   2. CATEGORY — same category as something in the cart. A weaker but always
 *      available stand-in for co-purchase, which a young catalog has little of.
 *   3. POPULARITY — units sold across the whole window, plus a nudge for the
 *      products the operator flagged `featured`. This is what an empty history
 *      falls back on, so the block is never blank on a fresh install.
 *
 * The scoring is pure and lives here so it can be unit-tested without a
 * database: the API route (`/api/products/recommendations`) does the reading
 * and hands the rows in.
 *
 * Out-of-stock products are dropped rather than ranked low. A recommendation
 * that cannot be added to the cart is not a recommendation.
 */

/** One purchased line, from any of the order tables we can read. */
export interface PurchaseLine {
  /** Groups lines into a basket. Any stable per-order key will do. */
  orderId: string;
  productId: string;
  /** Units on the line. Missing/invalid counts as 1 — it was still bought. */
  quantity?: number;
}

/** What the ranker needs to know about a candidate product. */
export interface RecommendableProduct {
  id: string;
  name: string;
  category: string | null;
  featured: boolean;
  /** On-hand vials. Zero or less and the product is not offered. */
  stockQuantity: number;
}

export interface RecommendationScore {
  productId: string;
  score: number;
  /** Why it is here — the strongest signal that put it there. */
  reason: 'bought-together' | 'same-category' | 'popular';
  /** How many baskets it shared with the cart. */
  coPurchases: number;
}

/**
 * Signal weights.
 *
 * Co-purchase dominates: one shared basket outranks any amount of category
 * kinship, and the cap keeps a single runaway bestseller from crowding out
 * every other suggestion once it has been bought with everything.
 */
const WEIGHT = {
  /** Per shared basket… */
  coPurchase: 10,
  /** …up to this many of them. */
  coPurchaseCap: 6,
  /** Shares a category with something in the cart. */
  sameCategory: 6,
  /** Full marks for popularity, scaled by units sold against `popularityFullMarks`. */
  popularity: 5,
  /** Flagged `featured` by the operator. */
  featured: 2,
} as const;

/** Units sold that count as "as popular as this signal can say". */
const POPULARITY_FULL_MARKS = 25;

function unitsOf(line: PurchaseLine): number {
  const n = Math.floor(Number(line.quantity));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * How many distinct baskets each product shared with `seedIds`.
 *
 * Counted per BASKET, not per line: a buyer who ordered three vials of one
 * thing alongside the cart's product is one vote, not three. Products in
 * `seedIds` are not counted against themselves.
 */
export function coPurchaseCounts(
  lines: PurchaseLine[],
  seedIds: string[],
): Map<string, number> {
  const seeds = new Set(seedIds);
  const baskets = new Map<string, Set<string>>();
  for (const line of lines) {
    if (!line?.orderId || !line?.productId) continue;
    let basket = baskets.get(line.orderId);
    if (!basket) {
      basket = new Set();
      baskets.set(line.orderId, basket);
    }
    basket.add(line.productId);
  }

  const counts = new Map<string, number>();
  for (const basket of baskets.values()) {
    let touchesCart = false;
    for (const id of basket) {
      if (seeds.has(id)) {
        touchesCart = true;
        break;
      }
    }
    if (!touchesCart) continue;
    for (const id of basket) {
      if (seeds.has(id)) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

/** Total units sold per product across the whole window. */
export function unitsSold(lines: PurchaseLine[]): Map<string, number> {
  const sold = new Map<string, number>();
  for (const line of lines) {
    if (!line?.productId) continue;
    sold.set(line.productId, (sold.get(line.productId) ?? 0) + unitsOf(line));
  }
  return sold;
}

export interface RankOptions {
  /** Every product that could be suggested — the active catalog. */
  products: RecommendableProduct[];
  /** Purchase history to mine. An empty list falls back to popularity alone. */
  lines: PurchaseLine[];
  /** What is in the cart. Drives co-purchase and category affinity. */
  cartProductIds: string[];
  /**
   * Also keep these out of the results — the "frequently bought together"
   * block's products, so the two blocks never show the same card twice.
   */
  excludeProductIds?: string[];
  /** How many to return. */
  limit?: number;
}

/**
 * Rank the catalog against a cart. Highest score first.
 *
 * Ties break on units sold and then on name, so the same cart always produces
 * the same list — a block that reshuffles itself between renders reads as
 * broken, and makes the suggestions impossible to evaluate.
 */
export function rankRecommendations({
  products,
  lines,
  cartProductIds,
  excludeProductIds = [],
  limit = 8,
}: RankOptions): RecommendationScore[] {
  const excluded = new Set([...cartProductIds, ...excludeProductIds]);
  const counts = coPurchaseCounts(lines, cartProductIds);
  const sold = unitsSold(lines);

  const cartCategories = new Set(
    products
      .filter((p) => cartProductIds.includes(p.id))
      .map((p) => (p.category ?? '').trim().toLowerCase())
      .filter(Boolean),
  );

  const scored: RecommendationScore[] = [];
  for (const product of products) {
    if (excluded.has(product.id)) continue;
    if (!(Number(product.stockQuantity) > 0)) continue;

    const coPurchases = counts.get(product.id) ?? 0;
    const category = (product.category ?? '').trim().toLowerCase();
    const sameCategory = category.length > 0 && cartCategories.has(category);
    const units = sold.get(product.id) ?? 0;

    let score = Math.min(coPurchases, WEIGHT.coPurchaseCap) * WEIGHT.coPurchase;
    if (sameCategory) score += WEIGHT.sameCategory;
    score += Math.min(units / POPULARITY_FULL_MARKS, 1) * WEIGHT.popularity;
    if (product.featured) score += WEIGHT.featured;

    scored.push({
      productId: product.id,
      score: Math.round(score * 100) / 100,
      reason: coPurchases > 0 ? 'bought-together' : sameCategory ? 'same-category' : 'popular',
      coPurchases,
    });
  }

  const nameOf = new Map(products.map((p) => [p.id, p.name ?? '']));
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (sold.get(b.productId) ?? 0) - (sold.get(a.productId) ?? 0) ||
      (nameOf.get(a.productId) ?? '').localeCompare(nameOf.get(b.productId) ?? ''),
  );

  return scored.slice(0, Math.max(0, limit));
}
