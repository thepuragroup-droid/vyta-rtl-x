import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditServer } from '@/lib/admin/audit';
import { resolveStaffCaller } from '@/lib/affiliate/route-auth';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * DELETE /api/admin/affiliates/[id]/payouts/[payoutId] — void a payout that
 * was recorded by mistake. Admin only. The commissions it settled go back to
 * pending (the earnings trigger takes their amounts back off total_earnings).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; payoutId: string } },
) {
  const caller = await resolveStaffCaller(db, req);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const { data: payout } = await db
    .from('affiliate_payouts')
    .select('id')
    .eq('id', params.payoutId)
    .eq('affiliate_id', params.id)
    .maybeSingle();
  if (!payout) return NextResponse.json({ error: 'Payout not found' }, { status: 404 });

  const { error: revertError } = await db
    .from('commissions')
    .update({ status: 'pending', paid_at: null, payout_id: null })
    .eq('payout_id', params.payoutId);
  if (revertError) {
    console.error('[payouts] reverting commissions failed:', revertError);
    return NextResponse.json({ error: 'Could not void the payout' }, { status: 500 });
  }

  const { error } = await db.from('affiliate_payouts').delete().eq('id', params.payoutId);
  if (error) {
    console.error('[payouts] delete failed:', error);
    return NextResponse.json({ error: 'Could not void the payout' }, { status: 500 });
  }

  await logAuditServer(
    db,
    { actor_id: caller.staff.id, actor_email: caller.staff.email },
    { action: 'affiliate_payout.void', entity_type: 'affiliate', entity_id: params.id },
  );

  return NextResponse.json({ voided: true });
}
