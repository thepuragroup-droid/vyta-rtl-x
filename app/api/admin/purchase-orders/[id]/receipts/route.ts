import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verifyAdminRole(req: NextRequest, requireMutation: boolean) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { ok: false, userId: null as string | null, role: 'customer' };
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { ok: false, userId: null, role: 'customer' };
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  const role = data?.role ?? 'customer';
  const ok = requireMutation
    ? role === 'admin'
    : role === 'admin' || role === 'assistant';
  return { ok, userId: user.id, role };
}

async function fetchFullPO(id: string) {
  const { data: po } = await db
    .from('purchase_orders')
    .select(`*, supplier:suppliers (*), items:purchase_order_items (*)`)
    .eq('id', id)
    .single();
  if (!po) return null;
  const { data: receipts } = await db
    .from('purchase_order_receipts')
    .select(`*, items:purchase_order_receipt_items (*)`)
    .eq('purchase_order_id', id)
    .order('created_at', { ascending: false });
  return { ...po, receipts: receipts ?? [] };
}

// POST /api/admin/purchase-orders/[id]/receipts
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { ok, userId } = await verifyAdminRole(req, true);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const body = await req.json();
  const note: string | null = body.note ?? null;

  const items = (body.items as any[] | undefined ?? [])
    .map((i) => ({ po_item_id: i.po_item_id, qty: Math.max(0, parseInt(i.qty) || 0) }))
    .filter((i) => i.po_item_id && i.qty > 0);

  if (items.length === 0) {
    return NextResponse.json({ error: 'At least one item with a positive quantity is required' }, { status: 400 });
  }

  const { error: rpcErr } = await db.rpc('receive_po_items', {
    p_po_id: params.id,
    p_actor: userId,
    p_note: note,
    p_items: items,
  });

  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 400 });
  }

  const po = await fetchFullPO(params.id);
  return NextResponse.json({ purchase_order: po }, { status: 201 });
}
