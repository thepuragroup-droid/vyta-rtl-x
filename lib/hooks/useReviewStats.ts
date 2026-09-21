'use client';

import { useEffect, useState } from 'react';
import type { ReviewStats } from '@/lib/reviews';

/**
 * Star ratings for a grid of product cards, in one request.
 *
 * A card cannot fetch its own rollup — eight cards would be eight round trips
 * before anything renders — so the grid asks for every id at once and each
 * card reads its own row out of the map. Products with no reviews are simply
 * absent from it, which is what makes `RatingSummary` render nothing.
 *
 * Never throws: an empty map is a grid without stars, not a broken page.
 */
export function useReviewStats(productIds: string[]): Record<string, ReviewStats> {
  const [stats, setStats] = useState<Record<string, ReviewStats>>({});

  // The ids are rebuilt on every render of the caller, so the effect keys off
  // their joined value rather than the array identity.
  const key = productIds.join(',');

  useEffect(() => {
    if (!key) return;
    let alive = true;

    (async () => {
      try {
        const res = await fetch(`/api/reviews?ids=${encodeURIComponent(key)}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        const rows: ReviewStats[] = Array.isArray(data?.stats) ? data.stats : [];
        if (!alive) return;
        setStats(Object.fromEntries(rows.map((row) => [row.product_id, row])));
      } catch {
        /* no stars this render */
      }
    })();

    return () => {
      alive = false;
    };
  }, [key]);

  return stats;
}
