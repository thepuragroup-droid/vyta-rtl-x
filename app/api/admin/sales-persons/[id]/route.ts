import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditServer } from '@/lib/admin/audit';

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
  const ok = data?.role === 'admin' || data?.role === 'assistant';
  return { ok, userId: user.id, actor_email: data?.email ?? user.email ?? null };
}

// PATCH /api/admin/sales-persons/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { ok, userId, actor_email } = await verifyAdmin(req);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const body = await req.json();
  const allowed = ['first_name', 'last_name', 'email', 'phone', 'commission_rate', 'notes', 'active'];
  const updates: Record<string, any> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  if (typeof updates.commission_rate === 'number' && (updates.commission_rate < 0 || updates.commission_rate > 100)) {
    return NextResponse.json(
      { error: 'commission_rate must be between 0 and 100' },
      { status: 400 },
    );
  }

  const { error } = await db
    .from('sales_persons')
    .update(updates)
    .eq('id', params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAuditServer(db, { actor_id: userId, actor_email }, {
    action: 'sales_person.update',
    entity_type: 'sales_person',
    entity_id: params.id,
  });

  return NextResponse.json({ success: true });
}

// DELETE /api/admin/sales-persons/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { ok, userId, actor_email } = await verifyAdmin(req);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  // Soft-delete: mark inactive (cascade would orphan commissions)
  const { error } = await db
    .from('sales_persons')
    .update({ active: false })
    .eq('id', params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAuditServer(db, { actor_id: userId, actor_email }, {
    action: 'sales_person.deactivate',
    entity_type: 'sales_person',
    entity_id: params.id,
  });

  return NextResponse.json({ success: true });
}
