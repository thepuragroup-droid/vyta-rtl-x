/**
 * Stealth Health hosted-checkout API client.
 *
 * SERVER-ONLY. The API key is a live payment secret — this module must only
 * ever be imported by route handlers, never by client components. Env is read
 * at call time so it picks up runtime config.
 *
 * Partner API contract (fixed by Stealth Health, identical on any site):
 *   Base URL   https://api.stealth.health   (override via PURAMASS_API_BASE_URL)
 *   Auth       X-Partner-ID + X-Api-Key on every call
 *   GET  /partner/store/products             — catalog (SKU source of truth)
 *   POST /partner/store/orders               — create hosted-checkout order
 *                                              (accepts our `currency` and
 *                                              per-line `unit_price_cents`)
 *   GET  /partner/store/orders/{id}          — order status (polling)
 *   Webhook store_order.payment_complete     — HMAC-signed status push
 *
 * The read-only settlement ledger (GET /partner/settlement) is a sibling
 * module — see lib/payments/puramass-settlement.ts.
 */
import crypto from 'node:crypto';

// ---- Types ----------------------------------------------------------------

/**
 * quantity = number of catalog units (a case SKU, one per pack of any size, or a
 * single-vial SKU),
 * clamped 1–99.
 *
 * `unit_price_cents` is OUR price for one of those units, in cents of the
 * order's `currency`, with any discount already taken off. Always sent: the
 * partner API would fall back to Stealth Health's own catalog price for a line
 * without one, and goods are charged at our prices, never theirs.
 */
export interface PuramassOrderLine {
  sku: string;
  quantity: number;
  unit_price_cents: number;
}

export interface PuramassCustomer {
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
}

/** Shipping address as Stealth Health reports it back on an order. */
export interface PuramassShippingAddress {
  address: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
}

/** Buyer contact Stealth Health captured on its hosted page. */
export interface PuramassContact {
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface PuramassOrder {
  status: string;
  transaction_id: string;
  payment_link: string;
  /** Lower-case ISO code the hosted page prices in, e.g. 'cad'. */
  currency: string | null;
  subtotal_cents: number;
  items: { sku?: string; quantity?: number }[];
}

export interface PuramassCatalogProduct {
  sku: string;
  name: string;
  /** Normalised to integer cents regardless of the API's price unit. */
  price_cents: number | null;
  image: string | null;
}

/** One priced line as Stealth Health reports it on a paid order. */
export interface PuramassPaidItem {
  sku?: string;
  name?: string;
  quantity?: number;
  unit_price_cents?: number;
}

export interface PuramassOrderStatus {
  transaction_id: string;
  status: string;
  partner_reference: string | null;
  currency: string | null;
  subtotal_cents: number | null;
  payment_link: string | null;
  created_at: string | null;
  paid_at: string | null;
  expires_at: string | null;
  items: PuramassPaidItem[];
  /** Total refunded on the Stealth Health side, in cents. Null when not reported. */
  refunded_total_cents: number | null;
  /** Refund records verbatim, in whatever shape Stealth Health sends them. */
  refunds: unknown[];
  /** Null when Stealth Health has not (yet) reported an address for this order. */
  shipping: PuramassShippingAddress | null;
  customer: PuramassContact;
}

/**
 * Error from the partner API. Carries an HTTP-ish `status` and a `detail`
 * string that has been sanitised — it NEVER contains the API key.
 */
export class PuramassApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail || `Stealth Health API error ${status}`);
    this.name = 'PuramassApiError';
    this.status = status;
    this.detail = detail;
  }
}

// ---- Config ---------------------------------------------------------------

function config() {
  return {
    apiKey: process.env.PURAMASS_API_KEY || '',
    partnerId: process.env.PURAMASS_PARTNER_ID || 'ptr_puramass',
    baseUrl: (process.env.PURAMASS_API_BASE_URL || 'https://api.stealth.health').replace(/\/+$/, ''),
    webhookSecret: process.env.PURAMASS_WEBHOOK_SECRET || '',
  };
}

