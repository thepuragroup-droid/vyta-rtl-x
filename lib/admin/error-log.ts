/**
 * Admin error tracking — read model.
 *
 * A single place to surface things that failed silently in the background so an
 * admin can notice and act (e.g. resend). This is deliberately built on top of
 * the log tables the app already writes to, so it works for historical rows and
 * needs no extra capture wiring or migration.
 *
 * Errors are grouped into CATEGORIES. The first category is `order_email`:
 * transactional / order emails that failed to send. Since checkout now sends
 * those emails in the background (they no longer block the confirmation page),
 * this page is the fallback that makes a failed send visible instead of lost.
 *
 * Add future categories (payments, shipping, …) to ERROR_CATEGORIES and give
 * them their own loader that returns ErrorLogEntry[] with the matching `category`.
 */
import { getSupabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type ErrorCategory = 'order_email';

export interface ErrorCategoryMeta {
  id: ErrorCategory;
  label: string;
  description: string;
}

// Registry of tracked error categories, in display order.
export const ERROR_CATEGORIES: ErrorCategoryMeta[] = [
  {
    id: 'order_email',
    label: 'Order Email',
    description:
      'Transactional emails that failed to send — order acknowledgements, ' +
      'e-Transfer payment instructions, admin order notices, and invoice sends.',
  },
];

// ---------------------------------------------------------------------------
// Reasons — friendly buckets derived from raw SMTP / nodemailer error strings
// ---------------------------------------------------------------------------

export type ErrorReason =
  | 'smtp_not_configured'
  | 'auth_failed'
  | 'connection_failed'
  | 'timeout'
  | 'invalid_recipient'
  | 'mailbox_full'
  | 'rate_limited'
  | 'blocked_spam'
  | 'greylisted'
  | 'unknown';

export interface ReasonMeta {
  id: ErrorReason;
  /** Short human label for the reason column. */
  label: string;
  /** Actionable hint an admin can follow to fix or interpret the failure. */
  hint: string;
}

const REASONS: Record<ErrorReason, ReasonMeta> = {
  smtp_not_configured: {
    id: 'smtp_not_configured',
    label: 'Mail server not configured',
    hint: 'SMTP credentials are missing. Set SMTP_HOST / SMTP_USER / SMTP_PASSWORD.',
  },
  auth_failed: {
    id: 'auth_failed',
    label: 'Authentication failed',
    hint: 'The mail server rejected the login. Check SMTP_USER / SMTP_PASSWORD.',
  },
  connection_failed: {
    id: 'connection_failed',
    label: 'Could not connect',
    hint: 'Could not reach the mail server. Check SMTP_HOST / SMTP_PORT and network access.',
  },
  timeout: {
    id: 'timeout',
    label: 'Timed out',
    hint: 'The mail server did not respond in time. It may be temporarily unavailable — retry later.',
  },
  invalid_recipient: {
    id: 'invalid_recipient',
    label: 'Recipient rejected',
    hint: "The recipient address was rejected. Verify the customer's email is correct.",
  },
  mailbox_full: {
    id: 'mailbox_full',
    label: 'Mailbox full',
    hint: "The recipient's mailbox is full or over quota.",
  },
  rate_limited: {
    id: 'rate_limited',
    label: 'Rate limited',
    hint: 'The mail server is throttling sends. Retry after a short wait.',
  },
  blocked_spam: {
    id: 'blocked_spam',
    label: 'Blocked as spam',
    hint: 'The message was blocked as spam. Review sending reputation and content.',
  },
  greylisted: {
    id: 'greylisted',
    label: 'Greylisted',
    hint: 'Temporarily greylisted by the recipient server — a retry usually succeeds.',
  },
  unknown: {
    id: 'unknown',
    label: 'Unknown error',
    hint: 'Unrecognized failure. See the raw error message for details.',
  },
};

export function reasonMeta(id: ErrorReason): ReasonMeta {
  return REASONS[id] ?? REASONS.unknown;
}

/**
 * Classify a raw SMTP / nodemailer error string into a friendly reason.
 *
 * Order matters: reliable, specific signals (nodemailer error CODES and full
 * SMTP status codes) are checked before generic English words, so a word that
 * happens to appear inside another failure's text can't shadow the right
 * bucket. In particular, infra codes (ECONN*, ETIMEDOUT) win over the
 * content-based spam words, and the spam/recipient buckets key off precise
 * enhanced-status codes rather than bare digits. Needles are matched as whole
 * words where a bare substring would over-match (e.g. `rate` in "corporate").
 */
export function classifyEmailError(raw: string | null | undefined): ReasonMeta {
  if (!raw || !raw.trim()) return REASONS.unknown;
  const s = raw.toLowerCase();

  const has = (...needles: string[]) => needles.some((n) => s.includes(n));
  // Whole-word match, so `rate` doesn't fire on "corporate"/"moderate".
  const hasWord = (...words: string[]) =>
    words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(s));

  if (has('not configured')) return REASONS.smtp_not_configured;

  // Auth.
  if (has('eauth', 'invalid login', 'authentication failed', 'auth failed', '535', '5.7.8'))
    return REASONS.auth_failed;

  // Infra: node socket error codes and timeouts come first so a message that
  // also mentions "blocked" or "connection" is still read as an infra problem.
  if (has('etimedout') || hasWord('timeout') || has('timed out')) return REASONS.timeout;
  if (
    has('econnrefused', 'enotfound', 'ehostunreach', 'econnreset', 'econnaborted', 'epipe', 'esocket') ||
    has('connection refused', 'could not connect', 'unable to connect', 'connection closed')
  )
    return REASONS.connection_failed;

  // Greylisting (a specific transient recipient response).
  if (has('greylist', 'grey-list', 'gray list', '451 4.7.1')) return REASONS.greylisted;

  // Rate limiting — precise phrases only, never the bare word "rate".
  if (has('rate limit', 'ratelimit', 'too many', 'throttl', '4.7.0') || hasWord('421', '429'))
    return REASONS.rate_limited;

  // Spam / policy block — enhanced code 5.7.1 or explicit spam wording.
  if (has('spam', 'blacklist', 'blocklist', 'reputation', '5.7.1') || hasWord('blocked'))
    return REASONS.blocked_spam;

  // Mailbox full / quota (5.2.2). Note: a bare 552 can also mean "message too
  // large" (5.3.4), so only treat it as a full mailbox when quota is implied.
  if (has('quota', 'mailbox full', 'over quota', '5.2.2')) return REASONS.mailbox_full;

  // Recipient rejected — checked last so specific codes above take precedence.
  if (
    has(
      'no recipients',
      'recipient',
      'mailbox unavailable',
      'user unknown',
      'does not exist',
      'invalid address',
      'no such user',
      '5.1.1',
    ) ||
    hasWord('550', '551', '553')
  )
    return REASONS.invalid_recipient;

  return REASONS.unknown;
}

