/**
 * Bulk customer outreach — resolving WHO an email goes to, and what each of
 * them gets.
 *
 * The customer desk's composer can address more than the one customer whose
 * page it was opened from. When the admin turns "also send to other customers"
 * on, they pick more people here and every one of them receives their OWN
 * message: a separate send, addressed only to them, with their own name, their
 * own abandoned cart and their own hosted payment link. Nobody is CC'd or
 * BCC'd, and no recipient ever sees another recipient's address.
 *
 * That per-person resolution is the whole point of this module. A bulk
 * abandoned-cart chase that pasted one buyer's payment link into forty emails
 * would take payment for the wrong basket, so the link and the cart are looked
 * up from the ledger for each recipient at send time — never carried over from
 * the draft the admin was previewing.
 *
 * Only `payment_pending` and `expired` carts are picked up automatically; see
 * PAYMENT_LINK_STATUSES in lib/payments/puramass-abandoned.ts for why
 * `cancelled` is deliberately left out of this path.
 *
 * SERVER ONLY — reads the PuraMass ledger with the service-role client.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchPuramassLedger,
  groupPuramassByEmail,
  normalizeEmail,
  puramassId,
  isPuramassId,
  emailFromPuramassId,
  type PuramassOrderLite,
} from '@/lib/admin/customer-directory';
import {
  byAbandonedPriority,
  PAYMENT_LINK_STATUSES,
} from '@/lib/payments/puramass-abandoned';
import {
  cartFromSummary,
  checkoutNote,
  loadRecoveryStates,
} from '@/lib/payments/puramass-recovery';
import { loadLedgerRow } from '@/lib/payments/puramass-address-request';
import { buildOrderSummary } from '@/lib/payments/puramass-order-summary';
import { safeHttpUrl, type CartSummary, type CheckoutCta } from '@/lib/customer/promo-email';
import {
  CANDIDATE_LIMIT,
  MAX_BULK_RECIPIENTS,
  type AbandonedCartLite,
  type OutreachRecipient,
} from './outreach-types';
import {
  historyKey,
  recentNudgeSince,
  suppressionReason,
  suppressionSince,
  type AudienceFilters,
  type EmailHistoryIndex,
  type NudgeIndex,
  type NudgeSummary,
} from './audience';

// Re-exported so the API route has one import for everything outreach.
export { CANDIDATE_LIMIT, MAX_BULK_RECIPIENTS };
export type { AbandonedCartLite, OutreachRecipient };

/** How many sends are in flight at once. Kind to the SMTP server, fast enough. */
export const SEND_CONCURRENCY = 5;

/** Affiliates have their own desk, their own lead record and their own emails. */
const EXCLUDED_ROLES = new Set(['affiliate']);

/** PostgREST caps an unbounded select at 1000 rows; ask for more explicitly. */
const ROW_LIMIT = 20000;

/** The blocks one recipient's email carries, resolved from their own cart. */
export interface RecipientCheckout {
  cart: CartSummary | null;
  checkout: CheckoutCta | null;
  /** The ledger row the cart came from, so the send can stamp it. */
  orderId: string | null;
  reference: string | null;
  status: string | null;
}

export const EMPTY_CHECKOUT: RecipientCheckout = {
  cart: null,
  checkout: null,
  orderId: null,
  reference: null,
  status: null,
};

const firstNameOf = (name: string | null): string | null =>
  (name ?? '').trim().split(/\s+/)[0] || null;

const itemCount = (order: PuramassOrderLite): number =>
  order.items.reduce((n, item) => n + (Number(item.quantity) || 0), 0);

/** Ledger cents → the money amount the rest of the email code works in. */
const centsToAmount = (cents: number | null): number | null =>
  typeof cents === 'number' && Number.isFinite(cents) ? +(cents / 100).toFixed(2) : null;

/* ------------------------------------------------------------------ */
/* Finding abandoned carts                                             */
/* ------------------------------------------------------------------ */

