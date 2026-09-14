'use client';

import React from 'react';
import { X, AlertTriangle, PackagePlus, Printer, Wallet } from 'lucide-react';

export interface BulkOrderRow {
  id: string;
  order_number?: string;
  customer_name?: string | null;
}

export interface SkippedOrder {
  order: BulkOrderRow;
  reason: string;
}

interface BulkShipmentDialogProps {
  action: 'create' | 'label';
  eligible: BulkOrderRow[];
  skipped: SkippedOrder[];
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation dialog for the bulk shipment / label actions on /admin/orders.
 *
 * - `create`: bulk-create Easyship shipment records. Warns that orders failing
 *   the shipment requirements (address / postal / country / already shipped)
 *   will be skipped, listing each with its reason.
 * - `label`: bulk-buy shipping labels. Warns that the Easyship wallet is charged
 *   per label, so funds must be available, and lists orders that can't have a
 *   label bought (no shipment yet / already purchased / pickup).
 */
export default function BulkShipmentDialog({
  action,
  eligible,
  skipped,
  onConfirm,
  onCancel,
}: BulkShipmentDialogProps) {
  const isLabel = action === 'label';
  const title = isLabel ? 'Generate shipping labels' : 'Create shipment records';
  const Icon = isLabel ? Printer : PackagePlus;
  const canProceed = eligible.length > 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-lg w-full max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-teal/10 rounded-lg flex items-center justify-center">
              <Icon className="w-5 h-5 text-teal-dark" />
            </div>
            <h2 className="text-lg font-bold text-ink">{title}</h2>
          </div>
          <button
            onClick={onCancel}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto">
          {/* Wallet warning for label purchases */}
          {isLabel && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex gap-3">
              <Wallet className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-700 space-y-1">
                <p className="font-semibold">Your Easyship wallet will be charged.</p>
                <p>
                  Buying {eligible.length} label{eligible.length !== 1 ? 's' : ''} deducts the
                  courier cost from your Easyship wallet. Make sure it has enough funds —
                  labels that fail for insufficient balance will need to be retried.
                </p>
              </div>
            </div>
          )}

          {/* Eligible summary */}
          {canProceed ? (
            <div className="space-y-2">
              <p className="text-sm text-ink">
                {isLabel ? 'Labels will be generated for' : 'Shipment records will be created for'}{' '}
                <span className="font-semibold">
                  {eligible.length} order{eligible.length !== 1 ? 's' : ''}
                </span>
                .
              </p>
            </div>
          ) : (
            <div className="p-3 bg-surface border border-line rounded-lg text-sm text-ink-muted">
              None of the selected orders qualify for this action. See the reasons below.
            </div>
          )}

          {/* Skipped list */}
          {skipped.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <p className="text-sm font-medium text-ink">
                  {skipped.length} order{skipped.length !== 1 ? 's' : ''} will be skipped
                </p>
              </div>
              <div className="border border-line rounded-lg divide-y divide-line/60 max-h-52 overflow-y-auto">
                {skipped.map(({ order, reason }) => (
                  <div key={order.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-ink truncate">
                        {order.order_number || order.id}
                      </p>
                      {order.customer_name && (
                        <p className="text-[11px] text-ink-muted truncate">{order.customer_name}</p>
                      )}
                    </div>
                    <span className="text-[11px] text-amber-600 text-right shrink-0 max-w-[55%]">
                      {reason}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-ink-muted">
                These orders will not be processed and can be handled individually.
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="p-6 border-t border-line flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg text-sm font-medium hover:bg-line transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canProceed}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-teal-dark hover:bg-teal/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLabel
              ? `Buy ${eligible.length} label${eligible.length !== 1 ? 's' : ''}`
              : `Create ${eligible.length} shipment${eligible.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
