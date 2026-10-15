import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { logAuditServer } from '@/lib/admin/audit';
import { resolveStaffCaller } from '@/lib/affiliate/route-auth';
import { isFlowKey, isStepNumber, shapeStepInput } from '@/lib/email-flows/types';

const db = getSupabase();

/** PUT /api/admin/email-flows/:flow/steps/:step — save one email's timing and content. Admin only. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ flow: string; step: string }> }) {
  const caller = await resolveStaffCaller(db, req);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const p = await params;
  const n = Number(p.step);
  if (!isFlowKey(p.flow) || !isStepNumber(n)) return NextResponse.json({ error: 'Unknown email' }, { status: 404 });
  const flow = p.flow;

  const body = await req.json().catch(() => ({}));
  const shaped = shapeStepInput(flow, n, body ?? {});
  if (!shaped.ok) return NextResponse.json({ error: shaped.error }, { status: 400 });

  // Emails go strictly in order, so a delay shorter than the email before it
  // would never be honoured — refuse it rather than save a schedule that lies.
  const { data: neighbours } = await db.from('email_flow_steps').select('step, delay_hours').eq('flow', flow).in('step', [n - 1, n + 1]);
  const prev = neighbours?.find((r: any) => r.step === n - 1);
  const next = neighbours?.find((r: any) => r.step === n + 1);
  if (prev && shaped.value.delay_hours < Number(prev.delay_hours)) {
    return NextResponse.json({ error: `Email ${n} can't be due before email ${n - 1} (${prev.delay_hours}h).` }, { status: 400 });
  }
  if (next && shaped.value.delay_hours > Number(next.delay_hours)) {
    return NextResponse.json({ error: `Email ${n} can't be due after email ${n + 1} (${next.delay_hours}h).` }, { status: 400 });
  }

  const { data, error } = await db
    .from('email_flow_steps')
    .upsert({ ...shaped.value, updated_by_email: caller.staff.email, updated_at: new Date().toISOString() })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAuditServer(
    db,
    { actor_id: caller.staff.id, actor_email: caller.staff.email },
    { action: 'email_flow.email_updated', entity_type: 'email_flow_step', entity_id: `${flow}:${n}` },
  );
  return NextResponse.json({ step: data });
}
