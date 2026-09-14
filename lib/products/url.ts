/**
 * Public product URLs.
 *
 * `products.slug` is the internal SKU-style identifier — it is referenced by
 * imports, admin lookups and historical data, so it does not change. The public
 * URL lives in `products.url_slug` instead, which carries the compliant naming
 * (no dash inside a compound name, Ipamorelin shortened to IPAM).
 *
 * Always build product links through `productPath` rather than interpolating a
 * slug directly, so there is one place to change if the rule moves again.
 */

/**
 * The subset of a product row needed to build its URL. Both fields are
 * nullable: some views (lab results) join products in loosely and may hold a
 * row with neither populated.
 */
export interface ProductUrlFields {
  slug?: string | null;
  url_slug?: string | null;
}

/**
 * Derive the compliant URL slug from an internal SKU slug.
 *
 * Mirrors public.product_url_slug() in product-remove-all-dashes-migration.sql
 * — keep the two in step, or rows created through the app will disagree with
 * rows created by the migration.
 *
 * EVERY dash is removed, across the whole catalog: `bpc-157-10mg` ->
 * `bpc15710mg`, `5-amino-1mq-50mg` -> `5amino1mq50mg`. Ipamorelin is shortened
 * to IPAM and the `-ipa-` blend shorthand expanded first, since both depend on
 * the dashes that delimit them.
 */
export function toUrlSlug(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/ipamorelin/g, 'ipam')
    .replace(/(?<=-)ipa(?=-|$)/g, 'ipam')
    .replace(/-/g, '');
}

/**
 * Canonical public path for a product. Falls back to the SKU slug when
 * `url_slug` is absent — a row created before the migration, or a `select`
 * that didn't ask for the column — so a link is never emitted broken.
 *
 * With neither populated it returns the catalog index rather than
 * `/products/undefined`, so a partially-joined row degrades to a useful page
 * instead of a 404.
 */
export function productPath(product: ProductUrlFields): string {
  const identifier = product.url_slug || product.slug;
  return identifier ? `/products/${identifier}` : '/products';
}

/** Absolute product URL, for emails and anywhere else off-site. */
export function productUrl(product: ProductUrlFields, baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}${productPath(product)}`;
}
