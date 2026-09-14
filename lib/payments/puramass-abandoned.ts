/**
 * Abandoned-checkout vocabulary, shared by the server and the admin table.
 *
 * Deliberately free of server-only imports (no SMTP, no service-role client) so
 * /admin/stealth-health (Orders tab) can decide what "abandoned" and "recovered" mean using
 * the exact same rules the API applies. Two definitions of an abandoned cart —
 * one in the query, one in the UI — is a list that quietly disagrees with its
 * own count.
 *
 * The sending half lives in lib/payments/puramass-recovery.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Statuses worth chasing.
 *
 * `expired` and `cancelled` are in deliberately: PuraMass expires a hosted link
 * on its own schedule, and the buyer behind it is still worth reaching — the
 * email just has to be honest about the link's state.
 */
export const RECOVERABLE_STATUSES = ['payment_pending', 'expired', 'cancelled'] as const;

export type RecoverableStatus = (typeof RECOVERABLE_STATUSES)[number];

export const isRecoverableStatus = (status: string): status is RecoverableStatus =>
  (RECOVERABLE_STATUSES as readonly string[]).includes(status);

/**
 * The statuses whose hosted payment link is worth putting back in front of a
 * buyer as a *live* call to action.
 *
 * Narrower than RECOVERABLE_STATUSES on purpose. `cancelled` stays chaseable
 * from the ledger's own recovery dialog — where the admin is looking at that
 * one order and the email says the order was cancelled — but a cancelled cart
 * must never be picked up automatically and mailed out as "your cart is still
 * waiting" during a bulk send. Pending and expired are the two the buyer can
 * still act on.
 */
export const PAYMENT_LINK_STATUSES = ['payment_pending', 'expired'] as const;

export type PaymentLinkStatus = (typeof PAYMENT_LINK_STATUSES)[number];

export const hasReusablePaymentLink = (status: string): status is PaymentLinkStatus =>
  (PAYMENT_LINK_STATUSES as readonly string[]).includes(status);

/**
 * Sort key for choosing ONE cart when a buyer walked away from several.
 *
 * A pending checkout beats an expired one whatever the dates say: its link
 * still takes payment, so it is the one worth sending. Within a status the
 * newest cart wins — it is the one they actually remember.
 */
export function abandonedPriority(status: string): number {
  if (status === 'payment_pending') return 0;
  if (status === 'expired') return 1;
  return 2;
}

/** Newest, most-live abandoned cart first. Feed it rows, take `[0]`. */
export function byAbandonedPriority<T extends { status: string; created_at: string }>(
  a: T,
  b: T,
): number {
  const rank = abandonedPriority(a.status) - abandonedPriority(b.status);
  if (rank !== 0) return rank;
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
}

/** Hours a hand-off must sit unpaid before it counts as abandoned. */
export const DEFAULT_ABANDONED_HOURS = 1;

/** ISO timestamp for "anything created before this is abandoned". */
export function abandonedCutoff(hours: number, now: number = Date.now()): string {
  return new Date(now - Math.max(0, hours) * 3600_000).toISOString();
}

/** The recovery bookkeeping a ledger row carries once it has been chased. */
export interface RecoveryFields {
  status: string;
  paid_at?: string | null;
  recovery_email_sent_at?: string | null;
  recovery_email_count?: number | null;
  recovery_promo_code?: string | null;
  recovery_discount_type?: string | null;
  recovery_discount_value?: number | null;
}

/**
 * Whether a chased checkout came back.
 *
 * Derived rather than stored: an order is recovered when it is paid and the
 * payment landed after the email that chased it. Keeping it out of the database
 * means it can never disagree with the ledger it is read from.
 */
export function wasRecovered(row: RecoveryFields): boolean {
  if (row.status !== 'paid' || !row.recovery_email_sent_at) return false;
  if (!row.paid_at) return true;
  return new Date(row.paid_at).getTime() >= new Date(row.recovery_email_sent_at).getTime();
}

/** "15% off" / "$25.00 off" from the columns stamped on the last send. */
export function recoveryOffer(row: RecoveryFields): string | null {
  const value = Number(row.recovery_discount_value);
  if (!row.recovery_discount_type || !Number.isFinite(value) || value <= 0) return null;
  return row.recovery_discount_type === 'percentage'
    ? `${+value.toFixed(2)}% off`
    : `$${value.toFixed(2)} off`;
}


/**
 * The configured abandoned window, in hours.
 *
 * Falls back to the default when the setting (or the whole column) isn't there:
 * an unmigrated database should still be able to list abandoned checkouts.
 * Capped at 30 days — beyond that the list just fills with carts whose payment
 * links PuraMass has long since expired.
 */
export async function loadAbandonedHours(db: SupabaseClient): Promise<number> {
  try {
    const { data, error } = await db
      .from('site_settings')
      .select('abandoned_checkout_hours')
      .limit(1)
      .maybeSingle();
    if (error) return DEFAULT_ABANDONED_HOURS;
    const raw = (data as { abandoned_checkout_hours?: unknown } | null)?.abandoned_checkout_hours;
    const hours = Number(raw);
    return Number.isFinite(hours) && hours > 0
      ? Math.min(24 * 30, Math.round(hours))
      : DEFAULT_ABANDONED_HOURS;
  } catch {
    return DEFAULT_ABANDONED_HOURS;
  }
}
