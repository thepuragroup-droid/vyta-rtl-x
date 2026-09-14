import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyWarehouse } from '@/lib/warehouse/server';
import { logAuditServer } from '@/lib/admin/audit';
import { sendPackingList } from '@/lib/admin/send-packing-list';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// pdfkit + nodemailer are Node-only.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/warehouse/queue/[id]/packing-list
 *
 * Manually (re)send the Packing List email for a client shipment. Auto-send
 * on Shipped is handled by the PATCH route via `after()`; this endpoint is
 * the "resend" affordance for the queue detail pane.
 *
 * Body (all optional):
 *   { to?: string, notes?: string }
 *
 * Auth: warehouse or admin, and must have email-send capability
 * (`can_send_fulfillment_emails` for warehouse; admins always allowed).
 * Returns 400 when the invoice isn't a client shipment (so the caller
 * can surface a friendly message instead of a mystery failure).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await verifyWarehouse(db, req);
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  if (!auth.canSendEmails) {
    return NextResponse.json(
      { error: 'This account is not permitted to send customer emails.' },
      { status: 403 },
    );
  }

  let body: any = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    body = {};
  }

  const result = await sendPackingList(db, params.id, {
    to: typeof body.to === 'string' ? body.to.trim() || undefined : undefined,
    notes: typeof body.notes === 'string' ? body.notes.trim() || undefined : undefined,
    actor_id: auth.actorId ?? null,
    actor_email: auth.actorEmail ?? null,
  });

  if (result.ok === false) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  if (result.skipped) {
    // Not a client shipment / no client / no line items — return 400 so the
    // UI can surface the reason directly.
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 400 });
  }

  await logAuditServer(
    db,
    { actor_id: auth.actorId ?? null, actor_email: auth.actorEmail ?? null },
    {
      action: 'fulfillment.packing_list_sent',
      entity_type: 'invoice',
      entity_id: params.id,
    },
  );

  return NextResponse.json({
    ok: true,
    to: result.to,
    message_id: result.message_id,
    sent_at: result.sent_at,
  });
}
