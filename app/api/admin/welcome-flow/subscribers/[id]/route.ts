import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { logAuditServer } from '@/lib/admin/audit';
import { resolveStaffCaller } from '@/lib/affiliate/route-auth';
import { isValidTimeZone } from '@/lib/welcome-flow/types';

const db = getSupabase();

/**
 * PATCH /api/admin/welcome-flow/subscribers/:id
 *   { action: 'remove' }              stop their emails (status → exited)
 *   { action: 'resume' }              put a removed person back in the flow
 *   { action: 'timezone', timezone }  correct the zone their window is read in
 *
 * An unsubscribed person is never resumed from here: that was their choice,
 * and only they can reverse it (by opting in again). Admin only.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await resolveStaffCaller(db, req);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const { data: sub } = await db.from('welcome_flow_subscribers').select('id, status').eq('id', id).maybeSingle();
  if (!sub) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const now = new Date().toISOString();
  let update: Record<string, unknown>;
  switch (body?.action) {
    case 'remove':
      if (sub.status !== 'active') return NextResponse.json({ error: 'Only someone still in the flow can be removed.' }, { status: 400 });
      update = { status: 'exited', exited_at: now, exit_reason: `Removed by ${caller.staff.name ?? caller.staff.email ?? 'an admin'}` };
      break;
    case 'resume':
      if (sub.status !== 'exited') {
        return NextResponse.json({ error: sub.status === 'unsubscribed' ? 'They unsubscribed — only they can opt back in.' : 'Only a removed subscriber can be resumed.' }, { status: 400 });
      }
      update = { status: 'active', exited_at: null, exit_reason: null };
      break;
    case 'timezone': {
      const tz = String(body?.timezone ?? '').trim();
      if (!isValidTimeZone(tz)) return NextResponse.json({ error: `"${tz}" is not a recognised time zone.` }, { status: 400 });
      update = { timezone: tz };
      break;
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  const { error } = await db.from('welcome_flow_subscribers').update({ ...update, updated_at: now }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAuditServer(
    db,
    { actor_id: caller.staff.id, actor_email: caller.staff.email },
    { action: `welcome_flow.subscriber_${body.action}`, entity_type: 'welcome_flow_subscriber', entity_id: id },
  );
  return NextResponse.json({ ok: true });
}
