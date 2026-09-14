import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { legacyReportShell as reportShell, escapeHtml, fmtMoney, fmtDate } from '@/lib/admin/report-html';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyStaff(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return false;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  return data?.role === 'admin' || data?.role === 'assistant';
}

// GET /api/admin/orders/report?status=&q=&from=&to=
export async function GET(req: NextRequest) {
  if (!(await verifyStaff(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const statusFilter = sp.get('status');
  const sourceFilter = sp.get('source');
  const q = (sp.get('q') || '').toLowerCase();
  const from = sp.get('from');
  const to = sp.get('to');

  let query = db
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false });
  if (statusFilter) query = query.eq('status', statusFilter);
  if (sourceFilter) query = query.eq('source', sourceFilter);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let rows = data ?? [];
  if (q) {
    rows = rows.filter((o: any) =>
      [o.order_number, o.email, o.tracking_number, o.shipping_address?.firstName, o.shipping_address?.lastName]
        .filter(Boolean)
        .some((f: any) => String(f).toLowerCase().includes(q)),
    );
  }

  const totalRevenue = rows.reduce((s, o: any) => s + Number(o.total ?? 0), 0);
  const paidCount = rows.filter((o: any) => o.status === 'paid' || o.status === 'shipped' || o.status === 'delivered').length;
  const cancelledCount = rows.filter((o: any) => o.status === 'cancelled').length;

  const tableRows = rows.map((o: any) => {
    const addr = o.shipping_address ?? {};
    const customer = [addr.firstName, addr.lastName].filter(Boolean).join(' ') || o.email || '—';
    return [
      `<span class="mono">${escapeHtml(o.order_number)}</span>`,
      escapeHtml(customer),
      escapeHtml(o.email ?? '—'),
      escapeHtml(o.status ?? '—'),
      escapeHtml(o.source ?? '—'),
      escapeHtml(o.tracking_number ?? '—'),
      escapeHtml(fmtMoney(o.total)),
      escapeHtml(fmtDate(o.created_at)),
    ];
  });

  const html = reportShell({
    title: 'Orders Report',
    subtitle: [statusFilter, sourceFilter, from && `from ${from}`, to && `to ${to}`, q && `q="${q}"`]
      .filter(Boolean)
      .join(' · '),
    cards: [
      { label: 'Orders', value: String(rows.length) },
      { label: 'Revenue', value: fmtMoney(totalRevenue) },
      { label: 'Paid/Shipped', value: String(paidCount) },
      { label: 'Cancelled', value: String(cancelledCount) },
    ],
    columns: ['Order #', 'Customer', 'Email', 'Status', 'Source', 'Tracking', 'Total', 'Created'],
    columnAlign: { 6: 'num' },
    rows: tableRows,
  });

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
