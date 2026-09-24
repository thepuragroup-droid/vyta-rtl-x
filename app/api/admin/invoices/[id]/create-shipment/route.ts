import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getInvoiceCaller, callerCanWrite } from '@/lib/admin/invoice-access';
import { logAuditServer } from '@/lib/admin/audit';
import type { EasyshipHandover } from '@/lib/types/ecommerce';
import {
  autoCreateShipmentForInvoice,
  normalizeCourierPreference,
} from '@/lib/shipping/auto-shipment';
import { isMissingColumnError } from '@/lib/payments/puramass-columns';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * POST /api/admin/invoices/[id]/create-shipment — manual Easyship shipment
 * for an invoice, whether or not it has an order behind it.
 *
 * The order-side twin (`/api/admin/orders/[id]/create-shipment`) can only ship
 * an invoice that is bound to an order, which leaves every Stealth Health /
 * Stealth Health hand-off unshippable — those are materialised straight into
 * `invoices` and keep their address on the hand-off ledger. This route routes
 * itself: order-bound invoices still ship off the order row, the rest anchor
 * the shipment on the invoice.
 *
 * force=true inside the helper, so the site-wide auto-create toggle is
 * bypassed — an admin asking for a shipment here means it.
 *
 * Body (all optional): { courier_service_id, courier_preference,
 *                        insured, handover, buy_label }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const caller = await getInvoiceCaller(db, req);
  if (!caller.ok || !callerCanWrite(caller.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* no body — stored/preferred courier, drop-off, no insurance */
  }

  const { data: invoice } = await db
    .from('invoices')
    .select('id, order_id, fulfillment_type')
    .eq('id', params.id)
    .maybeSingle();
  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }
  if (invoice.fulfillment_type === 'pickup') {
    return NextResponse.json(
      { error: 'Pickup invoices are not shipped' },
      { status: 400 },
    );
  }

  await autoCreateShipmentForInvoice(db, params.id, true, {
    courierIdOverride: body?.courier_service_id
      ? String(body.courier_service_id)
      : undefined,
    courierPreference: normalizeCourierPreference(body?.courier_preference),
    insured: !!body?.insured,
    handover: (body?.handover as EasyshipHandover | undefined) ?? undefined,
    buyLabel: !!body?.buy_label,
  });

  await logAuditServer(db, caller, {
    action: 'invoice.create_shipment',
    entity_type: 'invoice',
    entity_id: params.id,
  });

  // Report where the shipment actually landed — the invoice, or the order it
  // was routed to — so the caller can show the outcome (or the failure reason)
  // without a second round-trip.
  const SHIPMENT_COLS =
    'id, easyship_shipment_id, label_state, label_url, tracking_number, carrier, auto_shipment_status, auto_shipment_error';

  if (invoice.order_id) {
    const { data: order } = await db
      .from('orders')
      .select(SHIPMENT_COLS)
      .eq('id', invoice.order_id)
      .maybeSingle();
    return NextResponse.json({ anchor: 'order', shipment: order ?? null });
  }

  const refreshed = await db
    .from('invoices')
    .select(SHIPMENT_COLS)
    .eq('id', params.id)
    .maybeSingle();
  if (refreshed.error && isMissingColumnError(refreshed.error)) {
    // easyship-invoice-shipment-migration.sql hasn't run, so the shipment had
    // nowhere to be written. Say that plainly rather than reporting silence.
    return NextResponse.json(
      {
        error:
          'Invoice shipment columns are missing — run easyship-invoice-shipment-migration.sql.',
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ anchor: 'invoice', shipment: refreshed.data ?? null });
}
