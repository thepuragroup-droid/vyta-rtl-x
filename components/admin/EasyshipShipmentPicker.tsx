'use client';

/**
 * Pick the Easyship shipment an invoice should point at, replacing whatever
 * shipment record it carries now.
 *
 * For a parcel that had to be redone by hand in the Easyship dashboard: the
 * invoice still points at the old shipment, and the right one is somewhere in
 * the account's recent shipments. Every shipment in the window is listed with
 * what tells two parcels apart — recipient, where it goes, when it was made,
 * what it cost, the service, tracking and label state — and the operator
 * clicks the right one.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X,
  Loader2,
  RefreshCw,
  Search,
  AlertTriangle,
  CheckCircle2,
  Package,
  Tag,
  MapPin,
  Calendar,
  Truck,
  Link2,
  ExternalLink,
} from 'lucide-react';
import {
  listInvoiceShipmentCandidates,
  overrideInvoiceShipment,
  type EasyshipShipmentOption,
  type InvoiceShipmentCandidates,
  type InvoiceShipmentOverrideResult,
} from '@/lib/admin/invoices';

interface Props {
  open: boolean;
  invoiceId: string;
  invoiceNumber?: string | null;
  /** The invoice's customer, to flag the shipments addressed to them. */
  customerName?: string | null;
  onClose: () => void;
  onLinked: (result: InvoiceShipmentOverrideResult) => void | Promise<void>;
}

const LOOKBACK_OPTIONS = [7, 30, 90, 180];

function normalizeName(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/** Easyship can bill in any currency, so don't narrow it to CAD / USD. */
function formatPrice(amount: number | null | undefined, currency: string | null | undefined) {
  if (amount == null) return null;
  const code = (currency ?? 'CAD').toUpperCase();
  try {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
    }).format(amount) + ` ${code}`;
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function LabelStateChip({ state }: { state: EasyshipShipmentOption['label_state'] }) {
  const tone =
    state === 'generated'
      ? 'bg-emerald-500/10 text-emerald-700 border-emerald-200'
      : state === 'failed'
        ? 'bg-red-500/10 text-red-700 border-red-200'
        : state === 'pending'
          ? 'bg-amber-500/10 text-amber-700 border-amber-200'
          : 'bg-gray-500/10 text-ink-muted border-line';
  const text =
    state === 'generated'
      ? 'Label ready'
      : state === 'failed'
        ? 'Label failed'
        : state === 'pending'
          ? 'Label pending'
          : 'No label';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}
    >
      <Tag className="h-3 w-3" />
      {text}
    </span>
  );
}

