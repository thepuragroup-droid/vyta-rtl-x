import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { SITE_URL } from '@/lib/config';
import { logAuditServer } from '@/lib/admin/audit';
import { resolveStaffCaller } from '@/lib/affiliate/route-auth';
import { emailName, shapeTestSendInput } from '@/lib/email-flows/test-send';
import { sendTestEmails, testDefaults } from '@/lib/email-flows/test-runner';

export const maxDuration = 120;
const db = getSupabase();

/**
 * GET /api/admin/email-flows/test-send — what the test form starts from: the
 * default name and subject tag, each email's subject and code, a sample cart,
 * and the products the cart can be built from.
 */
export async function GET(req: NextRequest) {
  const caller = await resolveStaffCaller(db, req, { allowAssistant: true });
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const res = await testDefaults(db);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json(res.defaults);
}

/**
 * POST /api/admin/email-flows/test-send
 *   { recipients, emails?, firstName?, code?, timezone?, cart?, subjectTag? }
 *
 * Sends any of the flow emails, from their saved settings, to one or more
 * addresses — each address gets its own copy. Only `recipients` is required;
 * see lib/email-flows/test-send.ts for the defaults. Nothing is enrolled or
 * tracked. An email the live flow would hold (no code, or a code that can't
 * be used) is skipped and says why. Admin only.
 */
export async function POST(req: NextRequest) {
  const caller = await resolveStaffCaller(db, req);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const body = await req.json().catch(() => ({}));
  const shaped = shapeTestSendInput(body ?? {});
  if (!shaped.ok) return NextResponse.json({ error: shaped.error }, { status: 400 });

  const res = await sendTestEmails(db, shaped.value, SITE_URL);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });

  const { recipients, emails } = shaped.value;
  await logAuditServer(
    db,
    { actor_id: caller.staff.id, actor_email: caller.staff.email },
    {
      action: 'email_flow.test_suite_sent',
      entity_type: 'email_flow',
      entity_id: `${emails.map(emailName).join(', ')} → ${recipients.join(', ')}`.slice(0, 500),
    },
  );
  return NextResponse.json(res.summary);
}
