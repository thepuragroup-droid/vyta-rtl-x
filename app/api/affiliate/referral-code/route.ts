import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveAffiliateCaller } from '@/lib/affiliate/route-auth';
import {
  assignReferralCode,
  checkReferralCodeAvailability,
  getCurrentReferralCode,
  proposeReferralCode,
  CODE_IS_YOURS,
  CODE_SPOKEN_FOR,
} from '@/lib/affiliate/referral-code-service';
import { normalizeReferralCode, referralCodeFormatError } from '@/lib/affiliate/utils';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * THE PRIVACY BOUNDARY.
 *
 * `decision_notes` and `decided_by_name` are deliberately absent. An affiliate
 * is told that a code request was declined and nothing more — the reason and
 * the reviewer's name are for the admin desk. This is enforced here, by column
 * selection, and NOT by RLS: `referral_code_requests` has RLS on with no
 * policies precisely so no row-level rule can hand over the whole row.
 */
const AFFILIATE_VISIBLE =
  'id, requested_code, previous_code, status, source, created_at, decided_at';

// GET - the affiliate's code, their open request, their history, a suggestion.
export async function GET(req: NextRequest) {
  const caller = await resolveAffiliateCaller(db, req);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const affiliate = caller.affiliate;

  const [current, requestsRes, suggestion] = await Promise.all([
    getCurrentReferralCode(db, affiliate.id),
    db
      .from('referral_code_requests')
      .select(AFFILIATE_VISIBLE)
      .eq('affiliate_id', affiliate.id)
      .order('created_at', { ascending: false })
      .limit(10),
    proposeReferralCode(db, affiliate, affiliate.id),
  ]);

  const requests = requestsRes.data ?? [];

  return NextResponse.json({
    current,
    pending_request: requests.find((r: any) => r.status === 'pending') ?? null,
    history: requests.filter((r: any) => r.status !== 'pending'),
    suggestion,
  });
}

// POST - ask for a code.
export async function POST(req: NextRequest) {
  const caller = await resolveAffiliateCaller(db, req);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const affiliate = caller.affiliate;
  if (affiliate.status === 'rejected') {
    return NextResponse.json({ error: 'Your affiliate account is not active.' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const code = normalizeReferralCode(body?.code);

  const formatError = referralCodeFormatError(code);
  if (formatError) return NextResponse.json({ error: formatError }, { status: 400 });

  const current = await getCurrentReferralCode(db, affiliate.id);
  if (current?.code === code) {
    return NextResponse.json({ error: CODE_IS_YOURS }, { status: 400 });
  }

  const availability = await checkReferralCodeAvailability(db, code, affiliate.id);
  if (!availability.available) {
    return NextResponse.json({ error: availability.reason }, { status: 409 });
  }

  const { data: openRequest } = await db
    .from('referral_code_requests')
    .select('id')
    .eq('affiliate_id', affiliate.id)
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle();

  if (openRequest) {
    return NextResponse.json(
      { error: 'You already have a request awaiting review. Withdraw it first.' },
      { status: 409 },
    );
  }

  // Granted immediately: nobody holds the code, and no working code is being
  // replaced. There is nothing to review, so there is no queue to join.
  if (!current && affiliate.status === 'approved') {
    const assigned = await assignReferralCode(db, affiliate.id, code);
    if (!assigned.ok) {
      return NextResponse.json({ error: assigned.error }, { status: assigned.status ?? 500 });
    }

    const { data: request } = await db
      .from('referral_code_requests')
      .insert({
        affiliate_id: affiliate.id,
        requested_code: code,
        previous_code: null,
        status: 'approved',
        source: 'affiliate',
        decided_at: new Date().toISOString(),
      })
      .select(AFFILIATE_VISIBLE)
      .single();

    return NextResponse.json({
      granted: true,
      current: { code, uses: 0, active: true },
      request: request ?? null,
    });
  }

  const { data: request, error } = await db
    .from('referral_code_requests')
    .insert({
      affiliate_id: affiliate.id,
      requested_code: code,
      previous_code: current?.code ?? null,
      status: 'pending',
      source: 'affiliate',
    })
    .select(AFFILIATE_VISIBLE)
    .single();

  if (error) {
    // Lost the race at one of the partial unique indexes.
    if (error.code === '23505') {
      return NextResponse.json({ error: CODE_SPOKEN_FOR }, { status: 409 });
    }
    console.error('referral code request insert failed:', error);
    return NextResponse.json({ error: 'Could not save the request.' }, { status: 500 });
  }

  return NextResponse.json({ granted: false, request }, { status: 201 });
}

// DELETE - withdraw the open request.
export async function DELETE(req: NextRequest) {
  const caller = await resolveAffiliateCaller(db, req);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const { error } = await db
    .from('referral_code_requests')
    .update({ status: 'withdrawn', decided_at: new Date().toISOString() })
    .eq('affiliate_id', caller.affiliate.id)
    .eq('status', 'pending');

  if (error) {
    console.error('withdraw referral code request failed:', error);
    return NextResponse.json({ error: 'Could not withdraw the request.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
