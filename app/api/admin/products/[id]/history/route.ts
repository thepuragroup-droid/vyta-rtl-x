import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getProductHistory } from '@/lib/admin/product-history';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Read access: any admin or assistant (view-only roles included). */
async function verifyAdminRead(request: NextRequest): Promise<boolean> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) return false;

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return false;

    const { data: customer } = await supabase
      .from('customers')
      .select('role')
      .eq('id', user.id)
      .single();

    const role = customer?.role || 'customer';
    return role === 'admin' || role === 'assistant' || role === 'analytics';
  } catch (err) {
    console.error('verifyAdminRead threw:', err);
    return false;
  }
}

// GET /api/admin/products/[id]/history
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!(await verifyAdminRead(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') ?? '500');
    const history = await getProductHistory(supabase, id, Number.isFinite(limit) ? limit : 500);
    return NextResponse.json({ history });
  } catch (error) {
    console.error('Error fetching product history:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
