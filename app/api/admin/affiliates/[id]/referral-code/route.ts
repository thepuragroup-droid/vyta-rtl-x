import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditServer } from '@/lib/admin/audit';
import { resolveStaffCaller } from '@/lib/affiliate/route-auth';
import {
  assignReferralCode,
  getCurrentReferralCode,
  notifyAffiliateOfCodeChange,
  proposeReferralCode,
} from '@/lib/affiliate/referral-code-service';
import { normalizeReferralCode, referralCodeFormatError } from '@/lib/affiliate/utils';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// GET - current code + a suggestion. Powers the "Suggest" affordance.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const caller = await resolveStaffCaller(db, req, { allowAssistant: true });
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const { data: affiliate } = await db
    .from('affiliates')
    .select('id, first_name, last_name')
    .eq('id', params.id)
    .maybeSingle();

  if (!affiliate) return NextResponse.json({ error: 'Affiliate not found' }, { status: 404 });

  const [current, suggestion] = await Promise.all([
    getCurrentReferralCode(db, params.id),
    proposeReferralCode(db, affiliate, params.id),
  ]);

  return NextResponse.json({ current, suggestion });
}

/**
 * PUT - set a code outright. Admin only. NO QUEUE — this IS the decision.
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const caller = await resolveStaffCaller(db, req);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const body = await req.json().catch(() => ({}));
  const code = normalizeReferralCode(body?.code);
  const notify = body?.notify !== false; // defaults to true
  const notes: string | null = body?.notes ? String(body.notes) : null;

  const formatError = referralCodeFormatError(code);
  if (formatError) return NextResponse.json({ error: formatError }, { status: 400 });

  const { data: affiliate } = await db
    .from('affiliates')
    .select('id')
    .eq('id', params.id)
    .maybeSingle();
  if (!affiliate) return NextResponse.json({ error: 'Affiliate not found' }, { status: 404 });

  const current = await getCurrentReferralCode(db, params.id);
  if (current?.code === code) {
    // Nothing changed: no email, no history row.
    return NextResponse.json({ current, unchanged: true, notified: false, notify_error: null });
  }

  const assigned = await assignReferralCode(db, params.id, code);
  if (!assigned.ok) {
    return NextResponse.json({ error: assigned.error }, { status: assigned.status ?? 500 });
  }

  // Mirrored into the request table so Partner 360 has ONE unified history of
  // every code the partner has held and who changed it — whether it came from
  // a request they raised or from an admin typing it here.
  await db.from('referral_code_requests').insert({
    affiliate_id: params.id,
    requested_code: code,
    previous_code: current?.code ?? null,
    status: 'approved',
    source: 'admin',
    decided_by: caller.staff.id,
    decided_by_name: caller.staff.name,
    decided_at: new Date().toISOString(),
    decision_notes: notes,
  });

  let notified = false;
  let notifyError: string | undefined;
  if (notify) {
    const result = await notifyAffiliateOfCodeChange(db, params.id, {
      code,
      previousCode: current?.code ?? null,
    });
    notified = result.notified;
    notifyError = result.error;
  }

  await logAuditServer(
    db,
    { actor_id: caller.staff.id, actor_email: caller.staff.email },
    { action: 'referral_code.update', entity_type: 'affiliate', entity_id: params.id },
  );

  return NextResponse.json({
    current: { code, uses: current?.uses ?? 0, active: true },
    notified,
    notify_error: notifyError ?? null,
  });
}
