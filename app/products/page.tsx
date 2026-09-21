import type { Metadata } from 'next';
import { SITE_URL } from '@/lib/config';
import { productPath } from '@/lib/products/url';
import { getCatalogProducts } from '@/lib/products/products-server';
import { getServerSiteConfig } from '@/lib/site-config-server';
import ProductsClient from './ProductsClient';

/**
 * The catalog.
 *
 * Server shell around the (unchanged) interactive grid, for the same reason as
 * app/products/[slug]/page.tsx: the product list used to arrive only after a
 * client-side Supabase round-trip, so the page Google fetched contained a
 * skeleton and no links to any product. Those links are the catalog's job —
 * they are how authority reaches the individual product pages.
 */

export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const cfg = await getServerSiteConfig();
  const description =
    'Browse our full catalog of research peptides — third-party tested, ' +
    '99% purity, COA available for every batch. Ships from Canada.';
  return {
    title: `Research Peptides Catalog | ${cfg.store_name}`,
    description,
    // The home page's wellness tiles link here with ?category=, which is a
    // client-side filter over the same list, not a distinct page.
    alternates: { canonical: `${SITE_URL}/products` },
    openGraph: {
      title: `Research Peptides Catalog | ${cfg.store_name}`,
      description,
      type: 'website',
      url: `${SITE_URL}/products`,
    },
  };
}

export default async function ProductsPage() {
  const products = await getCatalogProducts();

  // ItemList tells Google the page is a catalog and what is on it, which is
  // what lets the individual products surface rather than just this page.
  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Research Peptides Catalog',
    numberOfItems: products.length,
    itemListElement: products.map((product, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: product.name,
      url: `${SITE_URL}${productPath(product)}`,
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(itemListJsonLd).replace(/</g, '\\u003c'),
        }}
      />
      <ProductsClient initialProducts={products} />
    </>
  );
}
