import { cache } from 'react';
import { getSupabase } from '@/lib/supabase';

/**
 * Server-side product reads for the storefront, deduped per request.
 *
 * Same `cache` pattern as lib/content/pages-server.ts and articles-server.ts:
 * the product route needs the row twice — once in `generateMetadata` for the
 * title/description/canonical and once in the page body — and React collapses
 * those into a single Supabase round-trip.
 *
 * Every function is non-throwing. A missing table or an unreachable database
 * resolves to null/[] so a route degrades to a 404 or an empty section rather
 * than a 500, which is also what keeps the sitemap from breaking the build.
 */

/** The full product row the detail page renders. Mirrors `products`. */
export interface PublicProduct {
  id: string;
  name: string;
  slug: string;
  url_slug?: string | null;
  category: string;
  description: string;
  description_short: string | null;
  benefits: string | null;
  mechanism: string | null;
  price: number;
  vial_price: number | null;
  vials_per_box: number | null;
  pack_sizes?: number[] | null;
  pack_options?: unknown;
  strength: string;
  purity: string;
  form: string;
  stock_quantity: number;
  active: boolean;
  image_url: string | null;
  box_image_url: string | null;
  coa_url: string[] | null;
  updated_at?: string | null;
}

/**
 * One product by its public URL identifier.
 *
 * Resolves `url_slug` first, then falls back to the SKU `slug` so links issued
 * before url_slug existed keep working — see lib/products/url.ts. The caller
 * compares `url_slug` against the requested slug to decide whether to redirect
 * to the canonical URL.
 *
 * Inactive products are returned rather than hidden: the route decides what a
 * de-listed product should do, and a hard 404 on something a customer has
 * bookmarked is worse than a page saying it is unavailable.
 */
export const getPublicProduct = cache(
  async (slug: string): Promise<PublicProduct | null> => {
    try {
      const db = getSupabase();
      const { data, error } = await db
        .from('products')
        .select('*')
        .eq('url_slug', slug)
        .maybeSingle();
      if (!error && data) return data as PublicProduct;

      const { data: legacy, error: legacyError } = await db
        .from('products')
        .select('*')
        .eq('slug', slug)
        .maybeSingle();
      if (legacyError || !legacy) return null;
      return legacy as PublicProduct;
    } catch {
      return null;
    }
  },
);

/** Up to `limit` other active products in the same category, for the "related" row. */
export const getRelatedProducts = cache(
  async (category: string, excludeId: string, limit = 4): Promise<PublicProduct[]> => {
    try {
      const { data, error } = await getSupabase()
        .from('products')
        .select('*')
        .eq('category', category)
        .neq('id', excludeId)
        .eq('active', true)
        .limit(limit);
      if (error || !data) return [];
      return data as PublicProduct[];
    } catch {
      return [];
    }
  },
);

/**
 * Bacteriostatic water, offered alongside every product as a companion buy.
 * Null when the SKU is absent from the catalog.
 */
export const getBacteriostaticWater = cache(async (): Promise<PublicProduct | null> => {
  try {
    const { data, error } = await getSupabase()
      .from('products')
      .select('*')
      .eq('slug', 'bacteriostatic-water-30ml')
      .maybeSingle();
    if (error || !data) return null;
    return data as PublicProduct;
  } catch {
    return null;
  }
});

/** The identifiers the sitemap needs — no need to pull whole rows for it. */
export interface ProductSitemapRow {
  slug: string;
  url_slug: string | null;
  updated_at: string | null;
}

/**
 * Every active product, for app/sitemap.ts.
 *
 * Only `active` rows: a de-listed product should not be submitted to Google,
 * even though its URL still resolves for anyone holding the link.
 */
export const getProductsForSitemap = cache(async (): Promise<ProductSitemapRow[]> => {
  try {
    const { data, error } = await getSupabase()
      .from('products')
      .select('slug, url_slug, updated_at')
      .eq('active', true)
      .limit(2000);
    if (error || !data) return [];
    return data as ProductSitemapRow[];
  } catch {
    return [];
  }
});
