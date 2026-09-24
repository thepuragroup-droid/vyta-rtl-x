/**
 * Public shipping-address collection for a Stealth Health order.
 *
 *   GET  /api/shipping-address/<token>  — the order behind the emailed link
 *   POST /api/shipping-address/<token>  — store the address the buyer typed
 *
 * The token in the emailed link is the only credential; there is no login. It
 * is 32 random bytes, stored only as a SHA-256 hash, scoped to a single order
 * and expires after 30 days, so a leaked link exposes one order's summary and
 * nothing else. Nothing here can read or change anything but that one order's
 * shipping address and contact name/phone.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { validateShippingAddress } from '@/lib/payments/puramass-address';
import { isShippableCountry } from '@/lib/shipping/regions';
import {
  applySubmittedAddress,
  loadAddressRequestByToken,
} from '@/lib/payments/puramass-address-request';
import { buildOrderSummary } from '@/lib/payments/puramass-order-summary';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Unauthenticated endpoints: generous enough for a customer fixing a typo,
// tight enough that the token space can't be swept.
const READ_LIMIT = { max: 30, windowMs: 60_000 };
const WRITE_LIMIT = { max: 10, windowMs: 60_000 };

/** `da••••@gmail.com` — enough for the buyer to recognise, not enough to harvest. */
function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [user, domain] = email.split('@');
  if (!domain) return null;
  const head = user.slice(0, Math.min(2, user.length));
  return `${head}${'•'.repeat(Math.max(2, user.length - head.length))}@${domain}`;
}

/** Turn a lookup failure into a message the customer can act on. */
function lookupError(reason: 'not_found' | 'expired' | 'order_missing') {
  if (reason === 'expired') {
    return NextResponse.json(
      {
        error: 'expired',
        message:
          'This link has expired. Reply to the email we sent you and we will send a fresh one right away.',
      },
      { status: 410 },
    );
  }
  return NextResponse.json(
    {
      error: 'not_found',
      message:
        "We couldn't find an order for this link. Double-check you copied the whole link, or just reply to our email and we'll sort it out.",
    },
    { status: 404 },
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const ip = getClientIp(req);
  const gate = checkRateLimit(`shipping-address:get:${ip}`, READ_LIMIT);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } },
    );
  }

  const { token } = await params;
  const lookup = await loadAddressRequestByToken(db, token);
  if (!lookup.ok) return lookupError(lookup.reason);

  const summary = await buildOrderSummary(db, lookup.order);

  return NextResponse.json(
    {
      order: {
        reference: summary.reference,
        transaction_id: summary.transaction_id,
        transaction_link: summary.transaction_link,
        invoice_number: summary.invoice_number,
        status: summary.status,
        placed_at: summary.placed_at,
        paid_at: summary.paid_at,
        currency: summary.currency,
        customer_name: summary.customer_name,
        customer_phone: summary.customer_phone,
        customer_email_masked: maskEmail(summary.customer_email),
        items: summary.items,
        subtotal: summary.subtotal,
        shipping: summary.shipping,
        total: summary.total,
        shipping_address: summary.shipping_address,
      },
      request: {
        submitted_at: lookup.request.submitted_at,
        expires_at: lookup.request.expires_at,
      },
    },
    // Personal data behind a bearer-ish token — never cache it anywhere.
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const ip = getClientIp(req);
  const gate = checkRateLimit(`shipping-address:post:${ip}`, WRITE_LIMIT);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'Too many submissions. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } },
    );
  }

  const { token } = await params;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid', message: 'Invalid request.' }, { status: 400 });
  }

  const lookup = await loadAddressRequestByToken(db, token);
  if (!lookup.ok) return lookupError(lookup.reason);

  const { ok, errors, value } = validateShippingAddress({
    full_name: body?.full_name,
    phone: body?.phone,
    address: body?.address,
    address2: body?.address2,
    city: body?.city,
    state: body?.state,
    zip: body?.zip,
    country: body?.country,
  });
  if (ok && !isShippableCountry(value.address.country)) {
    return NextResponse.json(
      {
        error: 'invalid',
        message: 'We only ship within Canada.',
        errors: { country: 'We only ship within Canada.' },
      },
      { status: 400 },
    );
  }
  if (!ok) {
    return NextResponse.json(
      { error: 'invalid', message: 'Please check the highlighted fields.', errors },
      { status: 400 },
    );
  }

  const saved = await applySubmittedAddress(db, lookup.request, lookup.order, value, { ip });
  if (!saved.ok) {
    return NextResponse.json({ error: 'save_failed', message: saved.error }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    address: saved.address,
    full_name: value.full_name,
    phone: value.phone,
    submitted_at: new Date().toISOString(),
  });
}
