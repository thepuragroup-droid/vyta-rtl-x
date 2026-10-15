import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { logAuditServer } from '@/lib/admin/audit';
import { resolveStaffCaller } from '@/lib/affiliate/route-auth';
import { firstOrderStatus } from '@/lib/promos/first-order';
import { enrollCartManually, enrollWelcome, loadConfig, processOne } from '@/lib/email-flows/engine';
import { ENTRY_SELECT, SEND_SELECT, attachCarts, shapeEntry } from '@/lib/email-flows/stats';
import { ENTRY_STATUSES, isFlowKey } from '@/lib/email-flows/types';

const db = getSupabase();
const PAGE_SIZE = 50;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Ctx = { params: Promise<{ flow: string }> };

/**
 * GET /api/admin/email-flows/:flow/entries?status=&q=&page=
 *
 * Everyone in the flow, newest first, each with every email they have been
 * sent (opened? clicked?), what is coming next, and — cart flow — what is in
 * their cart. Staff (admin + assistant).
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const caller = await resolveStaffCaller(db, req, { allowAssistant: true });
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const { flow } = await params;
  if (!isFlowKey(flow)) return NextResponse.json({ error: 'Unknown flow' }, { status: 404 });

  const p = req.nextUrl.searchParams;
  const status = p.get('status');
  const q = (p.get('q') ?? '').trim().toLowerCase().replace(/[%_,()]/g, '');
  const page = Math.max(0, Number(p.get('page')) || 0);

  let query = db
    .from('email_flow_entries')
    .select(ENTRY_SELECT, { count: 'exact' })
    .eq('flow', flow)
    .order('enrolled_at', { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (status && (ENTRY_STATUSES as readonly string[]).includes(status)) query = query.eq('status', status);
  if (q) query = query.or(`email.ilike.%${q}%,first_name.ilike.%${q}%`);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (data ?? []).map((r: any) => r.id);
  const [{ data: sends }, loaded] = await Promise.all([
    ids.length ? db.from('email_flow_sends').select(SEND_SELECT).in('entry_id', ids) : Promise.resolve({ data: [] as any[] }),
    loadConfig(db, flow),
  ]);
  const config = loaded.ok ? loaded.config : null;
  const now = new Date();
  const entries = (data ?? []).map((r: any) => shapeEntry(r, sends ?? [], config, now));
  if (flow === 'cart') await attachCarts(db, entries);

  return NextResponse.json({ entries, total: count ?? 0, page, pageSize: PAGE_SIZE });
}

/**
 * POST /api/admin/email-flows/:flow/entries  { email, consent: true }
 *
 * Add somebody by hand — mainly for testing a series on yourself.
 *   welcome: the account must not have ordered yet.
 *   cart:    the account's current saved cart enters the flow, backdated so
 *            Email 1 is due straight away.
 * `consent` is the admin attesting the person agreed to marketing email.
 * If the flow is on, the first email goes immediately. Admin only.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const caller = await resolveStaffCaller(db, req);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const { flow } = await params;
  if (!isFlowKey(flow)) return NextResponse.json({ error: 'Unknown flow' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? '').trim().toLowerCase();
  if (!EMAIL.test(email)) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  if (body?.consent !== true) {
    return NextResponse.json({ error: 'Confirm this person agreed to receive marketing email.' }, { status: 400 });
  }

  const loaded = await loadConfig(db, flow);
  if (!loaded.ok) return NextResponse.json({ error: 'Run the email flows migration first.' }, { status: 400 });

  const { data: customer } = await db
    .from('customers')
    .select('id, email, first_name, shipping_state, shipping_country, active')
    .ilike('email', email.replace(/[\\%_]/g, (c) => `\\${c}`))
    .limit(1)
    .maybeSingle();
  if (!customer) return NextResponse.json({ error: 'No account uses that email. They need to sign up first.' }, { status: 404 });
  if (customer.active === false) return NextResponse.json({ error: 'That account is deactivated.' }, { status: 400 });

  let entryId: string;
  if (flow === 'welcome') {
    const { data: existing } = await db.from('email_flow_entries').select('id, status').eq('flow', 'welcome').eq('customer_id', customer.id).maybeSingle();
    if (existing) return NextResponse.json({ error: `Already in the welcome flow (${existing.status}).` }, { status: 409 });
    if ((await firstOrderStatus(db, { customerId: customer.id, email })) !== 'first') {
      return NextResponse.json({ error: 'This person has already ordered, so the welcome series does not apply.' }, { status: 400 });
    }
    const entry = await enrollWelcome(db, customer, loaded.config.settings, 'manual');
    if (!entry) return NextResponse.json({ error: 'Could not add them — they may have unsubscribed.' }, { status: 400 });
    entryId = entry.id;
  } else {
    const { entry, error } = await enrollCartManually(db, customer, loaded.config);
    if (!entry) return NextResponse.json({ error }, { status: 400 });
    entryId = entry.id;
  }

  await logAuditServer(
    db,
    { actor_id: caller.staff.id, actor_email: caller.staff.email },
    { action: 'email_flow.entry_added', entity_type: 'email_flow_entry', entity_id: entryId },
  );

  const result = loaded.config.settings.enabled ? await processOne(db, entryId) : null;
  return NextResponse.json({ id: entryId, sent: result?.sent ?? 0 }, { status: 201 });
}
