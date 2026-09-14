import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveStaffCaller } from '@/lib/affiliate/route-auth';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * GET /api/admin/referral-code-requests?status=pending|decided|all&affiliate_id=&limit=
 *
 * Returns FULL rows — `decision_notes` and `decided_by_name` included.
 * "Declined, and here is who said so and why" is the whole point of the admin
 * side; the affiliate-facing route selects a narrower column list instead.
 */
export async function GET(req: NextRequest) {
  const caller = await resolveStaffCaller(db, req, { allowAssistant: true });
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const params = new URL(req.url).searchParams;
  const status = params.get('status') ?? 'pending';
  const affiliateId = params.get('affiliate_id');
  const limit = Math.min(Math.max(Number(params.get('limit')) || 50, 1), 200);

  let query = db
    .from('referral_code_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status === 'pending') query = query.eq('status', 'pending');
  else if (status === 'decided') query = query.neq('status', 'pending');
  if (affiliateId) query = query.eq('affiliate_id', affiliateId);

  const { data, error } = await query;
  if (error) {
    console.error('referral code request queue failed:', error);
    return NextResponse.json({ error: 'Could not load the queue.' }, { status: 500 });
  }

  const requests = data ?? [];

  // The affiliate join is a SEPARATE query, not a foreign-table select: the
  // queue degrades to codes-without-names if the affiliates read fails,
  // instead of 500-ing the whole panel.
  const ids = Array.from(new Set(requests.map((r) => r.affiliate_id)));
  const names = new Map<string, { name: string | null; email: string | null }>();
  if (ids.length > 0) {
    const { data: affiliates } = await db
      .from('affiliates')
      .select('id, first_name, last_name, email')
      .in('id', ids);
    for (const a of affiliates ?? []) {
      const name = `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim();
      names.set(a.id, { name: name || null, email: a.email ?? null });
    }
  }

  return NextResponse.json({
    requests: requests.map((r) => ({
      ...r,
      affiliate_name: names.get(r.affiliate_id)?.name ?? null,
      affiliate_email: names.get(r.affiliate_id)?.email ?? null,
    })),
  });
}
