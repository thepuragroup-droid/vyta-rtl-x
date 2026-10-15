import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { logAuditServer } from '@/lib/admin/audit';
import { resolveStaffCaller } from '@/lib/affiliate/route-auth';
import { firstOrderStatus } from '@/lib/promos/first-order';
import { enrollCustomer, loadConfig, processOne } from '@/lib/welcome-flow/engine';
import { SEND_SELECT, SUBSCRIBER_SELECT, shapeSubscriber } from '@/lib/welcome-flow/stats';
import { timezoneFor } from '@/lib/welcome-flow/schedule';
import { SUBSCRIBER_STATUSES } from '@/lib/welcome-flow/types';

const db = getSupabase();
const PAGE_SIZE = 50;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * GET /api/admin/welcome-flow/subscribers?status=&q=&page=
 *
 * Everyone in the flow, newest first, each with every email they have been
 * sent (opened? clicked?) and what is coming next. Staff (admin + assistant).
 */
export async function GET(req: NextRequest) {
  const caller = await resolveStaffCaller(db, req, { allowAssistant: true });
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const p = req.nextUrl.searchParams;
  const status = p.get('status');
  const q = (p.get('q') ?? '').trim().toLowerCase().replace(/[%_,()]/g, '');
  const page = Math.max(0, Number(p.get('page')) || 0);

  let query = db
    .from('welcome_flow_subscribers')
    .select(SUBSCRIBER_SELECT, { count: 'exact' })
    .order('enrolled_at', { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (status && (SUBSCRIBER_STATUSES as readonly string[]).includes(status)) query = query.eq('status', status);
  if (q) query = query.or(`email.ilike.%${q}%,first_name.ilike.%${q}%`);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (data ?? []).map((r: any) => r.id);
  const [{ data: sends }, loaded] = await Promise.all([
    ids.length ? db.from('welcome_flow_sends').select(SEND_SELECT).in('subscriber_id', ids) : Promise.resolve({ data: [] as any[] }),
    loadConfig(db),
  ]);
  const config = loaded.ok ? loaded.config : null;
  const now = new Date();

  return NextResponse.json({
    subscribers: (data ?? []).map((r: any) => shapeSubscriber(r, sends ?? [], config, now)),
    total: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
  });
}

/**
 * POST /api/admin/welcome-flow/subscribers  { email, consent: true, sendNow? }
 *
 * Add somebody by hand — for testing the series on yourself, or a customer who
 * asked to be included. Must be an account; `consent` is the admin attesting
 * the person agreed to marketing email. Someone who has already ordered is
 * refused: this is a welcome series. Admin only.
 */
export async function POST(req: NextRequest) {
  const caller = await resolveStaffCaller(db, req);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? '').trim().toLowerCase();
  if (!EMAIL.test(email)) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  if (body?.consent !== true) {
    return NextResponse.json({ error: 'Confirm this person agreed to receive marketing email.' }, { status: 400 });
  }

  const loaded = await loadConfig(db);
  if (!loaded.ok) return NextResponse.json({ error: 'Run the welcome flow migration first.' }, { status: 400 });

  const { data: customer } = await db
    .from('customers')
    .select('id, email, first_name, shipping_state, shipping_country, active')
    .ilike('email', email.replace(/[\\%_]/g, (c) => `\\${c}`))
    .limit(1)
    .maybeSingle();
  if (!customer) return NextResponse.json({ error: 'No account uses that email. They need to sign up first.' }, { status: 404 });
  if (customer.active === false) return NextResponse.json({ error: 'That account is deactivated.' }, { status: 400 });

  const { data: existing } = await db.from('welcome_flow_subscribers').select('id, status').eq('customer_id', customer.id).maybeSingle();
  if (existing) return NextResponse.json({ error: `Already in the flow (${existing.status}).` }, { status: 409 });

  if ((await firstOrderStatus(db, { customerId: customer.id, email })) !== 'first') {
    return NextResponse.json({ error: 'This person has already ordered, so the welcome series does not apply.' }, { status: 400 });
  }

  const sub = await enrollCustomer(db, customer, loaded.config.settings, 'manual');
  if (!sub) return NextResponse.json({ error: 'Could not add them to the flow.' }, { status: 500 });

  await logAuditServer(
    db,
    { actor_id: caller.staff.id, actor_email: caller.staff.email },
    { action: 'welcome_flow.subscriber_added', entity_type: 'welcome_flow_subscriber', entity_id: sub.id },
  );

  // Email 1 is "immediately after signup" — honour that for a manual add too,
  // when the flow is on. Every rule still applies (purchase, code, consent).
  const result = loaded.config.settings.enabled ? await processOne(db, sub.id) : null;
  return NextResponse.json(
    { subscriber: sub, timezone: timezoneFor(customer.shipping_state, customer.shipping_country, loaded.config.settings.default_timezone), sent: result?.sent ?? 0 },
    { status: 201 },
  );
}
