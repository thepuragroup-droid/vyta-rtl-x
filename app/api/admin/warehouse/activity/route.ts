import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getWarehouseActivity } from '@/lib/admin/warehouse-staff';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyAdmin(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return false;
  const {
    data: { user },
  } = await db.auth.getUser(token);
  if (!user) return false;
  const { data } = await db
    .from('customers')
    .select('role')
    .eq('id', user.id)
    .single();
  return data?.role === 'admin' || data?.role === 'assistant';
}

// GET /api/admin/warehouse/activity
export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  const activity = await getWarehouseActivity();
  return NextResponse.json(activity);
}
