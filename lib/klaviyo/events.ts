/**
 * Server-side Klaviyo events for the store's order and account lifecycle.
 *
 * Every function here is best-effort: Klaviyo is marketing, and a failed or
 * slow call must never break a checkout, a payment webhook or a signup. They
 * never throw, return quickly when the integration is off, and dedupe through
 * Klaviyo's `unique_id` so webhook retries and re-polls can't double-count.
 *
 * Metric names follow Klaviyo's e-commerce conventions ("Placed Order",
 * "Ordered Product", "Fulfilled Order", "Started Checkout") so Klaviyo's
 * pre-built flows, benchmarks and revenue attribution recognise them.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { SITE_URL } from '@/lib/config';
import {
  createKlaviyoEvent,
  isValidEmail,
  readKlaviyoSettings,
  subscribeToKlaviyoList,
  upsertKlaviyoProfile,
  type KlaviyoEventInput,
  type KlaviyoProfileInput,
} from './client';
import { klaviyoServerReady, type KlaviyoSettings } from './settings';

export interface KlaviyoOrderItem {
  productId?: string | null;
  sku?: string | null;
  name: string;
  quantity: number;
  /** Unit price actually charged, in `currency`. */
  price: number;
  variant?: string | null;
  imageUrl?: string | null;
  url?: string | null;
  categories?: string[];
}

export interface KlaviyoOrderInput {
  /** Stable id — used as the dedupe key. */
  orderId: string;
  /** Human-facing order number, when there is one. */
  orderNumber?: string | null;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  customerId?: string | null;
  items: KlaviyoOrderItem[];
  subtotal?: number | null;
  shipping?: number | null;
  discount?: number | null;
  discountCode?: string | null;
  total: number;
  currency: string;
  /** Which checkout produced it: 'stealth_health', 'e-transfer', … */
  source?: string | null;
  shippingAddress?: KlaviyoProfileInput['location'];
  time?: string | Date | null;
}

async function settingsFor(
  db: SupabaseClient,
  settings?: KlaviyoSettings,
): Promise<KlaviyoSettings | null> {
  const s = settings ?? (await readKlaviyoSettings(db));
  return klaviyoServerReady(s) ? s : null;
}

async function send(s: KlaviyoSettings, ev: KlaviyoEventInput): Promise<boolean> {
  try {
    await createKlaviyoEvent(s.privateKey, ev);
    return true;
  } catch (err: any) {
    console.error(`[klaviyo] "${ev.metric}" failed:`, err?.message ?? err);
    return false;
  }
}

