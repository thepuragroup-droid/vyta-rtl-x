'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Mail, AlertTriangle, ArrowRight } from 'lucide-react';
import { formatMoney, normalizeCurrency } from '@/lib/currency';
import {
  getEmailFlowAnalytics,
  type EmailFlowAnalytics,
  type FlowReport,
  type MoneyByCurrency,
} from '@/lib/admin/attribution';
import { CONVERSION_VIA_LABELS } from '@/lib/email-flows/engagement';
import InfoTip from '@/components/admin/InfoTip';

const fmtInt = (n: number) => n.toLocaleString();
const pctOf = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');
const money = (list: MoneyByCurrency[]) =>
  list.length ? list.map((m) => formatMoney(m.amount, normalizeCurrency(m.currency))).join(' + ') : '—';

/**
 * Email flows, read from their own side — shown under Organic & referral on
 * the earnings split.
 *
 * The split credits a sale to the touch that first won the customer, and a
 * flow email is almost never that: it goes to people who already signed up or
 * already filled a cart. So "Email" in the split stays near zero even when the
 * flows are doing their job. This panel answers the real question instead —
 * did the emails get opened and clicked by people, did those clicks reach
 * checkout, and which sales did they close — with the sales they assisted
 * shown against the bucket each one is credited to.
 */
export default function EmailFlowsAttribution({ from, to }: { from?: string; to?: string }) {
  const [data, setData] = useState<EmailFlowAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getEmailFlowAnalytics({ from: from || undefined, to: to || undefined })
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  return (
    <div className="mt-4 rounded-lg border border-line bg-white">
      <div className="px-4 pt-3 pb-2 flex items-start gap-2">
        <div className="w-6 h-6 rounded-md bg-emerald-50 flex items-center justify-center shrink-0 mt-0.5">
          <Mail className="w-3.5 h-3.5 text-emerald-700" aria-hidden />
        </div>
        <div className="min-w-0">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            Email flows
            <InfoTip label="Why email flows are measured separately">
              A sale is credited to whatever first brought the customer in — an ad, an affiliate, a
              search. Flow emails go to people who are already here, so they rarely get that credit even
              when they close the sale. This panel counts what the emails themselves led to.
            </InfoTip>
          </h4>
          <p className="text-xs text-ink-muted">
            What the welcome and cart emails sent in this range led to.
          </p>
        </div>
        <Link
          href="/admin/email-flows"
          className="ml-auto shrink-0 inline-flex items-center gap-1 text-xs font-medium text-teal-dark hover:text-teal-dark/80"
        >
          Email flows <ArrowRight className="w-3 h-3" aria-hidden />
        </Link>
      </div>

      <div className="px-4 pb-4">
        {loading ? (
          <p className="flex items-center gap-2 text-xs text-ink-muted">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Loading email flows…
          </p>
        ) : !data ? (
          <p className="text-xs text-ink-muted">Couldn&apos;t load the email flows.</p>
        ) : !data.available ? (
          <p className="text-xs text-ink-muted">
            Email flows aren&apos;t set up yet — run email-flows-migration.sql.
          </p>
        ) : (
          <Body data={data} />
        )}
      </div>
    </div>
  );
}

function Body({ data }: { data: EmailFlowAnalytics }) {
  const anySent = data.flows.some((f) => f.sent > 0);
  const anyConverted = data.flows.some(
    (f) => f.conversions.click + f.conversions.email_match + f.conversions.unknown > 0,
  );

  return (
    <div className="space-y-3">
      {!data.tracking && (
        <p className="flex items-start gap-1.5 rounded-md bg-amber-50 border border-amber-200 px-2.5 py-2 text-xs text-amber-800">
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden />
          <span>
            Only opens and clicks are being recorded. Run{' '}
            <span className="font-mono">email-flows-tracking-migration.sql</span> to also record what happens after
            the click — checkouts, which links get clicked, which sales the click closed — and to separate mail
            scanners from people.
          </span>
        </p>
      )}

      {!anySent && !anyConverted ? (
        <p className="text-xs text-ink-muted">No flow emails were sent in this range.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.flows.map((f) => (
            <FlowCard key={f.flow} flow={f} tracking={data.tracking} split={data.conversion_split} />
          ))}
        </div>
      )}

      <AssistedOrders data={data} />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-ink-muted">{label}</div>
      <div className="text-sm font-semibold text-ink tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-ink-muted leading-snug">{sub}</div>}
    </div>
  );
}

