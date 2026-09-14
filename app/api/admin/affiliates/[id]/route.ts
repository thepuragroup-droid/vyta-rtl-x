import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditServer } from '@/lib/admin/audit';
import { hashPassword } from '@/lib/affiliate/utils';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const BAN_FOREVER = '876600h';

async function verifyAdmin(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { ok: false, userId: null as string | null, actor_email: null as string | null };
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { ok: false, userId: null, actor_email: null };
  const { data } = await db.from('customers').select('id, email, role').eq('id', user.id).single();
  const ok = data?.role === 'admin';
  return { ok, userId: user.id, actor_email: data?.email ?? user.email ?? null };
}

// PUT - Update affiliate (ban toggle + email/password auth sync + profile)
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { ok, userId, actor_email } = await verifyAdmin(req);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  try {
    const id = params.id;
    const body = await req.json();
    const { first_name, last_name, email, wallet_address, active, password } = body;

    // Auth sync first so a failed sync never leaves the tables ahead.
    if (active !== undefined) {
      await db.auth.admin.updateUserById(id, { ban_duration: active ? 'none' : BAN_FOREVER });
    }
    if (email || password) {
      const authUpdates: any = {};
      if (email) authUpdates.email = String(email).toLowerCase();
      if (password) authUpdates.password = password;
      const { error: authError } = await db.auth.admin.updateUserById(id, authUpdates);
      if (authError) {
        return NextResponse.json({ error: authError.message }, { status: 500 });
      }
    }

    // affiliates profile
    const affUpdates: any = {};
    if (first_name !== undefined) affUpdates.first_name = first_name;
    if (last_name !== undefined) affUpdates.last_name = last_name;
    if (email !== undefined) affUpdates.email = String(email).toLowerCase();
    if (wallet_address !== undefined) affUpdates.wallet_address = wallet_address || null;
    if (active !== undefined) affUpdates.active = active;
    if (password) affUpdates.password_hash = await hashPassword(password);

    if (Object.keys(affUpdates).length > 0) {
      const { error: affError } = await db.from('affiliates').update(affUpdates).eq('id', id);
      if (affError) {
        return NextResponse.json({ error: affError.message }, { status: 500 });
      }
    }

    // Keep the linked customers row in sync where it makes sense.
    const custUpdates: any = { updated_at: new Date().toISOString() };
    if (first_name !== undefined) custUpdates.first_name = first_name;
    if (last_name !== undefined) custUpdates.last_name = last_name;
    if (email !== undefined) custUpdates.email = String(email).toLowerCase();
    if (active !== undefined) custUpdates.active = active;
    await db.from('customers').update(custUpdates).eq('id', id);

    await logAuditServer(db, { actor_id: userId, actor_email }, {
      action: 'affiliate.update',
      entity_type: 'affiliate',
      entity_id: id,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error updating affiliate:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// DELETE - FK-safe teardown of all rows sharing the UUID
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { ok, userId, actor_email } = await verifyAdmin(req);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  try {
    const id = params.id;

    // commissions → referral_codes → sales_persons → affiliates → customers → auth
    await db.from('commissions').delete().eq('affiliate_id', id);
    await db.from('referral_codes').delete().eq('affiliate_id', id);
    await db.from('sales_persons').delete().eq('user_id', id);
    await db.from('affiliates').delete().eq('id', id);
    await db.from('customers').delete().eq('id', id);

    const { error: authError } = await db.auth.admin.deleteUser(id);
    if (authError) {
      // Best-effort: the auth user may not exist (guest) — log and continue.
      console.error('Error deleting auth user:', authError);
    }

    await logAuditServer(db, { actor_id: userId, actor_email }, {
      action: 'affiliate.delete',
      entity_type: 'affiliate',
      entity_id: id,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting affiliate:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
