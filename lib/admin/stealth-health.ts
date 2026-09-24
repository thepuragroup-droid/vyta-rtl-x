/**
 * Stealth Health settlement — the money side of the partnership.
 *
 * Stealth Health runs the hosted checkout, so the buyer pays THEM while we ship
 * the goods. Every paid row in `puramass_orders` is therefore cash they are
 * holding on our behalf, less whatever the commercial terms let them keep.
 *
 * This module is the single place that arithmetic lives. It is deliberately
 * pure — no Supabase, no React — so the dashboard, the settlement invoice and
 * the unit tests all compute the balance the same way and can never drift.
 *
 * Money is handled in integer cents end to end. Percentages are applied once,
 * at the per-order level, and rounded there; totals are sums of already-rounded
 * per-order figures, so what the dashboard shows always equals the sum of the
 * lines behind it.
 */
import type { Currency } from '@/lib/currency';

/** `puramass_orders.status` for a hand-off the buyer actually paid. */
export const PAID_STATUS = 'paid';

/** Settlement invoice lifecycle. */
export type SettlementInvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'void';

export const SETTLEMENT_INVOICE_STATUSES: SettlementInvoiceStatus[] = [
  'draft', 'sent', 'partial', 'paid', 'void',
];

export const SETTLEMENT_STATUS_META: Record<
  SettlementInvoiceStatus,
  { label: string; classes: string }
> = {
  draft:   { label: 'Draft',   classes: 'bg-gray-500/10 text-gray-700' },
  sent:    { label: 'Sent',    classes: 'bg-blue-500/10 text-blue-700' },
  partial: { label: 'Partial', classes: 'bg-amber-500/10 text-amber-700' },
  paid:    { label: 'Paid',    classes: 'bg-emerald-500/10 text-emerald-700' },
  void:    { label: 'Void',    classes: 'bg-rose-500/10 text-rose-700' },
};

/**
 * The commercial terms with Stealth Health — what they keep out of what they
 * collect. Defaults mean "they remit everything they collected", which is the
 * right starting point: it is the figure that needs no agreement to be true.
 */
export interface SettlementTerms {
  partner_name: string;
  partner_email: string | null;
  partner_address: string | null;
  /** Percent of net goods revenue Stealth Health retains (0–100). */
  commission_pct: number;
  /** Flat fee they retain per paid order, in cents. */
  flat_fee_cents: number;
  /** The flat shipment fee booked on every Stealth Health sale, in cents. */
  shipping_fee_cents: number;
  /** True when that shipment fee is remitted to us rather than kept by them. */
  shipping_remitted: boolean;
  /** Days from issue to due date on a new settlement invoice. */
  payment_terms_days: number;
  currency: Currency;
  notes: string | null;
}

export const DEFAULT_TERMS: SettlementTerms = {
  partner_name: 'Stealth Health',
  partner_email: null,
  partner_address: null,
  commission_pct: 0,
  flat_fee_cents: 0,
  shipping_fee_cents: 3500,
  shipping_remitted: true,
  payment_terms_days: 14,
  currency: 'USD',
  notes: null,
};

/** The fields of a hand-off ledger row settlement cares about. */
export interface SettlementOrderInput {
  id: string;
  status?: string | null;
  currency?: string | null;
  subtotal_cents?: number | null;
  refunded_total_cents?: number | null;
  paid_at?: string | null;
  created_at?: string | null;
  items?: Array<{ sku?: string | null; quantity?: number | null }> | null;
  settlement_invoice_id?: string | null;
  settlement_excluded?: boolean | null;
}