/** True when the partner API can be called (key + partner id present). */
export function isPuramassConfigured(): boolean {
  const { apiKey, partnerId } = config();
  return Boolean(apiKey && partnerId);
}

/** True when webhook signatures can be verified. */
export function isPuramassWebhookConfigured(): boolean {
  return Boolean(config().webhookSecret);
}

const TIMEOUT_MS = 20_000;

// ---- Transport ------------------------------------------------------------

// Pull a human-readable message out of an error envelope without ever leaking
// request details (the auth headers are never echoed by the API, but be safe).
function sanitizeDetail(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const msg = b.error ?? b.message ?? b.detail ?? (b.errors && JSON.stringify(b.errors));
    if (typeof msg === 'string' && msg.trim()) return msg.trim().slice(0, 300);
  }
  return `Stealth Health API error ${status}`;
}

/**
 * Authenticated call to the partner API. Exported so sibling partner-API
 * modules (e.g. puramass-settlement.ts) share one transport: same base URL,
 * same `X-Partner-ID` + `X-Api-Key` headers, same timeout, and the same
 * key-free error sanitising. Server-only, like the rest of this module.
 */
export async function puramassFetch(
  path: string,
  init: RequestInit = {},
): Promise<any> {
  const { apiKey, partnerId, baseUrl } = config();
  if (!apiKey) throw new PuramassApiError(503, 'Stealth Health is not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'X-Partner-ID': partnerId,
        'X-Api-Key': apiKey,
        ...(init.headers ?? {}),
      },
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new PuramassApiError(504, 'Stealth Health request timed out');
    }
    throw new PuramassApiError(502, 'Could not reach Stealth Health');
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    throw new PuramassApiError(res.status, sanitizeDetail(json, res.status));
  }
  return json;
}

// ---- Catalog --------------------------------------------------------------

function toCents(p: any): number | null {
  if (typeof p?.price_cents === 'number') return Math.round(p.price_cents);
  if (typeof p?.price === 'number') return Math.round(p.price * 100);
  const asNum = Number(p?.price ?? p?.price_cents);
  return Number.isFinite(asNum) && asNum > 0 ? Math.round(asNum * (p?.price_cents ? 1 : 100)) : null;
}

function normalizeCatalogProduct(p: any): PuramassCatalogProduct {
  return {
    sku: String(p?.sku ?? '').trim(),
    name: String(p?.name ?? '').trim(),
    price_cents: toCents(p),
    image: p?.image ?? p?.image_url ?? null,
  };
}

/**
 * GET /partner/store/products — the live catalog. Read-only, safe anytime.
 * The response envelope isn't guaranteed, so parse defensively: bare array,
 * `{ products: [...] }`, or `{ data: [...] }`; price as dollars or cents.
 */
export async function fetchPuramassCatalog(): Promise<PuramassCatalogProduct[]> {
  const json = await puramassFetch('/partner/store/products', { method: 'GET' });
  const arr: any[] = Array.isArray(json)
    ? json
    : Array.isArray(json?.products)
      ? json.products
      : Array.isArray(json?.data)
        ? json.data
        : [];
  return arr.map(normalizeCatalogProduct).filter((p) => p.sku);
}

// ---- Create order ---------------------------------------------------------

function cleanCustomer(c: PuramassCustomer): Record<string, string> {
  const out: Record<string, string> = { email: String(c.email).trim() };
  if (c.first_name?.trim()) out.first_name = c.first_name.trim();
  if (c.last_name?.trim()) out.last_name = c.last_name.trim();
  if (c.phone?.trim()) out.phone = c.phone.trim();
  return out;
}

/**
 * The currency our hand-offs are denominated in. Our catalog is priced in
 * Canadian dollars, so the hosted page is told to price and charge in CAD —
 * without it Stealth Health falls back to its own USD listings and the buyer is
 * quoted a converted amount that doesn't match what our storefront showed.
 *
 * Stealth Health reports currency back lower-cased, so we send it that way too.
 */
