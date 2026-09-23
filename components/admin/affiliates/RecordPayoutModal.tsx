'use client';

import React, { useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { PAYOUT_METHODS } from '@/lib/affiliate/payouts';
import { adminFetch, fmtMoney } from './api';

export interface PayableCommission {
  id: string;
  amount: number;
  order_total: number;
  created_at: string;
  reference: string;
  discount_code: string | null;
}

const inputCls =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-teal focus:outline-none';
const labelCls = 'mb-1 block text-xs font-medium text-ink';

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Record money sent to an affiliate. The pending commissions ticked here are
 * marked paid and linked to the payout; the amount defaults to their sum but
 * is what was actually sent, so it can be edited (a bonus, a partial payment).
 */
export default function RecordPayoutModal({
  affiliateId,
  affiliateName,
  pending,
  balance,
  onClose,
  onSaved,
}: {
  affiliateId: string;
  affiliateName: string;
  pending: PayableCommission[];
  balance: number;
  onClose: () => void;
  onSaved: (settled: number) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(pending.map((c) => c.id)));
  const selectedTotal = useMemo(
    () =>
      Math.round(pending.filter((c) => selected.has(c.id)).reduce((s, c) => s + c.amount, 0) * 100) / 100,
    [pending, selected],
  );
  const [amount, setAmount] = useState(() => (selectedTotal > 0 ? selectedTotal : Math.max(0, balance)).toFixed(2));
  const [amountTouched, setAmountTouched] = useState(false);
  const [method, setMethod] = useState<string>('e_transfer');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState(todayLocal());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (!amountTouched) {
        const sum = pending.filter((c) => next.has(c.id)).reduce((s, c) => s + c.amount, 0);
        setAmount((Math.round(sum * 100) / 100).toFixed(2));
      }
      return next;
    });
  };

  const allSelected = pending.length > 0 && selected.size === pending.length;
  const toggleAll = () => {
    const next = allSelected ? new Set<string>() : new Set(pending.map((c) => c.id));
    setSelected(next);
    if (!amountTouched) {
      const sum = pending.filter((c) => next.has(c.id)).reduce((s, c) => s + c.amount, 0);
      setAmount((Math.round(sum * 100) / 100).toFixed(2));
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await adminFetch<{ settled?: number }>(`/api/admin/affiliates/${affiliateId}/payouts`, {
      method: 'POST',
      body: {
        amount,
        method,
        reference,
        notes,
        // Noon local, so the date reads the same in every timezone it is shown in.
        paid_at: paidAt ? new Date(`${paidAt}T12:00:00`).toISOString() : undefined,
        commission_ids: [...selected],
      },
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.data.error ?? 'Could not record the payout.');
      return;
    }
    onSaved(res.data.settled ?? 0);
  };

  const mismatch = selected.size > 0 && Math.abs(Number(amount) - selectedTotal) >= 0.01;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-bold text-ink">Record payment</h3>
          <button onClick={onClose} aria-label="Close">
            <X className="h-4 w-4 text-ink-muted" />
          </button>
        </div>
        <p className="mb-4 text-xs text-ink-muted">
          To {affiliateName} · balance owed {fmtMoney(balance)}
        </p>

        {error && (
          <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        )}

        {pending.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-lg border border-line">
            <label className="flex items-center justify-between gap-2 border-b border-line bg-surface px-3 py-2 text-xs font-medium text-ink">
              <span className="flex items-center gap-2">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-teal" />
                Commissions this payment settles
              </span>
              <span className="tabular-nums">{fmtMoney(selectedTotal)}</span>
            </label>
            <div className="max-h-48 divide-y divide-line/60 overflow-y-auto">
              {pending.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs hover:bg-surface/60">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                    className="accent-teal"
                  />
                  <span className="w-20 shrink-0 text-ink-muted">{new Date(c.created_at).toLocaleDateString()}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-ink">
                    {c.reference}
                    {c.discount_code && <span className="ml-1.5 text-teal-dark">{c.discount_code}</span>}
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-muted">on {fmtMoney(c.order_total)}</span>
                  <span className="w-16 shrink-0 text-right font-medium tabular-nums text-ink">{fmtMoney(c.amount)}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="po-amount">Amount paid (CAD)</label>
              <input
                id="po-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setAmountTouched(true);
                }}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="po-date">Date paid</label>
              <input
                id="po-date"
                type="date"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          {mismatch && (
            <p className="-mt-2 text-[11px] text-amber-700">
              Differs from the selected commissions ({fmtMoney(selectedTotal)}). The balance will reflect
              the amount actually paid.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="po-method">Method</label>
              <select id="po-method" value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
                {PAYOUT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="po-ref">Reference</label>
              <input
                id="po-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Transaction ID / tx hash"
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className={labelCls} htmlFor="po-notes">Notes</label>
            <textarea
              id="po-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <div className="mt-5 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg bg-surface px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-line"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !(Number(amount) > 0)}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-ink/90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Record {Number(amount) > 0 ? fmtMoney(Number(amount)) : 'payment'}
          </button>
        </div>
      </div>
    </div>
  );
}
