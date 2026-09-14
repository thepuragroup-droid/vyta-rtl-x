import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  computeStockReport,
  stockReportPrintHtml,
  STOCK_REPORT_COLUMN_KEYS,
} from '@/lib/admin/stock-report';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getRole(req: NextRequest): Promise<string> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return 'customer';
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return 'customer';
  const { data: c } = await db.from('customers').select('role').eq('id', user.id).maybeSingle();
  return c?.role || 'customer';
}

/**
 * GET /api/admin/products/stock-report
 *
 * Money-free on-hand & reorder levels, as a printable HTML document. Safe to
 * share with a warehouse or a buyer — no price, no stock value, no revenue.
 *
 * Query params:
 *   q, category, status   catalog filters
 *   cols                  CSV of sku,description,strength,stock,minQty,onOrder,needToOrder
 *                         (missing / empty / all-unknown ⇒ every column)
 *   cards                 1 (default) | 0 — BOOLEAN here, unlike the Products
 *                         Report's `cards`, which is a list of card keys
 *   onOrder               1 (default) | 0 — the "How On Order is calculated" note
 *   stockUnit             boxes (default) | vials
 *   boxRemainder          1 (default) | 0
 *   print                 0 disables the auto-print script
 *
 * The 403 body is plain text: the client reads this response as a blob.
 */
export async function GET(req: NextRequest) {
  const role = await getRole(req);
  if (role !== 'admin' && role !== 'assistant' && role !== 'analytics') {
    return new NextResponse('Unauthorized', { status: 403 });
  }

  const sp = req.nextUrl.searchParams;

  const rawCols = sp.get('cols');
  const cols = rawCols
    ? rawCols.split(',').map((s) => s.trim()).filter((s) => (STOCK_REPORT_COLUMN_KEYS as readonly string[]).includes(s))
    : undefined;

  const report = await computeStockReport(db, {
    search: sp.get('q') ?? undefined,
    category: sp.get('category') ?? undefined,
    status: sp.get('status') ?? undefined,
  });

  const html = stockReportPrintHtml(report, {
    autoPrint: sp.get('print') !== '0',
    stockUnit: sp.get('stockUnit') === 'vials' ? 'vials' : 'boxes',
    showRemainder: sp.get('boxRemainder') !== '0',
    showCards: sp.get('cards') !== '0',
    showOnOrder: sp.get('onOrder') !== '0',
    columns: cols,
  });

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': 'inline; filename="stock-report.html"',
    },
  });
}
