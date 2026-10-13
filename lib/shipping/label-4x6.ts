// Print shipping labels on exact 4x6 pages, whatever page Easyship put them on.
//
// Easyship hands back labels as a PDF (occasionally an image). Shipments made
// before we asked for 4x6 labels — and any account still on the default —
// come as an A4/Letter page with the 4x6 label in one corner, so printing the
// file as-is shrinks the label and leaves the rest of the sheet blank.
//
// Every label is turned into a PDF of 4x6 pages (288 x 432 pt), the same
// shape as Easyship's own 4x6 documents, and that PDF is what gets printed:
//   • a page that is already 4x6 is kept exactly as Easyship made it;
//   • any other page is trimmed to the label printed on it (the white area
//     around it is dropped), turned upright if it lies sideways, and drawn
//     at 300 dpi to fill a 4x6 page.

import { printPdfBlob } from '@/lib/print-pdf';

const SHEET_W_IN = 4;
const SHEET_H_IN = 6;
const DPI = 300;
const SHEET_W_PX = SHEET_W_IN * DPI;
const SHEET_H_PX = SHEET_H_IN * DPI;
/** A page within this many points (1/72 in) of 4x6 counts as a 4x6 label. */
const NATIVE_TOLERANCE_PT = 9;
/** Resolution the page is scanned at to find where the label sits on it. */
const SCAN_DPI = 72;
/** A pixel darker than this (0–255) is part of the label. */
const INK_THRESHOLD = 200;
/** White kept around a trimmed label, as a fraction of its longer side. */
const TRIM_PADDING = 0.01;

type PdfJs = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<PdfJs> | null = null;

/**
 * pdf.js, loaded on first use. Its worker runs on the main thread (labels are
 * one or two small pages), which spares serving a separate worker script.
 */
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= (async () => {
    const [pdfjs, worker] = await Promise.all([
      import('pdfjs-dist'),
      // @ts-expect-error -- the worker build ships no type declarations
      import('pdfjs-dist/build/pdf.worker.min.mjs'),
    ]);
    const g = globalThis as { pdfjsWorker?: unknown };
    g.pdfjsWorker ??= { WorkerMessageHandler: worker.WorkerMessageHandler };
    return pdfjs;
  })();
  pdfjsPromise.catch(() => { pdfjsPromise = null; });
  return pdfjsPromise;
}

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

interface Box { x: number; y: number; w: number; h: number }

/**
 * The part of the canvas that holds the label: every row and column carrying
 * at least two dark pixels (lone specks are ignored), plus a little padding.
 * Null when the page is blank.
 */
function inkBounds(ctx: CanvasRenderingContext2D, width: number, height: number): Box | null {
  const { data } = ctx.getImageData(0, 0, width, height);
  const rows = new Uint32Array(height);
  const cols = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum < INK_THRESHOLD) {
        rows[y]++;
        cols[x]++;
      }
    }
  }
  const first = (a: Uint32Array) => a.findIndex((n) => n >= 2);
  const last = (a: Uint32Array) => a.length - 1 - [...a].reverse().findIndex((n) => n >= 2);
  const top = first(rows);
  const left = first(cols);
  if (top < 0 || left < 0) return null;
  const bottom = last(rows);
  const right = last(cols);
  const pad = Math.ceil(Math.max(right - left, bottom - top) * TRIM_PADDING);
  const x = Math.max(0, left - pad);
  const y = Math.max(0, top - pad);
  return {
    x,
    y,
    w: Math.min(width, right + pad + 1) - x,
    h: Math.min(height, bottom + pad + 1) - y,
  };
}

/**
 * Draw `source` (already cropped to the label) onto a 4x6 sheet: turned
 * upright if it is wider than tall, then scaled to fit and centred.
 */
function toSheet(source: HTMLCanvasElement | ImageBitmap): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(SHEET_W_PX, SHEET_H_PX);
  const sideways = source.width > source.height;
  const w = sideways ? source.height : source.width;
  const h = sideways ? source.width : source.height;
  const scale = Math.min(SHEET_W_PX / w, SHEET_H_PX / h);
  ctx.translate(SHEET_W_PX / 2, SHEET_H_PX / 2);
  if (sideways) ctx.rotate(Math.PI / 2);
  ctx.scale(scale, scale);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

/** An upright 4x6 page (as displayed, i.e. after the page's own rotation). */
function isNativeSize(widthPt: number, heightPt: number): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) <= NATIVE_TOLERANCE_PT;
  return near(widthPt, SHEET_W_IN * 72) && near(heightPt, SHEET_H_IN * 72);
}

/** A label page for the 4x6 PDF: a source page kept as-is, or a redrawn sheet. */
type Sheet = { kind: 'page'; index: number } | { kind: 'canvas'; canvas: HTMLCanvasElement };

