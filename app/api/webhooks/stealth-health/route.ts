import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  isPuramassWebhookConfigured,
  verifyPuramassSignature,
  buildPuramassContactPatch,
  buildPuramassOrderDetailPatch,
} from '@/lib/payments/puramass';
import {
  materializeStealthHealthFulfillment,
  expireStealthHealthInvoices,
} from '@/lib/payments/puramass-fulfillment';
import { isMissingColumnError, stripUnmigratedFields } from '@/lib/payments/puramass-columns';
import { attributeHostedPurchase } from '@/lib/analytics/attribution-server';
import { logWebhookEvent, type WebhookOutcome } from '@/lib/payments/puramass-webhook-log';

// Needs the raw request body + node:crypto (via the client) for HMAC verify.
export const runtime = 'nodejs';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Columns the base puramass-hosted-checkout migration created — always there.
const LEDGER_BASE =
  'id, status, last_event_id, transaction_id, customer_id, customer_email, items, ' +
  'subtotal_cents, invoice_id, referral_code, currency';

// Progressively smaller selects, newest migration shed first. Payment
// confirmation must never depend on a migration having been run, but it also
// must not throw away the address columns just because a later migration is
// outstanding — hence a tier per migration rather than one all-or-nothing
// fallback.
const LEDGER_SELECTS = [
  // + puramass-hosted-shipping-migration.sql
  `${LEDGER_BASE}, shipping_total_cents, shipping_courier_id, shipping_address, shipping_address_source, customer_name, customer_phone`,
  // + puramass-shipping-address-migration.sql
  `${LEDGER_BASE}, shipping_address, shipping_address_source, customer_name, customer_phone`,
  LEDGER_BASE,
];

async function findLedgerRow(column: string, value: string): Promise<any> {
  for (const select of LEDGER_SELECTS) {
    const { data, error } = await db
      .from('puramass_orders')
      .select(select)
      .eq(column, value)
      .maybeSingle();
    if (!error) return data;
    if (!isMissingColumnError(error)) return null;
  }
  return null;
}

