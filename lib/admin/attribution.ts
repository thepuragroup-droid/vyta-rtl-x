import { supabase } from '@/lib/supabase';
import { appendAdminViewParam } from '@/lib/admin/admin-view';
import { apiFetch } from '@/lib/api-fetch';
import type { AnalyticsRange } from '@/lib/admin/analytics';
import type { BreakdownRow } from '@/lib/analytics/earnings-breakdown';
import type { EmailFlowAnalytics } from '@/lib/analytics/email-flow-report';
import type { AttributionAudit, ReclassifyResult } from '@/lib/analytics/reclassify';

export type { BreakdownRow, BreakdownChild } from '@/lib/analytics/earnings-breakdown';
export type { AttributionAudit, ReclassifyResult, ArrivalGroup } from '@/lib/analytics/reclassify';

/** What unpaid visitors arrived with, and which look like misfiled ad clicks. */
export async function getAttributionAudit(range?: AnalyticsRange): Promise<AttributionAudit | null> {
  const params = new URLSearchParams();
  if (range?.from) params.set('from', range.from);
  if (range?.to) params.set('to', range.to);
  appendAdminViewParam(params);
  const qs = params.toString();
  try {
    return await apiFetch<AttributionAudit>(`/api/admin/analytics/attribution/audit${qs ? `?${qs}` : ''}`, {
      cache: 'no-store',
    });
  } catch (e) {
    console.error(e);
    return null;
  }
}

/** Count (`apply: false`) or apply the moves to paid channels, over all history. Admin only. */
export async function reclassifyAttribution(apply: boolean): Promise<ReclassifyResult> {
  const params = new URLSearchParams();
  appendAdminViewParam(params);
  const qs = params.toString();
  return apiFetch<ReclassifyResult>(`/api/admin/analytics/attribution/audit${qs ? `?${qs}` : ''}`, {
    method: 'POST',
    cache: 'no-store',
    timeoutMs: 120_000,
    body: JSON.stringify({ apply }),
  });
}

/** One acquisition channel's funnel and revenue. Mirrors the API route. */
export interface ChannelRow {
  channel: string;
  paid: boolean;
  visitors: number;
  signups: number;
  checkouts: number;
  purchasers: number;
  orders: number;
  paid_orders: number;
  order_revenue: number;   // CAD, native storefront
  hosted_orders: number;
  hosted_paid: number;
  hosted_revenue: number;  // USD, hosted checkout
  rates: { signup: number; checkout: number; purchase: number };
}

/** Which earnings bucket a channel belongs to — see the API route. */
export type EarningsGroupKey = 'paid' | 'affiliate' | 'organic' | 'direct' | 'unattributed';

export interface EarningsGroup {
  key: EarningsGroupKey;
  label: string;
  channels: string[];
  paid_orders: number;
  order_revenue: number;   // CAD
  hosted_revenue: number;  // USD
  aov_cad: number;
  aov_usd: number;
  order_share: number;     // % of all paid orders in range
  /** Paid ads by platform, affiliate by affiliate, organic by source. */
  breakdown: BreakdownRow[];
}

export interface AttributionSummary {
  range: { from: string | null; to: string | null };
  /** False until marketing-attribution-migration.sql has been run. */
  available: boolean;
  /**
   * `paid_ads` when the reader only sees sales won by a paid ad (the
   * analytics/marketing role): the channel list, earnings split and totals are
   * then paid-only and `unattributed` is necessarily zero. `all` otherwise.
   */
  scope: 'paid_ads' | 'all';
  /** Caveats worth showing next to the figures. */
  notes: string[];
  channels: ChannelRow[];
  totals: Omit<ChannelRow, 'channel' | 'paid'>;
  /** Earnings split by how the sale was won. Sums to `earnings_total`. */
  earnings: EarningsGroup[];
  earnings_total: { paid_orders: number; order_revenue: number; hosted_revenue: number };
  unattributed_orders: number;
  unattributed_revenue: { order_revenue: number; hosted_revenue: number };
  campaigns: Array<{
    channel: string;
    campaign: string;
    visitors: number;
    purchasers: number;
    revenue: number;
  }>;
  truncated: boolean;
}

