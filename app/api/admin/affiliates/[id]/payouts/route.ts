import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditServer } from '@/lib/admin/audit';
import { resolveStaffCaller } from '@/lib/affiliate/route-auth';
import { isPayoutMethod, summarizeAffiliateBalance } from '@/lib/affiliate/payouts';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const PAYOUT_COLUMNS =
  'id, affiliate_id, amount, method, reference, notes, paid_at, recorded_by_name, created_at';

/**
 * GET /api/admin/affiliates/[id]/payouts — the affiliate's balance, their
 * payout history, and the commissions a new payout can settle. Staff.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const caller = await resolveStaffCaller(db, req, { allowAssistant: true });
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const [payoutsRes, commissionsRes] = await Promise.all([
    db
      .from('affiliate_payouts')
      .select(PAYOUT_COLUMNS)
      .eq('affiliate_id', params.id)
      .order('paid_at', { ascending: false }),
    db
      .from('commissions')
      .select('id, amount, order_total, status, created_at, invoice_id, order_id, payout_id, discount_code_id')
      .eq('affiliate_id', params.id)
      .order('created_at', { ascending: true }),
  ]);

  const migrationNeeded = !!payoutsRes.error || !!commissionsRes.error;
  let commissions = commissionsRes.data ?? [];
  if (commissionsRes.error) {
    // Without the migration, payout_id / discount_code_id do not exist yet.
    const fallback = await db
      .from('commissions')
      .select('id, amount, order_total, status, created_at, invoice_id, order_id')
      .eq('affiliate_id', params.id)
      .order('created_at', { ascending: true });
    commissions = (fallback.data ?? []) as typeof commissions;
  }
  const payouts = payoutsRes.error ? [] : payoutsRes.data ?? [];

  // Human-readable references for the commissions table.
  const invoiceIds = [...new Set(commissions.map((c) => c.invoice_id).filter(Boolean))] as string[];
  const codeIds = [...new Set(commissions.map((c) => (c as any).discount_code_id).filter(Boolean))] as string[];
  const [{ data: invoices }, { data: codes }] = await Promise.all([
    invoiceIds.length
      ? db.from('invoices').select('id, invoice_number').in('id', invoiceIds)
      : Promise.resolve({ data: [] as { id: string; invoice_number: string | null }[] }),
    codeIds.length
      ? db.from('discount_codes').select('id, code').in('id', codeIds)
      : Promise.resolve({ data: [] as { id: string; code: string }[] }),
  ]);
  const invoiceNo = new Map((invoices ?? []).map((i) => [i.id, i.invoice_number]));
  const codeName = new Map((codes ?? []).map((c) => [c.id, c.code]));

  return NextResponse.json({
    migrationNeeded,
    summary: summarizeAffiliateBalance(commissions, payouts),
    payouts: payouts.map((p) => ({ ...p, amount: Number(p.amount) })),
    commissions: commissions
      .filter((c) => c.status !== 'cancelled')
      .map((c: any) => ({
        id: c.id,
        amount: Number(c.amount) || 0,
        order_total: Number(c.order_total) || 0,
        status: c.status,
        created_at: c.created_at,
        payout_id: c.payout_id ?? null,
        reference:
          (c.invoice_id && invoiceNo.get(c.invoice_id)) ||
          (c.invoice_id ?? c.order_id ?? '').slice(0, 8) ||
          '—',
        discount_code: c.discount_code_id ? codeName.get(c.discount_code_id) ?? null : null,
      })),
  });
}

/**
 * POST /api/admin/affiliates/[id]/payouts — record money sent to the
 * affiliate. Admin only.
 *
 * Body: { amount, method, reference?, notes?, paid_at?, commission_ids? }.
 * The listed commissions (must be this affiliate's and still pending) are
 * marked paid and linked to the payout. The amount is what was actually sent
 * and may differ from their sum — a bonus, a rounding, a partial payment.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const caller = await resolveStaffCaller(db, req);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const body = (await req.json().catch(() => ({}))) ?? {};
  const amount = Math.round((Number(body.amount) || 0) * 100) / 100;
  if (!(amount > 0)) {
    return NextResponse.json({ error: 'Enter the amount that was paid.' }, { status: 400 });
  }
  const method = isPayoutMethod(body.method) ? body.method : 'other';
  const paidAtMs = body.paid_at ? Date.parse(String(body.paid_at)) : Date.now();
  if (!Number.isFinite(paidAtMs)) {
    return NextResponse.json({ error: 'Invalid payment date.' }, { status: 400 });
  }
  const commissionIds: string[] = Array.isArray(body.commission_ids)
    ? body.commission_ids.filter((x: unknown) => typeof x === 'string')
    : [];

  const { data: affiliate } = await db
    .from('affiliates')
    .select('id')
    .eq('id', params.id)
    .maybeSingle();
  if (!affiliate) return NextResponse.json({ error: 'Affiliate not found' }, { status: 404 });

  const { data: payout, error } = await db
    .from('affiliate_payouts')
    .insert({
      affiliate_id: params.id,
      amount,
      method,
      reference: typeof body.reference === 'string' && body.reference.trim() ? body.reference.trim().slice(0, 255) : null,
      notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
      paid_at: new Date(paidAtMs).toISOString(),
      recorded_by: caller.staff.id,
      recorded_by_name: caller.staff.name,
    })
    .select(PAYOUT_COLUMNS)
    .single();

  if (error) {
    console.error('[payouts] insert failed:', error);
    const missing = error.code === '42P01';
    return NextResponse.json(
      {
        error: missing
          ? 'Payouts are not set up yet — run affiliate-discount-codes-payouts-migration.sql.'
          : 'Could not record the payout',
      },
      { status: missing ? 503 : 500 },
    );
  }

  let settled = 0;
  if (commissionIds.length > 0) {
    // Scoped to this affiliate and to pending rows, so a stale or forged id
    // can neither settle someone else's commission nor re-pay a paid one.
    const { data: updated, error: settleError } = await db
      .from('commissions')
      .update({ status: 'paid', paid_at: new Date(paidAtMs).toISOString(), payout_id: payout.id })
      .in('id', commissionIds)
      .eq('affiliate_id', params.id)
      .eq('status', 'pending')
      .select('id');
    if (settleError) console.error('[payouts] settling commissions failed:', settleError);
    settled = updated?.length ?? 0;
  }

  await logAuditServer(
    db,
    { actor_id: caller.staff.id, actor_email: caller.staff.email },
    { action: 'affiliate_payout.create', entity_type: 'affiliate', entity_id: params.id },
  );

  return NextResponse.json({ payout, settled }, { status: 201 });
}
