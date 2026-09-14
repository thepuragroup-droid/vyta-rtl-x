/**
 * Hosted-checkout shipping settings, read once and shared by everything that
 * needs to agree on them: the quote endpoint, the hand-off route, and the
 * public settings the storefront reads to draw the free-shipping progress bar.
 *
 * Read with `select('*')` and defensive defaults for the same reason
 * `getShippingConfig` does it: these columns arrive with
 * puramass-hosted-shipping-migration.sql, and naming a column PostgREST hasn't
 * seen yet fails the WHOLE query. Between a deploy and that migration — and
 * during the window after it while PostgREST serves a stale schema cache — that
 * would read as "shipping is broken" rather than "this isn't switched on yet".
 *
 * The safe defaults are the behaviour the hosted checkout had before any of
 * this existed: no courier picker, no promo, one flat fee.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** The flat fee before it was configurable — and the default if it is unset. */
export const DEFAULT_FLAT_SHIPPING = 35;

export interface HostedShippingSettings {
  /** Buyer picks a live courier rate rather than paying the flat fee. */
  ratesEnabled: boolean;
  /** Flat fee in CAD, charged when rates are off or a quote can't be had. */
  flatShipping: number;
  /** Free shipping once the goods subtotal reaches `freeShippingThreshold`. */
  freeShippingEnabled: boolean;
  /** Goods subtotal in CAD that unlocks it. */
  freeShippingThreshold: number;
}

export const DEFAULT_HOSTED_SHIPPING: HostedShippingSettings = {
  ratesEnabled: false,
  flatShipping: DEFAULT_FLAT_SHIPPING,
  freeShippingEnabled: false,
  freeShippingThreshold: 0,
};

function positive(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Normalise a raw `site_settings` row.
 *
 * The promo is forced off unless live rates are on and a real threshold is
 * set — with the flat fee there is no address, no courier and no quote for the
 * promo to zero out. Enforcing that here rather than at each call site means a
 * stale `puramass_free_shipping_enabled = true` left over from an earlier
 * configuration can never quietly hand out free shipping.
 */
export function shapeHostedShippingSettings(
  data: Record<string, any> | null | undefined,
): HostedShippingSettings {
  const d = data ?? {};
  const ratesEnabled = !!d.puramass_shipping_rates_enabled;
  const threshold = positive(d.puramass_free_shipping_threshold, 0);
  return {
    ratesEnabled,
    flatShipping: positive(d.puramass_flat_shipping, DEFAULT_FLAT_SHIPPING),
    freeShippingEnabled:
      ratesEnabled && !!d.puramass_free_shipping_enabled && threshold > 0,
    freeShippingThreshold: threshold,
  };
}

/** True when `subtotal` (goods only, CAD) earns free shipping. */
export function qualifiesForFreeShipping(
  settings: HostedShippingSettings,
  subtotal: number,
): boolean {
  if (!settings.freeShippingEnabled) return false;
  const amount = Number(subtotal);
  return Number.isFinite(amount) && amount >= settings.freeShippingThreshold;
}

export async function getHostedShippingSettings(
  db: SupabaseClient,
): Promise<HostedShippingSettings> {
  try {
    const { data, error } = await db
      .from('site_settings')
      .select('*')
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('[puramass] shipping settings read failed:', error.message);
      return DEFAULT_HOSTED_SHIPPING;
    }
    return shapeHostedShippingSettings(data);
  } catch (err: any) {
    console.error('[puramass] shipping settings read threw:', err?.message ?? err);
    return DEFAULT_HOSTED_SHIPPING;
  }
}
