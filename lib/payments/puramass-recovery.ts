/**
 * Abandoned-checkout recovery — the server half.
 *
 * A PuraMass (Stealth Health) hand-off that never reaches `paid` is a cart the
 * buyer walked away from, and the ledger already holds everything needed to go
 * after it: their email, the line items, and the hosted `payment_link`, which
 * keeps taking payment until PuraMass expires it. This module turns one of
 * those rows into an email carrying that link back to them, optionally with a
 * discount code.
 *
 * NO CODE IS ISSUED HERE. Promo codes are generated on app.vytabio.com and
 * pasted into the composer; the discount type and amount an admin enters only
 * decide how the offer is *stated* in the email — PuraMass does the real
 * arithmetic when the buyer types the code on its checkout page. That is why
 * the totals in the email are labelled "estimated".
 *
 * SERVER ONLY — sends through the shared SMTP transport and reads with the
 * service-role client. The rendering itself lives in lib/customer/promo-email.ts
 * so the admin composer previews the exact HTML that gets sent.
 *
 * Requires abandoned-checkout-recovery-migration.sql. Every read and write of
 * the recovery columns degrades rather than throwing while that migration is
 * not visible to PostgREST yet (see lib/payments/puramass-columns.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendMail, defaultFrom } from '@/lib/smtp';
import {
  renderPromoEmail,
  renderPromoEmailText,
  renderSubject,
  type CartSummary,
  type DiscountInput,
  type PromoEmailInput,
} from '@/lib/customer/promo-email';
import { isMissingColumnError, PURAMASS_RECOVERY_COLUMNS } from './puramass-columns';
import type { LedgerRow } from './puramass-address-request';
import type { OrderSummary } from './puramass-order-summary';

// What counts as abandoned and recoverable is defined once, in a module the
// admin table can import too — see lib/payments/puramass-abandoned.ts.
export {
  RECOVERABLE_STATUSES,
  DEFAULT_ABANDONED_HOURS,
  abandonedCutoff,
  isRecoverableStatus,
  loadAbandonedHours,
  wasRecovered,
  recoveryOffer,
} from './puramass-abandoned';

/**
 * Guard rail on a broadcast-shaped field — this is one-to-one outreach.
 *
 * Re-exported from the address-request module rather than restated: the recover
 * route parses its CC field with that module's `parseCcList`, so a second
 * constant here would eventually disagree with the limit actually enforced.
 */
export { MAX_CC_RECIPIENTS as MAX_RECOVERY_CC } from './puramass-address-request';

// ---- Recovery state on a ledger row ---------------------------------------

export interface RecoveryState {
  recovery_email_sent_at: string | null;
  recovery_email_count: number;
  recovery_promo_code: string | null;
  recovery_discount_type: string | null;
  recovery_discount_value: number | null;
}

export const EMPTY_RECOVERY_STATE: RecoveryState = {
  recovery_email_sent_at: null,
  recovery_email_count: 0,
  recovery_promo_code: null,
  recovery_discount_type: null,
  recovery_discount_value: null,
};

/**
 * Read the recovery columns for one order.
 *
 * Kept separate from `loadLedgerRow` so the recovery migration can lag behind
 * this code without touching the address-request path: a missing column here
 * means "never chased", not a failed request.
 */
export async function loadRecoveryState(
  db: SupabaseClient,
  orderId: string,
): Promise<RecoveryState> {
  const { data, error } = await db
    .from('puramass_orders')
    .select(PURAMASS_RECOVERY_COLUMNS.join(', '))
    .eq('id', orderId)
    .maybeSingle();
  if (error || !data) {
    if (error && !isMissingColumnError(error)) {
      console.error('[puramass] recovery state read failed:', error);
    }
    return { ...EMPTY_RECOVERY_STATE };
  }
  const row = data as unknown as Record<string, unknown>;
  const value = Number(row.recovery_discount_value);
  return {
    recovery_email_sent_at: (row.recovery_email_sent_at as string) ?? null,
    recovery_email_count: Number(row.recovery_email_count) || 0,
    recovery_promo_code: (row.recovery_promo_code as string) ?? null,
    recovery_discount_type: (row.recovery_discount_type as string) ?? null,
    recovery_discount_value: Number.isFinite(value) ? value : null,
  };
}

/**
 * Recovery state for many orders at once.
 *
 * The bulk composer lists dozens of carts and has to say which ones have
 * already been chased; asking `loadRecoveryState` per row would be a query per
 * cart. Degrades to "never chased" for every id when the migration isn't
 * visible yet, exactly as the single-row read does.
 */
export async function loadRecoveryStates(
  db: SupabaseClient,
  orderIds: string[],
): Promise<Map<string, RecoveryState>> {
  const out = new Map<string, RecoveryState>();
  if (orderIds.length === 0) return out;

  const { data, error } = await db
    .from('puramass_orders')
    .select(['id', ...PURAMASS_RECOVERY_COLUMNS].join(', '))
    .in('id', orderIds);
  if (error || !data) {
    if (error && !isMissingColumnError(error)) {
      console.error('[puramass] bulk recovery state read failed:', error.message);
    }
    return out;
  }

  for (const raw of data as unknown as Record<string, unknown>[]) {
    const value = Number(raw.recovery_discount_value);
    out.set(String(raw.id), {
      recovery_email_sent_at: (raw.recovery_email_sent_at as string) ?? null,
      recovery_email_count: Number(raw.recovery_email_count) || 0,
      recovery_promo_code: (raw.recovery_promo_code as string) ?? null,
      recovery_discount_type: (raw.recovery_discount_type as string) ?? null,
      recovery_discount_value: Number.isFinite(value) ? value : null,
    });
  }
  return out;
}

