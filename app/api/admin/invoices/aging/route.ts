import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { AgingBucket } from '@/lib/types/ecommerce';
import { getInvoiceCaller } from '@/lib/admin/invoice-access';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/admin/invoices/aging  → { buckets: AgingBucket[] }
export async function GET(req: NextRequest) {
  const caller = await getInvoiceCaller(db, req);
  if (!caller.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  await db.rpc('mark_overdue_invoices');

  const { data, error } = await db
    .from('invoices')
    .select('*, customers!invoices_customer_id_fkey (first_name, last_name, email)')
    .in('status', ['sent', 'partial', 'overdue'])
    .order('due_date');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];

  // Remaining due per invoice (total − sum of payments).
  const ids = rows.map((r: any) => r.id);
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

  const now = new Date();
  const daysPastDue = (due: string) =>
    Math.floor((now.getTime() - new Date(due).getTime()) / 86_400_000);

  const make = (label: string): AgingBucket => ({ label, count: 0, total: 0, invoices: [] });
  const buckets = {
    current: make('Current'),
    d1: make('1–30'),
    d31: make('31–60'),
    d61: make('61–90'),
    d90: make('90+'),
  };

  for (const inv of rows) {
    const due = Math.max(0, Number(inv.total) - (paidMap.get(inv.id) ?? 0));
    if (due <= 0) continue;
    const days = daysPastDue(inv.due_date);
    const enriched = {
      ...inv,
      customer_name: inv.customers
        ? `${inv.customers.first_name} ${inv.customers.last_name}`
        : (inv.customer_name ?? null),
    };
    let b: AgingBucket;
    if (days <= 0) b = buckets.current;
    else if (days <= 30) b = buckets.d1;
    else if (days <= 60) b = buckets.d31;
    else if (days <= 90) b = buckets.d61;
    else b = buckets.d90;
    b.count++;
    b.total = Math.round((b.total + due) * 100) / 100;
    b.invoices.push(enriched);
  }

  return NextResponse.json({
    buckets: [buckets.current, buckets.d1, buckets.d31, buckets.d61, buckets.d90],
  });
}
