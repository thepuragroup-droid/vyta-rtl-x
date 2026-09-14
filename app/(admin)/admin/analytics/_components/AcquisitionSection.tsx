'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Megaphone, Info, RefreshCw, TrendingUp } from 'lucide-react';
import { formatMoney } from '@/lib/currency';
import {
  getAttributionSummary,
  channelLabel,
  type AttributionSummary,
  type ChannelRow,
} from '@/lib/admin/attribution';
import EarningsByChannel from '@/components/admin/EarningsByChannel';
import InfoTip from '@/components/admin/InfoTip';
import {
  PaidAdsTip,
  ChannelTableTip,
  CampaignTip,
} from '@/components/admin/AttributionTips';

const fmtInt = (n: number) => n.toLocaleString();
const fmtPct = (n: number) => `${n}%`;
const fmtCAD = (n: number) => formatMoney(n, 'CAD');
const fmtUSD = (n: number) => formatMoney(n, 'USD');

/**
 * Acquisition by channel — which sources bring visitors, and what those
 * visitors are worth.
 *
 * Distinct from the Traffic tab next door: that one measures the funnel in
 * total, as an ad baseline to compare against. This one splits the same funnel
 * by where the traffic came from, which is the question you can only answer
 * once click identifiers are being captured and frozen onto the orders.
 *
 * Fetches independently of the analytics summary — it is a separate query
 * against three tables, and there is no reason to pay for it on tabs that
 * don't show it.
 */
