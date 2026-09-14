import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

function money(n: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n || 0);
}
function fmtDate(s: string | null) {
  return s ? new Date(s).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
}
function esc(s: string) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

/**
 * A commission is keyed on an order (storefront/legacy) or an invoice (hosted
 * Stealth Health checkout), never both — so the report has to look for either.
 * Falls back to a short id so a row is never unidentifiable in the export.
 */
function referenceFor(c: any): string {
  if (c.orders?.order_number) return String(c.orders.order_number);
  if (c.invoices?.invoice_number) return String(c.invoices.invoice_number);
  const id = c.order_id ?? c.invoice_id;
  return id ? String(id).slice(0, 8) : '—';
}

type UnifiedRow = {
  source: 'affiliate' | 'sales';
  recipient_name: string;
  recipient_email: string;
  reference: string;
  total: number;
  amount: number;
  status: string;
  created_at: string;
};

export async function GET(req: NextRequest) {
  if (!(await verifyStaff(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const sp = new URL(req.url).searchParams;
  const sourceFilter = sp.get('source');
  const statusFilter = sp.get('status');
  const recipientFilter = sp.get('recipient');
  const q = (sp.get('q') || '').toLowerCase();

  const [{ data: aff }, { data: sales }] = await Promise.all([
    db.from('commissions').select(`*, affiliates (first_name, last_name, email), orders!commissions_order_id_fkey (order_number), invoices (invoice_number)`).order('created_at', { ascending: false }),
    db.from('sales_commissions').select(`*, sales_persons (first_name, last_name, email), invoices (invoice_number)`).order('created_at', { ascending: false }),
  ]);

  const affRows: UnifiedRow[] = (aff || []).map((c: any) => ({
    source: 'affiliate',
    recipient_name: c.affiliates ? `${c.affiliates.first_name} ${c.affiliates.last_name}` : '—',
    recipient_email: c.affiliates?.email || '',
    reference: referenceFor(c),
    total: Number(c.order_total) || 0,
    amount: Number(c.amount) || 0,
    status: c.status,
    created_at: c.created_at,
  }));

  const salesRows: UnifiedRow[] = (sales || []).map((c: any) => ({
    source: 'sales',
    recipient_name: c.sales_persons ? `${c.sales_persons.first_name} ${c.sales_persons.last_name}` : '—',
    recipient_email: c.sales_persons?.email || '',
    reference: c.invoices?.invoice_number || (c.invoice_id ? String(c.invoice_id).slice(0, 8) : '—'),
    total: Number(c.invoice_total) || 0,
    amount: Number(c.amount) || 0,
    status: c.status,
    created_at: c.created_at,
  }));

  let rows = [...affRows, ...salesRows];
  if (sourceFilter && sourceFilter !== 'all') rows = rows.filter((r) => r.source === sourceFilter);
  if (statusFilter && statusFilter !== 'all') rows = rows.filter((r) => r.status === statusFilter);
  if (recipientFilter && recipientFilter !== 'all') {
    const [src, ...nameParts] = recipientFilter.split('::');
    const name = nameParts.join('::');
    rows = rows.filter((r) => r.source === src && r.recipient_name === name);
  }
  if (q) {
    rows = rows.filter(
      (r) =>
        r.recipient_name.toLowerCase().includes(q) ||
        r.recipient_email.toLowerCase().includes(q) ||
        r.reference.toLowerCase().includes(q),
    );
  }
  rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const pendingTotal = rows.filter((r) => r.status === 'pending').reduce((s, r) => s + r.amount, 0);
  const paidTotal = rows.filter((r) => r.status === 'paid').reduce((s, r) => s + r.amount, 0);

  const tableRows = rows
    .map(
      (r) => `
      <tr>
        <td>${fmtDate(r.created_at)}</td>
        <td><span class="pill ${r.source}">${r.source === 'affiliate' ? 'Affiliate' : 'Sales'}</span></td>
        <td>${esc(r.recipient_name)}<div class="muted">${esc(r.recipient_email)}</div></td>
        <td class="mono">${esc(r.reference)}</td>
        <td class="num">${money(r.total)}</td>
        <td class="num">${money(r.amount)}</td>
        <td><span class="status ${r.status}">${esc(r.status)}</span></td>
      </tr>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<title>Commission Report</title>
<style>
  body { font-family: 'Segoe UI', -apple-system, sans-serif; color: #07203A; margin: 0; padding: 32px; }
  .page { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0; }
  .logo span { color: #438b9e; }
  .meta { color: #56707F; font-size: 13px; margin: 4px 0 24px; }
  .totals { display: flex; gap: 16px; margin-bottom: 24px; }
  .card { border: 1px solid #DCE7EB; border-radius: 8px; padding: 12px 16px; font-size: 13px; }
  .card b { display: block; font-size: 18px; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; text-transform: uppercase; font-size: 11px; color: #56707F; border-bottom: 2px solid #DCE7EB; padding: 8px; }
  td { padding: 10px 8px; border-bottom: 1px solid #EDF3F5; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .mono { font-family: monospace; }
  .muted { color: #6E8898; font-size: 11px; }
  .pill { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .pill.affiliate { background: #F1F8F9; color: #1B5D83; }
  .pill.sales { background: #F5F3FF; color: #7C3AED; }
  .status { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; text-transform: capitalize; }
  .status.paid { background: #ECFDF5; color: #059669; }
  .status.pending { background: #FFFBEB; color: #B45309; }
  .status.cancelled { background: #FEF2F2; color: #DC2626; }
  @media print { body { padding: 0; } }
</style></head>
<body><div class="page">
  <h1 class="logo">AMINO<span>CAN</span></h1>
  <div class="meta">Commission Report &bull; ${rows.length} entries &bull; ${fmtDate(new Date().toISOString())}</div>
  <div class="totals">
    <div class="card">Pending<b>${money(pendingTotal)}</b></div>
    <div class="card">Paid<b>${money(paidTotal)}</b></div>
    <div class="card">Total<b>${money(pendingTotal + paidTotal)}</b></div>
  </div>
  <table>
    <thead><tr><th>Date</th><th>Source</th><th>Recipient</th><th>Order / Invoice</th><th class="num">Total</th><th class="num">Commission</th><th>Status</th></tr></thead>
    <tbody>${tableRows || '<tr><td colspan="7" style="text-align:center;color:#6E8898;padding:32px;">No commissions match the filters</td></tr>'}</tbody>
  </table>
</div></body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
