/**
 * WooCommerce-style store analytics — the shape of the store report, the date
 * range vocabulary the picker speaks, and the client fetcher.
 *
 * Kept free of server imports so both the API route (for its return type) and
 * the admin UI can import from here.
 *
 * Two sales channels exist and they are NOT denominated in the same currency,
 * so the report is always for exactly one of them:
 *   • `storefront` — the `orders` table (crypto / e-transfer checkout), CAD.
 *   • `puramass`   — the Stealth Health hosted-checkout ledger, usually USD.
 * Mixing them into one revenue number would silently add USD to CAD, so the UI
 * shows a channel switch and reports each channel in its own currency.
 */
import { appendAdminViewParam } from '@/lib/admin/admin-view';
import { apiFetch } from '@/lib/api-fetch';
import type { Currency } from '@/lib/currency';

export type StoreChannel = 'storefront' | 'puramass';

export const STORE_CHANNELS: StoreChannel[] = ['storefront', 'puramass'];

export const STORE_CHANNEL_LABEL: Record<StoreChannel, string> = {
  storefront: 'Storefront',
  puramass: 'Hosted checkout',
};

export interface StoreTotals {
  /** Sum of paid-order line subtotals, before order-level discounts. */
  gross_sales: number;
  /** Order-level discounts / coupons on paid orders. */
  discounts: number;
  /**
   * Refunded value in the range — whole refunded storefront orders, or partial
   * refunds on hosted-checkout orders. Already reflected in the sales figures
   * (a refunded storefront order is excluded; a partial refund reduces its
   * order's net), so this is the size of the refunding, not a further deduction.
   */
  refunds: number;
  shipping: number;
  tax: number;
  /** Products only, after discounts and refunds — no shipping, no tax. */
  net_sales: number;
  /** What buyers actually paid, shipping and tax included. Equals the sum of the daily series. */
  total_sales: number;
  /** Every order placed in the range, whatever its status. */
  orders: number;
  paid_orders: number;
  refunded_orders: number;
  /**
   * Checkouts still awaiting payment, with a live payment link. Money not yet
   * lost — the recoverable half of `unpaid_value`.
   */
  pending_orders: number;
  /** Checkouts whose payment window lapsed unpaid. */
  expired_orders: number;
  cancelled_orders: number;
  /** Orders in a status none of the buckets above claim. */
  other_orders: number;
  /**
   * Cart value sitting behind the pending / expired checkouts, in the report's
   * currency. NOT revenue and never added to sales — it is what the desk stands
   * to win by chasing, and what it loses by not.
   */
  pending_value: number;
  expired_value: number;
  /** total_sales ÷ paid_orders. */
  aov: number;
  items_sold: number;
  /** Distinct buyers behind the paid orders. */
  customers: number;
  /** Customer accounts created in the range. */
  new_customers: number;
  /**
   * Distinct signed-in shoppers with tracked activity. The storefront records
   * `customer_activity` for signed-in shoppers only, so this is NOT anonymous
   * traffic — GA4 remains the source of truth for that.
   */
  visitors: number;
  /** paid_orders ÷ visitors (%). */
  conversion: number;
}

export interface StoreDailyPoint {
  /** YYYY-MM-DD, bucketed on the UTC day the order was created. */
  date: string;
  orders: number;
  paid_orders: number;
  /**
   * The rest of the day's outcomes. Mutually exclusive with `paid_orders` and
   * with each other, so `paid_orders + pending + expired + cancelled +
   * refunded + other === orders` — which is what lets the status chart stack.
   * See lib/admin/order-status-buckets.ts.
   */
  pending_orders: number;
  expired_orders: number;
  cancelled_orders: number;
  refunded_orders: number;
  other_orders: number;
  /** Total sales for the day, net of refunds. */
  sales: number;
  /** Cart value behind that day's pending / expired checkouts. Not revenue. */
  pending_value: number;
  expired_value: number;
  items: number;
  visitors: number;
}

