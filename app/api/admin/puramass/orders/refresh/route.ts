import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { UserRole } from '@/lib/permissions';
import {
  isPuramassConfigured,
  fetchPuramassOrderStatus,
  buildPuramassContactPatch,
  buildPuramassOrderDetailPatch,
  PuramassApiError,
} from '@/lib/payments/puramass';
import { materializeStealthHealthFulfillment } from '@/lib/payments/puramass-fulfillment';
import { isMissingColumnError, stripUnmigratedFields } from '@/lib/payments/puramass-columns';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyReadAccess(req: NextRequest): Promise<boolean> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return false;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  const role = (data?.role ?? 'customer') as UserRole;
  return role === 'admin' || role === 'assistant';
}

/**
 * POST /api/admin/puramass/orders/refresh — manual/backfill counterpart to the
 * webhook. Polls PuraMass for the current order status and updates the ledger
 * row's status / paid_at / currency / subtotal, plus the shipping address and
 * buyer contact PuraMass captured on its hosted page. Unlike the cron poller
 * this runs on any row, so it is how an already-paid historical order gets its
 * address backfilled. Admin/assistant only.
 */
export async function POST(req: NextRequest) {
  if (!(await verifyReadAccess(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (!isPuramassConfigured()) {
    return NextResponse.json({ error: 'Stealth Health is not configured.' }, { status: 503 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const transactionId = String(body?.transaction_id ?? '').trim();
  if (!transactionId) {
    return NextResponse.json({ error: 'transaction_id is required.' }, { status: 400 });
  }

  let status;
  try {
    status = await fetchPuramassOrderStatus(transactionId);
  } catch (err) {
    if (err instanceof PuramassApiError) {
      if (err.status >= 400 && err.status < 500) {
        return NextResponse.json({ error: err.detail }, { status: err.status });
      }
      return NextResponse.json({ error: 'Could not reach Stealth Health.' }, { status: 502 });
    }
    return NextResponse.json({ error: 'Could not reach Stealth Health.' }, { status: 502 });
  }

  // Read the row first so the address/contact patch can diff against what is
  // already stored — a payload that omits those blocks must not clear them.
  // A miss here (columns not migrated yet) just means "nothing stored".
  const { data: existing } = await db
    .from('puramass_orders')
    .select(
      'shipping_address, shipping_address_source, customer_name, customer_phone, customer_email',
    )
    .eq('transaction_id', transactionId)
    .maybeSingle();

  const update: Record<string, unknown> = {};
  if (status.status) update.status = status.status;
  if (status.currency) update.currency = status.currency;
  if (typeof status.subtotal_cents === 'number') update.subtotal_cents = status.subtotal_cents;
  if (status.status === 'paid') {
    update.paid_at = status.paid_at ?? new Date().toISOString();
  }
  Object.assign(
    update,
    buildPuramassContactPatch(existing ?? {}, {
      shipping: status.shipping,
      customer: status.customer,
    }),
  );
  // Link expiry, refunds and the priced items — what /admin/invoices shows for
  // this order. A manual refresh is the only way a terminal (paid) order picks
  // up a refund reported after payment.
  Object.assign(
    update,
    buildPuramassOrderDetailPatch({
      expires_at: status.expires_at,
      refunded_total_cents: status.refunded_total_cents,
      refunds: status.refunds,
      items: status.items,
    }),
  );

  let { data: row, error } = await db
    .from('puramass_orders')
    .update(update)
    .eq('transaction_id', transactionId)
    .select(
      'id, status, paid_at, currency, subtotal_cents, shipping_total_cents, shipping_courier_id, customer_id, customer_email, customer_name, customer_phone, shipping_address, shipping_address_source, items, invoice_id, referral_code',
    )
    .maybeSingle();

  // Shipping columns not queryable yet — keep the address ones, which come
  // from an earlier migration and may well be there.
  if (error && isMissingColumnError(error)) {
    ({ data: row, error } = await db
      .from('puramass_orders')
      .update(update)
      .eq('transaction_id', transactionId)
      .select(
        'id, status, paid_at, currency, subtotal_cents, customer_id, customer_email, customer_name, customer_phone, shipping_address, shipping_address_source, items, invoice_id, referral_code',
      )
      .maybeSingle() as any);
  }

  // Address columns not queryable yet either — still apply the status refresh.
  if (error && isMissingColumnError(error)) {
    ({ data: row, error } = await db
      .from('puramass_orders')
      .update(stripUnmigratedFields(update))
      .eq('transaction_id', transactionId)
      .select(
        'id, status, paid_at, currency, subtotal_cents, customer_id, customer_email, items, invoice_id, referral_code',
      )
      .maybeSingle() as any);
  }

  if (error) {
    console.error('[puramass] refresh update failed:', error);
    return NextResponse.json(
      { error: `Could not update the order: ${error.message}` },
      { status: 500 },
    );
  }
  if (!row) {
    return NextResponse.json({ error: 'No matching order found.' }, { status: 404 });
  }

  // Backfill the fulfillment-queue invoice if this poll is what confirms payment
  // (idempotent; best-effort).
  if (status.status === 'paid') {
    await materializeStealthHealthFulfillment(
      db,
      {
        id: row.id,
        customer_id: row.customer_id,
        customer_email: row.customer_email,
        customer_name: row.customer_name,
        items: row.items,
        subtotal_cents: row.subtotal_cents,
        invoice_id: row.invoice_id,
        referral_code: row.referral_code,
      },
      Array.isArray(status.items) ? status.items : [],
    );
  }

  return NextResponse.json({ success: true, status: status.status, order: row });
}
