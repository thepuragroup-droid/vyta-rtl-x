import { NextRequest, NextResponse } from 'next/server';
import { BRAND } from '@/lib/brand';
import {
  db,
  requireReader,
  requireAdmin,
  loadPayoutData,
  payoutErrorResponse,
  readIds,
  auditPayout,
} from '@/lib/admin/stealth-health-data';
import {
  buildRequestView,
  orderPeriod,
  requestBlocker,
  rpcRow,
} from '@/lib/admin/stealth-health-payouts';

export const dynamic = 'force-dynamic';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/admin/stealth-health/payout-requests — every customer-paid order
 * with its fee, net and payout state, every payout request with its orders,
 * the fee rates and the CAD→USD rate. 409 `setup_required` until the
 * migration has run. Admin + assistant.
 */
export async function GET(req: NextRequest) {
  if (!(await requireReader(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  try {
    return NextResponse.json(await loadPayoutData());
  } catch (err) {
    return payoutErrorResponse(err);
  }
}

/**
 * POST — create a payout request from `{order_ids, period_start?, period_end?,
 * notes?}`. Orders that are already on a request, already paid out or have no
 * known amount are left out and returned as `skipped`. Admin only.
 */
export async function POST(req: NextRequest) {
  const actor = await requireAdmin(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const ids = readIds(body.order_ids);
  if (ids.length === 0) {
    return NextResponse.json({ error: 'Select at least one order.' }, { status: 400 });
  }
  const periodStart = String(body.period_start ?? '').trim();
  const periodEnd = String(body.period_end ?? '').trim();
  if ((periodStart && !DAY.test(periodStart)) || (periodEnd && !DAY.test(periodEnd))) {
    return NextResponse.json({ error: 'The period must be YYYY-MM-DD dates.' }, { status: 400 });
  }
  if (periodStart && periodEnd && periodStart > periodEnd) {
    return NextResponse.json({ error: 'The period starts after it ends.' }, { status: 400 });
  }
  const notes = String(body.notes ?? '').trim().slice(0, 2000) || null;

  try {
    const data = await loadPayoutData();
    const wanted = new Set(ids);
    const picked = data.orders.filter((o) => wanted.has(o.id));
    const eligible = picked.filter((o) => !requestBlocker(o));
    const skipped = [
      ...picked.filter((o) => requestBlocker(o)).map((o) => ({ id: o.id, reason: requestBlocker(o)! })),
      ...ids.filter((id) => !picked.some((o) => o.id === id)).map((id) => ({ id, reason: 'not a customer-paid order' })),
    ];
    if (eligible.length === 0) {
      return NextResponse.json(
        { error: 'None of the selected orders can go on a request.', skipped },
        { status: 400 },
      );
    }

    const period = orderPeriod(eligible);
    const { data: created, error } = await db.rpc('sh_create_payout', {
      p_prefix: BRAND.payoutPrefix,
      p_rows: eligible.map(rpcRow),
      p_usd_rate: data.usd_rate,
      p_period_start: periodStart || period.from,
      p_period_end: periodEnd || period.to,
      p_notes: notes,
      p_actor: actor.id,
    });
    if (error) return payoutErrorResponse(error);

    const row = (Array.isArray(created) ? created[0] : created) as any;
    await auditPayout(actor, 'stealth_health.payout_create', 'stealth_health_payout_request', [String(row.id)]);

    const linked = eligible.map((o) => ({
      ...o,
      state: 'requested' as const,
      payout_request_id: String(row.id),
      payout_number: String(row.payout_number),
    }));
    return NextResponse.json(
      { request: buildRequestView(row, linked, data.time_zone), skipped },
      { status: 201 },
    );
  } catch (err) {
    return payoutErrorResponse(err);
  }
}
