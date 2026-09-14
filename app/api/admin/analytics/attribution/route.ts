import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { CHANNELS, isPaidChannel, type Channel } from '@/lib/analytics/attribution';
import {
  isPaidAdsScoped,
  scopeToPaidAds,
  PAID_ADS_SCOPE_NOTE,
} from '@/lib/analytics/paid-scope';
import { canViewAnalytics, type UserRole } from '@/lib/permissions';
import { ADMIN_VIEW_PARAM, previewedRole } from '@/lib/admin/admin-view';

export const revalidate = 30;

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Same lifecycle buckets the traffic funnel uses — a "paid" order is one whose
// payment fully confirmed or later.
const PAID_ORDER_STATUSES = ['confirmed', 'processing', 'shipped', 'delivered', 'paid'];

const MAX_ROWS = 100_000;
const TOP_CAMPAIGNS = 12;

/** Exclusive upper bound at the next UTC midnight, so `to` includes its whole day. */
function endOfDayExclusiveISO(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? +((numerator / denominator) * 100).toFixed(1) : 0;
}

async function readerRole(req: NextRequest): Promise<UserRole | null> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return null;
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  return (data?.role as UserRole | undefined) ?? null;
}

export interface ChannelRow {
  channel: string;
  paid: boolean;             // does this channel cost money
  visitors: number;          // distinct visitors first seen in range
  signups: number;           // visitors who created an account
  checkouts: number;         // visitors who reached a checkout
  purchasers: number;        // visitors whose payment confirmed
  orders: number;            // storefront orders attributed to this channel
  paid_orders: number;
  order_revenue: number;     // CAD, native storefront orders
  hosted_orders: number;     // PuraMass hand-offs
  hosted_paid: number;
  hosted_revenue: number;    // USD, hosted checkout
  rates: {
    signup: number;          // signups / visitors (%)
    checkout: number;        // checkouts / visitors (%)
    purchase: number;        // purchasers / visitors (%)
  };
}

/**
 * Which earnings bucket a channel belongs to.
 *
 * The distinction that matters operationally is "did we pay for this sale?" —
 * paid ads have a budget behind them, affiliates have a commission, and the
 * rest is earned. `unattributed` is its own bucket rather than being folded
 * into direct, because "we don't know" and "they came straight to us" are very
 * different facts and merging them flatters the direct number.
 */
export type EarningsGroupKey = 'paid' | 'affiliate' | 'organic' | 'direct' | 'unattributed';

export interface EarningsGroup {
  key: EarningsGroupKey;
  label: string;
  /** The channels rolled up here, for the tooltip / drill-down. */
  channels: string[];
  paid_orders: number;       // native paid + hosted paid
  order_revenue: number;     // CAD, native storefront
  hosted_revenue: number;    // USD, hosted checkout
  aov_cad: number;
  aov_usd: number;
  /** Share of all paid orders in range, attributed or not (%). */
  order_share: number;
}

export interface AttributionSummary {
  range: { from: string | null; to: string | null };
  /** False until marketing-attribution-migration.sql has been run. */
  available: boolean;
  /**
   * `paid_ads` when the reader only sees sales won by a paid ad — the
   * analytics/marketing role. Everything below is then a paid-ads-only
   * figure, and `notes` says so. `all` is the whole business.
   */
  scope: 'paid_ads' | 'all';
  /** Caveats worth showing next to the figures (currently the scope note). */
  notes: string[];
  channels: ChannelRow[];
  totals: Omit<ChannelRow, 'channel' | 'paid' | 'rates'> & { rates: ChannelRow['rates'] };
  /**
   * Earnings split by how the sale was won. Always covers every paid order in
   * the range — the groups sum to `earnings_total`, unattributed included — so
   * the split can be read as a whole rather than a sample.
   */
  earnings: EarningsGroup[];
  earnings_total: {
    paid_orders: number;
    order_revenue: number;   // CAD
    hosted_revenue: number;  // USD
  };
  /** Orders in range carrying no channel — pre-feature, or cookies blocked. */
  unattributed_orders: number;
  /** Their revenue, so the earnings split accounts for every dollar. */
  unattributed_revenue: { order_revenue: number; hosted_revenue: number };
  campaigns: Array<{
    channel: string;
    campaign: string;
    visitors: number;
    purchasers: number;
    revenue: number;         // native + hosted, unconverted; see note below
  }>;
  truncated: boolean;
}

function emptyRow(channel: string): ChannelRow {
  return {
    channel,
    paid: isPaidChannel(channel),
    visitors: 0,
    signups: 0,
    checkouts: 0,
    purchasers: 0,
    orders: 0,
    paid_orders: 0,
    order_revenue: 0,
    hosted_orders: 0,
    hosted_paid: 0,
    hosted_revenue: 0,
    rates: { signup: 0, checkout: 0, purchase: 0 },
  };
}

