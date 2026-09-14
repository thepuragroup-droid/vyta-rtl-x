import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function requireStaff(req: NextRequest): Promise<boolean> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return false;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  const role = data?.role ?? 'customer';
  return role === 'admin' || role === 'assistant';
}

// GET /api/admin/backorders/count — open backorder count for the nav badge.
export async function GET(req: NextRequest) {
  if (!(await requireStaff(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { count, error } = await db
    .from('backorders')
    .select('id', { head: true, count: 'exact' })
    .eq('status', 'open');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ count: count ?? 0 });
}