export default function AcquisitionSection({
  from,
  to,
  hasRange,
}: {
  from: string;
  to: string;
  hasRange: boolean;
}) {
  const [data, setData] = useState<AttributionSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    getAttributionSummary({ from: from || undefined, to: to || undefined })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  useEffect(load, [load]);

  const header = (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 rounded-lg bg-bronze/10 flex items-center justify-center">
          <Megaphone className="w-4 h-4 text-bronze" />
        </div>
        <h2 className="text-lg font-bold text-ink">Acquisition by Channel</h2>
      </div>
      <p className="text-sm text-ink-muted ml-10">
        Where visitors came from {hasRange ? 'over the selected range' : 'all-time'}, and how far
        each source got down the funnel. Visitors are credited to their{' '}
        <span className="font-medium text-ink">first</span> touch, so the campaign that won someone
        keeps the credit for what they buy later.
      </p>
    </div>
  );

  if (loading) {
    return (
      <section className="mb-8">
        {header}
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-ink-muted" aria-hidden />
          <p className="text-sm text-ink-muted">Loading acquisition data…</p>
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="mb-8">
        {header}
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <p className="text-sm text-ink-muted">Could not load acquisition data.</p>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-bronze text-white rounded-lg text-sm font-medium hover:bg-bronze/90"
          >
            <RefreshCw className="w-4 h-4" aria-hidden /> Try again
          </button>
        </div>
      </section>
    );
  }

  // The visitor table is missing — the migration hasn't been applied yet.
  // Say that outright: zeroes here would read as "no traffic", which is worse
  // than useless when the truth is "not collecting yet".
  if (!data.available) {
    return (
      <section className="mb-8">
        {header}
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 flex gap-3">
          <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-sm text-ink-muted leading-relaxed">
            <p className="font-semibold text-ink mb-1">Attribution isn&apos;t collecting yet.</p>
            <p>
              Run <code className="px-1 py-0.5 bg-white rounded border border-line text-xs">
                marketing-attribution-migration.sql
              </code>{' '}
              against the database. Until then the site still records signed-in customer activity,
              but nothing knows which ad a visitor arrived from.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const paidChannels = data.channels.filter((c) => c.paid);
  const paidTotals = paidChannels.reduce(
    (acc, c) => ({
      visitors: acc.visitors + c.visitors,
      purchasers: acc.purchasers + c.purchasers,
      cad: acc.cad + c.order_revenue,
      usd: acc.usd + c.hosted_revenue,
    }),
    { visitors: 0, purchasers: 0, cad: 0, usd: 0 },
  );

  return (
    <section className="mb-8">
      {header}

      <div className="rounded-xl border border-bronze/30 bg-bronze/[0.04] p-4 mb-5 flex gap-3">
        <Info className="w-4 h-4 text-bronze shrink-0 mt-0.5" />
        <p className="text-xs text-ink-muted leading-relaxed">
          <span className="font-semibold text-ink">Two currencies, never summed.</span>{' '}
          Storefront orders are billed in CAD and hosted-checkout orders in USD, so they are shown
          as separate columns. Hosted-checkout payments are attributed by email, because the
          payment happens on the partner&apos;s domain — see{' '}
          <Link
            href="/admin/marketing"
            className="text-bronze hover:text-bronze/80 font-medium"
          >
            Marketing → Branding &amp; Tracking
          </Link>{' '}
          for the tag configuration that feeds Google&apos;s own reporting.
        </p>
      </div>

      {/* Earnings split — the money question, above the traffic funnel. */}
      <EarningsByChannel from={from} to={to} hasRange={hasRange} variant="full" />

      {/* Paid-traffic headline */}
      <div className="flex items-center gap-1.5 mb-2">
        <h3 className="text-sm font-semibold text-ink">Paid traffic</h3>
        <InfoTip label="What counts as paid traffic">
          <PaidAdsTip />
        </InfoTip>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Kpi
          tint="bronze"
          label="Paid visitors"
          value={fmtInt(paidTotals.visitors)}
          sub={`${fmtInt(data.totals.visitors)} total visitors`}
        />
        <Kpi
          tint="emerald"
          label="Paid purchasers"
          value={fmtInt(paidTotals.purchasers)}
          sub={
            paidTotals.visitors > 0
              ? `${fmtPct(+((paidTotals.purchasers / paidTotals.visitors) * 100).toFixed(1))} conversion`
              : 'no paid traffic yet'
          }
        />
        <Kpi
          tint="blue"
          label="Paid revenue (CAD)"
          value={fmtCAD(paidTotals.cad)}
          sub="storefront orders"
        />
        <Kpi
          tint="blue"
          label="Paid revenue (USD)"
          value={fmtUSD(paidTotals.usd)}
          sub="hosted checkout"
        />
      </div>

      {/* Channel table */}
      <div className="bg-white rounded-xl border border-line overflow-hidden mb-5">
        <div className="px-4 py-3 border-b border-line">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            Channels
            <InfoTip label="How the channel table is counted">
              <ChannelTableTip />
            </InfoTip>
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface text-[11px] uppercase tracking-wide text-ink-muted">
                <th className="text-left font-medium px-4 py-2">Channel</th>
                <th className="text-right font-medium px-3 py-2">Visitors</th>
                <th className="text-right font-medium px-3 py-2">Sign-ups</th>
                <th className="text-right font-medium px-3 py-2">Checkouts</th>
                <th className="text-right font-medium px-3 py-2">Purchasers</th>
                <th className="text-right font-medium px-3 py-2">Conv.</th>
                <th className="text-right font-medium px-3 py-2">Store (CAD)</th>
                <th className="text-right font-medium px-3 py-2">Hosted (USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.channels.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-ink-muted">
                    No visitors recorded {hasRange ? 'in this range' : 'yet'}.
                  </td>
                </tr>
              )}
              {data.channels.map((c) => (
                <ChannelTableRow key={c.channel} row={c} />
              ))}
            </tbody>
            {data.channels.length > 0 && (
              <tfoot>
                <tr className="bg-surface font-semibold text-ink">
                  <td className="px-4 py-2.5">All channels</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtInt(data.totals.visitors)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtInt(data.totals.signups)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtInt(data.totals.checkouts)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtInt(data.totals.purchasers)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtPct(data.totals.rates.purchase)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtCAD(data.totals.order_revenue)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtUSD(data.totals.hosted_revenue)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {data.unattributed_orders > 0 && (
          <p className="px-4 py-2.5 text-xs text-ink-muted border-t border-line">
            {fmtInt(data.unattributed_orders)} order
            {data.unattributed_orders === 1 ? '' : 's'} in this range carry no channel — placed
            before attribution was collecting, or by a visitor with cookies blocked.
          </p>
        )}
      </div>

      {/* Campaign drill-down */}
      {data.campaigns.length > 0 && (
        <div className="bg-white rounded-xl border border-line overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-ink-muted" aria-hidden />
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            Top campaigns
            <InfoTip label="Where campaign names come from">
              <CampaignTip />
            </InfoTip>
          </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface text-[11px] uppercase tracking-wide text-ink-muted">
                  <th className="text-left font-medium px-4 py-2">Campaign</th>
                  <th className="text-left font-medium px-3 py-2">Channel</th>
                  <th className="text-right font-medium px-3 py-2">Visitors</th>
                  <th className="text-right font-medium px-3 py-2">Purchasers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.campaigns.map((c) => (
                  <tr key={`${c.channel}:${c.campaign}`}>
                    <td className="px-4 py-2.5 text-ink font-medium">{c.campaign}</td>
                    <td className="px-3 py-2.5 text-ink-muted">{channelLabel(c.channel)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">{fmtInt(c.visitors)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">{fmtInt(c.purchasers)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2.5 text-xs text-ink-muted border-t border-line">
            Campaigns come from <code className="text-[11px]">utm_campaign</code>. A Google Ads
            click with auto-tagging only (a <code className="text-[11px]">gclid</code> and nothing
            else) is counted in its channel above but has no campaign name to show here — add
            tracking templates in Ads to break it down.
          </p>
        </div>
      )}

      {data.truncated && (
        <p className="mt-3 text-xs text-ink-muted">
          Showing a capped sample — narrow the date range for exact figures.
        </p>
      )}
    </section>
  );
}

function ChannelTableRow({ row }: { row: ChannelRow }) {
  return (
    <tr className={row.paid ? 'bg-bronze/[0.03]' : undefined}>
      <td className="px-4 py-2.5">
        <span className="font-medium text-ink">{channelLabel(row.channel)}</span>
        {row.paid && (
          <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-bronze/10 text-bronze uppercase tracking-wide">
            Paid
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-ink">{fmtInt(row.visitors)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{fmtInt(row.signups)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{fmtInt(row.checkouts)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-ink">{fmtInt(row.purchasers)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">
        {fmtPct(row.rates.purchase)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-ink">
        {row.order_revenue > 0 ? fmtCAD(row.order_revenue) : '—'}
        {row.paid_orders > 0 && (
          <span className="block text-[11px] text-ink-muted">{fmtInt(row.paid_orders)} paid</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-ink">
        {row.hosted_revenue > 0 ? fmtUSD(row.hosted_revenue) : '—'}
        {row.hosted_paid > 0 && (
          <span className="block text-[11px] text-ink-muted">{fmtInt(row.hosted_paid)} paid</span>
        )}
      </td>
    </tr>
  );
}

const TINTS: Record<string, { fg: string; bg: string }> = {
  emerald: { fg: 'text-emerald-700', bg: 'bg-emerald-100' },
  blue: { fg: 'text-blue-700', bg: 'bg-blue-100' },
  bronze: { fg: 'text-bronze', bg: 'bg-bronze/10' },
};

function Kpi({
  tint,
  label,
  value,
  sub,
}: {
  tint: keyof typeof TINTS;
  label: string;
  value: string;
  sub?: string;
}) {
  const t = TINTS[tint] ?? TINTS.bronze;
  return (
    <div className="bg-white rounded-xl border border-line p-4">
      <div className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide mb-2 ${t.bg} ${t.fg}`}>
        {label}
      </div>
      <div className="text-2xl font-bold text-ink tabular-nums">{value}</div>
      {sub && <div className="text-xs text-ink-muted mt-0.5">{sub}</div>}
    </div>
  );
}
