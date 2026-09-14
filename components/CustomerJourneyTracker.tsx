'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { trackActivity } from '@/lib/customer/activity';

/**
 * Records which storefront pages a visitor sees, so the admin customer page can
 * show their journey rather than just the three events (search / product view /
 * cart add) that were tracked before.
 *
 * Renders nothing. Anonymous visitors are recorded too, against the visitor
 * cookie rather than a customer id, and those rows are adopted by the account
 * they later create — so the pages someone browsed before registering are
 * still there to see afterwards. Whether an anonymous visitor is stored at all
 * is the API's call, gated on the consent banner.
 *
 * Two guards keep the log readable rather than exhaustive:
 *   • the same path is not recorded twice in a row (React re-renders and
 *     replace-state navigations would otherwise duplicate it), and
 *   • admin / warehouse paths are dropped — server-side too, since the API is
 *     the real boundary.
 */
export default function CustomerJourneyTracker() {
  const pathname = usePathname();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || pathname === lastPath.current) return;
    // Only the first page of a visit has a meaningful referrer; after that the
    // referrer is just the previous page, which the log already holds.
    const isEntry = lastPath.current === null;
    lastPath.current = pathname;

    trackActivity({
      type: 'page',
      pagePath: pathname,
      pageTitle: typeof document !== 'undefined' ? document.title : null,
      referrer: isEntry && typeof document !== 'undefined' ? document.referrer || null : null,
    });
  }, [pathname]);

  return null;
}
