/**
 * Invoice status vocabulary, badge/PDF metadata, and the virtual
 * "overdue" computation shared by the API and the admin UI.
 *
 * The stored `status` column may lag reality (it is only swept to
 * `overdue` when `mark_overdue_invoices()` runs). `effectiveStatus()`
 * derives the value the UI should actually render.
 */
import type { InvoiceStatus } from '@/lib/types/ecommerce';

export const INVOICE_STATUSES: InvoiceStatus[] = [
  'draft',
  'sent',
  'partial',
  'paid',
  'overdue',
  'cancelled',
];

export interface InvoiceStatusMeta {
  /** Human-readable label for selects / badges. */
  label: string;
  /** Tailwind classes for the list/detail badge. */
  badge: string;
  /** Hex colors used by the printable/PDF view. */
  pdf: { fg: string; bg: string };
}

export const INVOICE_STATUS_META: Record<InvoiceStatus, InvoiceStatusMeta> = {
  draft: {
    label: 'Draft',
    badge: 'bg-gray-500/10 text-gray-600',
    pdf: { fg: '#4b5563', bg: '#f3f4f6' },
  },
  sent: {
    label: 'Sent',
    badge: 'bg-blue-500/10 text-blue-600',
    pdf: { fg: '#2563eb', bg: '#eff6ff' },
  },
  partial: {
    label: 'Partial',
    badge: 'bg-amber-500/10 text-amber-600',
    pdf: { fg: '#d97706', bg: '#fffbeb' },
  },
  paid: {
    label: 'Paid',
    badge: 'bg-emerald-500/10 text-emerald-600',
    pdf: { fg: '#059669', bg: '#ecfdf5' },
  },
  overdue: {
    label: 'Overdue',
    badge: 'bg-red-500/10 text-red-600',
    pdf: { fg: '#dc2626', bg: '#fef2f2' },
  },
  cancelled: {
    label: 'Cancelled',
    // Line-through matches the spec — a cancelled invoice reads as "voided"
    // in the list, so figures don't look like an outstanding amount.
    badge: 'bg-gray-500/10 text-gray-500 line-through',
    pdf: { fg: '#6B7280', bg: '#F3F4F6' },
  },
};

/**
 * Returns the status the UI should display. `sent`/`partial` invoices
 * whose due date has passed are virtually `overdue` even if the DB
 * sweep has not run yet. `draft` and `paid` are never overridden.
 */
export function effectiveStatus(
  status: InvoiceStatus,
  dueDate: string | null | undefined,
): InvoiceStatus {
  if (status !== 'sent' && status !== 'partial') return status;
  if (!dueDate) return status;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return status;
  // Compare on date boundaries: overdue once the due date is in the past.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return due < today ? 'overdue' : status;
}
