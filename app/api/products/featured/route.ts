import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { applyResolvedPrices } from '@/lib/pricing/resolve';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function resolveCustomerId(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;
  try {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(token);
    return user?.id ?? null;
  } catch {
    return null;
  }
}

// Public: active + featured products. Applies Hybrid H pricing chain
// (customer override > active pricelist > base) when a bearer token is set.
export async function GET(request: NextRequest) {
  const customerId = await resolveCustomerId(request);

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('active', true)
    .eq('featured', true)
    .order('name', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const products = await applyResolvedPrices(supabase, customerId, data ?? []);
  return NextResponse.json({ products });
}
