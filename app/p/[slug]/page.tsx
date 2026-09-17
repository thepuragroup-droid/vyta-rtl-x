import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import SitePageView from '@/components/content/SitePageView';
import { getPublishedPage } from '@/lib/content/pages-server';
import { excerptFromBlocks } from '@/lib/content/blocks';

/**
 * Any page created in Admin → Content → Pages beyond the built-in ones.
 *
 * These have no shipped fallback (nothing links to them until an editor
 * publishes one), so an unpublished or unknown slug is a plain 404 — which is
 * also what keeps a draft from being readable by guessing its URL.
 */

export const revalidate = 60;

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPublishedPage(slug);
  if (!page) return { title: 'Page not found | VYTA' };

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

export default async function EditablePage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const page = await getPublishedPage(slug);
  if (!page) notFound();
  return <SitePageView page={page} />;
}
