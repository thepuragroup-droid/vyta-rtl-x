/**
 * Choosing a courier for a shipment nobody picked a service for.
 *
 * Pure (no Easyship client, no Supabase) so the ranking can be unit-tested and
 * shared. The caller has already narrowed the quote to the allowed couriers.
 */

export type CourierPreference = 'cheapest' | 'fastest' | 'ups' | 'fedex';

export const COURIER_PREFERENCES: readonly CourierPreference[] = [
  'cheapest',
  'fastest',
  'ups',
  'fedex',
];

export interface PickableRate {
  courier_id: string;
  courier_name: string;
  total_charge: number;
  min_delivery_time?: number | null;
  max_delivery_time?: number | null;
}

/**
 * Transit time used to rank a rate. The worst case (max) leads so a "1–7 day"
 * service doesn't beat a flat "2 day" one; an unknown estimate sorts last
 * rather than first.
 */
export function deliveryDays(rate: PickableRate): number {
  const max = Number(rate.max_delivery_time) || 0;
  const min = Number(rate.min_delivery_time) || 0;
  return max > 0 ? max : min > 0 ? min : Number.POSITIVE_INFINITY;
}

const byPrice = (a: PickableRate, b: PickableRate) =>
  (Number(a.total_charge) || 0) - (Number(b.total_charge) || 0);

// Fastest first; the cheaper of two equally quick services wins.
const bySpeed = (a: PickableRate, b: PickableRate) =>
  deliveryDays(a) - deliveryDays(b) || byPrice(a, b);

/**
 * Pick one rate by preference. `ups` / `fedex` take that carrier's cheapest
 * service, falling back to the overall cheapest when it isn't on offer.
 * Never mutates `rates`.
 */
export function pickCourier<T extends PickableRate>(
  rates: readonly T[],
  pref: CourierPreference,
): T | null {
  if (rates.length === 0) return null;
  if (pref === 'fastest') return [...rates].sort(bySpeed)[0] ?? null;
  const cheapest = [...rates].sort(byPrice);
  if (pref === 'cheapest') return cheapest[0] ?? null;
  const re = new RegExp(`\\b${pref}\\b`, 'i');
  return cheapest.find((r) => re.test(r.courier_name || '')) ?? cheapest[0] ?? null;
}
