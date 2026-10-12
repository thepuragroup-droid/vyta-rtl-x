/**
 * Stealth Health payouts — the rules.
 *
 * Customers pay Stealth Health; Stealth Health keeps a processing fee and pays
 * the rest out to us in batches when we ask. This module decides, for every
 * customer-paid hand-off, what the fee is, what we are owed, and where the
 * order is in the request → paid-out cycle.
 *
 * Pure: no Supabase, no React. The API, the page and the PDF all call it, so
 * the figures on screen, in the request and on the PDF are always the same.
 *
 * Everything is CAD. USD orders are converted at the Settings CAD→USD rate
 * (`site_settings.usd_exchange_rate`, USD per 1 CAD), so CAD = USD ÷ rate.
 * Money is integer cents; the fee is rounded once per order and the net is
 * gross − fee, so fee + net always add back up to the gross.
 */

export type FeeType = 'catalog' | 'custom';
export type PayoutState = 'not_requested' | 'requested' | 'paid_out';
export type PayoutRequestStatus = 'requested' | 'received' | 'void';
export type StateFilter = 'owed' | 'paid_out' | 'all';
export type RequestFilter = 'open' | 'received' | 'all';

/** Where a customer or an amount came from, best first. */
export type FigureSource = 'webhook' | 'portal' | 'ledger' | 'invoice' | 'none';

export interface FeeRates {
  /** Fraction, e.g. 0.032. The price sent through checkout matched the catalog. */
  catalog: number;
  /** Fraction, e.g. 0.06. The order was sold at a custom price. */
  custom: number;
}

export const DEFAULT_FEE_RATES: FeeRates = { catalog: 0.032, custom: 0.06 };

/** Read a stored rate; anything outside 0–100% falls back. */
export function normalizeFeeRate(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n < 1 ? n : fallback;
}

export function normalizeFeeRates(row: { sh_fee_rate_catalog?: unknown; sh_fee_rate_custom?: unknown } | null | undefined): FeeRates {
  return {
    catalog: normalizeFeeRate(row?.sh_fee_rate_catalog, DEFAULT_FEE_RATES.catalog),
    custom: normalizeFeeRate(row?.sh_fee_rate_custom, DEFAULT_FEE_RATES.custom),
  };
}

export function normalizeFeeType(value: unknown): FeeType {
  return value === 'custom' ? 'custom' : 'catalog';
}

/** 0.032 → "3.2%". */
export function formatRate(rate: number): string {
  const pct = Math.round(rate * 100 * 100) / 100;
  return `${pct}%`;
}

/** fee = round(gross × rate) to the cent; net = gross − fee. */
export function splitFee(grossCents: number, rate: number): { fee_cents: number; net_cents: number } {
  const fee = Math.round(grossCents * rate);
  return { fee_cents: fee, net_cents: grossCents - fee };
}

/**
 * An order's total in CAD cents. CAD passes through; USD is divided by the
 * Settings rate. Null when the amount is unknown or the rate is unusable.
 */
export function toCadCents(
  totalCents: number | null | undefined,
  currency: string | null | undefined,
  usdRate: number,
): number | null {
  if (totalCents == null || !Number.isFinite(Number(totalCents))) return null;
  const total = Math.round(Number(totalCents));
  if (String(currency ?? 'usd').toLowerCase() === 'cad') return total;
  if (!Number.isFinite(usdRate) || usdRate <= 0) return null;
  return Math.round(total / usdRate);
}

export function orderCurrency(value: unknown): 'CAD' | 'USD' {
  return String(value ?? 'usd').toLowerCase() === 'cad' ? 'CAD' : 'USD';
}

