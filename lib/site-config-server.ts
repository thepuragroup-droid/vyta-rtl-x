import { cache } from 'react';
import { getSupabase } from '@/lib/supabase';
import { DEFAULT_SITE_CONFIG, readSiteConfigRow, type SiteConfig } from '@/lib/site-config';

/**
 * Server-side read of the branding/tracking config, deduped per request.
 *
 * The root layout needs it twice — once in `generateMetadata` for the store
 * name/favicon and once in the layout body for the GTM `<noscript>` fallback —
 * and React's `cache` collapses those into a single Supabase round-trip.
 *
 * Server components only (`cache` is a React Server Component API); client
 * code goes through `fetchSiteConfig` / `SiteConfigContext` instead.
 */
export const getServerSiteConfig = cache(async (): Promise<SiteConfig> => {
  try {
    return await readSiteConfigRow(getSupabase());
  } catch {
    return DEFAULT_SITE_CONFIG;
  }
});
