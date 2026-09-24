'use client';

import React from 'react';
import { Truck, MapPin, Camera, CheckCircle2, Tag } from 'lucide-react';
import type { QueueItem } from '@/lib/warehouse/types';
import { statusLabel, timeAgo } from '@/lib/warehouse/types';

interface QueueRowProps {
  item: QueueItem;
  active: boolean;
  isNew: boolean;
  onClick: () => void;
  // Bulk selection. When `selectable` is true a checkbox is shown; `selected`
  // reflects its state and `onToggleSelect` toggles it.
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-600',
  packed: 'bg-blue-500/10 text-blue-600',
  shipped: 'bg-emerald-500/10 text-emerald-600',
  picked_up: 'bg-emerald-500/10 text-emerald-600',
};

export default function QueueRow({
  item,
  active,
  isNew,
  onClick,
  selectable = false,
  selected = false,
  onToggleSelect,
}: QueueRowProps) {
  const Type = item.fulfillment_type === 'pickup' ? MapPin : Truck;

  // Shipping (carrier) label state as a short, human tag — distinct from the
  // product-labels ("Ship with labels") concept below.
  const shipLabel = item.has_label
    ? { text: 'Labeled', tone: 'bg-emerald-500/10 text-emerald-600' }
    : item.order?.label_state === 'pending' || item.shipment?.label_state === 'pending'
      ? { text: 'Label pending', tone: 'bg-amber-500/10 text-amber-600' }
      : { text: 'No label', tone: 'bg-gray-500/10 text-ink-muted' };

  const cancelled = item.order?.status === 'cancelled';

  return (
    <div
      className={`flex items-stretch gap-2 rounded-lg border bg-white transition ${
        active
          ? 'border-teal ring-1 ring-teal/40 shadow-sm'
          : selected
            ? 'border-teal/60'
            : 'border-line hover:border-teal/50'
      }`}
    >
      {selectable && (
        <label
          className="flex items-center pl-3 cursor-pointer"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect?.()}
            className="h-4 w-4 accent-teal"
            aria-label={`Select ${item.invoice_number}`}
          />
        </label>
      )}
      <button
        type="button"
        onClick={onClick}
        className="flex-1 min-w-0 text-left px-4 py-3"
      >
        {/* Name gets the full width so it's never squished by the tags. */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-ink truncate">
            {item.invoice_number}
          </span>
          {item.order?.order_number && (
            <span className="text-xs text-ink-muted truncate">
              · {item.order.order_number}
            </span>
          )}
          {item.source === 'stealth_health' && (
            <span
              title="Placed through Stealth Health hosted checkout"
              className="text-[10px] uppercase tracking-wider rounded-full px-1.5 py-0.5 bg-indigo-500/10 text-indigo-700 shrink-0"
            >
              Stealth Health
            </span>
          )}
          {isNew && (
            <span className="text-[10px] uppercase tracking-wider rounded-full px-1.5 py-0.5 bg-teal-dark text-white shrink-0">
              New
            </span>
          )}
        </div>

        <div className="text-xs text-ink-muted mt-0.5 truncate">
          {item.customer_name ?? item.customer_email ?? 'No customer'} · {item.item_count} item
          {item.item_count === 1 ? '' : 's'} · {timeAgo(item.created_at)}
        </div>

        {/* All tags live on one wrapping row below the name, so a narrow queue
            bar wraps them instead of squishing them together. */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
          {cancelled ? (
            <span className="rounded-full px-2 py-0.5 bg-red-500/10 text-red-600">
              Cancelled
            </span>
          ) : (
            <span
              className={`rounded-full px-2 py-0.5 ${STATUS_TONE[item.fulfillment_status] ?? 'bg-gray-500/10 text-ink-muted'}`}
            >
              {statusLabel(item.fulfillment_status)}
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-gray-500/10">
            <Type className="w-3.5 h-3.5" />
            {item.fulfillment_type}
          </span>
          {/* Product labels — reflects the invoice's "Ship with labels" toggle. */}
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
              item.with_labels ? 'bg-teal/10 text-teal-dark' : 'bg-gray-500/10 text-ink-muted'
            }`}
          >
            <Tag className="w-3 h-3" />
            {item.with_labels ? 'with labels' : 'no labels'}
          </span>
          {/* Shipping (carrier) label state — distinct from product labels. */}
          {item.fulfillment_type === 'shipment' && (
            <span className={`rounded-full px-2 py-0.5 ${shipLabel.tone}`}>
              Ship: {shipLabel.text}
            </span>
          )}
          {item.packed_photos.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Camera className="w-3.5 h-3.5" />
              {item.packed_photos.length}
            </span>
          )}
          {item.handling_checklist.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {item.handling_checklist.length}
            </span>
          )}
          {item.non_payable && (
            <span className="rounded-full px-2 py-0.5 bg-gray-500/10">backorder</span>
          )}
        </div>
      </button>
    </div>
  );
}
