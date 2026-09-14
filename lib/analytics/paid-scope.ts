/**
 * Paid-ads scoping — what the analytics / marketing role is allowed to see of
 * the money side of the business.
 *
 * The analytics role is an EXTERNAL marketing partner. It reads the analytics
 * surface to judge the campaigns it runs, and it has no business reading sales
 * it did not produce. So every sales figure served to that role — revenue,
 * orders, products sold, locations, buyers, and the traffic those figures are
 * divided by — counts only records attributed to a paid ad channel
 * (`lib/analytics/attribution.ts` PAID_CHANNELS). Organic, referral, affiliate,
 * direct and unattributed sales are filtered out server-side, in the route,
 * before anything is aggregated: the client never receives them.
 *
 * The filter is on the attribution snapshot frozen onto the row when it was
 * created (`orders.attribution_channel`, `puramass_orders.attribution_channel`,
 * `customers.attribution_channel`, `visitor_attribution.first_channel`), so it
 * costs one indexed predicate and cannot drift from what the report shows.
 *
 * It fails CLOSED. If the attribution columns are not migrated yet, nothing can
 * be shown to be paid-ads, so the scoped reader is shown zero rather than
 * everything, plus a note saying why.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { PAID_CHANNELS } from '@/lib/analytics/attribution';
import { isMissingColumnError } from '@/lib/payments/puramass-columns';
import type { UserRole } from '@/lib/permissions';

/** The paid channels, as plain strings for a PostgREST `in` filter. */
export const PAID_CHANNEL_KEYS: string[] = [...PAID_CHANNELS];

/**
 * Is this reader's view of sales data limited to paid-ads-attributed records?
 * Only the analytics/marketing partner role is — admin and assistant read the
 * whole business.
 */
export function isPaidAdsScoped(role: UserRole | null | undefined): boolean {
  return role === 'analytics';
}

/** Shown wherever a scoped figure is rendered, so no total is misread as the whole. */
export const PAID_ADS_SCOPE_NOTE =
  'Paid-ads view: every sales figure counts only orders attributed to a paid ad ' +
  '(Google, Meta, Microsoft, TikTok, LinkedIn, other paid). Organic, referral, ' +
  'affiliate, direct and unattributed sales are excluded.';

/** Shown instead when the attribution columns aren't there to filter on. */
export const PAID_ADS_UNAVAILABLE_NOTE =
  'Attribution is not collecting yet (marketing-attribution-migration.sql has not run), ' +
  'so no sale can be identified as paid-ads and every figure reads as zero.';

/** True when a query failed only because the attribution column isn't migrated. */
export function isMissingAttributionColumn(err: unknown): boolean {
  return isMissingColumnError(err);
}

/**
 * Restrict a query to rows won by a paid ad. `column` is the attribution
 * snapshot on that table — `attribution_channel` everywhere except
 * `visitor_attribution`, which names it `first_channel`.
 */
export function paidChannelFilter<Q>(query: Q, column = 'attribution_channel'): Q {
  return (query as unknown as {
    in: (col: string, values: string[]) => Q;
  }).in(column, PAID_CHANNEL_KEYS);
}

/** Apply `paidChannelFilter` only when the reader is scoped. */
export function scopeToPaidAds<Q>(query: Q, scoped: boolean, column = 'attribution_channel'): Q {
  return scoped ? paidChannelFilter(query, column) : query;
}

// ---- visitors ----

/**
 * The visitors a paid ad won, as the two identities the activity log is keyed
 * on. `customer_activity` has no channel of its own — the channel lives on the
 * visitor row — so scoped traffic is filtered in memory against this set.
 */
export interface PaidVisitorScope {
  /** False when `visitor_attribution` could not be read at all. */
  available: boolean;
  /** True when the visitor table was larger than the cap — traffic is a floor. */
  truncated: boolean;
  anonymousIds: Set<string>;
  customerIds: Set<string>;
}

export const EMPTY_PAID_VISITOR_SCOPE: PaidVisitorScope = {
  available: false,
  truncated: false,
  anonymousIds: new Set(),
  customerIds: new Set(),
};

const VISITOR_LIMIT = 100_000;

/**
 * Every visitor whose FIRST touch was a paid ad, whenever they arrived.
 * Deliberately not restricted to the report's range: someone who clicked an ad
 * in March and came back in April is still a visitor that ad won, and their
 * April activity belongs to it.
 */
export async function loadPaidVisitorScope(
  db: SupabaseClient,
  limit = VISITOR_LIMIT,
): Promise<PaidVisitorScope> {
  const { data, error } = await paidChannelFilter(
    db.from('visitor_attribution').select('anonymous_id, customer_id').limit(limit),
    'first_channel',
  );
  if (error) return EMPTY_PAID_VISITOR_SCOPE;

  const rows = (data ?? []) as Array<{ anonymous_id?: unknown; customer_id?: unknown }>;
  const anonymousIds = new Set<string>();
  const customerIds = new Set<string>();
  for (const r of rows) {
    if (r.anonymous_id) anonymousIds.add(String(r.anonymous_id));
    if (r.customer_id) customerIds.add(String(r.customer_id));
  }
  return {
    available: true,
    truncated: rows.length >= limit,
    anonymousIds,
    customerIds,
  };
}

/** Was this activity row recorded for a visitor a paid ad won? */
export function isPaidVisitorRow(
  scope: PaidVisitorScope,
  row: { customer_id?: unknown; anonymous_id?: unknown },
): boolean {
  if (!scope.available) return false;
  if (row.customer_id && scope.customerIds.has(String(row.customer_id))) return true;
  if (row.anonymous_id && scope.anonymousIds.has(String(row.anonymous_id))) return true;
  return false;
}

// ---- id-keyed tables (invoices, order lines) ----

const ID_CHUNK = 200;
const MAX_ID_CHUNKS = 50;

/**
 * Of these order ids, the ones whose order was won by a paid ad.
 *
 * Used by the surfaces that hold money against an order id rather than
 * carrying the channel themselves — invoices and order line items. Chunked
 * because the ids travel in the query string, and capped so one very large
 * range can't fan out; `complete` is false when the cap was hit, and the
 * caller reports the figure as partial rather than as a total.
 */
export async function filterPaidOrderIds(
  db: SupabaseClient,
  ids: string[],
  table = 'orders',
): Promise<{ ids: Set<string>; complete: boolean }> {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  const out = new Set<string>();
  if (unique.length === 0) return { ids: out, complete: true };

  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += ID_CHUNK) chunks.push(unique.slice(i, i + ID_CHUNK));
  const capped = chunks.slice(0, MAX_ID_CHUNKS);

  for (const chunk of capped) {
    const { data, error } = await paidChannelFilter(
      db.from(table).select('id').in('id', chunk),
    );
    // Fail closed: an unreadable chunk contributes no ids, so unverified
    // revenue is left out rather than let through.
    if (error) continue;
    for (const row of (data ?? []) as Array<{ id?: unknown }>) {
      if (row.id) out.add(String(row.id));
    }
  }

  return { ids: out, complete: capped.length === chunks.length };
}
