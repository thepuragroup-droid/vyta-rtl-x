import { supabase } from '@/lib/supabase';
import { appendAdminViewParam } from '@/lib/admin/admin-view';
import { apiFetch } from '@/lib/api-fetch';
import type { AnalyticsRange } from '@/lib/admin/analytics';

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

/** Display names for the channel keys. Unknown keys fall back to the raw value. */
export const CHANNEL_LABELS: Record<string, string> = {
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
  bing_ads: 'Microsoft Ads',
  tiktok_ads: 'TikTok Ads',
  linkedin_ads: 'LinkedIn Ads',
  other_paid: 'Other paid',
  google_organic: 'Google organic',
  meta_organic: 'Meta organic',
  email: 'Email',
  affiliate: 'Affiliate',
  referral: 'Referral',
  direct: 'Direct',
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

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

/** Bar colour per earnings group. Paid carries the bronze accent — it is the
 *  one with a budget behind it, and the eye should land there first. */
export const EARNINGS_TINTS: Record<EarningsGroupKey, { bar: string; text: string; dot: string }> = {
  paid:         { bar: 'bg-bronze',      text: 'text-bronze',      dot: 'bg-bronze' },
  affiliate:    { bar: 'bg-blue-500',    text: 'text-blue-700',    dot: 'bg-blue-500' },
  organic:      { bar: 'bg-emerald-500', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  direct:       { bar: 'bg-ink/60',      text: 'text-ink',         dot: 'bg-ink/60' },
  unattributed: { bar: 'bg-line',        text: 'text-ink-muted',   dot: 'bg-line' },
};
