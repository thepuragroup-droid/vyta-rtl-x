import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

// POST /api/orders — DISABLED (410 Gone).
// The legacy crypto-checkout path. New orders go through the Stealth Health
// hosted checkout (/api/checkout/puramass). This route now only serves the public order lookup used
// by the tracking page, so it deliberately avoids importing the crypto wallet /
// price-feed modules (which can fail at module load and 500 the whole route).
export async function POST() {
  return NextResponse.json(
    {
      error: 'Crypto checkout is no longer accepted at this endpoint.',
      hint: 'Use the hosted checkout at /checkout.',
    },
    { status: 410 },
  );
}

// GET /api/orders?orderNumber=...&email=... — public order lookup for the
// tracking page.
//
// Access control: knowing an 8-char order number is NOT sufficient (order
// numbers are short and guessable, and the row contains the customer's full
// name, address, phone and email). The caller must also supply the email the
// order was placed with; a mismatch returns the same 404 as "not found" so the
// endpoint can't be used to probe which order numbers exist. Only a curated,
// non-sensitive subset of columns is ever returned.
export async function GET(req: NextRequest) {
  const orderNumber = req.nextUrl.searchParams.get('orderNumber')?.trim();
  const email = req.nextUrl.searchParams.get('email')?.trim().toLowerCase();
  if (!orderNumber) {
    return NextResponse.json({ error: 'Order number required' }, { status: 400 });
  }
  if (!email) {
    return NextResponse.json(
      { error: 'Enter the email address used on the order to view it.' },
      { status: 400 },
    );
  }

  // Uniform "not found" response — never reveal whether the order number exists
  // when the email doesn't match.
  const notFound = () =>
    NextResponse.json(
      { error: 'No order found matching that order number and email.' },
      { status: 404 },
    );

  try {
    const db = getSupabase();
    const { data, error } = await db
      .from('orders')
      .select(
        'order_number, email, status, items, total, subtotal, shipping_cost, discount_total, shipping_address, shipping_carrier, shipping_method, fulfillment_type, tracking_number, tracking_url, tracking_status, created_at, shipped_at, delivered_at',
      )
      .eq('order_number', orderNumber)
      .maybeSingle();

    if (error) {
      console.error('Order lookup error:', error);
      return NextResponse.json({ error: 'Failed to look up order' }, { status: 500 });
    }
    if (!data) return notFound();
    if (String(data.email ?? '').trim().toLowerCase() !== email) {
      return notFound();
    }

    // Strip the email out of the response — the caller already knows it, and it
    // never needs to travel back to the browser.
    const { email: _omit, ...safe } = data as Record<string, unknown>;
    return NextResponse.json(safe);
  } catch (e: any) {
    console.error('Order lookup threw:', e?.message ?? e);
    return NextResponse.json({ error: 'Failed to look up order' }, { status: 500 });
  }
}
