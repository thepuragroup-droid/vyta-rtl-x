import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { PAID_CHANNELS } from '@/lib/analytics/attribution';
import {
  earningsGroupOf,
  explainOrderSource,
  isEarningsGroupKey,
  type EarningsGroupKey,
  type OrderSourceExplanation,
} from '@/lib/analytics/order-source';
import { isPaidAdsScoped } from '@/lib/analytics/paid-scope';
import { canViewAnalytics, type UserRole } from '@/lib/permissions';
import { ADMIN_VIEW_PARAM, previewedRole } from '@/lib/admin/admin-view';

export const revalidate = 30;

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// The same "paid" definitions the earnings split counts with — see the
// summary route next door. A list that disagreed with the percentage it sits
// under would be worse than no list.
const PAID_ORDER_STATUSES = ['confirmed', 'processing', 'shipped', 'delivered', 'paid'];
const HOSTED_PAID_STATUS = 'paid';

/** Per kind. The list is for reading, not exporting; the total is still exact. */
const LIST_LIMIT = 500;
const ID_CHUNK = 200;

const NON_ORGANIC = [...PAID_CHANNELS, 'affiliate', 'direct'];

function endOfDayExclusiveISO(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

async function readerRole(req: NextRequest): Promise<UserRole | null> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return null;
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  return (data?.role as UserRole | undefined) ?? null;
}

export interface SourceOrderRow extends OrderSourceExplanation {
  id: string;
  kind: 'store' | 'hosted';
  /** Order number for store orders, partner reference for hosted ones. */
  reference: string;
  /** Null for the paid-ads-scoped reader, who is not shown buyers. */
  email: string | null;
  amount: number;
  currency: 'CAD' | 'USD' | string;
  created_at: string;
  /** Where the order opens in the admin. */
  href: string;
}

export interface SourceOrdersResponse {
  group: EarningsGroupKey;
  range: { from: string | null; to: string | null };
  available: boolean;
  orders: SourceOrderRow[];
  /** Paid orders in the bucket, before the list cap. Matches the split's count. */
  total: number;
  truncated: boolean;
  /** Unattributed only: how many orders have at least one hint. */
  hinted: number;
}

/**
 * Narrow a query to one earnings bucket at the database. The rows are checked
 * again in memory with `earningsGroupOf`, so this is an optimisation — the
 * shared rule is what decides membership.
 */
function filterToGroup(q: any, group: EarningsGroupKey): any {
  const col = 'attribution_channel';
  switch (group) {
    case 'paid':
      return q.in(col, [...PAID_CHANNELS]);
    case 'affiliate':
      return q.eq(col, 'affiliate');
    case 'direct':
      return q.eq(col, 'direct');
    case 'unattributed':
      return q.is(col, null);
    case 'organic':
      return q.not(col, 'is', null).not(col, 'in', `(${NON_ORGANIC.join(',')})`);
  }
}

