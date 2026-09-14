import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verifyAdminRole(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return false;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  return data?.role === 'admin' || data?.role === 'assistant';
}

// GET /api/admin/supplier-prices/cheapest — cheapest supplier per product
export async function GET(req: NextRequest) {
  if (!(await verifyAdminRole(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data, error } = await db
    .from('supplier_prices')
    .select('product_id, price, supplier:suppliers (id, name)');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const cheapest: Record<string, { product_id: string; supplier_id: string; supplier_name: string; price: number }> = {};
  for (const row of (data ?? []) as any[]) {
    const price = Number(row.price) || 0;
    const existing = cheapest[row.product_id];
    if (!existing || price < existing.price) {
      cheapest[row.product_id] = {
        product_id: row.product_id,
        supplier_id: row.supplier?.id ?? '',
        supplier_name: row.supplier?.name ?? '',
        price,
      };
    }
  }

  return NextResponse.json({ cheapest });
}
