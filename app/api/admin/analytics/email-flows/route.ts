import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isPaidAdsScoped } from '@/lib/analytics/paid-scope';
import { canViewAnalytics, type UserRole } from '@/lib/permissions';
import { ADMIN_VIEW_PARAM, previewedRole } from '@/lib/admin/admin-view';
import { isMissingColumnError } from '@/lib/payments/puramass-columns';
import {
  buildEmailFlowReport,
  EMPTY_EMAIL_FLOW_ANALYTICS,
  type EmailFlowAnalytics,
  type OrderInput,
} from '@/lib/analytics/email-flow-report';

export const revalidate = 30;

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** The same "paid" the earnings split counts — see ../attribution/route.ts. */
const PAID_ORDER_STATUSES = ['confirmed', 'processing', 'shipped', 'delivered', 'paid'];
const MAX_ROWS = 100_000;

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

/** The touch fields emailFlowTouchOf reads, without shipping whole JSONB snapshots. */
const ORDER_TOUCH =
  'attribution_channel, ef:attribution->email_flow, ' +
  'last_source:attribution->last->>source, last_medium:attribution->last->>medium, last_campaign:attribution->last->>campaign, ' +
  'first_source:attribution->first->>source, first_medium:attribution->first->>medium, first_campaign:attribution->first->>campaign';

function touchOf(r: any): unknown {
  return {
    email_flow: r.ef ?? null,
    last: { source: r.last_source, medium: r.last_medium, campaign: r.last_campaign },
    first: { source: r.first_source, medium: r.first_medium, campaign: r.first_campaign },
  };
}

/**
 * GET /api/admin/analytics/email-flows?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Whether the welcome and cart flows are producing anything: engagement on the
 * emails sent in the range (net of mail-scanner clicks), checkouts and
 * conversions they led to — split by whether the buyer clicked — and the paid
 * orders that came through a flow email, by the earnings bucket they are
 * credited to. Built by lib/analytics/email-flow-report.ts.
 *
 * Admin and assistant only: the paid-ads-scoped analytics role reads no
 * organic figures, and this is the organic side of the store.
 */
export async function GET(req: NextRequest) {
  const realRole = await readerRole(req);
  if (!realRole || !canViewAnalytics(realRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const role = previewedRole(realRole, req.nextUrl.searchParams.get(ADMIN_VIEW_PARAM));
  if (isPaidAdsScoped(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

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

  const sendsQ = inRange(
    db
      .from('email_flow_sends')
      .select('id, flow, step, opened_at, clicked_at')
      .eq('status', 'sent')
      .limit(MAX_ROWS),
    'sent_at',
  );
  // From the range start with no upper bound: a click on an email sent in the
  // range still counts when it lands after it. Checkouts are bounded below.
  let eventsQ: any = db
    .from('email_flow_events')
    .select('send_id, flow, step, kind, machine, link_kind, order_ref, created_at')
    .in('kind', ['open', 'click', 'checkout'])
    .limit(MAX_ROWS * 2);
  if (from) eventsQ = eventsQ.gte('created_at', from);

  const conversionsQ = (cols: string) =>
    inRange(
      db.from('email_flow_entries').select(cols).eq('status', 'converted').limit(MAX_ROWS),
      'converted_at',
    );

  const [sendsRes, eventsRes, convRes, storeRes, hostedRes] = await Promise.all([
    sendsQ,
    eventsQ,
    conversionsQ('flow, attributed_step, converted_via, converted_amount, converted_currency'),
    inRange(
      db.from('orders').select(`${ORDER_TOUCH}, total`).in('status', PAID_ORDER_STATUSES).limit(MAX_ROWS),
      'created_at',
    ),
    inRange(
      db.from('puramass_orders').select(`${ORDER_TOUCH}, subtotal_cents, currency`).eq('status', 'paid').limit(MAX_ROWS),
      'created_at',
    ),
  ]);

  if (sendsRes.error) {
    return NextResponse.json(EMPTY_EMAIL_FLOW_ANALYTICS(range) satisfies EmailFlowAnalytics);
  }

  // converted_via arrives with email-flows-tracking-migration.sql.
  let conversions = convRes.data ?? [];
  let conversionSplit = !convRes.error;
  if (convRes.error && isMissingColumnError(convRes.error)) {
    const retry = await conversionsQ('flow, attributed_step, converted_amount, converted_currency');
    conversions = (retry.data ?? []).map((r: any) => ({ ...r, converted_via: null }));
    conversionSplit = false;
  }

  const tracking = !eventsRes.error;
  const events = ((eventsRes.data ?? []) as any[]).filter(
    (e) => e.kind !== 'checkout' || !toUpper || e.created_at < toUpper,
  );

  const orders: OrderInput[] = [
    ...((storeRes.data ?? []) as any[]).map((o) => ({
      kind: 'store' as const,
      attribution_channel: o.attribution_channel ?? null,
      attribution: touchOf(o),
      amount: Number(o.total ?? 0),
      currency: 'CAD',
    })),
    ...((hostedRes.data ?? []) as any[]).map((h) => ({
      kind: 'hosted' as const,
      attribution_channel: h.attribution_channel ?? null,
      attribution: touchOf(h),
      amount: Number(h.subtotal_cents ?? 0) / 100,
      currency: String(h.currency || 'usd').toUpperCase(),
    })),
  ];

  return NextResponse.json(
    buildEmailFlowReport({
      range,
      tracking,
      conversionSplit,
      sends: (sendsRes.data ?? []) as any[],
      events,
      conversions: conversions as any[],
      orders,
    }) satisfies EmailFlowAnalytics,
  );
}
