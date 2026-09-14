/**
 * One vocabulary for "what happened to this order", across both sales channels.
 *
 * The storefront and the Stealth Health hosted checkout name their statuses
 * differently — `pending`/`received` vs `payment_pending`, `cancelled` vs
 * `canceled` — and the reports need to line them up so a chart can plot
 * "pending payment" as one series whichever channel is selected.
 *
 * The buckets are MUTUALLY EXCLUSIVE and total: every order lands in exactly
 * one, so the six of them sum to the orders placed. That is what makes a
 * stacked bar honest — the stack really is the whole, not an overlapping set of
 * filters.
 *
 * Note what `refunded` does and does not mean here. A storefront order whose
 * status says it was refunded is a refund and nothing else, so it takes that
 * bucket. A hosted-checkout refund is money handed back on an order that DID
 * pay, so it stays in `paid` and the refund shows up in the money figures
 * (`refunds`, `refunded_orders`) instead — counting it here as well would say
 * one order twice.
 *
 * Isomorphic: no Supabase, no server imports, so the collector and the chart
 * agree on the labels and the order of the series.
 */

export type OrderStatusBucket =
  | 'paid'
  | 'pending'
  | 'expired'
  | 'cancelled'
  | 'refunded'
  | 'other';

/**
 * Series order, worst-to-best reading downwards from `paid`. Fixed so the
 * stacked bars, the legend, the table columns and the CSV all agree.
 */
export const ORDER_STATUS_BUCKETS: OrderStatusBucket[] = [
  'paid', 'pending', 'expired', 'cancelled', 'refunded', 'other',
];

export interface OrderStatusMeta {
  label: string;
  /** What the bucket means, for the chart legend's tooltip. */
  description: string;
  /** Series hue — see the palette note below. */
  color: string;
}

/*
 * The series palette, in this exact order.
 *
 * These are slots from the same eight-hue categorical palette the rest of the
 * store report draws on (green, yellow, red, violet, magenta, blue). The
 * ORDER is the colour-vision-deficiency safety mechanism, not a preference:
 * the outcomes are plotted as a stack and as overlaid lines, so each series
 * sits next to its neighbours here, and this ordering was picked by running the
 * palette validator over the candidates and keeping one that clears every gate
 * on a white card — worst adjacent CVD ΔE 13.0 and normal-vision ΔE 20.8,
 * against targets of 8 and 15. Reordering or substituting a hue means
 * re-validating, not eyeballing.
 *
 * Yellow and magenta sit under 3:1 against white, which is allowed here because
 * the chart never leans on colour alone: every series is named in the legend
 * with its range total, again in the crosshair tooltip, and again in the
 * date-wise table the section can switch to.
 *
 * `paid` is a true green rather than the report's aqua, and `other` takes the
 * blue, so nothing in this chart wears the hue another card has already spent
 * on sales (blue) or visitors (aqua).
 */

export const ORDER_STATUS_META: Record<OrderStatusBucket, OrderStatusMeta> = {
  paid: {
    label: 'Paid',
    description: 'Payment confirmed — the order is revenue.',
    color: '#008300',
  },
  pending: {
    label: 'Pending payment',
    description: 'Checkout started and the payment link is still live. Recoverable.',
    color: '#eda100',
  },
  expired: {
    label: 'Expired',
    description: 'The payment window lapsed before the buyer paid. Chaseable with a fresh link.',
    color: '#e34948',
  },
  cancelled: {
    label: 'Cancelled',
    description: 'Cancelled by the buyer or by the desk.',
    color: '#4a3aa7',
  },
  refunded: {
    label: 'Refunded',
    description: 'Paid, then given back in full. Hosted-checkout partial refunds stay under Paid.',
    color: '#e87ba4',
  },
  other: {
    label: 'Other',
    description: 'A status none of the buckets above claim — usually a lifecycle state added later.',
    color: '#2a78d6',
  },
};

/** The states the buyer can still be turned into a paying customer from. */
export const RECOVERABLE_STATUS_BUCKETS: OrderStatusBucket[] = ['pending', 'expired'];

// ---- storefront (`orders`) ----

/**
 * Payment confirmed or later. Mirrors app/api/orders/check-payment.
 *
 * Exported as an array as well because it is also used as a PostgREST
 * `in('status', …)` predicate, which cannot take a Set.
 */
export const STOREFRONT_PAID_STATUSES = [
  'confirmed', 'processing', 'shipped', 'delivered', 'paid',
];
const STOREFRONT_PAID = new Set(STOREFRONT_PAID_STATUSES);
/** Money still in flight: awaiting payment, or seen but not yet confirmed. */
const STOREFRONT_PENDING = new Set(['pending', 'received']);
const STOREFRONT_REFUNDED = new Set(['refunded', 'partially_refunded']);
const CANCELLED = new Set(['cancelled', 'canceled']);

/**
 * Which bucket a storefront order falls in.
 *
 * `refundedAt` is checked alongside the status because an order refunded
 * through the ledger keeps its fulfilment status (`shipped`, say) — the same
 * rule the sales collector applies, so the stack and the revenue figure never
 * disagree about which orders were refunded.
 */
export function storefrontStatusBucket(
  status: string,
  refundedAt?: unknown,
): OrderStatusBucket {
  const s = status.toLowerCase();
  if (STOREFRONT_REFUNDED.has(s) || refundedAt) return 'refunded';
  if (STOREFRONT_PAID.has(s)) return 'paid';
  if (STOREFRONT_PENDING.has(s)) return 'pending';
  if (s === 'expired') return 'expired';
  if (CANCELLED.has(s)) return 'cancelled';
  return 'other';
}

// ---- hosted checkout (`puramass_orders`) ----

/**
 * Which bucket a Stealth Health hand-off falls in.
 *
 * `refunded` is never returned: a hosted-checkout refund is a partial credit on
 * an order that paid, so it belongs in `paid` with the money reported
 * separately. See the note at the top of this file.
 */
export function puramassStatusBucket(status: string): OrderStatusBucket {
  const s = status.toLowerCase();
  if (s === 'paid') return 'paid';
  if (s === 'payment_pending') return 'pending';
  if (s === 'expired') return 'expired';
  if (CANCELLED.has(s)) return 'cancelled';
  return 'other';
}
