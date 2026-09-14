import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Backorders are an admin/assistant tool — hidden from affiliates.
async function requireStaff(req: NextRequest): Promise<boolean> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return false;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  const role = data?.role ?? 'customer';
  return role === 'admin' || role === 'assistant';
}

const VALID_STATUS = ['open', 'fulfilled', 'cancelled'];

// GET /api/admin/backorders?status=open|fulfilled|cancelled
export async function GET(req: NextRequest) {
  if (!(await requireStaff(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const raw = req.nextUrl.searchParams.get('status') ?? 'open';
  const status = VALID_STATUS.includes(raw) ? raw : 'open';

  const { data, error } = await db
    .from('backorders')
    .select(`
      id, status, created_at, fulfilled_at, purchase_order_id, invoice_id,
      invoice:invoices (
        id, invoice_number, total, status, customer_name, customer_email,
        customer:customers!invoices_customer_id_fkey ( first_name, last_name, email )
      ),
      items:backorder_items ( id, product_id, description, qty_ordered, qty_available, qty_backordered, unit_price ),
      purchase_order:purchase_orders ( id, po_number )
    `)
    .eq('status', status)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const backorders = (data ?? []).map((bo: any) => {
    const inv = bo.invoice;
    const cust = inv?.customer;
    const items = bo.items ?? [];
    return {
      ...bo,
      customer_name_display:
        inv?.customer_name ??
        (cust ? `${cust.first_name} ${cust.last_name}`.trim() : null),
      customer_email_display: inv?.customer_email ?? cust?.email ?? null,
      item_count: items.length,
      total_backordered: items.reduce((s: number, it: any) => s + Number(it.qty_backordered || 0), 0),
    };
  });

  return NextResponse.json({ backorders });
}