export interface StoreUnitSplit {
  /** Single-vial lines. */
  vial: number;
  /** Case / multi-vial pack lines. */
  pack: number;
  /** Lines whose unit type the order didn't record. */
  other: number;
}

export interface StoreProductRow {
  key: string;
  name: string;
  sku: string | null;
  /** Category slug from the catalog, when the product could be resolved. */
  category: string | null;
  /** Human label for that slug. */
  category_name: string | null;
  items_sold: number;
  orders: number;
  net_sales: number;
  /** Distinct buyers of this product. */
  customers: number;
  /** net_sales ÷ items_sold. */
  avg_price: number;
  units: StoreUnitSplit;
  /** First and last day (UTC) this product sold in the range. */
  first_sale: string | null;
  last_sale: string | null;
}

export interface StoreCategoryRow {
  key: string;
  name: string;
  items_sold: number;
  orders: number;
  net_sales: number;
  product_count: number;
  /** The products inside, already ranked — the category row expands into these. */
  products: StoreProductRow[];
}

export type StoreLocationLevel = 'country' | 'state' | 'city' | 'postal';

export const STORE_LOCATION_LEVEL_LABEL: Record<StoreLocationLevel, string> = {
  country: 'Country',
  state: 'State / province',
  city: 'City',
  postal: 'Postal area',
};

export interface StoreLocationNode {
  /** Unique path key, e.g. "CA|ON|toronto". */
  key: string;
  level: StoreLocationLevel;
  /** Display label — full province/state name, city name, or postal area. */
  label: string;
  /** Grouping code: ISO-2 country, province/state code, or postal area. */
  code: string;
  /** ISO-2 country this node sits under, so every level can show a flag. */
  country: string | null;
  orders: number;
  items: number;
  sales: number;
  customers: number;
  children: StoreLocationNode[];
}

export interface StoreLocations {
  /** country → state → city → postal area, each level ranked by sales. */
  tree: StoreLocationNode[];
  /** Paid orders whose address carried something usable. */
  known_orders: number;
  /** Paid orders with no address on file — shown so the split isn't read as complete. */
  unknown_orders: number;
}

export interface StoreCustomerRow {
  key: string;
  name: string | null;
  email: string | null;
  orders: number;
  items: number;
  sales: number;
}

export interface StoreCustomers {
  /** Distinct buyers in the range. */
  total: number;
  /** Buyers with no paid order before this range. */
  new: number;
  /** Buyers who had ordered before. */
  returning: number;
  /** returning ÷ total (%). */
  repeat_rate: number;
  orders_per_customer: number;
  sales_per_customer: number;
  /**
   * Named leaderboard. Null for the analytics/marketing role, which is not
   * permitted customer identities anywhere else in the admin either.
   */
  top: StoreCustomerRow[] | null;
  /** True when the new/returning split could only be computed for some buyers. */
  truncated: boolean;
}

export interface StoreChannelStat {
  orders: number;
  paid_orders: number;
  currency: Currency;
}

export interface StoreReport {
  channel: StoreChannel;
  /**
   * `paid_ads` when the reader only sees sales won by a paid ad — the
   * analytics/marketing role. Every figure in the report is then a paid-ads
   * subset (traffic included), and `notes` leads with the reason. `all` is the
   * whole business, as read by admin and assistant.
   */
  scope: 'paid_ads' | 'all';
  currency: Currency;
  range: { from: string; to: string; days: number };
  /** The immediately preceding window of the same length, or null when not compared. */
  compare: { from: string; to: string } | null;
  /** Both channels' order counts for the range, so the switch can show what's there. */
  channels: Record<StoreChannel, StoreChannelStat>;
  totals: StoreTotals;
  previous: StoreTotals | null;
  daily: StoreDailyPoint[];
  products: StoreProductRow[];
  categories: StoreCategoryRow[];
  locations: StoreLocations;
  customers: StoreCustomers;
  /** Non-fatal caveats worth surfacing (e.g. a migration that hasn't run). */
  notes: string[];
}

