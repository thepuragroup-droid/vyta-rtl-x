// Client-side shipping-label printing for invoices — shared by the admin
// invoice page and the warehouse fulfillment queue.
//
// Labels come through `/api/admin/invoices/[id]/label`, which needs a Bearer
// token, so they can't be opened with a plain link: each helper fetches the
// file as a Blob first, then prints or opens it.

import { supabase } from '@/lib/supabase';
import { printPdfBlob } from '@/lib/print-pdf';
import { combineLabelPdfs, labelPdf4x6, printShippingLabel } from '@/lib/shipping/label-4x6';

async function authHeader(): Promise<Record<string, string>> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) return { Authorization: `Bearer ${session.access_token}` };
  } catch {
    /* no session — the request 403s and throws below */
  }
  return {};
}

/** The invoice's shipping label (PDF, or occasionally an image) as a Blob. */
export async function fetchInvoiceLabelBlob(invoiceId: string): Promise<Blob> {
  const res = await fetch(`/api/admin/invoices/${invoiceId}/label`, {
    headers: await authHeader(),
    cache: 'no-store',
  });
  if (!res.ok) {
    let message = `Failed to load label (${res.status})`;
    try { message = (await res.json()).error ?? message; } catch {}
    throw new Error(message);
  }
  return res.blob();
}

/** Open the print dialog on the invoice's label (4x6), without leaving the page. */
export async function printInvoiceLabel(invoiceId: string): Promise<void> {
  await printShippingLabel(await fetchInvoiceLabelBlob(invoiceId));
}

/**
 * Open the label in a new tab as a 4x6 PDF, to save or reprint later. If the
 * file can't be redrawn, the original Easyship file opens instead.
 */
export async function openInvoiceLabel(invoiceId: string): Promise<void> {
  // Open the tab synchronously, inside the click, so popup blockers allow it.
  const tab = window.open('', '_blank');
  try {
    const original = await fetchInvoiceLabelBlob(invoiceId);
    let file = original;
    try {
      file = await labelPdf4x6(original);
    } catch (e) {
      console.warn('Could not fit the label to 4x6; opening the file as-is', e);
    }
    const url = URL.createObjectURL(file);
    if (tab) tab.location.href = url;
    else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    throw e;
  }
}

export interface BulkLabelResult {
  printed: number;
  failed: Array<{ invoiceId: string; error: string }>;
}

/**
 * Print several labels as ONE job of 4x6 pages: fetch each, turn it into a
 * 4x6 PDF, combine them and open one print dialog. Labels that fail to load
 * or can't be read are skipped and reported.
 */
export async function printInvoiceLabels(invoiceIds: string[]): Promise<BulkLabelResult> {
  const settled = await Promise.allSettled(invoiceIds.map((id) => fetchInvoiceLabelBlob(id)));
  const failed: BulkLabelResult['failed'] = [];
  const blobs: Array<{ invoiceId: string; blob: Blob }> = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') blobs.push({ invoiceId: invoiceIds[i], blob: r.value });
    else failed.push({ invoiceId: invoiceIds[i], error: r.reason?.message ?? 'Failed to load label' });
  });
  if (blobs.length === 0) return { printed: 0, failed };

  const pdfs: Blob[] = [];
  for (const { invoiceId, blob } of blobs) {
    try {
      pdfs.push(await labelPdf4x6(blob));
    } catch (e: any) {
      failed.push({ invoiceId, error: e?.message ?? 'Unreadable label file' });
    }
  }
  if (pdfs.length > 0) printPdfBlob(await combineLabelPdfs(pdfs));
  return { printed: pdfs.length, failed };
}
