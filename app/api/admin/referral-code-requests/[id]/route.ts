import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditServer } from '@/lib/admin/audit';
import { resolveStaffCaller } from '@/lib/affiliate/route-auth';
import {
  assignReferralCode,
  notifyAffiliateOfCodeChange,
} from '@/lib/affiliate/referral-code-service';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * POST /api/admin/referral-code-requests/[id]  { action, notes?, notify? }
 *
 * Admin only — assistants read the queue, they do not decide.
 *
 * The rejection reason is OPTIONAL here. Declining an affiliate APPLICATION
 * requires a reason and shows it to the applicant, because that decision
 * affects someone's income. Declining a CODE does not: a code is a preference,
 * and forcing a sentence out of an admin who has nothing to say only produces
 * "no" typed into a box. Whatever they do write is kept next to their name, on
 * this side of the desk, forever.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const caller = await resolveStaffCaller(db, req);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  const notes: string | null = body?.notes ? String(body.notes) : null;
  const notify = body?.notify !== false; // defaults to true

  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'." }, { status: 400 });
  }

  const { data: request } = await db
    .from('referral_code_requests')
    .select('*')
    .eq('id', params.id)
    .maybeSingle();

  if (!request) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  if (request.status !== 'pending') {
    return NextResponse.json({ error: 'That request has already been decided.' }, { status: 409 });
  }

  // Assign FIRST. If the code got taken in the meantime the request stays open
  // rather than being silently marked decided against a code nobody can have.
  if (action === 'approve') {
    const assigned = await assignReferralCode(db, request.affiliate_id, request.requested_code);
    if (!assigned.ok) {
      return NextResponse.json({ error: assigned.error }, { status: assigned.status ?? 500 });
    }
  }

  // The status guard makes the decision idempotent against a double click.
  const { data: decided, error } = await db
    .from('referral_code_requests')
    .update({
      status: action === 'approve' ? 'approved' : 'rejected',
      decided_by: caller.staff.id,
      decided_by_name: caller.staff.name,
      decided_at: new Date().toISOString(),
      decision_notes: notes,
    })
    .eq('id', params.id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();

  if (error || !decided) {
    console.error('referral code decision failed:', error);
    return NextResponse.json({ error: 'Could not record the decision.' }, { status: 500 });
  }

  // A rejection never mails. Nothing changed, they keep the code they have,
  // and the reason is for this side of the desk.
  let notified = false;
  let notifyError: string | undefined;
  if (action === 'approve' && notify) {
    const result = await notifyAffiliateOfCodeChange(db, request.affiliate_id, {
      code: request.requested_code,
      previousCode: request.previous_code,
    });
    notified = result.notified;
    notifyError = result.error;
  }

  await logAuditServer(
    db,
    { actor_id: caller.staff.id, actor_email: caller.staff.email },
    {
      action: action === 'approve' ? 'referral_code.approve' : 'referral_code.reject',
      entity_type: 'affiliate',
      // The affiliate, not the request — so Partner 360's audit view shows
      // code changes on the partner's own timeline.
      entity_id: request.affiliate_id,
    },
  );

  return NextResponse.json({ request: decided, notified, notify_error: notifyError ?? null });
}