// ---------------------------------------------------------------------------
// Unified entry shape
// ---------------------------------------------------------------------------

export interface ErrorLogEntry {
  id: string;
  category: ErrorCategory;
  /** Which log table the row came from. */
  source: 'fulfillment_email_log' | 'invoice_email_log';
  /** The kind of email (etransfer_ack, etransfer_instructions, invoice, …). */
  kind: string;
  reason: ErrorReason;
  reason_label: string;
  reason_hint: string;
  /** Raw error text as stored. */
  error: string | null;
  to_email: string | null;
  subject: string | null;
  /** What the failed email was about, so the UI can link to it. */
  reference_type: 'order' | 'invoice' | null;
  reference_id: string | null;
  created_at: string;
}

// Human labels for the email `kind` values.
const KIND_LABELS: Record<string, string> = {
  etransfer_ack: 'Order acknowledgement',
  etransfer_instructions: 'e-Transfer instructions',
  etransfer_admin_notice: 'Admin order notice',
  packed: 'Packed notice',
  shipped: 'Shipped notice',
  invoice: 'Invoice email',
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

/**
 * Load failed transactional email sends (category: order_email).
 * Best-effort per table — a missing/broken table is skipped, not fatal.
 */
export async function getEmailFailures(limit = 200): Promise<ErrorLogEntry[]> {
  const db = getSupabase();

  const [ful, inv] = await Promise.all([
    db
      .from('fulfillment_email_log')
      .select('id, kind, to_email, subject, error, order_id, invoice_id, created_at')
      .eq('success', false)
      .order('created_at', { ascending: false })
      .limit(limit),
    db
      .from('invoice_email_log')
      .select('id, to_email, subject, error, invoice_id, created_at')
      .eq('success', false)
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);

  if (ful.error) console.error('error-log: fulfillment_email_log read failed:', ful.error);
  if (inv.error) console.error('error-log: invoice_email_log read failed:', inv.error);

  const entries: ErrorLogEntry[] = [];

  for (const r of ful.data ?? []) {
    const reason = classifyEmailError(r.error);
    entries.push({
      id: `ful:${r.id}`,
      category: 'order_email',
      source: 'fulfillment_email_log',
      kind: r.kind ?? 'email',
      reason: reason.id,
      reason_label: reason.label,
      reason_hint: reason.hint,
      error: r.error ?? null,
      to_email: r.to_email ?? null,
      subject: r.subject ?? null,
      reference_type: r.order_id ? 'order' : r.invoice_id ? 'invoice' : null,
      reference_id: (r.order_id as string) ?? (r.invoice_id as string) ?? null,
      created_at: r.created_at,
    });
  }

  for (const r of inv.data ?? []) {
    const reason = classifyEmailError(r.error);
    entries.push({
      id: `inv:${r.id}`,
      category: 'order_email',
      source: 'invoice_email_log',
      kind: 'invoice',
      reason: reason.id,
      reason_label: reason.label,
      reason_hint: reason.hint,
      error: r.error ?? null,
      to_email: r.to_email ?? null,
      subject: r.subject ?? null,
      reference_type: r.invoice_id ? 'invoice' : null,
      reference_id: (r.invoice_id as string) ?? null,
      created_at: r.created_at,
    });
  }

  entries.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  return entries.slice(0, limit);
}

export interface ErrorLogSummary {
  category: ErrorCategory;
  total: number;
  byReason: Array<{ reason: ErrorReason; label: string; count: number }>;
}

export function summarize(entries: ErrorLogEntry[], category: ErrorCategory): ErrorLogSummary {
  const inCat = entries.filter((e) => e.category === category);
  const counts = new Map<ErrorReason, number>();
  for (const e of inCat) counts.set(e.reason, (counts.get(e.reason) ?? 0) + 1);
  const byReason = Array.from(counts.entries())
    .map(([reason, count]) => ({ reason, label: reasonMeta(reason).label, count }))
    .sort((a, b) => b.count - a.count);
  return { category, total: inCat.length, byReason };
}
