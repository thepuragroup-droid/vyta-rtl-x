import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isMissingColumnError } from '@/lib/payments/puramass-columns';
import {
  filterPaidOrderIds,
  isPaidAdsScoped,
  isPaidVisitorRow,
  loadPaidVisitorScope,
  scopeToPaidAds,
  EMPTY_PAID_VISITOR_SCOPE,
  PAID_ADS_SCOPE_NOTE,
  PAID_ADS_UNAVAILABLE_NOTE,
} from '@/lib/analytics/paid-scope';
import { canViewAnalytics, type UserRole } from '@/lib/permissions';
import { ADMIN_VIEW_PARAM, previewedRole } from '@/lib/admin/admin-view';

export const revalidate = 30;

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const LOW_STOCK_THRESHOLD = 5;
const OPEN_PO_STATUSES = ['pending', 'partially_fulfilled'];
const REVENUE_INVOICE_STATUSES = ['sent', 'partial', 'paid', 'overdue'];

// Storefront order lifecycle buckets (see app/api/orders/check-payment).
// A "paid" order is one whose crypto payment fully confirmed or later; the
// rest are money still in flight, a lapsed payment window, or a cancellation.
const PAID_ORDER_STATUSES = ['confirmed', 'processing', 'shipped', 'delivered', 'paid'];
const PENDING_ORDER_STATUSES = ['pending', 'received'];
const ABANDONED_ORDER_STATUSES = ['expired'];
const CANCELLED_ORDER_STATUSES = ['cancelled', 'canceled'];
// Cap on the daily time series so an all-time (no range) load stays bounded.
const MAX_DAILY_POINTS = 90;

/** Exclusive upper bound at the next UTC midnight, so a `to` date includes its whole day. */
function endOfDayExclusiveISO(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/** Percentage (0–100, one decimal) with a safe divide-by-zero. */
function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? +((numerator / denominator) * 100).toFixed(1) : 0;
}

async function readerRole(req: NextRequest): Promise<UserRole | null> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return null;
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  return (data?.role as UserRole | undefined) ?? null;
}

export interface AnalyticsSummary {
  /**
   * `paid_ads` when the reader only sees sales won by a paid ad — the
   * analytics/marketing role. Revenue, the funnel and the hosted-checkout
   * ledger are then paid-ads-only figures; inventory and incoming stock are
   * not sales and are unaffected. `all` is the whole business.
   */
  scope: 'paid_ads' | 'all';
  /** Caveats worth showing next to the figures — the scope note, mainly. */
  notes: string[];
  inventory: {
    units: number;
    value: number;            // stock_quantity * price
    sku_count: number;
    low_stock_count: number;  // products under LOW_STOCK_THRESHOLD
  };
  incoming: {
    units: number;            // sum of qty on open PO items
    value: number;            // sum of open PO totals
    po_count: number;
    pos: Array<{
      id: string;
      po_number: string;
      supplier_name: string | null;
      status: string;
      total: number;
      expected_date: string | null;
    }>;
  };
  revenue: {
    invoiced: number;         // total of sent/partial/paid/overdue invoices
    paid: number;             // clamped per-invoice sum of payments
    outstanding: number;      // max(0, invoiced - paid)
    invoice_count: number;
    paid_invoice_count: number;
    range: { from: string | null; to: string | null };
    // Same figures split by the invoice's billing currency.
    by_currency: Record<'CAD' | 'USD', RevenueBucket>;
  };
  // Traffic & conversion baseline — the funnel from a first visit to a paid
  // storefront order. Meant to be snapshotted before ad spend so lift can be
  // measured afterwards. Engagement metrics cover anonymous visitors as well as
  // signed-in ones; figures from before attribution started collecting are
  // therefore not comparable with those after it.
  funnel: FunnelSummary;
  // Paid orders handed off to Stealth Health / PuraMass (the hosted-checkout
  // ledger), a separate revenue stream from the storefront invoices above.
  puramass: PuramassSummary;
}

export interface PuramassCurrencyBucket {
  paid_orders: number;
  gross: number;    // sum of paid subtotals
  refunds: number;  // sum of refunded amounts
  net: number;      // max(0, gross - refunds)
}

