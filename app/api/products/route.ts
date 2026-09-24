import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { applyResolvedPrices } from '@/lib/pricing/resolve';

// Public catalogue read. Service-role client (products are public-read, but
// we also resolve per-customer chain pricing for a signed-in customer when
// an Authorization token is present).
//
// Pricing chain (Hybrid H): customer override > active pricelist > products.price.
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

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('slug');
  const addon = request.nextUrl.searchParams.get('addon');
  const customerId = await resolveCustomerId(request);

  // Checkout add-ons: products flagged is_checkout_addon, offered as an upsell
  // on the Stealth Health checkout screen. Store stock is intentionally ignored
  // (Stealth Health fulfils these). Degrades to an empty list if the column is
  // missing (migration not yet run), so the upsell simply hides.
  if (addon === '1' || addon === 'true') {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('active', true)
      .eq('is_checkout_addon', true)
      .order('name', { ascending: true });
    if (error) return NextResponse.json({ products: [] });
    const products = await applyResolvedPrices(supabase, customerId, data ?? []);
    return NextResponse.json({ products });
  }

  if (slug) {
    // Resolve the public url_slug first, then fall back to the SKU slug so
    // links issued before url_slug existed keep working.
    let { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('url_slug', slug)
      .eq('active', true)
      .maybeSingle();

    if (!error && !data) {
      ({ data, error } = await supabase
        .from('products')
        .select('*')
        .eq('slug', slug)
        .eq('active', true)
        .maybeSingle());
    }

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const [product] = await applyResolvedPrices(supabase, customerId, [data]);
    return NextResponse.json({ product });
  }

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('active', true)
    .order('featured', { ascending: false })
    .order('name', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const products = await applyResolvedPrices(supabase, customerId, data ?? []);
  return NextResponse.json({ products });
}
