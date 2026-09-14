import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verifyAdminRole(req: NextRequest, requireMutation: boolean) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { ok: false, role: 'customer' };
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { ok: false, role: 'customer' };
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  const role = data?.role ?? 'customer';
  const ok = requireMutation
    ? role === 'admin'
    : role === 'admin' || role === 'assistant';
  return { ok, role };
}

// GET /api/admin/suppliers/[id]/prices — active products joined with this supplier's price
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { ok } = await verifyAdminRole(req, false);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { data: products, error } = await db
    .from('products')
    .select('id, name, sku, price')
    .eq('active', true)
    .order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: prices } = await db
    .from('supplier_prices')
    .select('product_id, price')
    .eq('supplier_id', params.id);

  const priceMap = new Map((prices ?? []).map((p: any) => [p.product_id, Number(p.price)]));

  const rows = (products ?? []).map((p: any) => ({
    product_id: p.id,
    product_name: p.name,
    sku: p.sku ?? null,
    original_price: Number(p.price) || 0,
    supplier_price: priceMap.has(p.id) ? priceMap.get(p.id)! : null,
  }));

  return NextResponse.json({ prices: rows });
}

// PUT /api/admin/suppliers/[id]/prices — batch upsert
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { ok } = await verifyAdminRole(req, true);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const body = await req.json();
  const items = (body.items as any[] | undefined ?? [])
    .filter((i) => i.product_id)
    .map((i) => ({
      supplier_id: params.id,
      product_id: i.product_id,
      price: Math.max(0, Number(i.price) || 0),
    }));

  if (items.length === 0) {
    return NextResponse.json({ success: true });
  }

  const { error } = await db
    .from('supplier_prices')
    .upsert(items, { onConflict: 'supplier_id,product_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
