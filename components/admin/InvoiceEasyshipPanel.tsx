'use client';

/**
 * The Easyship side of an invoice, on the invoice detail page.
 *
 * Everything a shipment needs lives here, so a parcel can be set up and
 * followed without leaving the page:
 *
 *  - before a shipment exists: check live rates, pick the courier, choose the
 *    handover method and insurance, and create it (optionally buying the label
 *    in the same step);
 *  - once it exists: carrier, tracking and — the thing the warehouse actually
 *    needs — the label, with its state and print / download buttons.
 *
 * This used to be the invoice form's job, which meant editing an invoice and
 * ticking a checkbox to ship it. That is the wrong shape for a Stealth Health /
 * Stealth Health hand-off in particular: nothing about the invoice needs editing, the
 * address was never typed here, and the whole interaction is "book this parcel".
 *
 * The shipment may be anchored on the invoice's order or on the invoice itself
 * (a hand-off has no order row) — the routes behind this decide which, so this
 * component only ever talks about "the shipment".
 */
import React, { useState } from 'react';
import {
  Truck, Loader2, RefreshCw, Search, Download, Check, X, Tag, Link2, Printer,
  Repeat, AlertTriangle,
} from 'lucide-react';
import { openInvoiceLabel, printInvoiceLabel } from '@/lib/shipping/label-print';
import EasyshipShipmentPicker from '@/components/admin/EasyshipShipmentPicker';
import {
  shippingReadiness,
  createInvoiceShipment,
  buyInvoiceLabel,
  redoInvoiceShipment,
  type InvoiceTrackingSnapshot,
  type ShippingReadinessResult,
  type ShippingReadinessRate,
} from '@/lib/admin/invoices';
import {
  DEFAULT_COURIER_PREFERENCE,
  type CourierPreference,
} from '@/lib/shipping/courier-pick';

/** Where a server-resolved destination came from. An address Stealth Health reported
 *  and one typed into this admin must never read the same to whoever packs. */
const DESTINATION_SOURCE_LABEL: Record<string, string> = {
  order: 'from the linked order',
  puramass: 'reported by Stealth Health on the hosted checkout',
  client: 'from the drop-ship client',
  customer: 'from the customer profile',
};

