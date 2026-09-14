import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function getAffiliateCaller(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return null;
  const { data: customer } = await db
    .from('customers')
    .select('id, role')
    .eq('id', user.id)
    .single();
  if (!customer || customer.role !== 'affiliate') return null;
  return customer;
}

type Row = {
  id: string;
  source: 'referral' | 'invoice';
  reference: string;
  base: number;
  amount: number;
  rate: number;
  status: string;
  created_at: string;
};

// GET - normalized commission history from both streams + totals
export async function GET(req: NextRequest) {
  const caller = await getAffiliateCaller(req);
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const uid = caller.id;

  // Affiliate (referral / order) stream.
  const { data: affRows } = await db
    .from('commissions')
    .select('id, amount, order_total, commission_rate, status, created_at, order_id, invoice_id, orders!commissions_order_id_fkey (order_number), invoices (invoice_number)')
    .eq('affiliate_id', uid)
    .order('created_at', { ascending: false });

  const referral: Row[] = (affRows || []).map((c: any) => ({
    id: c.id,
    source: 'referral',
    // Keyed on an order (storefront) or an invoice (hosted checkout), never both.
    reference:
      c.orders?.order_number ||
      c.invoices?.invoice_number ||
      ((c.order_id ?? c.invoice_id) ? String(c.order_id ?? c.invoice_id).slice(0, 8) : '—'),
    base: Number(c.order_total) || 0,
    amount: Number(c.amount) || 0,
    rate: Number(c.commission_rate) || 0,
    status: c.status,
    created_at: c.created_at,
  }));

  // Invoice (sales) stream — tied to the linked sales_person.
  let invoice: Row[] = [];
  const { data: salesPerson } = await db
    .from('sales_persons')
    .select('id')
    .eq('user_id', uid)
    .maybeSingle();

  if (salesPerson?.id) {
    const { data: salesRows } = await db
      .from('sales_commissions')
      .select('id, amount, invoice_total, commission_rate, status, created_at, invoice_id, invoices (invoice_number)')
      .eq('sales_person_id', salesPerson.id)
      .order('created_at', { ascending: false });

    invoice = (salesRows || []).map((c: any) => ({
      id: c.id,
      source: 'invoice',
      reference: c.invoices?.invoice_number || (c.invoice_id ? String(c.invoice_id).slice(0, 8) : '—'),
      base: Number(c.invoice_total) || 0,
      amount: Number(c.amount) || 0,
      rate: Number(c.commission_rate) || 0,
      status: c.status,
      created_at: c.created_at,
    }));
  }

  const rows = [...referral, ...invoice].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const paid = round2(rows.filter((r) => r.status === 'paid').reduce((s, r) => s + r.amount, 0));
  const pending = round2(rows.filter((r) => r.status === 'pending').reduce((s, r) => s + r.amount, 0));
  const total = round2(paid + pending);

  return NextResponse.json({ rows, paid, pending, total });
}
