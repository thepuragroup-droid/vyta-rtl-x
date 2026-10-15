import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { restoreCartLines, sanitizeCartLines } from '@/lib/email-flows/carts';
import { cartProducts } from '@/lib/email-flows/engine';

const db = getSupabase();

/**
 * GET /api/cart/restore?token=… — the lines behind a "Return to cart" link.
 *
 * Returns product lines only, rebuilt at today's pack price and stock — never
 * anything about the person — so the unguessable token is all the link needs.
 * Products no longer sold or out of stock are left out and counted in
 * `dropped`, so the cart page can say so.
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(`cart-restore:${getClientIp(req)}`, { windowMs: 60_000, max: 30 });
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  const token = (req.nextUrl.searchParams.get('token') ?? '').trim();
  if (!/^[A-Za-z0-9-]{16,128}$/.test(token)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: cart } = await db.from('saved_carts').select('items').eq('restore_token', token).maybeSingle();
  if (!cart) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const lines = sanitizeCartLines(cart.items);
  const restored = restoreCartLines(lines, await cartProducts(db, lines));
  return NextResponse.json(restored, { headers: { 'Cache-Control': 'no-store' } });
}
