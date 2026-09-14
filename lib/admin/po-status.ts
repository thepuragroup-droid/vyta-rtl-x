// ============================================================
// PURCHASE ORDER STATUS — vocabulary, badge/PDF meta, predicates
// ============================================================
import type { PurchaseOrderStatus } from '@/lib/types/ecommerce';

// Ordered vocabulary.
export const PO_STATUSES: PurchaseOrderStatus[] = [
  'pending',
  'partially_fulfilled',
  'fulfilled',
  'paid',
  'cancelled',
];

export interface PoStatusMeta {
  label: string;
  /** Tailwind badge classes for the admin UI. */
  badge: string;
  /** PDF pill background / foreground (inline styles). */
  pdfBg: string;
  pdfFg: string;
}

export const PO_STATUS_META: Record<PurchaseOrderStatus, PoStatusMeta> = {
  pending: {
    label: 'Pending',
    badge: 'bg-amber-500/10 text-amber-700 border-amber-200',
    pdfBg: '#d97706', pdfFg: '#ffffff',
  },
  partially_fulfilled: {
    label: 'Partially Fulfilled',
    badge: 'bg-blue-500/10 text-blue-700 border-blue-200',
    pdfBg: '#2563eb', pdfFg: '#ffffff',
  },
  fulfilled: {
    label: 'Fulfilled',
    badge: 'bg-violet-500/10 text-violet-700 border-violet-200',
    pdfBg: '#7c3aed', pdfFg: '#ffffff',
  },
  paid: {
    label: 'Paid',
    badge: 'bg-emerald-500/10 text-emerald-700 border-emerald-200',
    pdfBg: '#059669', pdfFg: '#ffffff',
  },
  cancelled: {
    label: 'Cancelled',
    badge: 'bg-red-500/10 text-red-700 border-red-200',
    pdfBg: '#dc2626', pdfFg: '#ffffff',
  },
};

/** Edit-locked: only the status field may change. */
export function isPoLocked(status: PurchaseOrderStatus): boolean {
  return status === 'paid' || status === 'cancelled';
}

/** Receiving is allowed for everything except a cancelled PO (paid can receive). */
export function canReceivePo(status: PurchaseOrderStatus): boolean {
  return status !== 'cancelled';
}
