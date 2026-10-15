import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { SITE_URL } from '@/lib/config';
import { sendMail } from '@/lib/smtp';
import { logAuditServer } from '@/lib/admin/audit';
import { resolveStaffCaller } from '@/lib/affiliate/route-auth';
import { checkCodes, loadConfig, resolveOffer } from '@/lib/email-flows/engine';
import { mergeTagProblems, renderFlowEmail, type RenderCart } from '@/lib/email-flows/render';
import { CART_PRODUCT_COLUMNS, cartLineViews, type CartProductRow } from '@/lib/email-flows/carts';
import { isFlowKey, isStepNumber, shapeStepInput } from '@/lib/email-flows/types';

const db = getSupabase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Two real products from the catalogue, so a cart preview looks like a real cart. */
async function sampleCart(origin: string, code: string | null): Promise<RenderCart> {
  const { data } = await db.from('products').select(CART_PRODUCT_COLUMNS).eq('active', true).order('name').limit(2);
  const products = (data ?? []) as CartProductRow[];
  const lines = products.map((p, i) => ({ productId: String(p.id).toLowerCase(), packSize: i === 0 ? 3 : 1, quantity: i === 0 ? 1 : 2 }));
  const base = `${origin}/cart`;
  return {
    lines: cartLineViews(lines, products),
    cartUrl: base,
    checkoutUrl: `${origin}/checkout${code ? `?discount=${code}` : ''}`,
  };
}

/**
 * POST /api/admin/email-flows/:flow/preview
 *   { draft: <step fields>, firstName?, sendTo? }
 *
 * Renders an email exactly as the flow would — the same renderer, the code's
 * real value — from the editor's unsaved draft, with a sample name (and, for
 * the cart flow, a sample cart from the catalogue). With `sendTo` (admin only)
 * it also sends it there as a test, untracked and marked [Test].
 *
 * The preview resolves images against this deployment's own origin, so new
 * artwork shows before it reaches production; a test send uses the public
 * site, as the real emails do.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ flow: string }> }) {
  const body = await req.json().catch(() => ({}));
  const sending = typeof body?.sendTo === 'string' && body.sendTo.trim() !== '';
  const caller = await resolveStaffCaller(db, req, { allowAssistant: !sending });
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const { flow } = await params;
  const n = Number(body?.draft?.step);
  if (!isFlowKey(flow) || !isStepNumber(n)) return NextResponse.json({ error: 'Unknown email' }, { status: 400 });
  // A draft still waiting for its code previews fine — the missing code comes
  // back as a problem — but a test send needs the real thing.
  const shaped = shapeStepInput(flow, n, body.draft ?? {}, { requireCode: sending });
  if (!shaped.ok) return NextResponse.json({ error: shaped.error }, { status: 400 });
  const step = shaped.value;

  const loaded = await loadConfig(db, flow);
  if (!loaded.ok) return NextResponse.json({ error: loaded.migrationNeeded ? 'Run the email flows migration first.' : loaded.error }, { status: 400 });
  const { settings } = loaded.config;

  const codes = await checkCodes(db, [step.promo_code]);
  const offer = resolveOffer(step, codes);
  const now = new Date();
  const ctx = {
    firstName: String(body.firstName ?? '').trim() || 'Alex',
    offer,
    offerEndsAt: step.deadline_hours ? new Date(now.getTime() + step.deadline_hours * 3600 * 1000) : null,
    now,
    timezone: settings.default_timezone,
    settings,
    unsubscribeUrl: `${SITE_URL}/api/email-flows/unsubscribe`,
  };

  const origin = req.nextUrl.origin;
  const preview = renderFlowEmail(step, {
    ...ctx,
    siteUrl: origin,
    cart: flow === 'cart' ? await sampleCart(origin, offer?.code ?? null) : null,
  });
  const problems = mergeTagProblems(step);
  const code = step.promo_code ? codes.get(step.promo_code) ?? null : null;
  if (code && !code.usable) problems.unshift(`${code.problem} The live email waits until the code works; this preview leaves the offer out.`);

  if (!sending) return NextResponse.json({ ...preview, problems });

  const to = String(body.sendTo).trim().toLowerCase();
  if (!EMAIL.test(to)) return NextResponse.json({ error: 'Enter a valid email address for the test.' }, { status: 400 });
  const live = renderFlowEmail(step, {
    ...ctx,
    siteUrl: SITE_URL,
    cart: flow === 'cart' ? await sampleCart(SITE_URL, offer?.code ?? null) : null,
  });
  const res = await sendMail({ to, subject: `[Test] ${live.subject}`, html: live.html, text: live.text });
  if (!res.success) return NextResponse.json({ error: res.error ?? 'The test email could not be sent.' }, { status: 502 });

  await logAuditServer(
    db,
    { actor_id: caller.staff.id, actor_email: caller.staff.email },
    { action: 'email_flow.test_sent', entity_type: 'email_flow_step', entity_id: `${flow}:${n}` },
  );
  return NextResponse.json({ ...preview, problems, sent: true });
}