async function pdfSheets(bytes: ArrayBuffer): Promise<Sheet[]> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
  try {
    const sheets: Sheet[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 }); // 1 unit = 1 pt
      if (isNativeSize(base.width, base.height)) {
        sheets.push({ kind: 'page', index: n - 1 });
        continue;
      }

      // Where the label sits on the page, in points.
      const scan = page.getViewport({ scale: SCAN_DPI / 72 });
      const probe = makeCanvas(scan.width, scan.height);
      await page.render({ canvasContext: probe.ctx, viewport: scan }).promise;
      const found = inkBounds(probe.ctx, probe.canvas.width, probe.canvas.height);
      if (!found) continue; // blank page
      const k = 72 / SCAN_DPI;
      const region: Box = { x: found.x * k, y: found.y * k, w: found.w * k, h: found.h * k };

      // Render just that region, at the resolution it will fill the sheet at.
      const longPx = Math.max(SHEET_W_PX, SHEET_H_PX);
      const shortPx = Math.min(SHEET_W_PX, SHEET_H_PX);
      const scale = Math.min(
        longPx / Math.max(region.w, region.h),
        shortPx / Math.min(region.w, region.h),
      );
      const view = page.getViewport({ scale });
      const { canvas, ctx } = makeCanvas(region.w * scale, region.h * scale);
      await page.render({
        canvasContext: ctx,
        viewport: view,
        transform: [1, 0, 0, 1, -region.x * scale, -region.y * scale],
      }).promise;
      sheets.push({ kind: 'canvas', canvas: toSheet(canvas) });
      page.cleanup();
    }
    return sheets;
  } finally {
    await doc.destroy();
  }
}

async function imageSheet(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  try {
    const ratio = Math.min(bitmap.width, bitmap.height) / Math.max(bitmap.width, bitmap.height);
    // An image already shaped 2:3 is the label itself; anything else is
    // trimmed to the label on it first.
    if (Math.abs(ratio - SHEET_W_IN / SHEET_H_IN) < 0.02) return toSheet(bitmap);
    const { canvas, ctx } = makeCanvas(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);
    const found = inkBounds(ctx, canvas.width, canvas.height);
    if (!found) return toSheet(bitmap);
    const crop = makeCanvas(found.w, found.h);
    crop.ctx.drawImage(canvas, found.x, found.y, found.w, found.h, 0, 0, found.w, found.h);
    return toSheet(crop.canvas);
  } finally {
    bitmap.close();
  }
}

function pngBytes(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b.arrayBuffer()) : reject(new Error('Could not draw the label'))),
      'image/png',
    ),
  );
}

const pdfBlob = (bytes: Uint8Array) => new Blob([bytes as BlobPart], { type: 'application/pdf' });

/**
 * One label file (PDF or image) as a PDF of exact 4x6 pages, a page per
 * label page. A PDF that is already all 4x6 comes back untouched.
 */
export async function labelPdf4x6(blob: Blob): Promise<Blob> {
  const isImage = blob.type.startsWith('image/');
  const bytes = await blob.arrayBuffer();
  // pdf.js may take over the buffer it's given, so it reads a copy.
  const sheets: Sheet[] = isImage
    ? [{ kind: 'canvas', canvas: await imageSheet(blob) }]
    : await pdfSheets(bytes.slice(0));
  if (sheets.length === 0) throw new Error('The label file has no printable pages');
  if (!isImage && sheets.every((s) => s.kind === 'page')) {
    return new Blob([bytes], { type: 'application/pdf' });
  }

  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  const source = sheets.some((s) => s.kind === 'page')
    ? await PDFDocument.load(bytes, { ignoreEncryption: true })
    : null;
  for (const sheet of sheets) {
    if (sheet.kind === 'page') {
      const [page] = await out.copyPages(source!, [sheet.index]);
      out.addPage(page);
    } else {
      const png = await out.embedPng(await pngBytes(sheet.canvas));
      const page = out.addPage([SHEET_W_IN * 72, SHEET_H_IN * 72]);
      page.drawImage(png, { x: 0, y: 0, width: SHEET_W_IN * 72, height: SHEET_H_IN * 72 });
    }
  }
  return pdfBlob(await out.save());
}

/** Several 4x6 label PDFs (from `labelPdf4x6`) as one PDF, in order. */
export async function combineLabelPdfs(pdfs: Blob[]): Promise<Blob> {
  if (pdfs.length === 1) return pdfs[0];
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  for (const pdf of pdfs) {
    const src = await PDFDocument.load(await pdf.arrayBuffer(), { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return pdfBlob(await out.save());
}

/**
 * Print one label file as a 4x6 PDF. If the file can't be redrawn (an
 * unreadable PDF, an old browser) it is printed as-is rather than not at all.
 */
export async function printShippingLabel(blob: Blob): Promise<void> {
  let pdf = blob;
  try {
    pdf = await labelPdf4x6(blob);
  } catch (e) {
    console.warn('Could not fit the label to 4x6; printing the file as-is', e);
  }
  printPdfBlob(pdf);
}
