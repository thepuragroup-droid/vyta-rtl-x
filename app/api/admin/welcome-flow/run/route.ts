import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { logAuditServer } from '@/lib/admin/audit';
import { resolveStaffCaller } from '@/lib/affiliate/route-auth';
import { runWelcomeFlow } from '@/lib/welcome-flow/engine';

export const maxDuration = 60;
const db = getSupabase();

/**
 * POST /api/admin/welcome-flow/run — run the flow now instead of waiting for
 * the next 15-minute tick. Exactly what the cron does: same rules, same
 * at-most-once claims, so it can't double-send. Admin only.
 */
export async function POST(req: NextRequest) {
  const caller = await resolveStaffCaller(db, req);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const result = await runWelcomeFlow(db);
  await logAuditServer(
    db,
    { actor_id: caller.staff.id, actor_email: caller.staff.email },
    { action: 'welcome_flow.run', entity_type: 'welcome_flow', entity_id: null },
  );
  return NextResponse.json(result);
}
