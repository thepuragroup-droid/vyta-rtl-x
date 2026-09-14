'use client';

/**
 * Reconcile — the partner's own settlement ledger set against ours.
 *
 * Until now this dashboard had one answer to "what do they owe us": the one we
 * compute from our hand-off ledger under the terms in the Terms tab. The
 * partner now publishes theirs (GET /partner/settlement), produced by the same
 * engine as the White Label Pay ledger they invoice from. So this tab shows
 * the two side by side and makes the gap between them the subject.
 *
 * Three things it deliberately refuses to smooth over, because each one is how
 * a reconciliation quietly goes wrong:
 *
 *   - An unconfigured split is NOT a balance of zero. It takes over the whole
 *     tab when it happens, because every figure underneath it is meaningless
 *     until Stealth Health configures the split.
 *   - The caveats are shown, not collapsed. They describe exactly how the
 *     figures were built, and are what prevent a disagreement later.
 *   - An appointment that could not be tied to one of our hand-offs is shown
 *     as unmatched rather than being quietly matched to something plausible.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Scale, Loader2, Download, CircleAlert, Info, TriangleAlert, Link2Off,
  ArrowDownUp, CheckCircle2,
} from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import type { Currency } from '@/lib/currency';
import {
  getPartnerSettlement,
  pullPartnerSettlement,
  type PartnerSettlementView,
} from '@/lib/admin/stealth-health-client';
import { money, fmtInt, fmtDate, EmptyState } from './ui';

/** Default window: the month just gone, which is what gets settled. */
function lastMonth(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** A signed cents figure, tinted by direction. */
function Variance({ cents, currency }: { cents: number; currency: Currency }) {
  if (cents === 0) {
    return <span className="text-emerald-700 font-semibold">{money(0, currency)}</span>;
  }
  const tone = cents > 0 ? 'text-blue-700' : 'text-rose-700';
  return (
    <span className={`${tone} font-semibold`}>
      {cents > 0 ? '+' : '−'}{money(Math.abs(cents), currency)}
    </span>
  );
}

/**
 * The partner ledger is USD-denominated: the hosted checkout runs in USD, and
 * their caveats say CAD store products are summed as their USD-equivalent. So
 * every figure on this tab is USD regardless of what the settlement invoice
 * currency happens to be set to — labelling a USD figure "CAD" because of a
 * Terms setting would be a straightforwardly wrong number on screen.
 */
const LEDGER_CURRENCY: Currency = 'USD';

export default function ReconcileTab({ isAdmin, termsCurrency }: {
  isAdmin: boolean;
  /** The settlement invoice currency from Terms — only used to warn on a mismatch. */
  termsCurrency: Currency;
}) {
  const toast = useToast();
  const currency = LEDGER_CURRENCY;
  const initial = lastMonth();
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [view, setView] = useState<PartnerSettlementView | null>(null);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read whatever has already been pulled for this window. Never calls the
  // partner — pulling is an explicit action, not a side effect of looking.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const v = await getPartnerSettlement({ start, end });
    setView(v);
    setLoading(false);
  }, [start, end]);

  useEffect(() => { load(); }, [load]);

  const pull = async () => {
    setPulling(true);
    setError(null);
    try {
      const v = await pullPartnerSettlement({ start, end });
      setView(v);
      // An unconfigured split is not a successful pull in any useful sense —
      // say so here rather than reporting a cheerful count of zero-value rows.
      if (v.reconcile?.summary.split_model_unconfigured) {
        toast.error('Pulled, but Stealth Health has no revenue split configured for this account.');
      } else {
        toast.success(`Pulled ${fmtInt(v.reconcile?.lines.length ?? 0)} appointments`);
      }
    } catch (e: any) {
      const message = e?.message ?? 'Could not pull the settlement ledger';
      setError(message);
      toast.error(message);
    } finally {
      setPulling(false);
    }
  };

  const summary = view?.reconcile?.summary ?? null;
  const lines = view?.reconcile?.lines ?? [];
  const unmatched = view?.reconcile?.unmatched_orders ?? [];

  const exportCsv = () => {
    const header = [
      'appointment_id', 'created_at', 'condition', 'medication', 'split_model',
      'partner_split', 'our_due', 'variance', 'match', 'order_id',
    ];
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const dec = (c: number | null) => (c === null ? '' : (c / 100).toFixed(2));
    const body = lines.map((l) => [
      l.appointment_id, l.created_at, l.condition, l.medication, l.split_model,
      dec(l.partner_split_cents), dec(l.our_due_cents), dec(l.variance_cents),
      l.match, l.order_id,
    ].map(cell).join(','));
    const blob = new Blob([[header.join(','), ...body].join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stealth-health-settlement-${start}-to-${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* ---- Window + pull ---- */}
      <div className="rounded-xl border border-line bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">From</label>
            <input
              type="date" value={start} onChange={(e) => setStart(e.target.value)}
              className="rounded-lg border border-line px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">To</label>
            <input
              type="date" value={end} onChange={(e) => setEnd(e.target.value)}
              className="rounded-lg border border-line px-3 py-2 text-sm"
            />
          </div>
          {isAdmin && (
            <button
              onClick={pull} disabled={pulling}
              className="inline-flex items-center gap-2 rounded-lg bg-bronze px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {pulling
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Pulling…</>
                : <><ArrowDownUp className="w-4 h-4" /> Pull from Stealth Health</>}
            </button>
          )}
          {lines.length > 0 && (
            <button
              onClick={exportCsv}
              className="inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium"
            >
              <Download className="w-4 h-4" /> CSV
            </button>
          )}
        </div>
        {view?.pull && (
          <p className="mt-3 text-xs text-ink-muted">
            Snapshot pulled {fmtDate(view.pull.pulled_at)}
            {view.pull.pulled_by_email ? ` by ${view.pull.pulled_by_email}` : ''} ·{' '}
            {fmtInt(view.pull.rows_returned)} appointments over {fmtInt(view.pull.pages_fetched)} page
            {view.pull.pages_fetched === 1 ? '' : 's'}
            {view.pull.totals_reported ? '' : ' · no window totals reported'}
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-sm font-semibold text-rose-900 flex items-center gap-2">
            <CircleAlert className="w-4 h-4" /> Could not pull the ledger
          </p>
          <p className="text-xs text-rose-800 mt-1 leading-relaxed">{error}</p>
        </div>
      )}

      {view && !view.configured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">No partner API key configured</p>
          <p className="text-xs text-amber-800 mt-1 leading-relaxed">
            Set <code className="px-1 py-0.5 rounded bg-amber-100 font-mono">PURAMASS_API_KEY</code>{' '}
            and <code className="px-1 py-0.5 rounded bg-amber-100 font-mono">PURAMASS_PARTNER_ID</code>{' '}
            in this environment before pulling.
          </p>
        </div>
      )}

      {view?.migration_hint && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Snapshot tables not found</p>
          <p className="text-xs text-amber-800 mt-1 leading-relaxed">{view.migration_hint}</p>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16 gap-3 text-sm text-ink-muted">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading…
        </div>
      )}

      {/* ---- The setup gap that invalidates everything below it ---- */}
      {summary?.split_model_unconfigured && (
        <div className="rounded-xl border-2 border-rose-300 bg-rose-50 p-5">
          <p className="text-base font-bold text-rose-900 flex items-center gap-2">
            <TriangleAlert className="w-5 h-5" /> Revenue split not configured
          </p>
          <p className="text-sm text-rose-900 mt-2 leading-relaxed">
            Stealth Health reports no split model for this account, so every appointment below
            comes back with a split of {money(0, currency)}. <strong>This is a setup gap, not a
            balance of zero.</strong> Ask them to configure the revenue split before reconciling
            anything in this window — the figures underneath are not a statement of what we are
            owed.
          </p>
        </div>
      )}

      {!loading && !summary && (
        <EmptyState
          message={
            isAdmin
              ? 'This window has not been pulled yet. Pull it from Stealth Health to reconcile.'
              : 'This window has not been pulled yet. An admin can pull it from Stealth Health.'
          }
        />
      )}

      {summary && (
        <>
          {/* ---- The two sides, and the gap ---- */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-line bg-white p-4">
              <p className="text-xs font-medium text-ink-muted">Their ledger (partner_split)</p>
              <p className="text-2xl font-bold text-ink mt-1">
                {money(summary.partner.split_cents, currency)}
              </p>
              <p className="text-xs text-ink-muted mt-1">
                {fmtInt(summary.partner.appointments)} appointments ·{' '}
                {summary.partner.from_reported_totals ? 'their window totals' : 'summed from rows'}
              </p>
            </div>
            <div className="rounded-xl border border-line bg-white p-4">
              <p className="text-xs font-medium text-ink-muted">Our ledger (under our terms)</p>
              <p className="text-2xl font-bold text-ink mt-1">
                {money(summary.ours.due_cents, currency)}
              </p>
              <p className="text-xs text-ink-muted mt-1">
                {fmtInt(summary.ours.orders)} paid hand-offs
              </p>
            </div>
            <div className="rounded-xl border border-line bg-white p-4">
              <p className="text-xs font-medium text-ink-muted">Variance (theirs − ours)</p>
              <p className="text-2xl font-bold mt-1">
                <Variance cents={summary.variance_cents} currency={currency} />
              </p>
              <p className="text-xs text-ink-muted mt-1">
                {summary.matched} matched · {summary.disputed} disagreeing
              </p>
            </div>
          </div>

          {/* ---- Things that make the comparison less than exact ---- */}
          <div className="space-y-2">
            {summary.partner.totals_row_delta_cents !== null
              && summary.partner.totals_row_delta_cents !== 0 && (
              <Note tone="amber">
                Their window total is {money(Math.abs(summary.partner.totals_row_delta_cents), currency)}{' '}
                {summary.partner.totals_row_delta_cents > 0 ? 'more' : 'less'} than the rows we
                received add up to, so the detail below is not the whole window.
              </Note>
            )}
            {view?.pull?.truncated && (
              <Note tone="amber">
                Paging stopped early, so this snapshot is partial.
              </Note>
            )}
            {termsCurrency !== LEDGER_CURRENCY && (
              <Note tone="amber">
                Settlement invoices are set to {termsCurrency} in Terms, but every figure on
                this tab is {LEDGER_CURRENCY} — that is the currency the partner ledger reports
                in. Converting between the two is not done here.
              </Note>
            )}
            {summary.currency_mixed && (
              <Note tone="amber">
                This window contains a hand-off booked in a currency other than USD. Their ledger
                sums CAD store products as their USD-equivalent, so the comparison above crosses an
                FX conversion neither side has agreed a rate for.
              </Note>
            )}
            {(summary.partner_only > 0 || summary.ledger_only > 0) && (
              <Note tone="neutral">
                <Link2Off className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                {summary.partner_only} appointment{summary.partner_only === 1 ? '' : 's'} could not be
                tied to one of our hand-offs, and {summary.ledger_only} paid hand-off
                {summary.ledger_only === 1 ? '' : 's'} had no appointment. Matching is exact-only on{' '}
                <code className="font-mono">transaction_id</code> /{' '}
                <code className="font-mono">partner_reference</code> — it never guesses.
              </Note>
            )}
            {view?.drift && view.drift.split_delta_cents !== 0 && (
              <Note tone="amber">
                This window last answered{' '}
                {money(view.drift.previous.partner_split_cents, currency)} when pulled{' '}
                {fmtDate(view.drift.previous.pulled_at)}; it now answers{' '}
                {money(view.drift.latest.partner_split_cents, currency)} — a move of{' '}
                {money(Math.abs(view.drift.split_delta_cents), currency)}. Store cost is joined
                from the current catalog rather than stamped at checkout, so a price change can
                move a window after the fact.
              </Note>
            )}
          </div>

          {/* ---- Their caveats, verbatim ---- */}
          {summary.caveats.length > 0 && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-sm font-semibold text-blue-900 flex items-center gap-2">
                <Info className="w-4 h-4" /> How Stealth Health built these figures
              </p>
              <ul className="mt-2 space-y-1.5">
                {summary.caveats.map((c) => (
                  <li key={c.code} className="text-xs text-blue-900 leading-relaxed">
                    <span className="font-mono text-[11px] text-blue-700">{c.code}</span>
                    {c.message && c.message !== c.code ? ` — ${c.message}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ---- Per-appointment detail ---- */}
          {lines.length > 0 && (
            <div className="rounded-xl border border-line bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-line flex items-center gap-2">
                <Scale className="w-4 h-4 text-ink-muted" />
                <h3 className="text-sm font-semibold text-ink">Appointments</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-xs text-ink-muted">
                    <tr>
                      <th className="text-left font-medium px-4 py-2">Appointment</th>
                      <th className="text-left font-medium px-4 py-2">Date</th>
                      <th className="text-left font-medium px-4 py-2">Medication</th>
                      <th className="text-right font-medium px-4 py-2">Their split</th>
                      <th className="text-right font-medium px-4 py-2">Ours</th>
                      <th className="text-right font-medium px-4 py-2">Variance</th>
                      <th className="text-left font-medium px-4 py-2">Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.appointment_id} className="border-t border-line">
                        <td className="px-4 py-2 font-mono text-xs">{l.appointment_id}</td>
                        <td className="px-4 py-2 text-xs text-ink-muted">{fmtDate(l.created_at)}</td>
                        <td className="px-4 py-2 text-xs">{l.medication ?? '—'}</td>
                        <td className="px-4 py-2 text-right">{money(l.partner_split_cents, currency)}</td>
                        <td className="px-4 py-2 text-right text-ink-muted">
                          {l.our_due_cents === null ? '—' : money(l.our_due_cents, currency)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {l.variance_cents === null
                            ? <span className="text-ink-muted">—</span>
                            : <Variance cents={l.variance_cents} currency={currency} />}
                        </td>
                        <td className="px-4 py-2">
                          {l.match === 'none'
                            ? <span className="inline-flex items-center gap-1 text-xs text-amber-700"><Link2Off className="w-3 h-3" /> unmatched</span>
                            : <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="w-3 h-3" /> {l.match}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ---- Our hand-offs their ledger didn't account for ---- */}
          {unmatched.length > 0 && (
            <div className="rounded-xl border border-line bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-line">
                <h3 className="text-sm font-semibold text-ink">
                  Paid hand-offs with no appointment ({fmtInt(unmatched.length)})
                </h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  We settled these but nothing in their window accounts for them.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-xs text-ink-muted">
                    <tr>
                      <th className="text-left font-medium px-4 py-2">Day</th>
                      <th className="text-left font-medium px-4 py-2">Transaction</th>
                      <th className="text-left font-medium px-4 py-2">Reference</th>
                      <th className="text-right font-medium px-4 py-2">We expect</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unmatched.map((o) => (
                      <tr key={o.order_id} className="border-t border-line">
                        <td className="px-4 py-2 text-xs text-ink-muted">{fmtDate(o.day)}</td>
                        <td className="px-4 py-2 font-mono text-xs">{o.transaction_id ?? '—'}</td>
                        <td className="px-4 py-2 font-mono text-xs">{o.partner_reference ?? '—'}</td>
                        <td className="px-4 py-2 text-right">{money(o.our_due_cents, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Note({ tone, children }: { tone: 'amber' | 'neutral'; children: React.ReactNode }) {
  const classes = tone === 'amber'
    ? 'border-amber-200 bg-amber-50 text-amber-900'
    : 'border-line bg-surface text-ink-muted';
  return (
    <div className={`rounded-lg border px-4 py-2.5 text-xs leading-relaxed ${classes}`}>
      {children}
    </div>
  );
}
