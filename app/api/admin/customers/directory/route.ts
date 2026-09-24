import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { UserRole } from '@/lib/permissions';
import { fetchLeads, type Lead } from '@/lib/admin/customer-leads';
import {
  fetchClientCounts,
  fetchPuramassLedger,
  groupPuramassByEmail,
  normalizeEmail,
  puramassDirectoryRow,
  type DirectoryRow,
} from '@/lib/admin/customer-directory';
import { fetchNudgeIndex } from '@/lib/customer/outreach';
import { historyKey, type NudgeIndex } from '@/lib/customer/audience';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type Access =
  | { ok: false }
  /** admin/assistant see everyone; an affiliate only sees their own referrals. */
  | { ok: true; scope: 'all' }
  | { ok: true; scope: 'affiliate'; affiliateId: string };

async function verifyAccess(req: NextRequest): Promise<Access> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { ok: false };
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { ok: false };
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  const role = (data?.role ?? 'customer') as UserRole;
  if (role === 'admin' || role === 'assistant') return { ok: true, scope: 'all' };
  // Affiliates reach /admin/customers as part of their scoped portal — they get
  // the customers bound to them and nothing else (no Stealth Health ledger).
  if (role === 'affiliate') return { ok: true, scope: 'affiliate', affiliateId: user.id };
  return { ok: false };
}

/** Staff-ish roles, i.e. everything that is not a paying customer. */
const STAFF_ROLES = new Set(['admin', 'assistant', 'warehouse', 'analytics']);

/**
 * Affiliates are NOT customers here.
 *
 * They have their own desk at /admin/affiliates with their own metrics
 * (referrals, commissions, payouts) and their own separately-scoped lead
 * record. Listing them here as well invites treating a partner like a buyer —
 * so they are excluded from this directory outright rather than tucked behind
 * a filter.
 */
const EXCLUDED_ROLES = new Set(['affiliate']);

/** PostgREST caps an unbounded select at 1000 rows; ask for more explicitly. */
const ROW_LIMIT = 20000;

/** An invoice in one of these states is not a purchase anyone has committed to. */
const NON_PURCHASE_INVOICE = new Set(['draft', 'void', 'cancelled']);

interface Tally { invoices: number; orders: number; puramass: number }

const emptyTally = (): Tally => ({ invoices: 0, orders: 0, puramass: 0 });

const mergeTallies = (...parts: (Tally | undefined)[]): Tally =>
  parts.filter(Boolean).reduce<Tally>(
    (acc, t) => ({
      invoices: acc.invoices + t!.invoices,
      orders: acc.orders + t!.orders,
      puramass: acc.puramass + t!.puramass,
    }),
    emptyTally(),
  );

/**
 * Count what each person has actually bought, without counting anything twice.
 *
 * The same purchase can exist in up to three places: a Stealth Health hand-off is
 * materialised into an invoice, and a storefront order can be invoiced too. So
 * invoices are the spine — an order or a hand-off only counts on its own when
 * no invoice was raised against it.
 *
 * Rows are keyed by `customer_id` when there is one and by email otherwise,
 * because plenty of invoices and orders predate the account they belong to.
 */
async function buildPurchaseTallies(): Promise<{
  byId: Map<string, Tally>;
  byEmail: Map<string, Tally>;
}> {
  const byId = new Map<string, Tally>();
  const byEmail = new Map<string, Tally>();

  const bump = (
    customerId: string | null,
    email: string | null,
    field: keyof Tally,
  ) => {
    const map = customerId ? byId : byEmail;
    const key = customerId ?? normalizeEmail(email);
    if (!key) return;
    const tally = map.get(key) ?? emptyTally();
    tally[field] += 1;
    map.set(key, tally);
  };

  // Only base-schema columns are named here — `source` and friends arrive with
  // later migrations and would fail the query where those haven't run.
  const [invoiceRes, orderRes] = await Promise.all([
    db
      .from('invoices')
      .select('id, customer_id, customer_email, order_id, status')
      .limit(ROW_LIMIT),
    db.from('orders').select('id, customer_id, email, status').limit(ROW_LIMIT),
  ]);

  if (invoiceRes.error) {
    console.error('[customers/directory] invoice tally failed:', invoiceRes.error.message);
  }
  if (orderRes.error) {
    console.error('[customers/directory] order tally failed:', orderRes.error.message);
  }

  const invoicedOrderIds = new Set<string>();
  for (const inv of (invoiceRes.data ?? []) as any[]) {
    if (NON_PURCHASE_INVOICE.has(String(inv.status).toLowerCase())) continue;
    if (inv.order_id) invoicedOrderIds.add(inv.order_id);
    bump(inv.customer_id ?? null, inv.customer_email ?? null, 'invoices');
  }

  for (const o of (orderRes.data ?? []) as any[]) {
    // Already counted as the invoice raised against it.
    if (invoicedOrderIds.has(o.id)) continue;
    bump(o.customer_id ?? null, o.email ?? null, 'orders');
  }

  return { byId, byEmail };
}

