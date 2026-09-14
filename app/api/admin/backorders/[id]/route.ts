import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function requireStaff(req: NextRequest): Promise<boolean> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return false;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  const role = data?.role ?? 'customer';
  return role === 'admin' || role === 'assistant';
}

// GET /api/admin/backorders/[id] — single backorder for PO prefill.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!(await requireStaff(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data, error } = await db
    .from('backorders')
    .select(`
      id, status, invoice_id, purchase_order_id, created_at, fulfilled_at,
      invoice:invoices ( id, invoice_number ),
      items:backorder_items ( id, product_id, description, qty_ordered, qty_available, qty_backordered, unit_price )
    `)
    .eq('id', params.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ backorder: data });
}

// PATCH /api/admin/backorders/[id] — currently only supports cancellation.
// body: { status: 'cancelled' }
// The 'cancelled' state is in the CHECK constraint but had no setter — added
// here so admins can dismiss a backorder when the customer cancels or the
// shortage is resolved out-of-band.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!(await requireStaff(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (body.status !== 'cancelled') {
    return NextResponse.json(
      { error: "only status='cancelled' is supported here" },
      { status: 400 },
    );
  }

  const { data: existing } = await db
    .from('backorders')
    .select('id, status')
    .eq('id', params.id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.status === 'fulfilled') {
    return NextResponse.json(
      { error: 'Cannot cancel a fulfilled backorder' },
      { status: 400 },
    );
  }
  if (existing.status === 'cancelled') {
    return NextResponse.json({ ok: true, already: true });
  }

  const { error } = await db
    .from('backorders')
    .update({ status: 'cancelled' })
    .eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
