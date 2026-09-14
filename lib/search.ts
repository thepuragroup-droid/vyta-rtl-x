/**
 * Small weighted-substring ranker used by admin lists (products, customers).
 * Not a full-text search — every field is scored by how well the query
 * matches, and results are sorted best-first. An empty query returns items
 * in their original order.
 */

export type FieldWeight<T> = {
  /** Which string to test. Return null/undefined to skip that field. */
  get: (item: T) => string | null | undefined;
  /** Weight multiplier for the field's score. Larger = more important. */
  weight: number;
};

function scoreOne(haystack: string, needle: string): number {
  if (!haystack) return 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (h === n) return 3;
  if (h.startsWith(n)) return 2;
  if (h.includes(n)) return 1;
  return 0;
}

/**
 * Rank `items` by how well each weighted field matches `query`. Items with
 * a total score of 0 (no field matched) are filtered out. Ties keep their
 * original relative order.
 */
export function rankBySearch<T>(
  items: T[],
  query: string,
  fields: Array<FieldWeight<T>>,
): T[] {
  const q = (query ?? '').trim();
  if (!q) return items;
  const scored = items
    .map((item, idx) => {
      let total = 0;
      for (const f of fields) {
        const v = f.get(item);
        if (v == null) continue;
        total += scoreOne(String(v), q) * f.weight;
      }
      return { item, total, idx };
    })
    .filter((s) => s.total > 0)
    .sort((a, b) => (b.total - a.total) || (a.idx - b.idx));
  return scored.map((s) => s.item);
}
