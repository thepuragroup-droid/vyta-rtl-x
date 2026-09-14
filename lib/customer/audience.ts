/**
 * WHO a bulk send goes to — the conditions the customer desk selects by.
 *
 * The "Email customers" button above /admin/customers sends to whoever is
 * ticked, and ticking thirty people by hand is how the wrong thirty get the
 * email. This module is the other half: narrow the list by *conditions* first —
 * when they joined, when they were last active, and whether they have already
 * had this kind of email — then tick what is left.
 *
 * The suppression half is the one that matters most. "Opt out anyone who has
 * already had the restock email" is not a nicety: sending the same promo to the
 * same buyer twice in a week is how a customer list gets marked as spam. So the
 * rule is stated once, here, and applied in BOTH places — the page holds people
 * back from the list, and the send route re-checks each recipient against the
 * outreach log at send time (see app/api/admin/customers/outreach/route.ts).
 * The page's copy can be minutes stale; the route's cannot.
 *
 * Alongside it sits the always-on half: RECENT_NUDGE_DAYS and the `NudgeSummary`
 * below, which say when somebody was last written to whether or not any
 * condition is set. That one only ever warns — the customer table marks the row
 * and the composer names the people — because "I know, send it anyway" is a
 * legitimate answer and a silent block is not.
 *
 * Isomorphic on purpose — no Supabase client, no server imports — so the
 * browser filtering the table and the route refusing a recipient are running
 * the same predicate rather than two that agree until they don't.
 */
import { mergeTemplates, PROMO_TEMPLATES, RECOVERY_TEMPLATES } from './promo-email';

/**
 * The conditions, as the page holds them.
 *
 * Dates are `YYYY-MM-DD` (what `<input type="date">` gives us) and read as
 * whole local days, inclusive at both ends: "to 12 Aug" includes everything
 * that happened on the 12th, which is what an admin picking a date means.
 */
export interface AudienceFilters {
  /** `customers.created_at` / the ledger's first sight of a Stealth Health buyer. */
  joinedFrom: string;
  joinedTo: string;
  /** Last login, or last Stealth Health order for a buyer with no account. */
  activeFrom: string;
  activeTo: string;
  /**
   * Template keys to hold back on. Anyone who has already had a successful
   * send of one of these is dropped from the audience.
   */
  excludeTemplates: string[];
  /** How far back the exclusion looks. `null` means "ever". */
  excludeWithinDays: number | null;
}

export const EMPTY_AUDIENCE: AudienceFilters = {
  joinedFrom: '',
  joinedTo: '',
  activeFrom: '',
  activeTo: '',
  excludeTemplates: [],
  excludeWithinDays: null,
};

/**
 * The email types an admin can hold back on.
 *
 * Every template either desk can send, because `customer_emails.template`
 * stores exactly these keys — the recovery set included, since a buyer chased
 * about their cart yesterday is precisely who should not get chased again
 * today. `custom` is here too: a hand-written one-off is still an email that
 * landed in their inbox.
 */
export const EMAIL_TYPE_OPTIONS: { key: string; label: string; description: string }[] =
  mergeTemplates(PROMO_TEMPLATES, RECOVERY_TEMPLATES).map((t) => ({
    key: t.key,
    label: t.key === 'custom' ? 'One-off (blank)' : t.label,
    description: t.description,
  }));

const EMAIL_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  EMAIL_TYPE_OPTIONS.map((t) => [t.key, t.label]),
);

/** "Promo offer" for a known key, the raw key for one a later release added. */
export const emailTypeLabel = (key: string): string => EMAIL_TYPE_LABELS[key] ?? key;

/** How far back "already had it" looks. `null` is the whole history. */
export const SUPPRESSION_WINDOWS: { key: string; label: string; days: number | null }[] = [
  { key: 'ever', label: 'Ever', days: null },
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
  { key: '180', label: 'Last 6 months', days: 180 },
];

export const MS_PER_DAY = 86_400_000;

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

/**
 * A timestamp as the `YYYY-MM-DD` the admin's date picker speaks.
 *
 * Local, not UTC: an order placed at 9pm on the 11th in Vancouver is the 11th
 * to the person filtering for it, and a UTC day would file it under the 12th.
 */
export function localDayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Is `iso` inside the (inclusive) day range?
 *
 * An empty bound is open. A row with NO date fails a range that has any bound:
 * "joined after March" cannot honestly include somebody whose join date we do
 * not know, and quietly keeping them is how they end up in the send.
 */
