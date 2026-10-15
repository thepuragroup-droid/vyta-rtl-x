import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { logAuditServer } from '@/lib/admin/audit';
import { resolveStaffCaller } from '@/lib/affiliate/route-auth';
import { checkCodes, loadConfig, MIGRATION_FILE } from '@/lib/welcome-flow/engine';
import { computeOverview } from '@/lib/welcome-flow/stats';
import { mergeTagProblems } from '@/lib/welcome-flow/render';
import { normalizeCode, shapeSettingsInput, STEP_NUMBERS } from '@/lib/welcome-flow/types';

const db = getSupabase();

/**
 * GET /api/admin/welcome-flow[?days=N] — everything the Welcome Flow page
 * shows: settings, the five emails, whether each email's code is usable, the
 * warnings worth acting on, and the funnel. Staff (admin + assistant).
 */
export async function GET(req: NextRequest) {
  const caller = await resolveStaffCaller(db, req, { allowAssistant: true });
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const loaded = await loadConfig(db);
  if (!loaded.ok) {
    if (loaded.migrationNeeded) return NextResponse.json({ migrationNeeded: true, migrationFile: MIGRATION_FILE });
    return NextResponse.json({ error: loaded.error }, { status: 500 });
  }
  const { settings, steps } = loaded.config;

  const days = Number(req.nextUrl.searchParams.get('days')) || 0;
  const since = days > 0 ? new Date(Date.now() - days * 864e5).toISOString() : null;

  const [codes, overview] = await Promise.all([
    checkCodes(db, STEP_NUMBERS.map((n) => steps[n].promo_code)),
    computeOverview(db, since),
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
      warnings.push(`Email ${s.step} is on hold: ${s.code.problem} Subscribers waiting on it will get it once the code works.`);
    }
    for (const p of s.problems) warnings.push(`Email ${s.step}: ${p}`);
  }

  return NextResponse.json({ settings, steps: stepList, overview, warnings });
}

/** PUT /api/admin/welcome-flow — save settings. Admin only. */
export async function PUT(req: NextRequest) {
  const caller = await resolveStaffCaller(db, req);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const body = await req.json().catch(() => ({}));
  const shaped = shapeSettingsInput(body ?? {});
  if (!shaped.ok) return NextResponse.json({ error: shaped.error }, { status: 400 });

  const { data: current } = await db.from('welcome_flow_settings').select('enabled, enabled_at').eq('id', 1).maybeSingle();
  const turningOn = shaped.value.enabled && !current?.enabled;

  const { data, error } = await db
    .from('welcome_flow_settings')
    .upsert({
      id: 1,
      ...shaped.value,
      // Switching on starts the clock: only signups from now on are enrolled
      // automatically, so the back catalogue is never emailed in one go.
      ...(turningOn ? { enabled_at: new Date().toISOString() } : {}),
      updated_by_email: caller.staff.email,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAuditServer(
    db,
    { actor_id: caller.staff.id, actor_email: caller.staff.email },
    {
      action: turningOn ? 'welcome_flow.enabled' : current?.enabled && !shaped.value.enabled ? 'welcome_flow.disabled' : 'welcome_flow.settings_updated',
      entity_type: 'welcome_flow',
      entity_id: null,
    },
  );
  return NextResponse.json({ settings: data });
}
