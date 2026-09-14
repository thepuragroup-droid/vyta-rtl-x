'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Wallet, ArrowRight } from 'lucide-react';
import { formatMoney } from '@/lib/currency';
import {
  getAttributionSummary,
  channelLabel,
  EARNINGS_TINTS,
  type AttributionSummary,
  type EarningsGroup,
} from '@/lib/admin/attribution';
import InfoTip from '@/components/admin/InfoTip';
import {
  EARNINGS_GROUP_TIPS,
  EarningsSplitTip,
  CurrencyTip,
} from '@/components/admin/AttributionTips';

const fmtInt = (n: number) => n.toLocaleString();
const fmtCAD = (n: number) => formatMoney(n, 'CAD');
const fmtUSD = (n: number) => formatMoney(n, 'USD');

/**
 * Earnings split by how the sale was won — paid ads, affiliate, organic,
 * direct — with the unattributed remainder shown rather than hidden.
 *
 * Rendered in three places from one component: the analytics Acquisition tab
 * (`full`), the analytics Overview tab, and the admin dashboard (`compact`).
 * It fetches its own data because it is the only consumer of the attribution
 * endpoint on the pages that embed it, and there is no reason to make the
 * other tabs pay for the query.
 *
 * Two rules the layout enforces, because getting them wrong would misinform:
 *
 *   • CAD (storefront) and USD (hosted checkout) revenue are never added
 *     together. They are shown as separate figures throughout.
 *   • The share bar is drawn on ORDER counts, not revenue, precisely because
 *     the two currencies can't be summed into a single denominator.
 */
