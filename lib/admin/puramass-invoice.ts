/**
 * The Stealth Health side of an invoice.
 *
 * A paid Stealth Health hand-off is materialised into a local
 * invoice (`invoices.source = 'stealth_health'`) so the warehouse and the
 * customer account can see it — see lib/payments/puramass-fulfillment.ts. That
 * invoice deliberately carries none of the buyer's contact or shipping detail:
 * Stealth Health collects it on its hosted checkout page and reports it back onto the
 * hand-off ledger (`puramass_orders`), which is the source of truth for it.
 *
 * This module is the join. Given invoice ids, it reads the matching ledger rows
 * and normalises them into one shape the admin invoice table, the invoice
 * detail view and the printable invoice all render — so every surface says the
 * same thing, and says plainly that the data came from Stealth Health rather than
 * from someone typing it into this admin.
 *
 * Everything is tolerant of missing data. An order Stealth Health has not reported an
 * address for is the normal case (there is a whole "ask the customer" flow for
 * it), and the newer ledger columns may not be migrated yet — reads use
 * `select('*')` precisely so a missing column can never fail the query.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { toShippingAddress, type ShippingAddressLike } from '@/lib/payments/puramass-address';
import { normalizeCurrency, type Currency } from '@/lib/currency';

/** `invoices.source` for an invoice materialised from a Stealth Health hand-off. */
export const PURAMASS_INVOICE_SOURCE = 'stealth_health';

/** How the buyer's shipping address reached us. */
export type PuramassAddressSource = 'puramass' | 'customer' | null;

/** One line as Stealth Health reports it, prices in cents. */
export interface PuramassContextItem {
  sku: string | null;
  name: string | null;
  quantity: number;
  unit_price_cents: number | null;
}

/** One refund Stealth Health recorded against the transaction. */
export interface PuramassContextRefund {
  id: string | null;
  amount_cents: number | null;
  reason: string | null;
  created_at: string | null;
}

/**
 * Everything the invoice surfaces know about the Stealth Health order behind an
 * invoice. Flat and pre-normalised: the UI never re-parses the ledger's JSONB.
 */
export interface PuramassInvoiceContext {
  /** `puramass_orders.id` — the ledger row this came from. */
  ledger_id: string;
  /** Our reference, echoed back by Stealth Health on every payload. */
  partner_reference: string;
  transaction_id: string | null;
  /** Stealth Health's hosted page for this transaction. */
  payment_link: string | null;
  /** Payment status on the Stealth Health side (`paid`, `payment_pending`, …). */
  status: string;
  currency: string;
  /** Goods total Stealth Health charged, in cents (excludes our shipment fee). */
  subtotal_cents: number | null;
  /** Refunded on the Stealth Health side, in cents. 0 when nothing was refunded. */
  refunded_total_cents: number;
  refunds: PuramassContextRefund[];
  created_at: string | null;
  paid_at: string | null;
  /** When the hosted payment link stops accepting payment. */
  expires_at: string | null;
  /** Buyer contact as captured on the Stealth Health hosted page. */
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  /** Where the parcel goes. Null until Stealth Health (or the buyer) reports one. */
  shipping_address: ShippingAddressLike | null;
  shipping_address_source: PuramassAddressSource;
  shipping_address_updated_at: string | null;
  /** When the "we didn't catch your address" email last went out. */
  address_requested_at: string | null;
  /** Priced lines from Stealth Health, falling back to the hand-off sku/qty list. */
  items: PuramassContextItem[];
}

/** True when this invoice was materialised from a Stealth Health hand-off. */
export function isPuramassInvoice(invoice: { source?: string | null } | null | undefined): boolean {
  return invoice?.source === PURAMASS_INVOICE_SOURCE;
}

function str(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? t : null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function cents(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  // JSONB read back as text by an older client.
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Normalise refunds. Stealth Health's refund shape isn't pinned down by the partner
 * contract, so each field is read from the handful of names it could plausibly
 * arrive under and anything unrecognised is simply dropped rather than shown
 * raw on an invoice.
 */
function normalizeRefunds(raw: unknown): PuramassContextRefund[] {
  return asArray(raw)
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      id: str(r.id ?? r.refund_id),
      amount_cents: cents(r.amount_cents ?? r.amount ?? r.total_cents),
      reason: str(r.reason ?? r.note ?? r.description),
      created_at: str(r.created_at ?? r.refunded_at ?? r.date),
    }));
}

/**
 * Priced lines, preferring what Stealth Health charged (`paid_items`) over the
 * sku/quantity list we sent at hand-off (`items`). The hand-off list carries no
 * prices, so those rows come back with `unit_price_cents: null`.
 */
function normalizeItems(paidItems: unknown, handoffItems: unknown): PuramassContextItem[] {
  const priced = asArray(paidItems);
  const source = priced.length > 0 ? priced : asArray(handoffItems);
  return source
    .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
    .map((i) => ({
      sku: str(i.sku),
      name: str(i.name),
      quantity: Math.max(1, Math.round(Number(i.quantity ?? 1)) || 1),
      unit_price_cents: cents(i.unit_price_cents),
    }));
}