function chunks<T>(items: T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * GET /api/admin/analytics/attribution/orders?group=paid&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * The orders behind one slice of the "Earnings by source" split, each with the
 * reason it landed there: the click ID, UTM tags or referrer recorded on its
 * first touch. For the Unattributed slice it also looks for a likely answer —
 * a referral code on the order, the channel the buyer's account was won by, or
 * a tracked visitor with the buyer's email — and returns those as hints.
 *
 * Same access rules as the summary: admin and assistant may open any bucket;
 * the paid-ads-scoped analytics role may open only `paid`, and is not shown
 * buyer emails.
 */
export async function GET(req: NextRequest) {
  const realRole = await readerRole(req);
  if (!realRole || !canViewAnalytics(realRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const role = previewedRole(realRole, req.nextUrl.searchParams.get(ADMIN_VIEW_PARAM));
  const paidOnly = isPaidAdsScoped(role);

  const groupParam = req.nextUrl.searchParams.get('group');
  if (!isEarningsGroupKey(groupParam)) {
    return NextResponse.json({ error: 'Unknown group' }, { status: 400 });
  }
  const group = groupParam;
  if (paidOnly && group !== 'paid') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');
  const toUpper = to ? endOfDayExclusiveISO(to) : null;
  const range = { from, to };

  const inRange = (q: any) => {
    let out = q;
    if (from) out = out.gte('created_at', from);
    if (toUpper) out = out.lt('created_at', toUpper);
    return out;
  };

  const [storeRes, hostedRes] = await Promise.all([
    filterToGroup(
      inRange(
        db
          .from('orders')
          .select(
            'id, order_number, email, customer_id, total, status, created_at, referral_code, attribution_channel, attribution_campaign, attribution',
            { count: 'exact' },
          )
          .in('status', PAID_ORDER_STATUSES),
      ),
      group,
    )
      .order('created_at', { ascending: false })
      .limit(LIST_LIMIT),
    filterToGroup(
      inRange(
        db
          .from('puramass_orders')
          .select(
            'id, partner_reference, customer_email, customer_id, subtotal_cents, currency, status, created_at, referral_code, attribution_channel, attribution_campaign, attribution',
            { count: 'exact' },
          )
          .eq('status', HOSTED_PAID_STATUS),
      ),
      group,
    )
      .order('created_at', { ascending: false })
      .limit(LIST_LIMIT),
  ]);

  // The attribution columns arrive with marketing-attribution-migration.sql.
  if (storeRes.error && hostedRes.error) {
    return NextResponse.json({
      group,
      range,
      available: false,
      orders: [],
      total: 0,
      truncated: false,
      hinted: 0,
    } satisfies SourceOrdersResponse);
  }

  const store = ((storeRes.data ?? []) as any[]).filter(
    (o) => earningsGroupOf(o.attribution_channel) === group,
  );
  const hosted = ((hostedRes.data ?? []) as any[]).filter(
    (h) => earningsGroupOf(h.attribution_channel) === group,
  );

  // ---- Unattributed: gather the facts the hints are built from ----
  const customerChannel = new Map<string, string>();
  const visitorChannel = new Map<string, string>();
  let storeStartedAt: string | null = null;
  let hostedStartedAt: string | null = null;

  if (group === 'unattributed') {
    const customerIds = [
      ...new Set([...store, ...hosted].map((o) => o.customer_id).filter(Boolean).map(String)),
    ];
    const emails = [
      ...new Set(
        [...store.map((o) => o.email), ...hosted.map((h) => h.customer_email)]
          .filter(Boolean)
          .map((e: string) => e.trim().toLowerCase()),
      ),
    ];

    const [firstStore, firstHosted, customerRows, visitorRows] = await Promise.all([
      db
        .from('orders')
        .select('created_at')
        .not('attribution_channel', 'is', null)
        .order('created_at', { ascending: true })
        .limit(1),
      db
        .from('puramass_orders')
        .select('created_at')
        .not('attribution_channel', 'is', null)
        .order('created_at', { ascending: true })
        .limit(1),
      Promise.all(
        chunks(customerIds).map((ids) =>
          db
            .from('customers')
            .select('id, attribution_channel')
            .in('id', ids)
            .not('attribution_channel', 'is', null),
        ),
      ),
      Promise.all(
        chunks(emails).map((list) =>
          db
            .from('visitor_attribution')
            .select('customer_email, first_channel, first_seen_at')
            .in('customer_email', list)
            .not('first_channel', 'is', null)
            .order('first_seen_at', { ascending: true }),
        ),
      ),
    ]);

    storeStartedAt = (firstStore.data?.[0]?.created_at as string | undefined) ?? null;
    hostedStartedAt = (firstHosted.data?.[0]?.created_at as string | undefined) ?? null;
    for (const res of customerRows) {
      for (const c of (res.data ?? []) as any[]) {
        if (c.attribution_channel) customerChannel.set(String(c.id), c.attribution_channel);
      }
    }
    // Rows arrive earliest-first, so the first one per email is the visit that
    // originally won them — the same rule attributeEmailPurchase uses.
    for (const res of visitorRows) {
      for (const v of (res.data ?? []) as any[]) {
        const key = String(v.customer_email ?? '').toLowerCase();
        if (key && !visitorChannel.has(key) && v.first_channel) visitorChannel.set(key, v.first_channel);
      }
    }
  }

  const ctxFor = (customerId: unknown, email: unknown, kind: 'store' | 'hosted') => ({
    customerChannel: customerId ? customerChannel.get(String(customerId)) ?? null : null,
    visitorChannel: email ? visitorChannel.get(String(email).trim().toLowerCase()) ?? null : null,
    attributionStartedAt: kind === 'store' ? storeStartedAt : hostedStartedAt,
  });

  const rows: SourceOrderRow[] = [
    ...store.map((o): SourceOrderRow => ({
      id: String(o.id),
      kind: 'store',
      reference: o.order_number ?? String(o.id).slice(0, 8),
      email: paidOnly ? null : o.email ?? null,
      amount: +Number(o.total ?? 0).toFixed(2),
      currency: 'CAD',
      created_at: o.created_at,
      href: `/admin/orders/${o.id}`,
      ...explainOrderSource(
        {
          kind: 'store',
          attribution_channel: o.attribution_channel ?? null,
          attribution_campaign: o.attribution_campaign ?? null,
          attribution: o.attribution ?? null,
          referral_code: o.referral_code ?? null,
          created_at: o.created_at ?? null,
        },
        ctxFor(o.customer_id, o.email, 'store'),
      ),
    })),
    ...hosted.map((h): SourceOrderRow => ({
      id: String(h.id),
      kind: 'hosted',
      reference: h.partner_reference ?? String(h.id).slice(0, 8),
      email: paidOnly ? null : h.customer_email ?? null,
      amount: +(Number(h.subtotal_cents ?? 0) / 100).toFixed(2),
      currency: String(h.currency || 'usd').toUpperCase(),
      created_at: h.created_at,
      href: '/admin/stealth-health?tab=orders',
      ...explainOrderSource(
        {
          kind: 'hosted',
          attribution_channel: h.attribution_channel ?? null,
          attribution_campaign: h.attribution_campaign ?? null,
          attribution: h.attribution ?? null,
          referral_code: h.referral_code ?? null,
          created_at: h.created_at ?? null,
        },
        ctxFor(h.customer_id, h.customer_email, 'hosted'),
      ),
    })),
  ].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

  const total = (storeRes.count ?? store.length) + (hostedRes.count ?? hosted.length);

  return NextResponse.json({
    group,
    range,
    available: true,
    orders: rows,
    total,
    truncated: store.length >= LIST_LIMIT || hosted.length >= LIST_LIMIT,
    hinted: rows.filter((r) => r.hints.length > 0).length,
  } satisfies SourceOrdersResponse);
}
