import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verifyAdminRole(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) return { authorized: false };
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return { authorized: false };
    const { data: customer } = await supabase
      .from('customers')
      .select('role')
      .eq('id', user.id)
      .single();
    const role = customer?.role || 'customer';
    return { authorized: role === 'admin' || role === 'assistant' };
  } catch {
    return { authorized: false };
  }
}

/**
 * Admin waitlist read.
 *   ?product_id= -> { emails, count }  (oldest-first; for restock dialog)
 *   no param     -> { products, totalRequests }  (aggregated per product,
 *                    sorted by count desc)
 */
export async function GET(request: NextRequest) {
  const { authorized } = await verifyAdminRole(request);
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const productId = request.nextUrl.searchParams.get('product_id');

  if (productId) {
    const { data, error } = await supabase
      .from('stock_notifications')
      .select('email, created_at')
      .eq('product_id', productId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const emails = (data ?? []).map((r) => r.email);
    return NextResponse.json({ emails, count: emails.length });
  }

  // Aggregate all pending requests per product.
  const { data, error } = await supabase
    .from('stock_notifications')
    .select('product_id, created_at, products(id, name, slug, image_url, price, stock_quantity)')
    .eq('status', 'pending');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const map = new Map<string, any>();
  for (const row of data ?? []) {
    const p: any = row.products;
    if (!p) continue;
    const existing = map.get(row.product_id);
    if (existing) {
      existing.count += 1;
      if (row.created_at > existing.latest_request) existing.latest_request = row.created_at;
    } else {
      map.set(row.product_id, {
        product_id: row.product_id,
        name: p.name,
        slug: p.slug,
        image_url: p.image_url,
        price: p.price,
        stock_quantity: p.stock_quantity,
        count: 1,
        latest_request: row.created_at,
      });
    }
  }

  const products = Array.from(map.values()).sort((a, b) => b.count - a.count);
  const totalRequests = (data ?? []).length;

  return NextResponse.json({ products, totalRequests });
}
