import { NextRequest, NextResponse } from 'next/server';
import {
  db,
  requireAdmin,
  loadPayoutData,
  payoutErrorResponse,
  readIds,
  auditPayout,
} from '@/lib/admin/stealth-health-data';
import { normalizeFeeType, rpcRow } from '@/lib/admin/stealth-health-payouts';

export const dynamic = 'force-dynamic';

const CHUNK = 150;

/**
 * POST /api/admin/stealth-health/payout-requests/orders — act on orders.
 * Admin only.
 *
 *   {action: 'fee', order_ids, fee_type}  set the fee type (orders not paid out)
 *   {action: 'paid', order_ids}           mark paid out, locking rate and figures
 *   {action: 'unpaid', order_ids}         undo: the fee follows Settings again
 *
 * Returns `{ids}`: the orders that actually changed.
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

  try {
    switch (body.action) {
      case 'fee': {
        if (body.fee_type !== 'catalog' && body.fee_type !== 'custom') {
          return NextResponse.json({ error: "fee_type must be 'catalog' or 'custom'." }, { status: 400 });
        }
        const feeType = normalizeFeeType(body.fee_type);
        const changed: string[] = [];
        for (let i = 0; i < ids.length; i += CHUNK) {
          const { data, error } = await db
            .from('puramass_orders')
            .update({ sh_fee_type: feeType })
            .in('id', ids.slice(i, i + CHUNK))
            .eq('status', 'paid')
            .is('paid_out_at', null)
            .select('id');
          if (error) return payoutErrorResponse(error);
          changed.push(...((data ?? []) as any[]).map((r) => String(r.id)));
        }
        if (changed.length > 0) {
          await auditPayout(actor, 'stealth_health.fee_change', 'puramass_order', changed);
        }
        return NextResponse.json({ ids: changed });
      }

      case 'paid': {
        const data = await loadPayoutData();
        const wanted = new Set(ids);
        const rows = data.orders.filter((o) => wanted.has(o.id) && o.state !== 'paid_out').map(rpcRow);
        if (rows.length === 0) return NextResponse.json({ ids: [] });
        const { data: marked, error } = await db.rpc('sh_mark_paid_out', {
          p_rows: rows,
          p_actor: actor.id,
        });
        if (error) return payoutErrorResponse(error);
        const done = ((marked ?? []) as unknown[]).map(String);
        if (done.length > 0) await auditPayout(actor, 'stealth_health.paid_out', 'puramass_order', done);
        return NextResponse.json({ ids: done });
      }

      case 'unpaid': {
        const { data: unmarked, error } = await db.rpc('sh_unmark_paid_out', { p_ids: ids });
        if (error) return payoutErrorResponse(error);
        const done = ((unmarked ?? []) as unknown[]).map(String);
        if (done.length > 0) await auditPayout(actor, 'stealth_health.unpaid_out', 'puramass_order', done);
        return NextResponse.json({ ids: done });
      }

      default:
        return NextResponse.json({ error: "action must be 'fee', 'paid' or 'unpaid'." }, { status: 400 });
    }
  } catch (err) {
    return payoutErrorResponse(err);
  }
}
