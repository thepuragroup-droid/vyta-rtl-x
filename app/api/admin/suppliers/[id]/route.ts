import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// requireDelete promotes the check to admin-only (canDelete).
async function verifyAdminRole(req: NextRequest, requireMutation: boolean) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { ok: false, role: 'customer' };
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { ok: false, role: 'customer' };
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  const role = data?.role ?? 'customer';
  const ok = requireMutation
    ? role === 'admin'
    : role === 'admin' || role === 'assistant';
  return { ok, role };
}

const SUPPLIER_FIELDS = ['name', 'contact_name', 'email', 'phone', 'lead_time_days', 'notes'];

// PATCH /api/admin/suppliers/[id]
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { ok } = await verifyAdminRole(req, true);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const body = await req.json();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of SUPPLIER_FIELDS) {
    if (f in body) updates[f] = body[f];
  }

  const { data, error } = await db
    .from('suppliers')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ supplier: data });
}

// DELETE /api/admin/suppliers/[id] — admin only (canDelete); RESTRICT blocks if POs exist
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { ok } = await verifyAdminRole(req, true);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { error } = await db.from('suppliers').delete().eq('id', params.id);
  if (error) {
    const blocked = /violates foreign key|RESTRICT/i.test(error.message);
    return NextResponse.json(
      { error: blocked ? 'Cannot delete a supplier that has purchase orders' : error.message },
      { status: blocked ? 409 : 500 }
    );
  }
  return NextResponse.json({ success: true });
}