/** "Jane Q Doe" → { first: "Jane", last: "Q Doe" }. */
export function splitName(full: string | null | undefined): { first: string | null; last: string | null } {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  return { first: parts[0], last: parts.slice(1).join(' ') || null };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function itemProperties(it: KlaviyoOrderItem) {
  return {
    ProductID: it.productId ?? it.sku ?? it.name,
    SKU: it.sku ?? null,
    ProductName: it.name,
    Variant: it.variant ?? null,
    Quantity: it.quantity,
    ItemPrice: round2(it.price),
    RowTotal: round2(it.price * it.quantity),
    ProductURL: it.url ?? null,
    ImageURL: it.imageUrl ?? null,
    Categories: it.categories ?? [],
  };
}

function orderProfile(o: KlaviyoOrderInput): KlaviyoProfileInput {
  return {
    email: o.email,
    first_name: o.firstName,
    last_name: o.lastName,
    phone_number: o.phone,
    external_id: o.customerId,
    location: o.shippingAddress ?? null,
  };
}

/**
 * "Placed Order" plus one "Ordered Product" per line.
 *
 * Placed Order is the event Klaviyo attributes revenue from; Ordered Product
 * lets flows and segments key off individual products ("bought BPC-157").
 */
export async function trackPlacedOrder(
  db: SupabaseClient,
  order: KlaviyoOrderInput,
  settings?: KlaviyoSettings,
): Promise<void> {
  try {
    const s = await settingsFor(db, settings);
    if (!s || !isValidEmail(order.email)) return;
    const profile = orderProfile(order);
    const items = order.items.filter((i) => i.quantity > 0);
    const categories = [...new Set(items.flatMap((i) => i.categories ?? []))];

    await send(s, {
      metric: 'Placed Order',
      profile,
      value: order.total,
      currency: order.currency,
      uniqueId: order.orderId,
      time: order.time ?? null,
      properties: {
        OrderId: order.orderNumber || order.orderId,
        OrderNumber: order.orderNumber ?? null,
        Source: order.source ?? null,
        Categories: categories,
        ItemNames: items.map((i) => i.name),
        ItemCount: items.reduce((n, i) => n + i.quantity, 0),
        Items: items.map(itemProperties),
        Subtotal: order.subtotal != null ? round2(order.subtotal) : null,
        Shipping: order.shipping != null ? round2(order.shipping) : null,
        DiscountCode: order.discountCode ?? null,
        DiscountValue: order.discount != null ? round2(order.discount) : null,
        Currency: order.currency.toUpperCase(),
        ShippingAddress: order.shippingAddress ?? null,
        OrderURL: `${SITE_URL}/account`,
      },
    });

    await Promise.all(
      items.map((it, idx) =>
        send(s, {
          metric: 'Ordered Product',
          profile,
          value: round2(it.price * it.quantity),
          currency: order.currency,
          uniqueId: `${order.orderId}:${idx}`,
          time: order.time ?? null,
          properties: {
            OrderId: order.orderNumber || order.orderId,
            ...itemProperties(it),
          },
        }),
      ),
    );
  } catch (err) {
    console.error('[klaviyo] trackPlacedOrder threw:', err);
  }
}

export interface KlaviyoCheckoutInput {
  checkoutId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  customerId?: string | null;
  items: KlaviyoOrderItem[];
  value: number;
  currency: string;
  /** Where the buyer can pick the checkout back up (abandoned-checkout emails). */
  checkoutUrl?: string | null;
}

/**
 * "Started Checkout" — the trigger for Klaviyo's abandoned-checkout flow.
 * Fired server-side at hand-off, where the email is known for certain.
 */
export async function trackStartedCheckout(
  db: SupabaseClient,
  c: KlaviyoCheckoutInput,
  settings?: KlaviyoSettings,
): Promise<void> {
  try {
    const s = await settingsFor(db, settings);
    if (!s || !isValidEmail(c.email)) return;
    const items = c.items.filter((i) => i.quantity > 0);
    await send(s, {
      metric: 'Started Checkout',
      profile: {
        email: c.email,
        first_name: c.firstName,
        last_name: c.lastName,
        external_id: c.customerId,
      },
      value: c.value,
      currency: c.currency,
      uniqueId: c.checkoutId,
      properties: {
        CheckoutId: c.checkoutId,
        CheckoutURL: c.checkoutUrl ?? `${SITE_URL}/cart`,
        Categories: [...new Set(items.flatMap((i) => i.categories ?? []))],
        ItemNames: items.map((i) => i.name),
        ItemCount: items.reduce((n, i) => n + i.quantity, 0),
        Items: items.map(itemProperties),
        Currency: c.currency.toUpperCase(),
      },
    });
  } catch (err) {
    console.error('[klaviyo] trackStartedCheckout threw:', err);
  }
}

/** Order status → Klaviyo metric. Statuses not listed send nothing. */
export const ORDER_STATUS_METRICS: Record<string, string> = {
  confirmed: 'Confirmed Order',
  shipped: 'Fulfilled Order',
  delivered: 'Delivered Order',
  cancelled: 'Cancelled Order',
  refunded: 'Refunded Order',
};

export interface KlaviyoStatusInput {
  /** Order or invoice id — part of the dedupe key. */
  id: string;
  status: string;
  email: string | null | undefined;
  name?: string | null;
  orderNumber?: string | null;
  total?: number | null;
  currency?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  carrier?: string | null;
  itemNames?: string[];
}

/**
 * One lifecycle event for an order that changed status. Keyed on
 * id + metric, so the same transition reported twice is sent once.
 */
export async function trackOrderStatus(
  db: SupabaseClient,
  input: KlaviyoStatusInput,
  settings?: KlaviyoSettings,
): Promise<void> {
  try {
    const metric = ORDER_STATUS_METRICS[input.status];
    if (!metric || !isValidEmail(input.email)) return;
    const s = await settingsFor(db, settings);
    if (!s) return;
    const { first, last } = splitName(input.name);
    await send(s, {
      metric,
      profile: { email: input.email, first_name: first, last_name: last },
      value: input.total ?? null,
      currency: input.currency ?? 'CAD',
      uniqueId: `${input.id}:${metric}`,
      properties: {
        OrderId: input.orderNumber || input.id,
        OrderNumber: input.orderNumber ?? null,
        Status: input.status,
        TrackingNumber: input.trackingNumber ?? null,
        TrackingURL: input.trackingUrl ?? null,
        Carrier: input.carrier ?? null,
        ItemNames: input.itemNames ?? [],
      },
    });
  } catch (err) {
    console.error('[klaviyo] trackOrderStatus threw:', err);
  }
}

/**
 * Load a storefront order (`orders` table) and send its status event.
 * For callers that only hold the id — the admin status editor, refunds,
 * the Easyship webhook.
 */
export async function trackOrderStatusById(
  db: SupabaseClient,
  orderId: string,
  status: string,
): Promise<void> {
  try {
    if (!ORDER_STATUS_METRICS[status]) return;
    const s = await settingsFor(db);
    if (!s) return;
    const { data: o } = await db
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();
    if (!o) return;
    const addr = (o.shipping_address ?? {}) as Record<string, any>;
    const name =
      [addr.firstName, addr.lastName].filter(Boolean).join(' ') || addr.name || null;
    await trackOrderStatus(
      db,
      {
        id: o.id,
        status,
        email: o.email,
        name,
        orderNumber: o.order_number ?? null,
        total: o.total != null ? Number(o.total) : null,
        currency: 'CAD',
        trackingNumber: o.tracking_number ?? null,
        trackingUrl: o.tracking_url ?? null,
        carrier: o.carrier ?? o.shipping_carrier ?? null,
        itemNames: Array.isArray(o.items)
          ? o.items.map((i: any) => String(i?.name ?? '')).filter(Boolean)
          : [],
      },
      s,
    );
  } catch (err) {
    console.error('[klaviyo] trackOrderStatusById threw:', err);
  }
}

export interface KlaviyoSignupInput {
  customerId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  /** The marketing-consent checkbox on the signup form. */
  contactConsent: boolean;
}

/**
 * A new account: upsert the profile, record "Created Account", and — only if
 * they ticked the consent box — subscribe them to the configured list.
 */
export async function syncNewCustomer(
  db: SupabaseClient,
  c: KlaviyoSignupInput,
): Promise<void> {
  try {
    const s = await readKlaviyoSettings(db);
    if (!s.enabled || !s.syncSignups || !s.privateKey || !isValidEmail(c.email)) return;

    const profile: KlaviyoProfileInput = {
      email: c.email,
      first_name: c.firstName,
      last_name: c.lastName,
      phone_number: c.phone,
      external_id: c.customerId,
      properties: { 'Accepts Marketing': c.contactConsent, 'Account Source': 'Storefront signup' },
    };

    try {
      await upsertKlaviyoProfile(s.privateKey, profile);
    } catch (err: any) {
      console.error('[klaviyo] profile upsert failed:', err?.message ?? err);
    }

    await send(s, {
      metric: 'Created Account',
      profile,
      uniqueId: `signup:${c.customerId}`,
      properties: { AcceptsMarketing: c.contactConsent },
    });

    if (c.contactConsent && s.listId) {
      try {
        await subscribeToKlaviyoList(s.privateKey, s.listId, [profile], 'Storefront signup');
      } catch (err: any) {
        console.error('[klaviyo] list subscribe failed:', err?.message ?? err);
      }
    }
  } catch (err) {
    console.error('[klaviyo] syncNewCustomer threw:', err);
  }
}