/** Shape one `puramass_orders` row into the context the invoice pages read. */
export function normalizePuramassContext(row: Record<string, unknown>): PuramassInvoiceContext {
  const source = str(row.shipping_address_source);
  return {
    ledger_id: String(row.id ?? ''),
    partner_reference: String(row.partner_reference ?? ''),
    transaction_id: str(row.transaction_id),
    payment_link: str(row.payment_link),
    status: String(row.status ?? ''),
    currency: (str(row.currency) ?? 'USD').toUpperCase(),
    subtotal_cents: cents(row.subtotal_cents),
    refunded_total_cents: cents(row.refunded_total_cents) ?? 0,
    refunds: normalizeRefunds(row.refunds),
    created_at: str(row.created_at),
    paid_at: str(row.paid_at),
    expires_at: str(row.expires_at),
    customer_name: str(row.customer_name),
    customer_email: str(row.customer_email),
    customer_phone: str(row.customer_phone),
    shipping_address: toShippingAddress(row.shipping_address),
    shipping_address_source:
      source === 'customer' ? 'customer' : source === 'puramass' ? 'puramass' : null,
    shipping_address_updated_at: str(row.shipping_address_updated_at),
    address_requested_at: str(row.address_requested_at),
    items: normalizeItems(row.paid_items, row.items),
  };
}

/**
 * Load the Stealth Health context for a set of invoices, keyed by invoice id.
 *
 * SERVER ONLY (the ledger is service-role locked). Best-effort: any failure
 * yields an empty map, because an invoice list that renders without the
 * Stealth Health block is far better than one that 500s. `select('*')` is deliberate
 * — naming columns would break the query on a database that hasn't run the
 * later Stealth Health migrations yet.
 */
export async function fetchPuramassContexts(
  db: SupabaseClient,
  invoiceIds: string[],
): Promise<Map<string, PuramassInvoiceContext>> {
  const out = new Map<string, PuramassInvoiceContext>();
  const ids = [...new Set(invoiceIds.filter(Boolean))];
  if (ids.length === 0) return out;

  // Chunked: the id list travels in the query string, so one `in.(…)` over
  // hundreds of UUIDs would eventually outgrow the request line.
  const CHUNK = 100;
  try {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await db
        .from('puramass_orders')
        .select('*')
        .in('invoice_id', ids.slice(i, i + CHUNK));
      if (error) {
        console.error('[puramass] invoice context lookup failed:', error);
        return out;
      }
      for (const row of data ?? []) {
        const r = row as Record<string, unknown>;
        const invoiceId = str(r.invoice_id);
        if (!invoiceId) continue;
        out.set(invoiceId, normalizePuramassContext(r));
      }
    }
  } catch (err) {
    console.error('[puramass] invoice context lookup threw:', err);
  }
  return out;
}

/** Single-invoice convenience wrapper over {@link fetchPuramassContexts}. */
export async function fetchPuramassContext(
  db: SupabaseClient,
  invoiceId: string,
): Promise<PuramassInvoiceContext | null> {
  const map = await fetchPuramassContexts(db, [invoiceId]);
  return map.get(invoiceId) ?? null;
}

// ---- Display helpers (client-safe) ---------------------------------------

/** Cents → a display amount in the order's currency, or null when unknown. */
export function centsToAmount(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? +(value / 100).toFixed(2) : null;
}

/** Loose invoice shape — the money fields every invoice surface has. */
interface InvoiceMoneyFields {
  subtotal?: unknown;
  shipping_cost?: unknown;
  total?: unknown;
  currency?: unknown;
}

/** The two halves of a Stealth Health invoice's money, each in its own currency. */
export interface PuramassMoneySplit {
  /** Goods total, in the currency Stealth Health reported charging it in. */
  goods: number;
  goodsCurrency: Currency;
  /** Our shipment fee, in the currency the invoice recorded it in. */
  shipping: number;
  shippingCurrency: Currency;
}

function amount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Split a Stealth Health invoice into the goods Stealth Health charged and the shipment fee
 * we added, when the two are in different currencies.
 *
 * Stealth Health charges the goods on its hosted page and reports back the currency
 * it used (`puramass_orders.currency`), which is not always USD.
 *
 * On a hand-off priced by our own checkout the shipment fee is in that same
 * currency (see `resolveFulfillmentShipping`), so there is nothing to split and
 * this returns null. It still matters for the older invoices that pair a goods
 * amount Stealth Health reported with the flat USD fee this admin used to stamp
 * regardless: there `invoices.total` is a sum of two currencies and the
 * invoice's own currency describes only the fee. Nothing in this system
 * converts between the two, so the invoice surfaces show both amounts rather
 * than a sum that would read as one currency.
 *
 * Null when there is nothing to split: no Stealth Health order behind the invoice, or
 * both halves already in the same currency — then the invoice's own currency
 * covers the whole total, as it does everywhere else.
 */
export function puramassMoneySplit(
  invoice: InvoiceMoneyFields,
  puramass: PuramassInvoiceContext | null | undefined,
): PuramassMoneySplit | null {
  if (!puramass) return null;
  const goodsCurrency = normalizeCurrency(puramass.currency);
  const shippingCurrency = normalizeCurrency(invoice.currency);
  if (goodsCurrency === shippingCurrency) return null;
  return {
    // The ledger's own subtotal is what Stealth Health says it charged; the
    // invoice's is only a copy of it, so prefer the ledger.
    goods: centsToAmount(puramass.subtotal_cents) ?? amount(invoice.subtotal),
    goodsCurrency,
    shipping: amount(invoice.shipping_cost),
    shippingCurrency,
  };
}

/** Human label for a Stealth Health payment status. */
export const PURAMASS_STATUS_LABEL: Record<string, string> = {
  paid: 'Paid on Stealth Health',
  payment_pending: 'Awaiting payment',
  expired: 'Link expired',
  cancelled: 'Cancelled',
};

/** Badge classes per Stealth Health payment status, matching /admin/stealth-health (Orders tab). */
export const PURAMASS_STATUS_BADGE: Record<string, string> = {
  paid: 'bg-emerald-100 text-emerald-700',
  payment_pending: 'bg-amber-100 text-amber-700',
  expired: 'bg-gray-200 text-gray-600',
  cancelled: 'bg-red-100 text-red-700',
};
