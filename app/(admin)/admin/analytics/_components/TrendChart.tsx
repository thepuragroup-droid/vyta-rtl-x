'use client';

/**
 * The date-wise chart at the heart of the store report.
 *
 * One measure per chart, one y-scale — sales and orders live in separate cards
 * rather than sharing a plot with two scales, because a second axis invents a
 * correlation the data doesn't contain. Every chart ships a crosshair tooltip,
 * a direct end-label, keyboard navigation, and (via the section's Table toggle)
 * a table twin, so no value is reachable only by hovering.
 */

import React, { useMemo, useState } from 'react';

export interface TrendBucket {
  key: string;
  /** Short axis label, e.g. "Mar 4". */
  label: string;
  /** Full label for the tooltip / table, e.g. "Mar 4, 2026" or "Mar 4 – Mar 10". */
  full: string;
  value: number;
}

const W = 640;
const H = 232;
const PAD_L = 52;
const PAD_R = 18;
const PAD_T = 16;
const PAD_B = 30;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;
const BASE_Y = PAD_T + PLOT_H;

const MAX_BAR_W = 24;
const BAR_GAP = 2;
/** Surface gap between two stacked segments, so neighbours read as separate. */
const STACK_GAP = 2;
const MAX_AXIS_TICKS = 7;
/** Above this many series on one plot, end-labels collide — the legend carries it. */
const MAX_DIRECT_LABELS = 4;
/** Minimum vertical separation between two end-labels, in viewBox units. */
const LABEL_MIN_GAP = 13;
/**
 * Right-hand gutter reserved for end-labels on the multi-series chart.
 *
 * The single-series chart puts its end-label in an HTML layer over the plot,
 * which works for one number. Several of them have to sit clear of the lines
 * AND of each other, so the plot is narrowed to leave them their own column —
 * otherwise they are drawn over the data and clipped by the viewBox.
 */
const LABEL_GUTTER = 48;

/**
 * Round a scale top up to a clean number, so the y ticks read 0 / 250 / 500.
 *
 * `integral` matters more than it looks: the axis is labelled at 0, half, and
 * the top, so an odd top on a whole-number measure would print a midpoint of
 * "13" against a gridline sitting at 12.5. Nudging the top to the next even
 * number keeps every label exactly on its line.
 */
function niceMax(value: number, integral: boolean): number {
  if (!Number.isFinite(value) || value <= 0) return integral ? 2 : 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const n = value / base;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 4 ? 4 : n <= 5 ? 5 : 10;
  const top = step * base;
  if (!integral) return top;
  const whole = Math.max(2, Math.ceil(top));
  return whole % 2 === 0 ? whole : whole + 1;
}

/** Indices of the buckets that get an x-axis label — always the first and last. */
function axisTickIndices(n: number): number[] {
  if (n <= 0) return [];
  if (n <= MAX_AXIS_TICKS) return Array.from({ length: n }, (_, i) => i);
  const out = new Set<number>([0, n - 1]);
  const stride = (n - 1) / (MAX_AXIS_TICKS - 1);
  for (let i = 1; i < MAX_AXIS_TICKS - 1; i++) out.add(Math.round(i * stride));
  return [...out].sort((a, b) => a - b);
}

