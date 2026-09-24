import { NextRequest, NextResponse } from 'next/server';
import {
  db,
  requireReader,
  loadTerms,
  loadLedgerRows,
  settleableSettlements,
  isMissingSchema,
} from '@/lib/admin/stealth-health-server';
import {
  sumSettlements,
  emptyTotals,
  addToTotals,
  deriveInvoiceStatus,
  describeTerms,
  type SettlementTotals,
  type SettlementInvoiceStatus,
} from '@/lib/admin/stealth-health';
import type { Currency } from '@/lib/currency';

export const dynamic = 'force-dynamic';

// Cap on the daily series so an all-time load stays bounded, matching the
// storefront analytics summary.
const MAX_DAILY_POINTS = 90;

export interface StealthHealthDailyPoint {
  date: string;
  orders: number;
  /** Earned that day, in cents (what they owe us for those orders). */
  earned_cents: number;
  /** Gross the buyer paid Stealth Health that day, in cents. */
  gross_cents: number;
}

export interface StealthHealthInvoiceRow {
  id: string;
  invoice_number: string;
  status: SettlementInvoiceStatus;
  currency: Currency;
  period_start: string | null;
  period_end: string | null;
  issue_date: string | null;
  due_date: string | null;
  order_count: number;
  amount_due_cents: number;
  paid_cents: number;
  balance_cents: number;
  created_at: string;
}

export interface StealthHealthPayoutRow {
  id: string;
  invoice_id: string | null;
  invoice_number: string | null;
  amount_cents: number;
  currency: Currency;
  received_at: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
  created_at: string;
}

export interface StealthHealthSummary {
  range: { from: string | null; to: string | null };
  /** False when stealth-health-settlement-migration.sql hasn't been run here. */
  migrated: boolean;
  terms_summary: string;
  currency: Currency;
  /** Everything paid through Stealth Health in range, settled under the terms. */
  earned: SettlementTotals;
  /** The slice of `earned` not yet on a settlement invoice. */
  unbilled: SettlementTotals;
  /** The slice of `earned` already billed. */
  billed: SettlementTotals;
  /** Hand-offs held back from settlement (disputed / test orders). */
  excluded_orders: number;
  /**
   * Balance — computed ALL-TIME, never over the selected range: what a partner
   * owes is not a function of which dates you happen to be looking at.
   */
  balance: {
    earned_cents: number;      // everything settleable, all time
    invoiced_cents: number;    // raised on non-void settlement invoices
    paid_cents: number;        // remitted to us
    outstanding_cents: number; // earned − paid, floored at 0
    /** Earned but not yet on any invoice — what a new invoice would bill. */
    uninvoiced_cents: number;
    /** Invoiced and still unpaid. */
    overdue_cents: number;
    open_invoices: number;
  };
  daily: StealthHealthDailyPoint[];
  daily_truncated: boolean;
  recent_invoices: StealthHealthInvoiceRow[];
  recent_payouts: StealthHealthPayoutRow[];
}

/**
 * GET /api/admin/stealth-health/summary — the settlement dashboard's figures.
 *
 * `from`/`to` (YYYY-MM-DD, inclusive) scope the earnings analytics only. The
 * balance block is deliberately all-time: "how much do they owe us" has one
 * answer, not one per date filter.
 */
