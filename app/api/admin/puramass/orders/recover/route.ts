/**
 * POST /api/admin/puramass/orders/recover
 *
 * Email an abandoned checkout back to the buyer: their cart, the hosted payment
 * link that still takes payment, and — optionally — a promo code with the
 * discount stated as a percentage or a fixed amount.
 *
 * Admin/assistant only, the same bar as the sync / refresh / request-address
 * actions it sits beside on /admin/stealth-health (Orders tab).
 *
 * The discount is PRESENTATION. Nothing here issues, reserves or validates a
 * code: codes are generated on app.puramass.com, and PuraMass applies the real
 * discount when the buyer types the code on its checkout page. The type and
 * amount entered here decide how the offer is worded and what the email's
 * "estimated total" says, nothing more.
 *
 * Body: {
 *   id: string,                      // puramass_orders.id
 *   subject: string, body: string,   // as typed in the composer
 *   templateKey?: string,
 *   email?: string,                  // override recipient
 *   cc?: string | string[],
 *   promoCode?: string,
 *   discountType?: 'percentage' | 'fixed',
 *   discountValue?: number | string,
 *   promoDetails?: string,           // overrides the generated headline
 *   promoExpires?: string,
 *   includeCart?: boolean            // default true
 * }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { UserRole } from '@/lib/permissions';
import { logAuditServer } from '@/lib/admin/audit';
import { isMissingEmailTable } from '@/lib/admin/crm-actions';
import {
  looksLikeEmail,
  normalizeDiscount,
  RECOVERY_TEMPLATE_MAP,
} from '@/lib/customer/promo-email';
import { loadLedgerRow, parseCcList } from '@/lib/payments/puramass-address-request';
import { buildOrderSummary } from '@/lib/payments/puramass-order-summary';
import {
  buildRecoveryEmailInput,
  cartFromSummary,
  checkoutNote,
  loadRecoveryState,
  recoveryFirstName,
  sendRecoveryEmail,
  stampRecoverySend,
  MAX_RECOVERY_CC,
  RECOVERABLE_STATUSES,
} from '@/lib/payments/puramass-recovery';

// nodemailer needs the node runtime.
export const runtime = 'nodejs';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type Caller =
  | { ok: false }
  | { ok: true; actorId: string; actorEmail: string | null; actorName: string | null };

async function verifyCaller(req: NextRequest): Promise<Caller> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { ok: false };
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { ok: false };
  const { data } = await db
    .from('customers')
    .select('role, email, first_name, last_name')
    .eq('id', user.id)
    .single();
  const role = (data?.role ?? 'customer') as UserRole;
  if (role !== 'admin' && role !== 'assistant') return { ok: false };
  const name = `${data?.first_name ?? ''} ${data?.last_name ?? ''}`.trim();
  return {
    ok: true,
    actorId: user.id,
    actorEmail: data?.email ?? user.email ?? null,
    actorName: name || null,
  };
}

/**
 * GET /api/admin/puramass/orders/recover?id=… — everything the composer needs
 * to draft a recovery email for one hand-off.
 *
 * The cart comes back already resolved to product names and prices, built by
 * the same `buildOrderSummary` the send uses. That matters: the composer
 * previews the email with this payload, so a preview drawn from raw ledger SKUs
 * would show the admin something different from what the customer receives.
 */
export async function GET(req: NextRequest) {
  const caller = await verifyCaller(req);
  if (!caller.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const id = String(req.nextUrl.searchParams.get('id') ?? '').trim();
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });

  const order = await loadLedgerRow(db, id);
  if (!order) {
    return NextResponse.json({ error: 'No matching order found.' }, { status: 404 });
  }

  const [summary, recovery] = await Promise.all([
    buildOrderSummary(db, order),
    loadRecoveryState(db, order.id),
  ]);

  return NextResponse.json({
    order: {
      id: order.id,
      reference: order.partner_reference,
      status: order.status,
      payment_link: order.payment_link,
      customer_email: order.customer_email,
      customer_name: order.customer_name,
      created_at: order.created_at,
      recoverable: RECOVERABLE_STATUSES.includes(
        order.status as (typeof RECOVERABLE_STATUSES)[number],
      ),
    },
    firstName: recoveryFirstName(order),
    cart: cartFromSummary(summary),
    checkoutNote: checkoutNote(order.status),
    senderName: caller.actorName,
    recovery,
  });
}

