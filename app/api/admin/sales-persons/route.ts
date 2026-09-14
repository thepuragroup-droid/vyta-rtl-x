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

// GET /api/admin/sales-persons
export async function GET(req: NextRequest) {
  const { ok } = await verifyAdmin(req);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { data, error } = await db
    .from('sales_persons')
    .select('*')
    .order('first_name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sales_persons: data ?? [] });
}

// POST /api/admin/sales-persons
export async function POST(req: NextRequest) {
  const { ok, userId, actor_email } = await verifyAdmin(req);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const body = await req.json();
  const { first_name, last_name, email, phone, commission_rate, notes } = body;

  if (!first_name || !last_name) {
    return NextResponse.json(
      { error: 'first_name and last_name are required' },
      { status: 400 },
    );
  }

  const rate = Number(commission_rate);
  if (!isNaN(rate) && (rate < 0 || rate > 100)) {
    return NextResponse.json(
      { error: 'commission_rate must be between 0 and 100' },
      { status: 400 },
    );
  }

  const { data, error } = await db
    .from('sales_persons')
    .insert({
      first_name,
      last_name,
      email: email || null,
      phone: phone || null,
      commission_rate: isNaN(rate) ? 5 : rate,
      notes: notes || null,
    })
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Failed to create sales person' },
      { status: 500 },
    );
  }

  await logAuditServer(db, { actor_id: userId, actor_email }, {
    action: 'sales_person.create',
    entity_type: 'sales_person',
    entity_id: data.id,
  });

  return NextResponse.json({ sales_person: data }, { status: 201 });
}
