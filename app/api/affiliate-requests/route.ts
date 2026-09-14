import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendAffiliateRequestAdminNotification } from '@/lib/email';
import { normalizeReferralCode, referralCodeFormatError } from '@/lib/affiliate/utils';
import { checkReferralCodeAvailability } from '@/lib/affiliate/referral-code-service';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function getCaller(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return null;
  const { data: customer } = await db
    .from('customers')
    .select('id, first_name, last_name, email, role')
    .eq('id', user.id)
    .single();
  return customer ?? null;
}

// GET - caller's most recent request + role
export async function GET(req: NextRequest) {
  const caller = await getCaller(req);
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: request } = await db
    .from('affiliate_requests')
    .select('*')
    .eq('customer_id', caller.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ request: request ?? null, role: caller.role });
}

// POST - apply to become an affiliate (idempotent pending)
export async function POST(req: NextRequest) {
  const caller = await getCaller(req);
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (caller.role === 'affiliate') {
    return NextResponse.json({ error: 'You are already an affiliate' }, { status: 400 });
  }

  try {
    const { wallet_address, message, requested_code } = await req.json().catch(() => ({}));

    // The applicant's code choice rides on the application. It is NOT issued
    // here: a live referral_codes row for someone no admin has approved reads
    // as valid in the checkout field while the server refuses to honour it.
    // The choice is held and issued the moment the application is approved.
    let code: string | null = null;
    if (requested_code) {
      code = normalizeReferralCode(requested_code);
      const formatError = referralCodeFormatError(code);
      if (formatError) return NextResponse.json({ error: formatError }, { status: 400 });
      const availability = await checkReferralCodeAvailability(db, code, caller.id);
      if (!availability.available) {
        return NextResponse.json({ error: availability.reason }, { status: 409 });
      }
    }

    const { data: inserted, error } = await db
      .from('affiliate_requests')
      .insert({
        customer_id: caller.id,
        status: 'pending',
        wallet_address: wallet_address || null,
        message: message || null,
        requested_code: code,
      })
      .select()
      .single();

    if (error) {
      // Partial-unique violation → already has a pending request.
      if (error.code === '23505') {
        return NextResponse.json({ success: true, alreadyPending: true });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Notify admins (best-effort; never blocks the request).
    let adminEmails: string[] | undefined;
    try {
      const { data: settings } = await db.from('site_settings').select('*').limit(1).single();
      if (Array.isArray((settings as any)?.admin_emails)) {
        adminEmails = (settings as any).admin_emails;
      }
    } catch {
      adminEmails = undefined;
    }

    sendAffiliateRequestAdminNotification({
      customerName: `${caller.first_name} ${caller.last_name}`,
      customerEmail: caller.email,
      walletAddress: wallet_address || null,
      message: message || null,
      to: adminEmails,
    }).catch((e) => console.error('affiliate request admin notify failed:', e));

    return NextResponse.json({ success: true, request: inserted });
  } catch (error: any) {
    console.error('Error creating affiliate request:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
