import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { PAID_CHANNELS } from '@/lib/analytics/attribution';
import { isPaidAdsScoped } from '@/lib/analytics/paid-scope';
import {
  correctedChannel,
  groupArrivals,
  snapshotTouch,
  visitorTouches,
  type AttributionAudit,
  type ReclassifyResult,
} from '@/lib/analytics/reclassify';
import { canViewAnalytics, type UserRole } from '@/lib/permissions';
import { ADMIN_VIEW_PARAM, previewedRole } from '@/lib/admin/admin-view';

export const dynamic = 'force-dynamic';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const MAX_ROWS = 100_000;
const PAGE = 1000;
const ID_CHUNK = 200;

const VISITOR_COLUMNS =
  'anonymous_id, first_channel, first_source, first_medium, first_referrer, first_click_param, first_ref_code, ' +
  'last_channel, last_source, last_medium, last_referrer, last_click_param';

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

/**
 * GET /api/admin/analytics/attribution/audit?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * What the visitors who are NOT credited to a paid channel actually arrived
 * with — utm source and medium, referring site, click id — grouped, with the
 * paid channel each group belongs in under the current rules. It answers "are
 * my ad clicks being filed as organic?" from the stored facts rather than the
 * channel they were given.
 *
 * Admin and assistant only: it is a view of the unpaid side of the store,
 * which the paid-ads-scoped analytics role does not see.
 */
export async function GET(req: NextRequest) {
  const realRole = await readerRole(req);
  if (!realRole || !canViewAnalytics(realRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (isPaidAdsScoped(previewedRole(realRole, req.nextUrl.searchParams.get(ADMIN_VIEW_PARAM)))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');
  const toUpper = to ? endOfDayExclusiveISO(to) : null;

  let q: any = db
    .from('visitor_attribution')
    .select(VISITOR_COLUMNS)
    .not('first_channel', 'in', `(${PAID_CHANNELS.join(',')})`)
    .limit(MAX_ROWS);
  if (from) q = q.gte('first_seen_at', from);
  if (toUpper) q = q.lt('first_seen_at', toUpper);
  const { data, error } = await q;

  if (error) {
    return NextResponse.json({
      range: { from, to },
      available: false,
      unpaid_visitors: 0,
      misfiled_visitors: 0,
      groups: [],
      truncated: false,
    } satisfies AttributionAudit);
  }

  const rows = (data ?? []) as any[];
  const misfiled = rows.filter((r) => correctedChannel(visitorTouches(r).first)).length;
  return NextResponse.json({
    range: { from, to },
    available: true,
    unpaid_visitors: rows.length,
    misfiled_visitors: misfiled,
    groups: groupArrivals(rows),
    truncated: rows.length >= MAX_ROWS,
  } satisfies AttributionAudit);
}

/** Read a whole table in pages, keyed on its primary key. */
async function scan(table: string, columns: string, key: string, filter: (q: any) => any): Promise<any[]> {
  const out: any[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data, error } = await filter(db.from(table).select(columns)).order(key).range(offset, offset + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

type Move = { key: string; from: string; to: string };

function tally(moves: Move[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of moves) out[m.to] = (out[m.to] ?? 0) + 1;
  return out;
}

/** Apply moves, grouped by (old, new) so a row changed since the scan is left alone. */
async function applyMoves(table: string, key: string, column: string, moves: Move[]): Promise<void> {
  const byPair = new Map<string, Move[]>();
  for (const m of moves) {
    const pair = `${m.from}>${m.to}`;
    if (!byPair.has(pair)) byPair.set(pair, []);
    byPair.get(pair)!.push(m);
  }
  for (const list of byPair.values()) {
    const { from, to } = list[0];
    for (let i = 0; i < list.length; i += ID_CHUNK) {
      const ids = list.slice(i, i + ID_CHUNK).map((m) => m.key);
      const { error } = await db.from(table).update({ [column]: to }).in(key, ids).eq(column, from);
      if (error) throw new Error(`${table}: ${error.message}`);
    }
  }
}

/**
 * POST /api/admin/analytics/attribution/audit   { apply: boolean }
 *
 * Re-run the current classification over every stored touch — visitors (first
 * and last), store orders, hosted orders and customers — and move the rows the
 * rules now say were paid clicks to that paid channel. One-way by design: see
 * lib/analytics/reclassify.ts. `apply: false` (the default) only counts.
 *
 * All history, not the selected range: a visitor's channel is one fact, and
 * fixing it for one month would leave the same person filed two ways.
 *
 * Admin only.
 */
export async function POST(req: NextRequest) {
  const realRole = await readerRole(req);
  if (realRole !== 'admin' || previewedRole(realRole, req.nextUrl.searchParams.get(ADMIN_VIEW_PARAM)) !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const apply = body?.apply === true;
  const unpaid = (column: string) => (q: any) =>
    q.not(column, 'is', null).not(column, 'in', `(${PAID_CHANNELS.join(',')})`);

  try {
    const [visitors, orders, hosted, customers] = await Promise.all([
      scan('visitor_attribution', VISITOR_COLUMNS, 'anonymous_id', (q) => q),
      scan('orders', 'id, attribution_channel, attribution', 'id', unpaid('attribution_channel')),
      scan('puramass_orders', 'id, attribution_channel, attribution', 'id', unpaid('attribution_channel')),
      scan('customers', 'id, attribution_channel, attribution', 'id', unpaid('attribution_channel')),
    ]);

    const firstMoves: Move[] = [];
    const lastMoves: Move[] = [];
    for (const v of visitors) {
      const { first, last } = visitorTouches(v);
      const f = correctedChannel(first);
      if (f) firstMoves.push({ key: v.anonymous_id, from: first.channel!, to: f });
      const l = correctedChannel(last);
      if (l) lastMoves.push({ key: v.anonymous_id, from: last.channel!, to: l });
    }
    const snapshotMoves = (rows: any[]): Move[] =>
      rows.flatMap((r) => {
        const t = snapshotTouch(r.attribution_channel, r.attribution);
        const next = t ? correctedChannel(t) : null;
        return next ? [{ key: String(r.id), from: r.attribution_channel, to: next }] : [];
      });
    const orderMoves = snapshotMoves(orders);
    const hostedMoves = snapshotMoves(hosted);
    const customerMoves = snapshotMoves(customers);

    if (apply) {
      await applyMoves('visitor_attribution', 'anonymous_id', 'first_channel', firstMoves);
      await applyMoves('visitor_attribution', 'anonymous_id', 'last_channel', lastMoves);
      await applyMoves('orders', 'id', 'attribution_channel', orderMoves);
      await applyMoves('puramass_orders', 'id', 'attribution_channel', hostedMoves);
      await applyMoves('customers', 'id', 'attribution_channel', customerMoves);
    }

    return NextResponse.json({
      applied: apply,
      moves: {
        visitors_first: tally(firstMoves),
        visitors_last: tally(lastMoves),
        orders: tally(orderMoves),
        hosted_orders: tally(hostedMoves),
        customers: tally(customerMoves),
      },
      total: firstMoves.length + lastMoves.length + orderMoves.length + hostedMoves.length + customerMoves.length,
    } satisfies ReclassifyResult);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Reclassify failed' }, { status: 500 });
  }
}