/** Dollars (as Postgres numeric comes back) → cents. */
export function dollarsToCents(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function centsToDollars(cents: number | null): number | null {
  return cents == null ? null : Math.round(cents) / 100;
}

// ---- Days ------------------------------------------------------------------

/** A timestamp → its calendar day ('YYYY-MM-DD') in the given zone. */
export function dayIn(value: string | null | undefined, timeZone: string): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

// ---- Orders ----------------------------------------------------------------

/** What the server knows about one customer-paid order. */
export interface PayoutOrderInput {
  id: string;
  partner_reference: string | null;
  transaction_id: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  paid_at: string | null;
  created_at: string | null;
  /** Total charged incl. shipping, cents of `currency`. Null = unknown. */
  total_cents: number | null;
  currency: string | null;
  money_source: FigureSource;
  customer_name: string | null;
  customer_email: string | null;
  customer_source: FigureSource;
  /** Refunded on the Stealth Health side, cents of `currency` (informational). */
  refunded_cents: number;
  sh_fee_type: string | null;
  sh_fee_rate: unknown;
  payout_request_id: string | null;
  paid_out_at: string | null;
  paid_out_gross: unknown;
  paid_out_fee: unknown;
  paid_out_net: unknown;
}

/** One order as the Payouts tab and the PDF show it. All money is CAD cents. */
export interface PayoutOrder {
  id: string;
  partner_reference: string | null;
  transaction_id: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  paid_at: string | null;
  /** Day the customer paid, in the business time zone. */
  day: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_source: FigureSource;
  money_source: FigureSource;
  original_currency: 'CAD' | 'USD';
  /** The total as charged, in its own currency. Null = unknown. */
  original_total_cents: number | null;
  refunded_cents: number;
  fee_type: FeeType;
  rate: number;
  gross_cents: number | null;
  fee_cents: number | null;
  net_cents: number | null;
  state: PayoutState;
  /** Paid out: the rate and figures are locked on the order. */
  locked: boolean;
  payout_request_id: string | null;
  payout_number: string | null;
  paid_out_at: string | null;
}

export interface RequestRef {
  id: string;
  payout_number: string;
  status: PayoutRequestStatus;
}

/**
 * Derived, never stored: paid_out_at set → paid out; else on a non-void
 * request → requested; else not requested.
 */
export function payoutState(
  order: { paid_out_at?: string | null; payout_request_id?: string | null },
  requests: Map<string, RequestRef>,
): PayoutState {
  if (order.paid_out_at) return 'paid_out';
  const req = order.payout_request_id ? requests.get(order.payout_request_id) : undefined;
  if (req && req.status !== 'void') return 'requested';
  return 'not_requested';
}

export function buildPayoutOrder(
  input: PayoutOrderInput,
  rates: FeeRates,
  usdRate: number,
  requests: Map<string, RequestRef>,
  timeZone: string,
): PayoutOrder {
  const feeType = normalizeFeeType(input.sh_fee_type);
  const state = payoutState(input, requests);
  const locked = state === 'paid_out';
  const req = input.payout_request_id ? requests.get(input.payout_request_id) : undefined;

  let rate = feeType === 'custom' ? rates.custom : rates.catalog;
  let gross: number | null;
  let fee: number | null;
  let net: number | null;

  if (locked) {
    rate = normalizeFeeRate(input.sh_fee_rate, rate);
    gross = dollarsToCents(input.paid_out_gross);
    fee = dollarsToCents(input.paid_out_fee);
    net = dollarsToCents(input.paid_out_net);
  } else {
    gross = toCadCents(input.total_cents, input.currency, usdRate);
    if (gross == null) {
      fee = null;
      net = null;
    } else {
      ({ fee_cents: fee, net_cents: net } = splitFee(gross, rate));
    }
  }

  return {
    id: input.id,
    partner_reference: input.partner_reference,
    transaction_id: input.transaction_id,
    invoice_id: input.invoice_id,
    invoice_number: input.invoice_number,
    paid_at: input.paid_at ?? input.created_at,
    day: dayIn(input.paid_at ?? input.created_at, timeZone),
    customer_name: input.customer_name,
    customer_email: input.customer_email,
    customer_source: input.customer_source,
    money_source: input.money_source,
    original_currency: orderCurrency(input.currency),
    original_total_cents: input.total_cents,
    refunded_cents: Math.max(0, Math.round(input.refunded_cents || 0)),
    fee_type: feeType,
    rate,
    gross_cents: gross,
    fee_cents: fee,
    net_cents: net,
    state,
    locked,
    payout_request_id: req && req.status !== 'void' ? req.id : null,
    payout_number: req && req.status !== 'void' ? req.payout_number : null,
    paid_out_at: input.paid_out_at,
  };
}

/** Newest first, by the day the customer paid. */
export function sortOrders(orders: PayoutOrder[]): PayoutOrder[] {
  return [...orders].sort((a, b) => String(b.paid_at ?? '').localeCompare(String(a.paid_at ?? '')));
}

/** The figures sent to the sh_* functions: CAD dollars, as numeric(12,2). */
export interface RpcRow {
  id: string;
  rate: number;
  gross: number | null;
  fee: number | null;
  net: number | null;
}

export function rpcRow(o: PayoutOrder): RpcRow {
  return {
    id: o.id,
    rate: o.rate,
    gross: centsToDollars(o.gross_cents),
    fee: centsToDollars(o.fee_cents),
    net: centsToDollars(o.net_cents),
  };
}

/** Can this order go on a new request? Returns the reason when not. */
export function requestBlocker(o: PayoutOrder): string | null {
  if (o.state === 'paid_out') return 'already paid out';
  if (o.state === 'requested') return `already on ${o.payout_number}`;
  if (o.gross_cents == null) return 'amount unknown';
  return null;
}

// ---- Totals ----------------------------------------------------------------

export interface PayoutTotals {
  count: number;
  gross_cents: number;
  fee_cents: number;
  net_cents: number;
  catalog_count: number;
  custom_count: number;
  /** Orders whose amount is unknown (not in the sums). */
  unknown_count: number;
  usd_count: number;
}

export function sumOrders(orders: PayoutOrder[]): PayoutTotals {
  const t: PayoutTotals = {
    count: 0, gross_cents: 0, fee_cents: 0, net_cents: 0,
    catalog_count: 0, custom_count: 0, unknown_count: 0, usd_count: 0,
  };
  for (const o of orders) {
    t.count += 1;
    if (o.fee_type === 'custom') t.custom_count += 1; else t.catalog_count += 1;
    if (o.original_currency === 'USD') t.usd_count += 1;
    if (o.gross_cents == null) { t.unknown_count += 1; continue; }
    t.gross_cents += o.gross_cents;
    t.fee_cents += o.fee_cents ?? 0;
    t.net_cents += o.net_cents ?? 0;
  }
  return t;
}

export interface SummaryCards {
  owed: PayoutTotals;
  requested: PayoutTotals & { open_requests: number };
  paid_out: PayoutTotals;
  all: PayoutTotals;
}

/** The four tiles, over whatever orders are in the date range. */
export function summaryCards(orders: PayoutOrder[]): SummaryCards {
  const requested = orders.filter((o) => o.state === 'requested');
  return {
    owed: sumOrders(orders.filter((o) => o.state !== 'paid_out')),
    requested: {
      ...sumOrders(requested),
      open_requests: new Set(requested.map((o) => o.payout_request_id)).size,
    },
    paid_out: sumOrders(orders.filter((o) => o.state === 'paid_out')),
    all: sumOrders(orders),
  };
}

// ---- Filters ---------------------------------------------------------------

export function filterByState(orders: PayoutOrder[], show: StateFilter): PayoutOrder[] {
  if (show === 'owed') return orders.filter((o) => o.state !== 'paid_out');
  if (show === 'paid_out') return orders.filter((o) => o.state === 'paid_out');
  return orders;
}

export function normalizeStateFilter(v: unknown): StateFilter {
  return v === 'paid_out' || v === 'all' ? v : 'owed';
}

export interface DateRange { from: string | null; to: string | null }

export function inRange(day: string | null, range: DateRange): boolean {
  if (!range.from && !range.to) return true;
  if (!day) return false;
  if (range.from && day < range.from) return false;
  if (range.to && day > range.to) return false;
  return true;
}

export function matchesSearch(o: PayoutOrder, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [o.customer_name, o.customer_email, o.invoice_number, o.transaction_id, o.partner_reference, o.payout_number]
    .some((v) => v != null && String(v).toLowerCase().includes(needle));
}

// ---- Date presets ------------------------------------------------------------

export type DatePreset =
  | 'any' | 'today' | 'yesterday' | 'this_week' | 'last_week' | 'last_7'
  | 'this_month' | 'last_month' | 'last_30' | 'this_quarter' | 'last_quarter'
  | 'this_year' | 'last_year' | 'custom';

export const DATE_PRESET_OPTIONS: Array<{ value: DatePreset; label: string }> = [
  { value: 'any', label: 'Any date' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This week' },
  { value: 'last_week', label: 'Last week' },
  { value: 'last_7', label: 'Last 7 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_30', label: 'Last 30 days' },
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'last_quarter', label: 'Last quarter' },
  { value: 'this_year', label: 'This year' },
  { value: 'last_year', label: 'Last year' },
  { value: 'custom', label: 'Custom range…' },
];

export function normalizeDatePreset(v: unknown): DatePreset {
  return DATE_PRESET_OPTIONS.some((o) => o.value === v) ? (v as DatePreset) : 'any';
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

/**
 * Resolve a preset against `today` ('YYYY-MM-DD', the business day). Weeks
 * start on Monday. `custom` returns the given bounds.
 */
export function resolveDatePreset(preset: DatePreset, today: string, custom: DateRange = { from: null, to: null }): DateRange {
  const [y, m, d] = today.split('-').map(Number);
  const t = utc(y, m - 1, d);
  const shift = (days: number) => iso(utc(y, m - 1, d + days));
  const weekday = (t.getUTCDay() + 6) % 7; // Monday = 0
  const q = Math.floor((m - 1) / 3);
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'yesterday': return { from: shift(-1), to: shift(-1) };
    case 'this_week': return { from: shift(-weekday), to: shift(6 - weekday) };
    case 'last_week': return { from: shift(-weekday - 7), to: shift(-weekday - 1) };
    case 'last_7': return { from: shift(-6), to: today };
    case 'this_month': return { from: iso(utc(y, m - 1, 1)), to: iso(utc(y, m, 0)) };
    case 'last_month': return { from: iso(utc(y, m - 2, 1)), to: iso(utc(y, m - 1, 0)) };
    case 'last_30': return { from: shift(-29), to: today };
    case 'this_quarter': return { from: iso(utc(y, q * 3, 1)), to: iso(utc(y, q * 3 + 3, 0)) };
    case 'last_quarter': return { from: iso(utc(y, q * 3 - 3, 1)), to: iso(utc(y, q * 3, 0)) };
    case 'this_year': return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'last_year': return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case 'custom': return { from: custom.from || null, to: custom.to || null };
    default: return { from: null, to: null };
  }
}

/** First and last day among the orders, for a request's default period. */
export function orderPeriod(orders: PayoutOrder[]): DateRange {
  const days = orders.map((o) => o.day).filter((d): d is string => !!d).sort();
  return { from: days[0] ?? null, to: days[days.length - 1] ?? null };
}

// ---- Requests ------------------------------------------------------------------

export interface PayoutRequestRow {
  id: string;
  payout_number: string;
  status: string;
  period_start: string | null;
  period_end: string | null;
  usd_rate: unknown;
  order_count: number | null;
  requested_gross: unknown;
  requested_fees: unknown;
  requested_net: unknown;
  received_amount: unknown;
  received_reference: string | null;
  received_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface PayoutRequestView {
  id: string;
  payout_number: string;
  status: PayoutRequestStatus;
  period_start: string | null;
  period_end: string | null;
  usd_rate: number | null;
  created_at: string;
  requested_day: string | null;
  notes: string | null;
  received_amount_cents: number | null;
  received_reference: string | null;
  received_at: string | null;
  /** Snapshot taken when the request was made. */
  snapshot: { count: number; gross_cents: number; fee_cents: number; net_cents: number };
  /** The orders on it as they stand now. */
  live: PayoutTotals;
  order_ids: string[];
  paid_count: number;
  /** A fee on it changed after it was made, so the PDF differs from the snapshot. */
  changed: boolean;
}

export function normalizeRequestStatus(v: unknown): PayoutRequestStatus {
  return v === 'received' || v === 'void' ? v : 'requested';
}

export function requestRef(row: Pick<PayoutRequestRow, 'id' | 'payout_number' | 'status'>): RequestRef {
  return { id: row.id, payout_number: row.payout_number, status: normalizeRequestStatus(row.status) };
}

export function buildRequestView(row: PayoutRequestRow, orders: PayoutOrder[], timeZone: string): PayoutRequestView {
  const status = normalizeRequestStatus(row.status);
  const mine = status === 'void' ? [] : orders.filter((o) => o.payout_request_id === row.id);
  const live = sumOrders(mine);
  const snapshot = {
    count: Number(row.order_count ?? 0),
    gross_cents: dollarsToCents(row.requested_gross) ?? 0,
    fee_cents: dollarsToCents(row.requested_fees) ?? 0,
    net_cents: dollarsToCents(row.requested_net) ?? 0,
  };
  const rate = Number(row.usd_rate);
  return {
    id: row.id,
    payout_number: row.payout_number,
    status,
    period_start: row.period_start,
    period_end: row.period_end,
    usd_rate: Number.isFinite(rate) && rate > 0 ? rate : null,
    created_at: row.created_at,
    requested_day: dayIn(row.created_at, timeZone),
    notes: row.notes,
    received_amount_cents: dollarsToCents(row.received_amount),
    received_reference: row.received_reference,
    received_at: row.received_at,
    snapshot,
    live,
    order_ids: mine.map((o) => o.id),
    paid_count: mine.filter((o) => o.state === 'paid_out').length,
    changed:
      status !== 'void' &&
      (live.count !== snapshot.count ||
        live.fee_cents !== snapshot.fee_cents ||
        live.net_cents !== snapshot.net_cents),
  };
}

export function filterRequests(requests: PayoutRequestView[], show: RequestFilter, range: DateRange): PayoutRequestView[] {
  return requests.filter((r) => {
    if (show === 'open' && r.status !== 'requested') return false;
    if (show === 'received' && r.status !== 'received') return false;
    return inRange(r.requested_day, range);
  });
}

/** "Requested", "Requested · 2 of 5 paid", "Received", "Void". */
export function requestStatusLabel(r: PayoutRequestView): string {
  if (r.status === 'void') return 'Void';
  if (r.status === 'received') return 'Received';
  return r.paid_count > 0 ? `Requested · ${r.paid_count} of ${r.live.count} paid` : 'Requested';
}

/** Void is only possible while nothing on the request is paid out. */
export function canVoid(r: PayoutRequestView): boolean {
  return r.status === 'requested' && r.paid_count === 0;
}
