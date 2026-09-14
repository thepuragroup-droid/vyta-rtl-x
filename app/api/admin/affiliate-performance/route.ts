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

// GET - per-affiliate { bound_customers, customer_revenue } (excludes cancelled orders)
export async function GET(req: NextRequest) {
  if (!(await verifyStaff(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    // All customers bound to an affiliate.
    const { data: bound } = await db
      .from('customers')
      .select('id, affiliate_id')
      .not('affiliate_id', 'is', null);

    const byAffiliate = new Map<string, { customerIds: string[] }>();
    for (const c of bound || []) {
      const key = c.affiliate_id as string;
      if (!byAffiliate.has(key)) byAffiliate.set(key, { customerIds: [] });
      byAffiliate.get(key)!.customerIds.push(c.id);
    }

    const performance: Record<string, { bound_customers: number; customer_revenue: number }> = {};

    for (const [affiliateId, { customerIds }] of byAffiliate.entries()) {
      let revenue = 0;
      if (customerIds.length > 0) {
        const { data: orders } = await db
          .from('orders')
          .select('total, status, customer_id')
          .in('customer_id', customerIds)
          .neq('status', 'cancelled');
        revenue = (orders || []).reduce((s, o: any) => s + Number(o.total || 0), 0);
      }
      performance[affiliateId] = {
        bound_customers: customerIds.length,
        customer_revenue: Math.round((revenue + Number.EPSILON) * 100) / 100,
      };
    }

    return NextResponse.json({ performance });
  } catch (error: any) {
    console.error('Error computing affiliate performance:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
