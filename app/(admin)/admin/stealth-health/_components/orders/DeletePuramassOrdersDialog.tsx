'use client';

import React, { useMemo, useState } from 'react';
import { X, AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import type { PuramassOrderRow } from './OrdersTab';

interface DeletePuramassOrdersDialogProps {
  /** The ledger rows the admin is about to delete (one for a row action). */
  orders: PuramassOrderRow[];
  onClose: () => void;
  /**
   * Perform the delete. Returns `{ success }` (with an optional error message
   * and a non-fatal warning, e.g. invoice cascade failed after the ledger rows
   * were already removed).
   */
  onConfirm: (opts: { cascadeInvoice: boolean }) => Promise<{
    success: boolean;
    error?: string;
    warning?: string;
  }>;
}

/**
 * Confirmation dialog for deleting PuraMass hand-off ledger rows.
 *
 * The nuance this dialog exists to surface: a paid hand-off may have
 * materialised into a customer-facing invoice (the buyer's account order + the
 * fulfillment-queue entry). Deleting the ledger row alone leaves that invoice in
 * place — the safe default. The admin can opt in to also tearing down the linked
 * invoice(s), which removes the order from the customer's account and the queue.
 */
export default function DeletePuramassOrdersDialog({
  orders,
  onClose,
  onConfirm,
}: DeletePuramassOrdersDialogProps) {
  const [cascadeInvoice, setCascadeInvoice] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { count, withInvoice, paidCount } = useMemo(() => {
    return {
      count: orders.length,
      withInvoice: orders.filter((o) => o.invoice_id).length,
      paidCount: orders.filter((o) => o.status === 'paid').length,
    };
  }, [orders]);

  const plural = count === 1 ? '' : 's';

  const handleDelete = async () => {
    setError(null);
    setLoading(true);
    const result = await onConfirm({ cascadeInvoice: cascadeInvoice && withInvoice > 0 });
    if (result.success) {
      onClose();
    } else {
      setError(result.error || `Failed to delete order${plural}`);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-md w-full">
        {/* Header */}
        <div className="p-6 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-500" />
            </div>
            <h2 className="text-lg font-bold text-ink">
              Delete {count} Stealth Health order{plural}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <p className="text-sm text-ink">
            You are about to remove{' '}
            <span className="font-medium">
              {count} hand-off ledger record{plural}
            </span>
            . This is the reconciliation record of the Stealth Health checkout
            hand-off.
          </p>

          {/* A short preview of what's being deleted. */}
          <div className="max-h-40 overflow-y-auto rounded-lg border border-line divide-y divide-line/60">
            {orders.slice(0, 6).map((o) => (
              <div key={o.id} className="px-3 py-2 text-xs flex items-center justify-between gap-3">
                <span className="text-ink truncate">
                  {o.customer_email ?? 'Guest'}
                </span>
                <span className="font-mono text-ink-muted shrink-0">
                  {o.partner_reference.slice(0, 10)}…
                </span>
              </div>
            ))}
            {orders.length > 6 && (
              <div className="px-3 py-2 text-xs text-ink-muted">
                +{orders.length - 6} more…
              </div>
            )}
          </div>

          {/* Linked-invoice handling. */}
          {withInvoice > 0 ? (
            <div className="space-y-3">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-xs text-amber-800">
                  {withInvoice === count ? 'All' : `${withInvoice} of these`} order
                  {withInvoice === 1 ? ' has' : 's have'} a materialised customer
                  invoice{paidCount > 0 ? ` (${paidCount} paid)` : ''}. By default that
                  invoice is kept — the customer keeps seeing the order in their
                  account and it stays in the fulfillment queue.
                </p>
              </div>

              <label className="flex items-start gap-3 p-3 border border-red-200 rounded-lg cursor-pointer hover:bg-red-50 transition-colors">
                <input
                  type="checkbox"
                  checked={cascadeInvoice}
                  onChange={(e) => setCascadeInvoice(e.target.checked)}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-600">
                    Also delete the linked customer invoice{withInvoice === 1 ? '' : 's'} ({withInvoice})
                  </p>
                  <p className="text-xs text-red-600/80 mt-0.5">
                    Removes the order from the customer&apos;s account and the
                    fulfillment queue, along with its line items. This cannot be
                    undone.
                  </p>
                </div>
              </label>
            </div>
          ) : (
            <div className="p-3 bg-surface rounded-lg">
              <p className="text-xs text-ink-muted">
                None of these have a materialised customer invoice, so nothing on
                the customer&apos;s account or the fulfillment queue is affected.
              </p>
            </div>
          )}

          <p className="text-xs text-ink-muted">This action cannot be undone.</p>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg text-sm font-medium hover:bg-line transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={loading}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 bg-red-600 hover:bg-red-700 text-white"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              {loading
                ? 'Deleting…'
                : cascadeInvoice && withInvoice > 0
                  ? `Delete order${plural} + invoice${withInvoice === 1 ? '' : 's'}`
                  : `Delete order${plural}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
