import { NextRequest, NextResponse } from 'next/server';
import { logAuditServer } from '@/lib/admin/audit';
import { db, requireAdmin, isMissingSchema } from '@/lib/admin/stealth-health-server';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/admin/stealth-health/payouts/[id] — remove a payout recorded in
 * error. Admin only.
 *
 * Deleting one raises the outstanding balance again, and any invoice it was
 * applied to falls back to `partial`/`sent` on its own, since those statuses
 * are derived from the payouts rather than stored.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  const { id } = await params;

  const { data: existing, error: readErr } = await db
    .from('stealth_health_payouts')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (readErr && isMissingSchema(readErr)) {
    return NextResponse.json(
      { error: 'Run stealth-health-settlement-migration.sql in Supabase first.' },
      { status: 409 },
    );
  }
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { error } = await db.from('stealth_health_payouts').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAuditServer(db, { actor_id: actor.id, actor_email: actor.email }, {
    action: 'delete',
    entity_type: 'stealth_health_payout',
    entity_id: id,
  });

  return NextResponse.json({ deleted: true });
}
