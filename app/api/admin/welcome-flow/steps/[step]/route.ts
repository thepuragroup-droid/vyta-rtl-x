import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { logAuditServer } from '@/lib/admin/audit';
import { resolveStaffCaller } from '@/lib/affiliate/route-auth';
import { isStepNumber, shapeStepInput } from '@/lib/welcome-flow/types';

const db = getSupabase();

/** PUT /api/admin/welcome-flow/steps/:step — save one email's timing and content. Admin only. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ step: string }> }) {
  const caller = await resolveStaffCaller(db, req);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const n = Number((await params).step);
  if (!isStepNumber(n)) return NextResponse.json({ error: 'Unknown email' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const shaped = shapeStepInput(n, body ?? {});
  if (!shaped.ok) return NextResponse.json({ error: shaped.error }, { status: 400 });

  // Emails go strictly in order, so a delay shorter than the email before it
  // would never be honoured — refuse it rather than save a schedule that lies.
  const { data: neighbours } = await db.from('welcome_flow_steps').select('step, delay_days').in('step', [n - 1, n + 1]);
  const prev = neighbours?.find((r: any) => r.step === n - 1);
  const next = neighbours?.find((r: any) => r.step === n + 1);
  if (prev && shaped.value.delay_days < Number(prev.delay_days)) {
    return NextResponse.json({ error: `Email ${n} can't be due before email ${n - 1} (day ${prev.delay_days}).` }, { status: 400 });
  }
  if (next && shaped.value.delay_days > Number(next.delay_days)) {
    return NextResponse.json({ error: `Email ${n} can't be due after email ${n + 1} (day ${next.delay_days}).` }, { status: 400 });
  }

  const { data, error } = await db
    .from('welcome_flow_steps')
    .upsert({ ...shaped.value, updated_by_email: caller.staff.email, updated_at: new Date().toISOString() })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAuditServer(
    db,
    { actor_id: caller.staff.id, actor_email: caller.staff.email },
    { action: 'welcome_flow.email_updated', entity_type: 'welcome_flow_step', entity_id: String(n) },
  );
  return NextResponse.json({ step: data });
}
