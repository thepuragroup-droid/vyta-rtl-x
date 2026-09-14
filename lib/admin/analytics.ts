import { supabase } from '@/lib/supabase';
import { appendAdminViewParam } from '@/lib/admin/admin-view';
import { apiFetch } from '@/lib/api-fetch';

export interface AnalyticsSummary {
  /**
   * `paid_ads` when the reader only sees sales won by a paid ad (the
   * analytics/marketing role); `all` for admin and assistant. Mirrors the API
   * route — see lib/analytics/paid-scope.ts.
   */
  scope: 'paid_ads' | 'all';
  /** Caveats worth showing next to the figures. */
  notes: string[];
  inventory: {
    units: number;
    value: number;
    sku_count: number;
    low_stock_count: number;
  };
  incoming: {
    units: number;
    value: number;
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
    invoiced: number;
    paid: number;
    outstanding: number;
    invoice_count: number;
    paid_invoice_count: number;
    range: { from: string | null; to: string | null };
    by_currency: Record<'CAD' | 'USD', RevenueBucket>;
  };
  funnel: FunnelSummary;
  puramass: PuramassSummary;
}

export interface PuramassCurrencyBucket {
  paid_orders: number;
  gross: number;
  refunds: number;
  net: number;
}

export interface PuramassSummary {
  range: { from: string | null; to: string | null };
  total_handoffs: number;
  paid_orders: number;
  pending_orders: number;
  expired_orders: number;
  cancelled_orders: number;
  units: number;
  conversion: number;
  primary_currency: 'USD' | 'CAD';
  gross: number;
  refunds: number;
  net: number;
  aov: number;
  by_currency: Record<'USD' | 'CAD', PuramassCurrencyBucket>;
  top_products: Array<{ sku: string; name: string | null; quantity: number; orders: number }>;
  daily: Array<{ date: string; paid: number; revenue: number }>;
  daily_truncated: boolean;
}

export interface RevenueBucket {
  invoiced: number;
  paid: number;
  outstanding: number;
  invoice_count: number;
  paid_invoice_count: number;
}

export interface FunnelSummary {
  range: { from: string | null; to: string | null };
  registrations: number;
  active_shoppers: number;
  product_views: number;
  searches: number;
  cart_shoppers: number;
  cart_events: number;
  orders_placed: number;
  paid_orders: number;
  pending_orders: number;
  abandoned_orders: number;
  cancelled_orders: number;
  order_revenue: number;
  aov: number;
  rates: {
    cart: number;
    checkout: number;
    payment: number;
    overall: number;
  };
  daily: Array<{
    date: string;
    shoppers: number;
    orders: number;
    paid: number;
    revenue: number;
  }>;
  daily_truncated: boolean;
}

export interface AnalyticsRange {
  from?: string | null;
  to?: string | null;
}

export async function getAnalyticsSummary(range?: AnalyticsRange): Promise<AnalyticsSummary | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? null;

  const params = new URLSearchParams();
  if (range?.from) params.set('from', range.from);
  if (range?.to) params.set('to', range.to);
  appendAdminViewParam(params);
  const qs = params.toString();
  const url = `/api/admin/analytics/summary${qs ? `?${qs}` : ''}`;

  try {
    const result = await apiFetch<{ summary: AnalyticsSummary }>(url, {
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return result.summary ?? null;
  } catch (e) {
    console.error(e);
    return null;
  }
}