export const PURAMASS_CURRENCY = 'cad';

/** A positive integer cent amount, or undefined for anything else. */
function optionalCents(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n);
}

/**
 * A shipping charge in cents, where zero is a real answer.
 *
 * Separate from `optionalCents` because the two zeroes mean opposite things. A
 * line with no price means "we couldn't price this, use your catalog"; a
 * shipping total of zero means "this order ships free" — the free-shipping
 * promo (see `freeHostedRate`) resolves to exactly that. Omitting it would let
 * Stealth Health quote its own shipping on the hosted page, so a buyer shown $0.00 in
 * our summary would be charged for shipping at the end.
 *
 * Only a missing, negative or non-numeric value leaves the field off, which is
 * still what an unpriced hand-off wants.
 */
function shippingCents(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n);
}

export interface PuramassOrderRequest {
  items: PuramassOrderLine[];
  customer: PuramassCustomer;
  partnerReference: string;
  /** Defaults to `PURAMASS_CURRENCY`. Lower-cased before it is sent. */
  currency?: string;
  /**
   * Our own shipping charge. `0` is meaningful — it charges the buyer nothing
   * for shipping (the free-shipping promo). Omit to let Stealth Health quote it.
   */
  shippingTotalCents?: number;
}

/**
 * Build the POST /partner/store/orders body. Split out from the request so the
 * payload shape can be unit-tested without a network call.
 *
 * Every line must carry a positive `unit_price_cents`. The partner reads a
 * missing or zero price as "use your own catalog price", so a line without a
 * usable one throws here rather than going out and being charged at
 * Stealth Health's list. A zero shipping total, on the other hand, is sent as
 * `shipping_total_cents: 0`, because that is how an order that earned free
 * shipping is expressed. Only an absent shipping figure leaves the field off,
 * which lets Stealth Health quote shipping on its hosted page.
 */
export function buildPuramassOrderBody(args: PuramassOrderRequest): Record<string, unknown> {
  const shipping = shippingCents(args.shippingTotalCents);
  return {
    items: args.items.map((i) => {
      const unit = optionalCents(i.unit_price_cents);
      if (unit === undefined) {
        throw new PuramassApiError(500, `No price for ${i.sku}`);
      }
      return { sku: i.sku, quantity: i.quantity, unit_price_cents: unit };
    }),
    currency: String(args.currency || PURAMASS_CURRENCY).trim().toLowerCase(),
    customer: cleanCustomer(args.customer),
    payment: { mode: 'customer' },
    partner_reference: args.partnerReference,
    ...(shipping !== undefined ? { shipping_total_cents: shipping } : {}),
  };
}

/**
 * POST /partner/store/orders — create a hosted-checkout order.
 * Sends `{ sku, quantity, unit_price_cents }` lines, the order `currency`,
 * `payment.mode: "customer"`, and our `partner_reference` (idempotency key;
 * reusing the same reference is a safe retry). No shipping address is sent:
 * the buyer types their real one on the hosted page, and it comes back to us
 * on the order (see `normalizePuramassShipping` / `buildPuramassContactPatch`).
 * Validates that the response carries both a payment link and a transaction id.
 */
export async function createPuramassOrder(args: PuramassOrderRequest): Promise<PuramassOrder> {
  const json = await puramassFetch('/partner/store/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildPuramassOrderBody(args)),
  });

  // The order may be at the top level or nested under `order`.
  const order = json?.order ?? json ?? {};
  const paymentLink = order.payment_link ?? order.paymentLink ?? '';
  const transactionId = order.transaction_id ?? order.transactionId ?? '';
  if (!paymentLink || !transactionId) {
    throw new PuramassApiError(502, 'Stealth Health did not return a payment link');
  }

  return {
    status: String(order.status ?? 'payment_pending'),
    transaction_id: String(transactionId),
    payment_link: String(paymentLink),
    // What Stealth Health says it will charge in — normally the currency we asked
    // for, but the partner's answer is the one worth recording.
    currency: typeof order.currency === 'string' && order.currency.trim()
      ? order.currency.trim().toLowerCase()
      : null,
    subtotal_cents: Number(order.subtotal_cents ?? 0) || 0,
    items: Array.isArray(order.items) ? order.items : [],
  };
}