export async function POST(req: NextRequest) {
  const caller = await verifyCaller(req);
  if (!caller.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = String(body?.id ?? '').trim();
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });

  const subject = String(body?.subject ?? '').trim();
  const message = String(body?.body ?? '').trim();
  if (!subject) return NextResponse.json({ error: 'A subject is required.' }, { status: 400 });
  if (!message) return NextResponse.json({ error: 'The message body is empty.' }, { status: 400 });

  const templateKey = String(body?.templateKey ?? 'custom');
  if (!RECOVERY_TEMPLATE_MAP[templateKey]) {
    return NextResponse.json({ error: 'Unknown template' }, { status: 400 });
  }

  const order = await loadLedgerRow(db, id);
  if (!order) {
    return NextResponse.json({ error: 'No matching order found.' }, { status: 404 });
  }

  // A paid order has nothing to recover, and telling that customer their cart
  // is waiting would be worse than sending nothing at all.
  if (!RECOVERABLE_STATUSES.includes(order.status as (typeof RECOVERABLE_STATUSES)[number])) {
    return NextResponse.json(
      {
        error:
          order.status === 'paid'
            ? 'This checkout was paid — there is nothing to recover.'
            : `A ${order.status.replace(/_/g, ' ')} order cannot be recovered.`,
      },
      { status: 409 },
    );
  }

  const override = typeof body?.email === 'string' ? body.email.trim() : '';
  if (override && !looksLikeEmail(override)) {
    return NextResponse.json({ error: 'That email address is not valid.' }, { status: 400 });
  }
  const to = override || order.customer_email || '';
  if (!to) {
    return NextResponse.json(
      { error: 'This hand-off has no customer email — there is nobody to email.' },
      { status: 400 },
    );
  }

  // A mistyped CC is reported rather than dropped: a copy that silently
  // vanishes looks like a delivery failure days later.
  const cc = parseCcList(body?.cc, to);
  if (cc.invalid.length > 0) {
    return NextResponse.json(
      { error: `Not a valid email address: ${cc.invalid.join(', ')}`, field: 'cc' },
      { status: 400 },
    );
  }
  if (cc.truncated) {
    return NextResponse.json(
      { error: `You can copy at most ${MAX_RECOVERY_CC} people on one email.`, field: 'cc' },
      { status: 400 },
    );
  }

  const promoCode = String(body?.promoCode ?? '').trim().toUpperCase() || null;
  const promoDetails = String(body?.promoDetails ?? '').trim() || null;
  const promoExpires = String(body?.promoExpires ?? '').trim() || null;

  // An amount that isn't a usable discount is rejected rather than ignored: an
  // admin who typed "150" into a percentage field must not have it silently
  // dropped and send a bare reminder they think carries an offer.
  const discountRequested =
    body?.discountType != null && String(body.discountType).trim() !== '' &&
    body?.discountValue != null && String(body.discountValue).trim() !== '';
  const discount = discountRequested
    ? normalizeDiscount(String(body.discountType).trim(), body.discountValue)
    : null;
  if (discountRequested && !discount) {
    return NextResponse.json(
      {
        error:
          'The discount must be a positive amount, and a percentage cannot be more than 100.',
        field: 'discount',
      },
      { status: 400 },
    );
  }
  // A code without an amount is fine (the code speaks for itself); an amount
  // with no code is not — there would be nothing for the buyer to enter.
  if (discount && !promoCode && !promoDetails) {
    return NextResponse.json(
      {
        error:
          'Add the promo code the discount belongs to, or describe the offer, so the customer knows how to claim it.',
        field: 'promoCode',
      },
      { status: 400 },
    );
  }

  const summary = await buildOrderSummary(db, order);
  const previous = await loadRecoveryState(db, order.id);

  const input = buildRecoveryEmailInput({
    summary,
    status: order.status,
    firstName: recoveryFirstName(order),
    subject,
    body: message,
    promoCode,
    promoDetails,
    promoExpires,
    discount,
    senderName: caller.actorName,
    paymentLink: order.payment_link,
    includeCart: body?.includeCart !== false,
  });

  const sent = await sendRecoveryEmail({
    to,
    cc: cc.list,
    replyTo: caller.actorEmail,
    input,
  });

  // Logged either way — a failed send stays visible in the history so nobody
  // re-sends blind.
  const { error: logError } = await db.from('customer_emails').insert({
    scope: 'customer',
    customer_id: order.customer_id,
    to_email: to,
    cc_emails: cc.list,
    subject: sent.subject,
    body_html: sent.html,
    template: templateKey,
    promo_code: promoCode,
    promo_details: promoDetails,
    promo_expires: promoExpires,
    sent_by_id: caller.actorId,
    sent_by_email: caller.actorEmail,
    sent_by_name: caller.actorName,
    success: sent.success,
    error: sent.error ?? null,
    message_id: sent.messageId ?? null,
  });
  if (logError && !isMissingEmailTable(logError)) {
    console.error('[puramass] recovery log insert failed:', logError.message);
  }

  if (!sent.success) {
    return NextResponse.json(
      { error: `The recovery email could not be sent: ${sent.error ?? 'the mail server rejected it.'}` },
      { status: 502 },
    );
  }

  const stamp = await stampRecoverySend(db, order.id, {
    previousCount: previous.recovery_email_count,
    promoCode,
    discount,
  });

  await logAuditServer(
    db,
    { actor_id: caller.actorId, actor_email: caller.actorEmail },
    {
      action: 'puramass.recovery_email_sent',
      entity_type: 'puramass_order',
      entity_id: order.id,
    },
  );

  return NextResponse.json({
    ok: true,
    to,
    cc: cc.list,
    subject: sent.subject,
    sent_at: stamp.sent_at,
    attempt: previous.recovery_email_count + 1,
    promo_code: promoCode,
    discount,
    // Surfaced so the UI can say the send worked but the counter won't move
    // until abandoned-checkout-recovery-migration.sql has run.
    recorded: stamp.recorded,
    logged: !logError,
  });
}
