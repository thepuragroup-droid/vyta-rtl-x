'use client';

import React, { useState, useMemo } from 'react';
import { PackageCheck, Loader2, History, Check } from 'lucide-react';
import { receivePurchaseOrderItems } from '@/lib/admin/purchase-orders';
import { canReceivePo } from '@/lib/admin/po-status';
import type { PurchaseOrderWithSupplier } from '@/lib/types/ecommerce';

interface Props {
  po: PurchaseOrderWithSupplier;
  onReceived?: (po: PurchaseOrderWithSupplier) => void;
}

export default function PurchaseOrderReceiving({ po, onReceived }: Props) {
  const items = po.items ?? [];
  const receipts = po.receipts ?? [];

  // Map po_item_id -> qty to receive this round.
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const remainingFor = (it: typeof items[number]) => Math.max(0, it.qty - it.qty_received);
  const fullyReceived = items.length > 0 && items.every((it) => remainingFor(it) === 0);
  const canReceive = canReceivePo(po.status) && !fullyReceived;

  const totalToReceive = useMemo(
    () => Object.values(qtys).reduce((s, q) => s + (Number(q) || 0), 0),
    [qtys]
  );

  function setQty(id: string, value: number, max: number) {
    const v = Math.max(0, Math.min(value, max));
    setQtys((prev) => ({ ...prev, [id]: v }));
  }

  function fillRemaining() {
    const next: Record<string, number> = {};
    for (const it of items) next[it.id] = remainingFor(it);
    setQtys(next);
  }

  async function handleReceive() {
    const payload = items
      .map((it) => ({ po_item_id: it.id, qty: Number(qtys[it.id]) || 0 }))
      .filter((i) => i.qty > 0);
    if (payload.length === 0) { setError('Enter at least one quantity to receive.'); return; }
    setSaving(true);
    setError('');
    const res = await receivePurchaseOrderItems(po.id, { note: note.trim() || undefined, items: payload });
    setSaving(false);
    if (!res.success) { setError(res.error ?? 'Failed to record receipt.'); return; }
    setQtys({});
    setNote('');
    if (res.purchase_order) onReceived?.(res.purchase_order);
  }

  return (
    <div className="bg-white rounded-xl border border-line overflow-hidden">
      <div className="px-5 py-4 border-b border-line flex items-center gap-2">
        <PackageCheck className="w-4 h-4 text-ink-muted" />
        <h2 className="font-semibold text-ink text-sm">Receiving</h2>
        {fullyReceived && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
            <Check className="w-3 h-3" /> Fully received
          </span>
        )}
      </div>

      {error && (
        <div className="mx-5 mt-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {/* Receive form */}
      {canReceive ? (
        <div className="p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface">
                  <th className="px-3 py-2.5 text-left text-xs text-ink-muted font-semibold uppercase tracking-wide">Product</th>
                  <th className="px-3 py-2.5 text-center text-xs text-ink-muted font-semibold uppercase tracking-wide">Ordered</th>
                  <th className="px-3 py-2.5 text-center text-xs text-ink-muted font-semibold uppercase tracking-wide">Received</th>
                  <th className="px-3 py-2.5 text-center text-xs text-ink-muted font-semibold uppercase tracking-wide">Remaining</th>
                  <th className="px-3 py-2.5 text-center text-xs text-ink-muted font-semibold uppercase tracking-wide w-28">Receive</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50">
                {items.map((it) => {
                  const remaining = remainingFor(it);
                  return (
                    <tr key={it.id}>
                      <td className="px-3 py-3 text-ink font-medium">{it.description}</td>
                      <td className="px-3 py-3 text-center tabular-nums text-ink-muted">{it.qty}</td>
                      <td className="px-3 py-3 text-center tabular-nums text-ink-muted">{it.qty_received}</td>
                      <td className="px-3 py-3 text-center tabular-nums font-medium text-ink">{remaining}</td>
                      <td className="px-3 py-3">
                        <input
                          type="number"
                          min={0}
                          max={remaining}
                          value={qtys[it.id] ?? ''}
                          disabled={remaining === 0}
                          placeholder="0"
                          onChange={(e) => setQty(it.id, parseInt(e.target.value) || 0, remaining)}
                          className="w-20 mx-auto block text-center px-2 py-1 bg-surface border border-line rounded-lg text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-bronze/40 disabled:opacity-40"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button onClick={fillRemaining} className="mt-3 text-xs text-bronze hover:text-bronze/80 transition-colors">
            Fill all remaining
          </button>

          <div className="mt-4">
            <label className="block text-xs font-medium text-ink-muted mb-1">Receipt note (optional)</label>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Carrier, packing slip #, condition…" className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bronze/40" />
          </div>

          <button onClick={handleReceive} disabled={saving || totalToReceive === 0} className="mt-4 w-full py-2.5 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90 transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
            {saving ? 'Recording…' : `Receive ${totalToReceive > 0 ? totalToReceive : ''} item${totalToReceive === 1 ? '' : 's'}`.trim()}
          </button>
        </div>
      ) : (
        <div className="p-5 text-sm text-ink-muted">
          {po.status === 'cancelled'
            ? 'This purchase order is cancelled — receiving is disabled.'
            : 'All ordered quantities have been received.'}
        </div>
      )}

      {/* Receipt history */}
      {receipts.length > 0 && (
        <div className="border-t border-line p-5">
          <div className="flex items-center gap-2 mb-3">
            <History className="w-4 h-4 text-ink-muted" />
            <h3 className="text-sm font-semibold text-ink">Receipt History</h3>
            <span className="text-xs text-ink-muted bg-surface px-2 py-0.5 rounded-full">{receipts.length}</span>
          </div>
          <div className="space-y-3">
            {receipts.map((rc) => {
              const total = (rc.items ?? []).reduce((s, ri) => s + ri.qty, 0);
              return (
                <div key={rc.id} className="flex items-start justify-between gap-3 p-3 bg-surface rounded-lg border border-line">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink tabular-nums">{total} item{total === 1 ? '' : 's'} received</p>
                    {rc.note && <p className="text-xs text-ink-muted mt-0.5 truncate">{rc.note}</p>}
                  </div>
                  <span className="text-xs text-ink-muted flex-shrink-0">
                    {new Date(rc.created_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