/** What one paid hand-off contributes to the balance, all in cents. */
export interface OrderSettlement {
  id: string;
  currency: Currency;
  /** Goods Stealth Health charged for. */
  gross_cents: number;
  /** Refunded on the Stealth Health side. */
  refunds_cents: number;
  /** gross − refunds, floored at 0. */
  net_cents: number;
  /** Shipment fee coming back to us (0 when they keep it, or when refunded out). */
  shipping_cents: number;
  /** Commission + flat fee they retain. */
  fee_cents: number;
  /** What they owe us for this order: net + shipping − fee, floored at 0. */
  due_cents: number;
  units: number;
  /** Day the money landed (UTC, YYYY-MM-DD) — paid_at, else created_at. */
  day: string | null;
  billed: boolean;
  excluded: boolean;
}

/** Stealth Health reports currency lower-cased ('usd'); the hosted checkout is USD. */
export function settlementCurrency(value: unknown): Currency {
  return String(value ?? 'usd').toUpperCase() === 'CAD' ? 'CAD' : 'USD';
}

const int = (v: unknown): number => {
  const n = Math.round(Number(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

/** True when this hand-off is money Stealth Health is holding for us. */
export function isSettleable(order: SettlementOrderInput): boolean {
  return String(order.status ?? '') === PAID_STATUS && !order.settlement_excluded;
}

/**
 * What one paid hand-off is worth to us under the given terms.
 *
 * The order of operations matters and is deliberate:
 *   net      = gross − refunds                     (never below 0)
 *   fee      = round(net × commission%) + flat fee  (never more than net)
 *   shipping = the flat fee, only when they remit it AND the sale wasn't
 *              fully refunded — we don't bill a shipment fee on a sale that
 *              was handed back to the buyer.
 *   due      = net + shipping − fee                 (never below 0)
 *
 * The flat fee is capped at what's left so a tiny order can't produce a
 * negative balance that quietly nets off a real one elsewhere.
 */
export function computeOrderSettlement(
  order: SettlementOrderInput,
  terms: SettlementTerms,
): OrderSettlement {
  const gross = Math.max(0, int(order.subtotal_cents));
  const refunds = Math.max(0, int(order.refunded_total_cents));
  const net = Math.max(0, gross - refunds);

  const fullyRefunded = gross > 0 && refunds >= gross;
  const shipping =
    terms.shipping_remitted && !fullyRefunded
      ? Math.max(0, int(terms.shipping_fee_cents))
      : 0;

  const pct = Math.min(100, Math.max(0, Number(terms.commission_pct) || 0));
  const commission = Math.round((net * pct) / 100);
  const flat = Math.max(0, int(terms.flat_fee_cents));
  // Cap the retained fee at what's actually collectable on this order.
  const fee = Math.min(net + shipping, commission + flat);

  const units = (order.items ?? []).reduce(
    (s, i) => s + Math.max(0, int(i?.quantity)),
    0,
  );

  const stamp = order.paid_at ?? order.created_at ?? null;

  return {
    id: order.id,
    currency: settlementCurrency(order.currency),
    gross_cents: gross,
    refunds_cents: refunds,
    net_cents: net,
    shipping_cents: shipping,
    fee_cents: fee,
    due_cents: Math.max(0, net + shipping - fee),
    units,
    day: stamp ? String(stamp).slice(0, 10) : null,
    billed: Boolean(order.settlement_invoice_id),
    excluded: Boolean(order.settlement_excluded),
  };
}

/** A rolled-up settlement total. Every field is cents except `order_count`. */
export interface SettlementTotals {
  order_count: number;
  units: number;
  gross_cents: number;
  refunds_cents: number;
  net_cents: number;
  shipping_cents: number;
  fee_cents: number;
  due_cents: number;
}

export function emptyTotals(): SettlementTotals {
  return {
    order_count: 0, units: 0, gross_cents: 0, refunds_cents: 0,
    net_cents: 0, shipping_cents: 0, fee_cents: 0, due_cents: 0,
  };
}

export function addToTotals(totals: SettlementTotals, s: OrderSettlement): SettlementTotals {
  totals.order_count += 1;
  totals.units += s.units;
  totals.gross_cents += s.gross_cents;
  totals.refunds_cents += s.refunds_cents;
  totals.net_cents += s.net_cents;
  totals.shipping_cents += s.shipping_cents;
  totals.fee_cents += s.fee_cents;
  totals.due_cents += s.due_cents;
  return totals;
}

/** Sum a set of already-computed per-order settlements. */
export function sumSettlements(rows: OrderSettlement[]): SettlementTotals {
  return rows.reduce((acc, r) => addToTotals(acc, r), emptyTotals());
}

/**
 * Derive an invoice's status from what has been paid against it.
 *
 * `draft` and `void` are states an admin sets and payments never override — a
 * draft is not yet a claim, and a void invoice stays void. Everything else is
 * decided by the money: nothing paid → sent, part paid → partial, covered →
 * paid. Overpayment counts as paid rather than erroring; the variance shows on
 * the invoice.
 */
export function deriveInvoiceStatus(
  stored: string | null | undefined,
  amountDueCents: number,
  paidCents: number,
): SettlementInvoiceStatus {
  const s = String(stored ?? 'draft');
  if (s === 'draft' || s === 'void') return s as SettlementInvoiceStatus;
  if (amountDueCents > 0 && paidCents >= amountDueCents) return 'paid';
  if (paidCents > 0) return 'partial';
  return 'sent';
}

/** Cents → a decimal amount for display/formatMoney. */
export function toAmount(cents: number): number {
  return +((Number(cents) || 0) / 100).toFixed(2);
}

/** A decimal amount (as typed into a form) → integer cents. */
export function toCents(amount: unknown): number {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Terms row from the DB (or nothing) → a fully-defaulted SettlementTerms. */
export function normalizeTerms(row: Record<string, any> | null | undefined): SettlementTerms {
  const d = row ?? {};
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    partner_name: String(d.partner_name ?? DEFAULT_TERMS.partner_name).trim() || DEFAULT_TERMS.partner_name,
    partner_email: d.partner_email ? String(d.partner_email) : null,
    partner_address: d.partner_address ? String(d.partner_address) : null,
    commission_pct: Math.min(100, num(d.commission_pct, DEFAULT_TERMS.commission_pct)),
    flat_fee_cents: Math.round(num(d.flat_fee_cents, DEFAULT_TERMS.flat_fee_cents)),
    shipping_fee_cents: Math.round(num(d.shipping_fee_cents, DEFAULT_TERMS.shipping_fee_cents)),
    shipping_remitted: d.shipping_remitted ?? DEFAULT_TERMS.shipping_remitted,
    payment_terms_days: Math.round(num(d.payment_terms_days, DEFAULT_TERMS.payment_terms_days)),
    currency: d.currency === 'CAD' ? 'CAD' : 'USD',
    notes: d.notes ? String(d.notes) : null,
  };
}

/**
 * Plain-English one-liner for the terms, shown on the dashboard and printed on
 * the settlement invoice so the arithmetic is never a mystery.
 */
export function describeTerms(terms: SettlementTerms): string {
  const parts: string[] = [];
  if (terms.commission_pct > 0) parts.push(`${terms.commission_pct}% commission`);
  if (terms.flat_fee_cents > 0) {
    parts.push(`${toAmount(terms.flat_fee_cents).toFixed(2)} ${terms.currency} per order`);
  }
  const kept = parts.length > 0
    ? `${terms.partner_name} retains ${parts.join(' + ')}`
    : `${terms.partner_name} retains nothing`;
  const shipping = terms.shipping_remitted
    ? `the ${toAmount(terms.shipping_fee_cents).toFixed(2)} ${terms.currency} shipment fee is remitted to us`
    : `the ${toAmount(terms.shipping_fee_cents).toFixed(2)} ${terms.currency} shipment fee stays with them`;
  return `${kept}; ${shipping}.`;
}

/** Due date for a new invoice, given the issue date and the terms. */
export function dueDateFor(issueDate: string, terms: SettlementTerms): string {
  const d = new Date(`${issueDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + Math.max(0, terms.payment_terms_days));
  return d.toISOString().slice(0, 10);
}
