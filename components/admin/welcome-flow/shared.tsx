'use client';

/**
 * Shared bits for the Welcome Flow admin page: the API response shapes, date
 * formatting, and the small badges the tabs all use.
 */
import React from 'react';
import {
  STEP_META,
  SUBSCRIBER_STATUS_META,
  type CodeCheck,
  type FlowOverview,
  type StepNumber,
  type SubscriberStatus,
  type WelcomeFlowSettings,
  type WelcomeFlowStep,
} from '@/lib/welcome-flow/types';

export type AdminStep = WelcomeFlowStep & { code: CodeCheck | null; problems: string[] };

export interface FlowResponse {
  migrationNeeded?: boolean;
  migrationFile?: string;
  settings?: WelcomeFlowSettings;
  steps?: AdminStep[];
  overview?: FlowOverview;
  warnings?: string[];
}

export function stepTitle(step: number): string {
  const meta = STEP_META[step as StepNumber];
  return meta ? `Email ${step} · ${meta.label}` : `Email ${step}`;
}

export function whenLabel(delayDays: number): string {
  if (delayDays <= 0) return 'Immediately after signup';
  return `${delayDays} day${delayDays === 1 ? '' : 's'} later`;
}

export function fmtDateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return d.toLocaleString('en-CA', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      ...(timeZone ? { timeZone, timeZoneName: 'short' } : {}),
    });
  } catch {
    return d.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
}

export function fmtMoney(n: number, currency = 'CAD'): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n || 0);
}

export const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 1000) / 10}%` : '—');

const STATUS_CLASSES: Record<SubscriberStatus, string> = {
  active: 'bg-sky-100 text-sky-800',
  converted: 'bg-emerald-100 text-emerald-800',
  completed: 'bg-gray-100 text-ink-muted',
  unsubscribed: 'bg-amber-100 text-amber-800',
  exited: 'bg-gray-100 text-ink-muted',
};

export function StatusBadge({ status }: { status: SubscriberStatus }) {
  return (
    <span
      title={SUBSCRIBER_STATUS_META[status]?.description}
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASSES[status] ?? 'bg-gray-100 text-ink-muted'}`}
    >
      {SUBSCRIBER_STATUS_META[status]?.label ?? status}
    </span>
  );
}

export function Panel({ title, description, actions, children }: {
  title?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-white p-5">
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export const inputCls =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40 disabled:bg-surface disabled:text-ink-muted';
export const labelCls = 'mb-1 block text-xs font-medium text-ink';
export const primaryBtn =
  'inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/90 disabled:opacity-50';
export const secondaryBtn =
  'inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-surface disabled:opacity-50';
