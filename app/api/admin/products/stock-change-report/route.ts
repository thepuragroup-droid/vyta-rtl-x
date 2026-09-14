import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  computeStockChangeReport,
  stockChangeReportPrintHtml,
} from '@/lib/admin/stock-change-report';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getRole(request: NextRequest): Promise<string> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return 'customer';
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return 'customer';
  const { data: c } = await db.from('customers').select('role').eq('id', user.id).maybeSingle();
  return c?.role || 'customer';
}

/**
 * GET /api/admin/products/stock-change-report
 *
 * Printable HTML report of how stock moved over a date range. Served as
 * `text/html` and auto-printed in the browser — see lib/admin/report-html.ts.
 *
 * Query params:
 *   from, to      YYYY-MM-DD, inclusive. Default: the current Mon–Sun week.
 *                 Reversed ranges are swapped; malformed values fall back.
 *   q, category   filters, applied after aggregation
 *   stockUnit     boxes (default) | vials — Opening/Closing only
 *   boxRemainder  1 (default) | 0 — show leftover vials as "(3 vials)"
 *   print         0 disables the auto-print script
 *
 * The 403 body is PLAIN TEXT, not JSON: the client consumes this response as
 * a blob, so a JSON error would land in the report tab as gibberish.
 */
export async function GET(request: NextRequest) {
  const role = await getRole(request);
  if (role !== 'admin' && role !== 'assistant' && role !== 'analytics') {
    return new NextResponse('Unauthorized', { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const report = await computeStockChangeReport(db, {
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    search: sp.get('q') ?? undefined,
    category: sp.get('category') ?? undefined,
  });

  const html = stockChangeReportPrintHtml(report, {
    autoPrint: sp.get('print') !== '0',
    stockUnit: sp.get('stockUnit') === 'vials' ? 'vials' : 'boxes',
    showRemainder: sp.get('boxRemainder') !== '0',
  });

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
