import { NextRequest, NextResponse } from 'next/server';
import {
  db,
  requireAdmin,
  loadPayoutData,
  payoutErrorResponse,
  auditPayout,
} from '@/lib/admin/stealth-health-data';
import { rpcRow } from '@/lib/admin/stealth-health-payouts';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/stealth-health/payout-requests/[id] — act on a request.
 * Admin only.
 *
 *   {action: 'receive', amount?, reference?}  mark every order on it paid out
 *                                             and record the deposit
 *   {action: 'void'}                          release its orders; refused once
 *                                             any of them is paid out
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  const { id } = await params;

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    if (body.action === 'receive') {
      let amount: number | null = null;
      if (body.amount != null && String(body.amount).trim() !== '') {
        amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount < 0) {
          return NextResponse.json({ error: 'The amount received must be zero or more.' }, { status: 400 });
        }
        amount = Math.round(amount * 100) / 100;
      }
      const reference = String(body.reference ?? '').trim().slice(0, 200) || null;

      const data = await loadPayoutData();
      const request = data.requests.find((r) => r.id === id);
      if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (request.status === 'void') {
        return NextResponse.json({ error: `${request.payout_number} is void.` }, { status: 400 });
      }
      const rows = data.orders
        .filter((o) => o.payout_request_id === id && o.state !== 'paid_out')
        .map(rpcRow);

      const { data: marked, error } = await db.rpc('sh_mark_paid_out', {
        p_rows: rows,
        p_actor: actor.id,
        p_payout_id: id,
        p_amount: amount,
        p_reference: reference,
      });
      if (error) return payoutErrorResponse(error);
      const done = ((marked ?? []) as unknown[]).map(String);

      await auditPayout(actor, 'stealth_health.payout_receive', 'stealth_health_payout_request', [id]);
      if (done.length > 0) await auditPayout(actor, 'stealth_health.paid_out', 'puramass_order', done);
      return NextResponse.json({ ids: done });
    }

    if (body.action === 'void') {
      const { error } = await db.rpc('sh_void_payout', { p_payout_id: id });
      if (error) return payoutErrorResponse(error);
      await auditPayout(actor, 'stealth_health.payout_void', 'stealth_health_payout_request', [id]);
      return NextResponse.json({ voided: true });
    }

    return NextResponse.json({ error: "action must be 'receive' or 'void'." }, { status: 400 });
  } catch (err) {
    return payoutErrorResponse(err);
  }
}
