import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isPaidAdsScoped, paidChannelFilter, PAID_ADS_SCOPE_NOTE } from '@/lib/analytics/paid-scope';
import { ADMIN_VIEW_PARAM, previewedRole } from '@/lib/admin/admin-view';
import type { UserRole } from '@/lib/permissions';
import {
  computeProductsReport,
  productsReportPrintHtml,
  PRODUCTS_REPORT_CARD_KEYS,
  PRODUCTS_REPORT_COLUMN_KEYS,
  type ProductsReportStockStatus,
} from '@/lib/admin/products-report';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readerRole(request: NextRequest): Promise<UserRole | null> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) return null;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return null;
    const { data: customer } = await supabase
      .from('customers')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    const role = (customer?.role || 'customer') as UserRole;
    return role === 'admin' || role === 'assistant' || role === 'analytics' ? role : null;
  } catch {
    return null;
  }
}

// Ids travel in the query string, so the paid-order lookup is chunked.
const ORDER_ID_CHUNK = 200;
const MAX_PAID_ORDERS = 20_000;

/**
 * Line items for the analytics/marketing role: only the ones sold through an
 * order a paid ad won. That role reads sales it paid for and nothing else, so
 * the units-sold and revenue columns are a paid-ads figure for it.
 *
 * Fails closed — an unreadable orders scan (e.g. the attribution migration has
 * not run, so there is no channel to filter on) yields no sales at all rather
 * than the whole order book.
 */
async function paidAdsOrderItems(): Promise<any[]> {
  const { data: orders, error } = await paidChannelFilter(
    supabase.from('orders').select('id').limit(MAX_PAID_ORDERS),
  );
  if (error) return [];

  const ids = ((orders ?? []) as any[]).map((o) => String(o.id)).filter(Boolean);
  const rows: any[] = [];
  for (let i = 0; i < ids.length; i += ORDER_ID_CHUNK) {
    const { data, error: itemsError } = await supabase
      .from('order_items')
      .select('product_id, product_name, quantity, price_at_time')
      .in('order_id', ids.slice(i, i + ORDER_ID_CHUNK));
    if (itemsError) continue;
    rows.push(...((data ?? []) as any[]));
  }
  return rows;
}

/** Parse a CSV param against a whitelist. Missing param ⇒ undefined ⇒ all. */
function parseCsvParam(raw: string | null, whitelist: readonly string[]): string[] | undefined {
  if (raw === null) return undefined;
  return raw.split(',').map((s) => s.trim()).filter((s) => whitelist.includes(s));
}

/**
 * GET /api/admin/products/report — the customizable Products Report.
 *
 * Catalog + inventory + pricing + revenue, one row per product, as a printable
 * HTML document (served `text/html`, auto-printed client-side — see
 * lib/admin/report-html.ts for why these are HTML and not PDFs).
 *
 * Query params — see the admin Products page for the UI that builds them:
 *   q, category, status, stockStatus     filters
 *   cards   CSV of products,stock,lowout,revenue
 *   cols    CSV of sku,product,strength,price,stock,stockValue,unitsSold,revenue,status
 *   stockUnit (boxes|vials) / boxRemainder (1|0)
 *   print=0                              omit the auto-print script
 *
 * Prices are always the catalog's own, in CAD — there is no pricing-source
 * parameter, because there is only ever one price per product.
 *
 * The 403 body is PLAIN TEXT, not JSON: the client reads this response as a
 * blob, so a JSON error object would land in the report tab verbatim.
 */
export async function GET(request: NextRequest) {
  const realRole = await readerRole(request);
  if (!realRole) return new NextResponse('Unauthorized', { status: 403 });

  // An admin previewing the analytics staff view asks for it with ?view=, which
  // can only narrow their own entitlement — see lib/admin/admin-view.ts.
  const role = previewedRole(realRole, request.nextUrl.searchParams.get(ADMIN_VIEW_PARAM));
  // The analytics/marketing role sees only what its ads sold — see
  // lib/analytics/paid-scope.ts. Stock and catalogue figures are not sales and
  // stay whole.
  const paidOnly = isPaidAdsScoped(role);

  const sp = request.nextUrl.searchParams;
  const rawStockStatus = sp.get('stockStatus');
  const stockStatus: ProductsReportStockStatus =
    rawStockStatus === 'low' || rawStockStatus === 'out' || rawStockStatus === 'lowout'
      ? rawStockStatus
      : 'all';
  const cards = parseCsvParam(sp.get('cards'), PRODUCTS_REPORT_CARD_KEYS);
  const columns = parseCsvParam(sp.get('cols'), PRODUCTS_REPORT_COLUMN_KEYS);
  // A catalog-only report renders no sales figures, so don't pay for the scan.
  // This mirrors resolveKeys() in the lib: `undefined` means "all keys" for
  // both, but an EMPTY set means "none" for cards and "all" for columns.
  const wantsCards = cards === undefined || cards.includes('revenue');
  const wantsColumns =
    columns === undefined || columns.length === 0 ||
    columns.some((c) => c === 'unitsSold' || c === 'revenue');
  const includeSales = wantsCards || wantsColumns;

  const report = await computeProductsReport(supabase, {
    search: sp.get('q') ?? undefined,
    category: sp.get('category') ?? undefined,
    status: sp.get('status') ?? undefined,
    stockStatus,
    includeSales,
    ...(paidOnly ? { orderItemsLoader: paidAdsOrderItems } : {}),
  });

  const html = productsReportPrintHtml(report, {
    autoPrint: sp.get('print') !== '0',
    stockUnit: sp.get('stockUnit') === 'vials' ? 'vials' : 'boxes',
    showRemainder: sp.get('boxRemainder') !== '0',
    cards,
    columns,
    // The printed copy says out loud that its sales figures are ad-scoped.
    extraFilterChips: paidOnly ? [PAID_ADS_SCOPE_NOTE] : [],
  });

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
