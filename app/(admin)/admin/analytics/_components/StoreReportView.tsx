'use client';

/**
 * The WooCommerce-style store report — Overview, Products, Customers and
 * Locations.
 *
 * All four views read one report, so the filter row (date range, channel,
 * compare) lives here at the top and scopes everything below it; switching
 * between the views does not refetch.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BarChart3, Calendar, CreditCard, Download, Globe2, Layers,
  LineChart as LineChartIcon, Loader2, MapPin, Package, RefreshCw, ShoppingBag,
  Table2, Timer, Users,
} from 'lucide-react';
import {
  STORE_CHANNELS, STORE_CHANNEL_LABEL, STORE_LOCATION_LEVEL_LABEL, STORE_RANGE_PRESETS,
  countryFlag, countryName, defaultStoreRange, getStoreReport, rangeDays, resolveRange,
  type StoreCategoryRow, type StoreChannel, type StoreCustomerRow, type StoreDailyPoint,
  type StoreLocationLevel, type StoreLocationNode, type StoreProductRow, type StoreRange,
  type StoreRangePresetId, type StoreReport, type StoreTotals,
} from '@/lib/admin/store-analytics';
import type { Currency } from '@/lib/currency';
import {
  DetailGrid, ExpandToggle, Leaderboard, Panel, ShareBar, SplitBar, StatTile, Th, VIZ,
  computeDelta, fmtDay, fmtDayLong, fmtInt, fmtMoney, fmtMoneyCompact, fmtPct,
} from './store-ui';
import {
  MultiTrendChart, SeriesLegend, TrendChart,
  type MultiTrendBucket, type TrendBucket, type TrendSeries,
} from './TrendChart';
import {
  ORDER_STATUS_BUCKETS,
  ORDER_STATUS_META,
  RECOVERABLE_STATUS_BUCKETS,
  type OrderStatusBucket,
} from '@/lib/admin/order-status-buckets';
import EarningsByChannel from '@/components/admin/EarningsByChannel';
import { PAID_ADS_SCOPE_NOTE } from '@/lib/analytics/paid-scope';

export type StoreView = 'overview' | 'products' | 'customers' | 'locations';

type Interval = 'day' | 'week' | 'month';
type ChartKind = 'line' | 'bar';
type Display = 'chart' | 'table';
type PlaceView = 'tree' | StoreLocationLevel;
type ProductGroup = 'products' | 'categories';
type ProductSort = 'net_sales' | 'items_sold' | 'orders';

// ---- interval bucketing ----

interface Aggregate {
  key: string;
  label: string;
  full: string;
  sales: number;
  orders: number;
  paid_orders: number;
  items: number;
  visitors: number;
  /** One count per outcome — see lib/admin/order-status-buckets.ts. */
  status: Record<OrderStatusBucket, number>;
  /** Cart value behind the bucket's pending / expired checkouts. Not revenue. */
  pending_value: number;
  expired_value: number;
}

/** The daily-point field carrying each status's count. */
const STATUS_FIELD: Record<OrderStatusBucket, keyof StoreDailyPoint> = {
  paid: 'paid_orders',
  pending: 'pending_orders',
  expired: 'expired_orders',
  cancelled: 'cancelled_orders',
  refunded: 'refunded_orders',
  other: 'other_orders',
};

/** The range total field for each status, so the legend can show it. */
const STATUS_TOTAL_FIELD: Record<OrderStatusBucket, keyof StoreTotals> = {
  paid: 'paid_orders',
  pending: 'pending_orders',
  expired: 'expired_orders',
  cancelled: 'cancelled_orders',
  refunded: 'refunded_orders',
  other: 'other_orders',
};

const emptyStatusCounts = (): Record<OrderStatusBucket, number> =>
  Object.fromEntries(ORDER_STATUS_BUCKETS.map((b) => [b, 0])) as Record<OrderStatusBucket, number>;

/**
 * The order-outcome series, in the fixed bucket order.
 *
 * `other` is dropped unless something actually landed in it: a permanently
 * empty legend key is a question the reader can't answer.
 */
function statusSeries(totals: StoreTotals): TrendSeries[] {
  return ORDER_STATUS_BUCKETS
    .filter((bucket) => bucket !== 'other' || (totals.other_orders ?? 0) > 0)
    .map((bucket) => ({
      key: bucket,
      label: ORDER_STATUS_META[bucket].label,
      color: ORDER_STATUS_META[bucket].color,
      hint: ORDER_STATUS_META[bucket].description,
    }));
}

/** Monday-start week containing `day`, as a YYYY-MM-DD (UTC). */
function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const mondayOffset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - mondayOffset);
  return d.toISOString().slice(0, 10);
}