/** Label state as a chip: the one thing the warehouse looks for. */
function LabelChip({ state }: { state: string | null }) {
  const tone =
    state === 'generated'
      ? 'bg-emerald-500/10 text-emerald-700 border-emerald-200'
      : state === 'failed' || state === 'cancelled'
        ? 'bg-red-500/10 text-red-700 border-red-200'
        : state === 'pending'
          ? 'bg-amber-500/10 text-amber-700 border-amber-200'
          : 'bg-gray-500/10 text-ink-muted border-line';
  const text =
    state === 'generated'
      ? 'Label ready'
      : state === 'failed'
        ? 'Label failed'
        : state === 'cancelled'
          ? 'Label cancelled'
        : state === 'pending'
          ? 'Label pending'
          : 'No label yet';
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${tone}`}
    >
      <Tag className="w-3 h-3" />
      {text}
    </span>
  );
}

interface Props {
  invoiceId: string;
  tracking: InvoiceTrackingSnapshot | null;
  /** Line quantities, so the rate quote weighs the same parcel as the label. */
  items: Array<{ qty: number }>;
  fulfillmentType: string | null;
  editable: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  /** Re-pull the tracking snapshot after a shipment or label changes. */
  onChanged: () => void | Promise<void>;
  /** Surface a message on the page's toast strip. */
  flash: (msg: string) => void;
  /** Shown in the shipment picker's header. */
  invoiceNumber?: string | null;
  /** Flags the picker's shipments addressed to this customer. */
  customerName?: string | null;
  /** The shipment was replaced by hand — the rest of the page may be stale. */
  onShipmentReplaced?: () => void;
}

export default function InvoiceEasyshipPanel({
  invoiceId,
  tracking,
  items,
  fulfillmentType,
  editable,
  refreshing,
  onRefresh,
  onChanged,
  flash,
  invoiceNumber,
  customerName,
  onShipmentReplaced,
}: Props) {
  // ---- Setup state (only meaningful before a shipment exists) ----
  const [readiness, setReadiness] = useState<ShippingReadinessResult | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [selectedRateId, setSelectedRateId] = useState<string | null>(null);
  const [courierPreference, setCourierPreference] =
    useState<CourierPreference>(DEFAULT_COURIER_PREFERENCE);
  const [handover, setHandover] =
    useState<'dropoff' | 'collection' | 'free_collection'>('dropoff');
  const [insured, setInsured] = useState(false);
  const [buyLabel, setBuyLabel] = useState(false);
  const [creating, setCreating] = useState(false);
  const [buyingLabel, setBuyingLabel] = useState(false);
  const [labelBusy, setLabelBusy] = useState<'print' | 'open' | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  // Easyship refused to cancel the current label; holds its reason until the
  // admin replaces it anyway or backs out.
  const [cancelBlocked, setCancelBlocked] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!tracking) return null;
  const isPickup = fulfillmentType === 'pickup';
  const t = tracking.tracking;
  const hasShipment = tracking.hasShipment;

  // The destination is resolved server-side from the invoice (linked order →
  // Stealth Health ledger → drop-ship client → customer profile), so this needs no
  // address of its own — which is the point for a hand-off.
  async function runReadiness() {
    setReadinessLoading(true);
    try {
      const res = await shippingReadiness({
        destination: {},
        invoice_id: invoiceId,
        items: items.map((li) => ({ qty: li.qty })),
      });
      setReadiness(res);
      if (res.ready && res.rates.length > 0 && !selectedRateId) {
        setSelectedRateId(res.rates[0].courier_id);
      }
    } catch (e: any) {
      setReadiness({
        ready: false,
        checks: [{ key: 'network', label: 'Rate quote failed', ok: false, detail: e?.message }],
        rates: [],
        ratesNote: null,
      });
    } finally {
      setReadinessLoading(false);
    }
  }

  /** A quoted service (`rate:<id>`) or a carrier preference (`pref:<name>`). */
  function selectCourierOption(value: string) {
    if (value.startsWith('rate:')) {
      setSelectedRateId(value.slice(5));
      return;
    }
    setSelectedRateId(null);
    setCourierPreference(value.slice(5) as CourierPreference);
  }

  async function createShipment() {
    setCreating(true);
    try {
      const res = await createInvoiceShipment(invoiceId, {
        courier_service_id: selectedRateId,
        courier_preference: selectedRateId ? null : courierPreference,
        insured,
        handover,
        buy_label: buyLabel,
      });
      if (res.shipment?.easyship_shipment_id) {
        flash(buyLabel ? 'Shipment created and label bought' : 'Shipment created');
        setSetupOpen(false);
        if (buyLabel && res.shipment.label_state === 'generated') {
          await printInvoiceLabel(invoiceId).catch((e) =>
            flash(e?.message ?? 'Label bought, but it could not be loaded to print'),
          );
        }
      } else {
        flash(
          res.shipment?.auto_shipment_error
            ? `Shipment not created: ${res.shipment.auto_shipment_error}`
            : (res.error ??
              'Shipment could not be created — check Easyship settings and the shipping address.'),
        );
      }
      await onChanged();
    } catch (e: any) {
      flash(e?.message ?? 'Failed to create shipment');
    } finally {
      setCreating(false);
    }
  }

  // Buy the label, then print it straight away when the PDF is ready.
  // Rebook on the courier picked in the form: cancel the current shipment
  // (refunding its label), then create the new one.
  async function redoShipment(replaceAnyway = false) {
    setCreating(true);
    try {
      const res = await redoInvoiceShipment(invoiceId, {
        courier_service_id: selectedRateId,
        courier_preference: selectedRateId ? null : courierPreference,
        insured,
        handover,
        buy_label: buyLabel,
        replace_anyway: replaceAnyway,
      });
      if (res.cancel_failed) {
        setCancelBlocked(res.error ?? 'Easyship would not cancel the current label.');
        return;
      }
      setCancelBlocked(null);
      const created = !!res.shipment?.easyship_shipment_id;
      if (!created) {
        flash(
          res.shipment?.auto_shipment_error
            ? `Old shipment cancelled, but the new one failed: ${res.shipment.auto_shipment_error}`
            : 'Old shipment cancelled, but the new one could not be created — create it again below.',
        );
      } else {
        const parts = [
          `Rebooked with ${res.shipment?.carrier ?? 'the new courier'}`,
          res.previous_cancelled === false ? 'old label NOT refunded — cancel it in Easyship' : null,
          res.shipped_email_was_sent ? 'the customer has the old tracking — resend the shipped email' : null,
        ].filter(Boolean);
        flash(parts.join(' · '));
        setSetupOpen(false);
        if (buyLabel && res.shipment?.label_state === 'generated') {
          await printInvoiceLabel(invoiceId).catch((e) =>
            flash(e?.message ?? 'Label bought, but it could not be loaded to print'),
          );
        }
      }
      await onChanged();
      onShipmentReplaced?.();
    } catch (e: any) {
      flash(e?.message ?? 'Failed to redo the shipment');
    } finally {
      setCreating(false);
    }
  }

  function openSetup() {
    setSetupOpen(true);
    setCancelBlocked(null);
    if (!readiness) runReadiness();
  }

  function closeSetup() {
    setSetupOpen(false);
    setCancelBlocked(null);
  }

  async function purchaseLabel() {
    setBuyingLabel(true);
    try {
      const res = await buyInvoiceLabel(invoiceId);
      if (res.label?.state === 'generated') {
        flash('Label bought — opening the print dialog');
        await printInvoiceLabel(invoiceId).catch((e) =>
          flash(e?.message ?? 'Label bought, but it could not be loaded to print'),
        );
      } else {
        flash(
          res.label?.state === 'pending'
            ? 'Label bought — Easyship is still generating the PDF'
            : (res.error ?? 'Label purchase failed'),
        );
      }
      await onChanged();
    } catch (e: any) {
      flash(e?.message ?? 'Label purchase failed');
    } finally {
      setBuyingLabel(false);
    }
  }

  async function labelAction(kind: 'print' | 'open') {
    setLabelBusy(kind);
    try {
      if (kind === 'print') await printInvoiceLabel(invoiceId);
      else await openInvoiceLabel(invoiceId);
    } catch (e: any) {
      flash(e?.message ?? 'Could not load the label');
    } finally {
      setLabelBusy(null);
    }
  }

  const rateOptionValue = selectedRateId
    ? `rate:${selectedRateId}`
    : `pref:${courierPreference}`;

  return (
    <div className="bg-white rounded-xl border border-line p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-ink text-sm flex items-center gap-2">
          {isPickup ? (
            <><Truck className="w-4 h-4 text-ink-muted" /> Pickup</>
          ) : (
            <><Truck className="w-4 h-4 text-ink-muted" /> Shipping</>
          )}
        </h2>
        {hasShipment && editable && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="text-xs text-ink-muted hover:text-ink disabled:opacity-50 inline-flex items-center gap-1"
            title="Refresh live tracking from Easyship"
          >
            {refreshing
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />}
            Check for live updates
          </button>
        )}
      </div>

      {/* ---- Label: the thing the warehouse actually needs ---- */}
      {hasShipment && !isPickup && (
        <div className="mb-3 rounded-lg border border-line bg-surface p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <LabelChip state={t?.label_state ?? null} />
            {t?.carrier && (
              <span className="text-[11px] text-ink-muted truncate">{t.carrier}</span>
            )}
          </div>
          {t?.label_url ? (
            <div className="flex gap-2">
              <button
                onClick={() => labelAction('print')}
                disabled={labelBusy !== null}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-teal-dark px-2.5 py-1.5 text-xs font-medium text-white hover:bg-teal-dark/90 disabled:opacity-50"
              >
                {labelBusy === 'print'
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Printer className="w-3.5 h-3.5" />}
                Print label
              </button>
              <button
                onClick={() => labelAction('open')}
                disabled={labelBusy !== null}
                title="Open the label in a new tab to save or reprint"
                className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs text-teal-dark hover:border-teal disabled:opacity-50"
              >
                {labelBusy === 'open'
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Download className="w-3.5 h-3.5" />}
                PDF
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-[11px] text-ink-muted">
                {t?.label_state === 'pending'
                  ? 'Easyship is still generating the label PDF — refresh in a moment.'
                  : 'The shipment is a draft. Buying the label charges the Easyship wallet.'}
              </p>
              {editable && t?.label_state !== 'pending' && (
                <button
                  onClick={purchaseLabel}
                  disabled={buyingLabel}
                  className="inline-flex items-center gap-1.5 rounded-md border border-teal px-2.5 py-1.5 text-xs text-teal-dark hover:bg-teal/5 disabled:opacity-50"
                >
                  {buyingLabel
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Printer className="w-3.5 h-3.5" />}
                  Buy &amp; print label
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---- Last auto-shipment attempt (success, skip reason, or failure) ---- */}
      {t?.auto_shipment && (() => {
        const as = t.auto_shipment;
        const attempted = as.attempted_at ? new Date(as.attempted_at).toLocaleString() : null;
        const bg =
          as.status === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
          as.status === 'failed'  ? 'bg-red-50 border-red-200 text-red-800' :
                                    'bg-amber-50 border-amber-200 text-amber-800';
        const label =
          as.status === 'success' ? 'Shipment created' :
          as.status === 'failed'  ? 'Shipment failed' :
          as.status === 'skipped' ? 'Shipment skipped' :
                                    `Shipment: ${as.status}`;
        return (
          <div className={`mb-2 px-2.5 py-1.5 rounded-lg border text-[11px] ${bg}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{label}</span>
              {as.stage && <span className="opacity-70">stage: {as.stage}</span>}
            </div>
            {as.error && <div className="mt-0.5 opacity-90 break-words">{as.error}</div>}
            {attempted && <div className="mt-0.5 opacity-60">at {attempted}</div>}
          </div>
        );
      })()}

      {/* ---- Order + tracking detail ---- */}
      {(tracking.hasOrder || t) && (
        <div className="space-y-2 text-sm">
          {tracking.order_number && (
            <div className="flex justify-between">
              <span className="text-ink-muted">Order</span>
              <span className="font-mono text-ink">{tracking.order_number}</span>
            </div>
          )}
          {tracking.order_status && (
            <div className="flex justify-between">
              <span className="text-ink-muted">Order Status</span>
              <span className="capitalize text-ink">{tracking.order_status}</span>
            </div>
          )}
          {t?.status && (
            <div className="flex justify-between">
              <span className="text-ink-muted">Tracking Status</span>
              <span className="text-ink">{t.status}</span>
            </div>
          )}
          {t?.number && (
            <div className="flex justify-between">
              <span className="text-ink-muted">Tracking #</span>
              <span className="font-mono text-xs text-ink truncate max-w-[10rem]">{t.number}</span>
            </div>
          )}
          {t?.record?.service && (
            <div className="flex justify-between gap-2">
              <span className="text-ink-muted">Service</span>
              <span className="text-ink text-right">{t.record.service}</span>
            </div>
          )}
          {t?.record?.label_cost != null && (
            <div className="flex justify-between">
              <span className="text-ink-muted">Label cost</span>
              <span className="text-ink">
                ${t.record.label_cost.toFixed(2)} {t.record.label_currency ?? ''}
              </span>
            </div>
          )}
          {(t?.record?.est_delivery_min_days || t?.record?.est_delivery_max_days) && (
            <div className="flex justify-between">
              <span className="text-ink-muted">Est. transit</span>
              <span className="text-ink">
                {(() => {
                  const min = t.record!.est_delivery_min_days;
                  const max = t.record!.est_delivery_max_days;
                  const days = min && max && min !== max ? `${min}–${max}` : `${max ?? min}`;
                  return `${days} business day${days === '1' ? '' : 's'}`;
                })()}
              </span>
            </div>
          )}
          {t?.record?.label_generated_at && (
            <div className="flex justify-between">
              <span className="text-ink-muted">Label generated</span>
              <span className="text-ink">{new Date(t.record.label_generated_at).toLocaleString()}</span>
            </div>
          )}
          {t?.label_state === 'generated' && t?.record && (
            <div className="flex justify-between">
              <span className="text-ink-muted">Shipped email</span>
              <span className={t.record.shipped_emailed_at ? 'text-emerald-700' : 'text-amber-600'}>
                {t.record.shipped_emailed_at
                  ? `Sent ${new Date(t.record.shipped_emailed_at).toLocaleString()}`
                  : 'Not sent yet'}
              </span>
            </div>
          )}
          {t?.url && (
            <a
              href={t.url}
              target="_blank"
              rel="noreferrer"
              className="inline-block mt-1 text-xs text-teal-dark hover:text-teal-dark/80"
            >
              Track shipment →
            </a>
          )}
          {t?.refresh_error && (
            <p className="mt-2 text-xs text-amber-600">Live refresh: {t.refresh_error}</p>
          )}
        </div>
      )}

      {/* ---- Set up a shipment in place — or redo one on a new courier ---- */}
      {!hasShipment && !isPickup && editable && !setupOpen && (
        <div className="mt-1">
          <button
            onClick={openSetup}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-teal px-3 py-2 text-sm text-teal-dark hover:bg-teal/5"
          >
            <Truck className="w-4 h-4" /> Create Easyship shipment
          </button>
        </div>
      )}
      {!isPickup && editable && setupOpen && (
        <div className={hasShipment ? 'mt-4 pt-4 border-t border-line' : 'mt-1'}>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                {hasShipment ? 'Redo with a new courier' : 'New shipment'}
              </p>
              <button
                onClick={runReadiness}
                disabled={readinessLoading}
                className="text-xs text-ink-muted hover:text-ink disabled:opacity-50 inline-flex items-center gap-1"
              >
                {readinessLoading
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Search className="w-3.5 h-3.5" />}
                Check rates
              </button>
            </div>

            {hasShipment && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 space-y-1">
                <p>
                  {t?.label_state === 'generated' || t?.label_state === 'pending' ? (
                    <>
                      The current {t?.carrier ? <span className="font-semibold">{t.carrier}</span> : ''} label
                      {t?.record?.label_cost != null && (
                        <> (${t.record.label_cost.toFixed(2)} {t.record.label_currency ?? ''})</>
                      )}{' '}
                      is cancelled in Easyship and refunded to the wallet — only possible
                      before the parcel is in transit.
                    </>
                  ) : (
                    <>The current draft shipment is cancelled in Easyship and a new one is booked.</>
                  )}
                </p>
                {t?.record?.shipped_emailed_at && (
                  <p>The customer already has the old tracking number — resend the shipped email afterwards.</p>
                )}
              </div>
            )}

            {readinessLoading && !readiness && (
              <p className="text-xs text-ink-muted">Checking origin, destination and live rates…</p>
            )}

            {readiness && (
              <ul className="space-y-1">
                {readiness.checks.map((c) => (
                  <li key={c.key} className="flex items-start gap-2 text-xs">
                    {c.ok ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                    ) : (
                      <X className="w-3.5 h-3.5 text-red-500 mt-0.5 flex-shrink-0" />
                    )}
                    <span className={c.ok ? 'text-ink' : 'text-red-700'}>
                      {c.label}
                      {c.detail && !c.ok && (
                        <span className="block text-[11px] text-ink-muted mt-0.5">{c.detail}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {readiness?.destination && readiness.destination_source && (
              <p className="text-[11px] text-ink-muted">
                Shipping to{' '}
                <span className="text-ink">
                  {[
                    readiness.destination.city,
                    readiness.destination.state,
                    readiness.destination.postal_code,
                    readiness.destination.country,
                  ].filter(Boolean).join(', ')}
                </span>{' '}
                — {DESTINATION_SOURCE_LABEL[readiness.destination_source]}.
              </p>
            )}

            {/* Courier: a quoted service, or a carrier the server re-quotes
                for at creation when no rates were fetched. */}
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1.5">
                Courier
              </label>
              <select
                value={rateOptionValue}
                onChange={(e) => selectCourierOption(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-xs text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
              >
                <option value="pref:best_value">Best value — cheapest UPS / Canada Post within 2 days</option>
                <option value="pref:ups">UPS — best-value UPS service</option>
                <option value="pref:canada_post">Canada Post — best-value Canada Post service</option>
                {readiness && readiness.rates.length > 0 && (
                  <optgroup label="Quoted services">
                    {readiness.rates.map((r: ShippingReadinessRate) => (
                      <option key={r.courier_id} value={`rate:${r.courier_id}`}>
                        {r.courier_name} · {r.service_name} — ${r.total_charge.toFixed(2)}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {readiness?.ratesNote && (
                <p className="mt-1 text-[11px] text-amber-600">{readiness.ratesNote}</p>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1.5">
                Handover
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { v: 'dropoff', l: 'Drop off' },
                  { v: 'collection', l: 'Collection' },
                  { v: 'free_collection', l: 'Free pickup' },
                ].map((h) => (
                  <button
                    key={h.v}
                    type="button"
                    onClick={() => setHandover(h.v as any)}
                    className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      handover === h.v
                        ? 'bg-ink text-white border-ink'
                        : 'bg-surface text-ink-muted border-line hover:text-ink'
                    }`}
                  >
                    {h.l}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={insured} onChange={(e) => setInsured(e.target.checked)} />
              <span className="text-ink">Insure this shipment</span>
            </label>

            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={buyLabel} onChange={(e) => setBuyLabel(e.target.checked)} />
              <span className="text-ink">Buy &amp; print label now</span>
              <span className="text-[10px] text-amber-600">Charges Easyship wallet</span>
            </label>

            {cancelBlocked && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800 space-y-2">
                <p className="flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
                  <span>{cancelBlocked}</span>
                </p>
                <button
                  onClick={() => {
                    if (window.confirm('Book the new shipment anyway? The old label stays charged until it is cancelled in Easyship.')) {
                      redoShipment(true);
                    }
                  }}
                  disabled={creating}
                  className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                >
                  Replace anyway — old label not refunded
                </button>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => (hasShipment ? redoShipment() : createShipment())}
                disabled={creating}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-sm text-white hover:bg-ink/90 disabled:opacity-50"
              >
                {creating
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : hasShipment ? <Repeat className="w-4 h-4" /> : <Truck className="w-4 h-4" />}
                {hasShipment ? 'Cancel old & rebook' : 'Create shipment'}
              </button>
              <button
                onClick={closeSetup}
                disabled={creating}
                className="rounded-lg border border-line px-3 py-2 text-sm text-ink-muted hover:text-ink disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {!hasShipment && !isPickup && !editable && (
        <p className="text-sm text-ink-muted">Not shipped yet.</p>
      )}

      {/* ---- Redo on a new courier, or point at a different Easyship shipment ---- */}
      {!isPickup && editable && !setupOpen && (
        <div className={`mt-3 grid gap-2 ${hasShipment ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {hasShipment && (
            <button
              onClick={openSetup}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs text-ink-muted hover:text-ink hover:bg-surface"
              title="Cancel this shipment (refunding its label) and rebook it with a different courier"
            >
              <Repeat className="w-3.5 h-3.5" /> Change courier…
            </button>
          )}
          <button
            onClick={() => setPickerOpen(true)}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs text-ink-muted hover:text-ink hover:bg-surface"
            title="Pick the right shipment from your Easyship account"
          >
            <Link2 className="w-3.5 h-3.5" />
            {hasShipment ? 'Override shipment…' : 'Link existing Easyship shipment…'}
          </button>
        </div>
      )}

      <EasyshipShipmentPicker
        open={pickerOpen}
        invoiceId={invoiceId}
        invoiceNumber={invoiceNumber}
        customerName={customerName}
        onClose={() => setPickerOpen(false)}
        onLinked={async (res) => {
          setPickerOpen(false);
          const email =
            res.email === 'sent' ? ' — shipped email sent to the customer' : '';
          flash(
            res.previous_shipment_id && res.previous_shipment_id !== res.easyship_shipment_id
              ? `Shipment replaced with ${res.easyship_shipment_id}${email}`
              : `Shipment ${res.easyship_shipment_id} linked${email}`,
          );
          await onChanged();
          onShipmentReplaced?.();
        }}
      />
    </div>
  );
}
