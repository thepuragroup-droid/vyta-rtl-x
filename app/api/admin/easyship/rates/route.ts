import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchEasyshipRates } from '@/lib/easyship';
import type { EasyshipRateRequest } from '@/lib/types/ecommerce';

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

// POST /api/admin/easyship/rates
export async function POST(req: NextRequest) {
  if (!await verifyAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json();
  const { order_id, ...ratePayload } = body as { order_id?: string } & EasyshipRateRequest;

  try {
    const rates = await fetchEasyshipRates(ratePayload);
    return NextResponse.json({ rates });
  } catch (err: any) {
    console.error('Easyship rates error:', err);
    return NextResponse.json({ error: err.message ?? 'Failed to fetch rates' }, { status: 502 });
  }
}
