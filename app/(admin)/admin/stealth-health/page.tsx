'use client';

/**
 * /admin/stealth-health — the settlement dashboard for the Stealth Health
 * (PuraMass) partnership.
 *
 * Stealth Health runs the hosted checkout, so the buyer pays THEM while we ship
 * the goods. This page answers the three questions that follow from that:
 *
 *   1. What have we earned through Stealth Health?  (Overview)
 *   2. How much do they still owe us, and what have they actually remitted?
 *      (the balance strip + Payouts)
 *   3. Bill them for it.                            (Invoices)
 *
 * All the arithmetic comes from the API, which shares lib/admin/stealth-health
 * with the invoice render — this file only formats.
 */
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Handshake, Loader2, RefreshCw, DollarSign, Wallet, Scale, FileText,
  TrendingUp, Package, Receipt, Settings2, ArrowRight, CircleAlert, CreditCard,
} from 'lucide-react';
import { useUserRole } from '@/app/(admin)/admin/layout';
import {
  getStealthHealthSummary,
  type StealthHealthSummary,
} from '@/lib/admin/stealth-health-client';
import { KpiCard, money, fmtInt, fmtDate, StatusBadge, DailyBars, MigrationNotice, MoneyRow } from './_components/ui';
import InvoicesTab from './_components/InvoicesTab';
import ReconcileTab from './_components/ReconcileTab';
import PayoutsTab from './_components/PayoutsTab';
import TermsTab from './_components/TermsTab';
import OrdersTab from './_components/orders/OrdersTab';

type Tab = 'overview' | 'reconcile' | 'invoices' | 'payouts' | 'orders' | 'terms';

const TABS: Array<{ key: Tab; label: string; icon: React.ElementType }> = [
  { key: 'overview', label: 'Overview', icon: TrendingUp },
  { key: 'reconcile', label: 'Reconcile', icon: Scale },
  { key: 'invoices', label: 'Invoices', icon: FileText },
  { key: 'payouts', label: 'Payouts', icon: Wallet },
  { key: 'orders', label: 'Orders', icon: CreditCard },
  { key: 'terms', label: 'Terms', icon: Settings2 },
];

const TAB_KEYS = TABS.map((t) => t.key);

function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
}