export async function GET(req: NextRequest) {
  if (!(await requireReader(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const from = sp.get('from');
  const to = sp.get('to');

  const { terms, migrated } = await loadTerms();

  // One read of the ledger; the range slice is taken from it in memory so the
  // range and all-time figures can never disagree about a boundary day.
  const { rows, settlementColumns } = await loadLedgerRows();
  const dayOf = (r: { paid_at?: string | null; created_at?: string | null }) =>
    String(r.paid_at ?? r.created_at ?? '').slice(0, 10);
  const inRange = rows.filter((r) => {
    const d = dayOf(r);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });

  const allSettlements = settleableSettlements(rows, terms);
  const rangeSettlements = settleableSettlements(inRange, terms);

  const earned = sumSettlements(rangeSettlements);
  const billed = emptyTotals();
  const unbilled = emptyTotals();
  for (const s of rangeSettlements) {
    addToTotals(s.billed ? billed : unbilled, s);
  }

  // Daily series over the range.
  const dailyMap = new Map<string, StealthHealthDailyPoint>();
  for (const s of rangeSettlements) {
    if (!s.day) continue;
    let p = dailyMap.get(s.day);
    if (!p) { p = { date: s.day, orders: 0, earned_cents: 0, gross_cents: 0 }; dailyMap.set(s.day, p); }
    p.orders += 1;
    p.earned_cents += s.due_cents;
    p.gross_cents += s.gross_cents;
  }
  const dailyAll = [...dailyMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const daily = dailyAll.slice(-MAX_DAILY_POINTS);

  // ---- Balance: all-time, and independent of the range filter ----
  const earnedAllCents = allSettlements.reduce((s, r) => s + r.due_cents, 0);
  const uninvoicedAllCents = allSettlements
    .filter((r) => !r.billed)
    .reduce((s, r) => s + r.due_cents, 0);

  const { data: invoiceData, error: invoiceErr } = await db
    .from('stealth_health_invoices')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);
  if (invoiceErr && !isMissingSchema(invoiceErr)) {
    console.error('[stealth-health] invoice read failed:', invoiceErr);
  }
  const invoiceRows = (invoiceData ?? []) as any[];

  const { data: payoutData, error: payoutErr } = await db
    .from('stealth_health_payouts')
    .select('*')
    .order('received_at', { ascending: false })
    .limit(500);
  if (payoutErr && !isMissingSchema(payoutErr)) {
    console.error('[stealth-health] payout read failed:', payoutErr);
  }
  const payoutRows = (payoutData ?? []) as any[];

  const paidByInvoice: Record<string, number> = {};
  let paidAllCents = 0;
  for (const p of payoutRows) {
    const amount = Math.round(Number(p.amount_cents ?? 0));
    paidAllCents += amount;
    const id = p.invoice_id ? String(p.invoice_id) : null;
    if (id) paidByInvoice[id] = (paidByInvoice[id] ?? 0) + amount;
  }

  const invoices: StealthHealthInvoiceRow[] = invoiceRows.map((inv) => {
    const amountDue = Math.round(Number(inv.amount_due_cents ?? 0));
    const paid = paidByInvoice[String(inv.id)] ?? 0;
    return {
      id: String(inv.id),
      invoice_number: String(inv.invoice_number ?? ''),
      status: deriveInvoiceStatus(inv.status, amountDue, paid),
      currency: inv.currency === 'CAD' ? 'CAD' : 'USD',
      period_start: inv.period_start ?? null,
      period_end: inv.period_end ?? null,
      issue_date: inv.issue_date ?? null,
      due_date: inv.due_date ?? null,
      order_count: Number(inv.order_count ?? 0),
      amount_due_cents: amountDue,
      paid_cents: paid,
      balance_cents: Math.max(0, amountDue - paid),
      created_at: inv.created_at ?? '',
    };
  });

  const live = invoices.filter((i) => i.status !== 'void');
  const invoicedCents = live.reduce((s, i) => s + i.amount_due_cents, 0);
  const openInvoices = live.filter((i) => i.status !== 'draft' && i.balance_cents > 0);
  const overdueCents = openInvoices.reduce((s, i) => s + i.balance_cents, 0);

  const invoiceNumberById = new Map(invoices.map((i) => [i.id, i.invoice_number]));
  const payouts: StealthHealthPayoutRow[] = payoutRows.slice(0, 20).map((p) => ({
    id: String(p.id),
    invoice_id: p.invoice_id ? String(p.invoice_id) : null,
    invoice_number: p.invoice_id ? invoiceNumberById.get(String(p.invoice_id)) ?? null : null,
    amount_cents: Math.round(Number(p.amount_cents ?? 0)),
    currency: p.currency === 'CAD' ? 'CAD' : 'USD',
    received_at: p.received_at ?? '',
    method: p.method ?? null,
    reference: p.reference ?? null,
    notes: p.notes ?? null,
    created_at: p.created_at ?? '',
  }));

  const summary: StealthHealthSummary = {
    range: { from: from ?? null, to: to ?? null },
    // The dashboard is only trustworthy once the settlement schema is live:
    // without it nothing can be billed or held back.
    migrated: migrated && settlementColumns,
    terms_summary: describeTerms(terms),
    currency: terms.currency,
    earned,
    unbilled,
    billed,
    excluded_orders: inRange.filter((r) => r.settlement_excluded).length,
    balance: {
      earned_cents: earnedAllCents,
      invoiced_cents: invoicedCents,
      paid_cents: paidAllCents,
      outstanding_cents: Math.max(0, earnedAllCents - paidAllCents),
      uninvoiced_cents: uninvoicedAllCents,
      overdue_cents: overdueCents,
      open_invoices: openInvoices.length,
    },
    daily,
    daily_truncated: dailyAll.length > daily.length,
    recent_invoices: invoices.slice(0, 8),
    recent_payouts: payouts,
  };

  return NextResponse.json({ summary });
}
