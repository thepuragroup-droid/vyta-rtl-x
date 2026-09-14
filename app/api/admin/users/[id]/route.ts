import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';
import { logAuditServer } from '@/lib/admin/audit';

const BAN_FOREVER = '876600h';

// Verify admin access and resolve the acting admin (for audit).
async function verifyAdmin(accessToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken);
  if (!user || userError) return null;

  const adminClient = getSupabase();
  const { data: customer } = await adminClient
    .from('customers')
    .select('role, email')
    .eq('id', user.id)
    .single();

  if (customer?.role !== 'admin') return null;
  return { userId: user.id, actor_email: customer.email ?? user.email ?? null };
}

// PUT - Update user (Auth first, then profile, so a failed Auth sync never
// leaves the customers table ahead of the auth user).
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const accessToken = request.headers.get('authorization')?.replace('Bearer ', '');
    const actor = accessToken ? await verifyAdmin(accessToken) : null;
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = params.id;
    const body = await request.json();
    const newPassword = body.new_password ?? body.password;

    const supabase = getSupabase();

    // 1. Auth sync first.
    if (body.active !== undefined) {
      const { error: banError } = await supabase.auth.admin.updateUserById(userId, {
        ban_duration: body.active ? 'none' : BAN_FOREVER,
      });
      if (banError) {
        console.error('Error updating auth ban:', banError);
        return NextResponse.json({ error: banError.message }, { status: 500 });
      }
    }
    if (body.email || newPassword) {
      const authUpdates: any = {};
      if (body.email) authUpdates.email = String(body.email).toLowerCase();
      if (newPassword) authUpdates.password = newPassword;
      const { error: authError } = await supabase.auth.admin.updateUserById(userId, authUpdates);
      if (authError) {
        console.error('Error updating auth user:', authError);
        return NextResponse.json({ error: authError.message }, { status: 500 });
      }
    }

    // 2. Profile update.
    const profile: any = { updated_at: new Date().toISOString() };
    if (body.email !== undefined) profile.email = String(body.email).toLowerCase();
    if (body.first_name !== undefined) profile.first_name = body.first_name;
    if (body.last_name !== undefined) profile.last_name = body.last_name;
    if (body.phone !== undefined) profile.phone = body.phone || null;
    if (body.role !== undefined) {
      profile.role = body.role;
      profile.is_admin = body.role === 'admin'; // re-mirror legacy flag
    }
    if (body.active !== undefined) profile.active = body.active;
    if (body.can_send_fulfillment_emails !== undefined) {
      profile.can_send_fulfillment_emails = !!body.can_send_fulfillment_emails;
    }
    if (body.preferred_currency !== undefined) {
      profile.preferred_currency = body.preferred_currency === 'USD' ? 'USD' : 'CAD';
    }

    const { error: customerError } = await supabase
      .from('customers')
      .update(profile)
      .eq('id', userId);
    if (customerError) {
      console.error('Error updating customer:', customerError);
      return NextResponse.json({ error: customerError.message }, { status: 500 });
    }

    await logAuditServer(supabase, { actor_id: actor.userId, actor_email: actor.actor_email }, {
      action: 'user.update',
      entity_type: 'user',
      entity_id: userId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating user:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// Accept PATCH as an alias for PUT (backwards compatibility).
export const PATCH = PUT;

// DELETE - Hard delete in FK-safe order. If the id is also an affiliate
// (shared UUID), tear down its bound rows first.
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const accessToken = request.headers.get('authorization')?.replace('Bearer ', '');
    const actor = accessToken ? await verifyAdmin(accessToken) : null;
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = params.id;
    const supabase = getSupabase();

    // If this id is also an affiliate, cascade its bound rows first.
    const { data: affiliate } = await supabase
      .from('affiliates')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (affiliate) {
      await supabase.from('commissions').delete().eq('affiliate_id', userId);
      await supabase.from('referral_codes').delete().eq('affiliate_id', userId);
      await supabase.from('affiliates').delete().eq('id', userId);
    }
    // sales_persons linked by user_id (affiliate/staff).
    await supabase.from('sales_persons').delete().eq('user_id', userId);

    const { error: customerError } = await supabase
      .from('customers')
      .delete()
      .eq('id', userId);
    if (customerError) {
      console.error('Error deleting customer:', customerError);
      return NextResponse.json({ error: customerError.message }, { status: 500 });
    }

    const { error: authError } = await supabase.auth.admin.deleteUser(userId);
    if (authError) {
      // Best-effort: guest customers may have no auth user.
      console.error('Error deleting auth user:', authError);
    }

    await logAuditServer(supabase, { actor_id: actor.userId, actor_email: actor.actor_email }, {
      action: 'user.delete',
      entity_type: 'user',
      entity_id: userId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
