'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Wallet, ArrowRight, ChevronDown, ExternalLink, Lightbulb, Mail } from 'lucide-react';
import { formatMoney, normalizeCurrency } from '@/lib/currency';
import {
  getAttributionSummary,
  getEarningsGroupOrders,
  channelLabel,
  EARNINGS_TINTS,
  type AttributionSummary,
  type BreakdownRow,
  type EarningsGroup,
  type EarningsGroupKey,
  type SourceOrderRow,
  type SourceOrdersResponse,
} from '@/lib/admin/attribution';
import InfoTip from '@/components/admin/InfoTip';
import {
  EARNINGS_GROUP_TIPS,
  EarningsSplitTip,
  CurrencyTip,
} from '@/components/admin/AttributionTips';
import EmailFlowsAttribution from '@/components/admin/EmailFlowsAttribution';

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

        {/* Per-group figures. In the full view each row opens the orders
            behind it, so a percentage can be checked order by order. */}
        <div className="border-t border-line divide-y divide-line">
          {groups.map((g) => (
            <GroupRow key={g.key} group={g} compact={variant === 'compact'} from={from} to={to} />
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

/** How each bucket's breakdown is named — the toggle, the heading, the filter. */
const BREAKDOWN_NOUNS: Partial<Record<EarningsGroupKey, { toggle: string; heading: string; all: string }>> = {
  paid: { toggle: 'By platform', heading: 'Which ad platform sold', all: 'All platforms' },
  affiliate: { toggle: 'By affiliate', heading: 'Which affiliate sold', all: 'All affiliates' },
  organic: { toggle: 'By source', heading: 'Where the buyers came from', all: 'All sources' },
};

/** "Google Ads 12 · Meta Ads 3" — the breakdown in one line. */
function breakdownSummary(rows: BreakdownRow[]): string {
  return rows.map((r) => `${r.label} ${fmtInt(r.paid_orders)}`).join(' · ');
}

function GroupRow({
  group,
  compact,
  from,
  to,
}: {
  group: EarningsGroup;
  compact?: boolean;
  from?: string;
  to?: string;
}) {
  const tint = EARNINGS_TINTS[group.key];
  const [open, setOpen] = useState(false);
  const canOpen = !compact && group.paid_orders > 0;
  const breakdown = group.breakdown ?? [];
  const nouns = BREAKDOWN_NOUNS[group.key];

  return (
    <div>
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

        {/* What's inside the bucket, in one line — platforms with their order
            counts for paid ads, affiliates for affiliate. On the dashboard too,
            since "which platform" is the first thing anyone asks. */}
        {breakdown.length > 0 ? (
          <span
            className="text-[11px] text-ink-muted truncate max-w-[18rem]"
            title={breakdownSummary(breakdown)}
          >
            {breakdownSummary(breakdown)}
          </span>
        ) : (
          !compact &&
          group.channels.length > 0 && (
            <span className="text-[11px] text-ink-muted truncate max-w-[16rem]" title={group.channels.map(channelLabel).join(', ')}>
              {group.channels.map(channelLabel).join(' · ')}
            </span>
          )
        )}

        {canOpen && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-teal-dark hover:text-teal-dark/80"
          >
            {open ? 'Hide' : nouns && breakdown.length > 0 ? nouns.toggle : 'Which orders?'}
            <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
          </button>
        )}
      </div>

      {open && <GroupDetail group={group} from={from} to={to} />}
    </div>
  );
}

/**
 * The inside of one bucket: its breakdown (platform / affiliate / source),
 * the email-flow panel under Organic & referral, and the orders themselves
 * with a dropdown to narrow them to one row of the breakdown.
 */
function GroupDetail({ group, from, to }: { group: EarningsGroup; from?: string; to?: string }) {
  const breakdown = group.breakdown ?? [];
  const nouns = BREAKDOWN_NOUNS[group.key];
  const [filter, setFilter] = useState<string>('');

  return (
    <div className="px-5 pb-4">
      {nouns && breakdown.length > 0 && (
        <BreakdownList
          rows={breakdown}
          heading={nouns.heading}
          selected={filter}
          onSelect={(key) => setFilter((cur) => (cur === key ? '' : key))}
        />
      )}

      {group.key === 'organic' && <EmailFlowsAttribution from={from} to={to} />}

      <GroupOrders
        group={group}
        from={from}
        to={to}
        filter={filter}
        onFilter={setFilter}
        options={nouns ? breakdown.map((r) => ({ key: r.key, label: `${r.label} (${fmtInt(r.paid_orders)})` })) : []}
        allLabel={nouns?.all ?? ''}
      />
    </div>
  );
}

function BreakdownList({
  rows,
  heading,
  selected,
  onSelect,
}: {
  rows: BreakdownRow[];
  heading: string;
  selected: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="mb-4">
      <h4 className="text-xs font-semibold text-ink mb-1.5">{heading}</h4>
      <ul className="rounded-lg border border-line divide-y divide-line bg-white">
        {rows.map((r) => (
          <BreakdownItem key={r.key} row={r} active={selected === r.key} onSelect={() => onSelect(r.key)} />
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-ink-muted">Pick a row to list only its orders below.</p>
    </div>
  );
}

function BreakdownItem({ row, active, onSelect }: { row: BreakdownRow; active: boolean; onSelect: () => void }) {
  const [open, setOpen] = useState(false);
  // A lone "No campaign tag" child only restates the row; its detail line says it instead.
  const children = row.children.length === 1 && row.children[0].key === 'campaign:' ? [] : row.children;

  return (
    <li className={active ? 'bg-teal/5' : ''}>
      <div className="px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={active}
          className="min-w-[10rem] text-left text-sm font-medium text-ink hover:text-teal-dark"
        >
          {row.label}
        </button>
        <span className="text-xs text-ink-muted tabular-nums w-20">
          {fmtInt(row.paid_orders)} order{row.paid_orders === 1 ? '' : 's'}
        </span>
        <span className="text-sm tabular-nums text-ink w-24">
          {row.order_revenue > 0 ? fmtCAD(row.order_revenue) : <span className="text-ink-light">—</span>}
        </span>
        <span className="text-sm tabular-nums text-ink w-24">
          {row.hosted_revenue > 0 ? fmtUSD(row.hosted_revenue) : <span className="text-ink-light">—</span>}
        </span>
        <span className="flex items-center gap-1.5 w-28" title={`${row.order_share}% of this bucket's orders`}>
          <span className="flex-1 h-1.5 rounded-full bg-surface overflow-hidden">
            <span className="block h-full bg-teal" style={{ width: `${row.order_share}%` }} />
          </span>
          <span className="text-[11px] text-ink-muted tabular-nums">{row.order_share}%</span>
        </span>
        {children.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-teal-dark hover:text-teal-dark/80"
          >
            {children.length} {childNoun(row, children.length)}
            <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
          </button>
        )}
        {row.detail && <p className="basis-full text-[11px] text-ink-muted">{row.detail}</p>}
      </div>
      {open && (
        <ul className="px-3 pb-2 pl-6 space-y-0.5">
          {children.map((c) => (
            <li key={c.key} className="flex flex-wrap items-baseline gap-x-4 text-xs">
              <span className="min-w-[10rem] text-ink break-all">{c.label}</span>
              <span className="text-ink-muted tabular-nums w-20">
                {fmtInt(c.paid_orders)} order{c.paid_orders === 1 ? '' : 's'}
              </span>
              <span className="tabular-nums text-ink w-24">{c.order_revenue > 0 ? fmtCAD(c.order_revenue) : '—'}</span>
              <span className="tabular-nums text-ink w-24">{c.hosted_revenue > 0 ? fmtUSD(c.hosted_revenue) : '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** What a row's children are, for the toggle. */
function childNoun(row: BreakdownRow, n: number): string {
  const key = row.children[0]?.key ?? '';
  const one = key.startsWith('campaign:')
    ? 'campaign'
    : key.startsWith('code:')
      ? 'code'
      : key.startsWith('site:')
        ? 'site'
        : key.startsWith('flow:') || key.startsWith('email:')
          ? 'email'
          : 'item';
  return n === 1 ? one : `${one}s`;
}

/**
 * The orders behind one bucket, each with the evidence that put it there.
 * Fetched only when opened — most visits never look. The dropdown narrows the
 * list to one platform / affiliate / source, using the same key the breakdown
 * above counts with.
 */
function GroupOrders({
  group,
  from,
  to,
  filter,
  onFilter,
  options,
  allLabel,
}: {
  group: EarningsGroup;
  from?: string;
  to?: string;
  filter: string;
  onFilter: (key: string) => void;
  options: Array<{ key: string; label: string }>;
  allLabel: string;
}) {
  const [data, setData] = useState<SourceOrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getEarningsGroupOrders(group.key, { from: from || undefined, to: to || undefined })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [group.key, from, to]);

  if (loading) {
    return (
      <div className="pt-3 flex items-center gap-2 text-xs text-ink-muted">
        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Loading orders…
      </div>
    );
  }

  if (!data || !data.available) {
    return <p className="pt-3 text-xs text-ink-muted">Couldn&apos;t load the orders for this bucket.</p>;
  }

  if (data.orders.length === 0) {
    return <p className="pt-3 text-xs text-ink-muted">No paid orders in this bucket for the range.</p>;
  }

  const shown = filter ? data.orders.filter((o) => o.sub?.key === filter) : data.orders;

  return (
    <div className="pt-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-semibold text-ink">Orders</h4>
        {options.length > 1 && (
          <select
            value={filter}
            onChange={(e) => onFilter(e.target.value)}
            aria-label={`Show orders from ${allLabel.toLowerCase().replace(/^all /, 'one ')}`}
            className="ml-auto rounded-md border border-line bg-white px-2 py-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-teal"
          >
            <option value="">{allLabel}</option>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {group.key === 'unattributed' && (
        <p className="mb-2 text-xs text-ink-muted leading-relaxed">
          These orders have no channel recorded, so they stay in Unattributed.{' '}
          {data.hinted > 0 ? (
            <>
              <span className="font-medium text-ink">{fmtInt(data.hinted)}</span> of them carry a clue
              to where they likely came from — shown in amber below.
            </>
          ) : (
            'None of them carries a clue to where they came from.'
          )}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="text-xs text-ink-muted">No orders listed for this selection.</p>
      ) : (
        <ul className="rounded-lg border border-line divide-y divide-line bg-surface/40 max-h-[28rem] overflow-y-auto">
          {shown.map((o) => (
            <OrderSourceItem key={`${o.kind}:${o.id}`} order={o} />
          ))}
        </ul>
      )}

      {data.truncated && (
        <p className="mt-2 text-[11px] text-ink-muted">
          Showing the most recent {fmtInt(data.orders.length)} of {fmtInt(data.total)} orders
          {filter ? ', narrowed by the dropdown' : ''}. Narrow the date range to see the rest.
        </p>
      )}
    </div>
  );
}

function OrderSourceItem({ order }: { order: SourceOrderRow }) {
  const amount = formatMoney(order.amount, normalizeCurrency(order.currency));
  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <Link
          href={order.href}
          className="inline-flex items-center gap-1 text-sm font-medium text-ink hover:text-teal-dark"
        >
          {order.reference}
          <ExternalLink className="w-3 h-3 text-ink-muted" aria-hidden />
        </Link>
        <span className="text-[11px] uppercase tracking-wide text-ink-muted">
          {order.kind === 'hosted' ? 'Hosted' : 'Store'}
        </span>
        <span className="text-xs text-ink-muted tabular-nums">{order.created_at.slice(0, 10)}</span>
        {order.sub && order.group === 'affiliate' && (
          <span className="text-xs font-medium text-blue-700 truncate max-w-[12rem]">{order.sub.label}</span>
        )}
        {order.email && <span className="text-xs text-ink-muted truncate max-w-[14rem]">{order.email}</span>}
        <span className="ml-auto text-sm tabular-nums text-ink">{amount}</span>
      </div>

      <p className="mt-1 text-xs text-ink leading-relaxed">
        {order.channel && (
          <span className="font-semibold">
            {channelLabel(order.channel)}
            {order.campaign ? ` · ${order.campaign}` : ''} —{' '}
          </span>
        )}
        {order.reason}
      </p>

      {order.evidence.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {order.evidence.map((e) => (
            <span
              key={`${e.label}:${e.value}`}
              className="inline-flex items-center gap-1 rounded bg-white border border-line px-1.5 py-0.5 text-[11px]"
            >
              <span className="text-ink-muted">{e.label}</span>
              <span className="font-mono text-ink break-all">{e.value}</span>
            </span>
          ))}
        </div>
      )}

      {order.email_flow && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-emerald-700">
          <Mail className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden />
          <span>
            Came through <span className="font-semibold">{order.email_flow.label}</span> —{' '}
            {order.email_flow.evidence === 'click'
              ? 'the buyer clicked that email on the way to checkout.'
              : 'the visit before the order carried that email’s link tags.'}
          </span>
        </p>
      )}

      {order.hints.map((h) => (
        <p key={`${h.channel}:${h.reason}`} className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
          <Lightbulb className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden />
          <span>
            Likely <span className="font-semibold">{channelLabel(h.channel)}</span> — {h.reason}
          </span>
        </p>
      ))}
    </li>
  );
}
