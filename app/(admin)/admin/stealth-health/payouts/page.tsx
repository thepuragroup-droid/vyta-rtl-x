'use client';

/**
 * /admin/stealth-health/payouts — what Stealth Health still owes us, order by
 * order, and the payout requests we send them.
 *
 * Customers pay Stealth Health; Stealth Health keeps a processing fee (3.2% at
 * the catalog price, 6% at a custom price) and pays out the rest when we ask.
 * Pick the orders, request a payout (a numbered PDF), and mark them paid out
 * when the money lands.
 *
 * Every figure comes from the API (lib/admin/stealth-health-payouts, shared
 * with the PDF); this page filters and formats. Reads: admin + assistant.
 * Writes: admin.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Wallet, Loader2, RefreshCw, Percent, Search, X, FileDown, Send, CheckCheck,
  Undo2, CircleAlert, CheckCircle2, Ban,
} from 'lucide-react';
import { useUserRole } from '@/app/(admin)/admin/layout';
import { useToast } from '@/contexts/ToastContext';
import { BRAND } from '@/lib/brand';
import {
  canVoid,
  dayIn,
  filterByState,
  filterRequests,
  formatRate,
  inRange,
  matchesSearch,
  normalizeDatePreset,
  normalizeStateFilter,
  resolveDatePreset,
  requestStatusLabel,
  splitFee,
  summaryCards,
  sumOrders,
  type DatePreset,
  type DateRange,
  type FeeRates,
  type FeeType,
  type PayoutOrder,
  type PayoutRequestView,
  type RequestFilter,
  type StateFilter,
} from '@/lib/admin/stealth-health-payouts';
import {
  PayoutApiError,
  createPayoutRequest,
  downloadPayoutPdf,
  getPayoutData,
  markPaidOut,
  receivePayoutRequest,
  saveFeeRates,
  setFeeType,
  undoPaidOut,
  voidPayoutRequest,
  type PayoutData,
} from '@/lib/admin/stealth-health-payouts-client';
import StealthHealthTabs from '../_components/StealthHealthTabs';
import { money, fmtDate, fmtInt } from '../_components/ui';
import {
  ActionToast,
  Checkbox,
  CustomerCell,
  DateRangeFilter,
  FeeCell,
  PillToggle,
  StatTile,
  StatusCell,
  TotalCell,
  type ActionToastState,
} from '../_components/payouts/payout-ui';
import {
  FeeRatesDialog,
  ReceiveDialog,
  RequestPayoutDialog,
  VoidDialog,
} from '../_components/payouts/PayoutDialogs';

const UNDO_MS = 8000;

const today = () => dayIn(new Date().toISOString(), BRAND.timeZone)!;

const orderLabel = (o: PayoutOrder) => o.invoice_number ?? o.transaction_id ?? 'Order';

export default function StealthHealthPayoutsPage() {
  const role = useUserRole();
  const isAdmin = role === 'admin';
  const toast = useToast();

  const [data, setData] = useState<PayoutData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters (state + date range live in the URL).
  const [show, setShow] = useState<StateFilter>('owed');
  const [preset, setPreset] = useState<DatePreset>('any');
  const [custom, setCustom] = useState<DateRange>({ from: null, to: null });
  const [search, setSearch] = useState('');
  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  const [reqShow, setReqShow] = useState<RequestFilter>('open');
  const [reqPreset, setReqPreset] = useState<DatePreset>('any');
  const [reqCustom, setReqCustom] = useState<DateRange>({ from: null, to: null });
  const [urlReady, setUrlReady] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [actionToast, setActionToast] = useState<ActionToastState | null>(null);
  const toastId = useRef(0);

  const [ratesOpen, setRatesOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [receiving, setReceiving] = useState<PayoutRequestView | null>(null);
  const [voiding, setVoiding] = useState<PayoutRequestView | null>(null);

  const ordersTop = useRef<HTMLDivElement>(null);

  // ---- URL state -------------------------------------------------------------
  // Read from window rather than useSearchParams so the page needs no Suspense
  // boundary (same as /admin/stealth-health). A named range is re-resolved
  // against today on load.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setShow(normalizeStateFilter(p.get('show')));
    const r = normalizeDatePreset(p.get('range'));
    setPreset(r);
    if (r === 'custom') setCustom({ from: p.get('from') || null, to: p.get('to') || null });
    setUrlReady(true);
  }, []);

  useEffect(() => {
    if (!urlReady) return;
    const p = new URLSearchParams(window.location.search);
    const set = (k: string, v: string | null) => (v ? p.set(k, v) : p.delete(k));
    set('show', show === 'owed' ? null : show);
    set('range', preset === 'any' ? null : preset);
    set('from', preset === 'custom' ? custom.from : null);
    set('to', preset === 'custom' ? custom.to : null);
    const qs = p.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }, [urlReady, show, preset, custom]);

  // ---- Data ----------------------------------------------------------------------
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const d = await getPayoutData();
      setData(d);
      setSetupRequired(false);
      setLoadError(null);
    } catch (e) {
      if (e instanceof PayoutApiError && e.setupRequired) setSetupRequired(true);
      else setLoadError(e instanceof Error ? e.message : 'Could not load payouts');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ---- Derived -------------------------------------------------------------------
  const range = useMemo(() => resolveDatePreset(preset, today(), custom), [preset, custom]);
  const reqRange = useMemo(() => resolveDatePreset(reqPreset, today(), reqCustom), [reqPreset, reqCustom]);

  const orders = data?.orders ?? [];
  const rates: FeeRates = data?.rates ?? { catalog: 0.032, custom: 0.06 };
  const requestsById = useMemo(
    () => new Map((data?.requests ?? []).map((r) => [r.id, r])),
    [data],
  );
  const focused = focusRequest ? requestsById.get(focusRequest) ?? null : null;

  const inDateRange = useMemo(() => orders.filter((o) => inRange(o.day, range)), [orders, range]);
  const cards = useMemo(() => summaryCards(inDateRange), [inDateRange]);

  const listed = useMemo(() => {
    const base = focused
      ? orders.filter((o) => o.payout_request_id === focused.id)
      : filterByState(inDateRange, show);
    return base.filter((o) => matchesSearch(o, search));
  }, [orders, inDateRange, show, focused, search]);
  const listedTotals = useMemo(() => sumOrders(listed), [listed]);

  const selectedOrders = useMemo(() => orders.filter((o) => selected.has(o.id)), [orders, selected]);
  const selectedTotals = useMemo(() => sumOrders(selectedOrders), [selectedOrders]);

  const requests = useMemo(
    () => filterRequests(data?.requests ?? [], reqShow, reqRange),
    [data, reqShow, reqRange],
  );

  // Drop selections that are no longer listed (filters changed, or data reloaded).
  useEffect(() => {
    setSelected((cur) => {
      if (cur.size === 0) return cur;
      const ids = new Set(listed.map((o) => o.id));
      const next = new Set([...cur].filter((id) => ids.has(id)));
      return next.size === cur.size ? cur : next;
    });
  }, [listed]);

  // ---- Helpers ------------------------------------------------------------------
  const showToast = useCallback((t: Omit<ActionToastState, 'id' | 'duration'> & { duration?: number }) => {
    toastId.current += 1;
    setActionToast({ id: toastId.current, duration: UNDO_MS, ...t });
  }, []);
  const dismissToast = useCallback(() => setActionToast(null), []);

  const withBusy = async (ids: string[], fn: () => Promise<void>) => {
    setBusyIds((cur) => new Set([...cur, ...ids]));
    try { await fn(); } finally {
      setBusyIds((cur) => { const n = new Set(cur); ids.forEach((id) => n.delete(id)); return n; });
    }
  };

  /** Switch the fee locally first, so the fee and net move at once. */
  const applyFeeLocally = (ids: string[], feeType: FeeType) => {
    setData((d) => {
      if (!d) return d;
      const set = new Set(ids);
      return {
        ...d,
        orders: d.orders.map((o) => {
          if (!set.has(o.id) || o.locked) return o;
          const rate = feeType === 'custom' ? d.rates.custom : d.rates.catalog;
          if (o.gross_cents == null) return { ...o, fee_type: feeType, rate };
          const { fee_cents, net_cents } = splitFee(o.gross_cents, rate);
          return { ...o, fee_type: feeType, rate, fee_cents, net_cents };
        }),
      };
    });
  };

  const changeFee = async (ids: string[], feeType: FeeType) => {
    const editable = orders.filter((o) => ids.includes(o.id) && !o.locked && o.fee_type !== feeType).map((o) => o.id);
    if (editable.length === 0) return;
    applyFeeLocally(editable, feeType);
    try {
      await setFeeType(editable, feeType);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not change the fee');
    } finally {
      load(true);
    }
  };

  const undo = async (ids: string[]) => {
    try {
      const r = await undoPaidOut(ids);
      toast.info(`${r.ids.length} order${r.ids.length === 1 ? '' : 's'} back to owed`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not undo');
    } finally {
      load(true);
    }
  };

  const markPaid = async (target: PayoutOrder[]) => {
    const ids = target.filter((o) => o.state !== 'paid_out').map((o) => o.id);
    if (ids.length === 0) return;
    await withBusy(ids, async () => {
      try {
        const r = await markPaidOut(ids);
        await load(true);
        if (r.ids.length === 0) {
          toast.info('Nothing to mark — already paid out');
          return;
        }
        const one = r.ids.length === 1 ? target.find((o) => o.id === r.ids[0]) : null;
        showToast({
          message: one ? `${orderLabel(one)} marked paid out` : `${r.ids.length} orders marked paid out`,
          actionLabel: 'Undo',
          onAction: () => undo(r.ids),
        });
        setSelected((cur) => { const n = new Set(cur); r.ids.forEach((id) => n.delete(id)); return n; });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not mark paid out');
      }
    });
  };

  const openRequest = (id: string) => {
    setFocusRequest(id);
    setSelected(new Set());
    ordersTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ---- Render ----------------------------------------------------------------------
  const header = (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <Wallet className="w-6 h-6 text-teal-dark" /> Stealth Health Payouts
        </h1>
        <p className="text-sm text-ink-muted mt-1 max-w-2xl">
          Customers pay Stealth Health, who keep a processing fee and pay the rest out to us when we ask.
          Request a payout for the orders below, then mark them paid out when the money arrives.
        </p>
        <div className="mt-3"><StealthHealthTabs active="payouts" /></div>
      </div>
      <div className="flex items-center gap-2 self-start sm:self-auto">
        {isAdmin && data && (
          <button onClick={() => setRatesOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-line rounded-lg text-sm text-ink hover:bg-surface">
            <Percent className="w-4 h-4" /> Fees {formatRate(rates.catalog)} / {formatRate(rates.custom)}
          </button>
        )}
        <button onClick={() => load()} disabled={refreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-line rounded-lg text-sm text-ink hover:bg-surface disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <>
        {header}
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-ink-muted" />
          <p className="text-sm text-ink-muted">Loading payouts…</p>
        </div>
      </>
    );
  }

  if (setupRequired) {
    return (
      <>
        {header}
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Payout tables not found</p>
          <p className="text-xs text-amber-800 mt-1 leading-relaxed">
            Run <code className="px-1 py-0.5 rounded bg-amber-100 font-mono">stealth-health-payouts-migration.sql</code>{' '}
            (and <code className="px-1 py-0.5 rounded bg-amber-100 font-mono">stealth-health-portal-snapshot-migration.sql</code>)
            in the Supabase SQL editor, then refresh.
          </p>
        </div>
      </>
    );
  }

  if (!data) {
    return (
      <>
        {header}
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <p className="text-sm text-ink-muted">{loadError ?? 'Could not load payouts.'}</p>
          <button onClick={() => load()}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-dark text-white rounded-lg text-sm font-medium hover:bg-teal/90">
            <RefreshCw className="w-4 h-4" /> Try again
          </button>
        </div>
      </>
    );
  }

  const selectable = isAdmin ? listed : [];
  const allSelected = selectable.length > 0 && selectable.every((o) => selected.has(o.id));
  const someSelected = selectable.some((o) => selected.has(o.id));
  const toggleAll = (on: boolean) => setSelected(on ? new Set(selectable.map((o) => o.id)) : new Set());
  const toggle = (id: string, on: boolean) =>
    setSelected((cur) => { const n = new Set(cur); if (on) n.add(id); else n.delete(id); return n; });

  const paidCell = (o: PayoutOrder) => {
    if (!isAdmin) return null;
    const busy = busyIds.has(o.id);
    if (o.state === 'paid_out') {
      return (
        <button onClick={() => withBusy([o.id], () => undo([o.id]))} disabled={busy}
          className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-muted hover:text-ink hover:bg-surface disabled:opacity-50"
          title="Undo paid out" aria-label={`Undo paid out for ${orderLabel(o)}`}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
        </button>
      );
    }
    return (
      <button onClick={() => markPaid([o])} disabled={busy}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-emerald-200 bg-emerald-50 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3 h-3" />} Paid
      </button>
    );
  };

  const rangeWord = preset === 'any' ? 'all time' : 'in range';

  return (
    <div className={selected.size > 0 ? 'pb-24' : ''}>
      {header}

      {/* Summary tiles — the selected date range, any state. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatTile tone="amber" label="Owed to us" value={money(cards.owed.net_cents, 'CAD')}
          sub={`${fmtInt(cards.owed.count)} order${cards.owed.count === 1 ? '' : 's'} not paid out · ${rangeWord}`} />
        <StatTile tone="teal" label="Requested" value={money(cards.requested.net_cents, 'CAD')}
          sub={`${fmtInt(cards.requested.count)} order${cards.requested.count === 1 ? '' : 's'} · ${fmtInt(cards.requested.open_requests)} open request${cards.requested.open_requests === 1 ? '' : 's'}`} />
        <StatTile tone="emerald" label="Paid out" value={money(cards.paid_out.net_cents, 'CAD')}
          sub={`${fmtInt(cards.paid_out.count)} order${cards.paid_out.count === 1 ? '' : 's'}`} />
        <StatTile label="Fees" value={money(cards.all.fee_cents, 'CAD')}
          sub={`${fmtInt(cards.all.catalog_count)} catalog · ${fmtInt(cards.all.custom_count)} custom`} />
      </div>

      {cards.owed.unknown_count > 0 && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 flex items-center gap-1.5">
          <CircleAlert className="w-3.5 h-3.5 shrink-0" />
          {cards.owed.unknown_count} owed order{cards.owed.unknown_count === 1 ? ' has' : 's have'} no known amount and
          {cards.owed.unknown_count === 1 ? ' is' : ' are'} left out of the totals. Refresh the order on Stealth Health → Orders to poll it.
        </p>
      )}

      {/* Filters */}
      <div ref={ordersTop} className="flex flex-col lg:flex-row lg:items-center gap-3 mb-3 scroll-mt-4">
        {focused ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 pl-3 pr-1 py-1 text-xs font-medium text-amber-900">
              Showing {focused.payout_number}
              <button onClick={() => setFocusRequest(null)} className="rounded-full p-0.5 hover:bg-amber-500/20" aria-label="Show all orders">
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
            <span className="text-xs text-ink-muted">{requestStatusLabel(focused)}</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <PillToggle value={show} onChange={setShow}
              options={[{ value: 'owed', label: 'Owed' }, { value: 'paid_out', label: 'Paid out' }, { value: 'all', label: 'All' }]} />
            <DateRangeFilter preset={preset} custom={custom} resolved={range}
              onPreset={(p) => { setPreset(p); if (p === 'custom' && !custom.from && !custom.to) setCustom(range); }}
              onCustom={setCustom} />
          </div>
        )}
        <label className="relative lg:ml-auto lg:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer, invoice, transaction…"
            title="Search customer name, email, invoice number, transaction ID and request number"
            className="w-full pl-8 pr-8 py-1.5 bg-white border border-line rounded-lg text-sm text-ink" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink" aria-label="Clear search">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </label>
      </div>

      {/* Orders */}
      {listed.length === 0 ? (
        <div className="rounded-xl border border-line bg-white p-10 text-center text-sm text-ink-muted mb-8">
          {orders.length === 0
            ? 'No customer-paid Stealth Health orders yet.'
            : show === 'owed' && !focused && !search
              ? `Nothing owed ${preset === 'any' ? '' : 'in this range '}— every order is paid out.`
              : 'No orders match these filters.'}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-line overflow-hidden mb-8">
          {/* Desktop table */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface text-[10px] uppercase tracking-wider text-ink-muted">
                <tr>
                  {isAdmin && (
                    <th className="w-10 px-4 py-2.5">
                      <Checkbox label="Select all listed" checked={allSelected} indeterminate={!allSelected && someSelected} onChange={toggleAll} />
                    </th>
                  )}
                  <th className="text-left font-semibold px-3 py-2.5">Date paid</th>
                  <th className="text-left font-semibold px-3 py-2.5">Invoice</th>
                  <th className="text-left font-semibold px-3 py-2.5">Customer</th>
                  <th className="text-right font-semibold px-3 py-2.5">Total (CAD)</th>
                  <th className="text-right font-semibold px-3 py-2.5">Fee</th>
                  <th className="text-right font-semibold px-3 py-2.5">Net</th>
                  <th className="text-left font-semibold px-3 py-2.5">Status</th>
                  {isAdmin && <th className="text-right font-semibold px-4 py-2.5">Paid</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {listed.map((o) => (
                  <tr key={o.id} className={`hover:bg-surface/60 ${selected.has(o.id) ? 'bg-teal-50/60' : ''}`}>
                    {isAdmin && (
                      <td className="px-4 py-3">
                        <Checkbox label={`Select ${orderLabel(o)}`} checked={selected.has(o.id)} onChange={(on) => toggle(o.id, on)} />
                      </td>
                    )}
                    <td className="px-3 py-3 whitespace-nowrap text-ink">{fmtDate(o.paid_at)}</td>
                    <td className="px-3 py-3 max-w-[11rem]">
                      <p className="text-sm text-ink truncate">{o.invoice_number ?? '—'}</p>
                      <p className="text-[11px] text-ink-muted font-mono truncate" title={o.transaction_id ?? undefined}>{o.transaction_id ?? 'no transaction ID'}</p>
                    </td>
                    <td className="px-3 py-3 max-w-[15rem]"><CustomerCell order={o} /></td>
                    <td className="px-3 py-3"><TotalCell order={o} /></td>
                    <td className="px-3 py-3">
                      <FeeCell order={o} rates={rates} canEdit={isAdmin} onChange={(t) => changeFee([o.id], t)} />
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-semibold text-ink whitespace-nowrap">
                      {o.net_cents == null ? '—' : money(o.net_cents, 'CAD')}
                    </td>
                    <td className="px-3 py-3"><StatusCell order={o} onOpenRequest={openRequest} /></td>
                    {isAdmin && <td className="px-4 py-3 text-right">{paidCell(o)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cards below lg */}
          <div className="lg:hidden divide-y divide-line">
            {isAdmin && (
              <div className="flex items-center gap-2 px-4 py-2.5 bg-surface">
                <Checkbox label="Select all listed" checked={allSelected} indeterminate={!allSelected && someSelected} onChange={toggleAll} />
                <span className="text-xs text-ink-muted">Select all</span>
              </div>
            )}
            {listed.map((o) => (
              <div key={o.id} className={`p-4 ${selected.has(o.id) ? 'bg-teal-50/60' : ''}`}>
                <div className="flex items-start gap-3">
                  {isAdmin && (
                    <div className="pt-0.5">
                      <Checkbox label={`Select ${orderLabel(o)}`} checked={selected.has(o.id)} onChange={(on) => toggle(o.id, on)} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <CustomerCell order={o} />
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold tabular-nums text-ink">{o.net_cents == null ? '—' : money(o.net_cents, 'CAD')}</p>
                        <p className="text-[11px] text-ink-muted">net</p>
                      </div>
                    </div>
                    <p className="text-[11px] text-ink-muted mt-1 truncate">
                      {fmtDate(o.paid_at)} · {o.invoice_number ?? 'no invoice'} · <span className="font-mono">{o.transaction_id ?? 'no transaction ID'}</span>
                    </p>
                    <div className="flex flex-wrap items-end justify-between gap-3 mt-3">
                      <TotalCell order={o} align="left" />
                      <FeeCell order={o} rates={rates} canEdit={isAdmin} onChange={(t) => changeFee([o.id], t)} align="left" />
                      <div className="flex items-center gap-2 ml-auto">
                        <StatusCell order={o} onOpenRequest={openRequest} />
                        {paidCell(o)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Footer: what's listed */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-t border-line bg-surface text-xs text-ink-muted">
            <span>{fmtInt(listedTotals.count)} order{listedTotals.count === 1 ? '' : 's'} listed</span>
            <span className="tabular-nums">
              Net <span className="font-semibold text-ink">{money(listedTotals.net_cents, 'CAD')}</span>
              {' · '}Fees {money(listedTotals.fee_cents, 'CAD')}
              {listedTotals.unknown_count > 0 && ` · ${listedTotals.unknown_count} amount unknown`}
            </span>
          </div>
        </div>
      )}

      {/* Payout requests */}
      <section>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
          <h2 className="text-base font-semibold text-ink flex items-center gap-2">
            <Send className="w-4 h-4 text-teal-dark" /> Payout requests
          </h2>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <PillToggle value={reqShow} onChange={setReqShow}
              options={[{ value: 'open', label: 'Open' }, { value: 'received', label: 'Received' }, { value: 'all', label: 'All' }]} />
            <DateRangeFilter preset={reqPreset} custom={reqCustom} resolved={reqRange}
              onPreset={(p) => { setReqPreset(p); if (p === 'custom' && !reqCustom.from && !reqCustom.to) setReqCustom(reqRange); }}
              onCustom={setReqCustom} />
          </div>
        </div>

        {requests.length === 0 ? (
          <div className="rounded-xl border border-line bg-white p-8 text-center text-sm text-ink-muted">
            {(data.requests ?? []).length === 0
              ? 'No payout requests yet. Select orders above and click Request payout.'
              : 'No requests match these filters.'}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-line divide-y divide-line">
            {requests.map((r) => (
              <RequestRow key={r.id} r={r} isAdmin={isAdmin}
                onOpen={() => openRequest(r.id)}
                onPdf={async () => {
                  try { await downloadPayoutPdf(r.id, r.payout_number); }
                  catch (e) { toast.error(e instanceof Error ? e.message : 'Could not download the PDF'); }
                }}
                onReceive={() => setReceiving(r)}
                onVoid={() => setVoiding(r)} />
            ))}
          </div>
        )}
      </section>

      {/* Selection bar */}
      {isAdmin && selected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(96vw,880px)]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-ink text-white shadow-xl px-4 py-3">
            <p className="text-sm">
              <span className="font-semibold">{selected.size} selected</span>
              <span className="text-white/60"> · </span>Net <span className="font-semibold tabular-nums">{money(selectedTotals.net_cents, 'CAD')}</span>
              <span className="text-white/60"> · Fees {money(selectedTotals.fee_cents, 'CAD')}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              <div className="inline-flex rounded-lg bg-white/10 p-0.5">
                {(['catalog', 'custom'] as FeeType[]).map((t) => (
                  <button key={t} onClick={() => changeFee([...selected], t)}
                    className="px-2.5 py-1 rounded-md text-xs font-medium text-white/80 hover:bg-white/15 hover:text-white">
                    {formatRate(t === 'custom' ? rates.custom : rates.catalog)}
                  </button>
                ))}
              </div>
              <button onClick={() => setRequestOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal text-white text-sm font-semibold hover:bg-teal-light">
                <Send className="w-4 h-4" /> Request payout
              </button>
              <button onClick={async () => { setBulkBusy(true); try { await markPaid(selectedOrders); } finally { setBulkBusy(false); } }}
                disabled={bulkBusy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-ink text-sm font-semibold hover:bg-white/90 disabled:opacity-60">
                {bulkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />} Mark paid
              </button>
              <button onClick={() => setSelected(new Set())} className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10" aria-label="Clear selection">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <ActionToast toast={actionToast} onDismiss={dismissToast} raised={isAdmin && selected.size > 0} />

      {ratesOpen && (
        <FeeRatesDialog rates={rates} onClose={() => setRatesOpen(false)}
          onSave={async (r) => {
            try {
              await saveFeeRates(r);
              toast.success(`Fees set to ${formatRate(r.catalog)} / ${formatRate(r.custom)}`);
              setRatesOpen(false);
              await load(true);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Could not save the rates');
            }
          }} />
      )}

      {requestOpen && (
        <RequestPayoutDialog orders={selectedOrders}
          filterRange={preset === 'any' ? { from: null, to: null } : range}
          onClose={() => setRequestOpen(false)}
          onCreate={async (body) => {
            try {
              const res = await createPayoutRequest(body);
              setRequestOpen(false);
              setSelected(new Set());
              await load(true);
              const req = res.request;
              showToast({
                message: `${req.payout_number} created · ${money(req.live.net_cents, 'CAD')} net`,
                actionLabel: 'Download PDF',
                onAction: () => {
                  downloadPayoutPdf(req.id, req.payout_number)
                    .catch((e) => toast.error(e instanceof Error ? e.message : 'Could not download the PDF'));
                },
                duration: 12000,
              });
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Could not create the request');
            }
          }} />
      )}

      {receiving && (
        <ReceiveDialog request={receiving} onClose={() => setReceiving(null)}
          onReceive={async (amount, reference) => {
            try {
              const r = await receivePayoutRequest(receiving.id, amount, reference);
              setReceiving(null);
              await load(true);
              showToast({
                message: `${receiving.payout_number} received`,
                ...(r.ids.length > 0 ? { actionLabel: 'Undo', onAction: () => undo(r.ids) } : {}),
              });
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Could not mark it received');
            }
          }} />
      )}

      {voiding && (
        <VoidDialog request={voiding} onClose={() => setVoiding(null)}
          onVoid={async () => {
            try {
              await voidPayoutRequest(voiding.id);
              toast.success(`${voiding.payout_number} voided`);
              if (focusRequest === voiding.id) setFocusRequest(null);
              setVoiding(null);
              await load(true);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Could not void the request');
            }
          }} />
      )}
    </div>
  );
}

function RequestRow({ r, isAdmin, onOpen, onPdf, onReceive, onVoid }: {
  r: PayoutRequestView;
  isAdmin: boolean;
  onOpen: () => void;
  onPdf: () => Promise<void>;
  onReceive: () => void;
  onVoid: () => void;
}) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const statusClass = r.status === 'void'
    ? 'bg-rose-500/10 text-rose-700'
    : r.status === 'received'
      ? 'bg-emerald-500/10 text-emerald-700'
      : 'bg-amber-500/10 text-amber-800';
  const net = r.status === 'void' ? r.snapshot.net_cents : r.live.net_cents;
  const fees = r.status === 'void' ? r.snapshot.fee_cents : r.live.fee_cents;
  const count = r.status === 'void' ? r.snapshot.count : r.live.count;

  return (
    <div className="flex flex-col md:flex-row md:items-center gap-3 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={onOpen} disabled={r.status === 'void'}
            className="text-sm font-semibold text-ink hover:text-teal-dark disabled:hover:text-ink disabled:cursor-default">
            {r.payout_number}
          </button>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${statusClass}`}>
            {requestStatusLabel(r)}
          </span>
          {r.changed && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/10 text-blue-700"
              title={`Requested ${money(r.snapshot.net_cents, 'CAD')} net over ${r.snapshot.count} orders. The PDF shows the figures as they stand now.`}>
              Changed since requested
            </span>
          )}
        </div>
        <p className="text-[11px] text-ink-muted mt-1">
          Requested {fmtDate(r.created_at)}
          {(r.period_start || r.period_end) && ` · period ${fmtDate(r.period_start)} – ${fmtDate(r.period_end)}`}
          {` · ${fmtInt(count)} order${count === 1 ? '' : 's'}`}
        </p>
        {(r.received_at || r.received_amount_cents != null || r.received_reference) && r.status !== 'void' && (
          <p className="text-[11px] text-emerald-800 mt-0.5">
            {r.received_at ? `Received ${fmtDate(r.received_at)}` : 'Deposit recorded'}
            {r.received_amount_cents != null && ` · ${money(r.received_amount_cents, 'CAD')}`}
            {r.received_reference && ` · ref ${r.received_reference}`}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 md:gap-4">
        <div className="text-right">
          <p className={`text-sm font-semibold tabular-nums ${r.status === 'void' ? 'text-ink-muted line-through' : 'text-ink'}`}>
            {money(net, 'CAD')}
          </p>
          <p className="text-[11px] text-ink-muted tabular-nums">fees {money(fees, 'CAD')}</p>
        </div>
        <div className="flex items-center gap-1.5 ml-auto md:ml-0">
          <button onClick={async () => { setPdfBusy(true); try { await onPdf(); } finally { setPdfBusy(false); } }}
            disabled={pdfBusy}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-line text-xs font-medium text-ink hover:bg-surface disabled:opacity-50">
            {pdfBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />} PDF
          </button>
          {isAdmin && r.status === 'requested' && (
            <button onClick={onReceive}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-teal-dark text-white text-xs font-medium hover:bg-teal/90 whitespace-nowrap">
              <CheckCircle2 className="w-3.5 h-3.5" /> Mark received
            </button>
          )}
          {isAdmin && canVoid(r) && (
            <button onClick={onVoid}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-rose-700 hover:bg-rose-50"
              title="Release its orders">
              <Ban className="w-3.5 h-3.5" /> Void
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