export interface PuramassSummary {
  range: { from: string | null; to: string | null };
  total_handoffs: number;     // every ledger row in range, any status
  paid_orders: number;        // status = 'paid'
  pending_orders: number;     // payment link issued, not yet paid
  expired_orders: number;     // payment window lapsed
  cancelled_orders: number;
  units: number;              // item quantities across paid orders
  conversion: number;         // paid_orders / total_handoffs (%)
  // Headline figures use the currency with the most paid revenue; the full
  // split lives in by_currency (PuraMass hosted checkout is usually USD).
  primary_currency: 'USD' | 'CAD';
  gross: number;
  refunds: number;
  net: number;
  aov: number;                // net / paid_orders, primary currency
  by_currency: Record<'USD' | 'CAD', PuramassCurrencyBucket>;
  top_products: Array<{ sku: string; name: string | null; quantity: number; orders: number }>;
  daily: Array<{ date: string; paid: number; revenue: number }>;  // revenue in primary currency
  daily_truncated: boolean;
}

interface RevenueBucket {
  invoiced: number;
  paid: number;
  outstanding: number;
  invoice_count: number;
  paid_invoice_count: number;
}

export interface FunnelSummary {
  range: { from: string | null; to: string | null };
  registrations: number;      // new customers created in range
  active_shoppers: number;    // distinct visitors with any tracked activity
  product_views: number;      // product-view events
  searches: number;           // search events
  cart_shoppers: number;      // distinct visitors who added to cart
  cart_events: number;        // add-to-cart events
  orders_placed: number;      // storefront orders created in range (any status)
  paid_orders: number;        // orders whose payment confirmed or later
  pending_orders: number;     // payment still in flight
  abandoned_orders: number;   // payment window lapsed (expired)
  cancelled_orders: number;   // cancelled
  order_revenue: number;      // sum of paid-order totals
  aov: number;                // average paid-order value
  rates: {
    cart: number;             // cart_shoppers / active_shoppers (%)
    checkout: number;         // orders_placed / active_shoppers (%)
    payment: number;          // paid_orders / orders_placed (%)
    overall: number;          // paid_orders / active_shoppers (%)
  };
  daily: Array<{
    date: string;             // YYYY-MM-DD (UTC)
    shoppers: number;         // distinct active shoppers that day
    orders: number;           // orders placed that day
    paid: number;             // paid orders that day
    revenue: number;          // paid-order revenue that day
  }>;
  daily_truncated: boolean;   // true when older days were dropped past MAX_DAILY_POINTS
}