/**
 * GET /api/admin/analytics/attribution?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Acquisition by channel: how many visitors each source brought, how far down
 * the funnel they got, and what they spent. This is the report the site could
 * not produce before — GA4 knows the campaign side and the database knows the
 * revenue side, and nothing joined the two.
 *
 * Three scans, joined in memory on the channel name:
 *
 *   visitor_attribution  the funnel — visitors, signups, checkouts, purchases,
 *                        counted against their FIRST touch, so the campaign
 *                        that won someone keeps the credit for what they do
 *                        later.
 *   orders               native storefront revenue, by the channel frozen onto
 *                        the order when it was placed.
 *   puramass_orders      hosted-checkout revenue, likewise.
 *
 * Note on currency: native orders are CAD and hosted orders are usually USD,
 * so they are reported as separate columns and never summed. The `campaigns`
 * breakdown adds them for ranking only — treat that figure as an ordering key,
 * not a number to quote.
 *
 * Scope: admin and assistant see every channel. The analytics/marketing role
 * sees only the paid ones — all three scans are filtered to PAID_CHANNELS, so
 * its `channels` list, `earnings` split and `totals` are paid-ads figures and
 * `unattributed` is necessarily zero. `scope` says which of the two it is.
 */
export async function GET(req: NextRequest) {
  const realRole = await readerRole(req);
  if (!realRole || !canViewAnalytics(realRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // An admin previewing the analytics staff view asks for it with ?view=. It can
  // only ever NARROW what this reader is entitled to (lib/admin/admin-view.ts),
  // so every scope decision below reads the previewed role rather than the
  // account's — the preview is scoped here, at the database, not in the browser.
  const role = previewedRole(realRole, req.nextUrl.searchParams.get(ADMIN_VIEW_PARAM));
  // The analytics/marketing role reads only the sales its ads produced, so the
  // three scans below are filtered to the paid channels at the database and the
  // other buckets never reach the response. See lib/analytics/paid-scope.ts.
  const paidOnly = isPaidAdsScoped(role);
  const scope: 'paid_ads' | 'all' = paidOnly ? 'paid_ads' : 'all';
  const notes = paidOnly ? [PAID_ADS_SCOPE_NOTE] : [];

  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');
  const toUpper = to ? endOfDayExclusiveISO(to) : null;
  const range = { from, to };

  const inRange = (q: any, column: string) => {
    let out = q;
    if (from) out = out.gte(column, from);
    if (toUpper) out = out.lt(column, toUpper);
    return out;
  };

  const [visitorsRes, ordersRes, hostedRes] = await Promise.all([
    scopeToPaidAds(
      inRange(
        db
          .from('visitor_attribution')
          .select('first_channel, first_campaign, signed_up_at, checkout_at, purchased_at')
          .limit(MAX_ROWS),
        'first_seen_at',
      ),
      paidOnly,
      'first_channel',
    ),
    scopeToPaidAds(
      inRange(
        db
          .from('orders')
          .select('attribution_channel, attribution_campaign, status, total')
          .limit(MAX_ROWS),
        'created_at',
      ),
      paidOnly,
    ),
    scopeToPaidAds(
      inRange(
        db
          .from('puramass_orders')
          .select('attribution_channel, attribution_campaign, status, subtotal_cents')
          .limit(MAX_ROWS),
        'created_at',
      ),
      paidOnly,
    ),
  ]);

  // The visitor table is the one this feature introduces. If it isn't there,
  // the migration hasn't run — say so plainly rather than rendering zeroes
  // that look like "nobody visited".
  if (visitorsRes.error) {
    return NextResponse.json({
      range,
      available: false,
      scope,
      notes,
      channels: [],
      totals: { ...emptyRow('total') },
      earnings: [],
      earnings_total: { paid_orders: 0, order_revenue: 0, hosted_revenue: 0 },
      unattributed_orders: 0,
      unattributed_revenue: { order_revenue: 0, hosted_revenue: 0 },
      campaigns: [],
      truncated: false,
    } satisfies AttributionSummary);
  }

  const rows = new Map<string, ChannelRow>();
  const row = (channel: string | null | undefined): ChannelRow => {
    const key = channel && CHANNELS.includes(channel as Channel) ? channel : channel || 'direct';
    let existing = rows.get(key);
    if (!existing) {
      existing = emptyRow(key);
      rows.set(key, existing);
    }
    return existing;
  };

  // Campaign detail, keyed channel + campaign so the same campaign name under
  // two networks doesn't merge.
  const campaigns = new Map<
    string,
    { channel: string; campaign: string; visitors: number; purchasers: number; revenue: number }
  >();
  const campaign = (channel: string, name: string | null | undefined) => {
    if (!name) return null;
    const key = `${channel}::${name}`;
    let existing = campaigns.get(key);
    if (!existing) {
      existing = { channel, campaign: name, visitors: 0, purchasers: 0, revenue: 0 };
      campaigns.set(key, existing);
    }
    return existing;
  };

  // ---- 1. Funnel, from the visitor rows ----
  const visitorRows = visitorsRes.data ?? [];
  for (const v of visitorRows as any[]) {
    const channel = v.first_channel ?? 'direct';
    const bucket = row(channel);
    bucket.visitors += 1;
    if (v.signed_up_at) bucket.signups += 1;
    if (v.checkout_at) bucket.checkouts += 1;
    if (v.purchased_at) bucket.purchasers += 1;

    const c = campaign(channel, v.first_campaign);
    if (c) {
      c.visitors += 1;
      if (v.purchased_at) c.purchasers += 1;
    }
  }

  // ---- 2. Native storefront revenue ----
  // Orders with no channel are counted separately rather than dropped, so the
  // earnings split below adds up to every dollar taken in the range.
  let unattributedOrders = 0;
  let unattributedPaidOrders = 0;
  let unattributedOrderRevenue = 0;
  let unattributedHostedRevenue = 0;
  for (const o of (ordersRes.data ?? []) as any[]) {
    if (!o.attribution_channel) {
      unattributedOrders += 1;
      if (PAID_ORDER_STATUSES.includes(o.status)) {
        unattributedPaidOrders += 1;
        unattributedOrderRevenue += Number(o.total ?? 0);
      }
      continue;
    }
    const bucket = row(o.attribution_channel);
    bucket.orders += 1;
    if (PAID_ORDER_STATUSES.includes(o.status)) {
      bucket.paid_orders += 1;
      bucket.order_revenue += Number(o.total ?? 0);
      const c = campaign(o.attribution_channel, o.attribution_campaign);
      if (c) c.revenue += Number(o.total ?? 0);
    }
  }

  // ---- 3. Hosted-checkout revenue ----
  for (const h of (hostedRes.data ?? []) as any[]) {
    if (!h.attribution_channel) {
      if (h.status === 'paid') {
        unattributedOrders += 1;
        unattributedPaidOrders += 1;
        unattributedHostedRevenue += Number(h.subtotal_cents ?? 0) / 100;
      }
      continue;
    }
    const bucket = row(h.attribution_channel);
    bucket.hosted_orders += 1;
    if (h.status === 'paid') {
      bucket.hosted_paid += 1;
      const amount = Number(h.subtotal_cents ?? 0) / 100;
      bucket.hosted_revenue += amount;
      const c = campaign(h.attribution_channel, h.attribution_campaign);
      if (c) c.revenue += amount;
    }
  }

  const channels = [...rows.values()]
    .map((r) => ({
      ...r,
      order_revenue: +r.order_revenue.toFixed(2),
      hosted_revenue: +r.hosted_revenue.toFixed(2),
      rates: {
        signup: pct(r.signups, r.visitors),
        checkout: pct(r.checkouts, r.visitors),
        purchase: pct(r.purchasers, r.visitors),
      },
    }))
    // Paid channels first — they are the ones with a budget attached — then by
    // the volume they brought.
    .sort((a, b) => Number(b.paid) - Number(a.paid) || b.visitors - a.visitors);

  const totals = channels.reduce(
    (acc, r) => ({
      visitors: acc.visitors + r.visitors,
      signups: acc.signups + r.signups,
      checkouts: acc.checkouts + r.checkouts,
      purchasers: acc.purchasers + r.purchasers,
      orders: acc.orders + r.orders,
      paid_orders: acc.paid_orders + r.paid_orders,
      order_revenue: acc.order_revenue + r.order_revenue,
      hosted_orders: acc.hosted_orders + r.hosted_orders,
      hosted_paid: acc.hosted_paid + r.hosted_paid,
      hosted_revenue: acc.hosted_revenue + r.hosted_revenue,
    }),
    {
      visitors: 0, signups: 0, checkouts: 0, purchasers: 0, orders: 0,
      paid_orders: 0, order_revenue: 0, hosted_orders: 0, hosted_paid: 0, hosted_revenue: 0,
    },
  );

  // ---- 4. Earnings, grouped by how the sale was won ----
  const earnings = buildEarnings(channels, {
    paid_orders: unattributedPaidOrders,
    order_revenue: unattributedOrderRevenue,
    hosted_revenue: unattributedHostedRevenue,
  });
  const earningsTotal = earnings.reduce(
    (acc, g) => ({
      paid_orders: acc.paid_orders + g.paid_orders,
      order_revenue: acc.order_revenue + g.order_revenue,
      hosted_revenue: acc.hosted_revenue + g.hosted_revenue,
    }),
    { paid_orders: 0, order_revenue: 0, hosted_revenue: 0 },
  );

  return NextResponse.json({
    range,
    available: true,
    scope,
    notes,
    channels,
    earnings,
    earnings_total: {
      paid_orders: earningsTotal.paid_orders,
      order_revenue: +earningsTotal.order_revenue.toFixed(2),
      hosted_revenue: +earningsTotal.hosted_revenue.toFixed(2),
    },
    unattributed_revenue: {
      order_revenue: +unattributedOrderRevenue.toFixed(2),
      hosted_revenue: +unattributedHostedRevenue.toFixed(2),
    },
    totals: {
      ...totals,
      order_revenue: +totals.order_revenue.toFixed(2),
      hosted_revenue: +totals.hosted_revenue.toFixed(2),
      rates: {
        signup: pct(totals.signups, totals.visitors),
        checkout: pct(totals.checkouts, totals.visitors),
        purchase: pct(totals.purchasers, totals.visitors),
      },
    },
    unattributed_orders: unattributedOrders,
    campaigns: [...campaigns.values()]
      .map((c) => ({ ...c, revenue: +c.revenue.toFixed(2) }))
      .sort((a, b) => b.purchasers - a.purchasers || b.visitors - a.visitors)
      .slice(0, TOP_CAMPAIGNS),
    truncated: visitorRows.length >= MAX_ROWS,
  } satisfies AttributionSummary);
}

/**
 * Roll the per-channel rows up into earnings buckets.
 *
 * The question this answers is "how much of what we took did we pay to get?" —
 * so the split is by cost of acquisition, not by platform. Paid ads carry a
 * budget, affiliates carry a commission, and the rest is earned.
 *
 * Empty groups are dropped so a store running no ads doesn't show four zero
 * rows, but `unattributed` is kept whenever it has anything in it: a large
 * unknown bucket is the signal that the split cannot be trusted yet, and
 * hiding it would make the report look more complete than it is.
 */
function buildEarnings(
  channels: ChannelRow[],
  unattributed: { paid_orders: number; order_revenue: number; hosted_revenue: number },
): EarningsGroup[] {
  const GROUPS: Array<{ key: EarningsGroupKey; label: string; match: (c: ChannelRow) => boolean }> = [
    { key: 'paid', label: 'Paid ads', match: (c) => c.paid },
    { key: 'affiliate', label: 'Affiliate', match: (c) => c.channel === 'affiliate' },
    {
      key: 'organic',
      label: 'Organic & referral',
      match: (c) => !c.paid && c.channel !== 'affiliate' && c.channel !== 'direct',
    },
    { key: 'direct', label: 'Direct', match: (c) => c.channel === 'direct' },
  ];

  const groups = GROUPS.map((g) => {
    const members = channels.filter(g.match);
    // AOV is kept per currency, and each divides by the orders that actually
    // billed in it — dividing CAD revenue by every order would understate it
    // for a store whose hosted sales are all USD.
    const cadOrders = members.reduce((n, m) => n + m.paid_orders, 0);
    const usdOrders = members.reduce((n, m) => n + m.hosted_paid, 0);
    const orderRevenue = members.reduce((n, m) => n + m.order_revenue, 0);
    const hostedRevenue = members.reduce((n, m) => n + m.hosted_revenue, 0);
    return {
      key: g.key,
      label: g.label,
      channels: members.map((m) => m.channel),
      paid_orders: cadOrders + usdOrders,
      order_revenue: +orderRevenue.toFixed(2),
      hosted_revenue: +hostedRevenue.toFixed(2),
      aov_cad: cadOrders > 0 ? +(orderRevenue / cadOrders).toFixed(2) : 0,
      aov_usd: usdOrders > 0 ? +(hostedRevenue / usdOrders).toFixed(2) : 0,
      order_share: 0,
    };
  });

  if (unattributed.paid_orders > 0) {
    // Unattributed orders are not split by currency the way the channel rows
    // are, so AOV is left off rather than guessed at.
    groups.push({
      key: 'unattributed',
      label: 'Unattributed',
      channels: [],
      paid_orders: unattributed.paid_orders,
      order_revenue: +unattributed.order_revenue.toFixed(2),
      hosted_revenue: +unattributed.hosted_revenue.toFixed(2),
      aov_cad: 0,
      aov_usd: 0,
      order_share: 0,
    });
  }

  const totalOrders = groups.reduce((n, g) => n + g.paid_orders, 0);

  return groups
    .filter((g) => g.paid_orders > 0 || g.order_revenue > 0 || g.hosted_revenue > 0)
    .map((g) => ({ ...g, order_share: pct(g.paid_orders, totalOrders) }))
    .sort((a, b) => b.paid_orders - a.paid_orders);
}
