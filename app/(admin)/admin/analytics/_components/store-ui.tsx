'use client';

/**
 * Shared pieces of the WooCommerce-style store report: formatting, the chart
 * palette, the KPI tile, and the ranked leaderboard table used for both the
 * product and the location breakdowns.
 */

import React from 'react';
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronRight, Minus } from 'lucide-react';
import { formatMoney, formatMoneyCompact, type Currency } from '@/lib/currency';

// ---- formatting ----

export const fmtInt = (n: number) => Math.round(Number(n) || 0).toLocaleString();

export const fmtMoney = (n: number, currency: Currency) => formatMoney(Number(n) || 0, currency);

/** Compact money for axis ticks: $1.2K / $340 — full precision lives in the tooltip. */
export const fmtMoneyCompact = (n: number, currency: Currency) =>
  formatMoneyCompact(Number(n) || 0, currency);

export const fmtPct = (n: number) => `${(Number(n) || 0).toFixed(1)}%`;

/** "Mar 4" — the day label used on axes and in tooltips. */
export function fmtDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? day
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** "Mar 4, 2026" — used where the year matters (range summaries, tables). */
export function fmtDayLong(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? day
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// ---- chart palette ----

/**
 * Three categorical hues in the documented fixed order (blue, orange, aqua) —
 * validated for colour-vision deficiency against a white card surface across
 * all pairs. Aqua sits just under 3:1 contrast, which is allowed here because
 * every chart ships direct end-labels and a table view.
 */
export const VIZ = {
  sales: '#1b5d83',
  orders: '#eb6834',
  visitors: '#1baf7a',
  grid: '#DCE7EB',
  surface: '#FFFFFF',
} as const;

// ---- deltas ----

export interface Delta {
  pct: number | null;   // null when the previous period was zero
  direction: 'up' | 'down' | 'flat';
}

export function computeDelta(current: number, previous: number | null | undefined): Delta | null {
  if (previous == null) return null;
  if (previous === 0) {
    if (current === 0) return { pct: 0, direction: 'flat' };
    return { pct: null, direction: 'up' };
  }
  const change = ((current - previous) / Math.abs(previous)) * 100;
  const rounded = +change.toFixed(1);
  return {
    pct: rounded,
    direction: rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat',
  };
}

function DeltaBadge({ delta, invert, comparedTo }: {
  delta: Delta; invert?: boolean; comparedTo: string;
}) {
  // `invert` is for measures where down is the good direction (none today, but
  // refunds will want it) — colour reflects good/bad, never direction alone.
  const good = delta.direction === 'flat'
    ? null
    : invert
      ? delta.direction === 'down'
      : delta.direction === 'up';
  const tone =
    good === null ? 'text-ink-muted' : good ? 'text-emerald-700' : 'text-red-700';
  const Icon =
    delta.direction === 'up' ? ArrowUpRight : delta.direction === 'down' ? ArrowDownRight : Minus;
  const label = delta.pct == null ? 'new' : `${delta.pct > 0 ? '+' : ''}${delta.pct}%`;

  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${tone}`}
      title={`vs ${comparedTo}`}>
      <Icon className="w-3.5 h-3.5" aria-hidden />
      {label}
    </span>
  );
}

// ---- KPI tile ----

export function StatTile({
  label, value, sub, delta, invertDelta, comparedTo, accent,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: Delta | null;
  invertDelta?: boolean;
  comparedTo?: string;
  /** Hex of the series this tile heads, drawn as a small key beside the label. */
  accent?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-line p-4">
      <div className="flex items-center gap-1.5 mb-1.5">
        {accent && (
          <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: accent }} aria-hidden />
        )}
        <p className="text-[10px] text-ink-muted uppercase tracking-wider font-semibold">{label}</p>
      </div>
      <p className="text-2xl font-bold text-ink leading-tight">{value}</p>
      <div className="flex items-center gap-2 mt-1 min-h-[1.25rem]">
        {delta && comparedTo && <DeltaBadge delta={delta} invert={invertDelta} comparedTo={comparedTo} />}
        {sub && <span className="text-xs text-ink-muted truncate">{sub}</span>}
      </div>
    </div>
  );
}

// ---- leaderboard ----

export interface LeaderboardColumn<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
}

/**
 * A ranked table with a share bar behind the leading column — the WooCommerce
 * "leaderboard". One hue for every bar: the bar length already encodes the
 * magnitude, so shading it by value would double-encode the same fact.
 */
export function Leaderboard<T extends { key: string }>({
  rows, header, label, columns, shareOf, emptyText, maxRows,
}: {
  rows: T[];
  /** Header of the leading (labelled) column. */
  header: string;
  label: (row: T) => React.ReactNode;
  /** The numeric columns to the right of the label. */
  columns: LeaderboardColumn<T>[];
  /** Value that drives the share bar and the "% of total" column. */
  shareOf: (row: T) => number;
  emptyText: string;
  maxRows?: number;
}) {
  const shown = maxRows ? rows.slice(0, maxRows) : rows;
  const total = rows.reduce((s, r) => s + Math.max(0, shareOf(r)), 0);
  const max = Math.max(1, ...shown.map((r) => Math.max(0, shareOf(r))));

  if (shown.length === 0) {
    return <div className="px-5 py-10 text-center text-sm text-ink-muted">{emptyText}</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[560px]">
        <thead>
          <tr className="border-b border-line bg-surface">
            <th className="px-5 py-2.5 text-left text-[10px] font-semibold text-ink-muted uppercase tracking-wider w-[40%]">
              {header}
            </th>
            {columns.map((c) => (
              <th key={c.key}
                className="px-5 py-2.5 text-right text-[10px] font-semibold text-ink-muted uppercase tracking-wider">
                {c.header}
              </th>
            ))}
            <th className="px-5 py-2.5 text-right text-[10px] font-semibold text-ink-muted uppercase tracking-wider">
              Share
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/50">
          {shown.map((row) => {
            const value = Math.max(0, shareOf(row));
            const share = total > 0 ? (value / total) * 100 : 0;
            return (
              <tr key={row.key} className="hover:bg-surface/60 transition-colors">
                <td className="px-5 py-2.5">
                  <div className="text-ink truncate mb-1.5">{label(row)}</div>
                  <div className="h-1.5 bg-surface rounded-full overflow-hidden">
                    <div className="h-full rounded-full"
                      style={{ width: `${Math.max(2, (value / max) * 100)}%`, background: VIZ.sales }} />
                  </div>
                </td>
                {columns.map((c) => (
                  <td key={c.key} className="px-5 py-2.5 text-right tabular-nums text-ink">
                    {c.render(row)}
                  </td>
                ))}
                <td className="px-5 py-2.5 text-right tabular-nums text-ink-muted">{share.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- card chrome ----

export function Panel({ title, icon: Icon, action, subtitle, children }: {
  title: string;
  icon?: React.ElementType;
  action?: React.ReactNode;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-line overflow-hidden">
      <div className="px-5 py-3.5 border-b border-line flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-ink text-sm flex items-center gap-2">
            {Icon && <Icon className="w-4 h-4 text-teal-dark" aria-hidden />} {title}
          </h3>
          {subtitle && <p className="text-[11px] text-ink-muted mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ---- expandable rows ----

/**
 * The disclosure control on a hierarchy row. A row with nothing beneath it
 * still reserves the width, so labels stay aligned down a column of siblings.
 */
export function ExpandToggle({ expanded, onToggle, label, hidden }: {
  expanded: boolean;
  onToggle: () => void;
  /** What expanding reveals, for screen readers. */
  label: string;
  hidden?: boolean;
}) {
  if (hidden) return <span className="inline-block w-4 shrink-0" aria-hidden />;
  return (
    <button type="button" onClick={onToggle} aria-expanded={expanded}
      aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
      className="inline-flex items-center justify-center w-4 h-4 shrink-0 text-ink-light hover:text-ink">
      {expanded
        ? <ChevronDown className="w-3.5 h-3.5" aria-hidden />
        : <ChevronRight className="w-3.5 h-3.5" aria-hidden />}
    </button>
  );
}

/** The thin magnitude bar that sits under a leaderboard or tree label. */
export function ShareBar({ value, max, color }: { value: number; max: number; color?: string }) {
  const width = max > 0 ? Math.max(2, (Math.max(0, value) / max) * 100) : 2;
  return (
    <div className="h-1.5 bg-surface rounded-full overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${width}%`, background: color ?? VIZ.sales }} />
    </div>
  );
}

