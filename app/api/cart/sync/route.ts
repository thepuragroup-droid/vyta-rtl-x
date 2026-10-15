import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { isTrackingAllowed, readVisitorContext } from '@/lib/analytics/attribution-server';
import { cartSignature, itemCount, sanitizeCartLines, type SavedCartLine } from '@/lib/email-flows/carts';

const db = getSupabase();

/**
 * POST /api/cart/sync  { items: [{ productId, packSize, quantity }] }
 *
 * Mirrors the storefront cart server-side, so the cart abandonment flow can
 * see what was left behind and "Return to cart" can restore it on any device.
 * Called by CartContext, debounced, whenever the cart changes.
 *
 * Who it belongs to: the signed-in customer (bearer token), else the visitor
 * cookie — and an anonymous cart is stored only when the visitor accepted the
 * cookie banner (or it is off), the same rule as the rest of the storefront
 * tracking. A guest's email is attached later, when they start checkout or
 * sign in (visitor_attribution).
 *
 * Only product lines are stored; names and prices are always read from
 * `products`. The abandonment clock (`updated_at`) moves only when the
 * contents change, so a page load re-syncing the same cart doesn't reset it.
 *
 * Always 200 — this is background bookkeeping, never a storefront error.
 */
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    let customerId: string | null = null;
    if (token) {
      const { data: { user } } = await db.auth.getUser(token);
      customerId = user?.id ?? null;
    }
    const ctx = readVisitorContext(req.cookies);
    if (!customerId && !ctx.anonymousId) return NextResponse.json({ ok: false });

    if (!customerId) {
      const rl = checkRateLimit(`cart-sync:${getClientIp(req)}`, { windowMs: 60_000, max: 60 });
      if (!rl.allowed) return NextResponse.json({ ok: false });
    }
    if (!(await isTrackingAllowed(db, req.cookies, { signedIn: !!customerId }))) {
      return NextResponse.json({ ok: false, consent: false });
    }

    const body = await req.json().catch(() => ({}));
    const lines = sanitizeCartLines(body?.items);

    // The cart this browser already has: the customer's open one, else this
    // visitor's. A sign-in claims the visitor's cart for the account.
    const find = async (col: 'customer_id' | 'anonymous_id', value: string) =>
      (
        await db
          .from('saved_carts')
          .select('id, items, status, customer_id')
          .eq(col, value)
          .is('checkout_ref', null)
          .in('status', ['open', 'emptied'])
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data as { id: string; items: SavedCartLine[]; status: string; customer_id: string | null } | null;

    let cart = customerId ? await find('customer_id', customerId) : null;
    if (!cart && ctx.anonymousId) cart = await find('anonymous_id', ctx.anonymousId);

    const now = new Date().toISOString();
    if (!cart) {
      if (!lines.length) return NextResponse.json({ ok: true });
      await db.from('saved_carts').insert({
        customer_id: customerId,
        anonymous_id: ctx.anonymousId ?? null,
        items: lines,
        item_count: itemCount(lines),
        status: 'open',
        updated_at: now,
      });
      return NextResponse.json({ ok: true });
    }

    const changed = cartSignature(lines) !== cartSignature(sanitizeCartLines(cart.items));
    const patch: Record<string, unknown> = {};
    if (customerId && !cart.customer_id) patch.customer_id = customerId;
    if (ctx.anonymousId) patch.anonymous_id = ctx.anonymousId;
    if (changed) {
      patch.items = lines;
      patch.item_count = itemCount(lines);
      patch.status = lines.length ? 'open' : 'emptied';
      patch.updated_at = now;
    }
    if (Object.keys(patch).length) await db.from('saved_carts').update(patch).eq('id', cart.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[cart-sync] failed:', err);
    return NextResponse.json({ ok: false });
  }
}