export async function GET(req: NextRequest) {
  const realRole = await readerRole(req);
  if (!realRole || !canViewAnalytics(realRole)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  // An admin previewing the analytics staff view asks for it with ?view=. It can
  // only ever NARROW what this reader is entitled to (lib/admin/admin-view.ts),
  // so every scope decision below reads the previewed role rather than the
  // account's — the preview is scoped here, at the database, not in the browser.
  const role = previewedRole(realRole, req.nextUrl.searchParams.get(ADMIN_VIEW_PARAM));
  // The analytics/marketing role reads only the sales its ads produced: orders,
  // hosted hand-offs, the invoices raised against those orders, and the traffic
  // those figures are divided by are all filtered to the paid channels below.
  // Stock and purchasing are not sales and stay whole.
  const paidOnly = isPaidAdsScoped(role);
  const scope: 'paid_ads' | 'all' = paidOnly ? 'paid_ads' : 'all';
  const notes: string[] = paidOnly ? [PAID_ADS_SCOPE_NOTE] : [];
  // Visitors carry their channel on the visitor row, not on the activity row,
  // so scoped traffic is matched in memory against the visitors ads won.
  const visitorScope = paidOnly ? await loadPaidVisitorScope(db) : EMPTY_PAID_VISITOR_SCOPE;
  if (paidOnly && !visitorScope.available) notes.push(PAID_ADS_UNAVAILABLE_NOTE);

  const sp = req.nextUrl.searchParams;
  const from = sp.get('from');
  const to = sp.get('to');

  // ---- Queries in parallel ----
  let invoiceQuery = db
    .from('invoices')
    // `order_id` is only read to scope the analytics role's view; an invoice
    // carries no channel of its own, so the order it was raised against is the
    // only thing that can say whether an ad produced it.
    .select('id, order_id, total, status, issue_date, currency, payments (amount)')
    .in('status', REVENUE_INVOICE_STATUSES);
  if (from) invoiceQuery = invoiceQuery.gte('issue_date', from);
  if (to) invoiceQuery = invoiceQuery.lte('issue_date', to);

  let poQuery = db
    .from('purchase_orders')
    .select('id, po_number, status, total, expected_date, created_at, suppliers (name)')
    .in('status', OPEN_PO_STATUSES)
    .order('expected_date', { ascending: true, nullsFirst: false });
  if (from) poQuery = poQuery.gte('created_at', from);
  if (to) poQuery = poQuery.lte('created_at', to);

  const [productsRes, posRes, invoicesRes] = await Promise.all([
    db.from('products').select('id, price, stock_quantity').eq('active', true),
    poQuery,
    invoiceQuery,
  ]);

  const products = productsRes.data ?? [];
  const pos = posRes.data ?? [];
  let invoices = invoicesRes.data ?? [];

  // A scoped reader sees only the invoices raised against an order a paid ad
  // won. An invoice with no order behind it (a manual one) cannot be shown to
  // be paid-ads, so it is left out rather than assumed in.
  if (paidOnly && invoices.length > 0) {
    const paid = await filterPaidOrderIds(
      db,
      (invoices as any[]).map((inv) => inv.order_id).filter(Boolean),
    );
    invoices = (invoices as any[]).filter(
      (inv) => inv.order_id && paid.ids.has(String(inv.order_id)),
    );
    if (!paid.complete) {
      notes.push('Invoice revenue covers part of the range only — too many invoices to attribute.');
    }
  }

  // Open-PO item quantities.
  const poIds = pos.map((p: any) => p.id);
  let incomingUnits = 0;
  if (poIds.length > 0) {
    const { data: poItems } = await db
      .from('purchase_order_items')
      .select('qty, purchase_order_id')
      .in('purchase_order_id', poIds);
    incomingUnits = (poItems ?? []).reduce((s, i: any) => s + Number(i.qty ?? 0), 0);
  }

  // ---- Inventory reduction ----
  const inventory = products.reduce(
    (acc, p: any) => {
      const qty = Number(p.stock_quantity ?? 0);
      acc.units += qty;
      acc.value += qty * Number(p.price ?? 0);
      acc.sku_count += 1;
      if (qty < LOW_STOCK_THRESHOLD) acc.low_stock_count += 1;
      return acc;
    },
    { units: 0, value: 0, sku_count: 0, low_stock_count: 0 },
  );
  inventory.value = +inventory.value.toFixed(2);

  // ---- Incoming reduction ----
  const incomingValue = pos.reduce((s, p: any) => s + Number(p.total ?? 0), 0);

  // ---- Revenue reduction (per-invoice clamp), split by currency ----
  const emptyBucket = (): RevenueBucket => ({
    invoiced: 0, paid: 0, outstanding: 0, invoice_count: 0, paid_invoice_count: 0,
  });
  const buckets: Record<'CAD' | 'USD', RevenueBucket> = { CAD: emptyBucket(), USD: emptyBucket() };

  let invoiced = 0;
  let paid = 0;
  let paidInvoiceCount = 0;
  for (const inv of invoices as any[]) {
    const total = Number(inv.total ?? 0);
    const invoicePayments = (inv.payments ?? []).reduce(
      (s: number, p: any) => s + Number(p.amount ?? 0), 0,
    );
    const clamped = Math.min(invoicePayments, total);
    invoiced += total;
    paid += clamped;
    if (inv.status === 'paid') paidInvoiceCount += 1;

    const cur: 'CAD' | 'USD' = inv.currency === 'USD' ? 'USD' : 'CAD';
    const b = buckets[cur];
    b.invoiced += total;
    b.paid += clamped;
    b.invoice_count += 1;
    if (inv.status === 'paid') b.paid_invoice_count += 1;
  }
  for (const cur of ['CAD', 'USD'] as const) {
    const b = buckets[cur];
    b.invoiced = +b.invoiced.toFixed(2);
    b.paid = +b.paid.toFixed(2);
    b.outstanding = +Math.max(0, b.invoiced - b.paid).toFixed(2);
  }

  // ---- Traffic & conversion funnel (ad baseline) ----
  const toUpper = to ? endOfDayExclusiveISO(to) : null;

  let ordersQuery = scopeToPaidAds(
    db.from('orders').select('status, total, created_at').limit(50000),
    paidOnly,
  );
  if (from) ordersQuery = ordersQuery.gte('created_at', from);
  if (toUpper) ordersQuery = ordersQuery.lt('created_at', toUpper);

  // Anonymous visitors are recorded since marketing-attribution-migration.sql,
  // so a "shopper" is now any distinct person, not only a signed-in one.
  const buildActivityQuery = (columns: string) => {
    let q = db.from('customer_activity').select(columns).limit(100000);
    if (from) q = q.gte('created_at', from);
    if (toUpper) q = q.lt('created_at', toUpper);
    return q;
  };
  const activityQuery = buildActivityQuery('customer_id, anonymous_id, activity_type, created_at');

  let registrationsQuery = scopeToPaidAds(
    db.from('customers').select('id', { count: 'exact', head: true }).eq('role', 'customer'),
    paidOnly,
  );
  if (from) registrationsQuery = registrationsQuery.gte('created_at', from);
  if (toUpper) registrationsQuery = registrationsQuery.lt('created_at', toUpper);

  const [ordersRes, activityRes, registrationsRes] = await Promise.all([
    ordersQuery,
    activityQuery,
    registrationsQuery,
  ]);

  const orderRows = ordersRes.data ?? [];
  if (paidOnly && ordersRes.error && !notes.includes(PAID_ADS_UNAVAILABLE_NOTE)) {
    notes.push(PAID_ADS_UNAVAILABLE_NOTE);
  }
  // Fall back to the signed-in-only shape if the attribution columns are not
  // migrated yet — the funnel must still render.
  const activityRowsAll =
    (activityRes.error
      ? (await buildActivityQuery('customer_id, activity_type, created_at')).data
      : activityRes.data) ?? [];
  // Scoped: only the activity of visitors a paid ad brought in, so the funnel's
  // denominators belong to the same population as its orders.
  const activityRows = paidOnly
    ? (activityRowsAll as any[]).filter((a) => isPaidVisitorRow(visitorScope, a))
    : activityRowsAll;

  // Per-day accumulator, keyed by UTC date. Shoppers are a Set so repeat
  // visits by the same customer count once per day.
  type DayBucket = { orders: number; paid: number; revenue: number; shoppers: Set<string> };
  const dailyMap = new Map<string, DayBucket>();
  const dayOf = (ts: string): DayBucket => {
    const key = String(ts).slice(0, 10);
    let b = dailyMap.get(key);
    if (!b) { b = { orders: 0, paid: 0, revenue: 0, shoppers: new Set() }; dailyMap.set(key, b); }
    return b;
  };

  let ordersPlaced = 0, paidOrders = 0, pendingOrders = 0, abandonedOrders = 0, cancelledOrders = 0;
  let orderRevenue = 0;
  for (const o of orderRows as any[]) {
    ordersPlaced += 1;
    const bucket = dayOf(o.created_at);
    bucket.orders += 1;
    const status = String(o.status ?? '');
    if (PAID_ORDER_STATUSES.includes(status)) {
      const total = Number(o.total ?? 0);
      paidOrders += 1;
      orderRevenue += total;
      bucket.paid += 1;
      bucket.revenue += total;
    } else if (PENDING_ORDER_STATUSES.includes(status)) {
      pendingOrders += 1;
    } else if (ABANDONED_ORDER_STATUSES.includes(status)) {
      abandonedOrders += 1;
    } else if (CANCELLED_ORDER_STATUSES.includes(status)) {
      cancelledOrders += 1;
    }
  }

  const activeShoppers = new Set<string>();
  const cartShoppers = new Set<string>();
  let productViews = 0, searches = 0, cartEvents = 0;
  for (const a of activityRows as any[]) {
    // Prefer the customer id so a visitor who signs in mid-session — whose
    // earlier rows are backfilled with it — counts as one person, not two.
    const cid = a.customer_id
      ? `c:${a.customer_id}`
      : a.anonymous_id
        ? `v:${a.anonymous_id}`
        : null;
    if (cid) { activeShoppers.add(cid); dayOf(a.created_at).shoppers.add(cid); }
    switch (a.activity_type) {
      case 'view': productViews += 1; break;
      case 'search': searches += 1; break;
      case 'cart': cartEvents += 1; if (cid) cartShoppers.add(cid); break;
    }
  }

  const dailyAll = [...dailyMap.entries()]
    .map(([date, v]) => ({
      date,
      shoppers: v.shoppers.size,
      orders: v.orders,
      paid: v.paid,
      revenue: +v.revenue.toFixed(2),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const daily = dailyAll.slice(-MAX_DAILY_POINTS);

  const funnel: FunnelSummary = {
    range: { from: from ?? null, to: to ?? null },
    registrations: registrationsRes.count ?? 0,
    active_shoppers: activeShoppers.size,
    product_views: productViews,
    searches,
    cart_shoppers: cartShoppers.size,
    cart_events: cartEvents,
    orders_placed: ordersPlaced,
    paid_orders: paidOrders,
    pending_orders: pendingOrders,
    abandoned_orders: abandonedOrders,
    cancelled_orders: cancelledOrders,
    order_revenue: +orderRevenue.toFixed(2),
    aov: paidOrders > 0 ? +(orderRevenue / paidOrders).toFixed(2) : 0,
    rates: {
      cart: pct(cartShoppers.size, activeShoppers.size),
      checkout: pct(ordersPlaced, activeShoppers.size),
      payment: pct(paidOrders, ordersPlaced),
      overall: pct(paidOrders, activeShoppers.size),
    },
    daily,
    daily_truncated: dailyAll.length > daily.length,
  };

  // ---- PuraMass / Stealth Health paid-order analytics ----
  // The hand-off ledger (puramass_orders) is a separate revenue stream from the
  // storefront invoices. `refunded_total_cents` is added by a later migration,
  // so fall back to a column set without it if PostgREST can't see it yet.
  const PM_COLS =
    'status, subtotal_cents, currency, paid_at, created_at, items, refunded_total_cents';
  const PM_COLS_LEGACY = 'status, subtotal_cents, currency, paid_at, created_at, items';
  const runPmQuery = (cols: string) => {
    let q = scopeToPaidAds(db.from('puramass_orders').select(cols).limit(50000), paidOnly);
    if (from) q = q.gte('created_at', from);
    if (toUpper) q = q.lt('created_at', toUpper);
    return q;
  };
  let pmRes = await runPmQuery(PM_COLS);
  if (pmRes.error && isMissingColumnError(pmRes.error)) {
    pmRes = await runPmQuery(PM_COLS_LEGACY);
  }
  // A scoped read that still fails on a missing column means the attribution
  // migration hasn't run: report nothing rather than the unfiltered ledger.
  if (paidOnly && pmRes.error && !notes.includes(PAID_ADS_UNAVAILABLE_NOTE)) {
    notes.push(PAID_ADS_UNAVAILABLE_NOTE);
  }
  const pmRows = (pmRes.data ?? []) as any[];

  // PuraMass reports currency lower-cased (e.g. 'usd'); default to USD since the
  // hosted checkout is USD-denominated.
  const pmCurOf = (c: unknown): 'USD' | 'CAD' =>
    String(c ?? 'usd').toUpperCase() === 'CAD' ? 'CAD' : 'USD';
  const pmBucket = (): PuramassCurrencyBucket => ({ paid_orders: 0, gross: 0, refunds: 0, net: 0 });
  const pmByCurrency: Record<'USD' | 'CAD', PuramassCurrencyBucket> = { USD: pmBucket(), CAD: pmBucket() };

  type PmDay = { paid: number; netUSD: number; netCAD: number };
  const pmDailyMap = new Map<string, PmDay>();
  const pmDayOf = (ts: string): PmDay => {
    const key = String(ts).slice(0, 10);
    let b = pmDailyMap.get(key);
    if (!b) { b = { paid: 0, netUSD: 0, netCAD: 0 }; pmDailyMap.set(key, b); }
    return b;
  };
  const pmSkuAgg = new Map<string, { quantity: number; orders: number }>();
  let pmPaid = 0, pmPending = 0, pmExpired = 0, pmCancelled = 0, pmUnits = 0;

  for (const r of pmRows) {
    const status = String(r.status ?? '');
    if (status === 'paid') {
      pmPaid += 1;
      const cur = pmCurOf(r.currency);
      const gross = Number(r.subtotal_cents ?? 0) / 100;
      const ref = Number(r.refunded_total_cents ?? 0) / 100;
      const net = Math.max(0, gross - ref);
      const b = pmByCurrency[cur];
      b.paid_orders += 1;
      b.gross += gross;
      b.refunds += ref;
      b.net += net;

      const day = pmDayOf(r.paid_at ?? r.created_at);
      day.paid += 1;
      if (cur === 'USD') day.netUSD += net; else day.netCAD += net;

      const items = Array.isArray(r.items) ? r.items : [];
      const seenSku = new Set<string>();
      for (const it of items) {
        const sku = it?.sku ? String(it.sku) : null;
        const qty = Number(it?.quantity ?? 0) || 0;
        pmUnits += qty;
        if (!sku) continue;
        const agg = pmSkuAgg.get(sku) ?? { quantity: 0, orders: 0 };
        agg.quantity += qty;
        if (!seenSku.has(sku)) { agg.orders += 1; seenSku.add(sku); }
        pmSkuAgg.set(sku, agg);
      }
    } else if (status === 'payment_pending') {
      pmPending += 1;
    } else if (status === 'expired') {
      pmExpired += 1;
    } else if (status === 'cancelled' || status === 'canceled') {
      pmCancelled += 1;
    }
  }

  for (const cur of ['USD', 'CAD'] as const) {
    const b = pmByCurrency[cur];
    b.gross = +b.gross.toFixed(2);
    b.refunds = +b.refunds.toFixed(2);
    b.net = +b.net.toFixed(2);
  }

  const pmPrimary: 'USD' | 'CAD' = pmByCurrency.USD.net >= pmByCurrency.CAD.net ? 'USD' : 'CAD';
  const pmPrimaryBucket = pmByCurrency[pmPrimary];

  // Resolve PuraMass SKUs to product names for the "top products" list.
  const pmProductNames: Record<string, string> = {};
  const pmSkus = [...pmSkuAgg.keys()];
  if (pmSkus.length > 0) {
    const list = pmSkus.map((s) => `"${s.replace(/"/g, '')}"`).join(',');
    const { data: pmProducts } = await db
      .from('products')
      .select('name, puramass_sku, puramass_sku_vial')
      .or(`puramass_sku.in.(${list}),puramass_sku_vial.in.(${list})`);
    for (const p of pmProducts ?? []) {
      const row = p as { name?: string; puramass_sku?: string; puramass_sku_vial?: string };
      if (!row.name) continue;
      if (row.puramass_sku) pmProductNames[row.puramass_sku] = row.name;
      if (row.puramass_sku_vial) pmProductNames[row.puramass_sku_vial] = `${row.name} (single vial)`;
    }
  }
  const pmTopProducts = [...pmSkuAgg.entries()]
    .map(([sku, v]) => ({ sku, name: pmProductNames[sku] ?? null, quantity: v.quantity, orders: v.orders }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 6);

  const pmDailyAll = [...pmDailyMap.entries()]
    .map(([date, v]) => ({
      date,
      paid: v.paid,
      revenue: +(pmPrimary === 'USD' ? v.netUSD : v.netCAD).toFixed(2),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const pmDaily = pmDailyAll.slice(-MAX_DAILY_POINTS);

  const puramass: PuramassSummary = {
    range: { from: from ?? null, to: to ?? null },
    total_handoffs: pmRows.length,
    paid_orders: pmPaid,
    pending_orders: pmPending,
    expired_orders: pmExpired,
    cancelled_orders: pmCancelled,
    units: pmUnits,
    conversion: pct(pmPaid, pmRows.length),
    primary_currency: pmPrimary,
    gross: pmPrimaryBucket.gross,
    refunds: pmPrimaryBucket.refunds,
    net: pmPrimaryBucket.net,
    aov: pmPrimaryBucket.paid_orders > 0
      ? +(pmPrimaryBucket.net / pmPrimaryBucket.paid_orders).toFixed(2)
      : 0,
    by_currency: pmByCurrency,
    top_products: pmTopProducts,
    daily: pmDaily,
    daily_truncated: pmDailyAll.length > pmDaily.length,
  };

  const summary: AnalyticsSummary = {
    scope,
    notes,
    inventory,
    incoming: {
      units: incomingUnits,
      value: +incomingValue.toFixed(2),
      po_count: pos.length,
      pos: pos.map((p: any) => ({
        id: p.id,
        po_number: p.po_number,
        supplier_name: p.suppliers?.name ?? null,
        status: p.status,
        total: Number(p.total ?? 0),
        expected_date: p.expected_date,
      })),
    },
    revenue: {
      invoiced: +invoiced.toFixed(2),
      paid: +paid.toFixed(2),
      outstanding: +Math.max(0, invoiced - paid).toFixed(2),
      invoice_count: invoices.length,
      paid_invoice_count: paidInvoiceCount,
      range: { from: from ?? null, to: to ?? null },
      by_currency: buckets,
    },
    funnel,
    puramass,
  };

  return NextResponse.json({ summary });
}
