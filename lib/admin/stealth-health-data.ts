/**
 * Server reads for the Stealth Health Payouts tab: the ledger, the signed
 * webhooks, the polled orders and the requests, turned into the figures every
 * payout route works from (`loadPayoutData`).
 *
 * Every route — the list, the request, mark paid, the PDF — loads the same
 * data the page sees and works out the figures from it, so the client only
 * ever sends ids.
 *
 * Auth (Bearer token → getUser → customers.role) and the service-role client
 * are shared with the settlement dashboard in stealth-health-server.ts.
 */
import { NextResponse } from 'next/server';
import { BRAND } from '@/lib/brand';
import { db, isMissingSchema } from '@/lib/admin/stealth-health-server';
import {
  isPlaceholderEmail,
  portalCustomer,
  portalMoney,
} from '@/lib/payments/stealth-health-portal';
import {
  buildPayoutOrder,
  buildRequestView,
  normalizeFeeRates,
  requestRef,
  sortOrders,
  type FeeRates,
  type FigureSource,
  type PayoutOrder,
  type PayoutOrderInput,
  type PayoutRequestRow,
  type PayoutRequestView,
  type RequestRef,
} from '@/lib/admin/stealth-health-payouts';

export { db, requireReader, requireAdmin } from '@/lib/admin/stealth-health-server';

export const SETUP_HINT =
  'Run stealth-health-payouts-migration.sql in the Supabase SQL editor to enable Stealth Health payouts.';

export interface PayoutData {
  orders: PayoutOrder[];
  requests: PayoutRequestView[];
  rates: FeeRates;
  /** Settings CAD→USD rate (USD per 1 CAD). */
  usd_rate: number;
  time_zone: string;
  /** False until stealth-health-portal-snapshot-migration.sql has run. */
  portal_snapshots: boolean;
}

/** Thrown when the payouts migration hasn't run; routes answer 409. */
export class SetupRequiredError extends Error {
  constructor() {
    super(SETUP_HINT);
    this.name = 'SetupRequiredError';
  }
}

const PAGE = 1000;
const CHUNK = 150;

function chunks<T>(xs: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** PostgREST caps a read at 1000 rows; page through everything. */
async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: any }>,
): Promise<{ rows: T[]; error: any }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) return { rows, error };
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) return { rows, error: null };
  }
}

// ---- Settings ------------------------------------------------------------------

async function loadSettings(): Promise<{ rates: FeeRates; usd_rate: number }> {
  const { data, error } = await db
    .from('site_settings')
    .select('usd_exchange_rate, sh_fee_rate_catalog, sh_fee_rate_custom')
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error)) throw new SetupRequiredError();
    throw error;
  }
  const rate = Number((data as any)?.usd_exchange_rate);
  return {
    rates: normalizeFeeRates(data as any),
    usd_rate: Number.isFinite(rate) && rate > 0 ? rate : 1,
  };
}

// ---- Ledger ----------------------------------------------------------------------

const BASE_COLUMNS =
  'id, partner_reference, transaction_id, status, subtotal_cents, currency, paid_at, created_at, ' +
  'customer_email, invoice_id';
const PAYOUT_COLUMNS =
  'sh_fee_type, sh_fee_rate, payout_request_id, paid_out_at, paid_out_gross, paid_out_fee, paid_out_net';
// Added by earlier, hand-run migrations; tolerated when absent.
const DETAIL_COLUMNS = 'customer_name, shipping_total_cents, refunded_total_cents';
const PORTAL_COLUMNS = 'portal_order';

type LedgerRow = Record<string, any>;

async function loadPaidLedger(): Promise<{ rows: LedgerRow[]; portal: boolean }> {
  const attempts: Array<{ cols: string; portal: boolean }> = [
    { cols: `${BASE_COLUMNS}, ${PAYOUT_COLUMNS}, ${DETAIL_COLUMNS}, ${PORTAL_COLUMNS}`, portal: true },
    { cols: `${BASE_COLUMNS}, ${PAYOUT_COLUMNS}, ${DETAIL_COLUMNS}`, portal: false },
    { cols: `${BASE_COLUMNS}, ${PAYOUT_COLUMNS}`, portal: false },
  ];
  let lastError: any = null;
  for (const a of attempts) {
    const { rows, error } = await selectAll<LedgerRow>((from, to) =>
      db
        .from('puramass_orders')
        .select(a.cols)
        .eq('status', 'paid')
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
    );
    if (!error) return { rows, portal: a.portal };
    lastError = error;
    if (!isMissingSchema(error)) throw error;
  }
  // Even the payout columns aren't there: the migration hasn't run.
  if (isMissingSchema(lastError)) throw new SetupRequiredError();
  throw lastError;
}

