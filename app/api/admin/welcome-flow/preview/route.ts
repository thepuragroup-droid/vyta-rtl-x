import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { SITE_URL } from '@/lib/config';
import { sendMail } from '@/lib/smtp';
import { logAuditServer } from '@/lib/admin/audit';
import { resolveStaffCaller } from '@/lib/affiliate/route-auth';
import { checkCodes, loadConfig, resolveOffer } from '@/lib/welcome-flow/engine';
import { mergeTagProblems, renderWelcomeEmail } from '@/lib/welcome-flow/render';
import { isStepNumber, shapeStepInput } from '@/lib/welcome-flow/types';

const db = getSupabase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/admin/welcome-flow/preview
 *   { draft: <step fields>, firstName?, sendTo? }
 *
 * Renders an email exactly as the flow would — the same renderer, the code's
 * real value — from the editor's unsaved draft. With `sendTo` (admin only) it
 * also sends it there as a test, untracked and marked [Test].
 *
 * The preview resolves images against this deployment's own origin, so new
 * artwork shows before it reaches production; a test send uses the public
 * site, as the real emails do.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sending = typeof body?.sendTo === 'string' && body.sendTo.trim() !== '';
  const caller = await resolveStaffCaller(db, req, { allowAssistant: !sending });
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const n = Number(body?.draft?.step);
  if (!isStepNumber(n)) return NextResponse.json({ error: 'Unknown email' }, { status: 400 });
  const shaped = shapeStepInput(n, body.draft ?? {});
  if (!shaped.ok) return NextResponse.json({ error: shaped.error }, { status: 400 });
  const step = shaped.value;

  const loaded = await loadConfig(db);
  if (!loaded.ok) return NextResponse.json({ error: loaded.migrationNeeded ? 'Run the welcome flow migration first.' : loaded.error }, { status: 400 });
  const { settings } = loaded.config;

  const codes = await checkCodes(db, [step.promo_code]);
  const offer = resolveOffer(step, codes);
  const now = new Date();
  const ctx = {
    firstName: String(body.firstName ?? '').trim() || 'Alex',
    offer,
    offerEndsAt: n === 5 ? new Date(now.getTime() + settings.final_offer_hours * 3600 * 1000) : null,
    now,
    timezone: settings.default_timezone,
    settings,
    unsubscribeUrl: `${SITE_URL}/api/welcome-flow/unsubscribe`,
  };

  const preview = renderWelcomeEmail(step, { ...ctx, siteUrl: req.nextUrl.origin });
  const problems = mergeTagProblems(step);
  const code = step.promo_code ? codes.get(step.promo_code) ?? null : null;
  if (code && !code.usable) problems.unshift(`${code.problem} The live email waits until the code works; this preview leaves the offer out.`);

  if (!sending) return NextResponse.json({ ...preview, problems });

  const to = String(body.sendTo).trim().toLowerCase();
  if (!EMAIL.test(to)) return NextResponse.json({ error: 'Enter a valid email address for the test.' }, { status: 400 });
  const live = renderWelcomeEmail(step, { ...ctx, siteUrl: SITE_URL });
  const res = await sendMail({ to, subject: `[Test] ${live.subject}`, html: live.html, text: live.text });
  if (!res.success) return NextResponse.json({ error: res.error ?? 'The test email could not be sent.' }, { status: 502 });

  await logAuditServer(
    db,
    { actor_id: caller.staff.id, actor_email: caller.staff.email },
    { action: 'welcome_flow.test_sent', entity_type: 'welcome_flow_step', entity_id: String(n) },
  );
  return NextResponse.json({ ...preview, problems, sent: true });
}
