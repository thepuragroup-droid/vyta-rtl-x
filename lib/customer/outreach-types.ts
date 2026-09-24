/**
 * The shapes and limits the bulk-outreach composer and its API agree on.
 *
 * Isomorphic on purpose — no Supabase client, no SMTP, nothing server-only — so
 * the admin's recipient picker can enforce the SAME recipient cap the route
 * enforces, and describe an abandoned cart with the same words. A limit stated
 * twice is a limit that eventually disagrees with itself, and the version the
 * admin sees would be the wrong one.
 *
 * The resolving and sending half lives in lib/customer/outreach.ts.
 */
import type { NudgeSummary } from './audience';

/**
 * How many people one bulk send may address.
 *
 * A ceiling rather than a target: this is one-to-one outreach sent over the
 * shared SMTP transport inside a single request, not a mailing list. A bigger
 * chase is two clicks rather than one timed-out request that leaves the admin
 * unsure who was actually emailed.
 */
export const MAX_BULK_RECIPIENTS = 40;

/** How many people the recipient search offers at a time. */
export const CANDIDATE_LIMIT = 50;

/**
 * A recipient's abandoned cart, trimmed to what the picker shows.
 *
 * Enough to decide whether to chase someone — what they left, how long ago,
 * whether the link still works and how many times we have already asked —
 * without shipping the whole basket to the browser for every search result.
 */
export interface AbandonedCartLite {
  orderId: string;
  reference: string;
  /** 'payment_pending' | 'expired'. */
  status: string;
  createdAt: string;
  /** False when Stealth Health never gave us a link, so no button can be sent. */
  hasPaymentLink: boolean;
  /** Cart subtotal in `currency`, or null when the ledger has no amount. */
  total: number | null;
  currency: string | null;
  itemCount: number;
  /** Recovery emails already sent for this cart. 0 when never chased. */
  chased: number;
  lastChasedAt: string | null;
}

export interface OutreachRecipient {
  /** How the CRM routes address this person: a `customers` UUID, or `pm:<email>`. */
  id: string;
  email: string;
  name: string | null;
  /**
   * The affiliate who referred this account, when one did. Carried so a bulk
   * send stamps `customer_emails.affiliate_id` exactly as the single-recipient
   * route does — the outreach history is read per affiliate.
   */
  affiliateId: string | null;
  /** For `{{first_name}}`. */
  firstName: string | null;
  source: 'account' | 'puramass';
  /** Their newest live abandoned cart, or null when they have none. */
  abandoned: AbandonedCartLite | null;
  /**
   * When we last wrote to them, when that was inside RECENT_NUDGE_DAYS.
   *
   * Null means "not lately", not "never" — the index behind it is read for the
   * recent window only. It is here so the composer can name the people on a
   * draft who already heard from us before it goes out; it holds nobody back.
   */
  nudge: NudgeSummary | null;
}

/** What one send did for one person, as the route reports it back. */
export interface OutreachSendOutcome {
  id: string;
  email: string;
  name: string | null;
  success: boolean;
  error?: string;
  /** The cart this person's email actually carried, when it carried one. */
  reference?: string | null;
  attempt?: number;
  recorded?: boolean;
  /** False when the send worked but `customer_emails` could not record it. */
  logged?: boolean;
}

/**
 * Somebody the send deliberately did NOT write to, because they had already
 * been sent one of the email types the batch was told to skip.
 *
 * Not a failure — the opposite. Reported per person so the composer can say
 * which email they already had and when, rather than leaving an admin to
 * wonder why the batch was smaller than what they ticked.
 */
export interface OutreachSkipped {
  id: string;
  email: string;
  name: string | null;
  /** The template key they had already been sent. */
  template: string;
  /** When that email went out. */
  sentAt: string;
}

export interface OutreachSendResult {
  ok: boolean;
  sent: number;
  failed: number;
  withCart: number;
  /** False when at least one send is missing from the outreach history. */
  logged: boolean;
  unresolved: string[];
  /** Held back by the "already had this email" condition. */
  skipped?: OutreachSkipped[];
  results: OutreachSendOutcome[];
  cc: string[];
}

/** "Jordan Grosman" / the address when we have no name. */
export const recipientLabel = (r: { name: string | null; email: string }): string =>
  (r.name ?? '').trim() || r.email;

/** 'payment_pending' → 'pending'. The tab and the chip say the same word. */
export const cartStatusLabel = (status: string): string =>
  status === 'payment_pending' ? 'pending' : status.replace(/_/g, ' ');

/** "3h ago" / "2d ago" — compact enough for a picker row. */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return 'just now';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * "$240.00 USD" — null when the ledger carried no amount.
 *
 * Zero counts as no amount, exactly as it does in the email (`knownAmount` in
 * promo-email.ts): Stealth Health sends `subtotal_cents: 0` for a hand-off it never
 * priced, and a "$0.00 USD" chip reads as a worthless cart rather than as a
 * missing figure.
 */
export function cartAmount(cart: AbandonedCartLite): string | null {
  if (typeof cart.total !== 'number' || !Number.isFinite(cart.total) || cart.total <= 0) {
    return null;
  }
  return `$${cart.total.toFixed(2)} ${(cart.currency ?? 'USD').toUpperCase()}`;
}