function monthLabel(monthKey: string, long: boolean): string {
  const d = new Date(`${monthKey}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return monthKey;
  return d.toLocaleDateString(undefined, {
    month: long ? 'long' : 'short',
    year: long ? 'numeric' : undefined,
    timeZone: 'UTC',
  });
}

/**
 * Roll the dense daily series up to the chosen interval. Note that `visitors`
 * is a per-day distinct count, so a week bucket is the sum of its days — a
 * shopper active on three days counts three times. Said plainly in the chart
 * subtitle rather than silently presented as unique weekly visitors.
 */
function bucketDaily(daily: StoreDailyPoint[], interval: Interval): Aggregate[] {
  const byKey = new Map<string, Aggregate>();
  const order: string[] = [];

  for (const point of daily) {
    const key =
      interval === 'day' ? point.date
      : interval === 'week' ? weekStart(point.date)
      : point.date.slice(0, 7);

    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = {
        key,
        label:
          interval === 'day' ? fmtDay(key)
          : interval === 'week' ? fmtDay(key)
          : monthLabel(key, false),
        full:
          interval === 'day' ? fmtDayLong(key)
          : interval === 'week' ? `Week of ${fmtDayLong(key)}`
          : monthLabel(key, true),
        sales: 0, orders: 0, paid_orders: 0, items: 0, visitors: 0,
        status: emptyStatusCounts(), pending_value: 0, expired_value: 0,
      };
      byKey.set(key, bucket);
      order.push(key);
    }
    bucket.sales += point.sales;
    bucket.orders += point.orders;
    bucket.paid_orders += point.paid_orders;
    bucket.items += point.items;
    bucket.visitors += point.visitors;
    bucket.pending_value += point.pending_value ?? 0;
    bucket.expired_value += point.expired_value ?? 0;
    for (const status of ORDER_STATUS_BUCKETS) {
      // `?? 0` because a browser holding the previous report shape must not
      // turn every status into NaN the moment this deploys.
      bucket.status[status] += Number(point[STATUS_FIELD[status]] ?? 0) || 0;
    }
  }

  return order.map((k) => {
    const b = byKey.get(k)!;
    return {
      ...b,
      sales: Math.round(b.sales * 100) / 100,
      pending_value: Math.round(b.pending_value * 100) / 100,
      expired_value: Math.round(b.expired_value * 100) / 100,
    };
  });
}

// ---- location tree helpers ----

/** A node plus the labels of its ancestors, so a flat row can still say where it is. */
interface FlatPlace {
  node: StoreLocationNode;
  /** Ancestor labels, outermost first. */
  path: string[];
}

function walkPlaces(
  nodes: StoreLocationNode[],
  visit: (node: StoreLocationNode, path: string[]) => void,
  path: string[] = [],
) {
  for (const node of nodes) {
    visit(node, path);
    if (node.children.length > 0) walkPlaces(node.children, visit, [...path, displayPlace(node)]);
  }
}

/** Country nodes carry an ISO code; everything else already has a real label. */
function displayPlace(node: StoreLocationNode): string {
  return node.level === 'country' ? countryName(node.code) : node.label;
}

function flattenLevel(nodes: StoreLocationNode[], level: StoreLocationLevel): FlatPlace[] {
  const out: FlatPlace[] = [];
  walkPlaces(nodes, (node, path) => {
    if (node.level === level) out.push({ node, path });
  });
  return out.sort((a, b) => b.node.sales - a.node.sales || b.node.orders - a.node.orders);
}

/** Which levels the data actually reached, so the view switch offers only those. */
function availableLevels(nodes: StoreLocationNode[]): StoreLocationLevel[] {
  const seen = new Set<StoreLocationLevel>();
  walkPlaces(nodes, (node) => seen.add(node.level));
  return (['country', 'state', 'city', 'postal'] as StoreLocationLevel[]).filter((l) => seen.has(l));
}

// ---- CSV ----

function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [header, ...rows].map((r) => r.map(escape).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- small controls ----

function Segmented<T extends string>({ value, options, onChange, ariaLabel }: {
  value: T;
  options: Array<{ id: T; label: string; icon?: React.ElementType }>;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-white p-0.5" role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const Icon = o.icon;
        const active = o.id === value;
        return (
          <button key={o.id} type="button" onClick={() => onChange(o.id)}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] text-xs font-medium transition-colors ${
              active ? 'bg-teal-dark text-white' : 'text-ink-muted hover:text-ink hover:bg-surface'
            }`}>
            {Icon && <Icon className="w-3.5 h-3.5" aria-hidden />} {o.label}
          </button>
        );
      })}
    </div>
  );
}

function DateField({ label, value, max, onChange }: {
  label: string; value: string; max?: string; onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 bg-white border border-line rounded-lg px-2.5 py-1.5">
      <Calendar className="w-3.5 h-3.5 text-ink-muted" aria-hidden />
      <span className="text-[10px] text-ink-muted uppercase tracking-wider">{label}</span>
      <input type="date" value={value} max={max} onChange={(e) => onChange(e.target.value)}
        className="text-sm text-ink bg-transparent border-0 focus:outline-none" />
    </label>
  );
}

function CsvButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-line rounded-lg text-xs font-medium text-ink hover:bg-surface">
      <Download className="w-3.5 h-3.5" aria-hidden /> CSV
    </button>
  );
}

/** Toggle a key in a Set held in state, without mutating the previous value. */
function toggleKey(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}

// ---- the view ----

