import { cache } from 'react';
import { getSupabase } from '@/lib/supabase';
import { isSystemPage, shapeSitePage, type SitePage } from '@/lib/content/pages';

/**
 * Server-side read of one published marketing page, deduped per request.
 *
 * Each storefront page needs it twice — once in `generateMetadata` for the
 * title/description and once in the page body — and React's `cache` collapses
 * those into a single Supabase round-trip, the same pattern
 * `getServerSiteConfig` uses for branding.
 *
 * Returns null for a missing or unpublished page so the caller can decide
 * between a 404 and a fallback.
 */
export const getPublishedPage = cache(async (slug: string): Promise<SitePage | null> => {
  try {
    const { data, error } = await getSupabase()
      .from('site_pages')
      .select('*')
      .eq('slug', slug)
      .eq('published', true)
      .maybeSingle();
    if (error || !data) return null;
    return shapeSitePage(data);
  } catch {
    // A missing table (migration not run) must not break the route — the
    // caller falls back to shipped copy or a 404.
    return null;
  }
});

/**
 * Slugs of every published editable page, for app/sitemap.ts.
 *
 * System pages are filtered out: `about` is published as a row so an editor can
 * change its copy, but it is served at /about by its own route, not at
 * /p/about, and listing both would be a duplicate URL.
 */
export const getPublishedPageSlugs = cache(
  async (): Promise<{ slug: string; updated_at: string }[]> => {
    try {
      const { data, error } = await getSupabase()
        .from('site_pages')
        .select('slug, updated_at')
        .eq('published', true)
        .limit(500);
      if (error || !data) return [];
      return data
        .map((row) => ({
          slug: String(row.slug ?? ''),
          updated_at: String(row.updated_at ?? ''),
        }))
        .filter((row) => row.slug.length > 0 && !isSystemPage(row.slug));
    } catch {
      return [];
    }
  },
);
