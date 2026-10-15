import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { logAuditServer } from '@/lib/admin/audit';
import { resolveStaffCaller } from '@/lib/affiliate/route-auth';
import { isFlowKey, isValidTimeZone } from '@/lib/email-flows/types';

const db = getSupabase();

/**
 * PATCH /api/admin/email-flows/:flow/entries/:id
 *   { action: 'remove' }              stop their emails (status → exited)
 *   { action: 'resume' }              put a removed person back in the flow
 *   { action: 'timezone', timezone }  correct the zone their window is read in
 *
 * An unsubscribed person is never resumed from here: that was their choice,
 * and only they can reverse it. Admin only.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ flow: string; id: string }> }) {
  const caller = await resolveStaffCaller(db, req);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const { flow, id } = await params;
  if (!isFlowKey(flow)) return NextResponse.json({ error: 'Unknown flow' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const { data: entry } = await db.from('email_flow_entries').select('id, status, email').eq('id', id).eq('flow', flow).maybeSingle();
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const now = new Date().toISOString();
  let update: Record<string, unknown>;
  switch (body?.action) {
    case 'remove':
      if (entry.status !== 'active') return NextResponse.json({ error: 'Only someone still in the flow can be removed.' }, { status: 400 });
      update = { status: 'exited', exited_at: now, paused_reason: null, exit_reason: `Removed by ${caller.staff.name ?? caller.staff.email ?? 'an admin'}` };
      break;
    case 'resume': {
      if (entry.status !== 'exited') {
        return NextResponse.json({ error: entry.status === 'unsubscribed' ? 'They unsubscribed — only they can opt back in.' : 'Only a removed entry can be resumed.' }, { status: 400 });
      }
      const { data: suppressed } = await db.from('email_flow_suppressions').select('email').eq('email', String(entry.email).toLowerCase()).maybeSingle();
      if (suppressed) return NextResponse.json({ error: 'That address has unsubscribed — only they can opt back in.' }, { status: 400 });
      update = { status: 'active', exited_at: null, exit_reason: null };
      break;
    }
    case 'timezone': {
      const tz = String(body?.timezone ?? '').trim();
      if (!isValidTimeZone(tz)) return NextResponse.json({ error: `"${tz}" is not a recognised time zone.` }, { status: 400 });
      update = { timezone: tz };
      break;
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  const { error } = await db.from('email_flow_entries').update({ ...update, updated_at: now }).eq('id', id);
  if (error) {
    // Resuming when they already have another live pass through this flow.
    if (error.code === '23505') return NextResponse.json({ error: 'They are already in this flow again.' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAuditServer(
    db,
    { actor_id: caller.staff.id, actor_email: caller.staff.email },
    { action: `email_flow.entry_${body.action}`, entity_type: 'email_flow_entry', entity_id: id },
  );
  return NextResponse.json({ ok: true });
}
