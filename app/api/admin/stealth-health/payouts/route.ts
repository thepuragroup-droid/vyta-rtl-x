import { NextRequest, NextResponse } from 'next/server';
import { logAuditServer } from '@/lib/admin/audit';
import {
  db,
  requireReader,
  requireAdmin,
  loadTerms,
  isMissingSchema,
} from '@/lib/admin/stealth-health-server';

export const dynamic = 'force-dynamic';

const MIGRATION_HINT =
  'Run stealth-health-settlement-migration.sql in Supabase before recording payouts.';

function shapePayout(p: Record<string, any>, invoiceNumber: string | null) {
  return {
    id: String(p.id),
    invoice_id: p.invoice_id ? String(p.invoice_id) : null,
    invoice_number: invoiceNumber,
    amount_cents: Math.round(Number(p.amount_cents ?? 0)),
    currency: p.currency === 'CAD' ? 'CAD' : 'USD',
    received_at: p.received_at ?? '',
    method: p.method ?? null,
    reference: p.reference ?? null,
    notes: p.notes ?? null,
    created_by_email: p.created_by_email ?? null,
    created_at: p.created_at ?? '',
  };
}

/**
 * GET /api/admin/stealth-health/payouts — what Stealth Health has actually
 * remitted to us, newest first. `invoice_id` narrows it to one invoice.
 */
export async function GET(req: NextRequest) {
  if (!(await requireReader(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const page = Math.max(0, parseInt(sp.get('page') ?? '0', 10) || 0);
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') ?? '25', 10) || 25));
  const invoiceId = sp.get('invoice_id');

  let q = db
    .from('stealth_health_payouts')
    .select('*', { count: 'exact' })
    .order('received_at', { ascending: false })
    .order('created_at', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);
  if (invoiceId) q = q.eq('invoice_id', invoiceId);

  const { data, count, error } = await q;
  if (error) {
    if (isMissingSchema(error)) {
      return NextResponse.json({ payouts: [], total: 0, page, pageSize, migrated: false });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as any[];

  // Resolve invoice numbers so the table can name what each payout settled.
  const ids = [...new Set(rows.map((r) => r.invoice_id).filter(Boolean).map(String))];
  const numbers = new Map<string, string>();
  if (ids.length > 0) {
    const { data: invs } = await db
      .from('stealth_health_invoices')
      .select('id, invoice_number')
      .in('id', ids);
    for (const i of (invs ?? []) as any[]) numbers.set(String(i.id), String(i.invoice_number));
  }

  return NextResponse.json({
    payouts: rows.map((r) => shapePayout(r, r.invoice_id ? numbers.get(String(r.invoice_id)) ?? null : null)),
    total: count ?? rows.length,
    page,
    pageSize,
    migrated: true,
  });
}

/**
 * POST — record money received from Stealth Health. Admin only.
 *
 * `invoice_id` is optional: a remittance can settle a specific invoice or be
 * recorded on account (it still counts against the overall balance owed).
 */
export async function POST(req: NextRequest) {
  const actor = await requireAdmin(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const amountCents = Math.round(Number(body.amount_cents));
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return NextResponse.json({ error: 'amount must be greater than zero' }, { status: 400 });
  }

  const receivedAt = String(body.received_at ?? '').trim();
  if (receivedAt && !/^\d{4}-\d{2}-\d{2}$/.test(receivedAt)) {
    return NextResponse.json({ error: 'received_at must be YYYY-MM-DD' }, { status: 400 });
  }

  const invoiceId = body.invoice_id ? String(body.invoice_id) : null;
  if (invoiceId) {
    const { data: inv, error } = await db
      .from('stealth_health_invoices')
      .select('id, status')
      .eq('id', invoiceId)
      .maybeSingle();
    if (error && isMissingSchema(error)) {
      return NextResponse.json({ error: MIGRATION_HINT }, { status: 409 });
    }
    if (!inv) return NextResponse.json({ error: 'That invoice does not exist' }, { status: 400 });
    if (String(inv.status) === 'void') {
      return NextResponse.json(
        { error: 'That invoice is void — record the payout on account instead.' },
        { status: 400 },
      );
    }
  }

  const { terms } = await loadTerms();

  const { data, error } = await db
    .from('stealth_health_payouts')
    .insert({
      invoice_id: invoiceId,
      amount_cents: amountCents,
      currency: body.currency === 'CAD' ? 'CAD' : body.currency === 'USD' ? 'USD' : terms.currency,
      received_at: receivedAt || new Date().toISOString().slice(0, 10),
      method: String(body.method ?? '').trim() || null,
      reference: String(body.reference ?? '').trim() || null,
      notes: String(body.notes ?? '').trim() || null,
      created_by: actor.id,
      created_by_email: actor.email,
    })
    .select('*')
    .single();

  if (error) {
    if (isMissingSchema(error)) return NextResponse.json({ error: MIGRATION_HINT }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // A payout against a draft means the invoice was in fact issued — move it on
  // so the dashboard stops counting it as unsent. `partial`/`paid` are derived
  // from the totals, so `sent` is all that needs writing.
  if (invoiceId) {
    await db
      .from('stealth_health_invoices')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', invoiceId)
      .eq('status', 'draft');
  }

  await logAuditServer(db, { actor_id: actor.id, actor_email: actor.email }, {
    action: 'create',
    entity_type: 'stealth_health_payout',
    entity_id: String(data.id),
  });

  return NextResponse.json({ payout: shapePayout(data, null) }, { status: 201 });
}
