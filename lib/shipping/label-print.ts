// Client-side shipping-label printing for invoices — shared by the admin
// invoice page and the warehouse fulfillment queue.
//
// Labels come through `/api/admin/invoices/[id]/label`, which needs a Bearer
// token, so they can't be opened with a plain link: each helper fetches the
// file as a Blob first, then prints or opens it.

import { supabase } from '@/lib/supabase';
import { printPdfBlob } from '@/lib/print-pdf';

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

/** Open the print dialog on the invoice's label, without leaving the page. */
export async function printInvoiceLabel(invoiceId: string): Promise<void> {
  printPdfBlob(await fetchInvoiceLabelBlob(invoiceId));
}

/** Open the label in a new tab, to save or reprint later. */
export async function openInvoiceLabel(invoiceId: string): Promise<void> {
  // Open the tab synchronously, inside the click, so popup blockers allow it.
  const tab = window.open('', '_blank');
  try {
    const url = URL.createObjectURL(await fetchInvoiceLabelBlob(invoiceId));
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
 * Print several labels as ONE job: fetch each, merge them into a single PDF
 * (a page per label, image labels placed on a page of their own size) and
 * open one print dialog. Labels that fail to load are skipped and reported.
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
  if (blobs.length === 1) {
    printPdfBlob(blobs[0].blob);
    return { printed: 1, failed };
  }

  // Loaded on demand — only the bulk path needs it.
  const { PDFDocument } = await import('pdf-lib');
  const merged = await PDFDocument.create();
  let printed = 0;
  for (const { invoiceId, blob } of blobs) {
    try {
      const bytes = await blob.arrayBuffer();
      if (blob.type.startsWith('image/')) {
        const img = blob.type.includes('png')
          ? await merged.embedPng(bytes)
          : await merged.embedJpg(bytes);
        const page = merged.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      } else {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
      }
      printed++;
    } catch (e: any) {
      failed.push({ invoiceId, error: e?.message ?? 'Unreadable label file' });
    }
  }
  if (printed > 0) {
    const out = await merged.save();
    printPdfBlob(new Blob([out as BlobPart], { type: 'application/pdf' }));
  }
  return { printed, failed };
}
