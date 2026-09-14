import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  verifyWarehouse,
  buildQueueRow,
  attachPuramassShipTo,
} from '@/lib/warehouse/server';
import type { FulfillmentStatus, QueueSummary } from '@/lib/warehouse/types';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// GET /api/warehouse/queue
export async function GET(req: NextRequest) {
  const auth = await verifyWarehouse(db, req);
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const url = new URL(req.url);
  const fStatus = url.searchParams.get('fulfillment_status') as FulfillmentStatus | null;
  const fType = url.searchParams.get('fulfillment_type');
  const labelState = url.searchParams.get('label_state');

  let q = db
    .from('invoices')
    .select(
      `*,
       packed_by_customer:customers!invoices_packed_by_fkey(first_name, last_name, email),
       fulfilled_by_customer:customers!invoices_fulfilled_by_fkey(first_name, last_name, email),
       order:orders(id, order_number, status, tracking_number, carrier, label_state, label_url, shipping_address),
       invoice_line_items(id, description, qty, qty_fulfilled, qty_backordered, unit_price, line_total)`,
    )
    // Drafts are included so freshly generated invoices reach the warehouse,
    // but backorder placeholder invoices (always non-payable drafts) are not
    // fulfillable and stay on the backorders worklist. `not.is.true` keeps
    // rows where is_backorder is false OR null (legacy rows).
    .not('is_backorder', 'is', true)
    .order('created_at', { ascending: false });

  if (fStatus) q = q.eq('fulfillment_status', fStatus);
  if (fType) q = q.eq('fulfillment_type', fType);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let items = await Promise.all((data ?? []).map(buildQueueRow));

  // Stealth Health invoices have no order behind them — their ship-to comes
  // from the PuraMass hand-off ledger.
  items = await attachPuramassShipTo(db, items);

  if (labelState) {
    // Either anchor counts — an invoice with no order carries its own label.
    items = items.filter(
      (it) =>
        it.order?.label_state === labelState ||
        it.shipment?.label_state === labelState,
    );
  }

  const summary: QueueSummary = items.reduce<QueueSummary>(
    (s, it) => {
      // Items removed from the queue are hidden from the working counts.
      if (it.removed_from_queue) return s;
      if (it.fulfillment_status === 'pending') s.toFulfill++;
      if (it.fulfillment_status === 'packed') {
        s.toFulfill++;
        s.packed++;
      }
      if (it.fulfillment_status === 'shipped') s.shipped++;
      if (it.fulfillment_status === 'picked_up') s.pickedUp++;
      if (it.fulfillment_type === 'shipment') s.shipments++;
      if (it.fulfillment_type === 'pickup') s.pickups++;
      return s;
    },
    { toFulfill: 0, packed: 0, shipped: 0, pickedUp: 0, shipments: 0, pickups: 0 },
  );

  return NextResponse.json({
    items,
    summary,
    viewer: { role: auth.role, can_send_emails: auth.canSendEmails },
  });
}
