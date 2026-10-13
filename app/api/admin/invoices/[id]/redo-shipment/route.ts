import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getInvoiceCaller, callerCanWrite } from '@/lib/admin/invoice-access';
import { logAuditServer } from '@/lib/admin/audit';
import type { EasyshipHandover } from '@/lib/types/ecommerce';
import { cancelEasyshipShipment, getShippingConfig } from '@/lib/easyship';
import {
  autoCreateShipmentForInvoice,
  normalizeCourierPreference,
} from '@/lib/shipping/auto-shipment';
import {
  clearShipmentRecord,
  resolveInvoiceShipmentAnchor,
} from '@/lib/shipping/shipment-anchor';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * POST /api/admin/invoices/[id]/redo-shipment — rebook an invoice's shipment
 * with a different courier.
 *
 * The courier is baked into an Easyship shipment when it is created, so
 * changing it means a new shipment:
 *
 *  1. cancel the current one in Easyship — for a bought label this is what
 *     refunds it to the wallet;
 *  2. blank the shipment record on the anchor (order or invoice) and its
 *     invoice mirrors;
 *  3. create the new shipment with the chosen courier, optionally buying its
 *     label in the same step.
 *
 * A bought label that Easyship refuses to cancel (usually: already in
 * transit) stops here with 409 and `cancel_failed`, so nobody pays for two
 * labels without meaning to. Resending with `replace_anyway: true` rebooks
 * regardless and leaves the old label to be sorted out in Easyship. A draft
 * shipment has nothing to refund, so its cancel is best-effort.
 *
 * Body: { courier_service_id?, courier_preference?, insured?, handover?,
 *         buy_label?, replace_anyway? }
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
    /* no body — preferred courier, drop-off, no insurance */
  }

  const { data: invoice } = await db
    .from('invoices')
    .select('id, fulfillment_type')
    .eq('id', params.id)
    .maybeSingle();
  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }
  if (invoice.fulfillment_type === 'pickup') {
    return NextResponse.json({ error: 'Pickup invoices are not shipped' }, { status: 400 });
  }

  const resolved = await resolveInvoiceShipmentAnchor(db, params.id);
  if (!resolved?.easyship_shipment_id) {
    return NextResponse.json(
      { error: 'No shipment to redo — create one instead' },
      { status: 400 },
    );
  }

  const cfg = await getShippingConfig(db);
  if (!cfg.enabled || !cfg.apiKey) {
    return NextResponse.json(
      { error: 'Easyship is disabled or missing an API key' },
      { status: 400 },
    );
  }

  const previous = resolved.easyship_shipment_id;
  const hadLabel = resolved.label_state === 'generated' || resolved.label_state === 'pending';

  // 1. Cancel the old shipment, so a bought label is refunded.
  let cancelled = true;
  let cancelError: string | null = null;
  try {
    await cancelEasyshipShipment(previous, cfg.apiKey);
  } catch (e: any) {
    cancelled = false;
    cancelError = e?.message ?? 'Easyship refused to cancel the shipment';
  }
  if (!cancelled && hadLabel && body?.replace_anyway !== true) {
    return NextResponse.json(
      {
        error: `The current label could not be cancelled, so it would not be refunded. ${cancelError}`,
        cancel_failed: true,
      },
      { status: 409 },
    );
  }

  // 2. Blank the old record, courier included, so the new pick is used.
  const clearErr = await clearShipmentRecord(db, resolved);
  if (clearErr) return NextResponse.json({ error: clearErr }, { status: 500 });

  // 3. Book the new shipment.
  await autoCreateShipmentForInvoice(db, params.id, true, {
    courierIdOverride: body?.courier_service_id ? String(body.courier_service_id) : undefined,
    courierPreference: normalizeCourierPreference(body?.courier_preference),
    insured: !!body?.insured,
    handover: (body?.handover as EasyshipHandover | undefined) ?? undefined,
    buyLabel: !!body?.buy_label,
  });

  await logAuditServer(db, caller, {
    action: cancelled ? 'invoice.redo_shipment' : 'invoice.redo_shipment_uncancelled',
    entity_type: 'invoice',
    entity_id: params.id,
  });

  const table = resolved.anchor.kind === 'order' ? 'orders' : 'invoices';
  const { data: shipment } = await db
    .from(table)
    .select(
      'easyship_shipment_id, label_state, label_url, tracking_number, carrier, auto_shipment_status, auto_shipment_error',
    )
    .eq('id', resolved.anchor.id)
    .maybeSingle();

  // Whether the customer already has the old tracking number in their inbox.
  const { data: inv } = await db
    .from('invoices')
    .select('shipped_emailed_at')
    .eq('id', params.id)
    .maybeSingle();

  return NextResponse.json({
    anchor: resolved.anchor.kind,
    previous_shipment_id: previous,
    previous_cancelled: cancelled,
    previous_cancel_error: cancelled ? null : cancelError,
    shipment: shipment ?? null,
    shipped_email_was_sent: !!(inv as any)?.shipped_emailed_at,
  });
}