/** A column with rounded top corners and a square base, sitting on the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, Math.max(0, h));
  if (h <= 0.5) return `M ${x} ${BASE_Y - 0.5} h ${w} v 0.5 h ${-w} Z`;
  return [
    `M ${x} ${y + h}`,
    `V ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `H ${x + w - r}`,
    `Q ${x + w} ${y} ${x + w} ${y + r}`,
    `V ${y + h}`,
    'Z',
  ].join(' ');
}

export function TrendChart({
  buckets, color, kind, formatValue, formatTick, emptyText, valueLabel, integral,
}: {
  buckets: TrendBucket[];
  color: string;
  kind: 'line' | 'bar';
  formatValue: (n: number) => string;
  formatTick: (n: number) => string;
  emptyText: string;
  /** Name of the measure, read out in the tooltip and by screen readers. */
  valueLabel: string;
  /** True for counts (orders, visitors) — keeps the axis on whole numbers. */
  integral?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = buckets.length;

  const { top, x, y, band } = useMemo(() => {
    const peak = Math.max(0, ...buckets.map((b) => b.value));
    const scaleTop = niceMax(peak, Boolean(integral));
    const bandWidth = n > 0 ? PLOT_W / n : PLOT_W;
    return {
      top: scaleTop,
      band: bandWidth,
      // Lines sit on the band centres too, so a line and a bar chart of the
      // same data line up point-for-point when the reader switches type.
      x: (i: number) => PAD_L + bandWidth * (i + 0.5),
      y: (v: number) => PAD_T + PLOT_H * (1 - Math.max(0, v) / scaleTop),
    };
  }, [buckets, n, integral]);

  const ticks = useMemo(() => axisTickIndices(n), [n]);

  if (n === 0) {
    return (
      <div className="h-[232px] flex items-center justify-center text-xs text-ink-muted">{emptyText}</div>
    );
  }

  const linePath = buckets
    .map((b, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(b.value).toFixed(1)}`)
    .join(' ');
  const areaPath =
    n > 1
      ? `${linePath} L ${x(n - 1).toFixed(1)} ${BASE_Y} L ${x(0).toFixed(1)} ${BASE_Y} Z`
      : '';

  const barW = Math.max(1.5, Math.min(MAX_BAR_W, band - BAR_GAP));
  const last = buckets[n - 1];
  const hovered = hover != null ? buckets[hover] : null;

  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.floor((svgX - PAD_L) / band);
    setHover(idx >= 0 && idx < n ? idx : null);
  };

  const key = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 1 : -1;
    setHover((h) => Math.min(n - 1, Math.max(0, (h ?? n - 1) + step)));
  };

  const tipLeftPct = hover != null ? Math.min(86, Math.max(14, (x(hover) / W) * 100)) : 0;
  // The end value is direct-labelled; nudge it inside the plot on the last band.
  const endLabelX = Math.min(x(n - 1) + 6, W - PAD_R);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto touch-none"
        role="img"
        tabIndex={0}
        aria-label={`${valueLabel} from ${buckets[0].full} to ${last.full}. Latest ${formatValue(last.value)}.`}
        onPointerMove={move}
        onPointerLeave={() => setHover(null)}
        onKeyDown={key}
        onBlur={() => setHover(null)}
      >
        {/* Gridlines + y ticks — hairline, solid, one step off the surface. */}
        {[0, 0.5, 1].map((t) => {
          const gy = PAD_T + PLOT_H * t;
          const value = top * (1 - t);
          return (
            <g key={t}>
              <line x1={PAD_L} x2={W - PAD_R} y1={gy} y2={gy} stroke="#E4E6E9" strokeWidth={1} />
              <text x={PAD_L - 8} y={gy + 3.5} textAnchor="end"
                className="fill-ink-light" style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
                {formatTick(value)}
              </text>
            </g>
          );
        })}

        {kind === 'line' ? (
          <>
            {n > 1 && <path d={areaPath} fill={color} fillOpacity={0.1} stroke="none" />}
            <path d={linePath} fill="none" stroke={color} strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round" />
            {n === 1 && <circle cx={x(0)} cy={y(buckets[0].value)} r={4} fill={color} stroke="#fff" strokeWidth={2} />}
            {n > 1 && <circle cx={x(n - 1)} cy={y(last.value)} r={4} fill={color} stroke="#fff" strokeWidth={2} />}
          </>
        ) : (
          buckets.map((b, i) => {
            const h = BASE_Y - y(b.value);
            return (
              <path key={b.key} d={barPath(x(i) - barW / 2, y(b.value), barW, h)} fill={color} />
            );
          })
        )}

        {/* x-axis labels */}
        {ticks.map((i) => (
          <text key={buckets[i].key} x={x(i)} y={H - 10} textAnchor="middle"
            className="fill-ink-light" style={{ fontSize: 10 }}>
            {buckets[i].label}
          </text>
        ))}

        {/* Crosshair */}
        {hover != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={BASE_Y}
              stroke="#8A8A8A" strokeWidth={1} strokeOpacity={0.6} />
            <circle cx={x(hover)} cy={y(buckets[hover].value)} r={4.5}
              fill={color} stroke="#fff" strokeWidth={2} />
          </g>
        )}
      </svg>

      {/* Direct end-label: the one value the reader always gets without hovering. */}
      {hover == null && (
        <div className="pointer-events-none absolute text-[11px] font-semibold text-ink tabular-nums"
          style={{ left: `${(endLabelX / W) * 100}%`, top: `${(y(last.value) / H) * 100}%`, transform: 'translate(-100%, -140%)' }}>
          {formatValue(last.value)}
        </div>
      )}

      {hovered && (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg bg-ink text-white text-[11px] px-2.5 py-1.5 shadow-lg whitespace-nowrap"
          style={{ left: `${tipLeftPct}%`, top: 2 }}>
          <div className="font-semibold mb-0.5">{hovered.full}</div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} aria-hidden />
            <span className="text-white/80">{valueLabel}</span>
            <span className="ml-2 font-semibold tabular-nums">{formatValue(hovered.value)}</span>
          </div>
        </div>
      )}
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* Multi-series                                                        */
/* ------------------------------------------------------------------ */

export interface MultiTrendBucket {
  key: string;
  /** Short axis label, e.g. "Mar 4". */
  label: string;
  /** Full label for the tooltip / table, e.g. "Mar 4, 2026". */
  full: string;
  /** One value per series key. A missing key reads as zero. */
  values: Record<string, number>;
}

export interface TrendSeries {
  key: string;
  label: string;
  color: string;
  /** Shown in the legend's tooltip — what this series counts. */
  hint?: string;
}

/**
 * The same chart with several measures on it — used for order outcomes, where
 * "how many paid" only means something next to "how many did not".
 *
 * One y-scale for all of them, because they are all the same measure (orders)
 * in the same unit. That is the condition for putting several series on one
 * plot at all; two different units would need two cards, which is why sales and
 * orders are still separate charts above.
 *
 * `line` overlays the series; `bar` STACKS them. Stacking is honest here and
 * only here because the buckets are mutually exclusive and total — every order
 * is in exactly one — so a column really is the day's orders placed. The
 * caller guarantees that (lib/admin/order-status-buckets.ts); a chart of
 * overlapping filters must use lines.
 */
export function MultiTrendChart({
  buckets, series, kind, formatValue, formatTick, emptyText, integral,
}: {
  buckets: MultiTrendBucket[];
  series: TrendSeries[];
  kind: 'line' | 'bar';
  formatValue: (n: number) => string;
  formatTick: (n: number) => string;
  emptyText: string;
  integral?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = buckets.length;
  const valueAt = (i: number, key: string) => Math.max(0, Number(buckets[i]?.values[key]) || 0);

  // Direct end-labels only where they fit: a stack has no single end to label,
  // and past four lines the numbers cannot be pushed apart without lying about
  // where they sit. The legend carries identity in every case.
  const labelsOn = kind === 'line' && series.length <= MAX_DIRECT_LABELS;
  const padR = labelsOn ? LABEL_GUTTER : PAD_R;
  const plotW = W - PAD_L - padR;

  const { top, x, y, band } = useMemo(() => {
    // Stacked bars are scaled to the column total; overlaid lines to the
    // tallest single series, or the whole stack would leave the plot empty.
    const peak = Math.max(
      0,
      ...buckets.map((b) => {
        const values = series.map((s) => Math.max(0, Number(b.values[s.key]) || 0));
        return kind === 'bar'
          ? values.reduce((sum, v) => sum + v, 0)
          : Math.max(0, ...values);
      }),
    );
    const scaleTop = niceMax(peak, Boolean(integral));
    const bandWidth = n > 0 ? plotW / n : plotW;
    return {
      top: scaleTop,
      band: bandWidth,
      x: (i: number) => PAD_L + bandWidth * (i + 0.5),
      y: (v: number) => PAD_T + PLOT_H * (1 - Math.max(0, v) / scaleTop),
    };
  }, [buckets, series, n, kind, integral, plotW]);

  const ticks = useMemo(() => axisTickIndices(n), [n]);

  if (n === 0 || series.length === 0) {
    return (
      <div className="h-[232px] flex items-center justify-center text-xs text-ink-muted">{emptyText}</div>
    );
  }

  const barW = Math.max(1.5, Math.min(MAX_BAR_W, band - BAR_GAP));
  const last = buckets[n - 1];
  const hovered = hover != null ? buckets[hover] : null;

  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.floor((svgX - PAD_L) / band);
    setHover(idx >= 0 && idx < n ? idx : null);
  };

  const key = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 1 : -1;
    setHover((h) => Math.min(n - 1, Math.max(0, (h ?? n - 1) + step)));
  };

  const tipLeftPct = hover != null ? Math.min(84, Math.max(16, (x(hover) / W) * 100)) : 0;
  const summary = series
    .map((s) => `${s.label} ${formatValue(valueAt(n - 1, s.key))}`)
    .join(', ');

  /**
   * Each line's last value, labelled on the plot so identity does not rest on
   * hue alone. Labels are pushed apart when two series end close together —
   * without that, three series converging on zero print one number on top of
   * another. Only in line mode, and only up to MAX_DIRECT_LABELS: a stack's
   * segments have no single end to label, and five labels always collide.
   */
  const endLabels = (() => {
    if (!labelsOn) return [];
    const placed = series
      .map((s) => ({ s, value: valueAt(n - 1, s.key), y: y(valueAt(n - 1, s.key)) }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < placed.length; i++) {
      const gap = placed[i].y - placed[i - 1].y;
      if (gap < LABEL_MIN_GAP) placed[i].y = placed[i - 1].y + LABEL_MIN_GAP;
    }
    // Nudge the whole run back inside the plot if the pushing overflowed it.
    const overflow = placed.length > 0 ? placed[placed.length - 1].y - BASE_Y : 0;
    if (overflow > 0) for (const p of placed) p.y -= overflow;
    return placed;
  })();

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto touch-none"
        role="img"
        tabIndex={0}
        aria-label={`Order outcomes from ${buckets[0].full} to ${last.full}. Latest: ${summary}.`}
        onPointerMove={move}
        onPointerLeave={() => setHover(null)}
        onKeyDown={key}
        onBlur={() => setHover(null)}
      >
        {[0, 0.5, 1].map((t) => {
          const gy = PAD_T + PLOT_H * t;
          const value = top * (1 - t);
          return (
            <g key={t}>
              <line x1={PAD_L} x2={W - padR} y1={gy} y2={gy} stroke="#E4E6E9" strokeWidth={1} />
              <text x={PAD_L - 8} y={gy + 3.5} textAnchor="end"
                className="fill-ink-light" style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
                {formatTick(value)}
              </text>
            </g>
          );
        })}

        {kind === 'line' ? (
          series.map((s) => {
            const path = buckets
              .map((_, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(valueAt(i, s.key)).toFixed(1)}`)
              .join(' ');
            return (
              <g key={s.key}>
                {/* No area fill with several series — overlapping washes hide
                    whichever line is drawn first. */}
                <path d={path} fill="none" stroke={s.color} strokeWidth={2}
                  strokeLinejoin="round" strokeLinecap="round" />
                <circle cx={x(n - 1)} cy={y(valueAt(n - 1, s.key))} r={3.5}
                  fill={s.color} stroke="#fff" strokeWidth={1.5} />
              </g>
            );
          })
        ) : (
          buckets.map((b, i) => {
            // Drawn from the baseline up, in the fixed series order, so a
            // column reads the same way on every day. Only the topmost segment
            // gets rounded corners; the rest are square where they meet.
            const present = series.filter((s) => valueAt(i, s.key) > 0);
            let base = BASE_Y;
            return (
              <g key={b.key}>
                {present.map((s, index) => {
                  const value = valueAt(i, s.key);
                  // Segment height straight from the scale, not from two y()
                  // calls: stacking differences of rounded pixels drifts the
                  // top of a tall column off the value it's supposed to show.
                  const height = (PLOT_H * value) / top;
                  const yTop = base - height;
                  base = yTop;
                  // A gap in the surface colour separates neighbours, rather
                  // than a stroke — but never at the cost of the segment
                  // disappearing, so a thin one keeps its whole height.
                  const gap = index === present.length - 1 ? 0 : Math.min(STACK_GAP, height / 2);
                  const drawn = Math.max(0.5, height - gap);
                  const isTop = index === present.length - 1;
                  return isTop ? (
                    <path key={s.key} d={barPath(x(i) - barW / 2, yTop + gap, barW, drawn)}
                      fill={s.color} />
                  ) : (
                    <rect key={s.key} x={x(i) - barW / 2} y={yTop + gap} width={barW}
                      height={drawn} fill={s.color} />
                  );
                })}
              </g>
            );
          })
        )}

        {ticks.map((i) => (
          <text key={buckets[i].key} x={x(i)} y={H - 10} textAnchor="middle"
            className="fill-ink-light" style={{ fontSize: 10 }}>
            {buckets[i].label}
          </text>
        ))}

        {/* Direct end-labels, hidden while the crosshair is up — the tooltip is
            saying the same thing more precisely. */}
        {hover == null && endLabels.map(({ s, value, y: labelY }) => (
          <text key={s.key} x={x(n - 1) + 6} y={labelY + 3.5}
            textAnchor="start" className="fill-ink"
            style={{ fontSize: 10, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {formatValue(value)}
          </text>
        ))}

        {hover != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={BASE_Y}
              stroke="#8A8A8A" strokeWidth={1} strokeOpacity={0.6} />
            {kind === 'line' && series.map((s) => (
              <circle key={s.key} cx={x(hover)} cy={y(valueAt(hover, s.key))} r={4}
                fill={s.color} stroke="#fff" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>

      {hovered && (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg bg-ink text-white text-[11px] px-2.5 py-1.5 shadow-lg whitespace-nowrap"
          style={{ left: `${tipLeftPct}%`, top: 2 }}>
          <div className="font-semibold mb-1">{hovered.full}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              {/* A short stroke rather than a filled box: at tooltip density a
                  block of series colour is data-weight ink doing a label's job. */}
              <span className="inline-block w-2.5 h-[2px] rounded-full" style={{ background: s.color }} aria-hidden />
              <span className="text-white/80">{s.label}</span>
              <span className="ml-auto pl-3 font-semibold tabular-nums">
                {formatValue(valueAt(hover!, s.key))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The legend, which doubles as the series switch — clicking a key adds or
 * removes that series from the plot. Never lets the last one be turned off: an
 * empty chart is a broken chart, not a filter.
 */
export function SeriesLegend({ series, active, onToggle, totals, formatValue, mark = 'line' }: {
  series: TrendSeries[];
  active: Set<string>;
  onToggle: (key: string) => void;
  /** Range total per series, shown beside the key so the legend is also a summary. */
  totals?: Record<string, number>;
  formatValue?: (n: number) => string;
  /** The key mirrors the mark on the plot: a stroke for lines, a block for bars. */
  mark?: 'line' | 'bar';
}) {
  const format = formatValue ?? ((n: number) => n.toLocaleString());
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5" role="group" aria-label="Chart series">
      {series.map((s) => {
        const on = active.has(s.key);
        const onlyOne = on && active.size === 1;
        return (
          <button key={s.key} type="button" onClick={() => onToggle(s.key)}
            aria-pressed={on}
            disabled={onlyOne}
            title={onlyOne ? 'At least one series has to stay on the chart.' : s.hint ?? s.label}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
              on ? 'border-line bg-white text-ink' : 'border-transparent bg-surface text-ink-muted hover:text-ink'
            } ${onlyOne ? 'cursor-default' : ''}`}>
            <span
              className={`inline-block shrink-0 ${
                mark === 'bar' ? 'w-2.5 h-2.5 rounded-[2px]' : 'w-3 h-[2px] rounded-full'
              }`}
              style={{ background: on ? s.color : 'transparent', boxShadow: on ? 'none' : `inset 0 0 0 1.5px ${s.color}` }}
              aria-hidden />
            {s.label}
            {totals && (
              <span className="font-semibold tabular-nums">{format(totals[s.key] ?? 0)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
