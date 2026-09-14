import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditServer } from '@/lib/admin/audit';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyAdmin(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { ok: false, userId: null as string | null, email: null as string | null };
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { ok: false, userId: null, email: null };
  const { data } = await db.from('customers').select('role, email').eq('id', user.id).single();
  return {
    ok: data?.role === 'admin' || data?.role === 'assistant',
    userId: user.id,
    email: data?.email ?? user.email ?? null,
  };
}

// PATCH /api/admin/orders/[id]/shipping-address — edit the order's address
// before/after a label exists. If a shipment exists, admin should
// re-create / refund as needed; this route just persists the address.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { ok, userId, email } = await verifyAdmin(req);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const shipping = body.shipping_address;
  if (!shipping || typeof shipping !== 'object') {
    return NextResponse.json(
      { error: 'shipping_address object required' },
      { status: 400 },
    );
  }

  const { error } = await db
    .from('orders')
    .update({ shipping_address: shipping, updated_at: new Date().toISOString() })
    .eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAuditServer(
    db,
    { actor_id: userId, actor_email: email },
    {
      action: 'order.shipping_address_updated',
      entity_type: 'order',
      entity_id: params.id,
    },
  );

  return NextResponse.json({ ok: true });
}
