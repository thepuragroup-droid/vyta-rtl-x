/**
 * Server-side plumbing for the Stealth Health settlement dashboard: auth, the
 * shared service-role client, and the reads every route needs.
 *
 * The arithmetic lives in lib/admin/stealth-health.ts (pure, tested). This
 * module only fetches the rows it works on — and does so defensively, because
 * migrations here are applied by hand in the Supabase SQL editor. Between a
 * deploy and stealth-health-settlement-migration.sql running (and for the
 * window after it while PostgREST serves a stale schema cache) the settlement
 * tables simply don't exist. That must degrade to an empty dashboard with a
 * "run the migration" banner, never a 500.
 */
import type { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { UserRole } from '@/lib/permissions';
import { isMissingColumnError } from '@/lib/payments/puramass-columns';
import {
  normalizeTerms,
  computeOrderSettlement,
  isSettleable,
  deriveInvoiceStatus,
  type SettlementOrderInput,
  type SettlementTerms,
  type OrderSettlement,
  type SettlementInvoiceStatus,
} from '@/lib/admin/stealth-health';
import type { Currency } from '@/lib/currency';

export const db: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// 42P01 = undefined_table (Postgres). PGRST205 = table not in PostgREST's
// schema cache. Both mean "the migration hasn't run here yet".
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205']);

/** True when an error means "that table isn't there", not "the query failed". */
export function isMissingTableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  if (e.code && MISSING_TABLE_CODES.has(e.code)) return true;
  const msg = typeof e.message === 'string' ? e.message : '';
  return (
    (/\brelation\b/i.test(msg) && /does not exist/i.test(msg)) ||
    (/\btable\b/i.test(msg) && /schema cache/i.test(msg))
  );
}

/** "The settlement schema isn't there yet" — either the table or its columns. */
export function isMissingSchema(err: unknown): boolean {
  return isMissingTableError(err) || isMissingColumnError(err);
}

export interface Actor {
  id: string;
  email: string | null;
  role: UserRole;
}

async function resolveActor(req: NextRequest): Promise<Actor | null> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return null;
  const { data } = await db
    .from('customers')
    .select('role, email')
    .eq('id', user.id)
    .single();
  return {
    id: user.id,
    email: data?.email ?? user.email ?? null,
    role: (data?.role ?? 'customer') as UserRole,
  };
}

/**
 * Read access to the settlement dashboard: admin + assistant, matching
 * the Orders tab of /admin/stealth-health (the ledger these figures are derived from).
 */
export async function requireReader(req: NextRequest): Promise<Actor | null> {
  const actor = await resolveActor(req);
  if (!actor) return null;
  return actor.role === 'admin' || actor.role === 'assistant' ? actor : null;
}

/**
 * Write access — raising an invoice against a partner, recording a payment, or
 * changing the commercial terms. Admin only: these are financial claims, and
 * an assistant reconciling orders has no business creating them.
 */
export async function requireAdmin(req: NextRequest): Promise<Actor | null> {
  const actor = await resolveActor(req);
  return actor?.role === 'admin' ? actor : null;
}

/** Load the commercial terms, falling back to defaults when unmigrated. */
export async function loadTerms(): Promise<{ terms: SettlementTerms; migrated: boolean }> {
  const { data, error } = await db
    .from('stealth_health_settings')
    .select('*')
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return { terms: normalizeTerms(null), migrated: false };
    console.error('[stealth-health] settings read failed:', error);
    return { terms: normalizeTerms(null), migrated: true };
  }
  return { terms: normalizeTerms(data), migrated: true };
}

/** Columns the settlement reads want off the hand-off ledger. */
const LEDGER_COLUMNS =
  'id, partner_reference, transaction_id, status, subtotal_cents, currency, paid_at, ' +
  'created_at, customer_email, items, invoice_id, refunded_total_cents, ' +
  'settlement_invoice_id, settlement_excluded';

// Same list without anything a later migration adds, so the dashboard still
// loads (showing the un-refunded, un-billed view) before those columns exist.
const LEDGER_COLUMNS_LEGACY =
  'id, partner_reference, transaction_id, status, subtotal_cents, currency, paid_at, ' +
  'created_at, customer_email, items, invoice_id';

export interface LedgerReadOptions {
  /** Inclusive lower bound on the settlement day (YYYY-MM-DD). */
  from?: string | null;
  /** Inclusive upper bound on the settlement day (YYYY-MM-DD). */
  to?: string | null;
  /** Only rows already billed onto this settlement invoice. */
  invoiceId?: string | null;
  /** Only paid rows not yet billed and not excluded. */
  unbilledOnly?: boolean;
  limit?: number;
}

export interface LedgerRead {
  rows: SettlementOrderInput[];
  /** False when the settlement columns aren't queryable yet. */
  settlementColumns: boolean;
}

/**
 * Read hand-off ledger rows for settlement.
 *
 * Range filtering is on `paid_at` when we have it and `created_at` otherwise,
 * which is why it is applied in JS rather than in the query: a row can be
 * bounded by either column, and PostgREST can't express "whichever is set"
 * without a generated column. The ledger is small (one row per hand-off) and
 * already capped, so this is cheap and keeps the boundary identical to the
 * `day` the per-order math reports.
 */
