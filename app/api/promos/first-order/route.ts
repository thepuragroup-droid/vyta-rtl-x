/**
 * GET /api/promos/first-order — is the signed-in customer still on their first
 * order?
 *
 * The paid-ads welcome discount only applies to a buyer's first order
 * (lib/promos/ad-discount.ts), and whether that is still true lives in the
 * database: the legacy first-order flag, and this customer's hosted hand-offs.
 * The storefront needs the answer to decide what to SHOW — the strip under the
 * nav bar, the cart line, the checkout summary — so it reads it from here
 * rather than guessing from the customer row it already has, which the hosted
 * checkout never writes to.
 *
 * This decides nothing about money. `/api/checkout/puramass` calls the same
 * `isCustomerFirstOrder` again at hand-off and prices from that, so a tampered
 * response here changes the wording of a banner and not a cent of the total.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { isCustomerFirstOrder } from '@/lib/promos/first-order';

export async function GET(req: NextRequest) {
  // The browser session is token-based (localStorage), so authenticate via the
  // Authorization: Bearer <access_token> header rather than cookies — same as
  // /api/orders/my-orders.
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) {
    return NextResponse.json({ firstOrder: false }, { status: 401 });
  }

  const db = getSupabase();
  const {
    data: { user },
  } = await db.auth.getUser(token);
  if (!user) {
    return NextResponse.json({ firstOrder: false }, { status: 401 });
  }

  const firstOrder = await isCustomerFirstOrder(db, user.id);

  // `no-store`: a buyer who has just ordered must stop being told the welcome
  // discount is waiting for them.
  return NextResponse.json(
    { firstOrder },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
