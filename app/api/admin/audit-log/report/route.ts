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

// GET /api/admin/audit-log/report?actor=&action=&entity_type=&from=&to=&q=
export async function GET(req: NextRequest) {
  if (!(await verifyStaff(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const actorFilter = sp.get('actor');
  const actionFilter = sp.get('action');
  const entityFilter = sp.get('entity_type');
  const from = sp.get('from');
  const to = sp.get('to');
  const q = (sp.get('q') || '').toLowerCase();
  const limit = Math.min(Number(sp.get('limit')) || 1000, 5000);

  let query = db
    .from('audit_logs')
    .select('id, created_at, actor_id, actor_email, action, entity_type, entity_id')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (actorFilter) query = query.eq('actor_email', actorFilter);
  if (actionFilter) query = query.ilike('action', `%${actionFilter}%`);
  if (entityFilter) query = query.eq('entity_type', entityFilter);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let rows = data ?? [];
  if (q) {
    rows = rows.filter((r: any) =>
      [r.actor_email, r.action, r.entity_type, r.entity_id]
        .some((f: any) => String(f ?? '').toLowerCase().includes(q)),
    );
  }

  // Top actors + top action prefixes for the summary cards.
  const actorCounts = new Map<string, number>();
  for (const r of rows as any[]) {
    const k = r.actor_email ?? r.actor_id ?? 'unknown';
    actorCounts.set(k, (actorCounts.get(k) ?? 0) + 1);
  }
  const topActor = [...actorCounts.entries()].sort((a, b) => b[1] - a[1])[0];

  const tableRows = rows.map((r: any) => [
    escapeHtml(new Date(r.created_at).toLocaleString('en-CA')),
    escapeHtml(r.actor_email ?? '—'),
    `<span class="mono">${escapeHtml(r.action)}</span>`,
    escapeHtml(r.entity_type ?? '—'),
    `<span class="mono">${escapeHtml(r.entity_id ?? '—')}</span>`,
  ]);

  const html = reportShell({
    title: 'Audit Log Report',
    subtitle: [
      actorFilter && `actor=${actorFilter}`,
      actionFilter && `action~${actionFilter}`,
      entityFilter && `entity=${entityFilter}`,
      from && `from ${from}`,
      to && `to ${to}`,
      q && `q="${q}"`,
    ]
      .filter(Boolean)
      .join(' · '),
    cards: [
      { label: 'Events', value: String(rows.length) },
      { label: 'Actors', value: String(actorCounts.size) },
      { label: 'Top actor', value: topActor ? `${topActor[0]} (${topActor[1]})` : '—' },
    ],
    columns: ['When', 'Actor', 'Action', 'Entity', 'ID'],
    rows: tableRows,
    footer: `Showing up to ${limit} most recent rows.`,
  });

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
