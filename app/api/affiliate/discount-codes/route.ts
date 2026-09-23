import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveAffiliateCaller } from '@/lib/affiliate/route-auth';
import { describeDiscount, PAID_ORDER_STATUSES } from '@/lib/affiliate/discount-codes';
import { summarizeAffiliateBalance } from '@/lib/affiliate/payouts';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * GET /api/affiliate/discount-codes — the signed-in affiliate's own discount
 * codes with what each brought in, their balance, and the payments they have
 * been sent.
 *
 * Columns are chosen here, deliberately: admin notes on codes and payouts, and
 * who recorded a payout, never reach the affiliate.
 */
export async function GET(req: NextRequest) {
  const caller = await resolveAffiliateCaller(db, req);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const affiliateId = caller.affiliate.id;

  const [codesRes, payoutsRes, commissionsRes] = await Promise.all([
    db
      .from('discount_codes')
      .select('id, code, discount_type, discount_value, commission_rate, min_subtotal, max_uses, starts_at, expires_at, active')
      .eq('affiliate_id', affiliateId)
      .order('created_at', { ascending: false }),
    db
      .from('affiliate_payouts')
      .select('id, amount, method, reference, paid_at')
      .eq('affiliate_id', affiliateId)
      .order('paid_at', { ascending: false }),
    db
      .from('commissions')
      .select('amount, order_total, status, payout_id, discount_code_id')
      .eq('affiliate_id', affiliateId),
  ]);

  if (codesRes.error || payoutsRes.error) {
    // Migration not run yet: nothing to show, not an error for the affiliate.
    return NextResponse.json({ codes: [], payouts: [], summary: null });
  }

  const codes = codesRes.data ?? [];
  const ids = codes.map((c) => c.id);
  const usage = new Map<string, { orders: number; revenue: number }>();
  if (ids.length > 0) {
    const { data: orders } = await db
      .from('puramass_orders')
      .select('discount_code_id, subtotal_cents')
      .in('discount_code_id', ids)
      .in('status', PAID_ORDER_STATUSES);
    for (const o of orders ?? []) {
      const u = usage.get(o.discount_code_id as string) ?? { orders: 0, revenue: 0 };
      u.orders += 1;
      u.revenue += (Number(o.subtotal_cents) || 0) / 100;
      usage.set(o.discount_code_id as string, u);
    }
  }
  const commissions = commissionsRes.data ?? [];
  const earnedByCode = new Map<string, number>();
  for (const c of commissions) {
    if (!c.discount_code_id || c.status === 'cancelled') continue;
    earnedByCode.set(c.discount_code_id, (earnedByCode.get(c.discount_code_id) ?? 0) + (Number(c.amount) || 0));
  }

  const now = Date.now();
  return NextResponse.json({
    summary: summarizeAffiliateBalance(commissions, payoutsRes.data ?? []),
    codes: codes.map((c) => {
      const u = usage.get(c.id) ?? { orders: 0, revenue: 0 };
      const live =
        c.active &&
        (!c.starts_at || Date.parse(c.starts_at) <= now) &&
        (!c.expires_at || Date.parse(c.expires_at) > now) &&
        (c.max_uses == null || u.orders < c.max_uses);
      return {
        code: c.code,
        description: describeDiscount(c as any),
        commission_rate: c.commission_rate == null ? null : Number(c.commission_rate),
        min_subtotal: c.min_subtotal == null ? null : Number(c.min_subtotal),
        expires_at: c.expires_at,
        live,
        orders: u.orders,
        revenue: round2(u.revenue),
        earned: round2(earnedByCode.get(c.id) ?? 0),
      };
    }),
    payouts: (payoutsRes.data ?? []).map((p) => ({ ...p, amount: Number(p.amount) })),
  });
}