export function withinDayRange(
  iso: string | null | undefined,
  from: string,
  to: string,
): boolean {
  if (!from && !to) return true;
  const day = localDayKey(iso);
  if (!day) return false;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

/** The two date pairs, as a predicate over one row's timestamps. */
export function matchesDateFilters(
  row: { joinedAt: string | null; lastActiveAt: string | null },
  filters: AudienceFilters,
): boolean {
  return (
    withinDayRange(row.joinedAt, filters.joinedFrom, filters.joinedTo) &&
    withinDayRange(row.lastActiveAt, filters.activeFrom, filters.activeTo)
  );
}

/**
 * The cutoff the outreach log is read from, or `null` for the whole history.
 *
 * Whole days back from now rather than a rolling 24h boundary, so "last 7 days"
 * on a Monday means the last seven days and not "since last Monday teatime".
 */
export function suppressionSince(
  filters: Pick<AudienceFilters, 'excludeWithinDays'>,
  now: number = Date.now(),
): string | null {
  const days = filters.excludeWithinDays;
  if (days == null || !Number.isFinite(days) || days <= 0) return null;
  return new Date(now - days * MS_PER_DAY).toISOString();
}

/* ------------------------------------------------------------------ */
/* Suppression                                                         */
/* ------------------------------------------------------------------ */

/**
 * What one address has already been sent: template key → newest successful send.
 *
 * Only successful sends count. An email the mail server rejected never reached
 * anybody, so holding that person back would silently drop them from every
 * future batch for a message they never actually received.
 */
export type EmailHistoryEntry = Record<string, string>;

/** The whole log, keyed by lower-cased address. */
export type EmailHistoryIndex = Record<string, EmailHistoryEntry>;

/** The lookup key on both sides — `customer_emails.to_email` keeps its typed case. */
export const historyKey = (email: string | null | undefined): string =>
  String(email ?? '').trim().toLowerCase();

/**
 * The held-back email, when this person has already had one of these types.
 *
 * Returns the reason rather than a bare boolean so both the page and the send
 * result can say WHICH email they already got and when — "already had the
 * restock email" is actionable, "excluded" is not.
 */
export function suppressionReason(
  email: string | null | undefined,
  filters: Pick<AudienceFilters, 'excludeTemplates' | 'excludeWithinDays'>,
  history: EmailHistoryIndex,
  now: number = Date.now(),
): { template: string; sentAt: string } | null {
  if (filters.excludeTemplates.length === 0) return null;
  const entry = history[historyKey(email)];
  if (!entry) return null;

  const since = suppressionSince(filters, now);
  const sinceMs = since ? Date.parse(since) : null;

  let newest: { template: string; sentAt: string } | null = null;
  let newestMs = -Infinity;
  for (const template of filters.excludeTemplates) {
    const sentAt = entry[template];
    if (!sentAt) continue;
    // Compared as instants, never as strings. Postgres hands back
    // `2026-06-30T09:00:00+00:00` and `toISOString()` produces
    // `2026-06-30T09:00:00.000Z` — the same moment, and `'+' < '.'`, so a
    // lexicographic test would put the send before its own cutoff.
    const sentMs = Date.parse(sentAt);
    if (!Number.isFinite(sentMs)) continue;
    // The index is normally fetched with the same window, but a window narrowed
    // after the fetch must not keep excluding people it no longer covers.
    if (sinceMs != null && sentMs < sinceMs) continue;
    if (sentMs > newestMs) {
      newest = { template, sentAt };
      newestMs = sentMs;
    }
  }
  return newest;
}

/* ------------------------------------------------------------------ */
/* Recent contact — "have we just emailed this person?"                */
/* ------------------------------------------------------------------ */

/**
 * How recently is "recently"?
 *
 * The suppression rule above is opt-in: it only holds anybody back once an
 * admin has ticked an email type. This is the always-on half — the number of
 * days inside which a customer who has already had an email is worth a second
 * look before they get another one. Two weeks is roughly the cadence a promo
 * list tolerates; below it, a second email reads as pestering.
 *
 * It is a WARNING, never a block. An admin who has read it and still wants to
 * write to that person is allowed to; the desk's job is to make sure nobody
 * sends the same nudge twice by accident.
 */
export const RECENT_NUDGE_DAYS = 14;

/**
 * The last outreach email one address received, and how busy that inbox has
 * been lately.
 *
 * Built from `customer_emails` (successful sends only — see
 * `fetchNudgeIndex`), and deliberately tiny: a template key, a timestamp and a
 * count. No subjects, no bodies, no promo codes. The correspondence itself
 * lives on the customer's own page; this is only ever "have we just written to
 * them?".
 */
export interface NudgeSummary {
  /** The template key of the newest successful send. */
  template: string;
  /** When that email went out. */
  sentAt: string;
  /** Successful sends inside RECENT_NUDGE_DAYS, that newest one included. */
  recentCount: number;
}

/** The whole answer, keyed by lower-cased address — same key as the history. */
export type NudgeIndex = Record<string, NudgeSummary>;

/** The cutoff `recentCount` is counted from. */
export const recentNudgeSince = (now: number = Date.now()): string =>
  new Date(now - RECENT_NUDGE_DAYS * MS_PER_DAY).toISOString();

/**
 * Was this person emailed inside the window?
 *
 * Reads `recentCount` rather than re-deriving the age from `sentAt`, so a page
 * that has been open for a while cannot disagree with the count beside it.
 */
export const isRecentlyNudged = (nudge: NudgeSummary | null | undefined): boolean =>
  Boolean(nudge && nudge.recentCount > 0);

/** Whole days since the newest send, or null when the timestamp is unusable. */
export function nudgeAgeDays(
  nudge: NudgeSummary | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!nudge) return null;
  const sent = Date.parse(nudge.sentAt);
  if (!Number.isFinite(sent)) return null;
  return Math.max(0, Math.floor((now - sent) / MS_PER_DAY));
}

