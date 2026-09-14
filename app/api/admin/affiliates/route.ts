import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditServer } from '@/lib/admin/audit';
import { hashPassword, normalizeReferralCode, referralCodeFormatError } from '@/lib/affiliate/utils';
import {
  assignReferralCode,
  checkReferralCodeAvailability,
  proposeReferralCode,
} from '@/lib/affiliate/referral-code-service';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyAdmin(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { ok: false, userId: null as string | null, actor_email: null as string | null };
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { ok: false, userId: null, actor_email: null };
  const { data } = await db.from('customers').select('id, email, role').eq('id', user.id).single();
  const ok = data?.role === 'admin';
  return { ok, userId: user.id, actor_email: data?.email ?? user.email ?? null };
}

// POST - Create affiliate (Auth user + affiliates + referral_codes + customers + sales_persons)
export async function POST(req: NextRequest) {
  const { ok, userId, actor_email } = await verifyAdmin(req);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  try {
    const body = await req.json();
    const { first_name, last_name, email, wallet_address, active, password } = body;

    if (!first_name || !last_name || !email) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // The code is settled BEFORE the auth user is created. A collision is the
    // likeliest way this request fails, and failing early costs nothing —
    // whereas failing after provisioning means rolling back an auth user just
    // to say "try another code".
    let code: string;
    if (body.referral_code) {
      code = normalizeReferralCode(body.referral_code);
      const formatError = referralCodeFormatError(code);
      if (formatError) return NextResponse.json({ error: formatError }, { status: 400 });
      const availability = await checkReferralCodeAvailability(db, code);
      if (!availability.available) {
        return NextResponse.json({ error: availability.reason }, { status: 409 });
      }
    } else {
      code = await proposeReferralCode(db, { first_name, last_name });
    }

    const lowerEmail = String(email).toLowerCase();
    const rawPassword = password || globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID();

    // 1. Auth user
    const { data: authUser, error: authError } = await db.auth.admin.createUser({
      email: lowerEmail,
      password: rawPassword,
      email_confirm: true,
      user_metadata: { first_name, last_name },
    });
    if (authError || !authUser.user) {
      return NextResponse.json({ error: authError?.message || 'Failed to create auth user' }, { status: 500 });
    }
    const uid = authUser.user.id;

    // 2. affiliates row (legacy password_hash column kept via sha256)
    const { error: affError } = await db.from('affiliates').insert({
      id: uid,
      email: lowerEmail,
      first_name,
      last_name,
      wallet_address: wallet_address || null,
      password_hash: await hashPassword(rawPassword),
      active: active ?? true,
    });
    if (affError) {
      // Rollback the auth user.
      await db.auth.admin.deleteUser(uid);
      return NextResponse.json({ error: affError.message }, { status: 500 });
    }

    // 3. referral code — the one write path.
    const assigned = await assignReferralCode(db, uid, code);
    if (!assigned.ok) {
      console.error('referral code assignment failed for new affiliate:', assigned.error);
    }

    // 4. customers row (upsert → role affiliate). Converges with request-approve.
    await db.from('customers').upsert({
      id: uid,
      email: lowerEmail,
      first_name,
      last_name,
      role: 'affiliate',
      is_admin: false,
      active: active ?? true,
      email_verified: true,
      affiliate_id: uid,
    }, { onConflict: 'id' });

    // 5. linked sales_person (if none yet)
    const { data: existingSp } = await db
      .from('sales_persons')
      .select('id')
      .eq('user_id', uid)
      .maybeSingle();
    if (!existingSp) {
      await db.from('sales_persons').insert({
        first_name,
        last_name,
        email: lowerEmail,
        user_id: uid,
        active: active ?? true,
      });
    }

    await logAuditServer(db, { actor_id: userId, actor_email }, {
      action: 'affiliate.create',
      entity_type: 'affiliate',
      entity_id: uid,
    });

    return NextResponse.json({
      success: true,
      affiliate_id: uid,
      referral_code: assigned.ok ? assigned.code : null,
    });
  } catch (error: any) {
    console.error('Error creating affiliate:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
