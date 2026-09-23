/**
 * Editable marketing pages (`site_pages`). About Us is the seeded one; the
 * same model serves any additional page the admin panel creates.
 *
 * `published` IS the storefront toggle — an unpublished page 404s publicly but
 * stays fully editable and previewable in the admin panel.
 */

import { normalizeBlocks, type ContentBlock } from '@/lib/content/blocks';

export interface SitePage {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  hero_image_url: string | null;
  blocks: ContentBlock[];
  seo_title: string | null;
  seo_description: string | null;
  published: boolean;
  created_at: string;
  updated_at: string;
}

/** Pages the storefront routes to directly — deleting these would 404 a live URL. */
export const SYSTEM_PAGE_SLUGS = ['about'] as const;

export function isSystemPage(slug: string): boolean {
  return (SYSTEM_PAGE_SLUGS as readonly string[]).includes(slug);
}

function cleanString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function shapeSitePage(row: Record<string, any>): SitePage {
  return {
    id: String(row.id),
    slug: String(row.slug ?? ''),
    title: String(row.title ?? ''),
    subtitle: cleanString(row.subtitle),
    hero_image_url: cleanString(row.hero_image_url),
    blocks: normalizeBlocks(row.blocks),
    seo_title: cleanString(row.seo_title),
    seo_description: cleanString(row.seo_description),
    published: row.published === true,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

/**
 * Fallback copy for /about when the migration hasn't run or the row was
 * deleted. The storefront page is a real page either way — it never shows an
 * error to a visitor because an admin emptied a table.
 */
export const FALLBACK_ABOUT_PAGE: SitePage = {
  id: 'fallback-about',
  slug: 'about',
  title: 'About VYTA Biosciences',
  subtitle: 'Research-grade peptides, tested batch by batch.',
  hero_image_url: null,
  blocks: normalizeBlocks([
    {
      id: 'fb1',
      type: 'paragraph',
      lead: true,
      text: 'VYTA Biosciences supplies research-grade peptides to laboratories, clinics and independent researchers across Canada.',
    },
    {
      id: 'fb2',
      type: 'list',
      style: 'bullet',
      items: [
        'Third-party tested — a certificate of analysis for every batch we ship.',
        'Clear documentation: purity, mass and identity, published with the product.',
        'Fast, tracked shipping across Canada with responsive human support. We ship within Canada only.',
      ],
    },
    {
      id: 'fb3',
      type: 'callout',
      tone: 'info',
      title: 'Research use only',
      text: 'All products are intended strictly for laboratory research. They are not for human or veterinary use.',
    },
  ]),
  seo_title: 'About VYTA Biosciences',
  seo_description:
    'Who we are, how we test, and why researchers trust VYTA Biosciences for research-grade peptides.',
  published: true,
  created_at: '',
  updated_at: '',
};