/**
 * POST /api/webhooks/stealth-health — receive PuraMass status events
 * (`store_order.payment_complete`) and apply them to the hand-off ledger.
 *
 * Public: the HMAC signature is the auth. At-least-once delivery, so events are
 * deduped on `event_id`. Any authentic event is ACKed 2xx within the delivery
 * window (even unmatched/unknown) so it isn't retried forever; only
 * signature/secret/DB-write failures return non-2xx to trigger a retry.
 *
 * Every delivery — authentic or not, matched or not — is recorded in
 * `puramass_webhook_events` with its body and our response.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const ctx: DeliveryContext = { signatureValid: false };

  let result: HandlerResult;
  try {
    result = await handle(req, raw, ctx);
  } catch (err) {
    console.error('[stealth-health] webhook handler threw:', err);
    result = {
      outcome: 'error',
      status: 500,
      body: { error: 'internal error' },
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Record every delivery — what arrived and what we answered.
  await logWebhookEvent(db, {
    raw,
    payload: ctx.payload,
    signatureValid: ctx.signatureValid,
    outcome: result.outcome,
    responseStatus: result.status,
    responseBody: result.body,
    puramassOrderId: ctx.orderId ?? null,
    error: result.error ?? null,
  });

  return NextResponse.json(result.body, { status: result.status });
}

interface DeliveryContext {
  signatureValid: boolean;
  payload?: unknown;
  orderId?: string;
}

interface HandlerResult {
  outcome: WebhookOutcome;
  status: number;
  body: Record<string, unknown>;
  error?: string;
}

function reply(
  outcome: WebhookOutcome,
  body: Record<string, unknown>,
  status: number,
  error?: string,
): HandlerResult {
  return { outcome, status, body, error };
}

async function handle(req: NextRequest, raw: string, ctx: DeliveryContext): Promise<HandlerResult> {

  // Missing secret → fail with 500 (we cannot authenticate the event).
  if (!isPuramassWebhookConfigured()) {
    console.error('[stealth-health] PURAMASS_WEBHOOK_SECRET not set — rejecting');
    return reply('not_configured', { error: 'webhook not configured' }, 500);
  }

  // Verify HMAC-SHA256 over the raw body.
  const signature = req.headers.get('x-stealth-signature');
  if (!verifyPuramassSignature(raw, signature)) {
    return reply('bad_signature', { error: 'bad signature' }, 401);
  }
  ctx.signatureValid = true;

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Authentic but unparseable — ACK so it isn't retried forever.
    return reply('unparseable', { received: true, matched: false }, 200);
  }
  ctx.payload = payload;

  const eventId: string | null = payload?.event_id ?? null;
  const partnerReference: string | null = payload?.partner_reference ?? null;
  const data = payload?.data ?? {};
  // The order body may be the event data itself or nested under `order`
  // (the same shape `GET /partner/store/orders/{id}` returns).
  const orderBody = data?.order ?? payload?.order ?? data;
  const transactionId: string | null = data?.transaction_id ?? data?.order_id ?? null;
  const status: string | null = data?.status ?? null;
  const currency: string | null = data?.currency ?? null;
  const occurredAt: string | null = data?.occurred_at ?? payload?.created_at ?? null;

  // Match by transaction_id first, then partner_reference.
  let row: any = null;
  if (transactionId) {
    row = await findLedgerRow('transaction_id', transactionId);
  }
  if (!row && partnerReference) {
    row = await findLedgerRow('partner_reference', partnerReference);
  }

  // Unknown order — ACK so PuraMass stops retrying.
  if (!row) {
    return reply('unmatched', { received: true, matched: false }, 200);
  }
  ctx.orderId = row.id;

  // Idempotency: already processed this exact event.
  if (eventId && row.last_event_id === eventId) {
    return reply('deduped', { received: true, deduped: true }, 200);
  }

  const update: Record<string, unknown> = {};
  if (status) update.status = status;
  if (eventId) update.last_event_id = eventId;
  if (currency) update.currency = currency;
  if (status === 'paid') update.paid_at = occurredAt ?? new Date().toISOString();
  // Fill the transaction id when we matched by partner_reference.
  if (transactionId && !row.transaction_id) update.transaction_id = transactionId;

  // PuraMass collects the shipping address on its hosted page and reports it
  // back here. Only non-empty, changed fields are written, so an event without
  // a `shipping` block never clears an address we already captured.
  Object.assign(
    update,
    buildPuramassContactPatch(row, {
      shipping: orderBody?.shipping,
      customer: orderBody?.customer,
    }),
  );

  // Link expiry, refunds and the priced items PuraMass charged for. The admin
  // invoice pages read these off the ledger, so a refund reported here shows on
  // the invoice rather than only inside PuraMass.
  Object.assign(
    update,
    buildPuramassOrderDetailPatch({
      expires_at: orderBody?.expires_at,
      refunded_total_cents: orderBody?.refunded_total_cents,
      refunds: orderBody?.refunds,
      items: orderBody?.items,
    }),
  );

  if (Object.keys(update).length > 0) {
    let { error } = await db.from('puramass_orders').update(update).eq('id', row.id);
    // The address / order-detail columns may not exist yet — never let that
    // block the payment status write. Retry with just the fields that have
    // always been there.
    if (error && isMissingColumnError(error)) {
      console.warn('[stealth-health] optional columns unavailable, writing status only');
      const fallback = stripUnmigratedFields(update);
      ({ error } = Object.keys(fallback).length > 0
        ? await db.from('puramass_orders').update(fallback).eq('id', row.id)
        : { error: null });
    }
    if (error) {
      // DB write failure → non-2xx so PuraMass retries.
      console.error('[stealth-health] ledger update failed:', error);
      return reply('update_failed', { error: 'update failed' }, 500, error.message);
    }
  }

  // On payment, flip the order's invoice to paid (or create it for an older
  // hand-off), which surfaces it in the warehouse queue, takes the stock and
  // emails the admins (idempotent; best-effort — never blocks the ACK).
  if (status === 'paid') {
    // Credit the campaign that won this buyer. The email is the only link back
    // to their pre-checkout visit — PuraMass owns the payment page, so no
    // cookie of ours reaches it.
    await attributeHostedPurchase(db, {
      id: row.id,
      customer_email: (update.customer_email as string) ?? row.customer_email,
      attribution_channel: (row as any).attribution_channel ?? null,
    });

    await materializeStealthHealthFulfillment(
      db,
      {
        id: row.id,
        customer_id: row.customer_id,
        customer_email: (update.customer_email as string) ?? row.customer_email,
        customer_name: (update.customer_name as string) ?? row.customer_name,
        items: row.items,
        subtotal_cents: row.subtotal_cents,
        invoice_id: row.invoice_id,
        referral_code: row.referral_code,
      },
      Array.isArray(orderBody?.items) ? orderBody.items : [],
    );
  }

  // An unpaid link that lapsed or was cancelled takes its pending invoice with
  // it, so it never reads as money owed.
  if (status === 'expired' || status === 'cancelled') {
    await expireStealthHealthInvoices(db, [row.invoice_id]);
  }

  return reply('matched', { received: true, matched: true }, 200);
}
