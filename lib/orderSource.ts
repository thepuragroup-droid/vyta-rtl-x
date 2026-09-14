/**
 * Order "source" presentation helpers — maps the `orders.source` value to a
 * human label and a badge class. Tolerant of unknown/empty values.
 */

export type OrderSource =
  | 'storefront'
  | 'manual'
  | 'affiliate'
  | 'import'
  | 'stealth_health'
  | string
  | null
  | undefined;

const LABELS: Record<string, string> = {
  storefront: 'Storefront',
  manual: 'Manual',
  affiliate: 'Affiliate',
  import: 'Imported',
  stealth_health: 'Stealth Health',
};

const BADGES: Record<string, string> = {
  storefront: 'bg-blue-500/10 text-blue-700',
  manual: 'bg-teal/10 text-teal-dark',
  affiliate: 'bg-emerald-500/10 text-emerald-700',
  import: 'bg-purple-500/10 text-purple-700',
  stealth_health: 'bg-indigo-500/10 text-indigo-700',
};

export function sourceLabel(source: OrderSource): string {
  if (!source) return 'Storefront';
  return LABELS[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

export function sourceBadgeClasses(source: OrderSource): string {
  if (!source) return BADGES.storefront;
  return BADGES[source] ?? 'bg-gray-500/10 text-gray-700';
}