export async function loadLedgerRows(opts: LedgerReadOptions = {}): Promise<LedgerRead> {
  const limit = Math.min(50000, Math.max(1, opts.limit ?? 50000));

  const run = (columns: string, withSettlement: boolean) => {
    let q = db.from('puramass_orders').select(columns).limit(limit);
    if (withSettlement) {
      if (opts.invoiceId) q = q.eq('settlement_invoice_id', opts.invoiceId);
      if (opts.unbilledOnly) {
        q = q.is('settlement_invoice_id', null).eq('settlement_excluded', false);
      }
    }
    if (opts.unbilledOnly || opts.invoiceId) q = q.eq('status', 'paid');
    return q.order('created_at', { ascending: false });
  };

  let settlementColumns = true;
  let { data, error } = await run(LEDGER_COLUMNS, true);
  if (error && isMissingSchema(error)) {
    settlementColumns = false;
    ({ data, error } = await run(LEDGER_COLUMNS_LEGACY, false));
  }
  if (error) {
    console.error('[stealth-health] ledger read failed:', error);
    return { rows: [], settlementColumns };
  }

  let rows = (data ?? []) as unknown as SettlementOrderInput[];

  // An invoice-scoped or unbilled read is meaningless without the settlement
  // columns — better to show nothing than to show every paid order as unbilled
  // and invite a double-bill.
  if (!settlementColumns && (opts.invoiceId || opts.unbilledOnly)) {
    rows = [];
  }

  const dayOf = (r: SettlementOrderInput) =>
    String(r.paid_at ?? r.created_at ?? '').slice(0, 10);
  if (opts.from) rows = rows.filter((r) => { const d = dayOf(r); return d !== '' && d >= opts.from!; });
  if (opts.to) rows = rows.filter((r) => { const d = dayOf(r); return d !== '' && d <= opts.to!; });

  return { rows, settlementColumns };
}

/** Per-order settlements for every paid, non-excluded row in a read. */
export function settleableSettlements(
  rows: SettlementOrderInput[],
  terms: SettlementTerms,
): OrderSettlement[] {
  return rows.filter(isSettleable).map((r) => computeOrderSettlement(r, terms));
}

/** Total remitted against a set of invoices, keyed by invoice id (cents). */
export async function loadPayoutsByInvoice(
  invoiceIds: string[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (invoiceIds.length === 0) return out;
  const { data, error } = await db
    .from('stealth_health_payouts')
    .select('invoice_id, amount_cents')
    .in('invoice_id', invoiceIds);
  if (error) {
    if (!isMissingSchema(error)) console.error('[stealth-health] payout read failed:', error);
    return out;
  }
  for (const p of (data ?? []) as any[]) {
    const id = p.invoice_id ? String(p.invoice_id) : null;
    if (!id) continue;
    out[id] = (out[id] ?? 0) + Math.round(Number(p.amount_cents ?? 0));
  }
  return out;
}

/** One settlement invoice as every surface renders it. */
export interface SettlementInvoiceDTO {
  id: string;
  invoice_number: string;
  /** Live status: what an admin set, corrected by what has been remitted. */
  status: SettlementInvoiceStatus;
  /** The status as stored, before payouts are taken into account. */
  stored_status: string;
  currency: Currency;
  period_start: string | null;
  period_end: string | null;
  issue_date: string | null;
  due_date: string | null;
  order_count: number;
  units: number;
  gross_cents: number;
  refunds_cents: number;
  shipping_cents: number;
  fee_cents: number;
  amount_due_cents: number;
  paid_cents: number;
  balance_cents: number;
  commission_pct: number;
  flat_fee_cents: number;
  shipping_remitted: boolean;
  notes: string | null;
  sent_at: string | null;
  voided_at: string | null;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Shape a stored invoice row + what has been remitted against it for the wire.
 * Every money field stays in integer cents; the UI formats.
 */
export function shapeSettlementInvoice(
  inv: Record<string, any>,
  paidCents: number,
): SettlementInvoiceDTO {
  const amountDue = Math.round(Number(inv.amount_due_cents ?? 0));
  return {
    id: String(inv.id),
    invoice_number: String(inv.invoice_number ?? ''),
    status: deriveInvoiceStatus(inv.status, amountDue, paidCents),
    stored_status: String(inv.status ?? 'draft'),
    currency: inv.currency === 'CAD' ? 'CAD' : 'USD',
    period_start: inv.period_start ?? null,
    period_end: inv.period_end ?? null,
    issue_date: inv.issue_date ?? null,
    due_date: inv.due_date ?? null,
    order_count: Number(inv.order_count ?? 0),
    units: Number(inv.units ?? 0),
    gross_cents: Math.round(Number(inv.gross_cents ?? 0)),
    refunds_cents: Math.round(Number(inv.refunds_cents ?? 0)),
    shipping_cents: Math.round(Number(inv.shipping_cents ?? 0)),
    fee_cents: Math.round(Number(inv.fee_cents ?? 0)),
    amount_due_cents: amountDue,
    paid_cents: paidCents,
    balance_cents: Math.max(0, amountDue - paidCents),
    commission_pct: Number(inv.commission_pct ?? 0),
    flat_fee_cents: Math.round(Number(inv.flat_fee_cents ?? 0)),
    shipping_remitted: inv.shipping_remitted ?? true,
    notes: inv.notes ?? null,
    sent_at: inv.sent_at ?? null,
    voided_at: inv.voided_at ?? null,
    created_by_email: inv.created_by_email ?? null,
    created_at: inv.created_at ?? '',
    updated_at: inv.updated_at ?? '',
  };
}
