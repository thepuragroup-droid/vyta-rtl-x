import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { logAuditServer } from '@/lib/admin/audit';
import { resolveStaffCaller } from '@/lib/affiliate/route-auth';
import { checkCodes, loadConfig, MIGRATION_FILE } from '@/lib/email-flows/engine';
import { computeOverview } from '@/lib/email-flows/stats';
import { mergeTagProblems } from '@/lib/email-flows/render';
import { FLOW_KEYS, isFlowKey, normalizeCode, shapeSettingsInput, STEP_NUMBERS, stepsMissingCode } from '@/lib/email-flows/types';

const db = getSupabase();
type Ctx = { params: Promise<{ flow: string }> };

/**
 * GET /api/admin/email-flows/:flow[?days=N] — everything the Email Flows page
 * shows for one flow: settings, the five emails, whether each email's code is
 * usable, the warnings worth acting on, and the funnel. Staff (admin + assistant).
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const caller = await resolveStaffCaller(db, req, { allowAssistant: true });
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const { flow } = await params;
  if (!isFlowKey(flow)) return NextResponse.json({ error: 'Unknown flow' }, { status: 404 });

  const loaded = await loadConfig(db, flow);
  if (!loaded.ok) {
    if (loaded.migrationNeeded) return NextResponse.json({ migrationNeeded: true, migrationFile: MIGRATION_FILE });
    return NextResponse.json({ error: loaded.error }, { status: 500 });
  }
  const { settings, steps } = loaded.config;

  const days = Number(req.nextUrl.searchParams.get('days')) || 0;
  const since = days > 0 ? new Date(Date.now() - days * 864e5).toISOString() : null;

  const [codes, overview, { data: allSettings }] = await Promise.all([
    checkCodes(db, STEP_NUMBERS.map((n) => steps[n].promo_code)),
    computeOverview(db, flow, since),
    db.from('email_flow_settings').select('flow, enabled'),
  ]);

  const stepList = STEP_NUMBERS.map((n) => {
    const step = steps[n];
    const code = step.promo_code ? codes.get(normalizeCode(step.promo_code)) ?? null : null;
    return { ...step, code, problems: mergeTagProblems(step) };
  });

  const warnings: string[] = [];
  if (!settings.footer_address) {
    warnings.push('Add a mailing address for the email footer (Settings tab). Canadian anti-spam law (CASL) requires one in every commercial email.');
  }
  for (const s of stepList) {
    if (s.enabled && s.code && !s.code.usable) {
      warnings.push(`Email ${s.step} is on hold: ${s.code.problem} People waiting on it will get it once the code works.`);
    }
    for (const p of s.problems) warnings.push(`Email ${s.step}: ${p}`);
  }

  return NextResponse.json({
    settings,
    steps: stepList,
    overview,
    warnings,
    // For the flow switcher's on/off dots.
    flows: Object.fromEntries(FLOW_KEYS.map((k) => [k, !!(allSettings ?? []).find((r: any) => r.flow === k)?.enabled])),
  });
}

/**
 * PUT /api/admin/email-flows/:flow — save a flow's settings. The footer is one
 * sender identity, so it is written to every flow at once. Admin only.
 */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const caller = await resolveStaffCaller(db, req);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const { flow } = await params;
  if (!isFlowKey(flow)) return NextResponse.json({ error: 'Unknown flow' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const shaped = shapeSettingsInput(body ?? {});
  if (!shaped.ok) return NextResponse.json({ error: shaped.error }, { status: 400 });

  const { data: current } = await db.from('email_flow_settings').select('enabled').eq('flow', flow).maybeSingle();
  const turningOn = shaped.value.enabled && !current?.enabled;

  // No offer email goes out with a code nobody chose: the flow can't be
  // switched on until every switched-on offer email has one.
  if (shaped.value.enabled) {
    const loaded = await loadConfig(db, flow);
    if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: 500 });
    const missing = stepsMissingCode(STEP_NUMBERS.map((n) => loaded.config.steps[n]));
    if (missing.length) {
      const list = missing.map((n) => `Email ${n}`).join(', ');
      return NextResponse.json(
        { error: `Choose a discount code for ${list} first (Emails tab) — ${missing.length === 1 ? 'it is an offer email' : 'they are offer emails'}.` },
        { status: 400 },
      );
    }
  }
  const stamp = new Date().toISOString();

  const { data, error } = await db
    .from('email_flow_settings')
    .upsert({
      flow,
      ...shaped.value,
      // Switching on starts the clock: only signups / carts from now on are
      // enrolled, so the back catalogue is never emailed in one go.
      ...(turningOn ? { enabled_at: stamp } : {}),
      updated_by_email: caller.staff.email,
      updated_at: stamp,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db
    .from('email_flow_settings')
    .update({ footer_address: shaped.value.footer_address, footer_disclaimer: shaped.value.footer_disclaimer })
    .neq('flow', flow);

  await logAuditServer(
    db,
    { actor_id: caller.staff.id, actor_email: caller.staff.email },
    {
      action: turningOn ? 'email_flow.enabled' : current?.enabled && !shaped.value.enabled ? 'email_flow.disabled' : 'email_flow.settings_updated',
      entity_type: 'email_flow',
      entity_id: flow,
    },
  );
  return NextResponse.json({ settings: data });
}
