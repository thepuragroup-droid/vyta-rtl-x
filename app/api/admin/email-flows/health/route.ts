import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { resolveStaffCaller } from '@/lib/affiliate/route-auth';
import { runHealthCheck } from '@/lib/email-flows/health';

// The SMTP sign-in and DNS lookups each time out within 15 seconds.
export const maxDuration = 30;
const db = getSupabase();

/**
 * GET /api/admin/email-flows/health — the setup check: is everything the
 * email flows need configured and working? SMTP (a real sign-in, nothing
 * sent), the database, the scheduler, the link secret, each flow's codes and
 * copy, and recent failures. See lib/email-flows/health.ts. Read-only.
 * Staff (admin + assistant).
 */
export async function GET(req: NextRequest) {
  const caller = await resolveStaffCaller(db, req, { allowAssistant: true });
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  return NextResponse.json(await runHealthCheck(db));
}
