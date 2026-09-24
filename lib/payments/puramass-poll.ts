/**
 * Idempotent status-apply for PuraMass (Stealth Health) orders.
 *
 * Shared by the scheduled poller (`/api/cron/puramass-poll`) — the pull-based
 * fallback for when the portal's webhook isn't delivered to this project — and
 * kept behaviourally identical to the webhook receiver's paid side-effects.
 *
 * The whole game is idempotency: the paid side-effect (materialising the
 * fulfillment invoice) is guarded on the local `payment_pending → paid`
 * transition AND on `puramass_orders.invoice_id`, so overlapping runs or a
 * repeated `paid` read can never double-fire.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  materializeStealthHealthFulfillment,
  expireStealthHealthInvoices,
} from '@/lib/payments/puramass-fulfillment';
import { attributeHostedPurchase } from '@/lib/analytics/attribution-server';
import {
  buildPuramassContactPatch,
  buildPuramassOrderDetailPatch,
  type PuramassOrderStatus,
} from '@/lib/payments/puramass';
import { isMissingColumnError, stripUnmigratedFields } from '@/lib/payments/puramass-columns';

/** Terminal local states — never moved off once reached. */
export const PURAMASS_TERMINAL_STATUSES = ['paid', 'expired', 'cancelled'] as const;

export interface PuramassLedgerOrder {
  id: string;
  status: string;
  transaction_id: string | null;
  customer_id?: string | null;
  customer_email?: string | null;
  items?: { sku?: string; quantity?: number }[] | null;
  subtotal_cents?: number | null;
  invoice_id?: string | null;
  /** Referral code captured at hand-off — drives the affiliate commission. */
  referral_code?: string | null;
  currency?: string | null;
  /** Shipping charged at hand-off, in cents of `currency`. Null on older rows. */
  shipping_total_cents?: number | null;
  /** Easyship service the buyer paid for, booked when the order is paid. */
  shipping_courier_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  shipping_address?: unknown;
  /** 'customer' when the buyer typed it in; a partner poll must not clobber it. */
  shipping_address_source?: string | null;
}

export interface ApplyResult {
  changed: boolean;
  status: string;
  materialized: boolean;
  /** True when the shipping address / buyer contact was written or corrected. */
  contactUpdated: boolean;
}

/**
 * Apply a freshly-read remote status to a local ledger order. Returns whether
 * anything changed and the resulting status. Never throws for a paid
 * side-effect failure (materialise is best-effort).
 */
export async function applyPuramassStatus(
  db: SupabaseClient,
  order: PuramassLedgerOrder,
  remote: Pick<
    PuramassOrderStatus,
    | 'status'
    | 'paid_at'
    | 'subtotal_cents'
    | 'currency'
    | 'items'
    | 'shipping'
    | 'customer'
    | 'expires_at'
    | 'refunded_total_cents'
    | 'refunds'
  >,
): Promise<ApplyResult> {
  // The shipping address PuraMass captured on its hosted page. It can land (or
  // change) independently of the payment status, so it is applied on its own
  // whenever the status side is a no-op — including on terminal orders, which
  // is how a manual re-poll backfills an address onto an already-paid order.
  const contactPatch = buildPuramassContactPatch(order, {
    shipping: remote?.shipping,
    customer: remote?.customer,
  });

  // Link expiry, refunds and the priced line items — PuraMass's own
  // bookkeeping, which the invoice pages read. Like the address, these move
  // independently of the payment status (a refund lands long after `paid`), so
  // they ride along on both the no-op and the status-flip path.
  const detailPatch = buildPuramassOrderDetailPatch({
    expires_at: remote?.expires_at,
    refunded_total_cents: remote?.refunded_total_cents,
    refunds: remote?.refunds,
    items: remote?.items,
  });

  const remoteStatus = remote?.status;
  const statusIsNoop =
    PURAMASS_TERMINAL_STATUSES.includes(order.status as any) ||
    !remoteStatus ||
    remoteStatus === order.status;

  if (statusIsNoop) {
    let contactUpdated = false;
    const noopPatch = { ...contactPatch, ...detailPatch };
    if (Object.keys(noopPatch).length > 0) {
      // Errors are deliberately ignored: an address we couldn't store (columns
      // not migrated yet) is not a reason to fail a status poll.
      let { error } = await db
        .from('puramass_orders')
        .update(noopPatch)
        .eq('id', order.id);
      if (error && isMissingColumnError(error)) {
        const reduced = stripUnmigratedFields(noopPatch);
        ({ error } = Object.keys(reduced).length > 0
          ? await db.from('puramass_orders').update(reduced).eq('id', order.id)
          : { error: null });
      }
      contactUpdated = !error && Object.keys(contactPatch).length > 0;
    }
    return { changed: false, status: order.status, materialized: false, contactUpdated };
  }

  const update: Record<string, unknown> = { ...contactPatch, ...detailPatch, status: remoteStatus };
  if (remote.currency) update.currency = remote.currency;
  if (typeof remote.subtotal_cents === 'number') update.subtotal_cents = remote.subtotal_cents;
  if (remoteStatus === 'paid') update.paid_at = remote.paid_at ?? new Date().toISOString();

  // Flip the local state. Guarded so a concurrent run that already advanced the
  // row past pending doesn't get overwritten.
  const flip = (patch: Record<string, unknown>) =>
    db
      .from('puramass_orders')
      .update(patch)
      .eq('id', order.id)
      .eq('status', order.status)
      .select('id')
      .maybeSingle();

  let { data: updated, error } = await flip(update);
  // The address / order-detail columns may not exist yet — confirming payment
  // matters more, so retry with just the status fields.
  if (error && isMissingColumnError(error)) {
    ({ data: updated, error } = await flip(stripUnmigratedFields(update)));
  }

  // Another run won the race (or a transient error) — do not fire side-effects.
  if (error || !updated) {
    return { changed: false, status: order.status, materialized: false, contactUpdated: false };
  }

  let materialized = false;
  if (remoteStatus === 'paid') {
    // Credit the campaign that won this buyer. The poller is the fallback for
    // an undelivered webhook, so it has to close the attribution loop too —
    // otherwise a payment confirmed this way would show as unattributed.
    await attributeHostedPurchase(db, {
      id: order.id,
      customer_email: (update.customer_email as string) ?? order.customer_email ?? null,
    });

    const res = await materializeStealthHealthFulfillment(
      db,
      {
        id: order.id,
        customer_id: order.customer_id ?? null,
        customer_email: (update.customer_email as string) ?? order.customer_email ?? null,
        customer_name: (update.customer_name as string) ?? order.customer_name ?? null,
        items: order.items ?? null,
        subtotal_cents:
          typeof remote.subtotal_cents === 'number'
            ? remote.subtotal_cents
            : order.subtotal_cents ?? null,
        invoice_id: order.invoice_id ?? null,
        referral_code: order.referral_code ?? null,
      },
      Array.isArray(remote.items) ? remote.items : [],
    );
    materialized = res.created;
  }

  if (remoteStatus === 'expired' || remoteStatus === 'cancelled') {
    await expireStealthHealthInvoices(db, [order.invoice_id]);
  }

  return {
    changed: true,
    status: remoteStatus,
    materialized,
    contactUpdated: Object.keys(contactPatch).length > 0,
  };
}
