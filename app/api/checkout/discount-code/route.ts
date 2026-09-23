import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { describeDiscount, lookupDiscountCode } from '@/lib/affiliate/discount-codes';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Tighter than the general budget: this is the endpoint someone would use to
// guess codes.
const LIMIT = { max: 15, windowMs: 60_000 };

/**
 * POST /api/checkout/discount-code — preview a discount code for the checkout.
 *
 * Display only. `/api/checkout/puramass` looks the code up again against the
 * catalog-priced cart and decides the money itself, so the subtotal sent here
 * only affects what the buyer is shown.
 *
 * The response never names the affiliate a code belongs to.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`discount-code:${ip}`, LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Too many attempts. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  const body = await req.json().catch(() => ({}));
  const subtotal = Number(body?.subtotal);

  let customerId: string | null = null;
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (token) {
    try {
      const { data: { user } } = await db.auth.getUser(token);
      customerId = user?.id ?? null;
    } catch {
      customerId = null;
    }
  }

  const result = await lookupDiscountCode(db, body?.code, {
    subtotal: Number.isFinite(subtotal) ? subtotal : 0,
    customerId,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.message });
  }

  return NextResponse.json({
    ok: true,
    code: result.code.code,
    percent: result.percent,
    discount_type: result.code.discount_type,
    discount_value: Number(result.code.discount_value),
    description: describeDiscount(result.code),
  });
}