// ---- Shipping address / contact -------------------------------------------

function trimOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

/**
 * Normalise the `shipping` block Stealth Health returns on an order. Every field is
 * optional, so a block whose fields are all blank is treated as "no address"
 * (null) rather than an empty shell — callers use that to decide whether they
 * actually learned anything.
 */
export function normalizePuramassShipping(raw: unknown): PuramassShippingAddress | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const addr: PuramassShippingAddress = {
    address: trimOrNull(r.address ?? r.address1 ?? r.line1),
    address2: trimOrNull(r.address2 ?? r.line2),
    city: trimOrNull(r.city),
    state: trimOrNull(r.state ?? r.province ?? r.region),
    zip: trimOrNull(r.zip ?? r.postal_code ?? r.postcode),
    country: trimOrNull(r.country),
  };
  return Object.values(addr).some(Boolean) ? addr : null;
}

/** Normalise the `customer` block into a name / email / phone triple. */
export function normalizePuramassContact(raw: unknown): PuramassContact {
  if (!raw || typeof raw !== 'object') return { name: null, email: null, phone: null };
  const r = raw as Record<string, unknown>;
  const explicit = trimOrNull(r.name);
  const parts = [trimOrNull(r.first_name), trimOrNull(r.last_name)].filter(Boolean);
  return {
    name: explicit ?? (parts.length > 0 ? parts.join(' ') : null),
    email: trimOrNull(r.email),
    phone: trimOrNull(r.phone),
  };
}

/**
 * Build the `puramass_orders` patch for the address/contact fields, given what
 * the row already holds and what a webhook event or poll just reported.
 *
 * Additive by design: a field is only written when the incoming value is
 * non-empty AND differs from what is stored. A payload that omits the shipping
 * block (older events, a partner that didn't collect one) therefore leaves a
 * previously-captured address untouched instead of wiping it. Returns an empty
 * object when there is nothing new to write.
 *
 * One address never gets overwritten: one the buyer typed themselves on
 * /shipping-address/<token> (`shipping_address_source = 'customer'`). That flow
 * only exists because Stealth Health had no address for the order, so a later partner
 * payload is the less-trustworthy of the two — and silently replacing what the
 * customer told us would send the parcel somewhere they didn't ask for.
 */
export function buildPuramassContactPatch(
  row: {
    shipping_address?: unknown;
    shipping_address_source?: string | null;
    customer_name?: string | null;
    customer_phone?: string | null;
    customer_email?: string | null;
  },
  incoming: { shipping?: unknown; customer?: unknown },
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  const shipping = normalizePuramassShipping(incoming.shipping);
  const customerOwned = row.shipping_address_source === 'customer' && !!row.shipping_address;
  if (shipping && !customerOwned) {
    const current = normalizePuramassShipping(row.shipping_address);
    if (JSON.stringify(current) !== JSON.stringify(shipping)) {
      patch.shipping_address = shipping;
      // Provenance, so the admin UI can tell this apart from an address the
      // buyer typed. Dropped automatically when the column isn't there yet.
      patch.shipping_address_source = 'puramass';
      patch.shipping_address_updated_at = new Date().toISOString();
    }
  }

  const contact = normalizePuramassContact(incoming.customer);
  if (contact.name && contact.name !== (row.customer_name ?? null)) {
    patch.customer_name = contact.name;
  }
  if (contact.phone && contact.phone !== (row.customer_phone ?? null)) {
    patch.customer_phone = contact.phone;
  }
  // Only fill a missing email — the one captured at hand-off is ours and is
  // what the invoice/account link keys on.
  if (contact.email && !row.customer_email) {
    patch.customer_email = contact.email;
  }

  return patch;
}

