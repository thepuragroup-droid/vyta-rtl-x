'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X,
  RefreshCw,
  ArrowLeft,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Package,
  Search,
  Link2,
  ChevronLeft,
  ChevronRight,
  FileText,
} from 'lucide-react';
import {
  previewEasyshipSync,
  applyEasyshipSync,
  listEasyshipManualInvoices,
  listEasyshipManualShipments,
  linkEasyshipShipment,
  EASYSHIP_MANUAL_PAGE_SIZE,
  type EasyshipSyncPreview,
  type EasyshipSyncMatch,
  type EasyshipSyncUnmatched,
  type EasyshipManualInvoice,
  type EasyshipManualInvoicePage,
  type EasyshipManualShipments,
} from '@/lib/admin/invoices';
import { formatMoney, normalizeCurrency } from '@/lib/currency';

interface EasyshipSyncDialogProps {
  open: boolean;
  onClose: () => void;
  /** Fires with the apply result so the list page can refresh + toast. */
  onApplied?: (result: { applied: number; failed: number; skipped: number }) => void;
}

type Step = 'pick' | 'review' | 'manual' | 'done';
type Mode = 'auto' | 'manual';

function isoDay(offsetDays = 0): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  // Format from local parts — toISOString() would shift the day for anyone
  // west of UTC and hand the picker yesterday's date.
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function todayIso(): string {
  return isoDay(0);
}

/**
 * The picker allows one day past today. Easyship stamps `created_at` in UTC,
 * so a shipment made late in the local evening can already carry tomorrow's
 * date — being able to reach forward a day means an operator never has to
 * guess whether the window covered it.
 */
function maxDateIso(): string {
  return isoDay(1);
}

/** Midnight UTC on the selected calendar day — what Easyship filters on. */
function dateToIso(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toISOString();
}

