import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { legacyReportShell as reportShell, escapeHtml, fmtDate } from '@/lib/admin/report-html';

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

// GET /api/admin/customers/report?role=&q=&active=
export async function GET(req: NextRequest) {
  if (!(await verifyStaff(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const roleFilter = sp.get('role');
  const activeFilter = sp.get('active');
  const q = (sp.get('q') || '').toLowerCase();

  let query = db
    .from('customers')
    .select('id, first_name, last_name, email, phone, role, active, affiliate_id, last_login_at, created_at')
    .order('created_at', { ascending: false });
  if (roleFilter) query = query.eq('role', roleFilter);
  if (activeFilter === 'true') query = query.eq('active', true);
  if (activeFilter === 'false') query = query.eq('active', false);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let rows = data ?? [];
  if (q) {
    rows = rows.filter((c: any) =>
      [c.first_name, c.last_name, c.email, c.phone]
        .filter(Boolean)
        .some((f: any) => String(f).toLowerCase().includes(q)),
    );
  }

  const byRole: Record<string, number> = {};
  for (const c of rows as any[]) byRole[c.role] = (byRole[c.role] ?? 0) + 1;
  const activeCount = rows.filter((c: any) => c.active).length;

  const tableRows = rows.map((c: any) => [
    escapeHtml([c.first_name, c.last_name].filter(Boolean).join(' ') || '—'),
    escapeHtml(c.email ?? '—'),
    escapeHtml(c.phone ?? '—'),
    escapeHtml(c.role ?? '—'),
    c.active ? 'Active' : 'Inactive',
    escapeHtml(c.affiliate_id ? String(c.affiliate_id).slice(0, 8) : '—'),
    escapeHtml(fmtDate(c.last_login_at)),
    escapeHtml(fmtDate(c.created_at)),
  ]);

  const rowClasses = rows.map((c: any) => (c.active ? undefined : 'muted'));

  const html = reportShell({
    title: 'Customers Report',
    subtitle: [roleFilter && `role=${roleFilter}`, activeFilter && `active=${activeFilter}`, q && `q="${q}"`]
      .filter(Boolean)
      .join(' · '),
    cards: [
      { label: 'Total', value: String(rows.length) },
      { label: 'Active', value: String(activeCount) },
      { label: 'Affiliates', value: String(byRole['affiliate'] ?? 0) },
      { label: 'Staff', value: String((byRole['admin'] ?? 0) + (byRole['assistant'] ?? 0) + (byRole['warehouse'] ?? 0)) },
    ],
    columns: ['Name', 'Email', 'Phone', 'Role', 'Status', 'Affiliate', 'Last login', 'Created'],
    columnAlign: { 5: 'mono' },
    rows: tableRows,
    rowClasses,
  });

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