/**
 * Build the `puramass_orders` patch for the order-detail fields the invoice
 * pages read: the hosted link's expiry, the refunded total, the refund records
 * and the priced line items.
 *
 * Unlike the address patch, these are simply mirrored from the newest payload —
 * they are Stealth Health's own bookkeeping, so the latest report always wins. A
 * payload that omits a block leaves the stored value alone rather than clearing
 * it, so an older event replayed after a refund can't erase it.
 *
 * The columns arrive with puramass-order-details-migration.sql; call sites
 * strip them (see `stripUnmigratedFields`) when the database doesn't have them
 * yet, exactly as they do for the address columns.
 */
export function buildPuramassOrderDetailPatch(
  incoming: {
    expires_at?: unknown;
    refunded_total_cents?: unknown;
    refunds?: unknown;
    items?: unknown;
  },
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  const expires = trimOrNull(incoming.expires_at);
  if (expires) patch.expires_at = expires;

  if (typeof incoming.refunded_total_cents === 'number') {
    patch.refunded_total_cents = incoming.refunded_total_cents;
  }
  if (Array.isArray(incoming.refunds)) {
    patch.refunds = incoming.refunds;
  }

  // Only the priced form is worth storing — a bare { sku, quantity } list is
  // what we sent at hand-off and already lives in `items`.
  if (Array.isArray(incoming.items)) {
    const priced = incoming.items.filter(
      (i) => i && typeof i === 'object' && ('unit_price_cents' in i || 'name' in i),
    );
    if (priced.length > 0) patch.paid_items = priced;
  }

  return patch;
}

// ---- Order status (polling) ----------------------------------------------

/** GET /partner/store/orders/{transaction_id} — current order status. */
export async function fetchPuramassOrderStatus(
  transactionId: string,
): Promise<PuramassOrderStatus> {
  const json = await puramassFetch(
    `/partner/store/orders/${encodeURIComponent(transactionId)}`,
    { method: 'GET' },
  );
  const order = json?.order ?? json ?? {};
  return {
    transaction_id: String(order.transaction_id ?? transactionId),
    status: String(order.status ?? ''),
    partner_reference: order.partner_reference ?? null,
    currency: order.currency ?? null,
    subtotal_cents: typeof order.subtotal_cents === 'number' ? order.subtotal_cents : null,
    payment_link: order.payment_link ?? null,
    created_at: order.created_at ?? null,
    paid_at: order.paid_at ?? null,
    expires_at: order.expires_at ?? null,
    items: Array.isArray(order.items) ? order.items : [],
    refunded_total_cents:
      typeof order.refunded_total_cents === 'number' ? order.refunded_total_cents : null,
    refunds: Array.isArray(order.refunds) ? order.refunds : [],
    shipping: normalizePuramassShipping(order.shipping ?? order.shipping_address),
    customer: normalizePuramassContact(order.customer),
  };
}

// ---- Webhook signature ----------------------------------------------------

/**
 * Verify the `X-Stealth-Signature: sha256=<hex>` header against an HMAC-SHA256
 * of the RAW request body keyed by PURAMASS_WEBHOOK_SECRET. Length-guarded
 * constant-time compare. Returns false when the secret is unset or the header
 * is missing/malformed.
 */
export function verifyPuramassSignature(rawBody: string, header: string | null): boolean {
  const { webhookSecret } = config();
  if (!webhookSecret || !header) return false;

  const provided = header.startsWith('sha256=') ? header.slice(7) : header;
  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody, 'utf8')
    .digest('hex');

  // Compare the hex strings themselves (constant time); guard length first so
  // timingSafeEqual never throws on a length mismatch.
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}
