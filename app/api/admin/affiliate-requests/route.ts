import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyStaff(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return false;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  return data?.role === 'admin' || data?.role === 'assistant';
}

// GET - List affiliate requests (joined with customer), filtered by ?status=
export async function GET(req: NextRequest) {
  if (!(await verifyStaff(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const status = new URL(req.url).searchParams.get('status');
    let query = db
      .from('affiliate_requests')
      .select(`
        *,
        customers!affiliate_requests_customer_id_fkey (first_name, last_name, email)
      `)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const requests = (data || []).map((r: any) => ({
      ...r,
      customer_name: r.customers ? `${r.customers.first_name} ${r.customers.last_name}` : null,
      customer_email: r.customers?.email ?? null,
    }));

    return NextResponse.json({ requests });
  } catch (error: any) {
    console.error('Error listing affiliate requests:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
