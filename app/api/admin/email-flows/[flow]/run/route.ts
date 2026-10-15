import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { logAuditServer } from '@/lib/admin/audit';
import { resolveStaffCaller } from '@/lib/affiliate/route-auth';
import { runFlow } from '@/lib/email-flows/engine';
import { isFlowKey } from '@/lib/email-flows/types';

export const maxDuration = 60;
const db = getSupabase();

/**
 * POST /api/admin/email-flows/:flow/run — run one flow now instead of waiting
 * for the next 15-minute tick. Exactly what the cron does: same rules, same
 * at-most-once claims, so it can't double-send. Admin only.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ flow: string }> }) {
  const caller = await resolveStaffCaller(db, req);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const { flow } = await params;
  if (!isFlowKey(flow)) return NextResponse.json({ error: 'Unknown flow' }, { status: 404 });

  const result = await runFlow(db, flow);
  await logAuditServer(
    db,
    { actor_id: caller.staff.id, actor_email: caller.staff.email },
    { action: 'email_flow.run', entity_type: 'email_flow', entity_id: flow },
  );
  return NextResponse.json(result);
}