// Channel names are shared with the server routes — see lib/analytics/attribution.ts.
export { CHANNEL_LABELS, channelLabel } from '@/lib/analytics/attribution';

export async function getAttributionSummary(
  range?: AnalyticsRange,
): Promise<AttributionSummary | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? null;

  const params = new URLSearchParams();
  if (range?.from) params.set('from', range.from);
  if (range?.to) params.set('to', range.to);
  appendAdminViewParam(params);
  const qs = params.toString();

  try {
    return await apiFetch<AttributionSummary>(
      `/api/admin/analytics/attribution${qs ? `?${qs}` : ''}`,
      { cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
  } catch (e) {
    console.error(e);
    return null;
  }
}

/** Bar colour per earnings group. Paid carries the teal accent — it is the
 *  one with a budget behind it, and the eye should land there first. */
export const EARNINGS_TINTS: Record<EarningsGroupKey, { bar: string; text: string; dot: string }> = {
  paid:         { bar: 'bg-teal',      text: 'text-teal-dark',      dot: 'bg-teal' },
  affiliate:    { bar: 'bg-blue-500',    text: 'text-blue-700',    dot: 'bg-blue-500' },
  organic:      { bar: 'bg-emerald-500', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  direct:       { bar: 'bg-ink/60',      text: 'text-ink',         dot: 'bg-ink/60' },
  unattributed: { bar: 'bg-line',        text: 'text-ink-muted',   dot: 'bg-line' },
};

/** One order behind a bucket of the earnings split. Mirrors the orders route. */
export interface SourceOrderRow {
  id: string;
  kind: 'store' | 'hosted';
  reference: string;
  email: string | null;
  amount: number;
  currency: string;
  created_at: string;
  href: string;
  group: EarningsGroupKey;
  channel: string | null;
  campaign: string | null;
  reason: string;
  evidence: Array<{ label: string; value: string }>;
  hints: Array<{ channel: string; reason: string }>;
  /** The breakdown row this order sits in (platform / affiliate / source). */
  sub: { key: string; label: string } | null;
  /** The flow email this order came through, if any. */
  email_flow: { label: string; evidence: 'click' | 'utm' } | null;
}

export interface SourceOrdersResponse {
  group: EarningsGroupKey;
  range: { from: string | null; to: string | null };
  available: boolean;
  orders: SourceOrderRow[];
  total: number;
  truncated: boolean;
  hinted: number;
}

/** The orders behind one bucket of the split, each with why it is there. */
export async function getEarningsGroupOrders(
  group: EarningsGroupKey,
  range?: AnalyticsRange,
): Promise<SourceOrdersResponse | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? null;

  const params = new URLSearchParams({ group });
  if (range?.from) params.set('from', range.from);
  if (range?.to) params.set('to', range.to);
  appendAdminViewParam(params);

  try {
    return await apiFetch<SourceOrdersResponse>(
      `/api/admin/analytics/attribution/orders?${params.toString()}`,
      { cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
  } catch (e) {
    console.error(e);
    return null;
  }
}

export type { FlowReport, MoneyByCurrency } from '@/lib/analytics/email-flow-report';
export type { EmailFlowAnalytics };

/** How the welcome and cart flows performed over the range — admin/assistant only. */
export async function getEmailFlowAnalytics(
  range?: AnalyticsRange,
): Promise<EmailFlowAnalytics | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? null;

  const params = new URLSearchParams();
  if (range?.from) params.set('from', range.from);
  if (range?.to) params.set('to', range.to);
  appendAdminViewParam(params);
  const qs = params.toString();

  try {
    return await apiFetch<EmailFlowAnalytics>(
      `/api/admin/analytics/email-flows${qs ? `?${qs}` : ''}`,
      { cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
  } catch (e) {
    console.error(e);
    return null;
  }
}
