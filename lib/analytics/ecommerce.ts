'use client';

/**
 * GA4 e-commerce tracking.
 *
 * This storefront is Next.js, not WordPress, so there is no "Google Analytics
 * for WooCommerce" plugin to install — this module is its replacement. It
 * emits the same GA4 recommended e-commerce events that plugin does
 * (view_item / add_to_cart / remove_from_cart / view_cart / begin_checkout /
 * purchase) from the storefront's own cart and checkout code.
 *
 * Delivery targets, decided by `setAnalyticsMode` in SiteTracking:
 *   • 'gtag' — call `gtag('event', ...)`, which is what reaches GA4. GA4 is
 *              loaded directly in <head>, not as a tag inside GTM.
 *   • 'gtm'  — push onto `dataLayer` so container triggers (Ads conversions,
 *              remarketing) can act on the same events.
 *   • 'both' — the normal configuration: GA4 gets the event via gtag, and the
 *              container sees it on the data layer. This does NOT double-count,
 *              because a dataLayer push alone sends nothing to GA4 — only a
 *              gtag() call does. It would only double if a GA4 tag were also
 *              configured inside the container, which is why we don't.
 *
 * Until SiteTracking hydrates and reads the config, the mode is 'pending' and
 * events are buffered, so a `view_item` fired during the first render of a
 * product page is not lost. 'off' (no tags configured) drops everything, buffer
 * included. Consent is NOT gated here — gtag and the container both enforce the
 * Consent Mode signals themselves, and suppressing events would also deny GA4
 * the cookieless pings Consent Mode is designed to keep collecting.
 */

import { forwardEcommerceToKlaviyo } from './klaviyo-onsite';

export type AnalyticsMode = 'pending' | 'gtm' | 'gtag' | 'both' | 'off';

/** GA4 `items[]` entry. Field names are GA4's, not the cart's. */
export interface AnalyticsItem {
  item_id: string;
  item_name: string;
  /** Vial vs. case — GA4's variant slot, so the two price points stay split. */
  item_variant?: string;
  item_category?: string;
  price?: number;
  quantity?: number;
}

/** Storefront prices are quoted in CAD (see lib/currency.ts). */
const CURRENCY = 'CAD';

/** Bounded so a misconfigured deployment can't grow the buffer forever. */
const MAX_BUFFERED = 20;

let mode: AnalyticsMode = 'pending';
let buffered: Array<{ name: string; params: Record<string, any> }> = [];

/**
 * Set by SiteTracking once the config and the consent decision are known.
 * Flushes anything buffered while the mode was still 'pending'.
 */
export function setAnalyticsMode(next: AnalyticsMode): void {
  mode = next;
  if (next === 'pending') return;
  const queued = buffered;
  buffered = [];
  if (next === 'off') return;
  for (const ev of queued) dispatch(ev.name, ev.params);
}

function dispatch(name: string, params: Record<string, any>): void {
  if (typeof window === 'undefined') return;
  if (mode === 'gtm' || mode === 'both') {
    window.dataLayer = window.dataLayer || [];
    // Clear the previous event's `ecommerce` object first — GTM's data layer
    // is a merge, so without this the last event's items leak into this one.
    window.dataLayer.push({ ecommerce: null });
    window.dataLayer.push({ event: name, ecommerce: params });
  }
  if ((mode === 'gtag' || mode === 'both') && typeof window.gtag === 'function') {
    window.gtag('event', name, params);
  }
}

/** Fire an e-commerce event, or buffer it while consent is still pending. */
function track(name: string, params: Record<string, any>): void {
  if (typeof window === 'undefined') return;
  // Klaviyo has its own consent/config gate (see ./klaviyo-onsite), so it is
  // forwarded even when no Google tag is configured.
  forwardEcommerceToKlaviyo(name, params);
  if (mode === 'off') return;
  if (mode === 'pending') {
    if (buffered.length < MAX_BUFFERED) buffered.push({ name, params });
    return;
  }
  dispatch(name, params);
}

/** Sum of price × quantity, rounded to cents — GA4's `value`. */
function totalValue(items: AnalyticsItem[]): number {
  const sum = items.reduce((acc, i) => acc + (i.price ?? 0) * (i.quantity ?? 1), 0);
  return Math.round(sum * 100) / 100;
}

export function trackViewItem(item: AnalyticsItem): void {
  track('view_item', { currency: CURRENCY, value: totalValue([item]), items: [item] });
}

export function trackAddToCart(item: AnalyticsItem): void {
  track('add_to_cart', { currency: CURRENCY, value: totalValue([item]), items: [item] });
}

export function trackRemoveFromCart(item: AnalyticsItem): void {
  track('remove_from_cart', { currency: CURRENCY, value: totalValue([item]), items: [item] });
}

export function trackViewCart(items: AnalyticsItem[]): void {
  if (items.length === 0) return;
  track('view_cart', { currency: CURRENCY, value: totalValue(items), items });
}

export function trackBeginCheckout(items: AnalyticsItem[]): void {
  if (items.length === 0) return;
  track('begin_checkout', { currency: CURRENCY, value: totalValue(items), items });
}

/**
 * `purchase` — the one event GA4 attributes revenue from. `value` is the order
 * total the server priced, not the cart subtotal, so refunds/discounts and the
 * shipping the buyer actually pays are reflected.
 */
export function trackPurchase(input: {
  transactionId: string;
  value: number;
  shipping?: number;
  discount?: number;
  items: AnalyticsItem[];
}): void {
  track('purchase', {
    transaction_id: input.transactionId,
    currency: CURRENCY,
    value: Math.round(input.value * 100) / 100,
    ...(input.shipping !== undefined ? { shipping: Math.round(input.shipping * 100) / 100 } : {}),
    ...(input.discount !== undefined ? { discount: Math.round(input.discount * 100) / 100 } : {}),
    items: input.items,
  });
}
