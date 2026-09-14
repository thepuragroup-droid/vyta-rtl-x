import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditServer } from '@/lib/admin/audit';
import { hashPassword, normalizeReferralCode, referralCodeFormatError } from '@/lib/affiliate/utils';
import {
  assignReferralCode,
  checkReferralCodeAvailability,
  proposeReferralCode,
} from '@/lib/affiliate/referral-code-service';
import { sendAffiliateRequestDecision } from '@/lib/email';

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
  return { ok: data?.role === 'admin', userId: user.id, actor_email: data?.email ?? user.email ?? null };
}

// PATCH - approve / deny an affiliate request
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { ok, userId, actor_email } = await verifyAdmin(req);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  try {
    const body = await req.json().catch(() => ({}));
    const { action } = body;
    if (action !== 'approve' && action !== 'deny') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Load the request + its customer.
    const { data: request } = await db
      .from('affiliate_requests')
      .select('*, customers!affiliate_requests_customer_id_fkey (first_name, last_name, email)')
      .eq('id', params.id)
      .single();

    if (!request) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }
    if (request.status !== 'pending') {
      return NextResponse.json({ error: 'Request already reviewed' }, { status: 409 });
    }

    const customer = request.customers as { first_name: string; last_name: string; email: string };
    const customerId = request.customer_id as string;

    if (action === 'deny') {
      await db
        .from('affiliate_requests')
        .update({ status: 'denied', reviewed_by: userId, reviewed_at: new Date().toISOString() })
        .eq('id', params.id);

      await sendAffiliateRequestDecision({
        to: customer.email,
        customerName: `${customer.first_name} ${customer.last_name}`,
        approved: false,
      });

      await logAuditServer(db, { actor_id: userId, actor_email }, {
        action: 'affiliate_request.deny',
        entity_type: 'affiliate_request',
        entity_id: params.id,
      });

      return NextResponse.json({ success: true });
    }

    // APPROVE: promote role → upsert affiliate → code → linked sales_person.
    await db.from('customers').update({ role: 'affiliate', affiliate_id: customerId }).eq('id', customerId);

    await db.from('affiliates').upsert({
      id: customerId,
      email: customer.email.toLowerCase(),
      first_name: customer.first_name,
      last_name: customer.last_name,
      wallet_address: request.wallet_address || null,
      password_hash: await hashPassword(globalThis.crypto.randomUUID()),
      active: true,
    }, { onConflict: 'id' });

    // Which code they get, in order:
    //   1. one the admin typed into the approve dialog;
    //   2. THE CODE THEY ASKED FOR ON THE APPLICATION, if it is still free —
    //      approving the person approves their choice, and making them ask
    //      again for what they already asked for is a queue nobody needs;
    //   3. AMC + surname + 10, then the ladder, then random.
    //
    // Guarded on "they have no code yet": approving an affiliate who somehow
    // already has one does not touch it.
    const { data: existingCodes } = await db
      .from('referral_codes')
      .select('code')
      .eq('affiliate_id', customerId)
      .limit(1);

    let code: string | null = existingCodes?.[0]?.code ?? null;
    if (!code) {
      let chosen: string | null = null;

      if (body.referral_code) {
        chosen = normalizeReferralCode(body.referral_code);
        const formatError = referralCodeFormatError(chosen);
        if (formatError) return NextResponse.json({ error: formatError }, { status: 400 });
        const availability = await checkReferralCodeAvailability(db, chosen, customerId);
        if (!availability.available) {
          return NextResponse.json({ error: availability.reason }, { status: 409 });
        }
      } else if (request.requested_code) {
        const asked = normalizeReferralCode(request.requested_code);
        const availability = await checkReferralCodeAvailability(db, asked, customerId);
        if (availability.available) chosen = asked;
      }

      if (!chosen) {
        chosen = await proposeReferralCode(
          db,
          { first_name: customer.first_name, last_name: customer.last_name },
          customerId,
        );
      }

      const assigned = await assignReferralCode(db, customerId, chosen);
      if (!assigned.ok) {
        return NextResponse.json({ error: assigned.error }, { status: assigned.status ?? 500 });
      }
      code = assigned.code ?? chosen;

      // Record what was issued against what they asked for, so the code
      // history reads straight and the queue never shows an answered ask.
      if (request.requested_code) {
        const asked = normalizeReferralCode(request.requested_code);
        const same = asked === code;
        await db.from('referral_code_requests').insert({
          affiliate_id: customerId,
          requested_code: asked,
          previous_code: null,
          status: same ? 'approved' : 'rejected',
          source: 'affiliate',
          decided_by: userId,
          decided_by_name: actor_email,
          decided_at: new Date().toISOString(),
          decision_notes: same ? null : `Issued ${code} on approval instead.`,
        });
      }
    }

    // Linked sales_person.
    const { data: existingSp } = await db
      .from('sales_persons')
      .select('id')
      .eq('user_id', customerId)
      .maybeSingle();
    if (!existingSp) {
      await db.from('sales_persons').insert({
        first_name: customer.first_name,
        last_name: customer.last_name,
        email: customer.email.toLowerCase(),
        user_id: customerId,
        active: true,
      });
    }

    await db
      .from('affiliate_requests')
      .update({ status: 'approved', reviewed_by: userId, reviewed_at: new Date().toISOString() })
      .eq('id', params.id);

    await sendAffiliateRequestDecision({
      to: customer.email,
      customerName: `${customer.first_name} ${customer.last_name}`,
      approved: true,
      referralCode: code ?? undefined,
    });

    await logAuditServer(db, { actor_id: userId, actor_email }, {
      action: 'affiliate_request.approve',
      entity_type: 'affiliate_request',
      entity_id: params.id,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error reviewing affiliate request:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