export default function EarningsByChannel({
  from,
  to,
  variant = 'full',
  hasRange = false,
}: {
  from?: string;
  to?: string;
  variant?: 'full' | 'compact';
  hasRange?: boolean;
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

  // Nothing to say yet — before the migration runs, or with no sales in range.
  // The compact placements stay silent rather than showing an empty shell on a
  // dashboard that has plenty else to look at; the full one explains itself.
  const empty = !data?.available || (data?.earnings?.length ?? 0) === 0;

  if (loading) {
    return variant === 'compact' ? null : (
      <div className="bg-white rounded-xl border border-line p-8 flex items-center justify-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-ink-muted" aria-hidden />
        <span className="text-sm text-ink-muted">Loading earnings split…</span>
      </div>
    );
  }

  if (empty) {
    if (variant === 'compact') return null;
    return (
      <div className="bg-white rounded-xl border border-line p-6">
        <Header hasRange={hasRange} />
        <p className="text-sm text-ink-muted">
          {data?.available
            ? 'No paid orders in this range yet.'
            : 'Not collecting yet — run marketing-attribution-migration.sql.'}
        </p>
      </div>
    );
  }

  const groups = data!.earnings;
  const total = data!.earnings_total;
  const paidGroup = groups.find((g) => g.key === 'paid');
  const unknown = groups.find((g) => g.key === 'unattributed');
  // A paid-ads reader is served only the paid bucket, so the split is a whole
  // of one: say what the 100% is a share of rather than let it read as the
  // whole store.
  const paidAdsOnly = data!.scope === 'paid_ads';

  return (
    <section className={variant === 'full' ? 'mb-8' : 'mb-6'}>
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="p-5 pb-4">
          <Header hasRange={hasRange} compact={variant === 'compact'} />

          {/* Share bar — one row, ordered by volume. */}
          <div className="flex h-2.5 rounded-full overflow-hidden bg-surface mb-3">
            {groups.map((g) => (
              <div
                key={g.key}
                className={EARNINGS_TINTS[g.key].bar}
                style={{ width: `${g.order_share}%` }}
                title={`${g.label} — ${g.order_share}% of orders`}
              />
            ))}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {groups.map((g) => (
              <div key={g.key} className="inline-flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${EARNINGS_TINTS[g.key].dot}`} aria-hidden />
                <span className="text-xs text-ink-muted">
                  <span className="font-medium text-ink">{g.label}</span> {g.order_share}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Per-group figures */}
        <div className="border-t border-line divide-y divide-line">
          {groups.map((g) => (
            <GroupRow key={g.key} group={g} compact={variant === 'compact'} />
          ))}
        </div>

        {/* Footer: the totals the groups sum to, and the honesty note. */}
        <div className="border-t border-line bg-surface px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-1">
          <span className="text-xs text-ink-muted">
            <span className="font-semibold text-ink">{fmtInt(total.paid_orders)}</span> paid orders
          </span>
          <span className="text-xs text-ink-muted">
            Store <span className="font-semibold text-ink">{fmtCAD(total.order_revenue)}</span>
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
            Hosted <span className="font-semibold text-ink">{fmtUSD(total.hosted_revenue)}</span>
            <InfoTip label="Why store and hosted revenue are not added together">
              <CurrencyTip />
            </InfoTip>
          </span>
          {variant === 'compact' && (
            <Link
              href="/admin/analytics"
              className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-teal-dark hover:text-teal-dark/80"
            >
              Full breakdown <ArrowRight className="w-3 h-3" aria-hidden />
            </Link>
          )}
        </div>
      </div>

      {/* Caveats worth stating once, under the full view only. */}
      {variant === 'full' && (
        <p className="mt-2 text-xs text-ink-muted leading-relaxed">
          {paidAdsOnly && (
            <>
              <span className="font-medium text-ink">
                These are paid-ads sales only
              </span>{' '}
              — organic, referral, affiliate and direct earnings are not shown here, so the
              split is a breakdown of ad-won revenue rather than of the whole store.{' '}
            </>
          )}
          Store revenue is CAD and hosted-checkout revenue is USD, so the two are never added
          together — the share bar is drawn on order counts for the same reason.
          {paidGroup && ' Paid-ads revenue is what those campaigns brought in, not profit: ad spend is not imported, so this is not ROAS.'}
          {unknown && unknown.order_share >= 20 && (
            <>
              {' '}
              <span className="font-medium text-amber-700">
                {unknown.order_share}% of orders are unattributed
              </span>{' '}
              — mostly sales placed before attribution started collecting. The split becomes
              reliable once that share falls.
            </>
          )}
        </p>
      )}
    </section>
  );
}

function Header({ hasRange, compact }: { hasRange: boolean; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-7 h-7 rounded-lg bg-teal/10 flex items-center justify-center shrink-0">
        <Wallet className="w-3.5 h-3.5 text-teal-dark" aria-hidden />
      </div>
      <div className="min-w-0">
        <h3 className={`flex items-center gap-1.5 font-bold text-ink ${compact ? 'text-sm' : 'text-base'}`}>
          Earnings by source
          <InfoTip label="How orders are split by source">
            <EarningsSplitTip />
          </InfoTip>
        </h3>
        <p className="text-xs text-ink-muted">
          What we paid to win versus what came in on its own
          {hasRange ? ', over the selected range' : ', all-time'}.
        </p>
      </div>
    </div>
  );
}

function GroupRow({ group, compact }: { group: EarningsGroup; compact?: boolean }) {
  const tint = EARNINGS_TINTS[group.key];
  return (
    <div className="px-5 py-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <div className="flex items-center gap-2 min-w-[9rem]">
        <span className={`w-2 h-2 rounded-full ${tint.dot}`} aria-hidden />
        <span className="text-sm font-semibold text-ink">{group.label}</span>
        <InfoTip label={`What counts as ${group.label}`}>
          {EARNINGS_GROUP_TIPS[group.key]}
        </InfoTip>
      </div>

      <span className="text-xs text-ink-muted tabular-nums w-20">
        {fmtInt(group.paid_orders)} order{group.paid_orders === 1 ? '' : 's'}
      </span>

      <span className="text-sm tabular-nums text-ink">
        {group.order_revenue > 0 ? fmtCAD(group.order_revenue) : <span className="text-ink-light">—</span>}
        {!compact && group.aov_cad > 0 && (
          <span className="text-[11px] text-ink-muted ml-1">({fmtCAD(group.aov_cad)} avg)</span>
        )}
      </span>

      <span className="text-sm tabular-nums text-ink">
        {group.hosted_revenue > 0 ? fmtUSD(group.hosted_revenue) : <span className="text-ink-light">—</span>}
        {!compact && group.aov_usd > 0 && (
          <span className="text-[11px] text-ink-muted ml-1">({fmtUSD(group.aov_usd)} avg)</span>
        )}
      </span>

      {/* Which channels rolled up here — the drill-down the group hides. */}
      {!compact && group.channels.length > 0 && (
        <span className="text-[11px] text-ink-muted ml-auto truncate max-w-[16rem]" title={group.channels.map(channelLabel).join(', ')}>
          {group.channels.map(channelLabel).join(' · ')}
        </span>
      )}
    </div>
  );
}
