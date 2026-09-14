import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveSignedInUser } from '@/lib/affiliate/route-auth';
import { checkReferralCodeAvailability } from '@/lib/affiliate/referral-code-service';
import { normalizeReferralCode } from '@/lib/affiliate/utils';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * GET /api/affiliate/referral-code/check?code=…&affiliate_id=…
 *
 * Open to ANY signed-in user: both the affiliate portal and the admin desk
 * need it, and referral codes are public by design — checkout validates them
 * without authentication at all.
 *
 * `affiliate_id` says whose ownership of the code is forgiven, which is what
 * stops the admin editor reporting a partner's own code as taken from them:
 *
 *   absent          -> the caller's own id
 *   a uuid          -> that affiliate
 *   'none' / empty  -> nobody (the create-affiliate form, where no affiliate
 *                      exists yet)
 */
export async function GET(req: NextRequest) {
  const user = await resolveSignedInUser(db, req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const code = normalizeReferralCode(params.get('code'));

  const affiliateParam = params.get('affiliate_id');
  let affiliateId: string | null;
  if (affiliateParam === null) {
    affiliateId = user.id;
  } else if (affiliateParam === 'none' || affiliateParam === '') {
    affiliateId = null;
  } else {
    affiliateId = affiliateParam;
  }

  const { available, reason } = await checkReferralCodeAvailability(db, code, affiliateId);
  return NextResponse.json({ code, available, reason });
}
