'use client';

/**
 * What Stealth Health has actually remitted to us.
 *
 * A payout can settle a specific invoice or be recorded on account — either
 * way it counts against the balance owed, which is why the "they owe us" figure
 * on the dashboard is earned minus payouts rather than invoiced minus payouts.
 * Applying one to a draft invoice also moves that invoice to `sent`: if they
 * have paid it, it plainly went out.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Wallet, Loader2, Plus, X, Trash2, Link2 } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import type { Currency } from '@/lib/currency';
import { toCents } from '@/lib/admin/stealth-health';
import {
  listSettlementPayouts,
  recordSettlementPayout,
  deleteSettlementPayout,
  listSettlementInvoices,
  type SettlementPayoutDTO,
  type SettlementInvoiceDTO,
} from '@/lib/admin/stealth-health-client';
import { money, fmtDate, EmptyState } from './ui';

const METHODS = ['Wire', 'e-Transfer', 'Crypto', 'Cheque', 'Other'];

export default function PayoutsTab({ isAdmin, currency, onChanged, migrated }: {
  isAdmin: boolean;
  currency: Currency;
  onChanged: () => void;
  migrated: boolean;
}) {
  const toast = useToast();
  const [payouts, setPayouts] = useState<SettlementPayoutDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listSettlementPayouts({ pageSize: 50 });
      setPayouts(r.payouts ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load payouts');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const total = payouts.reduce((s, p) => s + p.amount_cents, 0);

  const onDelete = async (p: SettlementPayoutDTO) => {
    if (!confirm(`Remove the ${money(p.amount_cents, p.currency)} payout from ${fmtDate(p.received_at)}? The balance owed goes back up.`)) return;
    setDeletingId(p.id);
    try {
      await deleteSettlementPayout(p.id);
      toast.success('Payout removed');
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove the payout');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-sm text-ink-muted">
          {payouts.length > 0
            ? <>Showing the {payouts.length} most recent payouts · <span className="font-semibold text-ink">{money(total, currency)}</span> received</>
            : 'Nothing recorded as received from Stealth Health yet.'}
        </p>
        {isAdmin && (
          <button onClick={() => setRecording(true)} disabled={!migrated}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-dark text-white rounded-lg text-sm font-medium hover:bg-teal/90 disabled:opacity-50"
            title={migrated ? undefined : 'Run the settlement migration first'}>
            <Plus className="w-4 h-4" /> Record a payout
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-ink-muted" />
        </div>
      ) : payouts.length === 0 ? (
        <EmptyState message="When Stealth Health remits money to you, record it here — it comes straight off what they owe." />
      ) : (
        <div className="bg-white rounded-xl border border-line overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface text-[10px] uppercase tracking-wider text-ink-muted">
                <tr>
                  <th className="text-left font-semibold px-4 py-2.5">Received</th>
                  <th className="text-right font-semibold px-4 py-2.5">Amount</th>
                  <th className="text-left font-semibold px-4 py-2.5">Applied to</th>
                  <th className="text-left font-semibold px-4 py-2.5">Method</th>
                  <th className="text-left font-semibold px-4 py-2.5">Reference</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {payouts.map((p) => (
                  <tr key={p.id} className="hover:bg-surface/60">
                    <td className="px-4 py-3 whitespace-nowrap text-ink">{fmtDate(p.received_at)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-700">
                      {money(p.amount_cents, p.currency)}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {p.invoice_number ? (
                        <span className="inline-flex items-center gap-1 text-ink">
                          <Link2 className="w-3 h-3 text-ink-muted" /> {p.invoice_number}
                        </span>
                      ) : (
                        <span className="text-ink-muted">On account</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-muted">{p.method ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-ink-muted truncate max-w-[16rem]" title={p.notes ?? undefined}>
                      {p.reference ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isAdmin && (
                        <button onClick={() => onDelete(p)} disabled={deletingId === p.id}
                          className="text-rose-600 hover:text-rose-700 disabled:opacity-50" title="Remove this payout">
                          {deletingId === p.id
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

      {recording && (
        <RecordPayoutDialog
          currency={currency}
          onClose={() => setRecording(false)}
          onSaved={async () => { setRecording(false); await load(); onChanged(); }}
        />
      )}
    </>
  );
}

function RecordPayoutDialog({ currency, onClose, onSaved }: {
  currency: Currency;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceId, setInvoiceId] = useState('');
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [invoices, setInvoices] = useState<SettlementInvoiceDTO[]>([]);
  const [saving, setSaving] = useState(false);

  // Offer the invoices that still have a balance, so applying a payout is a
  // pick rather than a lookup.
  useEffect(() => {
    listSettlementInvoices({ pageSize: 50 })
      .then((r) => setInvoices((r.invoices ?? []).filter((i) => i.status !== 'void' && i.balance_cents > 0)))
      .catch(() => setInvoices([]));
  }, []);

  const chosen = invoices.find((i) => i.id === invoiceId) ?? null;
  const cents = toCents(amount);
  const overpaying = chosen != null && cents > chosen.balance_cents;

  const submit = async () => {
    if (cents <= 0) {
      toast.error('Enter an amount greater than zero');
      return;
    }
    setSaving(true);
    try {
      await recordSettlementPayout({
        amount_cents: cents,
        invoice_id: invoiceId || null,
        currency,
        received_at: receivedAt,
        method: method || null,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
      });
      toast.success(`${money(cents, currency)} recorded`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record the payout');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-line w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line sticky top-0 bg-white">
          <h3 className="text-base font-bold text-ink flex items-center gap-2">
            <Wallet className="w-4 h-4 text-teal-dark" /> Record a payout
          </h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Amount (${currency})`}>
              <input type="number" min="0" step="0.01" value={amount} inputMode="decimal"
                onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
                className="w-full px-3 py-2 border border-line rounded-lg text-sm tabular-nums" />
            </Field>
            <Field label="Received on">
              <input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)}
                className="w-full px-3 py-2 border border-line rounded-lg text-sm" />
            </Field>
          </div>

          <Field label="Apply to invoice">
            <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}
              className="w-full px-3 py-2 border border-line rounded-lg text-sm bg-white">
              <option value="">On account (no specific invoice)</option>
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.invoice_number} — {money(i.balance_cents, i.currency)} outstanding
                </option>
              ))}
            </select>
          </Field>
          {overpaying && chosen && (
            <p className="text-[11px] text-amber-700 -mt-2">
              That is more than the {money(chosen.balance_cents, chosen.currency)} outstanding on {chosen.invoice_number}.
              It will still be recorded — the surplus counts against the overall balance.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Method">
              <select value={method} onChange={(e) => setMethod(e.target.value)}
                className="w-full px-3 py-2 border border-line rounded-lg text-sm bg-white">
                <option value="">—</option>
                {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Reference">
              <input value={reference} onChange={(e) => setReference(e.target.value)}
                placeholder="Their remittance ref"
                className="w-full px-3 py-2 border border-line rounded-lg text-sm" />
            </Field>
          </div>

          <Field label="Notes (optional)">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              className="w-full px-3 py-2 border border-line rounded-lg text-sm resize-none" />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-line sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-4 py-2 text-sm text-ink-muted hover:text-ink">Cancel</button>
          <button onClick={submit} disabled={saving || cents <= 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-dark text-white rounded-lg text-sm font-medium hover:bg-teal/90 disabled:opacity-50">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Record payout
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
