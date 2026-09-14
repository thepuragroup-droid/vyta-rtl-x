import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditServer } from '@/lib/admin/audit';
import { sendStockReportEmail } from '@/lib/admin/stock-report-email';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyStaff(req: NextRequest): Promise<{
  ok: boolean; role: string; actor_id: string | null; actor_email: string | null;
}> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return { ok: false, role: 'customer', actor_id: null, actor_email: null };
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) return { ok: false, role: 'customer', actor_id: null, actor_email: null };
  const { data } = await db.from('customers').select('id, email, role').eq('id', user.id).single();
  const role = data?.role ?? 'customer';
  return {
    ok: role === 'admin' || role === 'assistant',
    role,
    actor_id: data?.id ?? user.id,
    actor_email: data?.email ?? user.email ?? null,
  };
}

/**
 * POST /api/admin/products/stock-report/send
 *
 * One-off: email the current Stock Report to a list of recipients. Falls
 * back to `site_settings.stock_report_email_recipients` when no
 * `recipients` array is provided in the body.
 *
 * Does NOT touch `stock_report_email_last_sent_at` — that column tracks
 * the scheduled cron send only, so "Send now" from the admin doesn't reset
 * the next scheduled tick.
 */
export async function POST(req: NextRequest) {
  const caller = await verifyStaff(req);
  if (!caller.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let body: any = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    body = {};
  }

  let recipients: string[] = Array.isArray(body?.recipients) ? body.recipients : [];

  if (recipients.length === 0) {
    const { data } = await db
      .from('site_settings')
      .select('stock_report_email_recipients')
      .limit(1)
      .maybeSingle();
    recipients = Array.isArray(data?.stock_report_email_recipients)
      ? (data!.stock_report_email_recipients as string[])
      : [];
  }

  if (recipients.length === 0) {
    return NextResponse.json({ error: 'No recipients provided' }, { status: 400 });
  }
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  for (const address of recipients) {
    if (!EMAIL_RE.test(String(address).trim())) {
      return NextResponse.json({ error: `Invalid email: ${address}` }, { status: 400 });
    }
  }

  // Deliberately unfiltered: the emailed report always covers the whole
  // catalog, so what lands in the warehouse's inbox never depends on what the
  // admin happened to have typed in the search box.
  const result = await sendStockReportEmail(db, { recipients });

  await logAuditServer(
    db,
    { actor_id: caller.actor_id, actor_email: caller.actor_email },
    {
      action: 'product.stock_report_send',
      entity_type: 'stock_report',
      entity_id: result.success ? (result.id ?? null) : null,
    },
  );

  return NextResponse.json({
    success: result.success,
    recipients: result.recipients,
    totals: result.totals,
    error: result.error,
  }, { status: result.success ? 200 : 500 });
}
