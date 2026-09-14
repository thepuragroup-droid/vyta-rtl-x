/**
 * Has this customer already used their welcome discount?
 *
 * The paid-ads offer (lib/promos/ad-discount.ts) is a WELCOME discount: it
 * applies to a buyer's first order and not to the ones after it. That makes
 * "is this their first order?" a money decision, so it is answered here, once,
 * server-side — and both the storefront (`/api/promos/first-order`, read by
 * `PromosContext`) and the hand-off itself (`/api/checkout/puramass`) call this
 * same function. The strip under the nav bar and the prices actually charged
 * therefore cannot drift into disagreeing about who is still a first-time buyer.
 *
 * ## What counts as having ordered
 *
 * Two records, because the store has two checkouts and a buyer may have used
 * either:
 *
 *   • `customers.has_completed_first_order` — flipped when a LEGACY order is
 *     paid or confirmed (`/api/orders/check-payment`, the admin status route).
 *     The hosted checkout never writes it, so it alone is not enough.
 *   • a row in `puramass_orders` for this customer in a status that consumes
 *     the offer — see below. This is what covers the hosted checkout, whose
 *     ledger row IS the record of the order.
 *
 * ## Why a pending hand-off consumes it
 *
 * `payment_pending` counts, not just `paid`. The discount is applied at
 * hand-off — before anything is paid — so counting only `paid` would let
 * someone hand off ten discounted checkouts before settling any of them and
 * pay 25% under list on all ten. Counting the pending row closes that.
 *
 * It is not a one-way door: an unpaid hand-off becomes `expired` (or
 * `cancelled`) once `lib/payments/puramass-poll.ts` catches up with it, and
 * those statuses are NOT in the list — so a buyer who simply abandoned a
 * checkout gets their welcome offer back rather than losing it to a link they
 * never used.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Hosted-order statuses that use up the welcome discount.
 *
 * `expired` and `cancelled` are deliberately absent: an abandoned checkout is
 * not an order, and the offer returns when the link dies.
 */
export const WELCOME_DISCOUNT_CONSUMING_STATUSES = [
  'paid',
  'payment_pending',
] as const;

/**
 * True when `customerId` has not ordered yet and so still has the welcome
 * discount available.
 *
 * Fails CLOSED: a signed-out visitor, or a read that errors, returns false.
 * This gates money, and the rest of the promo does the same (see
 * `DEFAULT_AD_DISCOUNT`) — an install that cannot answer the question should
 * discount nothing rather than discount every order of every repeat buyer.
 */
export async function isCustomerFirstOrder(
  db: SupabaseClient<any, any, any>,
  customerId: string | null | undefined,
): Promise<boolean> {
  if (!customerId) return false;

  // 1. The legacy flag — set once a non-hosted order is paid or confirmed.
  try {
    const { data, error } = await db
      .from('customers')
      .select('has_completed_first_order')
      .eq('id', customerId)
      .maybeSingle();
    if (error) return false;
    if (data?.has_completed_first_order) return false;
  } catch {
    return false;
  }

  // 2. A hosted hand-off that is paid, or still live and awaiting payment.
  try {
    const { count, error } = await db
      .from('puramass_orders')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .in('status', [...WELCOME_DISCOUNT_CONSUMING_STATUSES]);
    if (error) return false;
    if ((count ?? 0) > 0) return false;
  } catch {
    return false;
  }

  return true;
}