/**
 * A claim recorded on `customers` before leads moved to their own table
 * (registration-alerts-migration.sql). Read-only: nothing writes there any
 * more, but an existing claim should still show.
 */
function legacyLead(c: any, email: string): Lead | null {
  if (!c.claimed_by_id) return null;
  return {
    email,
    scope: 'customer',
    customer_id: c.id,
    claimed_by_id: c.claimed_by_id,
    claimed_by_email: c.claimed_by_email ?? null,
    claimed_by_name: c.claimed_by_name ?? null,
    claimed_at: c.claimed_at ?? null,
    status: 'new',
    contact_method: null,
    notes: null,
    last_contacted_at: null,
    next_follow_up_at: null,
    updated_by_name: null,
    updated_at: null,
  };
}

/** Paid hand-offs with no invoice behind them — the ones nothing else counts. */
function countUninvoicedPaid(profile: { orders: { status: string; invoice_id: string | null }[] } | null): number {
  if (!profile) return 0;
  return profile.orders.filter((o) => o.status === 'paid' && !o.invoice_id).length;
}

/**
 * GET /api/admin/customers/directory
 *
 * The merged customer list behind /admin/customers: every account customer,
 * plus everyone who only ever bought through the Stealth Health hosted checkout.
 * Stealth Health buyers have no account row, so they are synthesised from the
 * hand-off ledger and marked `source: 'puramass'` — the page draws the line.
 *
 * Filtering and sorting happen client-side (the list is small and the pills
 * need instant response); this route just returns the union plus counts.
 */