function searchText(s: EasyshipShipmentOption): string {
  return [
    s.easyship_shipment_id,
    s.destination_name,
    s.destination_email,
    s.destination_company,
    s.destination_city,
    s.destination_state,
    s.destination_postal_code,
    s.destination_country,
    s.tracking_number,
    s.courier_name,
    s.service_name,
    s.platform_order_number,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export default function EasyshipShipmentPicker({
  open,
  invoiceId,
  invoiceNumber,
  customerName,
  onClose,
  onLinked,
}: Props) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<InvoiceShipmentCandidates | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [matchesOnly, setMatchesOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmShared, setConfirmShared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(
    async (lookback: number) => {
      setLoading(true);
      setLoadError(null);
      try {
        setData(await listInvoiceShipmentCandidates(invoiceId, lookback));
      } catch (e: any) {
        setLoadError(e?.message ?? 'Could not load Easyship shipments');
      } finally {
        setLoading(false);
      }
    },
    [invoiceId],
  );

  useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    setConfirmShared(false);
    setSaveError(null);
    setSearch('');
    load(days);
    // Reload on open only; the lookback select reloads on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoiceId]);

  const customerNorm = normalizeName(customerName);
  const isNameMatch = useCallback(
    (s: EasyshipShipmentOption) =>
      !!customerNorm && normalizeName(s.destination_name) === customerNorm,
    [customerNorm],
  );

  const visible = useMemo(() => {
    const rows = data?.shipments ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((s) => {
      if (matchesOnly && !isNameMatch(s)) return false;
      if (!q) return true;
      const hay = searchText(s);
      return q.split(/\s+/).every((t) => hay.includes(t));
    });
  }, [data, search, matchesOnly, isNameMatch]);

  const matchCount = useMemo(
    () => (data?.shipments ?? []).filter(isNameMatch).length,
    [data, isNameMatch],
  );

  const selected = data?.shipments.find((s) => s.easyship_shipment_id === selectedId) ?? null;
  const selectedOwner = selectedId ? data?.linked[selectedId] : undefined;
  const currentId = data?.current_shipment_id ?? null;
  const isCurrent = !!selectedId && selectedId === currentId;

  async function confirm() {
    if (!selected) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await overrideInvoiceShipment(invoiceId, selected.easyship_shipment_id, {
        allowShared: !!selectedOwner && confirmShared,
      });
      await onLinked(res);
    } catch (e: any) {
      setSaveError(e?.message ?? 'Could not link that shipment');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-teal/10 p-2">
              <Link2 className="h-5 w-5 text-teal-dark" />
            </div>
            <div>
              <h2 className="font-semibold text-ink">
                {currentId ? 'Override Easyship shipment' : 'Link an Easyship shipment'}
              </h2>
              <p className="text-xs text-ink-muted">
                {invoiceNumber ? `${invoiceNumber} · ` : ''}
                {currentId ? (
                  <>
                    Currently <span className="font-mono">{currentId}</span>
                  </>
                ) : (
                  'No shipment set yet'
                )}
                {data && ` · stored on the ${data.anchor === 'order' ? 'linked order' : 'invoice'}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} disabled={saving} className="text-ink-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-6 py-3">
          <div className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, city, tracking #, shipment ID…"
              className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
            />
          </div>
          <select
            value={days}
            onChange={(e) => {
              const d = Number(e.target.value);
              setDays(d);
              load(d);
            }}
            disabled={loading}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
          >
            {LOOKBACK_OPTIONS.map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </select>
          {customerNorm && (
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-ink">
              <input
                type="checkbox"
                checked={matchesOnly}
                onChange={(e) => setMatchesOnly(e.target.checked)}
              />
              Only “{customerName}” ({matchCount})
            </label>
          )}
          <button
            onClick={() => load(days)}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-2 text-xs text-ink-muted hover:text-ink disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && !data && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Fetching shipments from Easyship…
            </div>
          )}
          {loadError && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /> {loadError}
            </div>
          )}
          {data?.easyshipError && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /> Easyship:{' '}
              {data.easyshipError}
            </div>
          )}
          {data && !loading && (
            <p className="mb-2 text-xs text-ink-muted">
              {visible.length} of {data.fetched} shipment{data.fetched === 1 ? '' : 's'} since{' '}
              {new Date(data.since).toLocaleDateString()}
            </p>
          )}
          {data && visible.length === 0 && !loading && (
            <div className="py-10 text-center text-sm text-ink-muted">
              <Package className="mx-auto mb-2 h-6 w-6" />
              No shipments match. Try a longer window or clear the search.
            </div>
          )}

          <ul className="space-y-2">
            {visible.map((s) => {
              const sid = s.easyship_shipment_id;
              const owner = data?.linked[sid];
              const current = sid === currentId;
              const active = sid === selectedId;
              const price = formatPrice(s.total_charge, s.currency);
              const created = formatDate(s.created_at);
              const place = [
                s.destination_city,
                s.destination_state,
                s.destination_postal_code,
                s.destination_country,
              ]
                .filter(Boolean)
                .join(', ');
              return (
                <li key={sid}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(sid);
                      setConfirmShared(false);
                      setSaveError(null);
                    }}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      active
                        ? 'border-teal bg-teal/5 ring-2 ring-teal/30'
                        : 'border-line bg-white hover:bg-surface'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-ink">
                            {s.destination_name || 'Unnamed recipient'}
                          </span>
                          {s.destination_company && (
                            <span className="text-xs text-ink-muted">{s.destination_company}</span>
                          )}
                          {isNameMatch(s) && (
                            <span className="rounded-full border border-teal/30 bg-teal/10 px-2 py-0.5 text-[10px] font-medium text-teal-dark">
                              Matches customer
                            </span>
                          )}
                          {current && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                              <CheckCircle2 className="h-3 w-3" /> Current
                            </span>
                          )}
                          {owner && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                              <AlertTriangle className="h-3 w-3" />
                              On {owner.kind === 'order' ? 'order' : 'invoice'}{' '}
                              {owner.label ?? owner.id.slice(0, 8)}
                            </span>
                          )}
                        </div>
                        {s.destination_email && (
                          <p className="text-xs text-ink-muted">{s.destination_email}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-ink">{price ?? '—'}</p>
                        <LabelStateChip state={s.label_state} />
                      </div>
                    </div>

                    <div className="mt-2 grid gap-x-4 gap-y-1 text-xs text-ink-muted sm:grid-cols-2">
                      <span className="inline-flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
                        {created ?? 'Unknown date'}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                        {place || 'No destination'}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Truck className="h-3.5 w-3.5 flex-shrink-0" />
                        {[s.courier_name, s.service_name && s.service_name !== s.courier_name ? s.service_name : null]
                          .filter(Boolean)
                          .join(' · ') || 'No courier'}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Package className="h-3.5 w-3.5 flex-shrink-0" />
                        {[
                          s.item_count != null ? `${s.item_count} unit${s.item_count === 1 ? '' : 's'}` : null,
                          s.weight_kg != null ? `${Math.round(s.weight_kg * 100) / 100} kg` : null,
                          s.platform_order_number ? `ref ${s.platform_order_number}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                      <span className="font-mono text-ink-muted">{sid}</span>
                      {s.tracking_number && (
                        <span className="text-ink-muted">
                          Tracking <span className="font-mono text-ink">{s.tracking_number}</span>
                        </span>
                      )}
                      {s.status && <span className="capitalize text-ink-muted">{s.status.replace(/_/g, ' ')}</span>}
                      {s.label_url && (
                        <a
                          href={s.label_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-teal-dark hover:underline"
                        >
                          Label <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Footer */}
        <div className="space-y-2 border-t border-line bg-surface px-6 py-4">
          {selected && selectedOwner && (
            <label className="flex cursor-pointer items-start gap-2 text-xs text-amber-800">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={confirmShared}
                onChange={(e) => setConfirmShared(e.target.checked)}
              />
              This shipment is already attached to {selectedOwner.kind}{' '}
              {selectedOwner.label ?? selectedOwner.id}. Link it here as well anyway.
            </label>
          )}
          {selected && currentId && !isCurrent && (
            <p className="text-xs text-ink-muted">
              Replaces <span className="font-mono">{currentId}</span> — its tracking, label and cost
              are cleared and the picked shipment’s record is pulled from Easyship. Nothing is
              cancelled in Easyship.
            </p>
          )}
          {saveError && <p className="text-xs text-red-600">{saveError}</p>}
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-line px-4 py-2 text-sm text-ink-muted hover:text-ink disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={confirm}
              disabled={!selected || saving || (!!selectedOwner && !confirmShared)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-sm text-white hover:bg-ink/90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              {isCurrent
                ? 'Re-sync this shipment'
                : currentId
                  ? 'Use this shipment'
                  : 'Link this shipment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
