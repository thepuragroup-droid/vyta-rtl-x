/**
 * Product-level stock decrement for confirmed/paid orders.
 *
 * Storefront orders carry their line items as JSONB on `orders.items`, so the
 * decrement is done by the `adjust_stock_for_order` RPC (see
 * order-stock-decrement-jsonb-migration.sql) which reads that array, updates
 * `products.stock_quantity`, and records a `product_history` row per product
 * (source `order_confirmed`).
 *
 * The RPC is idempotent via `orders.stock_adjusted`, so this helper is safe to
 * call from every path that can flip an order into `confirmed` (the crypto
 * blockchain check, the payment cron, the MetaCortex webhook, and the admin
 * order-status change). Best-effort: it never throws, mirroring the
 * invoice-paid stock path — stock accounting must never break payment
 * confirmation.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkLowStockForProducts } from '@/lib/admin/low-stock';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function adjustStockForConfirmedOrder(
  db: SupabaseClient,
  orderId: string,
  actorEmail: string | null = null,
): Promise<void> {
  try {
    // Cheap short-circuit for the common re-poll case (the cron and the
    // check-payment endpoint may hit an order many times). The RPC's own
    // FOR UPDATE guard is what actually guarantees exactly-once — this only
    // avoids re-running the low-stock query on every poll.
    const { data: order } = await db
      .from('orders')
      .select('stock_adjusted, items')
      .eq('id', orderId)
      .maybeSingle();
    if (!order || order.stock_adjusted) return;

    const { error } = await db.rpc('adjust_stock_for_order', {
      p_order_id: orderId,
      p_actor_email: actorEmail,
    });
    if (error) {
      console.error('adjust_stock_for_order failed:', error);
      return;
    }

    const items = Array.isArray(order.items)
      ? (order.items as Array<{ id?: string }>)
      : [];
    const productIds = items
      .map((it) => it?.id)
      .filter((id): id is string => typeof id === 'string' && UUID_RE.test(id));
    if (productIds.length) await checkLowStockForProducts(db, productIds);
  } catch (err) {
    console.error('adjustStockForConfirmedOrder threw:', err);
  }
}

/**
 * Inverse of {@link adjustStockForConfirmedOrder}: give product-level stock
 * back when a previously-confirmed storefront order is cancelled/refunded.
 *
 * Reads the same `orders.items` JSONB, increments `products.stock_quantity`
 * via the `restore_stock_for_order` RPC (see fulfillment-ux-audit-migration.sql),
 * records a `product_history` row (source `order_cancelled`), and clears
 * `orders.stock_adjusted` so the order can be re-confirmed cleanly. The RPC is
 * guarded by `stock_adjusted` so this only restores stock that was actually
 * decremented, and is safe to call more than once. Best-effort: never throws.
 */
export async function restoreStockForCancelledOrder(
  db: SupabaseClient,
  orderId: string,
  actorEmail: string | null = null,
): Promise<void> {
  try {
    const { data: order } = await db
      .from('orders')
      .select('stock_adjusted, items')
      .eq('id', orderId)
      .maybeSingle();
    // Nothing was decremented → nothing to restore.
    if (!order || order.stock_adjusted !== true) return;

    const { error } = await db.rpc('restore_stock_for_order', {
      p_order_id: orderId,
      p_actor_email: actorEmail,
    });
    if (error) {
      console.error('restore_stock_for_order failed:', error);
      return;
    }

    const items = Array.isArray(order.items)
      ? (order.items as Array<{ id?: string }>)
      : [];
    const productIds = items
      .map((it) => it?.id)
      .filter((id): id is string => typeof id === 'string' && UUID_RE.test(id));
    if (productIds.length) await checkLowStockForProducts(db, productIds);
  } catch (err) {
    console.error('restoreStockForCancelledOrder threw:', err);
  }
}
