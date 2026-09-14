import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyWarehouse, setFulfillmentStatus } from '@/lib/warehouse/server';
import { logAuditServer } from '@/lib/admin/audit';
import { sendPackingList } from '@/lib/admin/send-packing-list';
import type { FulfillmentStatus } from '@/lib/warehouse/types';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const VALID_STATUSES: FulfillmentStatus[] = [
  'pending', 'packed', 'shipped', 'picked_up', 'dropped_off',
];

/**
 * PATCH /api/warehouse/queue/[id]
 *
 * One endpoint, three body shapes (mutually exclusive):
 *
 *   1. { removed_from_queue: boolean } — remove / restore an invoice from
 *      the active queue. Stamps removed_at/by.
 *   2. { undraft: true }              — flip status from 'draft' to 'sent'
 *      so an invoice can be packed.
 *   3. { fulfillment_status: <s> }    — advance the workflow. `dropped_off`
 *      is shipment-only (courier handoff); `picked_up` is pickup-only.
 *
 * Side effects on status changes:
 *   - Terminal shipment states mirror onto the linked order (shipped).
 *   - Client shipments (`ships_to_client=true`) reaching shipped or
 *     dropped_off auto-fire `sendPackingList` via `after()` — post-
 *     response, best-effort, guarded by `packing_list_emailed_at` so a
 *     retry of the same status transition doesn't send twice.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await verifyWarehouse(db, req);
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  // ---- Remove / restore from queue -----------------------------------
  if (typeof body.removed_from_queue === 'boolean') {
    const nowIso = new Date().toISOString();
    const patch = body.removed_from_queue
      ? { removed_from_queue: true, removed_at: nowIso, removed_by: auth.actorId }
      : { removed_from_queue: false, removed_at: null, removed_by: null };
    const { error } = await db.from('invoices').update(patch).eq('id', params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logAuditServer(
      db,
      { actor_id: auth.actorId, actor_email: auth.actorEmail },
      {
        action: body.removed_from_queue ? 'invoice.queue_remove' : 'invoice.queue_restore',
        entity_type: 'invoice',
        entity_id: params.id,
      },
    );
    return NextResponse.json({ ok: true });
  }

  // ---- Undraft (draft → sent) ---------------------------------------
  if (body.undraft === true) {
    const { data: existing } = await db
      .from('invoices')
      .select('status')
      .eq('id', params.id)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: 'invoice not found' }, { status: 404 });
    if (existing.status !== 'draft') {
      return NextResponse.json({ error: `invoice is already ${existing.status}` }, { status: 400 });
    }
    const { error } = await db
      .from('invoices')
      .update({ status: 'sent', updated_at: new Date().toISOString() })
      .eq('id', params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logAuditServer(
      db,
      { actor_id: auth.actorId, actor_email: auth.actorEmail },
      { action: 'invoice.undraft', entity_type: 'invoice', entity_id: params.id },
    );
    return NextResponse.json({ ok: true });
  }

  // ---- Advance fulfillment status ------------------------------------
  const nextStatus = body.fulfillment_status as FulfillmentStatus | undefined;
  if (!nextStatus || !VALID_STATUSES.includes(nextStatus)) {
    return NextResponse.json({ error: 'fulfillment_status is required' }, { status: 400 });
  }

  // Reject packing/shipping a still-draft invoice — the queue detail
  // pane forces "Mark ready" first.
  const { data: pre, error: preError } = await db
    .from('invoices')
    .select('status, ships_to_client, packing_list_emailed_at')
    .eq('id', params.id)
    .maybeSingle();
  // Distinguish a genuinely-missing invoice (no row, no error) from a database
  // error (e.g. a missing column). Swallowing the error and treating it as a
  // missing row surfaced a misleading "404 invoice not found" to the warehouse.
  if (preError) return NextResponse.json({ error: preError.message }, { status: 500 });
  if (!pre) return NextResponse.json({ error: 'invoice not found' }, { status: 404 });
  if (pre.status === 'draft' && nextStatus !== 'pending') {
    return NextResponse.json(
      { error: 'Mark the invoice ready first (draft → sent) before advancing fulfillment.' },
      { status: 400 },
    );
  }

  const result = await setFulfillmentStatus(db, auth, params.id, nextStatus);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Auto-send the Packing List when a client shipment first reaches a
  // shipped-terminal state. Guarded by packing_list_emailed_at so a
  // status retry never sends twice. Fires post-response via after() so
  // the queue UI doesn't wait on the email round-trip.
  if (
    pre.ships_to_client
    && !pre.packing_list_emailed_at
    && (nextStatus === 'shipped' || nextStatus === 'dropped_off')
  ) {
    after(async () => {
      await sendPackingList(db, params.id, {
        actor_id: auth.actorId,
        actor_email: auth.actorEmail,
      });
    });
  }

  return NextResponse.json({ ok: true });
}
