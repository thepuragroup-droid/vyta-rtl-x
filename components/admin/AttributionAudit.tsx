'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, SearchCheck, ChevronDown, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  channelLabel,
  getAttributionAudit,
  reclassifyAttribution,
  type AttributionAudit as Audit,
  type ReclassifyResult,
} from '@/lib/admin/attribution';
import InfoTip from '@/components/admin/InfoTip';

const fmtInt = (n: number) => n.toLocaleString();

/**
 * "Are my ad clicks being filed as organic?" — answered from the stored facts.
 *
 * Lists what the visitors NOT credited to a paid channel actually arrived
 * with (utm source and medium, referring site, click id), so a reader can see
 * at a glance that, say, 120 "Meta organic" visitors all carry
 * utm_medium=Instagram_Stories — which only an ad produces. Groups the
 * current rules would put in a paid channel are marked, and an admin can move
 * every such row (visitors, orders, customers, all history) in one go.
 */
export default function AttributionAudit({
  from,
  to,
  canApply,
}: {
  from?: string;
  to?: string;
  /** Admins only — the server enforces it too. */
  canApply: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Audit | null>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<ReclassifyResult | null>(null);
  const [busy, setBusy] = useState<'count' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ReclassifyResult | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    getAttributionAudit({ from: from || undefined, to: to || undefined })
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

  useEffect(() => {
    if (open) return load();
  }, [open, load]);

  const run = async (apply: boolean) => {
    setBusy(apply ? 'apply' : 'count');
    setError(null);
    try {
      const r = await reclassifyAttribution(apply);
      if (apply) {
        setDone(r);
        setPreview(null);
        load();
      } else {
        setPreview(r);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mb-6 rounded-xl border border-line bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full px-4 py-3 flex items-center gap-2 text-left"
      >
        <SearchCheck className="w-4 h-4 text-teal-dark shrink-0" aria-hidden />
        <span className="text-sm font-semibold text-ink">Check the unpaid visitors</span>
        <span className="text-xs text-ink-muted hidden sm:inline">
          — what organic, referral and direct visitors actually arrived with
        </span>
        <ChevronDown className={`ml-auto w-4 h-4 text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-line pt-3">
          {loading ? (
            <p className="flex items-center gap-2 text-xs text-ink-muted">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Reading visitors…
            </p>
          ) : !data ? (
            <p className="text-xs text-ink-muted">Couldn&apos;t load the visitors.</p>
          ) : !data.available ? (
            <p className="text-xs text-ink-muted">Attribution isn&apos;t collecting yet.</p>
          ) : (
            <>
              <p className="text-xs text-ink leading-relaxed mb-3">
                <span className="font-semibold">{fmtInt(data.unpaid_visitors)}</span> visitors in this range are credited
                to an unpaid channel.{' '}
                {data.misfiled_visitors > 0 ? (
                  <span className="font-semibold text-amber-700">
                    {fmtInt(data.misfiled_visitors)} of them arrived on links only an ad produces
                  </span>
                ) : (
                  'None of them arrived on a link that only an ad produces'
                )}
                {data.misfiled_visitors > 0
                  ? ' — they were recorded before the rules recognised those tags.'
                  : ' — if you ran ads in this range, see the notes below for why their clicks may still look organic.'}
              </p>

              {data.groups.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-line">
                  <table className="w-full text-xs">
                    <thead className="bg-surface text-ink-muted">
                      <tr className="text-left">
                        <th className="font-medium px-3 py-1.5">Filed as</th>
                        <th className="font-medium px-3 py-1.5">utm_source</th>
                        <th className="font-medium px-3 py-1.5">utm_medium</th>
                        <th className="font-medium px-3 py-1.5">Came from</th>
                        <th className="font-medium px-3 py-1.5">Click ID</th>
                        <th className="font-medium px-3 py-1.5 text-right">Visitors</th>
                        <th className="font-medium px-3 py-1.5">Should be</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {data.groups.map((g, i) => (
                        <tr key={i} className={g.corrected ? 'bg-amber-50/60' : ''}>
                          <td className="px-3 py-1.5 text-ink whitespace-nowrap">{channelLabel(g.channel)}</td>
                          <td className="px-3 py-1.5 font-mono text-ink break-all">{g.source ?? '—'}</td>
                          <td className="px-3 py-1.5 font-mono text-ink break-all">{g.medium ?? '—'}</td>
                          <td className="px-3 py-1.5 font-mono text-ink break-all">{g.referrer ?? '—'}</td>
                          <td className="px-3 py-1.5 font-mono text-ink">{g.click_id ?? '—'}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-ink">{fmtInt(g.visitors)}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap">
                            {g.corrected ? (
                              <span className="font-semibold text-amber-800">{channelLabel(g.corrected)}</span>
                            ) : (
                              <span className="text-ink-muted">as filed</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {canApply && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {!preview ? (
                    <button
                      type="button"
                      onClick={() => run(false)}
                      disabled={!!busy}
                      className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50"
                    >
                      {busy === 'count' && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />}
                      Find misfiled ad clicks across all history
                    </button>
                  ) : preview.total === 0 ? (
                    <span className="text-xs text-ink-muted">Nothing in the history needs moving.</span>
                  ) : (
                    <>
                      <span className="text-xs text-ink">
                        Would move <MoveSummary result={preview} /> to their paid channel.
                      </span>
                      <button
                        type="button"
                        onClick={() => run(true)}
                        disabled={!!busy}
                        className="inline-flex items-center gap-1.5 rounded-md bg-teal-dark px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-dark/90 disabled:opacity-50"
                      >
                        {busy === 'apply' && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />}
                        Move them
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreview(null)}
                        disabled={!!busy}
                        className="text-xs text-ink-muted hover:text-ink"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  <InfoTip label="What moving them changes">
                    <strong>Only ever unpaid → paid.</strong>
                    <p className="mt-1.5">
                      Each visitor, order and customer keeps the raw tags it arrived with. This re-reads those tags
                      with the current rules and moves the rows that turn out to be ad clicks to that ad channel —
                      nothing else is touched, and nothing is ever moved out of a paid channel.
                    </p>
                    <p className="mt-1.5">
                      It covers all history, not just this range. A customer moved to an ad channel who hasn&apos;t
                      ordered yet becomes eligible for the paid-ads welcome discount, as if the tag had been read
                      right the first time.
                    </p>
                  </InfoTip>
                </div>
              )}

              {done && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
                  Moved <MoveSummary result={done} />. Reload the page to see the channels update.
                </p>
              )}
              {error && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-red-600">
                  <AlertTriangle className="w-3.5 h-3.5" aria-hidden /> {error}
                </p>
              )}

              <div className="mt-3 text-[11px] text-ink-muted leading-relaxed space-y-1">
                <p>
                  <span className="font-medium text-ink">Why a Meta ad click can still look organic:</span> the ad link
                  lost its <span className="font-mono">fbclid</span> and carries no paid tag. That happens when the ad&apos;s
                  URL parameters say <span className="font-mono">utm_medium=social</span> (also used for posts, so it
                  can&apos;t be told apart). Set them in Ads Manager to{' '}
                  <span className="font-mono">utm_source=facebook&amp;utm_medium=paid_social&amp;utm_campaign=&#123;&#123;campaign.name&#125;&#125;</span>.
                </p>
                <p>
                  <span className="font-medium text-ink">Other reasons the counts differ from Meta&apos;s:</span> a visitor is
                  credited to their <em>first</em> visit, so someone who found you on Instagram or Google before clicking an
                  ad stays organic. Instagram and Facebook open links in their own browser, so someone who clicks the ad
                  and comes back later in Safari or Chrome is a new, untagged visitor. Visitors who decline the cookie
                  banner aren&apos;t recorded at all. Meta also counts ad clicks that never finish loading the page.
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MoveSummary({ result }: { result: ReclassifyResult }) {
  const sum = (r: Record<string, number>) => Object.values(r).reduce((n, v) => n + v, 0);
  const parts = [
    [sum(result.moves.visitors_first), 'visitors'],
    [sum(result.moves.orders) + sum(result.moves.hosted_orders), 'orders'],
    [sum(result.moves.customers), 'customers'],
  ].filter(([n]) => (n as number) > 0) as Array<[number, string]>;
  const lastOnly = sum(result.moves.visitors_last);
  const channels = [
    ...new Set(
      Object.values(result.moves).flatMap((r) => Object.keys(r)),
    ),
  ].map(channelLabel);
  return (
    <span className="font-semibold">
      {parts.length ? parts.map(([n, label]) => `${fmtInt(n)} ${label}`).join(', ') : `${fmtInt(lastOnly)} last visits`}
      {channels.length > 0 && ` (${channels.join(', ')})`}
    </span>
  );
}
