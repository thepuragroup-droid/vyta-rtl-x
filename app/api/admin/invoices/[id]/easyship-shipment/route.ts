import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getInvoiceCaller, callerCanWrite } from '@/lib/admin/invoice-access';
import { logAuditServer } from '@/lib/admin/audit';
import {
  getEasyshipShipmentDetails,
  getShippingConfig,
  listEasyshipShipments,
  type EasyshipShipmentDetails,
  type EasyshipShipmentSummary,
} from '@/lib/easyship';
import { onShipmentLabelGenerated } from '@/lib/shipping/label-generated';
import {
  clearShipmentRecord,
  resolveInvoiceShipmentAnchor,
} from '@/lib/shipping/shipment-anchor';
import type { ShipmentAnchor } from '@/lib/shipping/auto-shipment';

/**
 * The shipment override for one invoice: pick ANY Easyship shipment and make
 * it the invoice's shipment record, replacing whatever is set now.
 *
 * For when a parcel had to be redone by hand in the Easyship dashboard (wrong
 * address, cancelled label, re-pack) and the record still points at the old
 * one. The bulk sync dialog only links invoices that have no shipment yet;
 * this is the "I know which one is right" path for a single invoice.
 *
 *   GET  ?days=30           → the shipments to pick from, newest first, each
 *                             with what it is already attached to
 *   POST { easyship_shipment_id, allow_shared? }
 *                           → clear the current record, link the picked one,
 *                             and pull its full record from Easyship
 *
 * The shipment lives on the invoice's order when it has one, on the invoice
 * itself otherwise — the same anchor rule as the tracking route.
 */

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DEFAULT_LOOKBACK_DAYS = 30;
const MAX_LOOKBACK_DAYS = 180;

/** PostgREST puts `in.(...)` in the URL, so keep each lookup well short of it. */
const IN_CHUNK = 200;

interface ShipmentOwner {
  kind: 'order' | 'invoice';
  id: string;
  /** Order number / invoice number — whatever an operator would recognise. */
  label: string | null;
}

/** shipment id → the order or invoice it is attached to (orders win). */
async function loadOwners(ids: string[]): Promise<Record<string, ShipmentOwner>> {
  const owners: Record<string, ShipmentOwner> = {};
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const part = ids.slice(i, i + IN_CHUNK);
    const { data: orders } = await db
      .from('orders')
      .select('id, order_number, easyship_shipment_id')
      .in('easyship_shipment_id', part);
    for (const o of orders ?? []) {
      if (o.easyship_shipment_id) {
        owners[o.easyship_shipment_id] = { kind: 'order', id: o.id, label: o.order_number ?? null };
      }
    }
    // Missing column = easyship-invoice-shipment-migration.sql never ran, so
    // no invoice can hold a shipment of its own.
    const { data: invs, error } = await db
      .from('invoices')
      .select('id, invoice_number, order_id, easyship_shipment_id')
      .in('easyship_shipment_id', part);
    if (error) continue;
    for (const inv of invs ?? []) {
      // An order-backed invoice only mirrors its order's record.
      if (inv.easyship_shipment_id && !inv.order_id && !owners[inv.easyship_shipment_id]) {
        owners[inv.easyship_shipment_id] = {
          kind: 'invoice',
          id: inv.id,
          label: inv.invoice_number ?? null,
        };
      }
    }
  }
  return owners;
}