async function loadRequests(): Promise<PayoutRequestRow[]> {
  const { rows, error } = await selectAll<PayoutRequestRow>((from, to) =>
    db
      .from('stealth_health_payout_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .range(from, to),
  );
  if (error) {
    if (isMissingSchema(error)) throw new SetupRequiredError();
    throw error;
  }
  return rows;
}

interface InvoiceRef { invoice_number: string | null; customer_name: string | null; customer_email: string | null }

async function loadInvoices(ids: string[]): Promise<Map<string, InvoiceRef>> {
  const out = new Map<string, InvoiceRef>();
  for (const part of chunks(ids)) {
    const { data, error } = await db
      .from('invoices')
      .select('id, invoice_number, customer_name, customer_email')
      .in('id', part);
    if (error) {
      console.error('[stealth-health-payouts] invoice read failed:', error);
      continue;
    }
    for (const i of (data ?? []) as any[]) {
      out.set(String(i.id), {
        invoice_number: i.invoice_number ?? null,
        customer_name: i.customer_name ?? null,
        customer_email: i.customer_email ?? null,
      });
    }
  }
  return out;
}

interface WebhookEvent {
  puramass_order_id: string | null;
  transaction_id: string | null;
  status: string | null;
  payload: unknown;
  received_at: string;
}

/**
 * The payment webhook for each order: the latest signed delivery reporting it
 * paid, matched by transaction ID (or, failing that, the order we linked it
 * to). Falls back to the latest signed delivery of any kind.
 */
async function loadSignedWebhooks(rows: LedgerRow[]): Promise<Map<string, unknown>> {
  const byTxn = new Map<string, WebhookEvent[]>();
  const byOrder = new Map<string, WebhookEvent[]>();
  const push = (m: Map<string, WebhookEvent[]>, k: string, e: WebhookEvent) => {
    const list = m.get(k);
    if (list) list.push(e); else m.set(k, [e]);
  };

  const read = async (column: 'transaction_id' | 'puramass_order_id', values: string[]) => {
    for (const part of chunks(values)) {
      const { data, error } = await db
        .from('puramass_webhook_events')
        .select('puramass_order_id, transaction_id, status, payload, received_at')
        .eq('signature_valid', true)
        .in(column, part)
        .order('received_at', { ascending: false })
        .limit(5000);
      if (error) {
        // The webhook log is an optional migration — no log, no webhook figures.
        if (!isMissingSchema(error)) console.error('[stealth-health-payouts] webhook read failed:', error);
        return;
      }
      for (const e of (data ?? []) as WebhookEvent[]) {
        if (column === 'transaction_id' && e.transaction_id) push(byTxn, e.transaction_id, e);
        if (column === 'puramass_order_id' && e.puramass_order_id) push(byOrder, e.puramass_order_id, e);
      }
    }
  };

  const txns = [...new Set(rows.map((r) => r.transaction_id).filter(Boolean).map(String))];
  await read('transaction_id', txns);
  const unmatched = rows.filter((r) => !r.transaction_id || !byTxn.has(String(r.transaction_id))).map((r) => String(r.id));
  await read('puramass_order_id', unmatched);

  const pick = (events: WebhookEvent[] | undefined) => {
    if (!events || events.length === 0) return undefined;
    return (events.find((e) => e.status === 'paid') ?? events[0]).payload;
  };

  const out = new Map<string, unknown>();
  for (const r of rows) {
    const p = pick(r.transaction_id ? byTxn.get(String(r.transaction_id)) : undefined) ?? pick(byOrder.get(String(r.id)));
    if (p) out.set(String(r.id), p);
  }
  return out;
}

// ---- Resolution ------------------------------------------------------------------

const clean = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

function resolveCustomer(
  row: LedgerRow,
  webhook: unknown,
  invoice: InvoiceRef | undefined,
): { name: string | null; email: string | null; source: FigureSource } {
  const ledgerEmail = clean(row.customer_email);
  const invoiceEmail = clean(invoice?.customer_email);
  const candidates: Array<{ name: string | null; email: string | null; source: FigureSource }> = [];
  const wh = portalCustomer(webhook);
  if (wh) candidates.push({ ...wh, source: 'webhook' });
  const po = portalCustomer(row.portal_order);
  if (po) candidates.push({ ...po, source: 'portal' });
  candidates.push({
    name: clean(row.customer_name),
    email: ledgerEmail && !isPlaceholderEmail(ledgerEmail) ? ledgerEmail : null,
    source: 'ledger',
  });
  candidates.push({
    name: clean(invoice?.customer_name),
    email: invoiceEmail && !isPlaceholderEmail(invoiceEmail) ? invoiceEmail : null,
    source: 'invoice',
  });

  const first = candidates.find((c) => c.name || c.email);
  if (!first) return { name: null, email: null, source: 'none' };
  return {
    name: first.name ?? candidates.find((c) => c.name)?.name ?? null,
    email: first.email ?? candidates.find((c) => c.email)?.email ?? null,
    source: first.source,
  };
}

function resolveMoney(
  row: LedgerRow,
  webhook: unknown,
): { total_cents: number | null; currency: string | null; source: FigureSource } {
  const ledgerShipping = Number.isFinite(Number(row.shipping_total_cents)) && row.shipping_total_cents != null
    ? Math.round(Number(row.shipping_total_cents))
    : null;
  const ledgerCurrency = clean(row.currency)?.toLowerCase() ?? null;

  const wh = portalMoney(webhook, ledgerShipping);
  if (wh) return { total_cents: wh.total_cents, currency: wh.currency ?? ledgerCurrency, source: 'webhook' };
  const po = portalMoney(row.portal_order, ledgerShipping);
  if (po) return { total_cents: po.total_cents, currency: po.currency ?? ledgerCurrency, source: 'portal' };

  if (row.subtotal_cents != null && Number.isFinite(Number(row.subtotal_cents))) {
    return {
      total_cents: Math.round(Number(row.subtotal_cents)) + Math.max(0, ledgerShipping ?? 0),
      currency: ledgerCurrency,
      source: 'ledger',
    };
  }
  return { total_cents: null, currency: ledgerCurrency, source: 'none' };
}

/** Every customer-paid order with its fee, net and state, plus every request. */
export async function loadPayoutData(): Promise<PayoutData> {
  const [{ rates, usd_rate }, ledger, requestRows] = await Promise.all([
    loadSettings(),
    loadPaidLedger(),
    loadRequests(),
  ]);

  const invoiceIds = [...new Set(ledger.rows.map((r) => r.invoice_id).filter(Boolean).map(String))];
  const [invoices, webhooks] = await Promise.all([
    loadInvoices(invoiceIds),
    loadSignedWebhooks(ledger.rows),
  ]);

  const refs = new Map<string, RequestRef>(requestRows.map((r) => [r.id, requestRef(r)]));
  const tz = BRAND.timeZone;

  const orders = sortOrders(
    ledger.rows.map((row) => {
      const id = String(row.id);
      const invoice = row.invoice_id ? invoices.get(String(row.invoice_id)) : undefined;
      const webhook = webhooks.get(id);
      const customer = resolveCustomer(row, webhook, invoice);
      const money = resolveMoney(row, webhook);
      const input: PayoutOrderInput = {
        id,
        partner_reference: row.partner_reference ?? null,
        transaction_id: row.transaction_id ?? null,
        invoice_id: row.invoice_id ?? null,
        invoice_number: invoice?.invoice_number ?? null,
        paid_at: row.paid_at ?? null,
        created_at: row.created_at ?? null,
        total_cents: money.total_cents,
        currency: money.currency,
        money_source: money.source,
        customer_name: customer.name,
        customer_email: customer.email,
        customer_source: customer.source,
        refunded_cents: Number(row.refunded_total_cents ?? 0) || 0,
        sh_fee_type: row.sh_fee_type ?? null,
        sh_fee_rate: row.sh_fee_rate,
        payout_request_id: row.payout_request_id ?? null,
        paid_out_at: row.paid_out_at ?? null,
        paid_out_gross: row.paid_out_gross,
        paid_out_fee: row.paid_out_fee,
        paid_out_net: row.paid_out_net,
      };
      return buildPayoutOrder(input, rates, usd_rate, refs, tz);
    }),
  );

  const requests = requestRows.map((r) => buildRequestView(r, orders, tz));

  return { orders, requests, rates, usd_rate, time_zone: tz, portal_snapshots: ledger.portal };
}

// ---- Errors --------------------------------------------------------------------

/**
 * One error → response mapping for every payout route. A refusal raised by an
 * sh_* function (P0001) goes to the admin as is.
 */
export function payoutErrorResponse(err: unknown): NextResponse {
  if (err instanceof SetupRequiredError || isMissingSchema(err)) {
    return NextResponse.json({ error: SETUP_HINT, setup_required: true }, { status: 409 });
  }
  const e = err as { code?: string; message?: string } | null;
  if (e?.code === 'P0001' && e.message) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  console.error('[stealth-health-payouts]', err);
  return NextResponse.json(
    { error: e?.message || 'Something went wrong' },
    { status: 500 },
  );
}

/** Ids from a request body: strings, deduplicated, capped. */
export function readIds(value: unknown, max = 5000): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((v) => String(v ?? '').trim()).filter(Boolean))].slice(0, max);
}

// ---- Audit ---------------------------------------------------------------------

/**
 * One audit_logs row per entity (`stealth_health.paid_out` on 40 orders is 40
 * rows), written in a single insert. Never throws.
 */
export async function auditPayout(
  actor: { id: string; email: string | null },
  action: string,
  entityType: 'stealth_health_payout_request' | 'puramass_order' | 'site_settings',
  ids: Array<string | null>,
): Promise<void> {
  const rows = (ids.length > 0 ? ids : [null]).map((id) => ({
    actor_id: actor.id,
    actor_email: actor.email,
    action,
    entity_type: entityType,
    entity_id: id,
  }));
  try {
    const { error } = await db.from('audit_logs').insert(rows);
    if (error) console.error('[stealth-health-payouts] audit insert failed:', error);
  } catch (err) {
    console.error('[stealth-health-payouts] audit insert threw:', err);
  }
}