/**
 * One live abandoned cart per email address, newest and most-payable first.
 *
 * A buyer who walked away three times has three ledger rows; chasing all three
 * would put three payment links in front of one person. `byAbandonedPriority`
 * picks the one worth sending — a pending checkout over an expired one, and the
 * newest within a status.
 */
export async function fetchAbandonedByEmail(
  db: SupabaseClient,
  opts: { email?: string; limit?: number } = {},
): Promise<Map<string, AbandonedCartLite>> {
  return buildAbandonedIndex(db, await fetchAbandonedOrders(db, opts));
}

/** The pending/expired ledger rows themselves, for callers that need the names too. */
export function fetchAbandonedOrders(
  db: SupabaseClient,
  opts: { email?: string; limit?: number } = {},
): Promise<PuramassOrderLite[]> {
  return fetchPuramassLedger(db, {
    ...(opts.email ? { email: opts.email } : {}),
    statuses: PAYMENT_LINK_STATUSES,
    limit: opts.limit ?? 5000,
  });
}

/** Fold already-read ledger rows into one cart per buyer. */
export async function buildAbandonedIndex(
  db: SupabaseClient,
  orders: PuramassOrderLite[],
): Promise<Map<string, AbandonedCartLite>> {
  const best = new Map<string, PuramassOrderLite>();
  for (const order of orders) {
    const email = normalizeEmail(order.customer_email);
    if (!email) continue;
    const current = best.get(email);
    if (!current || byAbandonedPriority(order, current) < 0) best.set(email, order);
  }

  // How often each of those carts has already been chased. Comes back empty
  // (i.e. "never chased") when the recovery migration isn't visible yet.
  const recovery = await loadRecoveryStates(db, [...best.values()].map((o) => o.id));

  const out = new Map<string, AbandonedCartLite>();
  for (const [email, order] of best) {
    const state = recovery.get(order.id);
    out.set(email, {
      orderId: order.id,
      reference: order.partner_reference,
      status: order.status,
      createdAt: order.created_at,
      hasPaymentLink: Boolean(safeHttpUrl(order.payment_link)),
      total: centsToAmount(order.subtotal_cents),
      currency: order.currency,
      itemCount: itemCount(order),
      chased: state?.recovery_email_count ?? 0,
      lastChasedAt: state?.recovery_email_sent_at ?? null,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Resolving and searching recipients                                  */
/* ------------------------------------------------------------------ */

interface AccountLite {
  id: string;
  email: string;
  name: string | null;
  role: string;
  affiliateId: string | null;
}

/**
 * Every account customer, indexed by normalised email.
 *
 * Read whole rather than filtered because the ledger stores addresses
 * lower-cased while `customers.email` keeps whatever case the buyer typed, so
 * the two can only be joined in JS. Four columns — this is a lighter read than
 * the customer directory the same desk already loads on every visit.
 */
async function fetchAccountsByEmail(db: SupabaseClient): Promise<{
  byEmail: Map<string, AccountLite>;
}> {
  const byEmail = new Map<string, AccountLite>();

  const { data, error } = await db
    .from('customers')
    .select('id, first_name, last_name, email, role, affiliate_id')
    .limit(ROW_LIMIT);
  if (error) {
    console.error('[outreach] account read failed:', error.message);
    return { byEmail };
  }

  for (const row of (data ?? []) as any[]) {
    const email = normalizeEmail(row.email);
    if (!email) continue;
    const account: AccountLite = {
      id: row.id,
      email: row.email,
      name: `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || null,
      role: row.role ?? 'customer',
      affiliateId: row.affiliate_id ?? null,
    };
    // First row wins: `customers` is ordered by nothing in particular, and a
    // duplicated address is a data problem, not a reason to pick arbitrarily.
    if (!byEmail.has(email)) byEmail.set(email, account);
  }
  return { byEmail };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The named accounts only — what resolving a handful of ids actually needs. */
async function fetchAccountsByIds(
  db: SupabaseClient,
  ids: string[],
): Promise<Map<string, AccountLite>> {
  const out = new Map<string, AccountLite>();
  // Postgres rejects the WHOLE `in (…)` on one malformed uuid, which would turn
  // a single junk id in the request into "nobody resolved". Filter first.
  const uuids = ids.filter((id) => UUID_RE.test(id));
  if (uuids.length === 0) return out;

  const { data, error } = await db
    .from('customers')
    .select('id, first_name, last_name, email, role, affiliate_id')
    .in('id', uuids);
  if (error) {
    console.error('[outreach] account id read failed:', error.message);
    return out;
  }
  for (const row of (data ?? []) as any[]) {
    out.set(row.id, {
      id: row.id,
      email: row.email,
      name: `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || null,
      role: row.role ?? 'customer',
      affiliateId: row.affiliate_id ?? null,
    });
  }
  return out;
}

const recipientFromAccount = (
  account: AccountLite,
  abandoned: AbandonedCartLite | null,
  nudge: NudgeSummary | null = null,
): OutreachRecipient => ({
  id: account.id,
  email: account.email,
  name: account.name,
  affiliateId: account.affiliateId,
  firstName: firstNameOf(account.name),
  source: 'account',
  abandoned,
  nudge,
});

const recipientFromLedger = (
  email: string,
  name: string | null,
  abandoned: AbandonedCartLite | null,
  nudge: NudgeSummary | null = null,
): OutreachRecipient => ({
  id: puramassId(email),
  email,
  name,
  affiliateId: null,
  firstName: firstNameOf(name),
  source: 'puramass',
  abandoned,
  nudge,
});

/**
 * Turn the ids the composer holds back into recipients.
 *
 * Ids the caller made up — a UUID with no account, a `pm:` address with no
 * ledger row — are dropped rather than guessed at, so a send can never be
 * addressed to somebody this admin never picked. Order is preserved: the first
 * id is the recipient the composer previewed, and the only one a CC applies to.
 */
export async function resolveOutreachRecipients(
  db: SupabaseClient,
  ids: string[],
): Promise<OutreachRecipient[]> {
  const wanted = [...new Set(ids.map((id) => String(id ?? '').trim()).filter(Boolean))];
  if (wanted.length === 0) return [];

  const accountIds = wanted.filter((id) => !isPuramassId(id));
  const ledgerEmails = wanted.filter(isPuramassId).map(emailFromPuramassId).filter(Boolean);

  const [accounts, ledgerNames, abandoned, nudges] = await Promise.all([
    accountIds.length > 0 ? fetchAccountsByIds(db, accountIds) : Promise.resolve(new Map()),
    // Only read the ledger when a Stealth Health buyer was actually asked for:
    // the customer desk resolving one account id must not pay for it.
    ledgerEmails.length > 0
      ? fetchPuramassLedger(db, { limit: ROW_LIMIT }).then(groupPuramassByEmail)
      : Promise.resolve(new Map()),
    fetchAbandonedByEmail(db),
    // Only the recent window: what the composer does with this is warn that
    // somebody on the draft heard from us days ago.
    fetchNudgeIndex(db, { since: recentNudgeSince() }),
  ]);

  const out: OutreachRecipient[] = [];
  for (const id of wanted) {
    if (isPuramassId(id)) {
      const email = emailFromPuramassId(id);
      const profile = ledgerNames.get(email);
      // Confirmed against the ledger for the same reason resolveCustomerRef
      // does it: otherwise any address could be mailed by typing an id.
      if (!email || !profile) continue;
      out.push(
        recipientFromLedger(
          email,
          profile.name,
          abandoned.get(email) ?? null,
          nudges.byEmail[historyKey(email)] ?? null,
        ),
      );
      continue;
    }

    const account = accounts.get(id);
    if (!account || EXCLUDED_ROLES.has(account.role)) continue;
    const email = normalizeEmail(account.email);
    out.push(
      recipientFromAccount(
        account,
        abandoned.get(email) ?? null,
        nudges.byEmail[historyKey(account.email)] ?? null,
      ),
    );
  }

  return out;
}

/**
 * The people the "send this to other customers too" search offers.
 *
 * `abandonedOnly` is the mode that matters for cart recovery: it narrows the
 * list to buyers who actually have a pending or expired checkout, so the admin
 * cannot accidentally tell somebody with no cart that their cart is waiting.
 */
export async function searchOutreachCandidates(
  db: SupabaseClient,
  opts: { q?: string; abandonedOnly?: boolean; exclude?: string[]; limit?: number } = {},
): Promise<OutreachRecipient[]> {
  const q = String(opts.q ?? '').trim().toLowerCase();
  const limit = Math.min(Math.max(1, opts.limit ?? CANDIDATE_LIMIT), CANDIDATE_LIMIT);
  const excluded = new Set((opts.exclude ?? []).map((id) => String(id ?? '').trim()).filter(Boolean));
  const abandonedOnly = opts.abandonedOnly !== false;

  const out: OutreachRecipient[] = [];
  const seenEmails = new Set<string>();

  const matches = (recipient: OutreachRecipient): boolean =>
    !q ||
    recipient.email.toLowerCase().includes(q) ||
    (recipient.name ?? '').toLowerCase().includes(q);

  const push = (recipient: OutreachRecipient): boolean => {
    const email = normalizeEmail(recipient.email);
    if (!email || seenEmails.has(email)) return false;
    if (excluded.has(recipient.id)) return false;
    if (!matches(recipient)) return false;
    seenEmails.add(email);
    out.push(recipient);
    return out.length >= limit;
  };

  // Both branches also read who has heard from us lately, so a row can say so
  // before it is ticked. Narrowed to the recent window: the picker only ever
  // asks "was this person emailed in the last fortnight?", and this read runs
  // on every search.
  if (abandonedOnly) {
    // Cart-first, and read once: the same ledger rows give both the carts and
    // the buyer names for the people who never registered an account.
    const orders = await fetchAbandonedOrders(db, { limit: ROW_LIMIT });
    const [abandoned, { byEmail }, nudges] = await Promise.all([
      buildAbandonedIndex(db, orders),
      fetchAccountsByEmail(db),
      fetchNudgeIndex(db, { since: recentNudgeSince() }),
    ]);
    const names = groupPuramassByEmail(orders);

    const entries = [...abandoned.entries()].sort((a, b) =>
      a[1].createdAt < b[1].createdAt ? 1 : -1,
    );
    for (const [email, cart] of entries) {
      const account = byEmail.get(email);
      if (account && EXCLUDED_ROLES.has(account.role)) continue;
      const nudge = nudges.byEmail[historyKey(email)] ?? null;
      const full = account
        ? recipientFromAccount(account, cart, nudge)
        : recipientFromLedger(email, names.get(email)?.name ?? null, cart, nudge);
      if (push(full)) break;
    }
    return out;
  }

  // Everyone: account customers first (they are the population the desk works),
  // then the Stealth Health buyers who never registered here.
  const [abandoned, { byEmail }, nudges] = await Promise.all([
    fetchAbandonedByEmail(db),
    fetchAccountsByEmail(db),
    fetchNudgeIndex(db, { since: recentNudgeSince() }),
  ]);

  let full = false;
  for (const account of byEmail.values()) {
    if (EXCLUDED_ROLES.has(account.role)) continue;
    const email = normalizeEmail(account.email);
    if (
      push(
        recipientFromAccount(
          account,
          abandoned.get(email) ?? null,
          nudges.byEmail[historyKey(account.email)] ?? null,
        ),
      )
    ) {
      full = true;
      break;
    }
  }
  if (!full) {
    const profiles = groupPuramassByEmail(await fetchPuramassLedger(db, { limit: ROW_LIMIT }));
    for (const [email, profile] of profiles) {
      if (
        push(
          recipientFromLedger(
            email,
            profile.name,
            abandoned.get(email) ?? null,
            nudges.byEmail[historyKey(email)] ?? null,
          ),
        )
      ) {
        break;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* One recipient's cart and payment link                               */
/* ------------------------------------------------------------------ */

/**
 * Resolve the cart block and the payment-link button for ONE recipient.
 *
 * Read fresh from the ledger every time, never carried across recipients: the
 * hosted link is what takes the money, so sending person B the link belonging
 * to person A would charge B for A's basket. Returns empty blocks (not an
 * error) when the cart moved on — a checkout that got paid between drafting
 * and sending must go out as a plain note, not as "your cart is waiting".
 */
export async function loadRecipientCheckout(
  db: SupabaseClient,
  orderId: string | null | undefined,
  opts: { includeCart?: boolean } = {},
): Promise<RecipientCheckout> {
  if (!orderId) return { ...EMPTY_CHECKOUT };

  const order = await loadLedgerRow(db, orderId);
  if (!order) return { ...EMPTY_CHECKOUT };
  // Re-checked at send time, not just at draft time.
  if (!(PAYMENT_LINK_STATUSES as readonly string[]).includes(order.status)) {
    return { ...EMPTY_CHECKOUT };
  }

  const summary = await buildOrderSummary(db, order);
  const link = safeHttpUrl(order.payment_link);

  return {
    cart: opts.includeCart === false ? null : cartFromSummary(summary),
    checkout: link
      ? { url: link, label: 'Complete your order', note: checkoutNote(order.status) }
      : null,
    orderId: order.id,
    reference: order.partner_reference,
    status: order.status,
  };
}

/* ------------------------------------------------------------------ */
/* What each recipient has already been sent                           */
/* ------------------------------------------------------------------ */

/**
 * The outreach log, folded into "who has already had which kind of email".
 *
 * Keyed by lower-cased address rather than by customer id, exactly as
 * `fetchEmailHistory` matches: plenty of these people have no `customers` row
 * at all (a Stealth Health buyer who never registered), and an account created
 * after the email was sent must not reset their history to empty.
 *
 * Only successful sends are counted — a message the mail server rejected never
 * reached anybody, so excluding that person from the next batch would drop them
 * from a campaign over an email they never received.
 *
 * `scope` is deliberately NOT filtered. Affiliates have their own desk and are
 * excluded from this directory outright, so the only thing a scope filter could
 * change is under-counting somebody who was written to from both desks — and
 * where the two readings differ, the safe one for a suppression rule is the one
 * that holds a person back.
 */
export async function fetchOutreachHistory(
  db: SupabaseClient,
  opts: { templates?: string[]; since?: string | null } = {},
): Promise<{ byEmail: EmailHistoryIndex; available: boolean }> {
  const templates = (opts.templates ?? []).map((t) => String(t ?? '').trim()).filter(Boolean);
  const byEmail: EmailHistoryIndex = {};

  let query = db
    .from('customer_emails')
    .select('to_email, template, created_at')
    .eq('success', true)
    // Newest first, so the first row seen for a (person, template) pair is the
    // one the answer wants and the rest can be skipped.
    .order('created_at', { ascending: false })
    .limit(ROW_LIMIT);
  if (templates.length > 0) query = query.in('template', templates);
  if (opts.since) query = query.gte('created_at', opts.since);

  const { data, error } = await query;
  if (error) {
    // A missing table means the CRM migration has not run — reported as
    // "unavailable" so the desk can say the rule cannot be applied rather than
    // silently emailing people it should have held back.
    console.error('[outreach] email history read failed:', error.message);
    return { byEmail, available: false };
  }

  for (const row of (data ?? []) as any[]) {
    const email = historyKey(row.to_email);
    const template = String(row.template ?? '').trim();
    const sentAt = String(row.created_at ?? '');
    if (!email || !template || !sentAt) continue;
    const entry = (byEmail[email] ??= {});
    if (!entry[template]) entry[template] = sentAt;
  }

  return { byEmail, available: true };
}

/**
 * When each address was last written to, and how often lately.
 *
 * The suppression index above answers "has this person had THIS email?" for a
 * rule the admin ticked. This answers the question nobody has to tick:
 * "have we just emailed them?" — so the customer table can mark the row and the
 * composer can name the people on a draft who heard from us days ago.
 *
 * Successful sends only, keyed by lower-cased address, for exactly the reasons
 * `fetchOutreachHistory` gives: a rejected message reached nobody, and plenty
 * of these people have no `customers` row to key on.
 *
 * `since` narrows the READ, not the meaning: `recentCount` is always counted
 * from RECENT_NUDGE_DAYS ago. Pass the recent cutoff where only "emailed
 * lately?" matters (the composer, the picker) and leave it off where the last
 * send itself is on screen whatever its age (the customer table).
 *
 * Rows come back newest-first, so the ROW_LIMIT ceiling drops the OLDEST sends
 * first — on a log big enough to hit it, somebody written to long ago reads as
 * never written to, which is the harmless direction to be wrong in.
 */
export async function fetchNudgeIndex(
  db: SupabaseClient,
  opts: { since?: string | null } = {},
): Promise<{ byEmail: NudgeIndex; available: boolean }> {
  const byEmail: NudgeIndex = {};

  let query = db
    .from('customer_emails')
    .select('to_email, template, created_at')
    .eq('success', true)
    .order('created_at', { ascending: false })
    .limit(ROW_LIMIT);
  if (opts.since) query = query.gte('created_at', opts.since);

  const { data, error } = await query;
  if (error) {
    // The CRM migration has not run. Reported rather than swallowed so the UI
    // can leave the column out instead of telling an admin nobody has ever
    // been emailed.
    console.error('[outreach] nudge index read failed:', error.message);
    return { byEmail, available: false };
  }

  const recentCutoff = Date.parse(recentNudgeSince());
  for (const row of (data ?? []) as any[]) {
    const email = historyKey(row.to_email);
    const template = String(row.template ?? '').trim();
    const sentAt = String(row.created_at ?? '');
    const sentMs = Date.parse(sentAt);
    if (!email || !sentAt || !Number.isFinite(sentMs)) continue;
    const recent = sentMs >= recentCutoff ? 1 : 0;
    const seen = byEmail[email];
    if (!seen) {
      // Newest-first, so the first row for an address is its latest send.
      byEmail[email] = { template: template || 'custom', sentAt, recentCount: recent };
    } else {
      seen.recentCount += recent;
    }
  }

  return { byEmail, available: true };
}

/** A recipient held back, and the email they had already been sent. */
export interface SuppressedRecipient {
  id: string;
  email: string;
  name: string | null;
  template: string;
  sentAt: string;
}

/**
 * Split a resolved batch into who still gets the email and who has had it.
 *
 * The page filters the table by the same rule before anybody is ticked, but the
 * two are minutes apart — long enough for a colleague at another desk to send
 * the very email this batch is about to repeat. This runs against the log as it
 * is at send time, which is the only reading that can actually prevent a
 * duplicate.
 */
export async function splitBySuppression(
  db: SupabaseClient,
  recipients: OutreachRecipient[],
  filters: Pick<AudienceFilters, 'excludeTemplates' | 'excludeWithinDays'>,
): Promise<{ sendable: OutreachRecipient[]; skipped: SuppressedRecipient[]; available: boolean }> {
  if (filters.excludeTemplates.length === 0 || recipients.length === 0) {
    return { sendable: recipients, skipped: [], available: true };
  }

  const { byEmail, available } = await fetchOutreachHistory(db, {
    templates: filters.excludeTemplates,
    since: suppressionSince(filters),
  });
  // The log could not be read. Sending anyway would break the promise the admin
  // just made; the route turns this into a refusal they can see.
  if (!available) return { sendable: [], skipped: [], available: false };

  const sendable: OutreachRecipient[] = [];
  const skipped: SuppressedRecipient[] = [];
  for (const recipient of recipients) {
    const reason = suppressionReason(recipient.email, filters, byEmail);
    if (reason) {
      skipped.push({
        id: recipient.id,
        email: recipient.email,
        name: recipient.name,
        template: reason.template,
        sentAt: reason.sentAt,
      });
    } else {
      sendable.push(recipient);
    }
  }
  return { sendable, skipped, available: true };
}

/** Run `task` over `items` a few at a time, preserving input order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker),
  );
  return results;
}
