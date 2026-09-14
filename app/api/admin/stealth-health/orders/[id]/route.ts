import { NextRequest, NextResponse } from 'next/server';
import { logAuditServer } from '@/lib/admin/audit';
import { db, requireAdmin, isMissingSchema } from '@/lib/admin/stealth-health-server';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/stealth-health/orders/[id] — hold a hand-off back from
 * settlement, or put it back in. Admin only.
 *
 * This is the escape hatch for a disputed or test hand-off: excluding it drops
 * it out of the balance and out of every future invoice without deleting the
 * ledger row. An order already billed cannot be excluded — void or credit the
 * invoice instead, so the claim and the balance stay in step.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  const { id } = await params;

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!('settlement_excluded' in body)) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }
  const excluded = Boolean(body.settlement_excluded);

  const { data: row, error: readErr } = await db
    .from('puramass_orders')
    .select('id, settlement_invoice_id')
    .eq('id', id)
    .maybeSingle();
  if (readErr) {
    if (isMissingSchema(readErr)) {
      return NextResponse.json(
        { error: 'Run stealth-health-settlement-migration.sql in Supabase first.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (excluded && row.settlement_invoice_id) {
    return NextResponse.json(
      { error: 'This order is already on a settlement invoice — void that invoice first.' },
      { status: 400 },
    );
  }

  const { error } = await db
    .from('puramass_orders')
    .update({ settlement_excluded: excluded })
    .eq('id', id);
  if (error) {
    if (isMissingSchema(error)) {
      return NextResponse.json(
        { error: 'Run stealth-health-settlement-migration.sql in Supabase first.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAuditServer(db, { actor_id: actor.id, actor_email: actor.email }, {
    action: excluded ? 'settlement_exclude' : 'settlement_include',
    entity_type: 'puramass_order',
    entity_id: id,
  });

  return NextResponse.json({ id, settlement_excluded: excluded });
}
