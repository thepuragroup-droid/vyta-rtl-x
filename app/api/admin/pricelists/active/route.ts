import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getActivePricelistPriceMap } from '@/lib/pricing/resolve';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verifyAdmin(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return false;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  return data?.role === 'admin' || data?.role === 'assistant' || data?.role === 'affiliate';
}

// GET /api/admin/pricelists/active?customer_id=...
//   Returns { pricelist, prices } where `prices` is { product_id: finalPrice }.
//   - With ?customer_id=...: chain-resolved (override > pricelist).
//   - Without:               raw pricelist prices (backward-compat).
//
// The active pricelist row itself is returned for the form's "Active list:"
// header. Falls back to products.price client-side when a product_id is
// absent from `prices`.
export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const customerId = req.nextUrl.searchParams.get('customer_id');

  if (customerId) {
    const { pricelist, prices } = await getActivePricelistPriceMap(db, customerId);
    return NextResponse.json({ pricelist, prices });
  }

  // Backward-compat path: raw pricelist prices only (no override merge).
  const { data: pricelist } = await db
    .from('pricelists')
    .select('*')
    .eq('is_active', true)
    .maybeSingle();

  if (!pricelist) return NextResponse.json({ pricelist: null, prices: {} });

  const { data: items } = await db
    .from('pricelist_items')
    .select('product_id, price')
    .eq('pricelist_id', pricelist.id);

  const prices: Record<string, number> = {};
  for (const it of items ?? []) prices[it.product_id] = Number(it.price);

  return NextResponse.json({ pricelist, prices });
}
