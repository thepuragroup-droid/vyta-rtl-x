import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/config';
import { productPath } from '@/lib/products/url';
import { getProductsForSitemap } from '@/lib/products/products-server';
import { getPublishedArticles } from '@/lib/content/articles-server';
import { getPublishedPageSlugs } from '@/lib/content/pages-server';

/**
 * /sitemap.xml — the list of URLs submitted to Google Search Console.
 *
 * Product URLs are the reason this file exists. `products.url_slug` strips
 * every dash from the SKU (bpc-157-10mg -> bpc15710mg, see lib/products/url.ts),
 * so a crawler cannot guess them and internal links are otherwise the only
 * discovery path. Entries are always built through `productPath` so the sitemap
 * and the canonical tag on the page can never disagree.
 *
 * Regenerated hourly rather than at build time, so a product added in the admin
 * panel appears without a redeploy.
 */
export const revalidate = 3600;

/** Storefront routes that exist as files and are always public. */
const STATIC_ROUTES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }[] = [
  { path: '', priority: 1.0, changeFrequency: 'daily' },
  { path: '/products', priority: 0.9, changeFrequency: 'daily' },
  { path: '/articles', priority: 0.7, changeFrequency: 'weekly' },
  { path: '/lab-results', priority: 0.7, changeFrequency: 'weekly' },
  { path: '/about', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/contact', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/partners', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/terms', priority: 0.3, changeFrequency: 'yearly' },
];

/** A Supabase timestamp as a Date, or now when it is missing or unparseable. */
function lastModified(stamp: string | null | undefined): Date {
  if (!stamp) return new Date();
  const parsed = new Date(stamp);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, articles, pages] = await Promise.all([
    getProductsForSitemap(),
    getPublishedArticles(),
    getPublishedPageSlugs(),
  ]);

  const now = new Date();

  return [
    ...STATIC_ROUTES.map((route) => ({
      url: `${SITE_URL}${route.path}`,
      lastModified: now,
      changeFrequency: route.changeFrequency,
      priority: route.priority,
    })),
    // Products carry the highest priority after the home page: they are what
    // the site is for, and price/stock change often enough to warrant `daily`.
    ...products.map((product) => ({
      url: `${SITE_URL}${productPath(product)}`,
      lastModified: lastModified(product.updated_at),
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
    ...articles.map((article) => ({
      url: `${SITE_URL}/articles/${article.slug}`,
      lastModified: lastModified(article.updated_at || article.published_at),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
    ...pages.map((page) => ({
      url: `${SITE_URL}/p/${page.slug}`,
      lastModified: lastModified(page.updated_at),
      changeFrequency: 'monthly' as const,
      priority: 0.4,
    })),
  ];
}