// ---- Date range presets ----

export type StoreRangePresetId =
  | 'today'
  | 'yesterday'
  | 'last_7'
  | 'last_30'
  | 'last_90'
  | 'month_to_date'
  | 'last_month'
  | 'year_to_date'
  | 'custom';

export interface StoreRange {
  preset: StoreRangePresetId;
  from: string;  // YYYY-MM-DD, inclusive
  to: string;    // YYYY-MM-DD, inclusive
}

/** Local (not UTC) YYYY-MM-DD — "today" has to mean the operator's today. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export const STORE_RANGE_PRESETS: Array<{ id: StoreRangePresetId; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last_7', label: 'Last 7 days' },
  { id: 'last_30', label: 'Last 30 days' },
  { id: 'last_90', label: 'Last 90 days' },
  { id: 'month_to_date', label: 'Month to date' },
  { id: 'last_month', label: 'Last month' },
  { id: 'year_to_date', label: 'Year to date' },
];

/** Resolve a preset against today's local date. `custom` echoes the dates given. */
export function resolveRange(preset: StoreRangePresetId, current?: StoreRange): StoreRange {
  const now = new Date();
  const today = isoDay(now);
  switch (preset) {
    case 'today':
      return { preset, from: today, to: today };
    case 'yesterday': {
      const y = isoDay(shiftDays(now, -1));
      return { preset, from: y, to: y };
    }
    case 'last_7':
      return { preset, from: isoDay(shiftDays(now, -6)), to: today };
    case 'last_30':
      return { preset, from: isoDay(shiftDays(now, -29)), to: today };
    case 'last_90':
      return { preset, from: isoDay(shiftDays(now, -89)), to: today };
    case 'month_to_date':
      return { preset, from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    case 'last_month': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { preset, from: isoDay(first), to: isoDay(last) };
    }
    case 'year_to_date':
      return { preset, from: isoDay(new Date(now.getFullYear(), 0, 1)), to: today };
    case 'custom':
    default:
      return {
        preset: 'custom',
        from: current?.from ?? isoDay(shiftDays(now, -29)),
        to: current?.to ?? today,
      };
  }
}

/** The default view: the last 30 days, the window most ad reporting is read over. */
export function defaultStoreRange(): StoreRange {
  return resolveRange('last_30');
}

// ---- Display helpers ----

/** Inclusive day count of a range. */
export function rangeDays(range: { from: string; to: string }): number {
  const a = Date.parse(`${range.from}T00:00:00Z`);
  const b = Date.parse(`${range.to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();

/** "CA" → "Canada". Falls back to the raw value when it isn't a known code. */
export function countryName(code: string | null): string {
  if (!code) return 'Unknown';
  if (code.length !== 2) return code;
  try {
    return regionNames?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** "CA" → 🇨🇦. Empty string when the code isn't a two-letter country. */
export function countryFlag(code: string | null): string {
  if (!code || code.length !== 2 || !/^[a-z]{2}$/i.test(code)) return '';
  return String.fromCodePoint(
    ...code.toUpperCase().split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

// ---- Client fetcher ----

export interface StoreReportQuery {
  from: string;
  to: string;
  channel?: StoreChannel;
  compare?: boolean;
}

export async function getStoreReport(q: StoreReportQuery): Promise<StoreReport | null> {
  const params = new URLSearchParams({ from: q.from, to: q.to });
  if (q.channel) params.set('channel', q.channel);
  if (q.compare) params.set('compare', 'previous');
  // Carries the admin's chosen view, so previewing the analytics staff view
  // narrows the figures at the database rather than only hiding pages.
  appendAdminViewParam(params);

  try {
    const result = await apiFetch<{ report: StoreReport }>(
      `/api/admin/analytics/store?${params.toString()}`,
      { cache: 'no-store', timeoutMs: 20_000 },
    );
    return result.report ?? null;
  } catch (e) {
    console.error('store report failed:', e);
    return null;
  }
}
