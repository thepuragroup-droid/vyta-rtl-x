import type { Metadata } from 'next';
import SitePageView from '@/components/content/SitePageView';
import { getPublishedPage } from '@/lib/content/pages-server';
import { FALLBACK_ABOUT_PAGE } from '@/lib/content/pages';
import { excerptFromBlocks } from '@/lib/content/blocks';

/**
 * About Us — fully editable from Admin → Content → Pages.
 *
 * Unlike the other editable pages, /about NEVER 404s: it is a link in the
 * footer and a page search engines already know, so an unpublished or
 * not-yet-migrated row falls back to the shipped copy rather than breaking a
 * live URL. Unpublishing it in the admin panel reverts it to that baseline.
 */

// Re-read on a short interval rather than baking the copy into the build, so
// an edit reaches visitors without a deploy.
export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const page = (await getPublishedPage('about')) ?? FALLBACK_ABOUT_PAGE;
  const description =
    page.seo_description || page.subtitle || excerptFromBlocks(page.blocks, 160);
  return {
    title: `${page.seo_title || page.title} | VYTA`,
    description,
    openGraph: {
      title: page.seo_title || page.title,
      description,
      type: 'website',
      ...(page.hero_image_url ? { images: [page.hero_image_url] } : {}),
    },
  };
}

export default async function AboutPage() {
  const page = (await getPublishedPage('about')) ?? FALLBACK_ABOUT_PAGE;
  return <SitePageView page={page} />;
}
