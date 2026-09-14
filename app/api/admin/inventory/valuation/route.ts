import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { ValuationResult, ValuationRow } from '@/lib/types/ecommerce';

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
  return data?.role === 'admin' || data?.role === 'assistant';
}

export async function GET(req: NextRequest) {
  if (!await verifyAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  // Join product_variants → products to get cost_price and qty
  const { data, error } = await db
    .from('product_variants')
    .select(`
      id,
      sku,
      option_name,
      option_value,
      qty_on_hand,
      products (
        id,
        name,
        cost_price
      )
    `);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows: ValuationRow[] = (data ?? []).map((v: any) => {
    const cost = Number(v.products?.cost_price ?? 0);
    return {
      product_id: v.products?.id ?? '',
      product_name: v.products?.name ?? 'Unknown',
      sku: v.sku,
      option_name: v.option_name,
      option_value: v.option_value,
      qty_on_hand: v.qty_on_hand,
      cost_price: cost,
      line_value: cost * v.qty_on_hand,
    };
  });

  const result: ValuationResult = {
    rows,
    total_value: rows.reduce((s, r) => s + r.line_value, 0),
    total_units: rows.reduce((s, r) => s + r.qty_on_hand, 0),
  };

  return NextResponse.json(result);
}
