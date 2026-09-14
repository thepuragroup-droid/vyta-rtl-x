import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Public back-in-stock waitlist endpoint. Service-role client; the partial
// unique index (product_id, email) WHERE status='pending' makes subscribe
// idempotent. Emails are stored lower-cased for case-insensitive dedupe.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET ?product_id=&email= -> { subscribed }
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const productId = params.get('product_id');
  const email = (params.get('email') || '').trim().toLowerCase();

  if (!productId || !email) {
    return NextResponse.json({ error: 'Missing product_id or email' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('stock_notifications')
    .select('id')
    .eq('product_id', productId)
    .eq('email', email)
    .eq('status', 'pending')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ subscribed: !!data });
}

// POST { product_id, email, customer_id? } -> idempotent subscribe
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const productId = body.product_id as string | undefined;
    const email = (body.email || '').trim().toLowerCase();
    const customerId = (body.customer_id as string | undefined) || null;

    if (!productId || !email) {
      return NextResponse.json({ error: 'Missing product_id or email' }, { status: 400 });
    }
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    // Confirm the product exists.
    const { data: product } = await supabase
      .from('products')
      .select('id')
      .eq('id', productId)
      .maybeSingle();
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    // Already subscribed?
    const { data: existing } = await supabase
      .from('stock_notifications')
      .select('id')
      .eq('product_id', productId)
      .eq('email', email)
      .eq('status', 'pending')
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ success: true, alreadySubscribed: true });
    }

    const { error } = await supabase.from('stock_notifications').insert({
      product_id: productId,
      email,
      customer_id: customerId,
      status: 'pending',
    });

    if (error) {
      // Unique-violation race -> treat as already subscribed.
      if (error.code === '23505') {
        return NextResponse.json({ success: true, alreadySubscribed: true });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}

// DELETE { product_id, email } -> cancel the pending row
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const productId = body.product_id as string | undefined;
    const email = (body.email || '').trim().toLowerCase();

    if (!productId || !email) {
      return NextResponse.json({ error: 'Missing product_id or email' }, { status: 400 });
    }

    const { error } = await supabase
      .from('stock_notifications')
      .update({ status: 'cancelled' })
      .eq('product_id', productId)
      .eq('email', email)
      .eq('status', 'pending');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
