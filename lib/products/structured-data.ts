import { DEFAULT_CURRENCY } from '@/lib/currency';
import { vialPriceFor } from '@/lib/pricing';
import { productPath } from '@/lib/products/url';
import type { PublicProduct } from '@/lib/products/products-server';

/**
 * schema.org JSON-LD for a product page.
 *
 * This is what lets a listing show price, availability and review stars in
 * Google's results rather than a bare blue link. Everything emitted here has to
 * match what a customer actually sees on the page — markup that disagrees with
 * the visible price is a manual-action risk, not just an ignored snippet.
 *
 * The price quoted is the single-vial price, which is the unit the headline on
 * the page falls back to and the smallest amount a customer can pay. Pack
 * prices are multiples resolved client-side by the pack picker.
 */

export interface ProductJsonLdInput {
  product: PublicProduct;
  /** Absolute origin, from lib/config SITE_URL. */
  siteUrl: string;
  /** Store name from site settings, used as the brand and seller. */
  storeName: string;
  /** Published review rollup, or null when the product has none. */
  reviewStats: { review_count: number; average_rating: number } | null;
}

/** Resolve a possibly-relative image path against the site origin. */
function absoluteImage(url: string | null, siteUrl: string): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${siteUrl.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** A short plain-text description, preferring the curated short copy. */
export function productMetaDescription(product: PublicProduct, max = 160): string {
  const source = (product.description_short || product.description || '').trim();
  const flat = source.replace(/\s+/g, ' ');
  if (flat.length <= max) return flat;
  // Cut on a word boundary so the snippet doesn't end mid-word.
  return `${flat.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

export function buildProductJsonLd({
  product,
  siteUrl,
  storeName,
  reviewStats,
}: ProductJsonLdInput): Record<string, unknown> {
  const origin = siteUrl.replace(/\/$/, '');
  const canonical = `${origin}${productPath(product)}`;
  const images = [
    absoluteImage(product.image_url, origin),
    absoluteImage(product.box_image_url, origin),
  ].filter((url): url is string => Boolean(url));

  // `additionalProperty` is where the spec sheet goes. These are the three
  // attributes a buyer compares across suppliers, and schema.org has no
  // dedicated Product field for any of them.
  const specs = [
    { name: 'Purity', value: product.purity },
    { name: 'Strength', value: product.strength },
    { name: 'Form', value: product.form },
  ].filter((spec) => Boolean(spec.value));

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: productMetaDescription(product, 5000),
    ...(images.length > 0 ? { image: images } : {}),
    sku: product.slug,
    ...(product.category ? { category: product.category } : {}),
    brand: { '@type': 'Brand', name: storeName },
    ...(specs.length > 0
      ? {
          additionalProperty: specs.map((spec) => ({
            '@type': 'PropertyValue',
            name: spec.name,
            value: spec.value,
          })),
        }
      : {}),
    offers: {
      '@type': 'Offer',
      url: canonical,
      priceCurrency: DEFAULT_CURRENCY,
      price: vialPriceFor(product).toFixed(2),
      itemCondition: 'https://schema.org/NewCondition',
      availability:
        product.active && product.stock_quantity > 0
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
      seller: { '@type': 'Organization', name: storeName },
    },
    ...(reviewStats
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: reviewStats.average_rating,
            reviewCount: reviewStats.review_count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };
}

/**
 * BreadcrumbList for the product page: Home › Products › <product>.
 *
 * Gives Google the crumb trail it renders in place of the raw URL, which
 * matters more than usual here because url_slug is an opaque run-together
 * string (bpc15710mg) that reads badly as a URL in results.
 */
export function buildProductBreadcrumbJsonLd(
  product: PublicProduct,
  siteUrl: string,
): Record<string, unknown> {
  const origin = siteUrl.replace(/\/$/, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: origin },
      { '@type': 'ListItem', position: 2, name: 'Products', item: `${origin}/products` },
      {
        '@type': 'ListItem',
        position: 3,
        name: product.name,
        item: `${origin}${productPath(product)}`,
      },
    ],
  };
}
