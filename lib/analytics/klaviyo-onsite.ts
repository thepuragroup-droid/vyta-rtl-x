'use client';

/**
 * Browser-side Klaviyo (klaviyo.js) events.
 *
 * klaviyo.js reads its command queue from `window._klOnsite`, so commands can
 * be pushed before the script has loaded and are replayed once it does. This
 * module adds the same pending/on/off gate the GA4 helpers use: SiteTracking
 * switches it on once the visitor has consented (or consent isn't required)
 * and a Site ID is configured, and off otherwise — in which case anything
 * buffered is dropped and never reaches the queue.
 *
 * The GA4 e-commerce helpers in ./ecommerce forward to `forwardEcommerceToKlaviyo`,
 * so every storefront call site that already reports to GA4 reports to
 * Klaviyo too, under Klaviyo's own metric names.
 */

declare global {
  interface Window {
    _klOnsite?: unknown[][];
  }
}

type Mode = 'pending' | 'on' | 'off';

let mode: Mode = 'pending';
let buffered: unknown[][] = [];
const MAX_BUFFERED = 20;

export function setKlaviyoOnsiteMode(next: Mode): void {
  mode = next;
  if (next === 'pending') return;
  const queued = buffered;
  buffered = [];
  if (next === 'off') return;
  for (const cmd of queued) enqueue(cmd);
}

function enqueue(cmd: unknown[]): void {
  if (typeof window === 'undefined') return;
  window._klOnsite = window._klOnsite || [];
  window._klOnsite.push(cmd);
}

function push(cmd: unknown[]): void {
  if (typeof window === 'undefined' || mode === 'off') return;
  if (mode === 'pending') {
    if (buffered.length < MAX_BUFFERED) buffered.push(cmd);
    return;
  }
  enqueue(cmd);
}

export function klaviyoTrack(metric: string, properties: Record<string, unknown>): void {
  push(['track', metric, properties]);
}

/** Tie this browser to a known person, so onsite events land on their profile. */
export function klaviyoIdentify(profile: {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
}): void {
  const clean: Record<string, string> = { email: profile.email.trim().toLowerCase() };
  if (profile.first_name) clean.first_name = profile.first_name;
  if (profile.last_name) clean.last_name = profile.last_name;
  push(['identify', clean]);
}

interface GaItem {
  item_id: string;
  item_name: string;
  item_variant?: string;
  item_category?: string;
  price?: number;
  quantity?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Map a GA4 e-commerce event onto Klaviyo's onsite metrics.
 *
 * `begin_checkout` and `purchase` are deliberately NOT forwarded: "Started
 * Checkout" and "Placed Order" are sent from the server, where the buyer's
 * email is certain and the event carries a dedupe key. Sending them here too
 * would enter buyers into the abandoned-checkout flow twice.
 */
export function forwardEcommerceToKlaviyo(name: string, params: Record<string, any>): void {
  const items: GaItem[] = Array.isArray(params?.items) ? params.items : [];
  const item = items[0];
  const url = typeof window !== 'undefined' ? window.location.href : undefined;

  if (name === 'view_item' && item) {
    const props = {
      ProductName: item.item_name,
      ProductID: item.item_id,
      Variant: item.item_variant ?? null,
      Categories: item.item_category ? [item.item_category] : [],
      Price: item.price != null ? round2(item.price) : null,
      URL: url,
      Currency: params.currency ?? 'CAD',
    };
    klaviyoTrack('Viewed Product', props);
    // Feeds "recently viewed" blocks in Klaviyo forms and emails.
    push([
      'trackViewedItem',
      {
        Title: item.item_name,
        ItemId: item.item_id,
        Categories: props.Categories,
        Url: url,
        Metadata: { Price: props.Price },
      },
    ]);
    return;
  }

  if (name === 'add_to_cart' && item) {
    klaviyoTrack('Added to Cart', {
      $value: typeof params.value === 'number' ? round2(params.value) : null,
      AddedItemProductName: item.item_name,
      AddedItemProductID: item.item_id,
      AddedItemVariant: item.item_variant ?? null,
      AddedItemCategories: item.item_category ? [item.item_category] : [],
      AddedItemPrice: item.price != null ? round2(item.price) : null,
      AddedItemQuantity: item.quantity ?? 1,
      CheckoutURL: typeof window !== 'undefined' ? `${window.location.origin}/cart` : undefined,
      Currency: params.currency ?? 'CAD',
    });
    return;
  }

  if (name === 'view_cart' && items.length > 0) {
    klaviyoTrack('Viewed Cart', {
      $value: typeof params.value === 'number' ? round2(params.value) : null,
      ItemNames: items.map((i) => i.item_name),
      Items: items.map((i) => ({
        ProductID: i.item_id,
        ProductName: i.item_name,
        Variant: i.item_variant ?? null,
        Quantity: i.quantity ?? 1,
        ItemPrice: i.price != null ? round2(i.price) : null,
      })),
      Currency: params.currency ?? 'CAD',
    });
  }
}
