import { NextRequest, NextResponse } from 'next/server';
import { logAuditServer } from '@/lib/admin/audit';
import {
  db,
  requireReader,
  requireAdmin,
  loadTerms,
  loadLedgerRows,
  loadPayoutsByInvoice,
  isMissingSchema,
  shapeSettlementInvoice,
} from '@/lib/admin/stealth-health-server';
import { computeOrderSettlement, normalizeTerms } from '@/lib/admin/stealth-health';

export const dynamic = 'force-dynamic';

const EDITABLE_STATUSES = new Set(['draft', 'sent', 'paid', 'void']);

async function fetchInvoice(id: string) {
  const { data, error } = await db
    .from('stealth_health_invoices')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return { row: null, missingSchema: true };
    console.error('[stealth-health] invoice read failed:', error);
    return { row: null, missingSchema: false };
  }
  return { row: data, missingSchema: false };
}

/**
 * GET — one settlement invoice with the hand-offs it billed and the payouts
 * received against it. The per-order lines are re-derived from the TERMS
 * FROZEN ON THE INVOICE, not the current ones, so an invoice already sent
 * always adds up to the amount it claims.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireReader(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  const { id } = await params;

  const { row, missingSchema } = await fetchInvoice(id);
  if (missingSchema) {
    return NextResponse.json(
      { error: 'Run stealth-health-settlement-migration.sql in Supabase first.' },
      { status: 409 },
    );
  }
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const paid = await loadPayoutsByInvoice([id]);
  const invoice = shapeSettlementInvoice(row, paid[id] ?? 0);

  // Re-derive the lines under the invoice's own snapshot of the terms.
  const { terms } = await loadTerms();
  const frozenTerms = normalizeTerms({
    ...terms,
    commission_pct: row.commission_pct,
    flat_fee_cents: row.flat_fee_cents,
    shipping_remitted: row.shipping_remitted,
    // Every billed order contributed the same flat shipment fee; recover it
    // from the invoice's own total so a later change to the fee can't restate
    // an invoice that has already gone out.
    shipping_fee_cents: Number(row.order_count ?? 0) > 0
      ? Math.round(Number(row.shipping_cents ?? 0) / Number(row.order_count))
      : terms.shipping_fee_cents,
    currency: row.currency,
  });

  const { rows: ledger } = await loadLedgerRows({ invoiceId: id });
  const orders = ledger.map((o) => ({
    ...computeOrderSettlement(o, frozenTerms),
    partner_reference: (o as any).partner_reference ?? null,
    transaction_id: (o as any).transaction_id ?? null,
    customer_email: (o as any).customer_email ?? null,
    invoice_id: (o as any).invoice_id ?? null,
  }));

  const { data: payoutRows } = await db
    .from('stealth_health_payouts')
    .select('*')
    .eq('invoice_id', id)
    .order('received_at', { ascending: false });

  return NextResponse.json({
    invoice,
    orders,
    payouts: (payoutRows ?? []).map((p: any) => ({
      id: String(p.id),
      amount_cents: Math.round(Number(p.amount_cents ?? 0)),
      currency: p.currency === 'CAD' ? 'CAD' : 'USD',
      received_at: p.received_at ?? '',
      method: p.method ?? null,
      reference: p.reference ?? null,
      notes: p.notes ?? null,
    })),
  });
}

/**
 * PATCH — move an invoice through its lifecycle or edit its notes. Admin only.
 *
 * `partial` is never set by hand: it is what the payouts say. Sending an
 * invoice stamps `sent_at`; voiding it releases its orders back to unbilled so
 * they can be re-invoiced correctly.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  const { id } = await params;

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { row, missingSchema } = await fetchInvoice(id);
  if (missingSchema) {
    return NextResponse.json(
      { error: 'Run stealth-health-settlement-migration.sql in Supabase first.' },
      { status: 409 },
    );
  }
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const updates: Record<string, any> = {};

  if ('status' in body) {
    const next = String(body.status ?? '');
    if (!EDITABLE_STATUSES.has(next)) {
      return NextResponse.json(
        { error: `status must be one of ${[...EDITABLE_STATUSES].join(', ')} — "partial" follows the payouts` },
        { status: 400 },
      );
    }
    if (row.status === 'void' && next !== 'void') {
      return NextResponse.json(
        { error: 'A voided invoice cannot be reopened — raise a new one.' },
        { status: 400 },
      );
    }
    updates.status = next;
    if (next === 'sent' && !row.sent_at) updates.sent_at = new Date().toISOString();
    if (next === 'void') updates.voided_at = new Date().toISOString();
  }

  if ('notes' in body) updates.notes = String(body.notes ?? '').trim() || null;

  if ('due_date' in body) {
    const v = String(body.due_date ?? '').trim();
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      return NextResponse.json({ error: 'due_date must be YYYY-MM-DD' }, { status: 400 });
    }
    updates.due_date = v || null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const { data, error } = await db
    .from('stealth_health_invoices')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Voiding withdraws the claim: its orders go back in the unbilled pool.
  if (updates.status === 'void') {
    const { error: releaseErr } = await db
      .from('puramass_orders')
      .update({ settlement_invoice_id: null })
      .eq('settlement_invoice_id', id);
    if (releaseErr) {
      console.error('[stealth-health] releasing orders from voided invoice failed:', releaseErr);
    }
  }

  await logAuditServer(db, { actor_id: actor.id, actor_email: actor.email }, {
    action: updates.status === 'void' ? 'void' : 'update',
    entity_type: 'stealth_health_invoice',
    entity_id: id,
  });

  const paid = await loadPayoutsByInvoice([id]);
  return NextResponse.json({ invoice: shapeSettlementInvoice(data, paid[id] ?? 0) });
}

/**
 * DELETE — remove a draft invoice and release its orders. Admin only.
 *
 * Only drafts: once an invoice has been sent it is a claim we made, and the
 * audit trail keeps it. Void it instead.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  const { id } = await params;

  const { row, missingSchema } = await fetchInvoice(id);
  if (missingSchema) {
    return NextResponse.json(
      { error: 'Run stealth-health-settlement-migration.sql in Supabase first.' },
      { status: 409 },
    );
  }
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (String(row.status) !== 'draft') {
    return NextResponse.json(
      { error: 'Only a draft can be deleted — void the invoice instead so the record survives.' },
      { status: 400 },
    );
  }

  const paid = await loadPayoutsByInvoice([id]);
  if ((paid[id] ?? 0) > 0) {
    return NextResponse.json(
      { error: 'This invoice has payouts recorded against it — remove those first.' },
      { status: 400 },
    );
  }

  // Release the orders BEFORE deleting: the FK is ON DELETE SET NULL, but doing
  // it explicitly means a failed release aborts instead of silently orphaning.
  const { error: releaseErr } = await db
    .from('puramass_orders')
    .update({ settlement_invoice_id: null })
    .eq('settlement_invoice_id', id);
  if (releaseErr) {
    console.error('[stealth-health] releasing orders failed:', releaseErr);
    return NextResponse.json({ error: 'Could not release the billed orders' }, { status: 500 });
  }

  const { error } = await db.from('stealth_health_invoices').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAuditServer(db, { actor_id: actor.id, actor_email: actor.email }, {
    action: 'delete',
    entity_type: 'stealth_health_invoice',
    entity_id: id,
  });

  return NextResponse.json({ deleted: true });
}