export function StoreReportView({ view }: { view: StoreView }) {
  const [range, setRange] = useState<StoreRange>(() => defaultStoreRange());
  const [channel, setChannel] = useState<StoreChannel | null>(null);   // null = let the server pick
  const [compare, setCompare] = useState(true);
  const [interval, setInterval] = useState<Interval>('day');
  const [chartKind, setChartKind] = useState<ChartKind>('line');
  const [display, setDisplay] = useState<Display>('chart');
  // Opens on the three outcomes the desk acts on: what paid, what still can,
  // and what lapsed. Cancelled and refunded are one click away.
  const [statusSeriesOn, setStatusSeriesOn] = useState<Set<string>>(
    () => new Set<string>(['paid', 'pending', 'expired']),
  );
  const [placeView, setPlaceView] = useState<PlaceView>('tree');
  const [expandedPlaces, setExpandedPlaces] = useState<Set<string>>(new Set());
  const [productGroup, setProductGroup] = useState<ProductGroup>('products');
  const [productSort, setProductSort] = useState<ProductSort>('net_sales');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const [report, setReport] = useState<StoreReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const r = await getStoreReport({
      from: range.from,
      to: range.to,
      channel: channel ?? undefined,
      compare,
    });
    setReport((prev) => r ?? prev);
    setFailed(r == null);
    setLoading(false);
    setRefreshing(false);
  }, [range.from, range.to, channel, compare]);

  useEffect(() => { load(); }, [load]);

  /**
   * Open the tree far enough that the answer is on screen without a click.
   * Countries always open — a single-country store showing one collapsed row
   * is the whole reason this view exists — and states open too whenever that
   * stays a readable number of rows.
   */
  useEffect(() => {
    if (!report) return;
    const countries = report.locations.tree;
    const states = countries.flatMap((c) => c.children.filter((n) => n.level === 'state'));
    const keys = countries.map((c) => c.key);
    if (states.length <= 12) keys.push(...states.map((s) => s.key));
    setExpandedPlaces(new Set(keys));
    setExpandedRows(new Set());
  }, [report]);

  // A long range makes daily bars unreadable — step up to a coarser default the
  // first time the reader crosses those thresholds, but never fight their choice.
  const applyPreset = (preset: StoreRangePresetId) => {
    const next = resolveRange(preset, range);
    setRange(next);
    const days = rangeDays(next);
    setInterval(days > 180 ? 'month' : days > 62 ? 'week' : 'day');
  };

  const buckets = useMemo(
    () => (report ? bucketDaily(report.daily, interval) : []),
    [report, interval],
  );
  const levels = useMemo(
    () => (report ? availableLevels(report.locations.tree) : []),
    [report],
  );
  const allStatusSeries = useMemo(
    () => (report ? statusSeries(report.totals) : []),
    [report],
  );
  const shownStatusSeries = useMemo(
    () => allStatusSeries.filter((s) => statusSeriesOn.has(s.key)),
    [allStatusSeries, statusSeriesOn],
  );
  const statusTotals = useMemo(() => {
    if (!report) return {};
    return Object.fromEntries(
      ORDER_STATUS_BUCKETS.map((bucket) => [
        bucket,
        Number(report.totals[STATUS_TOTAL_FIELD[bucket]] ?? 0) || 0,
      ]),
    );
  }, [report]);
  const statusBuckets = useMemo<MultiTrendBucket[]>(
    () => buckets.map((b) => ({ key: b.key, label: b.label, full: b.full, values: b.status })),
    [buckets],
  );
  // A paid-ads reader is told what the scope is once, above the tabs, so the
  // route's scope note is dropped here rather than shown as a warning on every
  // load. Everything else the route flagged still surfaces.
  const notes = useMemo(
    () => (report?.notes ?? []).filter((note) => note !== PAID_ADS_SCOPE_NOTE),
    [report],
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-ink-muted" aria-hidden />
        <p className="text-sm text-ink-muted">Loading store report…</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-sm text-ink-muted">Could not load the store report.</p>
        <button onClick={load}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-dark text-white rounded-lg text-sm font-medium hover:bg-teal/90">
          <RefreshCw className="w-4 h-4" aria-hidden /> Try again
        </button>
      </div>
    );
  }

  const cur: Currency = report.currency;
  const money = (n: number) => fmtMoney(n, cur);
  const moneyTick = (n: number) => fmtMoneyCompact(n, cur);
  const comparedTo = report.compare
    ? `${fmtDayLong(report.compare.from)} – ${fmtDayLong(report.compare.to)}`
    : '';
  const prev = report.previous;
  const products = sortProducts(report.products, productSort);

  return (
    <div className={refreshing ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      {/* One filter row, above everything it scopes. */}
      <div className="bg-white rounded-xl border border-line p-3 mb-5 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {STORE_RANGE_PRESETS.map((p) => (
            <button key={p.id} type="button" onClick={() => applyPreset(p.id)}
              aria-pressed={range.preset === p.id}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                range.preset === p.id
                  ? 'bg-teal-dark text-white border-teal'
                  : 'bg-white text-ink-muted border-line hover:bg-surface hover:text-ink'
              }`}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <DateField label="From" value={range.from} max={range.to}
            onChange={(v) => v && setRange({ preset: 'custom', from: v, to: range.to })} />
          <DateField label="To" value={range.to}
            onChange={(v) => v && setRange({ preset: 'custom', from: range.from, to: v })} />
          <label className="inline-flex items-center gap-1.5 text-xs text-ink-muted cursor-pointer select-none">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)}
              className="accent-teal" />
            Compare to previous period
          </label>
          <button onClick={load} disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-line rounded-lg text-sm text-ink hover:bg-surface disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden /> Refresh
          </button>
        </div>

        <div className="w-full flex flex-wrap items-center gap-2 pt-2 border-t border-line/70">
          <span className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold">Sales channel</span>
          {STORE_CHANNELS.map((c) => {
            const stat = report.channels[c];
            // Reflect the click straight away; the fetch behind it dims the view.
            const active = (channel ?? report.channel) === c;
            return (
              <button key={c} type="button" onClick={() => setChannel(c)} aria-pressed={active}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                  active ? 'bg-ink text-white border-ink' : 'bg-white text-ink-muted border-line hover:bg-surface hover:text-ink'
                }`}>
                {c === 'storefront'
                  ? <ShoppingBag className="w-3.5 h-3.5" aria-hidden />
                  : <CreditCard className="w-3.5 h-3.5" aria-hidden />}
                {STORE_CHANNEL_LABEL[c]}
                <span className={active ? 'text-white/70' : 'text-ink-light'}>
                  {fmtInt(stat.paid_orders)} paid · {stat.currency}
                </span>
              </button>
            );
          })}
          <span className="text-[11px] text-ink-muted">
            Channels are reported separately because they settle in different currencies.
          </span>
        </div>
      </div>

      {failed && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-5 flex items-center gap-2 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" aria-hidden />
          Could not refresh — these are the figures from the last successful load.
        </div>
      )}

      {/* The paid-ads scope is already stated once at the top of the page, so it
          is dropped here rather than repeated as a warning on every load. */}
      {notes.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-5 flex gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden />
          <ul className="text-xs text-amber-900 space-y-1">
            {notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </div>
      )}

      {view === 'overview' && (
        <>
          {/* Headline totals */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
            <StatTile label="Total sales" accent={VIZ.sales} value={money(report.totals.total_sales)}
              sub={report.totals.refunds > 0
                ? `excludes ${money(report.totals.refunds)} refunded`
                : 'shipping and tax included'}
              delta={computeDelta(report.totals.total_sales, prev?.total_sales)} comparedTo={comparedTo} />
            <StatTile label="Net sales" value={money(report.totals.net_sales)}
              sub="products only, no shipping"
              delta={computeDelta(report.totals.net_sales, prev?.net_sales)} comparedTo={comparedTo} />
            <StatTile label="Orders" accent={VIZ.orders} value={fmtInt(report.totals.paid_orders)}
              sub={`${fmtInt(report.totals.orders)} placed`}
              delta={computeDelta(report.totals.paid_orders, prev?.paid_orders)} comparedTo={comparedTo} />
            <StatTile label="Average order value" value={money(report.totals.aov)}
              delta={computeDelta(report.totals.aov, prev?.aov)} comparedTo={comparedTo} />
            <StatTile label="Products sold" value={fmtInt(report.totals.items_sold)}
              sub="units across paid orders"
              delta={computeDelta(report.totals.items_sold, prev?.items_sold)} comparedTo={comparedTo} />
            <StatTile label="Visitors" accent={VIZ.visitors} value={fmtInt(report.totals.visitors)}
              sub={`${fmtPct(report.totals.conversion)} converted`}
              delta={computeDelta(report.totals.visitors, prev?.visitors)} comparedTo={comparedTo} />
            {/* The unpaid half of the ledger. Kept out of the sales tiles above
                and given its own label, because it is money at stake and not
                money taken — reading it as revenue would overstate the range. */}
            <StatTile label="Pending payment" accent={ORDER_STATUS_META.pending.color}
              value={fmtInt(report.totals.pending_orders ?? 0)}
              sub={`${money(report.totals.pending_value ?? 0)} still recoverable`}
              delta={computeDelta(report.totals.pending_orders ?? 0, prev?.pending_orders)}
              invertDelta comparedTo={comparedTo} />
            <StatTile label="Expired" accent={ORDER_STATUS_META.expired.color}
              value={fmtInt(report.totals.expired_orders ?? 0)}
              sub={`${money(report.totals.expired_value ?? 0)} lapsed unpaid`}
              delta={computeDelta(report.totals.expired_orders ?? 0, prev?.expired_orders)}
              invertDelta comparedTo={comparedTo} />
          </div>

          {/* Where that money came from. Sits directly under the headline
              totals because "we made $X" and "we paid to make $Y of it" are
              the same question asked twice. */}
          <EarningsByChannel from={range.from} to={range.to} hasRange variant="compact" />

          {/* Chart controls, then the date-wise charts they scope. */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Segmented<Interval> ariaLabel="Chart interval" value={interval} onChange={setInterval}
              options={[
                { id: 'day', label: 'Day' },
                { id: 'week', label: 'Week' },
                { id: 'month', label: 'Month' },
              ]} />
            <Segmented<ChartKind> ariaLabel="Chart type" value={chartKind} onChange={setChartKind}
              options={[
                { id: 'line', label: 'Line', icon: LineChartIcon },
                { id: 'bar', label: 'Bar', icon: BarChart3 },
              ]} />
            <Segmented<Display> ariaLabel="Chart or table" value={display} onChange={setDisplay}
              options={[
                { id: 'chart', label: 'Chart', icon: LineChartIcon },
                { id: 'table', label: 'Table', icon: Table2 },
              ]} />
            <div className="ml-auto">
              <CsvButton onClick={() => downloadCsv(
                `sales-${report.channel}-${range.from}_${range.to}.csv`,
                ['date', 'orders_placed', 'paid_orders', 'pending_orders', 'expired_orders',
                 'cancelled_orders', 'refunded_orders', 'other_orders',
                 `sales_${cur}`, `pending_value_${cur}`, `expired_value_${cur}`,
                 'products_sold', 'visitors'],
                report.daily.map((d) => [
                  d.date, d.orders, d.paid_orders, d.pending_orders ?? 0, d.expired_orders ?? 0,
                  d.cancelled_orders ?? 0, d.refunded_orders ?? 0, d.other_orders ?? 0,
                  d.sales, d.pending_value ?? 0, d.expired_value ?? 0, d.items, d.visitors,
                ]),
              )} />
            </div>
          </div>

          {display === 'chart' ? (
            <div className="grid lg:grid-cols-2 gap-5 mb-6">
              <ChartCard title={`Sales — ${cur}`} subtitle={intervalSubtitle(interval, 'Revenue taken, net of refunds')}
                headline={money(report.totals.total_sales)}>
                <TrendChart buckets={toBuckets(buckets, 'sales')} color={VIZ.sales} kind={chartKind}
                  valueLabel="Sales" formatValue={money} formatTick={moneyTick}
                  emptyText="No sales in this range yet." />
              </ChartCard>
              <ChartCard title="Orders by outcome"
                subtitle={intervalSubtitle(
                  interval,
                  chartKind === 'bar'
                    // A stack only totals the orders placed when nothing is
                    // switched off — say which it is rather than let a partial
                    // column be read as the whole day.
                    ? shownStatusSeries.length === allStatusSeries.length
                      ? 'Every order placed, stacked by what became of it'
                      : 'The outcomes switched on, stacked — not every order placed'
                    : 'One line per outcome',
                )}
                headline={fmtInt(report.totals.paid_orders)}
                headlineNote="paid">
                <div className="mb-2.5">
                  <SeriesLegend
                    series={allStatusSeries}
                    active={statusSeriesOn}
                    onToggle={(key) => setStatusSeriesOn((prev) => toggleKey(prev, key))}
                    totals={statusTotals}
                    formatValue={fmtInt}
                    mark={chartKind === 'bar' ? 'bar' : 'line'}
                  />
                </div>
                <MultiTrendChart buckets={statusBuckets} series={shownStatusSeries} kind={chartKind}
                  formatValue={fmtInt} formatTick={fmtInt} integral
                  emptyText="No orders in this range yet." />
              </ChartCard>
              <ChartCard title="Visitors"
                subtitle={interval === 'day'
                  ? 'Distinct visitors per day'
                  : 'Sum of the daily distinct visitors'}
                headline={fmtInt(report.totals.visitors)}>
                <TrendChart buckets={toBuckets(buckets, 'visitors')} color={VIZ.visitors} kind={chartKind}
                  valueLabel="Visitors" formatValue={fmtInt} formatTick={fmtInt} integral
                  emptyText="No tracked shopper activity in this range yet." />
              </ChartCard>
              <SalesBreakdown report={report} />
              <CheckoutOutcomes report={report} />
            </div>
          ) : (
            <div className="mb-6">
              <Panel title="Date-wise figures" icon={Table2}
                subtitle={`${buckets.length} ${interval} buckets · amounts in ${cur}`}>
                <DailyTable buckets={buckets} currency={cur} />
              </Panel>
            </div>
          )}

          <div className="rounded-xl border border-line bg-surface/60 p-3 mb-6 text-[11px] text-ink-muted leading-relaxed">
            Days are bucketed in UTC. <span className="font-medium text-ink">Visitors</span> counts distinct
            people, signed-in or not — anonymous visitors are identified by their visitor cookie, and a
            session that starts anonymous and ends signed-in counts once. Visitors who decline the cookie
            banner are not recorded, so GA4 remains the fuller picture of total sessions.
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <Panel title="Top products" icon={Package} subtitle={`By net sales · ${cur}`}>
              <ProductLeaderboard rows={sortProducts(report.products, 'net_sales')} currency={cur} maxRows={6} />
            </Panel>
            <TopLocationsPanel report={report} currency={cur} />
          </div>
        </>
      )}

      {view === 'products' && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <Segmented<ProductGroup> ariaLabel="Group products" value={productGroup} onChange={setProductGroup}
              options={[
                { id: 'products', label: 'Products', icon: Package },
                { id: 'categories', label: 'Categories', icon: Layers },
              ]} />
            {productGroup === 'products' && (
              <Segmented<ProductSort> ariaLabel="Sort products" value={productSort} onChange={setProductSort}
                options={[
                  { id: 'net_sales', label: 'Sales' },
                  { id: 'items_sold', label: 'Units' },
                  { id: 'orders', label: 'Orders' },
                ]} />
            )}
            <div className="ml-auto">
              <CsvButton onClick={() => downloadCsv(
                `products-${report.channel}-${range.from}_${range.to}.csv`,
                ['product', 'sku', 'category', 'units_sold', 'single_vials', 'packs', 'orders',
                 'customers', `net_sales_${cur}`, `avg_unit_price_${cur}`, 'first_sale', 'last_sale'],
                products.map((p) => [
                  p.name, p.sku ?? '', p.category_name ?? p.category ?? '', p.items_sold,
                  p.units.vial, p.units.pack, p.orders, p.customers, p.net_sales, p.avg_price,
                  p.first_sale ?? '', p.last_sale ?? '',
                ]),
              )} />
            </div>
          </div>

          {productGroup === 'products' ? (
            <Panel title="Product-wise sales" icon={Package}
              subtitle={`${products.length} product${products.length === 1 ? '' : 's'} sold · amounts in ${cur} · expand a row for the detail`}>
              <ProductTable rows={products} currency={cur} sortKey={productSort}
                expanded={expandedRows} onToggle={(k) => setExpandedRows((s) => toggleKey(s, k))} />
            </Panel>
          ) : (
            <Panel title="Category-wise sales" icon={Layers}
              subtitle={`${report.categories.length} categor${report.categories.length === 1 ? 'y' : 'ies'} · amounts in ${cur} · expand a row for its products`}>
              <CategoryTable rows={report.categories} currency={cur}
                expanded={expandedRows} onToggle={(k) => setExpandedRows((s) => toggleKey(s, k))} />
            </Panel>
          )}
        </>
      )}

      {view === 'customers' && (
        <CustomersView report={report} currency={cur} comparedTo={comparedTo}
          onExportCsv={() => {
            const top = report.customers.top ?? [];
            downloadCsv(
              `customers-${report.channel}-${range.from}_${range.to}.csv`,
              ['customer', 'email', 'orders', 'units', `sales_${cur}`],
              top.map((c) => [c.name ?? '', c.email ?? '', c.orders, c.items, c.sales]),
            );
          }} />
      )}

      {view === 'locations' && (
        <>
          <Panel title="Customer locations" icon={MapPin}
            subtitle={
              `${fmtInt(report.locations.known_orders)} paid order${report.locations.known_orders === 1 ? '' : 's'} with an address` +
              (report.locations.unknown_orders > 0
                ? ` · ${fmtInt(report.locations.unknown_orders)} without one`
                : '')
            }
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Segmented<PlaceView> ariaLabel="Location view" value={placeView} onChange={setPlaceView}
                  options={[
                    { id: 'tree' as PlaceView, label: 'Hierarchy' },
                    ...levels.map((l) => ({ id: l as PlaceView, label: STORE_LOCATION_LEVEL_LABEL[l] })),
                  ]} />
                <CsvButton onClick={() => downloadCsv(
                  `locations-${report.channel}-${range.from}_${range.to}.csv`,
                  ['level', 'country', 'state', 'city', 'postal_area', 'orders', 'units', 'customers', `sales_${cur}`],
                  locationCsvRows(report.locations.tree),
                )} />
              </div>
            }>
            {placeView === 'tree' ? (
              <LocationTree nodes={report.locations.tree} currency={cur}
                expanded={expandedPlaces} onToggle={(k) => setExpandedPlaces((s) => toggleKey(s, k))} />
            ) : (
              <FlatLocationTable rows={flattenLevel(report.locations.tree, placeView)}
                level={placeView} currency={cur} />
            )}
          </Panel>

          <p className="text-[11px] text-ink-muted mt-3 leading-relaxed">
            Built from each order&apos;s shipping address, falling back to the address on the customer record.
            Provinces and states are matched by name or code, so &quot;ON&quot; and &quot;Ontario&quot; count as
            one place. Postal areas are the first three characters only (a Canadian FSA, or a US ZIP3) — coarse
            on purpose, since that is the level ad platforms target at.
            {report.locations.unknown_orders > 0 && (
              <> Orders with no address on file are excluded from every row, so the shares are of the located
              orders, not of all sales.</>
            )}
          </p>
        </>
      )}
    </div>
  );
}

