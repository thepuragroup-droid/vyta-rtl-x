/**
 * Read the customer and the amount charged out of what Stealth Health sent us:
 * a webhook body (`puramass_webhook_events.payload`) or an order as last
 * polled from the portal (`puramass_orders.portal_order`).
 *
 * Both are Stealth Health's own record of the sale, so the Payouts tab prefers
 * them to what our ledger wrote at hand-off. Neither shape is contractual, so
 * every field is read defensively and anything missing comes back null rather
 * than as a guess.
 */

export interface PortalCustomer {
  name: string | null;
  email: string | null;
}

export interface PortalMoney {
  /** Total the customer was charged, shipping included, in cents of `currency`. */
  total_cents: number;
  /** Lower-case ISO code as Stealth Health reports it ('usd' | 'cad'), when given. */
  currency: string | null;
  /** True when shipping came from our hand-off rather than from this payload. */
  shipping_from_ledger: boolean;
}

type Obj = Record<string, any>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
};

const cents = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.round(v);
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
};

/**
 * The order object inside a webhook body or a polled response. Webhooks carry
 * it under `data` (sometimes `data.order`); the poll returns `{ order }` or the
 * order itself.
 */
export function portalOrderBody(payload: unknown): Obj | null {
  if (!isObj(payload)) return null;
  if (isObj(payload.data)) return isObj(payload.data.order) ? payload.data.order : payload.data;
  if (isObj(payload.order)) return payload.order;
  return payload;
}

/** Guest checkouts get a placeholder address (`guest+…@vyta.local`); it isn't an email. */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  const e = String(email ?? '').trim().toLowerCase();
  return e === '' || !e.includes('@') || e.endsWith('.local');
}

export function portalCustomer(payload: unknown): PortalCustomer | null {
  const body = portalOrderBody(payload);
  if (!body) return null;
  const c = isObj(body.customer) ? body.customer : {};
  const first = str(c.first_name);
  const last = str(c.last_name);
  const name = str(c.name) ?? ([first, last].filter(Boolean).join(' ') || null);
  const rawEmail = str(c.email) ?? str(body.customer_email);
  const email = rawEmail && !isPlaceholderEmail(rawEmail) ? rawEmail : null;
  if (!name && !email) return null;
  return { name, email };
}

/**
 * The total charged. An explicit total wins; otherwise the priced lines plus
 * shipping. Stealth Health's payment webhook lists the priced lines but not
 * the shipping charge, so `ledgerShippingCents` (the shipping we sent at
 * hand-off, which is what the customer was charged) fills that gap.
 */
export function portalMoney(
  payload: unknown,
  ledgerShippingCents: number | null = null,
): PortalMoney | null {
  const body = portalOrderBody(payload);
  if (!body) return null;
  const currency = str(body.currency)?.toLowerCase() ?? null;

  const explicit =
    cents(body.total_cents) ??
    cents(body.amount_total_cents) ??
    cents(body.total_charged_cents) ??
    cents(body.amount_cents);
  if (explicit != null) return { total_cents: explicit, currency, shipping_from_ledger: false };

  let goods = cents(body.subtotal_cents);
  if (goods == null && Array.isArray(body.items) && body.items.length > 0) {
    let sum = 0;
    for (const i of body.items) {
      const unit = cents(i?.unit_price_cents);
      const qty = cents(i?.quantity);
      if (unit == null || qty == null) { sum = -1; break; }
      sum += unit * qty;
    }
    if (sum >= 0) goods = sum;
  }
  if (goods == null) return null;

  const shipping = cents(body.shipping_total_cents) ?? cents(body.shipping_cents);
  if (shipping != null) return { total_cents: goods + shipping, currency, shipping_from_ledger: false };
  return {
    total_cents: goods + Math.max(0, ledgerShippingCents ?? 0),
    currency,
    shipping_from_ledger: true,
  };
}
