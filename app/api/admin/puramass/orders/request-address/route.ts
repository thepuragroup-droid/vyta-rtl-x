/**
 * POST /api/admin/puramass/orders/request-address
 *
 * Emails the buyer a private link asking for the shipping address PuraMass
 * never reported, so a paid order stops being unshippable. Admin/assistant
 * only — the same bar as the sync/refresh actions next to it on
 * /admin/stealth-health (Orders tab).
 *
 * Body: { id: string, email?: string, cc?: string | string[], note?: string }
 *   id    — puramass_orders.id
 *   email — override recipient (defaults to the order's customer_email)
 *   cc    — optional copies (comma/semicolon separated, or an array)
 *   note  — optional line from the admin, shown in the email
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { UserRole } from '@/lib/permissions';
import { logAuditServer } from '@/lib/admin/audit';
import {
  createAddressRequest,
  loadLedgerRow,
  markAddressRequestSent,
  parseCcList,
  MAX_CC_RECIPIENTS,
} from '@/lib/payments/puramass-address-request';
import { buildOrderSummary } from '@/lib/payments/puramass-order-summary';
import { sendMissingAddressEmail } from '@/lib/payments/puramass-address-email';
import { toShippingAddress } from '@/lib/payments/puramass-address';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type Caller =
  | { ok: false }
  | { ok: true; actorId: string; actorEmail: string | null };

async function verifyCaller(req: NextRequest): Promise<Caller> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { ok: false };
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { ok: false };
  const { data } = await db.from('customers').select('role, email').eq('id', user.id).single();
  const role = (data?.role ?? 'customer') as UserRole;
  if (role !== 'admin' && role !== 'assistant') return { ok: false };
  return { ok: true, actorId: user.id, actorEmail: data?.email ?? user.email ?? null };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const caller = await verifyCaller(req);
  if (!caller.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = String(body?.id ?? '').trim();
  if (!id) {
    return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  }
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : null;

  const order = await loadLedgerRow(db, id);
  if (!order) {
    return NextResponse.json({ error: 'No matching order found.' }, { status: 404 });
  }

  const override = typeof body?.email === 'string' ? body.email.trim() : '';
  if (override && !EMAIL_RE.test(override)) {
    return NextResponse.json({ error: 'That email address is not valid.' }, { status: 400 });
  }
  const to = override || order.customer_email || '';
  if (!to) {
    return NextResponse.json(
      { error: 'This order has no customer email — there is nobody to ask.' },
      { status: 400 },
    );
  }

  // A mistyped CC is reported rather than dropped: silently losing a copy looks
  // like a delivery failure days later, when nobody remembers this send.
  const cc = parseCcList(body?.cc, to);
  if (cc.invalid.length > 0) {
    return NextResponse.json(
      {
        error: `Not a valid email address: ${cc.invalid.join(', ')}`,
        field: 'cc',
      },
      { status: 400 },
    );
  }
  if (cc.truncated) {
    return NextResponse.json(
      { error: `You can copy at most ${MAX_CC_RECIPIENTS} people on one request.`, field: 'cc' },
      { status: 400 },
    );
  }

  const created = await createAddressRequest(db, order, to);
  if ('error' in created) {
    // The table arrives with puramass-missing-address-migration.sql; say so
    // rather than leaving an admin guessing at a raw PostgREST error.
    return NextResponse.json(
      {
        error: `Could not create the address request: ${created.error}. If this mentions a missing table, run puramass-missing-address-migration.sql.`,
      },
      { status: 500 },
    );
  }

  const summary = await buildOrderSummary(db, order);
  const sent = await sendMissingAddressEmail({
    to,
    summary,
    link: created.link,
    note,
    ...(cc.list.length > 0 ? { cc: cc.list } : {}),
    // Replies land with whoever asked, not in a noreply void.
    ...(caller.actorEmail ? { replyTo: caller.actorEmail } : {}),
  });

  if (!sent.success) {
    // The link is live either way — hand it back so the admin can send it
    // another way instead of the send failure being a dead end.
    return NextResponse.json(
      { error: `The address request could not be emailed: ${sent.error}`, link: created.link },
      { status: 502 },
    );
  }

  const sent_at = await markAddressRequestSent(db, created.request, {
    actor_id: caller.actorId,
    actor_email: caller.actorEmail,
  });

  await logAuditServer(
    db,
    { actor_id: caller.actorId, actor_email: caller.actorEmail },
    {
      action: 'puramass.address_request_sent',
      entity_type: 'puramass_order',
      entity_id: order.id,
    },
  );

  return NextResponse.json({
    success: true,
    email: to,
    cc: cc.list,
    link: created.link,
    reused: created.reused,
    sent_at,
    expires_at: created.request.expires_at,
    had_address: toShippingAddress(order.shipping_address) !== null,
  });
}
