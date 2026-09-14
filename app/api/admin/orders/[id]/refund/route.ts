import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { RefundRequest } from '@/lib/types/ecommerce';
import { restoreStockForCancelledOrder } from '@/lib/order-stock';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verifyAdmin(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { ok: false, userId: null as string | null, email: null as string | null };
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { ok: false, userId: null, email: null };
  const { data } = await db.from('customers').select('role, email').eq('id', user.id).single();
  return { ok: data?.role === 'admin', userId: user.id, email: data?.email ?? user.email ?? null };
}

// POST /api/admin/orders/[id]/refund
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { ok, userId, email: actorEmail } = await verifyAdmin(req);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const body: RefundRequest = await req.json();
  const { full_refund, line_items, reason } = body;

  const { data: order, error: orderErr } = await db
    .from('orders')
    .select('id, status')
    .eq('id', params.id)
    .single();

  if (orderErr || !order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  if (!['confirmed', 'processing', 'packed', 'shipped', 'delivered', 'completed'].includes(order.status)) {
    return NextResponse.json(
      { error: `Cannot refund order with status "${order.status}"` },
      { status: 422 }
    );
  }

  let itemsToProcess: typeof line_items = line_items;

  if (full_refund) {
    // Fetch all unrestocked items
    const { data: allItems } = await db
      .from('order_items')
      .select('id, product_variant_id, qty, quantity, restocked')
      .eq('order_id', params.id);

    itemsToProcess = (allItems ?? [])
      .filter((i) => !i.restocked)
      .map((i) => ({
        order_item_id: i.id,
        qty: i.qty ?? i.quantity ?? 1,
        restock: true,
      }));
  }

  const errors: string[] = [];

  for (const li of itemsToProcess) {
    const { data: item, error: itemErr } = await db
      .from('order_items')
      .select('product_variant_id, qty, quantity, restocked')
      .eq('id', li.order_item_id)
      .eq('order_id', params.id)
      .single();

    if (itemErr || !item) {
      errors.push(`Item ${li.order_item_id} not found`);
      continue;
    }

    if (li.restock && item.product_variant_id && !item.restocked) {
      const qty = Math.min(li.qty, item.qty ?? item.quantity ?? 1);

      const { data: variant } = await db
        .from('product_variants')
        .select('qty_on_hand')
        .eq('id', item.product_variant_id)
        .single();

      if (variant) {
        await db
          .from('product_variants')
          .update({ qty_on_hand: variant.qty_on_hand + qty })
          .eq('id', item.product_variant_id);

        await db.from('inventory_log').insert({
          variant_id: item.product_variant_id,
          change_qty: qty,
          reason: 'return',
          reference_id: params.id,
          note: reason ? `Refund: ${reason}` : 'Order refunded',
          created_by: userId,
        });

        await db
          .from('order_items')
          .update({ restocked: true })
          .eq('id', li.order_item_id);
      }
    }
  }

  // Update order status to refunded
  await db
    .from('orders')
    .update({
      status: 'refunded',
      refunded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id);

  // The per-line loop above only restocks the relational `product_variants`
  // ledger, which is empty for storefront (JSONB) orders — so their
  // product-level stock (`products.stock_quantity`) was never given back on a
  // refund. On a FULL refund, restore it via the same guarded RPC the
  // cancel path uses (no-op unless the order had actually been decremented,
  // and partial refunds keep the relational path since the whole-order restore
  // can't express a partial quantity).
  if (full_refund) {
    await restoreStockForCancelledOrder(db, params.id, actorEmail);
  }

  if (errors.length) {
    return NextResponse.json({ success: true, warnings: errors });
  }

  return NextResponse.json({ success: true });
}