// ---- pieces ----

function intervalSubtitle(interval: Interval, base: string): string {
  return interval === 'day' ? `${base}, per day` : `${base}, per ${interval}`;
}

function toBuckets(aggregates: Aggregate[], key: 'sales' | 'paid_orders' | 'items' | 'visitors'): TrendBucket[] {
  return aggregates.map((a) => ({ key: a.key, label: a.label, full: a.full, value: a[key] }));
}

function sortProducts(rows: StoreProductRow[], sort: ProductSort): StoreProductRow[] {
  return [...rows].sort((a, b) => b[sort] - a[sort] || b.net_sales - a.net_sales);
}

function ChartCard({ title, subtitle, headline, headlineNote, children }: {
  title: string; subtitle: string; headline: string;
  /** What the headline figure is, when the card plots more than that one thing. */
  headlineNote?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-line p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <p className="text-[11px] text-ink-muted mt-0.5">{subtitle}</p>
        </div>
        <p className="text-xl font-bold text-ink shrink-0 text-right">
          {headline}
          {headlineNote && (
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
              {headlineNote}
            </span>
          )}
        </p>
      </div>
      {children}
    </div>
  );
}

/** Where the money went between gross and what buyers actually paid. */
function SalesBreakdown({ report }: { report: StoreReport }) {
  const t = report.totals;
  const money = (n: number) => fmtMoney(n, report.currency);
  const rows: Array<{ label: string; value: string; strong?: boolean; muted?: boolean }> = [
    { label: 'Gross sales', value: money(t.gross_sales) },
    { label: 'Discounts', value: t.discounts > 0 ? `− ${money(t.discounts)}` : money(0), muted: true },
    { label: 'Refunds', value: t.refunds > 0 ? `− ${money(t.refunds)}` : money(0), muted: true },
    { label: 'Net sales', value: money(t.net_sales), strong: true },
    { label: 'Shipping', value: t.shipping > 0 ? `+ ${money(t.shipping)}` : money(0), muted: true },
    { label: 'Tax', value: t.tax > 0 ? `+ ${money(t.tax)}` : money(0), muted: true },
    { label: 'Total sales', value: money(t.total_sales), strong: true },
  ];
  return (
    <div className="bg-white rounded-xl border border-line p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Sales breakdown</h3>
          <p className="text-[11px] text-ink-muted mt-0.5">
            {t.refunded_orders > 0
              ? `${fmtInt(t.refunded_orders)} refunded order${t.refunded_orders === 1 ? '' : 's'} in this range`
              : 'No refunds in this range'}
          </p>
        </div>
      </div>
      <dl className="text-sm">
        {rows.map((r) => (
          <div key={r.label}
            className={`flex items-center justify-between py-1.5 ${r.strong ? 'border-t border-line mt-1 pt-2' : ''}`}>
            <dt className={r.muted ? 'text-ink-muted' : 'text-ink'}>{r.label}</dt>
            <dd className={`tabular-nums ${r.strong ? 'font-bold text-ink' : r.muted ? 'text-ink-muted' : 'text-ink font-medium'}`}>
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * What happened to every order placed — and what the unpaid ones are worth.
 *
 * Sits beside the sales breakdown because the two answer the same question from
 * opposite ends: that card is the money taken, this one is the money that was
 * on the table. The share bar can be read as a whole because the buckets are
 * mutually exclusive (lib/admin/order-status-buckets.ts).
 */
function CheckoutOutcomes({ report }: { report: StoreReport }) {
  const t = report.totals;
  const money = (n: number) => fmtMoney(n, report.currency);
  const placed = t.orders;
  const counts: Record<OrderStatusBucket, number> = {
    paid: t.paid_orders,
    pending: t.pending_orders ?? 0,
    expired: t.expired_orders ?? 0,
    cancelled: t.cancelled_orders ?? 0,
    refunded: t.refunded_orders ?? 0,
    other: t.other_orders ?? 0,
  };
  const recoverable = RECOVERABLE_STATUS_BUCKETS.reduce((sum, b) => sum + counts[b], 0);
  const atStake = (t.pending_value ?? 0) + (t.expired_value ?? 0);
  const segments = ORDER_STATUS_BUCKETS
    .filter((bucket) => counts[bucket] > 0)
    .map((bucket) => ({
      label: ORDER_STATUS_META[bucket].label,
      value: counts[bucket],
      color: ORDER_STATUS_META[bucket].color,
    }));

  return (
    <div className="bg-white rounded-xl border border-line p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-ink flex items-center gap-1.5">
            <Timer className="w-4 h-4 text-teal-dark" aria-hidden /> Checkout outcomes
          </h3>
          <p className="text-[11px] text-ink-muted mt-0.5">
            {fmtInt(placed)} order{placed === 1 ? '' : 's'} placed ·{' '}
            {fmtPct(placed > 0 ? (counts.paid / placed) * 100 : 0)} paid
          </p>
        </div>
      </div>

      {placed === 0 ? (
        <p className="py-8 text-center text-xs text-ink-muted">No orders placed in this range.</p>
      ) : (
        <>
          <SplitBar segments={segments} />

          {recoverable > 0 && (
            <div className="mt-4 rounded-lg border border-teal/30 bg-teal/5 p-3">
              <p className="text-xs text-ink">
                <span className="font-semibold">
                  {fmtInt(recoverable)} checkout{recoverable === 1 ? '' : 's'} never paid
                </span>
                {atStake > 0 && <> · {money(atStake)} of cart value</>}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <div className="flex items-center justify-between">
                  <dt className="text-ink-muted">Link still live</dt>
                  <dd className="font-semibold tabular-nums text-ink">
                    {fmtInt(counts.pending)} · {money(t.pending_value ?? 0)}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-ink-muted">Window lapsed</dt>
                  <dd className="font-semibold tabular-nums text-ink">
                    {fmtInt(counts.expired)} · {money(t.expired_value ?? 0)}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-[11px] text-ink-muted leading-relaxed">
                Cart value, not revenue — it is what these buyers would have paid. Chase them from{' '}
                <span className="font-medium text-ink">Stealth Health → Orders</span>, or the{' '}
                <span className="font-medium text-ink">Customers</span> desk.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DailyTable({ buckets, currency }: { buckets: Aggregate[]; currency: Currency }) {
  if (buckets.length === 0) {
    return <div className="px-5 py-10 text-center text-sm text-ink-muted">No activity in this range yet.</div>;
  }
  return (
    <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
      <table className="w-full text-sm min-w-[780px]">
        <thead className="sticky top-0">
          <tr className="border-b border-line bg-surface">
            <Th align="left">Date</Th>
            <Th>Sales</Th>
            <Th>Paid</Th>
            <Th>Pending</Th>
            <Th>Expired</Th>
            <Th>Orders placed</Th>
            <Th>Products sold</Th>
            <Th>Visitors</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/50">
          {buckets.map((b) => (
            <tr key={b.key} className="hover:bg-surface/60">
              <td className="px-4 py-2 text-ink whitespace-nowrap">{b.full}</td>
              <td className="px-4 py-2 text-right tabular-nums text-ink font-medium">{fmtMoney(b.sales, currency)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-ink">{fmtInt(b.status.paid)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                {fmtInt(b.status.pending)}
                {b.pending_value > 0 && (
                  <span className="block text-[10px] text-ink-light">{fmtMoney(b.pending_value, currency)}</span>
                )}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                {fmtInt(b.status.expired)}
                {b.expired_value > 0 && (
                  <span className="block text-[10px] text-ink-light">{fmtMoney(b.expired_value, currency)}</span>
                )}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-ink-muted">{fmtInt(b.orders)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-ink-muted">{fmtInt(b.items)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-ink-muted">{fmtInt(b.visitors)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Compact ranked products, used on the Overview. */
function ProductLeaderboard({ rows, currency, maxRows }: {
  rows: StoreProductRow[]; currency: Currency; maxRows?: number;
}) {
  return (
    <Leaderboard<StoreProductRow>
      rows={rows}
      maxRows={maxRows}
      shareOf={(r) => r.net_sales}
      header="Product"
      emptyText="No products sold in this range yet."
      label={(r) => (
        <span title={r.name}>
          {r.name}
          {r.category_name && <span className="text-ink-light text-xs ml-1.5">{r.category_name}</span>}
        </span>
      )}
      columns={[
        { key: 'units', header: 'Units', render: (r) => fmtInt(r.items_sold) },
        { key: 'orders', header: 'Orders', render: (r) => fmtInt(r.orders) },
        { key: 'sales', header: `Net sales (${currency})`, render: (r) => fmtMoney(r.net_sales, currency) },
      ]}
    />
  );
}

/** Full product table — every row expands into its unit split and lifetime-in-range. */
function ProductTable({ rows, currency, sortKey, expanded, onToggle }: {
  rows: StoreProductRow[];
  currency: Currency;
  sortKey: ProductSort;
  expanded: Set<string>;
  onToggle: (key: string) => void;
}) {
  if (rows.length === 0) {
    return <div className="px-5 py-10 text-center text-sm text-ink-muted">No products sold in this range yet.</div>;
  }
  const valueOf = (r: StoreProductRow) => r[sortKey];
  const max = Math.max(1, ...rows.map(valueOf));
  const total = rows.reduce((s, r) => s + Math.max(0, valueOf(r)), 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="border-b border-line bg-surface">
            <Th align="left" width="w-[38%]">Product</Th>
            <Th>Units</Th>
            <Th>Orders</Th>
            <Th>Customers</Th>
            <Th>Net sales ({currency})</Th>
            <Th>Share</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/50">
          {rows.map((r) => {
            const open = expanded.has(r.key);
            return (
              <React.Fragment key={r.key}>
                <tr className="hover:bg-surface/60 transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="flex items-start gap-2">
                      <ExpandToggle expanded={open} onToggle={() => onToggle(r.key)} label={r.name} />
                      <div className="min-w-0 flex-1">
                        <div className="text-ink truncate" title={r.name}>
                          {r.name}
                          {r.sku && <span className="text-ink-light font-mono text-xs ml-1.5">{r.sku}</span>}
                        </div>
                        <div className="text-[11px] text-ink-light mb-1.5">
                          {r.category_name ?? r.category ?? 'Uncategorised'}
                        </div>
                        <ShareBar value={valueOf(r)} max={max} />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">{fmtInt(r.items_sold)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">{fmtInt(r.orders)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">{fmtInt(r.customers)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink font-medium">
                    {fmtMoney(r.net_sales, currency)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                    {total > 0 ? `${((Math.max(0, valueOf(r)) / total) * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
                {open && (
                  <tr className="bg-surface/50">
                    <td colSpan={6} className="px-4 py-4 text-left">
                      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-6">
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold mb-2">
                            How it sold
                          </p>
                          <SplitBar segments={[
                            { label: 'Single vials', value: r.units.vial, color: VIZ.sales },
                            { label: 'Packs / cases', value: r.units.pack, color: VIZ.orders },
                            { label: 'Unit not recorded', value: r.units.other, color: '#DCE7EB' },
                          ]} />
                        </div>
                        <DetailGrid rows={[
                          { label: 'Average unit price', value: fmtMoney(r.avg_price, currency) },
                          { label: 'Units per order', value: r.orders > 0 ? (r.items_sold / r.orders).toFixed(1) : '—' },
                          { label: 'First sale', value: r.first_sale ? fmtDayLong(r.first_sale) : '—' },
                          { label: 'Last sale', value: r.last_sale ? fmtDayLong(r.last_sale) : '—' },
                        ]} />
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Categories, each expanding into the products inside it. */
function CategoryTable({ rows, currency, expanded, onToggle }: {
  rows: StoreCategoryRow[];
  currency: Currency;
  expanded: Set<string>;
  onToggle: (key: string) => void;
}) {
  if (rows.length === 0) {
    return <div className="px-5 py-10 text-center text-sm text-ink-muted">No sales to group in this range yet.</div>;
  }
  const max = Math.max(1, ...rows.map((r) => r.net_sales));
  const total = rows.reduce((s, r) => s + Math.max(0, r.net_sales), 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="border-b border-line bg-surface">
            <Th align="left" width="w-[38%]">Category</Th>
            <Th>Products</Th>
            <Th>Units</Th>
            <Th>Orders</Th>
            <Th>Net sales ({currency})</Th>
            <Th>Share</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/50">
          {rows.map((r) => {
            const open = expanded.has(r.key);
            const childMax = Math.max(1, ...r.products.map((p) => p.net_sales));
            return (
              <React.Fragment key={r.key}>
                <tr className="hover:bg-surface/60 transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="flex items-start gap-2">
                      <ExpandToggle expanded={open} onToggle={() => onToggle(r.key)} label={r.name} />
                      <div className="min-w-0 flex-1">
                        <div className="text-ink truncate mb-1.5">{r.name}</div>
                        <ShareBar value={r.net_sales} max={max} />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">{fmtInt(r.product_count)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">{fmtInt(r.items_sold)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">{fmtInt(r.orders)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink font-medium">
                    {fmtMoney(r.net_sales, currency)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                    {total > 0 ? `${((r.net_sales / total) * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
                {open && r.products.map((p) => (
                  <tr key={`${r.key}:${p.key}`} className="bg-surface/40">
                    <td className="px-4 py-2 pl-12">
                      <div className="text-ink text-xs truncate mb-1" title={p.name}>{p.name}</div>
                      <ShareBar value={p.net_sales} max={childMax} />
                    </td>
                    <td className="px-4 py-2 text-right text-ink-light">—</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-muted text-xs">{fmtInt(p.items_sold)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-muted text-xs">{fmtInt(p.orders)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink text-xs">{fmtMoney(p.net_sales, currency)}</td>
                    <td className="px-4 py-2 text-right text-ink-light">—</td>
                  </tr>
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- locations ----

const PLACE_INDENT = ['pl-0', 'pl-5', 'pl-10', 'pl-[3.75rem]'] as const;

/** Where a level normally sits in the hierarchy, so a skipped level can be flagged. */
const PLACE_DEPTH: Record<StoreLocationLevel, number> = {
  country: 0, state: 1, city: 2, postal: 3,
};

/** country → state → city → postal area, expandable in place. */
function LocationTree({ nodes, currency, expanded, onToggle }: {
  nodes: StoreLocationNode[];
  currency: Currency;
  expanded: Set<string>;
  onToggle: (key: string) => void;
}) {
  if (nodes.length === 0) {
    return <div className="px-5 py-10 text-center text-sm text-ink-muted">No orders with an address in this range yet.</div>;
  }
  const grandTotal = nodes.reduce((s, n) => s + Math.max(0, n.sales), 0);
  // Every bar is scaled to the whole table, not to its siblings: scaled per
  // level, a city's bar runs as long as the country containing it, and the
  // column reads as though they were the same size.
  const barMax = Math.max(1, grandTotal);

  const renderLevel = (level: StoreLocationNode[], depth: number): React.ReactNode[] => {
    return level.flatMap((node) => {
      const open = expanded.has(node.key);
      const hasChildren = node.children.length > 0;
      const rows: React.ReactNode[] = [
        <tr key={node.key} className={`hover:bg-surface/60 transition-colors ${depth === 0 ? '' : 'bg-surface/30'}`}>
          <td className="px-4 py-2">
            <div className={`flex items-start gap-2 ${PLACE_INDENT[Math.min(depth, 3)]}`}>
              <ExpandToggle expanded={open} hidden={!hasChildren}
                onToggle={() => onToggle(node.key)} label={displayPlace(node)} />
              <div className="min-w-0 flex-1">
                <div className={`truncate mb-1.5 ${depth === 0 ? 'text-ink font-medium' : 'text-ink text-xs'}`}>
                  {countryFlag(node.code) && node.level === 'country' && (
                    <span className="mr-1.5" aria-hidden>{countryFlag(node.code)}</span>
                  )}
                  {displayPlace(node)}
                  {/* Indentation already says what a row is — name the level only
                      where the address skipped one, so the depth would mislead. */}
                  {PLACE_DEPTH[node.level] !== depth && (
                    <span className="text-ink-light ml-1.5">{STORE_LOCATION_LEVEL_LABEL[node.level]}</span>
                  )}
                </div>
                <ShareBar value={node.sales} max={barMax} />
              </div>
            </div>
          </td>
          <td className="px-4 py-2 text-right tabular-nums text-ink">{fmtInt(node.orders)}</td>
          <td className="px-4 py-2 text-right tabular-nums text-ink-muted">{fmtInt(node.items)}</td>
          <td className="px-4 py-2 text-right tabular-nums text-ink-muted">{fmtInt(node.customers)}</td>
          <td className="px-4 py-2 text-right tabular-nums text-ink font-medium">{fmtMoney(node.sales, currency)}</td>
          <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
            {grandTotal > 0 ? `${((node.sales / grandTotal) * 100).toFixed(1)}%` : '—'}
          </td>
        </tr>,
      ];
      if (open && hasChildren) rows.push(...renderLevel(node.children, depth + 1));
      return rows;
    });
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="border-b border-line bg-surface">
            <Th align="left" width="w-[40%]">Place</Th>
            <Th>Orders</Th>
            <Th>Units</Th>
            <Th>Customers</Th>
            <Th>Sales ({currency})</Th>
            <Th>Share</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/50">{renderLevel(nodes, 0)}</tbody>
      </table>
    </div>
  );
}

/** Every place at one level, ranked — the "just show me all the cities" view. */
function FlatLocationTable({ rows, level, currency }: {
  rows: FlatPlace[]; level: StoreLocationLevel; currency: Currency;
}) {
  return (
    <Leaderboard<{ key: string } & FlatPlace>
      rows={rows.map((r) => ({ ...r, key: r.node.key }))}
      shareOf={(r) => r.node.sales}
      header={STORE_LOCATION_LEVEL_LABEL[level]}
      emptyText={`No ${STORE_LOCATION_LEVEL_LABEL[level].toLowerCase()} data in this range yet.`}
      label={(r) => (
        <span>
          {countryFlag(r.node.country) && <span className="mr-1.5" aria-hidden>{countryFlag(r.node.country)}</span>}
          {displayPlace(r.node)}
          {r.path.length > 0 && <span className="text-ink-light text-xs ml-1.5">{r.path.join(' · ')}</span>}
        </span>
      )}
      columns={[
        { key: 'orders', header: 'Orders', render: (r) => fmtInt(r.node.orders) },
        { key: 'units', header: 'Units', render: (r) => fmtInt(r.node.items) },
        { key: 'customers', header: 'Customers', render: (r) => fmtInt(r.node.customers) },
        { key: 'sales', header: `Sales (${currency})`, render: (r) => fmtMoney(r.node.sales, currency) },
      ]}
    />
  );
}

/**
 * The Overview location panel shows the finest level that actually has data —
 * a single-country store learns nothing from a one-row country table.
 */
function TopLocationsPanel({ report, currency }: { report: StoreReport; currency: Currency }) {
  const levels = availableLevels(report.locations.tree);
  const level: StoreLocationLevel =
    levels.includes('city') ? 'city' : levels.includes('state') ? 'state' : 'country';
  const rows = flattenLevel(report.locations.tree, level);
  return (
    <Panel title={`Top ${STORE_LOCATION_LEVEL_LABEL[level].toLowerCase()}s`} icon={Globe2}
      subtitle={`By sales · ${currency}`}>
      <FlatLocationTable rows={rows.slice(0, 6)} level={level} currency={currency} />
    </Panel>
  );
}

/** Every node in the tree, one CSV row each, with its ancestors filled in. */
function locationCsvRows(nodes: StoreLocationNode[]): (string | number)[][] {
  const out: (string | number)[][] = [];
  const visit = (node: StoreLocationNode, trail: Partial<Record<StoreLocationLevel, string>>) => {
    const here = { ...trail, [node.level]: displayPlace(node) };
    out.push([
      node.level,
      here.country ?? '',
      here.state ?? '',
      here.city ?? '',
      here.postal ?? '',
      node.orders,
      node.items,
      node.customers,
      node.sales,
    ]);
    for (const child of node.children) visit(child, here);
  };
  for (const node of nodes) visit(node, {});
  return out;
}

// ---- customers ----

function CustomersView({ report, currency, comparedTo, onExportCsv }: {
  report: StoreReport; currency: Currency; comparedTo: string; onExportCsv: () => void;
}) {
  const c = report.customers;
  const money = (n: number) => fmtMoney(n, currency);
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        <StatTile label="Customers" value={fmtInt(c.total)} sub="bought in this range"
          delta={computeDelta(c.total, report.previous?.customers)} comparedTo={comparedTo} />
        <StatTile label="New customers" accent={VIZ.sales} value={fmtInt(c.new)}
          sub="first ever purchase" />
        <StatTile label="Returning" accent={VIZ.orders} value={fmtInt(c.returning)}
          sub="had ordered before" />
        <StatTile label="Repeat rate" value={fmtPct(c.repeat_rate)} sub="returning ÷ customers" />
        <StatTile label="Orders per customer" value={c.orders_per_customer.toFixed(2)} />
        <StatTile label="Revenue per customer" value={money(c.sales_per_customer)} />
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-5">
        <Panel title="New vs returning" icon={Users} subtitle="Share of the buyers in this range">
          <div className="p-5">
            {c.total === 0 ? (
              <p className="text-sm text-ink-muted text-center py-4">No customers bought in this range yet.</p>
            ) : (
              <SplitBar segments={[
                { label: 'New', value: c.new, color: VIZ.sales },
                { label: 'Returning', value: c.returning, color: VIZ.orders },
              ]} />
            )}
            <p className="text-[11px] text-ink-muted mt-4 leading-relaxed">
              <span className="font-medium text-ink">{fmtInt(report.totals.new_customers)}</span> account
              {report.totals.new_customers === 1 ? '' : 's'} registered in this range, buying or not.
              A buyer counts as returning when they had a paid order on this channel before the range began;
              guest checkouts with no account cannot be matched to earlier orders and are counted as new.
              {c.truncated && ' This range has more buyers than the split can check in one pass, so treat it as indicative.'}
            </p>
          </div>
        </Panel>

        <Panel title="Top customers" icon={Users}
          subtitle={c.top ? `By sales · ${currency}` : 'Not available for this role'}
          action={c.top && c.top.length > 0 ? <CsvButton onClick={onExportCsv} /> : undefined}>
          {c.top ? (
            <Leaderboard<StoreCustomerRow>
              rows={c.top}
              shareOf={(r) => r.sales}
              header="Customer"
              emptyText="No customers bought in this range yet."
              label={(r) => (
                <span>
                  {r.name ?? r.email ?? 'Guest'}
                  {r.name && r.email && <span className="text-ink-light text-xs ml-1.5">{r.email}</span>}
                </span>
              )}
              columns={[
                { key: 'orders', header: 'Orders', render: (r) => fmtInt(r.orders) },
                { key: 'units', header: 'Units', render: (r) => fmtInt(r.items) },
                { key: 'sales', header: `Sales (${currency})`, render: (r) => fmtMoney(r.sales, currency) },
              ]}
            />
          ) : (
            <div className="px-5 py-10 text-center text-sm text-ink-muted">
              The analytics role sees customer totals but not individual customers, matching its access
              everywhere else in the admin.
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