function FlowCard({ flow, tracking, split }: { flow: FlowReport; tracking: boolean; split: boolean }) {
  const purchases = flow.conversions.click + flow.conversions.email_match + flow.conversions.unknown;
  const steps = flow.steps.filter((s) => s.sent > 0 || s.conversions > 0);

  return (
    <div className="rounded-md border border-line bg-surface/40 p-3">
      <div className="text-sm font-semibold text-ink mb-2">{flow.label}</div>

      <div className="grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-5">
        <Stat label="Sent" value={fmtInt(flow.sent)} />
        <Stat
          label="Opened"
          value={fmtInt(flow.opened)}
          sub={
            <>
              {pctOf(flow.opened, flow.sent)}
              {flow.opened_automatic_only > 0 && (
                <>
                  {' '}· {fmtInt(flow.opened_automatic_only)} may be automatic
                </>
              )}
            </>
          }
        />
        <Stat
          label="Clicked"
          value={fmtInt(flow.clicked)}
          sub={
            <>
              {pctOf(flow.clicked, flow.sent)}
              {flow.machine_clicked > 0 && <> · {fmtInt(flow.machine_clicked)} scanner clicks excluded</>}
            </>
          }
        />
        <Stat label="Checkouts" value={tracking ? fmtInt(flow.checkouts) : '—'} sub={tracking ? 'from a click' : 'not recorded'} />
        <Stat label="Purchases" value={fmtInt(purchases)} sub={pctOf(purchases, flow.sent) + ' of sent'} />
      </div>

      {purchases > 0 && (
        <div className="mt-2.5 text-xs text-ink leading-relaxed">
          <span className="font-medium">{money(flow.revenue)}</span> from these purchases.{' '}
          {split ? (
            <>
              <span className="font-medium">{fmtInt(flow.conversions.click)}</span>{' '}
              {CONVERSION_VIA_LABELS.click.toLowerCase()}
              {flow.click_revenue.length > 0 && <> ({money(flow.click_revenue)})</>},{' '}
              <span className="font-medium">{fmtInt(flow.conversions.email_match)}</span>{' '}
              {CONVERSION_VIA_LABELS.email_match.toLowerCase()}
              {flow.conversions.unknown > 0 && <>, {fmtInt(flow.conversions.unknown)} from before this was recorded</>}.
            </>
          ) : (
            <span className="text-ink-muted">Whether buyers clicked first isn&apos;t recorded yet.</span>
          )}
        </div>
      )}

      {steps.length > 0 && (
        <table className="mt-2.5 w-full text-[11px] tabular-nums">
          <thead>
            <tr className="text-ink-muted text-left">
              <th className="font-normal py-0.5">Email</th>
              <th className="font-normal py-0.5 text-right">Sent</th>
              <th className="font-normal py-0.5 text-right">Clicked</th>
              <th className="font-normal py-0.5 text-right">Purchases</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => (
              <tr key={s.step} className="border-t border-line/70 text-ink">
                <td className="py-0.5 pr-2 truncate">
                  {s.step}. {s.label}
                </td>
                <td className="py-0.5 text-right">{fmtInt(s.sent)}</td>
                <td className="py-0.5 text-right">
                  {fmtInt(s.clicked)} <span className="text-ink-muted">{pctOf(s.clicked, s.sent)}</span>
                </td>
                <td className="py-0.5 text-right">
                  {fmtInt(s.conversions)}
                  {split && s.conversions > 0 && (
                    <span className="text-ink-muted"> ({fmtInt(s.click_conversions)} clicked)</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {flow.links.length > 0 && (
        <p className="mt-2 text-[11px] text-ink-muted">
          Clicks went to:{' '}
          {flow.links.map((l, i) => (
            <span key={l.kind}>
              {i > 0 && ' · '}
              <span className="text-ink">{l.label}</span> {fmtInt(l.clicks)}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function AssistedOrders({ data }: { data: EmailFlowAnalytics }) {
  const o = data.orders;
  if (o.total === 0) {
    return (
      <p className="text-xs text-ink-muted">
        No paid orders in this range came through a flow email.
      </p>
    );
  }
  return (
    <div className="rounded-md border border-line px-3 py-2.5 text-xs text-ink leading-relaxed">
      <span className="font-semibold">{fmtInt(o.total)}</span> paid order{o.total === 1 ? '' : 's'} in this range
      came through a flow email
      {' '}({fmtInt(o.by_evidence.click)} by a tracked click, {fmtInt(o.by_evidence.utm)} by the flow&apos;s link tags)
      {o.by_flow.length > 0 && (
        <>
          {' — '}
          {o.by_flow.map((f, i) => (
            <span key={f.flow}>
              {i > 0 && ', '}
              {f.label} {fmtInt(f.orders)} ({money(f.revenue)})
            </span>
          ))}
        </>
      )}
      .
      <div className="mt-1 text-ink-muted">
        In the split above they are credited to:{' '}
        {o.by_bucket.map((b, i) => (
          <span key={b.group}>
            {i > 0 && ' · '}
            <span className="text-ink">{b.label}</span> {fmtInt(b.orders)}
          </span>
        ))}
        . The email closed them; the first touch keeps the credit.
      </div>
    </div>
  );
}
