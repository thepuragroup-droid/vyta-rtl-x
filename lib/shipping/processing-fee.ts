/**
 * The processing fee folded into a quoted shipping price.
 *
 * Configured in Site Settings ("Processing fee") as either a fixed CAD amount
 * or a percentage of the live carrier rate, and defaulting to zero. It covers
 * packing and the manual labour around a shipment, so it is baked into the
 * shipping figure the customer is quoted and never shown as a separate line.
 *
 * It lives in its own module — rather than beside the Easyship client that has
 * always applied it — because the hosted checkout needs the same arithmetic and
 * must not drag a server-only module (API keys, Supabase) into the browser
 * bundle. `applyHandlingFee` in lib/easyship.ts delegates here, so there is one
 * definition of what the fee means.
 */

export interface ProcessingFee {
  handlingFeeType: 'flat' | 'pct';
  handlingFeeValue: number;
}

/** Carrier rate plus the configured fee. A zero/absent fee returns `cost`. */
export function applyProcessingFee(cost: number, fee: ProcessingFee): number {
  const value = Number(fee?.handlingFeeValue) || 0;
  if (!value) return cost;
  if (fee.handlingFeeType === 'pct') return cost * (1 + value / 100);
  return cost + value;
}
