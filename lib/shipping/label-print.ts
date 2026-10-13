// Client-side shipping-label printing for invoices — shared by the admin
// invoice page and the warehouse fulfillment queue.
//
// Labels come through `/api/admin/invoices/[id]/label`, which needs a Bearer
// token, so they can't be opened with a plain link: each helper fetches the
// file as a Blob first, then opens it as a 4x6 PDF in a new tab to print.

import { supabase } from '@/lib/supabase';
import { combineLabelPdfs, labelPdf4x6, openLabelTab, toLabelPdf } from '@/lib/shipping/label-4x6';

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

/**
 * Print the invoice's label: open it in a new tab as a 4x6 PDF, to print from
 * the PDF viewer. Call it straight from the click so the tab isn't blocked.
 */
export async function printInvoiceLabel(invoiceId: string): Promise<void> {
  const tab = openLabelTab();
  try {
    tab.show(await toLabelPdf(await fetchInvoiceLabelBlob(invoiceId)));
  } catch (e) {
    tab.close();
    throw e;
  }
}

export interface BulkLabelResult {
  printed: number;
  failed: Array<{ invoiceId: string; error: string }>;
}

/**
 * Print several labels as ONE job of 4x6 pages: fetch each, turn it into a
 * 4x6 PDF and open them combined in one new tab. Labels that fail to load or
 * can't be read are skipped and reported.
 */
export async function printInvoiceLabels(invoiceIds: string[]): Promise<BulkLabelResult> {
  const tab = openLabelTab();
  try {
    const result = await combinedLabels(invoiceIds);
    if (result.pdf) tab.show(result.pdf);
    else tab.close();
    return { printed: result.printed, failed: result.failed };
  } catch (e) {
    tab.close();
    throw e;
  }
}

async function combinedLabels(
  invoiceIds: string[],
): Promise<BulkLabelResult & { pdf: Blob | null }> {
  const settled = await Promise.allSettled(invoiceIds.map((id) => fetchInvoiceLabelBlob(id)));
  const failed: BulkLabelResult['failed'] = [];
  const blobs: Array<{ invoiceId: string; blob: Blob }> = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') blobs.push({ invoiceId: invoiceIds[i], blob: r.value });
    else failed.push({ invoiceId: invoiceIds[i], error: r.reason?.message ?? 'Failed to load label' });
  });
  if (blobs.length === 0) return { printed: 0, failed, pdf: null };

  const pdfs: Blob[] = [];
  for (const { invoiceId, blob } of blobs) {
    try {
      pdfs.push(await labelPdf4x6(blob));
    } catch (e: any) {
      failed.push({ invoiceId, error: e?.message ?? 'Unreadable label file' });
    }
  }
  const pdf = pdfs.length > 0 ? await combineLabelPdfs(pdfs) : null;
  return { printed: pdfs.length, failed, pdf };
}
