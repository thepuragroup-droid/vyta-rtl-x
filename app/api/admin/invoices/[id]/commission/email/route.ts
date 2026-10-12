import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { callerCanWrite, getInvoiceCaller } from '@/lib/admin/invoice-access';
import { logAuditServer } from '@/lib/admin/audit';
import { sendCommissionEmailManually } from '@/lib/affiliate/commission-email';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const REASONS: Record<string, string> = {
  no_commission: 'No commission is recorded for this invoice.',
  cancelled: 'The commission is cancelled.',
  no_affiliate: 'The affiliate on this commission no longer exists.',
  error: 'Could not send the commission email.',
};

/**
 * POST /api/admin/invoices/[id]/commission/email — send the "You earned a new
 * commission" email for this invoice's booked commission to the affiliate,
 * and its copy to the admin notification list (lib/affiliate/commission-email.ts
 * `sendCommissionEmailManually`). Admin only.
 *
 * 200 with `affiliate` and `admins` ('sent' | 'send_failed' | 'no_email' |
 * 'no_recipients') when at least one of the two was attempted.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const caller = await getInvoiceCaller(db, req);
  if (!caller.ok || !callerCanWrite(caller.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const res = await sendCommissionEmailManually(db, params.id, {
    id: caller.actor_id,
    email: caller.actor_email,
  });
  if (!res.ok) {
    const status = res.reason === 'error' ? 500 : 422;
    return NextResponse.json({ error: REASONS[res.reason], reason: res.reason }, { status });
  }

  const { notice } = res;
  if (!notice.sent && (notice.reason === 'no_affiliate' || notice.reason === 'error')) {
    const status = notice.reason === 'error' ? 500 : 422;
    return NextResponse.json({ error: REASONS[notice.reason], reason: notice.reason }, { status });
  }

  const affiliate = notice.sent ? 'sent' : notice.reason;
  const admins = notice.adminCopy ?? 'no_recipients';

  await logAuditServer(
    db,
    { actor_id: caller.actor_id, actor_email: caller.actor_email },
    {
      action: 'commission.email_sent',
      entity_type: 'invoice',
      entity_id: params.id,
    },
  );
  return NextResponse.json({ affiliate, admins });
}