export default function StealthHealthPage() {
  const role = useUserRole();
  const isAdmin = role === 'admin';

  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<StealthHealthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // Deep link: /admin/stealth-health?tab=orders. Read from window rather than
  // useSearchParams so the page needs no Suspense boundary.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    if (requested && (TAB_KEYS as string[]).includes(requested)) setTab(requested as Tab);
  }, []);

  const load = useCallback(async () => {
    setRefreshing(true);
    const s = await getStealthHealthSummary({ from: from || null, to: to || null });
    setSummary(s);
    setLoading(false);
    setRefreshing(false);
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-ink-muted" />
        <p className="text-sm text-ink-muted">Loading Stealth Health settlement…</p>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-sm text-ink-muted">Could not load the settlement dashboard.</p>
        <button onClick={load}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-bronze text-white rounded-lg text-sm font-medium hover:bg-bronze/90">
          <RefreshCw className="w-4 h-4" /> Try again
        </button>
      </div>
    );
  }

  const cur = summary.currency;
  const b = summary.balance;
  const hasRange = Boolean(from || to);

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Handshake className="w-6 h-6 text-bronze" /> Stealth Health
          </h1>
          <p className="text-sm text-ink-muted mt-1 max-w-2xl">
            Stealth Health collects payment on its hosted checkout and we ship the goods, so every
            paid hand-off is money they hold for us. {summary.terms_summary}
          </p>
        </div>
        <button onClick={load} disabled={refreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-line rounded-lg text-sm text-ink hover:bg-surface disabled:opacity-50 self-start sm:self-auto">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {!summary.migrated && <MigrationNotice />}

      {/* The balance — always all-time, never filtered by the date range, because
          "what do they owe us" has one answer. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KpiCard tint="bronze" icon={DollarSign} label="Earned all-time"
          value={money(b.earned_cents, cur)}
          sub="net of refunds and their cut"
          hint="Every paid hand-off, settled under the current terms." />
        <KpiCard tint="emerald" icon={Wallet} label="Paid to us"
          value={money(b.paid_cents, cur)}
          sub={`${fmtInt(summary.recent_payouts.length)} recent payout${summary.recent_payouts.length === 1 ? '' : 's'}`}
          hint="Total remitted by Stealth Health." />
        <KpiCard tint={b.outstanding_cents > 0 ? 'amber' : 'emerald'} icon={Scale} label="They owe us"
          value={money(b.outstanding_cents, cur)}
          sub={b.uninvoiced_cents > 0 ? `${money(b.uninvoiced_cents, cur)} not yet invoiced` : 'all earnings invoiced'}
          hint="Earned all-time minus everything remitted." />
        <KpiCard tint={b.overdue_cents > 0 ? 'rose' : 'neutral'} icon={Receipt} label="Invoiced & unpaid"
          value={money(b.overdue_cents, cur)}
          sub={`${fmtInt(b.open_invoices)} open invoice${b.open_invoices === 1 ? '' : 's'}`}
          hint="Raised on a sent invoice and still outstanding." />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-line mb-5 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                active
                  ? 'border-bronze text-bronze'
                  : 'border-transparent text-ink-muted hover:text-ink'
              }`}>
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'overview' && (
        <OverviewTab
          summary={summary}
          from={from} to={to}
          setFrom={setFrom} setTo={setTo}
          hasRange={hasRange}
          onGoToInvoices={() => setTab('invoices')}
        />
      )}
      {tab === 'reconcile' && <ReconcileTab isAdmin={isAdmin} termsCurrency={cur} />}
      {tab === 'invoices' && (
        <InvoicesTab isAdmin={isAdmin} currency={cur} onChanged={load}
          uninvoicedCents={b.uninvoiced_cents} migrated={summary.migrated} />
      )}
      {tab === 'payouts' && (
        <PayoutsTab isAdmin={isAdmin} currency={cur} onChanged={load} migrated={summary.migrated} />
      )}
      {tab === 'orders' && <OrdersTab />}
      {tab === 'terms' && <TermsTab isAdmin={isAdmin} onSaved={load} />}
    </>
  );
}

function OverviewTab({ summary, from, to, setFrom, setTo, hasRange, onGoToInvoices }: {
  summary: StealthHealthSummary;
  from: string; to: string;
  setFrom: (v: string) => void; setTo: (v: string) => void;
  hasRange: boolean;
  onGoToInvoices: () => void;
}) {
  const cur = summary.currency;
  const e = summary.earned;
  const rangeLabel = hasRange ? 'in the selected range' : 'all-time';

  return (
    <>
      {/* Range picker — scopes the earnings analytics only. */}
      <div className="flex flex-wrap items-end gap-2 mb-5">
        <div className="flex items-center gap-1 mr-1 pb-0.5">
          {[{ label: '7d', days: 7 }, { label: '30d', days: 30 }, { label: '90d', days: 90 }].map((p) => {
            const active = from === daysAgo(p.days) && to === isoDay(new Date());
            return (
              <button key={p.label}
                onClick={() => { setFrom(daysAgo(p.days)); setTo(isoDay(new Date())); }}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  active ? 'bg-bronze text-white border-bronze'
                         : 'bg-white text-ink-muted border-line hover:bg-surface hover:text-ink'
                }`}>
                {p.label}
              </button>
            );
          })}
        </div>
        <DateField label="From" value={from} onChange={setFrom} />
        <DateField label="To" value={to} onChange={setTo} />
        {hasRange && (
          <button onClick={() => { setFrom(''); setTo(''); }}
            className="text-xs text-ink-muted hover:text-ink pb-2">Clear</button>
        )}
        <p className="text-xs text-ink-muted pb-2 ml-auto flex items-center gap-1.5">
          <CircleAlert className="w-3.5 h-3.5" />
          The balance above is always all-time — the range only scopes the earnings below.
        </p>
      </div>

      {e.order_count === 0 ? (
        <div className="rounded-xl border border-line bg-white p-10 text-center text-sm text-ink-muted">
          No paid Stealth Health hand-offs {rangeLabel}.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <KpiCard tint="bronze" icon={DollarSign} label={`Earned ${hasRange ? 'in range' : 'all-time'}`}
              value={money(e.due_cents, cur)}
              sub={`across ${fmtInt(e.order_count)} paid order${e.order_count === 1 ? '' : 's'}`} />
            <KpiCard tint="blue" icon={Receipt} label="Buyers paid Stealth Health"
              value={money(e.gross_cents, cur)}
              sub={e.refunds_cents > 0 ? `less ${money(e.refunds_cents, cur)} refunded` : 'no refunds'} />
            <KpiCard tint="amber" icon={Scale} label="Their cut"
              value={money(e.fee_cents, cur)}
              sub={e.fee_cents === 0 ? 'they retain nothing' : 'commission + per-order fees'} />
            <KpiCard tint="neutral" icon={Package} label="Units shipped"
              value={fmtInt(e.units)} sub={`avg ${money(Math.round(e.due_cents / Math.max(1, e.order_count)), cur)} earned per order`} />
          </div>

          <div className="grid lg:grid-cols-2 gap-6 mb-6">
            {/* How the money splits — the arithmetic, spelled out. */}
            <div className="bg-white rounded-xl border border-line p-5">
              <h3 className="text-sm font-semibold text-ink mb-3">How the money splits</h3>
              <MoneyRow label="Goods the buyers paid for" cents={e.gross_cents} currency={cur} />
              <MoneyRow label="Refunded on the Stealth Health side" cents={e.refunds_cents} currency={cur} sign="−" />
              <MoneyRow label="Shipment fees remitted to us" cents={e.shipping_cents} currency={cur} sign="+" />
              <MoneyRow label="Retained by Stealth Health" cents={e.fee_cents} currency={cur} sign="−" />
              <MoneyRow label={`Earned ${hasRange ? 'in range' : 'all-time'}`} cents={e.due_cents} currency={cur} strong />
              <p className="text-[11px] text-ink-muted mt-3 pt-3 border-t border-line leading-relaxed">
                {summary.terms_summary} Change this under <span className="font-medium text-ink">Terms</span>;
                invoices already raised keep the terms they were created with.
              </p>
            </div>

            {/* Billed vs not */}
            <div className="bg-white rounded-xl border border-line p-5 flex flex-col">
              <h3 className="text-sm font-semibold text-ink mb-3">Billing status {hasRange ? '(in range)' : ''}</h3>
              <MoneyRow label={`On a settlement invoice · ${fmtInt(summary.billed.order_count)} orders`}
                cents={summary.billed.due_cents} currency={cur} />
              <MoneyRow label={`Not yet invoiced · ${fmtInt(summary.unbilled.order_count)} orders`}
                cents={summary.unbilled.due_cents} currency={cur} />
              {summary.excluded_orders > 0 && (
                <p className="text-xs text-ink-muted mt-2">
                  {fmtInt(summary.excluded_orders)} hand-off{summary.excluded_orders === 1 ? '' : 's'} held back from settlement.
                </p>
              )}
              <div className="mt-auto pt-4">
                {summary.balance.uninvoiced_cents > 0 ? (
                  <button onClick={onGoToInvoices}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-bronze text-white rounded-lg text-sm font-medium hover:bg-bronze/90">
                    Invoice {money(summary.balance.uninvoiced_cents, cur)} <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <p className="text-xs text-ink-muted text-center py-2">
                    Everything earned has been billed.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <DailyBars points={summary.daily} currency={cur}
              title="Earned per day"
              subtitle={summary.daily_truncated
                ? `Most recent ${summary.daily.length} days`
                : 'What Stealth Health owed us for each day’s orders'} />

            <div className="bg-white rounded-xl border border-line p-5">
              <h3 className="text-sm font-semibold text-ink mb-3">Latest settlement invoices</h3>
              {summary.recent_invoices.length === 0 ? (
                <p className="text-xs text-ink-muted py-6 text-center">
                  None raised yet — bill the outstanding earnings from the Invoices tab.
                </p>
              ) : (
                <div className="divide-y divide-line -my-2">
                  {summary.recent_invoices.map((inv) => (
                    <Link key={inv.id} href={`/admin/stealth-health/invoices/${inv.id}`}
                      className="flex items-center justify-between gap-3 py-2.5 group">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-ink group-hover:text-bronze truncate">
                            {inv.invoice_number}
                          </span>
                          <StatusBadge status={inv.status} />
                        </div>
                        <p className="text-[11px] text-ink-muted mt-0.5">
                          {fmtInt(inv.order_count)} orders · issued {fmtDate(inv.issue_date)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold tabular-nums text-ink">
                          {money(inv.amount_due_cents, inv.currency)}
                        </p>
                        {inv.balance_cents > 0 && inv.status !== 'draft' && (
                          <p className="text-[11px] text-amber-700 tabular-nums">
                            {money(inv.balance_cents, inv.currency)} outstanding
                          </p>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function DateField({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold">{label}</span>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)}
        className="px-2.5 py-1.5 bg-white border border-line rounded-lg text-sm text-ink" />
    </label>
  );
}