export async function GET(req: NextRequest) {
  const access = await verifyAccess(req);
  if (!access.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  // `*` rather than a column list: the customer surfaces read fields added by
  // several migrations, and naming one the database hasn't got yet fails the
  // whole query. Nothing sensitive leaves — the response below is built field
  // by field, so password_hash and wallet_address are never copied out.
  let accountQuery = db
    .from('customers')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(ROW_LIMIT);
  if (access.scope === 'affiliate') {
    accountQuery = accountQuery.eq('affiliate_id', access.affiliateId);
  }

  const { data: accounts, error } = await accountQuery;
  if (error) {
    console.error('[customers/directory] account read failed:', error);
    return NextResponse.json(
      { error: `Could not load customers: ${error.message}` },
      { status: 500 },
    );
  }

  // The Stealth Health ledger is service-role only and irrelevant to an affiliate's
  // scoped view, so it's read for admin/assistant alone.
  const [ledger, tallies, leadData, clientCounts, nudgeData] = await Promise.all([
    access.scope === 'all' ? fetchPuramassLedger(db) : Promise.resolve([]),
    buildPurchaseTallies(),
    fetchLeads(db, { scope: 'customer' }),
    fetchClientCounts(db, { limit: ROW_LIMIT }),
    // When each person was last written to, so the table can flag anybody who
    // has just had an email before they are ticked for another one. Read whole
    // rather than for the recent window alone: the column shows the last send
    // whatever its age, and only the count beside it is windowed.
    //
    // Admin/assistant only. `customer_emails` is service-role, an affiliate's
    // scoped view has no business reading what the desk sent their referrals,
    // and `nudgesAvailable` below keeps the column off rather than showing
    // them a row of blanks that reads as "never emailed".
    access.scope === 'all'
      ? fetchNudgeIndex(db)
      : Promise.resolve({ byEmail: {} as NudgeIndex, available: false }),
  ]);
  const puramassByEmail = groupPuramassByEmail(ledger);
  // Secondary index: a hand-off that carried an account link but a different
  // (or missing) email still belongs to that customer.
  const puramassByCustomerId = new Map(
    [...puramassByEmail.values()]
      .filter((p) => p.customerId)
      .map((p) => [p.customerId as string, p]),
  );

  const rows: DirectoryRow[] = [];
  const seenEmails = new Set<string>();

  for (const c of (accounts ?? []) as any[]) {
    const email = normalizeEmail(c.email);
    // Seen either way, so an affiliate who also bought through Stealth Health
    // isn't re-added below as a synthetic buyer row.
    seenEmails.add(email);
    if (EXCLUDED_ROLES.has(c.role ?? 'customer')) continue;
    // A registered customer who also bought via Stealth Health — match on email
    // first (most hand-offs are guests), then on the ledger's account link.
    const pm = puramassByEmail.get(email) ?? puramassByCustomerId.get(c.id) ?? null;
    const tally = mergeTallies(tallies.byId.get(c.id), tallies.byEmail.get(email), {
      ...emptyTally(),
      // Paid hand-offs that were materialised into an invoice are already in
      // the invoice count; only the un-materialised ones are added here.
      puramass: countUninvoicedPaid(pm),
    });

    rows.push({
      id: c.id,
      source: 'account',
      first_name: c.first_name ?? null,
      last_name: c.last_name ?? null,
      email: c.email,
      phone: c.phone ?? null,
      city: c.shipping_city ?? null,
      state: c.shipping_state ?? null,
      country: c.shipping_country ?? null,
      role: c.role ?? 'customer',
      created_at: c.created_at,
      last_login_at: c.last_login_at ?? null,
      preferred_currency: c.preferred_currency ?? null,
      active: c.active !== false,
      claimed_by_id: c.claimed_by_id ?? null,
      claimed_by_name: c.claimed_by_name ?? null,
      affiliate_id: c.affiliate_id ?? null,
      has_completed_first_order: Boolean(c.has_completed_first_order),
      lead: leadData.leads.get(email) ?? legacyLead(c, email),
      purchases: tally.invoices + tally.orders + tally.puramass,
      purchase_breakdown: tally,
      clients: clientCounts.get(c.id) ?? 0,
      puramass_orders: pm?.orderCount ?? 0,
      puramass_paid_orders: pm?.paidCount ?? 0,
      puramass_paid_cents: pm?.paidCents ?? 0,
      puramass_last_order_at: pm?.lastOrderAt ?? null,
      nudge: nudgeData.byEmail[historyKey(c.email)] ?? null,
    });
  }

  for (const [email, profile] of puramassByEmail) {
    if (seenEmails.has(email)) continue;
    const row = puramassDirectoryRow(profile);
    // No account, so anything invoiced against them is keyed by email alone.
    const tally = mergeTallies(tallies.byEmail.get(email), {
      ...emptyTally(),
      puramass: countUninvoicedPaid(profile),
    });
    row.purchases = tally.invoices + tally.orders + tally.puramass;
    row.purchase_breakdown = tally;
    row.lead = leadData.leads.get(email) ?? null;
    row.nudge = nudgeData.byEmail[historyKey(email)] ?? null;
    rows.push(row);
  }

  const counts = {
    all: rows.length,
    customers: rows.filter(
      (r) => r.source === 'puramass' || r.role === 'customer',
    ).length,
    puramass: rows.filter((r) => r.puramass_orders > 0).length,
    staff: rows.filter((r) => r.role && STAFF_ROLES.has(r.role)).length,
    claimed: rows.filter((r) => r.lead?.claimed_by_id).length,
    unclaimed: rows.filter((r) => !r.lead?.claimed_by_id).length,
  };

  return NextResponse.json({
    customers: rows,
    counts,
    // False for an affiliate's scoped view, where the Stealth Health ledger is not
    // read at all — the UI must not read "0 Stealth Health orders" as "none exist".
    puramassAvailable: access.scope === 'all',
    // False until customer-crm-migration.sql runs; the UI then explains why
    // every row reads as unclaimed rather than implying nobody has claimed one.
    leadsAvailable: leadData.available,
    // False for an affiliate's scoped view and until the CRM migration runs.
    // The "Nudged" column is dropped rather than drawn empty — a blank there
    // would read as "we have never emailed any of these people".
    nudgesAvailable: nudgeData.available,
  });
}