function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function EasyshipSyncDialog({
  open,
  onClose,
  onApplied,
}: EasyshipSyncDialogProps) {
  const [step, setStep] = useState<Step>('pick');
  const [mode, setMode] = useState<Mode>('auto');
  const [date, setDate] = useState(todayIso());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<EasyshipSyncPreview | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [applyResult, setApplyResult] = useState<{
    applied: number;
    failed: number;
    skipped: number;
  } | null>(null);

  // ---- Manual match state ----
  const [invPage, setInvPage] = useState(1);
  const [invSearch, setInvSearch] = useState('');
  const [invSearchInput, setInvSearchInput] = useState('');
  const [includeLinked, setIncludeLinked] = useState(false);
  const [invData, setInvData] = useState<EasyshipManualInvoicePage | null>(null);
  const [invLoading, setInvLoading] = useState(false);
  const [shipData, setShipData] = useState<EasyshipManualShipments | null>(null);
  const [shipLoading, setShipLoading] = useState(false);
  const [shipSearch, setShipSearch] = useState('');
  const [pickedInvoice, setPickedInvoice] = useState<EasyshipManualInvoice | null>(null);
  const [pickedShipment, setPickedShipment] = useState<EasyshipSyncUnmatched | null>(null);
  const [confirmOverride, setConfirmOverride] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkNote, setLinkNote] = useState<string | null>(null);
  const [linkedCount, setLinkedCount] = useState(0);

  const resetManual = useCallback(() => {
    setInvPage(1);
    setInvSearch('');
    setInvSearchInput('');
    setIncludeLinked(false);
    setInvData(null);
    setShipData(null);
    setShipSearch('');
    setPickedInvoice(null);
    setPickedShipment(null);
    setConfirmOverride(false);
    setLinkNote(null);
    setLinkedCount(0);
  }, []);

  useEffect(() => {
    if (!open) {
      // Reset when the dialog closes so re-opening starts clean.
      setStep('pick');
      setMode('auto');
      setDate(todayIso());
      setPreview(null);
      setSelected({});
      setApplyResult(null);
      setError(null);
      setLoading(false);
      resetManual();
    }
  }, [open, resetManual]);

  // Debounce the invoice search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setInvSearch(invSearchInput.trim());
      setInvPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [invSearchInput]);

  const loadInvoices = useCallback(async () => {
    setInvLoading(true);
    setError(null);
    try {
      const res = await listEasyshipManualInvoices({
        page: invPage,
        pageSize: EASYSHIP_MANUAL_PAGE_SIZE,
        search: invSearch,
        includeLinked,
      });
      setInvData(res);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load invoices');
    } finally {
      setInvLoading(false);
    }
  }, [invPage, invSearch, includeLinked]);

  useEffect(() => {
    if (step === 'manual') void loadInvoices();
  }, [step, loadInvoices]);

  const loadShipments = useCallback(async () => {
    setShipLoading(true);
    setError(null);
    try {
      const res = await listEasyshipManualShipments();
      setShipData(res);
      setPickedShipment(null);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load shipments');
    } finally {
      setShipLoading(false);
    }
  }, []);

  async function startManual() {
    resetManual();
    setStep('manual');
    await loadShipments();
  }

  async function runPreview() {
    setLoading(true);
    setError(null);
    try {
      // Send the start-of-day in UTC — Easyship indexes by created_after.
      const res = await previewEasyshipSync(dateToIso(date));
      setPreview(res);
      // Auto-select every unambiguous match; ambiguous ones require the
      // admin to look at each row before ticking the box.
      const nextSelected: Record<string, boolean> = {};
      for (const m of res.matches) {
        if (!m.ambiguous) nextSelected[m.invoice_id] = true;
      }
      setSelected(nextSelected);
      setStep('review');
    } catch (e: any) {
      setError(e?.message ?? 'Preview failed');
    } finally {
      setLoading(false);
    }
  }

  const selectedMatches: EasyshipSyncMatch[] = useMemo(() => {
    if (!preview) return [];
    return preview.matches.filter((m) => selected[m.invoice_id]);
  }, [preview, selected]);

  const allSelected =
    preview !== null &&
    preview.matches.length > 0 &&
    preview.matches.every((m) => selected[m.invoice_id]);

  function toggleAll() {
    if (!preview) return;
    if (allSelected) {
      setSelected({});
    } else {
      const next: Record<string, boolean> = {};
      for (const m of preview.matches) next[m.invoice_id] = true;
      setSelected(next);
    }
  }

  async function runApply() {
    if (selectedMatches.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await applyEasyshipSync(selectedMatches);
      const summary = {
        applied: res.applied,
        failed: res.failed.length,
        skipped: res.skipped.length,
      };
      setApplyResult(summary);
      onApplied?.(summary);
      setStep('done');
    } catch (e: any) {
      setError(e?.message ?? 'Apply failed');
    } finally {
      setLoading(false);
    }
  }

  // A pairing needs the operator's explicit go-ahead when it overwrites an
  // existing binding or touches something already marked shipped. Which row
  // that is depends on the invoice's anchor — the order behind it, or the
  // invoice itself when it has none.
  const alreadyShipped =
    pickedInvoice?.anchor === 'order'
      ? pickedInvoice.order_status === 'shipped' ||
        pickedInvoice.order_status === 'delivered'
      : pickedInvoice?.fulfillment_status === 'shipped';

  const needsOverride = Boolean(
    pickedInvoice &&
      pickedShipment &&
      ((pickedInvoice.easyship_shipment_id &&
        pickedInvoice.easyship_shipment_id !== pickedShipment.easyship_shipment_id) ||
        alreadyShipped),
  );

  const shipmentTakenBy =
    pickedShipment && shipData
      ? shipData.linked[pickedShipment.easyship_shipment_id]
      : undefined;

  const canLink =
    !!pickedInvoice &&
    !!pickedShipment &&
    !linking &&
    (!needsOverride || confirmOverride);

  async function runLink() {
    if (!pickedInvoice || !pickedShipment) return;
    setLinking(true);
    setError(null);
    setLinkNote(null);
    try {
      const res = await linkEasyshipShipment({
        invoice_id: pickedInvoice.invoice_id,
        // Null when the invoice anchors its own shipment.
        order_id: pickedInvoice.order_id,
        easyship_shipment_id: pickedShipment.easyship_shipment_id,
        tracking_number: pickedShipment.tracking_number,
        courier_name: pickedShipment.courier_name,
        override: needsOverride && confirmOverride,
      });

      if (res.applied > 0) {
        const total = linkedCount + res.applied;
        setLinkedCount(total);
        setLinkNote(
          `Linked ${pickedInvoice.invoice_number} → ${pickedShipment.easyship_shipment_id}`,
        );
        onApplied?.({ applied: res.applied, failed: 0, skipped: 0 });
        // Reflect the new binding locally so the row greys out immediately.
        setShipData((prev) =>
          prev
            ? {
                ...prev,
                linked: {
                  ...prev.linked,
                  [pickedShipment.easyship_shipment_id]:
                    pickedInvoice.anchor === 'order' && pickedInvoice.order_id
                      ? {
                          kind: 'order',
                          id: pickedInvoice.order_id,
                          label: pickedInvoice.order_number,
                        }
                      : {
                          kind: 'invoice',
                          id: pickedInvoice.invoice_id,
                          label: pickedInvoice.invoice_number,
                        },
                },
              }
            : prev,
        );
        setPickedInvoice(null);
        setPickedShipment(null);
        setConfirmOverride(false);
        await loadInvoices();
      } else {
        const reason =
          res.skipped[0]?.reason ?? res.failed[0]?.error ?? 'nothing was applied';
        setError(`Not linked: ${reason}`);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Link failed');
    } finally {
      setLinking(false);
    }
  }

  const visibleShipments = useMemo(() => {
    const all = shipData?.shipments ?? [];
    const q = shipSearch.trim().toLowerCase();
    if (!q) return all;
    return all.filter((s) =>
      [s.destination_name, s.tracking_number, s.easyship_shipment_id, s.courier_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [shipData, shipSearch]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className={`w-full overflow-hidden rounded-2xl bg-white shadow-2xl ${
          step === 'manual' ? 'max-w-5xl' : 'max-w-3xl'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-teal/10 p-2">
              <RefreshCw className="h-5 w-5 text-teal-dark" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ink">Sync Easyship shipments</h2>
              <p className="text-xs text-ink-muted">
                {step === 'pick' && 'Fetch a day of shipments and match them to invoices'}
                {step === 'review' && `Review matches from ${date}`}
                {step === 'manual' && 'Hand-match invoices to Easyship shipments'}
                {step === 'done' && 'Sync complete'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-lg p-2 text-ink-muted hover:bg-surface hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {step === 'pick' && (
            <div className="space-y-4">
              <div>
                <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                  How do you want to match?
                </span>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setMode('auto')}
                    className={`cursor-pointer rounded-lg border px-3 py-2.5 text-left ${
                      mode === 'auto'
                        ? 'border-ink bg-ink/5'
                        : 'border-line hover:bg-surface'
                    }`}
                  >
                    <div className="text-sm font-medium text-ink">Auto match</div>
                    <div className="mt-0.5 text-xs text-ink-muted">
                      Pair invoices and shipments by customer name, then review
                      the list before applying.
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('manual')}
                    className={`cursor-pointer rounded-lg border px-3 py-2.5 text-left ${
                      mode === 'manual'
                        ? 'border-ink bg-ink/5'
                        : 'border-line hover:bg-surface'
                    }`}
                  >
                    <div className="text-sm font-medium text-ink">Manual match</div>
                    <div className="mt-0.5 text-xs text-ink-muted">
                      Browse invoices 10 at a time and attach a shipment to one
                      of them yourself.
                    </div>
                  </button>
                </div>
              </div>

              {mode === 'auto' ? (
                <>
                  <label className="block">
                    <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                      Shipments created on or after
                    </span>
                    <input
                      type="date"
                      value={date}
                      max={maxDateIso()}
                      onChange={(e) => setDate(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
                    />
                  </label>
                  <p className="text-xs text-ink-muted">
                    Fetches every Easyship shipment created since midnight UTC
                    on the selected date and matches them to un-shipped
                    invoices by normalized customer name. Tomorrow&apos;s date
                    is selectable too — Easyship stamps shipments in UTC, so
                    reaching a day forward makes sure a late-evening shipment
                    is still in the window.
                  </p>
                </>
              ) : (
                <p className="text-xs text-ink-muted">
                  Browse every invoice still waiting on a shipment and pick the
                  Easyship parcel yourself. There is no date to choose — the
                  matcher loads a recent window of shipments so a parcel is
                  never hidden behind the wrong day.
                </p>
              )}
            </div>
          )}

          {step === 'review' && preview && (
            <div className="space-y-4">
              <div className="rounded-lg bg-surface px-3 py-2 text-xs text-ink-muted">
                Fetched <strong className="text-ink">{preview.fetched}</strong>{' '}
                shipments · <strong className="text-ink">{preview.matches.length}</strong>{' '}
                match{preview.matches.length === 1 ? '' : 'es'} to invoices ·{' '}
                <strong className="text-ink">{preview.unmatched.length}</strong>{' '}
                unmatched
                {preview.easyshipError && (
                  <span className="ml-2 text-red-600">
                    · Easyship error: {preview.easyshipError}
                  </span>
                )}
              </div>

              {preview.matches.length > 0 ? (
                <div className="overflow-hidden rounded-lg border border-line">
                  <div className="flex items-center gap-3 border-b border-line bg-surface px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="cursor-pointer"
                      aria-label="Select all matches"
                    />
                    <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                      Select all · {selectedMatches.length} of {preview.matches.length} selected
                    </span>
                  </div>
                  <ul className="divide-y divide-line">
                    {preview.matches.map((m) => (
                      <li key={m.invoice_id} className="px-3 py-2.5">
                        <label className="flex cursor-pointer items-start gap-3">
                          <input
                            type="checkbox"
                            checked={!!selected[m.invoice_id]}
                            onChange={(e) =>
                              setSelected((prev) => ({
                                ...prev,
                                [m.invoice_id]: e.target.checked,
                              }))
                            }
                            className="mt-1 cursor-pointer"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-sm">
                              <span className="font-mono font-semibold text-ink">
                                {m.invoice_number}
                              </span>
                              <span className="text-ink-muted">→</span>
                              <span className="font-mono text-ink-muted">
                                {m.easyship_shipment_id}
                              </span>
                              {m.ambiguous && (
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                                  Ambiguous
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 text-xs text-ink-muted">
                              {m.customer_name ?? 'Unknown customer'}
                              {m.easyship_destination_name &&
                                m.easyship_destination_name !== m.customer_name && (
                                  <span> · shipped to {m.easyship_destination_name}</span>
                                )}
                              {m.courier_name && <span> · {m.courier_name}</span>}
                              {m.tracking_number && (
                                <span> · {m.tracking_number}</span>
                              )}
                            </div>
                          </div>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">
                  No invoices matched the shipments returned by Easyship for
                  this date.
                </div>
              )}

              {preview.unmatched.length > 0 && (
                <details className="rounded-lg border border-line">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-muted hover:bg-surface">
                    Unmatched shipments ({preview.unmatched.length})
                  </summary>
                  <ul className="divide-y divide-line">
                    {preview.unmatched.map((s) => (
                      <li key={s.easyship_shipment_id} className="px-3 py-2 text-xs">
                        <div className="flex items-center gap-2">
                          <Package className="h-3 w-3 text-ink-muted" />
                          <span className="font-mono text-ink">
                            {s.easyship_shipment_id}
                          </span>
                          {s.tracking_number && (
                            <span className="text-ink-muted">
                              · {s.tracking_number}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-ink-muted">
                          {s.destination_name ?? 'Unknown recipient'}
                          {s.courier_name && <span> · {s.courier_name}</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="border-t border-line px-3 py-2">
                    <button
                      type="button"
                      onClick={startManual}
                      className="cursor-pointer text-xs font-medium text-teal-dark hover:underline"
                    >
                      Hand-match these instead →
                    </button>
                  </div>
                </details>
              )}
            </div>
          )}

          {step === 'manual' && (
            <div className="space-y-4">
              {/* Shipment window + refresh */}
              <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface px-3 py-2.5">
                <div className="text-xs text-ink-muted">
                  <span className="block text-[10px] font-medium uppercase tracking-wide">
                    Shipment window
                  </span>
                  <span className="text-ink">
                    {shipData
                      ? `Last ${shipData.lookbackDays} days · since ${shortDate(shipData.since)}`
                      : 'Recent shipments'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={loadShipments}
                  disabled={shipLoading}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm text-ink hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {shipLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Reload shipments
                </button>
                <div className="ml-auto text-xs text-ink-muted">
                  {shipData && (
                    <>
                      <strong className="text-ink">{shipData.fetched}</strong>{' '}
                      shipment{shipData.fetched === 1 ? '' : 's'} fetched
                      {linkedCount > 0 && (
                        <>
                          {' · '}
                          <strong className="text-emerald-700">{linkedCount}</strong>{' '}
                          linked this session
                        </>
                      )}
                    </>
                  )}
                  {shipData?.easyshipError && (
                    <span className="ml-2 text-red-600">
                      · Easyship error: {shipData.easyshipError}
                    </span>
                  )}
                </div>
              </div>

              {linkNote && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{linkNote}</span>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                {/* ---- Invoices ---- */}
                <div className="flex flex-col overflow-hidden rounded-lg border border-line">
                  <div className="border-b border-line bg-surface px-3 py-2">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-ink-muted" />
                      <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                        Invoices
                      </span>
                      {invLoading && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-muted" />
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
                        <input
                          type="search"
                          value={invSearchInput}
                          onChange={(e) => setInvSearchInput(e.target.value)}
                          placeholder="Invoice #, customer, email"
                          className="w-full rounded-lg border border-line bg-white py-1.5 pl-7 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
                        />
                      </div>
                    </div>
                    <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-muted">
                      <input
                        type="checkbox"
                        checked={includeLinked}
                        onChange={(e) => {
                          setIncludeLinked(e.target.checked);
                          setInvPage(1);
                        }}
                        className="cursor-pointer"
                      />
                      Include invoices already linked to a shipment
                    </label>
                  </div>

                  <ul className="min-h-[18rem] divide-y divide-line">
                    {(invData?.invoices ?? []).map((inv) => {
                      const active = pickedInvoice?.invoice_id === inv.invoice_id;
                      return (
                        <li key={inv.invoice_id}>
                          <button
                            type="button"
                            onClick={() =>
                              setPickedInvoice(active ? null : inv)
                            }
                            className={`w-full cursor-pointer px-3 py-2 text-left ${
                              active ? 'bg-ink/5' : 'hover:bg-surface'
                            }`}
                          >
                            <div className="flex items-center gap-2 text-sm">
                              <span className="font-mono font-semibold text-ink">
                                {inv.invoice_number}
                              </span>
                              {inv.easyship_shipment_id && (
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                                  Linked
                                </span>
                              )}
                              <span className="ml-auto text-[11px] text-ink-muted">
                                {shortDate(inv.created_at)}
                              </span>
                            </div>
                            <div className="mt-0.5 truncate text-xs text-ink-muted">
                              {inv.customer_name ?? 'Unknown customer'}
                              {inv.order_number ? (
                                <span> · {inv.order_number}</span>
                              ) : (
                                <span> · no order</span>
                              )}
                              {inv.total !== null && (
                                <span>
                                  {' · '}
                                  {formatMoney(
                                    Number(inv.total),
                                    normalizeCurrency(inv.currency),
                                  )}
                                </span>
                              )}
                              {inv.order_status && <span> · {inv.order_status}</span>}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                    {!invLoading && (invData?.invoices.length ?? 0) === 0 && (
                      <li className="px-3 py-8 text-center text-sm text-ink-muted">
                        No invoices match this filter.
                      </li>
                    )}
                  </ul>

                  <div className="mt-auto flex items-center justify-between border-t border-line bg-surface px-3 py-2 text-xs text-ink-muted">
                    <span>
                      Page {invData?.page ?? invPage} of {invData?.totalPages ?? 1} ·{' '}
                      {invData?.total ?? 0} total
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setInvPage((p) => Math.max(1, p - 1))}
                        disabled={invLoading || (invData?.page ?? 1) <= 1}
                        aria-label="Previous page"
                        className="cursor-pointer rounded p-1 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setInvPage((p) => p + 1)}
                        disabled={
                          invLoading ||
                          (invData?.page ?? 1) >= (invData?.totalPages ?? 1)
                        }
                        aria-label="Next page"
                        className="cursor-pointer rounded p-1 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* ---- Shipments ---- */}
                <div className="flex flex-col overflow-hidden rounded-lg border border-line">
                  <div className="border-b border-line bg-surface px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-ink-muted" />
                      <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                        Easyship shipments
                      </span>
                      {shipLoading && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-muted" />
                      )}
                    </div>
                    <div className="mt-2 relative">
                      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
                      <input
                        type="search"
                        value={shipSearch}
                        onChange={(e) => setShipSearch(e.target.value)}
                        placeholder="Recipient, tracking #, shipment id"
                        className="w-full rounded-lg border border-line bg-white py-1.5 pl-7 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
                      />
                    </div>
                    <div className="mt-2 text-[11px] text-ink-muted">
                      Showing {visibleShipments.length} of{' '}
                      {shipData?.shipments.length ?? 0}
                    </div>
                  </div>

                  <ul className="min-h-[18rem] max-h-[26rem] divide-y divide-line overflow-y-auto">
                    {visibleShipments.map((s) => {
                      const active =
                        pickedShipment?.easyship_shipment_id === s.easyship_shipment_id;
                      const taken = shipData?.linked[s.easyship_shipment_id];
                      return (
                        <li key={s.easyship_shipment_id}>
                          <button
                            type="button"
                            onClick={() => setPickedShipment(active ? null : s)}
                            className={`w-full cursor-pointer px-3 py-2 text-left ${
                              active ? 'bg-ink/5' : 'hover:bg-surface'
                            }`}
                          >
                            <div className="flex items-center gap-2 text-sm">
                              <span className="truncate font-medium text-ink">
                                {s.destination_name ?? 'Unknown recipient'}
                              </span>
                              {taken && (
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                                  Attached
                                </span>
                              )}
                              <span className="ml-auto text-[11px] text-ink-muted">
                                {shortDate(s.created_at)}
                              </span>
                            </div>
                            <div className="mt-0.5 truncate font-mono text-[11px] text-ink-muted">
                              {s.easyship_shipment_id}
                              {s.tracking_number && <span> · {s.tracking_number}</span>}
                            </div>
                            <div className="truncate text-xs text-ink-muted">
                              {s.courier_name ?? 'No courier'}
                              {s.status && <span> · {s.status}</span>}
                              {taken && (
                                <span>
                                  {' '}
                                  · on {taken.kind} {taken.label ?? taken.id}
                                </span>
                              )}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                    {!shipLoading && visibleShipments.length === 0 && (
                      <li className="px-3 py-8 text-center text-sm text-ink-muted">
                        No shipments in this window.
                      </li>
                    )}
                  </ul>
                </div>
              </div>

              {/* ---- Pairing summary ---- */}
              <div className="rounded-lg border border-line px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono font-semibold text-ink">
                    {pickedInvoice?.invoice_number ?? '— pick an invoice —'}
                  </span>
                  <Link2 className="h-4 w-4 text-ink-muted" />
                  <span className="font-mono text-ink">
                    {pickedShipment?.easyship_shipment_id ?? '— pick a shipment —'}
                  </span>
                </div>
                {pickedInvoice && pickedShipment && (
                  <div className="mt-1 text-xs text-ink-muted">
                    {pickedInvoice.customer_name ?? 'Unknown customer'}
                    {pickedShipment.destination_name &&
                      pickedShipment.destination_name !== pickedInvoice.customer_name && (
                        <span>
                          {' '}
                          · shipping to {pickedShipment.destination_name}{' '}
                          <span className="font-medium text-amber-700">
                            (names differ — double-check)
                          </span>
                        </span>
                      )}
                  </div>
                )}
                {shipmentTakenBy && (
                  <div className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-800">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      This shipment is already attached to {shipmentTakenBy.kind}{' '}
                      {shipmentTakenBy.label ?? shipmentTakenBy.id}. Linking it
                      here leaves it on both.
                    </span>
                  </div>
                )}
                {needsOverride && (
                  <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
                    <input
                      type="checkbox"
                      checked={confirmOverride}
                      onChange={(e) => setConfirmOverride(e.target.checked)}
                      className="mt-0.5 cursor-pointer"
                    />
                    <span>
                      This {pickedInvoice?.anchor === 'order' ? 'order' : 'invoice'}{' '}
                      is{' '}
                      {pickedInvoice?.easyship_shipment_id &&
                      pickedInvoice.easyship_shipment_id !==
                        pickedShipment?.easyship_shipment_id
                        ? `already bound to ${pickedInvoice.easyship_shipment_id}`
                        : `already marked ${
                            pickedInvoice?.anchor === 'order'
                              ? pickedInvoice.order_status
                              : pickedInvoice?.fulfillment_status
                          }`}
                      . Overwrite it with the selected shipment.
                    </span>
                  </label>
                )}
              </div>
            </div>
          )}

          {step === 'done' && applyResult && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="rounded-full bg-emerald-100 p-3">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              </div>
              <h3 className="text-lg font-semibold text-ink">Sync complete</h3>
              <div className="text-sm text-ink-muted">
                <strong className="text-emerald-700">{applyResult.applied}</strong> applied
                {applyResult.skipped > 0 && (
                  <>
                    {' · '}
                    <strong className="text-amber-700">{applyResult.skipped}</strong>{' '}
                    skipped
                  </>
                )}
                {applyResult.failed > 0 && (
                  <>
                    {' · '}
                    <strong className="text-red-700">{applyResult.failed}</strong>{' '}
                    failed
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line bg-surface px-6 py-3">
          <div>
            {(step === 'review' || step === 'manual') && (
              <button
                type="button"
                onClick={() => setStep('pick')}
                disabled={loading || linking}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:bg-white hover:text-ink disabled:cursor-not-allowed"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step !== 'done' && (
              <button
                type="button"
                onClick={onClose}
                disabled={loading || linking}
                className="cursor-pointer rounded-lg border border-line bg-white px-4 py-1.5 text-sm text-ink hover:bg-surface disabled:cursor-not-allowed"
              >
                {step === 'manual' ? 'Done' : 'Cancel'}
              </button>
            )}
            {step === 'pick' && (
              <button
                type="button"
                onClick={mode === 'auto' ? runPreview : startManual}
                disabled={loading || (mode === 'auto' && !date)}
                className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-ink px-4 py-1.5 text-sm font-medium text-white hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {mode === 'auto' ? 'Fetch shipments' : 'Open manual matcher'}
              </button>
            )}
            {step === 'review' && (
              <button
                type="button"
                onClick={runApply}
                disabled={loading || selectedMatches.length === 0}
                className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-ink px-4 py-1.5 text-sm font-medium text-white hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Apply {selectedMatches.length}{' '}
                {selectedMatches.length === 1 ? 'match' : 'matches'}
              </button>
            )}
            {step === 'manual' && (
              <button
                type="button"
                onClick={runLink}
                disabled={!canLink}
                className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-ink px-4 py-1.5 text-sm font-medium text-white hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {linking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4" />
                )}
                Link selected
              </button>
            )}
            {step === 'done' && (
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer rounded-lg bg-ink px-4 py-1.5 text-sm font-medium text-white hover:bg-ink/90"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