/**
 * Record that a recovery email went out.
 *
 * Best-effort by design: the customer already has the email, so failing the
 * request because the bookkeeping column is missing would tell the admin the
 * send failed when it did not. Returns the stamp, and whether it landed.
 */
export async function stampRecoverySend(
  db: SupabaseClient,
  orderId: string,
  args: { previousCount: number; promoCode: string | null; discount: DiscountInput | null },
): Promise<{ sent_at: string; recorded: boolean }> {
  const sent_at = new Date().toISOString();
  const { error } = await db
    .from('puramass_orders')
    .update({
      recovery_email_sent_at: sent_at,
      recovery_email_count: (args.previousCount ?? 0) + 1,
      recovery_promo_code: args.promoCode,
      recovery_discount_type: args.discount?.type ?? null,
      recovery_discount_value: args.discount?.value ?? null,
    })
    .eq('id', orderId);
  if (error) {
    console.error('[puramass] recovery stamp failed:', error.message);
    return { sent_at, recorded: false };
  }
  return { sent_at, recorded: true };
}

// ---- Building the email ---------------------------------------------------

/** The basket, in the shape the email renderer wants. */
export function cartFromSummary(summary: OrderSummary): CartSummary {
  return {
    items: summary.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      lineTotal:
        item.line_total ??
        (item.unit_price != null ? +(item.unit_price * item.quantity).toFixed(2) : null),
    })),
    subtotal: summary.subtotal,
    currency: summary.currency,
    reference: summary.reference,
  };
}

/**
 * The line under the button.
 *
 * An expired or cancelled hand-off keeps its link in the email — PuraMass
 * sometimes still honours it, and a buyer who clicks a dead one and emails us
 * is a better outcome than a buyer we never contacted. But it must not be
 * presented as live, so the note says what state the order is in.
 */
export function checkoutNote(status: string): string {
  if (status === 'expired') {
    return 'This checkout link has expired — open it anyway and we will send you a fresh one, or just reply to this email.';
  }
  if (status === 'cancelled') {
    return 'This order was cancelled. Reply to this email and we will set it up again for you.';
  }
  return 'Secure checkout — your cart is exactly as you left it.';
}

export interface RecoveryEmailArgs {
  summary: OrderSummary;
  status: string;
  firstName: string | null;
  subject: string;
  body: string;
  promoCode: string | null;
  promoDetails: string | null;
  promoExpires: string | null;
  discount: DiscountInput | null;
  senderName: string | null;
  /** The hosted payment link. Non-http(s) values are dropped by the renderer. */
  paymentLink: string | null;
  /** Set the cart block aside — some admins want a bare note. */
  includeCart?: boolean;
}

/** Assemble the renderer input. Shared by the send route and its tests. */
export function buildRecoveryEmailInput(args: RecoveryEmailArgs): PromoEmailInput {
  return {
    firstName: args.firstName,
    subject: args.subject,
    body: args.body,
    promoCode: args.promoCode,
    promoDetails: args.promoDetails,
    promoExpires: args.promoExpires,
    senderName: args.senderName,
    discount: args.discount,
    currency: args.summary.currency,
    cart: args.includeCart === false ? null : cartFromSummary(args.summary),
    checkout: args.paymentLink
      ? {
          url: args.paymentLink,
          label: 'Complete your order',
          note: checkoutNote(args.status),
        }
      : null,
  };
}

export interface RecoverySendResult {
  success: boolean;
  error?: string;
  subject: string;
  html: string;
  text: string;
  messageId?: string;
}

/** Render and send one recovery email. Never throws. */
export async function sendRecoveryEmail(args: {
  to: string;
  cc?: string[];
  replyTo?: string | null;
  input: PromoEmailInput;
}): Promise<RecoverySendResult> {
  const html = renderPromoEmail(args.input);
  const text = renderPromoEmailText(args.input);
  const subject = renderSubject(args.input);

  const result = await sendMail({
    to: args.to,
    ...(args.cc && args.cc.length > 0 ? { cc: args.cc } : {}),
    subject,
    html,
    text,
    from: defaultFrom(),
    // Replies reach the human who chased them, not the noreply mailbox.
    ...(args.replyTo ? { replyTo: args.replyTo } : {}),
  });

  return {
    success: result.success,
    ...(result.error ? { error: result.error } : {}),
    ...(result.id ? { messageId: result.id } : {}),
    subject,
    html,
    text,
  };
}

/** First name for `{{first_name}}`, from whichever name the ledger has. */
export function recoveryFirstName(order: Pick<LedgerRow, 'customer_name' | 'customer_email'>): string | null {
  const fromName = (order.customer_name ?? '').trim().split(/\s+/)[0];
  return fromName || null;
}
