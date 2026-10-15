'use client';

import React from 'react';
import { ArrowRight, Clock, Mail, Repeat, ShoppingCart, Tag, Users } from 'lucide-react';
import { FLOWS, type FlowKey, type FlowOverview, type FlowSettings } from '@/lib/email-flows/types';
import { fmtMoney, Panel, pct, stepTitle, whenLabel, type AdminStep } from './shared';

const hourLabel = (h: number) => {
  const hh = h % 24;
  const suffix = hh < 12 ? 'AM' : 'PM';
  return `${hh % 12 === 0 ? 12 : hh % 12} ${suffix}`;
};

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}

export default function OverviewTab({ flow, overview, steps, settings, onOpenEmail }: {
  flow: FlowKey;
  overview: FlowOverview;
  steps: AdminStep[];
  settings: FlowSettings;
  onOpenEmail: (step: number) => void;
}) {
  const s = overview.byStatus;
  const stats = new Map(overview.steps.map((x) => [x.step, x]));
  const cart = flow === 'cart';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label={cart ? 'Carts' : 'Enrolled'} value={String(overview.enrolled)} sub={cart ? 'abandoned & enrolled' : undefined} />
        <Kpi label="In flow" value={String(s.active)} sub="still receiving emails" />
        <Kpi label={cart ? 'Recovered' : 'Purchased'} value={String(s.converted)} sub={overview.conversionRate != null ? `${overview.conversionRate}% of ${cart ? 'carts' : 'enrolled'}` : undefined} />
        <Kpi label="Revenue" value={fmtMoney(overview.revenue)} sub={cart ? 'orders placed after abandoning' : 'first orders after enrolling'} />
        <Kpi label="Completed" value={String(s.completed)} sub="all 5, no purchase" />
        <Kpi label="Unsubscribed" value={String(s.unsubscribed)} sub={s.exited ? `${s.exited} removed${cart ? ' / emptied' : ''}` : undefined} />
      </div>

      <Panel
        title="Flow"
        description="Each email after the first only goes if the subscriber still hasn't purchased. Click an email to edit it."
      >
        <ol className="grid gap-3 md:grid-cols-5">
          {steps.map((step, i) => {
            const st = stats.get(step.step);
            const held = step.enabled && step.code && !step.code.usable;
            return (
              <li key={step.step} className="relative">
                <button
                  type="button"
                  onClick={() => onOpenEmail(step.step)}
                  className={`flex h-full w-full flex-col rounded-xl border p-4 text-left transition-colors hover:border-ink/30 ${
                    !step.enabled ? 'border-dashed border-line bg-surface opacity-70' : held ? 'border-amber-300 bg-amber-50/50' : 'border-line bg-white'
                  }`}
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">{step.step}</span>
                  <span className="mt-2 text-sm font-semibold text-ink">{whenLabel(flow, step.delay_hours)}</span>
                  <span className="mt-0.5 text-xs text-ink-muted">
                    {stepTitle(flow, step.step)}
                    {step.step > 1 || cart ? ' · if no purchase yet' : ''}
                  </span>
                  <span className="mt-2 line-clamp-2 text-xs italic text-ink-muted">“{step.subject}”</span>
                  {step.promo_code && (
                    <span className={`mt-2 inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${held ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>
                      <Tag className="h-3 w-3" /> {step.promo_code}
                      {step.code?.label ? ` · ${step.code.label}` : ''}
                      {held ? ' · on hold' : ''}
                    </span>
                  )}
                  {!step.enabled && <span className="mt-2 text-[11px] font-medium text-ink-muted">Switched off — skipped</span>}
                  <dl className="mt-auto grid grid-cols-2 gap-x-2 gap-y-1 border-t border-line pt-3 text-xs">
                    <dt className="text-ink-muted">Sent</dt>
                    <dd className="text-right tabular-nums text-ink">{st?.sent ?? 0}</dd>
                    <dt className="text-ink-muted">Opened</dt>
                    <dd className="text-right tabular-nums text-ink">{pct(st?.opened ?? 0, st?.sent ?? 0)}</dd>
                    <dt className="text-ink-muted">Clicked</dt>
                    <dd className="text-right tabular-nums text-ink">{pct(st?.clicked ?? 0, st?.sent ?? 0)}</dd>
                    <dt className="text-ink-muted">Purchases</dt>
                    <dd className="text-right tabular-nums text-ink">{st?.conversions ?? 0}</dd>
                    {(st?.failed ?? 0) > 0 && (
                      <>
                        <dt className="text-red-600">Failed</dt>
                        <dd className="text-right tabular-nums text-red-600">{st?.failed}</dd>
                      </>
                    )}
                  </dl>
                </button>
                {i < steps.length - 1 && (
                  <ArrowRight className="absolute -right-3 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 text-ink-muted md:block" />
                )}
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-[11px] text-ink-muted">
          Opens are approximate: Apple Mail pre-loads images and some inboxes block them. Clicks and purchases are
          the reliable numbers. A purchase is credited to the last flow email sent before it.
        </p>
      </Panel>

      <Panel title="Rules">
        <ul className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
          {cart ? (
            <li className="flex gap-3">
              <ShoppingCart className="mt-0.5 h-5 w-5 flex-shrink-0 text-ink" />
              <span className="text-ink-muted">
                <span className="font-medium text-ink">Trigger.</span> A cart left unchanged for{' '}
                {whenLabel(flow, Math.max(1, steps.find((x) => x.enabled)?.delay_hours ?? 1)).replace(' later', '')} without an
                order — a saved storefront cart, or a Stealth Health checkout left unpaid. Stops the moment they buy, by
                account or email, on either checkout.
              </span>
            </li>
          ) : (
            <li className="flex gap-3">
              <ShoppingCart className="mt-0.5 h-5 w-5 flex-shrink-0 text-ink" />
              <span className="text-ink-muted">
                <span className="font-medium text-ink">Stops on purchase.</span> A paid order on either checkout, by
                account or email, ends the flow for that person.
              </span>
            </li>
          )}
          <li className="flex gap-3">
            <Users className="mt-0.5 h-5 w-5 flex-shrink-0 text-ink" />
            <span className="text-ink-muted">
              <span className="font-medium text-ink">Tagged “{FLOWS[flow].tag}”.</span> On every entry here, and as a
              profile property in Klaviyo when it's connected.
              {!cart && ' Welcome emails pause while someone is in the cart abandonment flow.'}
            </span>
          </li>
          <li className="flex gap-3">
            <Clock className="mt-0.5 h-5 w-5 flex-shrink-0 text-ink" />
            <span className="text-ink-muted">
              <span className="font-medium text-ink">
                Local time, {hourLabel(settings.send_window_start)}–{hourLabel(settings.send_window_end)}.
              </span>{' '}
              Emails 2–5 wait for the recipient's window (zone from their province/state, else{' '}
              {settings.default_timezone}). At least {settings.min_gap_hours}h after their last email from any flow.
            </span>
          </li>
          {cart ? (
            <li className="flex gap-3">
              <Repeat className="mt-0.5 h-5 w-5 flex-shrink-0 text-ink" />
              <span className="text-ink-muted">
                <span className="font-medium text-ink">Who and how often.</span> Ticked the marketing box, or started a
                checkout in the last 6 months (implied consent). Once per {settings.reentry_days} days per person. Every
                email has a one-click unsubscribe.
              </span>
            </li>
          ) : (
            <li className="flex gap-3">
              <Mail className="mt-0.5 h-5 w-5 flex-shrink-0 text-ink" />
              <span className="text-ink-muted">
                <span className="font-medium text-ink">Consented signups only.</span> New accounts that ticked the
                marketing box. Every email carries a one-click unsubscribe.
              </span>
            </li>
          )}
        </ul>
      </Panel>
    </div>
  );
}
