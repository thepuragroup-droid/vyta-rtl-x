import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/config';

/**
 * /robots.txt.
 *
 * Everything customer-facing is crawlable; everything behind a login, every
 * step of the funnel, and the API are not. Blocking the funnel matters for more
 * than privacy — /cart and /checkout render per-session state that would be
 * indexed as thin duplicate pages and spend crawl budget that belongs to the
 * product catalog.
 *
 * Note that `disallow` is a crawl instruction, not an access control: these
 * routes are protected by middleware and RLS, and listing them here only keeps
 * well-behaved crawlers out.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin',
          '/warehouse',
          '/account',
          // /affiliate/apply and /affiliate/signup are recruitment pages and
          // stay crawlable; only the signed-in portal is blocked.
          '/affiliate/dashboard',
          '/affiliate/settings',
          '/affiliate/code',
          '/affiliate/login',
          '/login',
          '/signup',
          '/forgot-password',
          '/reset-password',
          '/cart',
          '/checkout',
          '/order',
          '/shipping-address',
          // Affiliate links land on a real page with a tracking parameter; the
          // canonical tag already collapses them, and this stops the crawler
          // spending budget on the variants in the first place.
          '/*?*ref=',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
