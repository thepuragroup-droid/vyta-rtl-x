'use client';

/**
 * Small pieces of the Stealth Health Payouts tab: pill toggles, the fee
 * switch, status chips, the date-range filter and the action toast (Undo /
 * Download PDF).
 */
import React, { useEffect } from 'react';
import { Check, Heart, Minus, X, CalendarRange } from 'lucide-react';
import {
  DATE_PRESET_OPTIONS,
  formatRate,
  type DatePreset,
  type DateRange,
  type FeeRates,
  type FeeType,
  type FigureSource,
  type PayoutOrder,
} from '@/lib/admin/stealth-health-payouts';
import { formatAppDate } from '@/lib/datetime';
import { money, fmtDate } from '../ui';

export function PillToggle<T extends string>({ value, options, onChange, size = 'md', disabled }: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
}) {
  return (
    <div className={`inline-flex items-center rounded-lg border border-line bg-white p-0.5 ${disabled ? 'opacity-60' : ''}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            onClick={() => !on && onChange(o.value)}
            aria-pressed={on}
            className={`rounded-md font-medium transition-colors whitespace-nowrap ${
              size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-xs'
            } ${on ? 'bg-teal-dark text-white' : 'text-ink-muted hover:text-ink'} disabled:cursor-not-allowed`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Checkbox({ checked, indeterminate, onChange, label, disabled }: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      className={`grid h-4 w-4 place-items-center rounded border transition-colors disabled:opacity-40 ${
        checked || indeterminate ? 'border-teal-dark bg-teal-dark text-white' : 'border-ink-light/60 bg-white hover:border-teal-dark'
      }`}
    >
      {indeterminate ? <Minus className="h-3 w-3" /> : checked ? <Check className="h-3 w-3" /> : null}
    </button>
  );
}

export function StatTile({ label, value, sub, tone = 'ink' }: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  tone?: 'ink' | 'amber' | 'emerald' | 'teal';
}) {
  const color = {
    ink: 'text-ink',
    amber: 'text-amber-700',
    emerald: 'text-emerald-700',
    teal: 'text-teal-dark',
  }[tone];
  return (
    <div className="bg-white rounded-xl border border-line p-4">
      <p className="text-[10px] text-ink-muted uppercase tracking-wider font-semibold">{label}</p>
      <p className={`text-xl sm:text-2xl font-bold tabular-nums mt-1.5 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-ink-muted mt-1">{sub}</p>}
    </div>
  );
}

/** The 3.2% · 6% switch with the fee under it; paid-out orders show their locked rate. */
export function FeeCell({ order, rates, canEdit, onChange, align = 'right' }: {
  order: PayoutOrder;
  rates: FeeRates;
  canEdit: boolean;
  onChange: (t: FeeType) => void;
  align?: 'left' | 'right';
}) {
  const feeText = order.fee_cents == null ? '—' : money(order.fee_cents, 'CAD');
  const wrap = `flex flex-col gap-1 ${align === 'right' ? 'items-end' : 'items-start'}`;
  if (order.locked || !canEdit) {
    return (
      <div className={wrap} title={order.locked ? 'Locked when paid out' : undefined}>
        <span className="inline-flex rounded-md bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-muted">
          {formatRate(order.rate)}
        </span>
        <span className="text-[11px] tabular-nums text-ink-muted">{feeText}</span>
      </div>
    );
  }
  return (
    <div className={wrap}>
      <PillToggle
        size="sm"
        value={order.fee_type}
        onChange={onChange}
        options={[
          { value: 'catalog', label: formatRate(rates.catalog) },
          { value: 'custom', label: formatRate(rates.custom) },
        ]}
      />
      <span className="text-[11px] tabular-nums text-ink-muted">{feeText}</span>
    </div>
  );
}

export function StatusCell({ order, onOpenRequest }: {
  order: PayoutOrder;
  onOpenRequest: (id: string) => void;
}) {
  if (order.state === 'paid_out') {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 whitespace-nowrap">
        Paid out · {formatAppDate(order.paid_out_at, { month: 'short', day: 'numeric' })}
      </span>
    );
  }
  if (order.state === 'requested' && order.payout_request_id) {
    return (
      <button
        type="button"
        onClick={() => onOpenRequest(order.payout_request_id!)}
        className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-500/20 whitespace-nowrap"
        title="Show this request's orders"
      >
        {order.payout_number}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-gray-500/10 px-2 py-0.5 text-[11px] font-medium text-gray-600 whitespace-nowrap">
      Not requested
    </span>
  );
}

const SOURCE_LABEL: Record<FigureSource, string> = {
  webhook: "Stealth Health's payment webhook",
  portal: 'the order as last polled from Stealth Health',
  ledger: 'our hand-off record',
  invoice: 'our invoice',
  none: 'nowhere — not known',
};

export function sourceHint(kind: 'Customer' | 'Total', source: FigureSource): string {
  return `${kind} from ${SOURCE_LABEL[source]}`;
}

export function CustomerCell({ order }: { order: PayoutOrder }) {
  const named = order.customer_source === 'webhook' || order.customer_source === 'portal';
  return (
    <div className="min-w-0" title={sourceHint('Customer', order.customer_source)}>
      <p className="text-sm text-ink truncate flex items-center gap-1">
        {named && <Heart className="w-3 h-3 shrink-0 text-rose-500 fill-rose-500" aria-label="Named by Stealth Health" />}
        <span className="truncate">{order.customer_name ?? order.customer_email ?? 'Unknown customer'}</span>
      </p>
      {order.customer_name && order.customer_email && (
        <p className="text-[11px] text-ink-muted truncate">{order.customer_email}</p>
      )}
    </div>
  );
}

export function TotalCell({ order, align = 'right' }: { order: PayoutOrder; align?: 'left' | 'right' }) {
  return (
    <div className={align === 'right' ? 'text-right' : ''} title={sourceHint('Total', order.money_source)}>
      {order.gross_cents == null ? (
        <p className="text-xs font-medium text-amber-700">Amount unknown</p>
      ) : (
        <p className="text-sm tabular-nums text-ink">{money(order.gross_cents, 'CAD')}</p>
      )}
      {order.original_currency === 'USD' && order.original_total_cents != null && !order.locked && (
        <p className="text-[11px] tabular-nums text-ink-muted">{money(order.original_total_cents, 'USD')} USD</p>
      )}
      {order.refunded_cents > 0 && (
        <p className="text-[11px] text-rose-700" title="Refunds aren't taken off automatically — leave this order off the request, or mark it paid out.">
          {money(order.refunded_cents, order.original_currency)} refunded
        </p>
      )}
    </div>
  );
}

/** Date-preset select, custom from/to inputs, and the resolved range beside it. */
export function DateRangeFilter({ preset, custom, resolved, onPreset, onCustom }: {
  preset: DatePreset;
  custom: DateRange;
  resolved: DateRange;
  onPreset: (p: DatePreset) => void;
  onCustom: (r: DateRange) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative inline-flex items-center">
        <CalendarRange className="pointer-events-none absolute left-2.5 w-4 h-4 text-ink-muted" />
        <select
          value={preset}
          onChange={(e) => onPreset(e.target.value as DatePreset)}
          className="pl-8 pr-7 py-1.5 bg-white border border-line rounded-lg text-sm text-ink"
          aria-label="Date range"
        >
          {DATE_PRESET_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {preset === 'custom' && (
        <>
          <input type="date" value={custom.from ?? ''} aria-label="From"
            onChange={(e) => onCustom({ ...custom, from: e.target.value || null })}
            className="px-2 py-1.5 bg-white border border-line rounded-lg text-sm text-ink" />
          <span className="text-xs text-ink-muted">to</span>
          <input type="date" value={custom.to ?? ''} aria-label="To"
            onChange={(e) => onCustom({ ...custom, to: e.target.value || null })}
            className="px-2 py-1.5 bg-white border border-line rounded-lg text-sm text-ink" />
        </>
      )}
      {preset !== 'any' && preset !== 'custom' && (resolved.from || resolved.to) && (
        <span className="text-xs text-ink-muted">
          {resolved.from === resolved.to
            ? fmtDate(resolved.from)
            : `${fmtDate(resolved.from)} – ${fmtDate(resolved.to)}`}
        </span>
      )}
    </div>
  );
}

export interface ActionToastState {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** ms */
  duration: number;
}

/** A toast with one action button (Undo, Download PDF), dismissed after `duration`. */
export function ActionToast({ toast, onDismiss, raised }: {
  toast: ActionToastState | null;
  onDismiss: () => void;
  /** Lift it above the selection bar. */
  raised: boolean;
}) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, toast.duration);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);
  if (!toast) return null;
  return (
    <div
      className={`fixed left-1/2 -translate-x-1/2 z-[60] w-[min(92vw,420px)] transition-[bottom] ${raised ? 'bottom-24' : 'bottom-6'}`}
      role="status"
    >
      <div className="flex items-center gap-3 rounded-xl bg-ink text-white shadow-lg px-4 py-3">
        <p className="text-sm flex-1 min-w-0">{toast.message}</p>
        {toast.actionLabel && toast.onAction && (
          <button
            type="button"
            onClick={() => { toast.onAction!(); onDismiss(); }}
            className="text-sm font-semibold text-teal-light hover:text-white whitespace-nowrap"
          >
            {toast.actionLabel}
          </button>
        )}
        <button type="button" onClick={onDismiss} className="text-white/60 hover:text-white" aria-label="Dismiss">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
