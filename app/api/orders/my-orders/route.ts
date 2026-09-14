import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  // The browser session is token-based (localStorage), so authenticate via the
  // Authorization: Bearer <access_token> header rather than cookies.
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const db = getSupabase();
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { data: orders, error } = await db
    .from('orders')
    .select('order_number, status, total, crypto, payment_tx_hash, tracking_number, created_at')
    .eq('customer_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
  }

  return NextResponse.json(orders || []);
}