/** "Discount nudge, 2 days ago" — one line for a chip or a warning row. */
export function describeNudge(
  nudge: NudgeSummary,
  now: number = Date.now(),
): string {
  const days = nudgeAgeDays(nudge, now);
  const when =
    days == null ? 'previously'
    : days === 0 ? 'today'
    : days === 1 ? 'yesterday'
    : `${days} days ago`;
  const extra = nudge.recentCount > 1 ? ` · ${nudge.recentCount} emails in ${RECENT_NUDGE_DAYS} days` : '';
  return `${emailTypeLabel(nudge.template)}, ${when}${extra}`;
}

/**
 * The people on a send who have already been written to inside the window.
 *
 * Newest contact first, because that is the one an admin is most likely to be
 * about to repeat. Anyone the index has nothing for is left out entirely —
 * "we have never emailed them" is the normal case and needs no warning.
 */
export function recentlyNudged<T extends { nudge?: NudgeSummary | null }>(
  recipients: readonly T[],
): T[] {
  // An unparseable timestamp sorts last rather than returning NaN from the
  // comparator, which would leave the whole list in an arbitrary order.
  const sentMs = (row: T): number => {
    const ms = Date.parse(row.nudge!.sentAt);
    return Number.isFinite(ms) ? ms : -Infinity;
  };
  return recipients.filter((r) => isRecentlyNudged(r.nudge)).sort((a, b) => sentMs(b) - sentMs(a));
}

/* ------------------------------------------------------------------ */
/* Describing the conditions                                           */
/* ------------------------------------------------------------------ */

/** How many conditions are switched on — the badge on the "Conditions" button. */
export function activeConditionCount(filters: AudienceFilters): number {
  let n = 0;
  if (filters.joinedFrom || filters.joinedTo) n += 1;
  if (filters.activeFrom || filters.activeTo) n += 1;
  if (filters.excludeTemplates.length > 0) n += 1;
  return n;
}

export const hasAudienceConditions = (filters: AudienceFilters): boolean =>
  activeConditionCount(filters) > 0;

const windowLabel = (days: number | null): string =>
  SUPPRESSION_WINDOWS.find((w) => w.days === days)?.label.toLowerCase() ?? `last ${days} days`;

const rangeLabel = (what: string, from: string, to: string): string | null => {
  if (from && to) return `${what} ${from} → ${to}`;
  if (from) return `${what} on or after ${from}`;
  if (to) return `${what} on or before ${to}`;
  return null;
};

/** One line an admin can read back before sending. Empty when nothing is set. */
export function describeAudience(filters: AudienceFilters): string[] {
  const parts: string[] = [];
  const joined = rangeLabel('Joined', filters.joinedFrom, filters.joinedTo);
  if (joined) parts.push(joined);
  const active = rangeLabel('Last active', filters.activeFrom, filters.activeTo);
  if (active) parts.push(active);
  if (filters.excludeTemplates.length > 0) {
    const names = filters.excludeTemplates.map(emailTypeLabel).join(', ');
    parts.push(
      `Skipping anyone already sent ${names} (${windowLabel(filters.excludeWithinDays)})`,
    );
  }
  return parts;
}