/**
 * A two-part composition bar — used for the vial / pack split. Two hues from
 * the fixed categorical order, separated by a gap in the surface colour rather
 * than a stroke, and always accompanied by a legend.
 */
export function SplitBar({ segments }: {
  segments: Array<{ label: string; value: number; color: string }>;
}) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) return null;
  return (
    <div>
      <div className="flex w-full h-2 rounded-full overflow-hidden gap-[2px] bg-surface mb-2">
        {segments.filter((x) => x.value > 0).map((x) => (
          <div key={x.label} style={{ width: `${(x.value / total) * 100}%`, background: x.color }}
            title={`${x.label}: ${fmtInt(x.value)}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {segments.filter((x) => x.value > 0).map((x) => (
          <span key={x.label} className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: x.color }} aria-hidden />
            {x.label}
            <span className="font-semibold tabular-nums text-ink">{fmtInt(x.value)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Label/value pairs for an expanded detail panel. The label sits above its
 * value rather than beside it: side by side, a four-column grid wraps both
 * halves mid-phrase as soon as the value is a date.
 */
export function DetailGrid({ rows }: { rows: Array<{ label: string; value: React.ReactNode }> }) {
  return (
    <dl className="grid grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <dt className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold">{r.label}</dt>
          <dd className="text-sm font-semibold text-ink tabular-nums mt-0.5">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Header cell for the hand-rolled tables below — right-aligned numerics by default. */
export function Th({ children, align = 'right', width }: {
  children: React.ReactNode; align?: 'left' | 'right'; width?: string;
}) {
  return (
    <th className={`px-4 py-2.5 text-[10px] font-semibold text-ink-muted uppercase tracking-wider ${
      align === 'left' ? 'text-left' : 'text-right'
    } ${width ?? ''}`}>
      {children}
    </th>
  );
}
