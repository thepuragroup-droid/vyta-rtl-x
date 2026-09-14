import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verifyAdminRole(req: NextRequest, requireMutation: boolean) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { ok: false, userId: null as string | null, role: 'customer' };
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { ok: false, userId: null, role: 'customer' };
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  const role = data?.role ?? 'customer';
  const ok = requireMutation
    ? role === 'admin'
    : role === 'admin' || role === 'assistant';
  return { ok, userId: user.id, role };
}

const SUPPLIER_FIELDS = ['name', 'contact_name', 'email', 'phone', 'lead_time_days', 'notes'];

// GET /api/admin/suppliers
export async function GET(req: NextRequest) {
  const { ok } = await verifyAdminRole(req, false);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { data, error } = await db.from('suppliers').select('*').order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ suppliers: data ?? [] });
}

// POST /api/admin/suppliers — create + seed supplier_prices from active products
export async function POST(req: NextRequest) {
  const { ok } = await verifyAdminRole(req, true);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const body = await req.json();
  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'Supplier name is required' }, { status: 400 });
  }

  const insert: Record<string, unknown> = {};
  for (const f of SUPPLIER_FIELDS) {
    if (f in body) insert[f] = body[f];
  }
  insert.name = String(body.name).trim();
  if (body.lead_time_days == null) insert.lead_time_days = 7;

  const { data: supplier, error } = await db
    .from('suppliers')
    .insert(insert)
    .select()
    .single();

  if (error || !supplier) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create supplier' }, { status: 500 });
  }

  // Seed this supplier's pricelist from active product prices (non-fatal).
  const { data: products } = await db
    .from('products')
    .select('id, price')
    .eq('active', true);
  if (products?.length) {
    const rows = products.map((p: any) => ({
      supplier_id: supplier.id,
      product_id: p.id,
      price: Number(p.price) || 0,
    }));
    const { error: seedErr } = await db
      .from('supplier_prices')
      .upsert(rows, { onConflict: 'supplier_id,product_id' });
    if (seedErr) console.error('supplier_prices seed error:', seedErr);
  }

  return NextResponse.json({ supplier }, { status: 201 });
}
