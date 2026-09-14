import { supabase } from '@/lib/supabase';

export type ActivityEvent =
  | { type: 'search'; searchQuery: string }
  | { type: 'view'; productId?: string | null; productName: string }
  | { type: 'cart'; productId?: string | null; productName: string; quantity?: number }
  | { type: 'page'; pagePath: string; pageTitle?: string | null; referrer?: string | null }
  | { type: 'click'; metadata: TrackMetadata }
  | { type: 'lab_result'; productId?: string | null; productName?: string | null; metadata: TrackMetadata }
  | { type: 'checkout_start'; metadata: TrackMetadata }
  | { type: 'signup'; metadata?: TrackMetadata }
  | { type: 'purchase'; metadata?: TrackMetadata };

/** Shallow, primitive-valued detail. The API caps keys, types and length. */
export type TrackMetadata = Record<string, string | number | boolean>;

/**
 * A product view is recorded from two places — the product page on load and
 * the vial/pack picker on open — so opening the picker straight off the
 * product page would log the same product twice for one look. Views of the
 * same product inside this window collapse into the first one; anything later
 * is a genuine return visit and is recorded.
 */
const VIEW_DEDUPE_MS = 30_000;

/** productId (or name, when the id is absent) -> when its view was last sent. */
const lastViewAt = new Map<string, number>();

/** True when this product's view was already recorded moments ago. */
function isDuplicateView(event: ActivityEvent): boolean {
  if (event.type !== 'view') return false;
  const key = String(event.productId || event.productName || '');
  if (!key) return false;
  const now = Date.now();
  const previous = lastViewAt.get(key);
  if (previous != null && now - previous < VIEW_DEDUPE_MS) return true;
  lastViewAt.set(key, now);
  return false;
}

/**
 * Record a storefront interaction.
 *
 * Anonymous visitors are tracked as well as signed-in ones: the API identifies
 * them from the `aminocan_vid` cookie the middleware mints, and their history
 * is adopted by the account they later create. That is what makes it possible
 * to say a Google Ads visitor browsed four products before registering —
 * previously nothing before signup was recorded at all.
 *
 * Whether an anonymous visitor is actually stored is the API's decision, not
 * this function's: it checks the consent cookie against the site's banner
 * setting. Sending an event that is then dropped is the intended shape — the
 * client should not have to know the consent rules.
 *
 * Best-effort and fire-and-forget: it never throws, so it can be dropped into
 * any handler without a try/catch.
 */
export async function trackActivity(event: ActivityEvent): Promise<void> {
  try {
    if (typeof window === 'undefined') return;
    if (isDuplicateView(event)) return;

    // A token, when there is one, names the customer. Without it the cookie
    // carries the visitor id — so an anonymous event is still worth sending.
    let token: string | undefined;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      token = session?.access_token;
    } catch {
      /* auth unavailable — carry on anonymously */
    }

    await fetch('/api/customer/activity', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      // Same-origin, so the visitor cookies ride along automatically.
      credentials: 'same-origin',
      body: JSON.stringify(event),
      keepalive: true,
    });
  } catch {
    /* tracking must never affect the browsing experience */
  }
}

/**
 * Hand the visitor's anonymous history to the account they just signed in to
 * or created. Backfills the event rows, links the attribution row, and stamps
 * the acquisition channel onto the customer.
 *
 * Safe to call on every sign-in — the API is idempotent.
 */
export async function identifyVisitor(): Promise<void> {
  try {
    if (typeof window === 'undefined') return;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;

    await fetch('/api/customer/activity/identify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'same-origin',
      keepalive: true,
    });
  } catch {
    /* best-effort */
  }
}
