import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type Role = 'admin' | 'assistant' | 'affiliate' | 'customer';

async function getCaller(req: NextRequest): Promise<{ id: string | null; role: Role }> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { id: null, role: 'customer' };
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { id: null, role: 'customer' };
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  return { id: user.id, role: (data?.role ?? 'customer') as Role };
}

// Customers bound to an affiliate (customers.affiliate_id).
async function boundCustomerIds(affiliateId: string): Promise<string[]> {
  const { data } = await db.from('customers').select('id').eq('affiliate_id', affiliateId);
  return (data ?? []).map((c: any) => c.id);
}

async function affiliateOwnsCustomer(affiliateId: string, customerId: string): Promise<boolean> {
  const { data } = await db
    .from('customers')
    .select('id')
    .eq('id', customerId)
    .eq('affiliate_id', affiliateId)
    .maybeSingle();
  return !!data;
}

// GET /api/admin/price-overrides
export async function GET(req: NextRequest) {
  const { id, role } = await getCaller(req);
  if (!['admin', 'assistant', 'affiliate'].includes(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const customerId = sp.get('customer_id');
  const productId = sp.get('product_id');

  let query = db
    .from('customer_price_overrides')
    .select(`*, customer:customers (id, first_name, last_name, email, preferred_currency), product:products (id, name, sku, price)`)
    .order('created_at', { ascending: false });

  if (customerId) query = query.eq('customer_id', customerId);
  if (productId) query = query.eq('product_id', productId);

  // Affiliates only ever see overrides for their bound customers.
  if (role === 'affiliate') {
    const ids = await boundCustomerIds(id!);
    if (ids.length === 0) return NextResponse.json({ overrides: [] });
    query = query.in('customer_id', ids);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ overrides: data ?? [] });
}

// POST /api/admin/price-overrides — upsert one override
export async function POST(req: NextRequest) {
  const { id, role } = await getCaller(req);
  if (!['admin', 'affiliate'].includes(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json();
  const { customer_id, product_id } = body;
  const override_price = Number(body.override_price);

  if (!customer_id || !product_id) {
    return NextResponse.json({ error: 'customer_id and product_id are required' }, { status: 400 });
  }
  if (!Number.isFinite(override_price) || override_price < 0) {
    return NextResponse.json({ error: 'override_price must be a non-negative number' }, { status: 400 });
  }
  if (role === 'affiliate' && !(await affiliateOwnsCustomer(id!, customer_id))) {
    return NextResponse.json({ error: 'You can only price your own customers' }, { status: 403 });
  }

  // Verify both ends exist.
  const [{ data: cust }, { data: prod }] = await Promise.all([
    db.from('customers').select('id').eq('id', customer_id).maybeSingle(),
    db.from('products').select('id').eq('id', product_id).maybeSingle(),
  ]);
  if (!cust) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
  if (!prod) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  const { data, error } = await db
    .from('customer_price_overrides')
    .upsert(
      { customer_id, product_id, override_price: Math.round(override_price * 100) / 100 },
      { onConflict: 'customer_id,product_id' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ override: data }, { status: 201 });
}

// DELETE /api/admin/price-overrides — by id OR (customer_id, product_id)
export async function DELETE(req: NextRequest) {
  const { id, role } = await getCaller(req);
  if (!['admin', 'affiliate'].includes(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const overrideId = sp.get('id');
  const customerId = sp.get('customer_id');
  const productId = sp.get('product_id');

  // Resolve the affected customer first so affiliates can be ownership-checked.
  let targetCustomer = customerId;
  if (overrideId && !targetCustomer) {
    const { data } = await db.from('customer_price_overrides').select('customer_id').eq('id', overrideId).maybeSingle();
    targetCustomer = data?.customer_id ?? null;
  }
  if (role === 'affiliate') {
    if (!targetCustomer || !(await affiliateOwnsCustomer(id!, targetCustomer))) {
      return NextResponse.json({ error: 'You can only modify your own customers' }, { status: 403 });
    }
  }

  let q = db.from('customer_price_overrides').delete();
  if (overrideId) {
    q = q.eq('id', overrideId);
  } else if (customerId && productId) {
    q = q.eq('customer_id', customerId).eq('product_id', productId);
  } else {
    return NextResponse.json({ error: 'Provide id or (customer_id, product_id)' }, { status: 400 });
  }

  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