function isSameAnchor(owner: ShipmentOwner | undefined, anchor: ShipmentAnchor): boolean {
  return !!owner && owner.kind === anchor.kind && owner.id === anchor.id;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const caller = await getInvoiceCaller(db, req);
  if (!caller.ok || !callerCanWrite(caller.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const resolved = await resolveInvoiceShipmentAnchor(db, params.id);
  if (!resolved) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  const rawDays = Number(req.nextUrl.searchParams.get('days') ?? DEFAULT_LOOKBACK_DAYS);
  const days = Math.min(
    MAX_LOOKBACK_DAYS,
    Math.max(1, Number.isFinite(rawDays) ? Math.floor(rawDays) : DEFAULT_LOOKBACK_DAYS),
  );
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  since.setUTCHours(0, 0, 0, 0);

  let shipments: EasyshipShipmentSummary[] = [];
  let easyshipError: string | null = null;
  try {
    const cfg = await getShippingConfig(db);
    shipments = await listEasyshipShipments(since.toISOString(), cfg.apiKey || undefined);
  } catch (e: any) {
    easyshipError = e?.message ?? 'Easyship error';
  }

  shipments = shipments
    .filter((s) => !!s.easyship_shipment_id)
    .sort((a, b) => (Date.parse(b.created_at ?? '') || 0) - (Date.parse(a.created_at ?? '') || 0));

  const owners = await loadOwners(shipments.map((s) => s.easyship_shipment_id));
  // The current anchor isn't "linked elsewhere", so leave it out of the map.
  for (const [sid, owner] of Object.entries(owners)) {
    if (isSameAnchor(owner, resolved.anchor)) delete owners[sid];
  }

  return NextResponse.json({
    anchor: resolved.anchor.kind,
    current_shipment_id: resolved.easyship_shipment_id,
    since: since.toISOString(),
    lookbackDays: days,
    fetched: shipments.length,
    easyshipError,
    shipments,
    linked: owners,
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const caller = await getInvoiceCaller(db, req);
  if (!caller.ok || !callerCanWrite(caller.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const shipmentId = String(body.easyship_shipment_id ?? '').trim();
  if (!shipmentId) {
    return NextResponse.json({ error: 'easyship_shipment_id is required' }, { status: 400 });
  }

  const resolved = await resolveInvoiceShipmentAnchor(db, params.id);
  if (!resolved) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  const { anchor } = resolved;
  const table = anchor.kind === 'order' ? 'orders' : 'invoices';

  // Read the shipment first: a typo'd or deleted id must never blank the
  // record that is there now.
  const cfg = await getShippingConfig(db);
  let details: EasyshipShipmentDetails;
  try {
    details = await getEasyshipShipmentDetails(shipmentId, cfg.apiKey || undefined);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Could not read that shipment from Easyship' },
      { status: 502 },
    );
  }
  if (!details.easyship_shipment_id) details = { ...details, easyship_shipment_id: shipmentId };

  // Never bind one parcel to two orders by accident; the operator confirms it.
  const owner = (await loadOwners([shipmentId]))[shipmentId];
  if (owner && !isSameAnchor(owner, anchor) && body.allow_shared !== true) {
    const what = owner.kind === 'order' ? 'order' : 'invoice';
    return NextResponse.json(
      {
        error: `That shipment is already attached to ${what} ${owner.label ?? owner.id}.`,
        owner,
      },
      { status: 409 },
    );
  }

  const previous = resolved.easyship_shipment_id;

  // 1. Blank the old record on the anchor and every invoice mirroring it.
  const clearErr = await clearShipmentRecord(db, resolved);
  if (clearErr) return NextResponse.json({ error: clearErr }, { status: 500 });

  // 2. Link the picked shipment and pull its full record onto the anchor and
  //    the invoice(s). When its label already exists and the customer was
  //    never sent the shipped email, that sends it.
  const { error: linkErr } = await db
    .from(table)
    .update({ easyship_shipment_id: shipmentId })
    .eq('id', anchor.id);
  if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 });

  const synced = await onShipmentLabelGenerated(db, anchor, {
    apiKey: cfg.apiKey || undefined,
    details,
  });

  await logAuditServer(
    db,
    { actor_id: caller.actor_id, actor_email: caller.actor_email },
    { action: 'invoice.easyship_override', entity_type: 'invoice', entity_id: params.id },
  );

  return NextResponse.json({
    ok: true,
    anchor: anchor.kind,
    previous_shipment_id: previous,
    easyship_shipment_id: shipmentId,
    label_state: details.label_state,
    email: synced.email,
  });
}
