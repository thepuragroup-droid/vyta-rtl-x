'use client';

/**
 * Settlement invoices raised against Stealth Health: the list, and the dialog
 * that creates one from a period of unbilled paid hand-offs.
 *
 * Creation always previews first — it reads back exactly which orders would be
 * billed and what they come to before anything is written, because raising an
 * invoice claims those orders and a mistake means voiding it.
 */
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  FileText, Loader2, Plus, X, ExternalLink, AlertTriangle, Trash2,
} from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import type { Currency } from '@/lib/currency';
import type { SettlementTotals } from '@/lib/admin/stealth-health';
import {
  listSettlementInvoices,
  createSettlementInvoice,
  deleteSettlementInvoice,
  listSettlementOrders,
  type SettlementInvoiceDTO,
} from '@/lib/admin/stealth-health-client';
import { money, fmtInt, fmtDate, StatusBadge, EmptyState, MoneyRow } from './ui';

function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** First and last day of the previous calendar month — the usual billing period. */
function lastMonth(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  return { start: isoDay(start), end: isoDay(end) };
}

export default function InvoicesTab({ isAdmin, currency, onChanged, uninvoicedCents, migrated }: {
  isAdmin: boolean;
  currency: Currency;
  onChanged: () => void;
  uninvoicedCents: number;
  migrated: boolean;
}) {
  const toast = useToast();
  const [invoices, setInvoices] = useState<SettlementInvoiceDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listSettlementInvoices({ pageSize: 50 });
      setInvoices(r.invoices ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load settlement invoices');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const onDelete = async (inv: SettlementInvoiceDTO) => {
    if (!confirm(`Delete draft ${inv.invoice_number}? Its ${inv.order_count} orders go back to unbilled.`)) return;
    setDeletingId(inv.id);
    try {
      await deleteSettlementInvoice(inv.id);
      toast.success(`${inv.invoice_number} deleted`);
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the invoice');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-sm text-ink-muted">
          {uninvoicedCents > 0
            ? <>Earned but not yet billed: <span className="font-semibold text-ink">{money(uninvoicedCents, currency)}</span></>
            : 'Everything earned has been billed.'}
        </p>
        {isAdmin && (
          <button onClick={() => setCreating(true)} disabled={!migrated}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-bronze text-white rounded-lg text-sm font-medium hover:bg-bronze/90 disabled:opacity-50"
            title={migrated ? undefined : 'Run the settlement migration first'}>
            <Plus className="w-4 h-4" /> New settlement invoice
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-ink-muted" />
        </div>
      ) : invoices.length === 0 ? (
        <EmptyState message="No settlement invoices yet. Create one to bill Stealth Health for the paid orders they are holding money for." />
      ) : (
        <div className="bg-white rounded-xl border border-line overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface text-[10px] uppercase tracking-wider text-ink-muted">
                <tr>
                  <th className="text-left font-semibold px-4 py-2.5">Invoice</th>
                  <th className="text-left font-semibold px-4 py-2.5">Period</th>
                  <th className="text-right font-semibold px-4 py-2.5">Orders</th>
                  <th className="text-right font-semibold px-4 py-2.5">Amount due</th>
                  <th className="text-right font-semibold px-4 py-2.5">Paid</th>
                  <th className="text-right font-semibold px-4 py-2.5">Balance</th>
                  <th className="text-left font-semibold px-4 py-2.5">Due</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-surface/60">
                    <td className="px-4 py-3">
                      <Link href={`/admin/stealth-health/invoices/${inv.id}`}
                        className="inline-flex items-center gap-2 font-medium text-ink hover:text-bronze">
                        {inv.invoice_number} <StatusBadge status={inv.status} />
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-ink-muted text-xs whitespace-nowrap">
                      {inv.period_start || inv.period_end
                        ? `${fmtDate(inv.period_start)} – ${fmtDate(inv.period_end)}`
                        : 'All unbilled'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-muted">{fmtInt(inv.order_count)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-ink">
                      {money(inv.amount_due_cents, inv.currency)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-700">
                      {inv.paid_cents > 0 ? money(inv.paid_cents, inv.currency) : '—'}
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums ${inv.balance_cents > 0 ? 'text-amber-700 font-medium' : 'text-ink-muted'}`}>
                      {money(inv.balance_cents, inv.currency)}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-muted whitespace-nowrap">{fmtDate(inv.due_date)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Link href={`/admin/stealth-health/invoices/${inv.id}`}
                        className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-bronze">
                        Open <ExternalLink className="w-3 h-3" />
                      </Link>
                      {isAdmin && inv.status === 'draft' && (
                        <button onClick={() => onDelete(inv)} disabled={deletingId === inv.id}
                          className="ml-3 inline-flex items-center text-xs text-rose-600 hover:text-rose-700 disabled:opacity-50"
                          title="Delete this draft">
                          {deletingId === inv.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {creating && (
        <CreateInvoiceDialog
          currency={currency}
          onClose={() => setCreating(false)}
          onCreated={async () => { setCreating(false); await load(); onChanged(); }}
        />
      )}
    </>
  );
}

function CreateInvoiceDialog({ currency, onClose, onCreated }: {
  currency: Currency;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const preset = lastMonth();
  const [periodStart, setPeriodStart] = useState(preset.start);
  const [periodEnd, setPeriodEnd] = useState(preset.end);
  const [issueDate, setIssueDate] = useState(isoDay(new Date()));
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState<{ totals: SettlementTotals; matched: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Re-preview whenever the period changes, so the numbers on screen always
  // describe the invoice the button would actually create.
  useEffect(() => {
    let cancelled = false;
    setPreviewing(true);
    listSettlementOrders({ from: periodStart || null, to: periodEnd || null, unbilledOnly: true, limit: 1 })
      .then((r) => { if (!cancelled) setPreview({ totals: r.totals, matched: r.matched }); })
      .catch(() => { if (!cancelled) setPreview(null); })
      .finally(() => { if (!cancelled) setPreviewing(false); });
    return () => { cancelled = true; };
  }, [periodStart, periodEnd]);

  const invalidRange = Boolean(periodStart && periodEnd && periodStart > periodEnd);
  const nothingToBill = !previewing && (preview?.totals.order_count ?? 0) === 0;

  const submit = async () => {
    setSaving(true);
    try {
      const r = await createSettlementInvoice({
        period_start: periodStart || null,
        period_end: periodEnd || null,
        issue_date: issueDate || null,
        notes: notes.trim() || null,
      });
      toast.success(`${r.invoice.invoice_number} created as a draft`);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the invoice');
    } finally {
      setSaving(false);
    }
  };

  const t = preview?.totals;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-line w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line sticky top-0 bg-white">
          <h3 className="text-base font-bold text-ink flex items-center gap-2">
            <FileText className="w-4 h-4 text-bronze" /> New settlement invoice
          </h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-ink-muted leading-relaxed">
            Bills every paid Stealth Health hand-off in this period that isn’t already on an invoice.
            Those orders are stamped with the new invoice, so they can never be billed twice.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Period start">
              <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)}
                className="w-full px-3 py-2 border border-line rounded-lg text-sm" />
            </Field>
            <Field label="Period end">
              <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)}
                className="w-full px-3 py-2 border border-line rounded-lg text-sm" />
            </Field>
          </div>
          <p className="text-[11px] text-ink-muted -mt-2">
            Leave both blank to bill every unbilled paid order, whenever it landed.
          </p>

          <Field label="Issue date">
            <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)}
              className="w-full px-3 py-2 border border-line rounded-lg text-sm" />
          </Field>

          <Field label="Notes (optional)">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              placeholder="Reference, remittance instructions…"
              className="w-full px-3 py-2 border border-line rounded-lg text-sm resize-none" />
          </Field>

          {invalidRange && (
            <p className="text-xs text-rose-600 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> The start date is after the end date.
            </p>
          )}

          {/* Live preview of exactly what will be billed. */}
          <div className="rounded-xl border border-line bg-surface/50 p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">This invoice will bill</h4>
              {previewing && <Loader2 className="w-3.5 h-3.5 animate-spin text-ink-muted" />}
            </div>
            {t && t.order_count > 0 ? (
              <>
                <p className="text-xs text-ink-muted mb-1">
                  {fmtInt(t.order_count)} paid order{t.order_count === 1 ? '' : 's'} · {fmtInt(t.units)} unit{t.units === 1 ? '' : 's'}
                </p>
                <MoneyRow label="Goods collected" cents={t.gross_cents} currency={currency} />
                {t.refunds_cents > 0 && <MoneyRow label="Refunded" cents={t.refunds_cents} currency={currency} sign="−" />}
                {t.shipping_cents > 0 && <MoneyRow label="Shipment fees" cents={t.shipping_cents} currency={currency} sign="+" />}
                {t.fee_cents > 0 && <MoneyRow label="Their cut" cents={t.fee_cents} currency={currency} sign="−" />}
                <MoneyRow label="Amount due from Stealth Health" cents={t.due_cents} currency={currency} strong />
              </>
            ) : (
              <p className="text-xs text-ink-muted py-2">
                {previewing ? 'Checking…' : 'No unbilled paid orders in this period.'}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-line sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-4 py-2 text-sm text-ink-muted hover:text-ink">Cancel</button>
          <button onClick={submit} disabled={saving || invalidRange || nothingToBill}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-bronze text-white rounded-lg text-sm font-medium hover:bg-bronze/90 disabled:opacity-50">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Create draft{t && t.due_cents > 0 ? ` · ${money(t.due_cents, currency)}` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-ink-muted font-semibold mb-1">{label}</span>
      {children}
    </label>
  );
}
