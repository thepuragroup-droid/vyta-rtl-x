import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { legacyReportShell as reportShell, escapeHtml, fmtMoney, fmtDate } from '@/lib/admin/report-html';
import { effectiveStatus } from '@/lib/admin/invoice-status';

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

// GET /api/admin/invoices/report?status=&q=&from=&to=
export async function GET(req: NextRequest) {
  if (!(await verifyStaff(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const statusFilter = sp.get('status');
  const q = (sp.get('q') || '').toLowerCase();
  const from = sp.get('from');
  const to = sp.get('to');

  // Sweep overdue before reading so the report reflects current state.
  await db.rpc('mark_overdue_invoices');

  let query = db
    .from('invoices')
    .select(`*, customers!invoices_customer_id_fkey (first_name, last_name, email)`)
    .order('created_at', { ascending: false });
  if (statusFilter) query = query.eq('status', statusFilter);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Build amount_paid per invoice from payments.
  const ids = (data ?? []).map((r: any) => r.id);
  const paidMap = new Map<string, number>();
  if (ids.length) {
    const { data: pmts } = await db
      .from('payments')
      .select('invoice_id, amount')
      .in('invoice_id', ids);
    for (const p of pmts ?? []) {
      paidMap.set(p.invoice_id, (paidMap.get(p.invoice_id) ?? 0) + Number(p.amount));
    }
  }

  let rows = (data ?? []).map((inv: any) => {
    const paid = paidMap.get(inv.id) ?? 0;
    const due = Math.max(0, Number(inv.total) - paid);
    const customer = inv.customers
      ? `${inv.customers.first_name} ${inv.customers.last_name}`.trim()
      : inv.customer_name ?? '—';
    const email = inv.customers?.email ?? inv.customer_email ?? '—';
    return {
      ...inv,
      amount_paid: paid,
      amount_due: due,
      customer_display: customer,
      email_display: email,
      status_effective: effectiveStatus(inv.status, inv.due_date),
    };
  });

  if (q) {
    rows = rows.filter((i: any) =>
      [i.invoice_number, i.customer_display, i.email_display]
        .some((f: any) => String(f ?? '').toLowerCase().includes(q)),
    );
  }

  const outstanding = rows
    .filter((i: any) => i.status_effective !== 'paid' && i.status_effective !== 'draft')
    .reduce((s: number, i: any) => s + i.amount_due, 0);
  const overdueCount = rows.filter((i: any) => i.status_effective === 'overdue').length;
  const paidCount = rows.filter((i: any) => i.status_effective === 'paid').length;

  const tableRows = rows.map((i: any) => [
    `<span class="mono">${escapeHtml(i.invoice_number)}</span>`,
    escapeHtml(i.customer_display),
    escapeHtml(i.email_display),
    escapeHtml(i.status_effective),
    escapeHtml(fmtDate(i.issue_date)),
    escapeHtml(fmtDate(i.due_date)),
    escapeHtml(fmtMoney(i.total)),
    escapeHtml(fmtMoney(i.amount_paid)),
    escapeHtml(fmtMoney(i.amount_due)),
  ]);

  const rowClasses = rows.map((i: any) =>
    i.status_effective === 'overdue' ? 'overdue' : i.status_effective === 'draft' ? 'muted' : undefined,
  );

  const html = reportShell({
    title: 'Invoices Report',
    subtitle: [statusFilter, from && `from ${from}`, to && `to ${to}`, q && `q="${q}"`].filter(Boolean).join(' · '),
    cards: [
      { label: 'Invoices', value: String(rows.length) },
      { label: 'Outstanding', value: fmtMoney(outstanding) },
      { label: 'Overdue', value: String(overdueCount) },
      { label: 'Paid', value: String(paidCount) },
    ],
    columns: ['Invoice #', 'Customer', 'Email', 'Status', 'Issued', 'Due', 'Total', 'Paid', 'Due'],
    columnAlign: { 6: 'num', 7: 'num', 8: 'num' },
    rows: tableRows,
    rowClasses,
  });

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
