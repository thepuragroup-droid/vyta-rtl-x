// Print shipping labels on exact 4x6 pages, whatever page Easyship put them on.
//
// Easyship hands back labels as a PDF (occasionally an image). Shipments made
// before we asked for 4x6 labels — and any account still on the default —
// come as an A4/Letter page with the 4x6 label in one corner, so printing the
// file as-is shrinks the label and leaves the rest of the sheet blank.
//
// Each label page is drawn onto a 4x6 sheet at 300 dpi:
//   • a page that is already 4x6 is used whole, at its exact size;
//   • any other page is trimmed to the label printed on it (the white area
//     around it is dropped), turned upright if it lies sideways, and scaled
//     to fill the sheet.
// The sheets print from an HTML page whose @page size is 4in x 6in with no
// margins, so the print dialog picks a 4x6 paper size instead of Letter.

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

function isNativeSize(widthPt: number, heightPt: number): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) <= NATIVE_TOLERANCE_PT;
  const [short, long] = widthPt < heightPt ? [widthPt, heightPt] : [heightPt, widthPt];
  return near(short, SHEET_W_IN * 72) && near(long, SHEET_H_IN * 72);
}

async function pdfSheets(bytes: ArrayBuffer): Promise<HTMLCanvasElement[]> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
  try {
    const sheets: HTMLCanvasElement[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 }); // 1 unit = 1 pt

      // Where the label sits on the page, in points.
      let region: Box = { x: 0, y: 0, w: base.width, h: base.height };
      if (!isNativeSize(base.width, base.height)) {
        const scan = page.getViewport({ scale: SCAN_DPI / 72 });
        const { canvas, ctx } = makeCanvas(scan.width, scan.height);
        await page.render({ canvasContext: ctx, viewport: scan }).promise;
        const found = inkBounds(ctx, canvas.width, canvas.height);
        if (!found) continue; // blank page
        const k = 72 / SCAN_DPI;
        region = { x: found.x * k, y: found.y * k, w: found.w * k, h: found.h * k };
      }

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
      sheets.push(toSheet(canvas));
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

/** One label file (PDF or image) as 4x6 sheet images, a sheet per page. */
export async function labelSheets(blob: Blob): Promise<string[]> {
  const canvases = blob.type.startsWith('image/')
    ? [await imageSheet(blob)]
    : await pdfSheets(await blob.arrayBuffer());
  if (canvases.length === 0) throw new Error('The label file has no printable pages');
  return Promise.all(
    canvases.map(
      (c) =>
        new Promise<string>((resolve, reject) =>
          c.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('Could not draw the label'))), 'image/png'),
        ),
    ),
  );
}

/**
 * Print sheet images (from `labelSheets`) as one job of 4x6 pages, from an
 * off-screen frame so the page doesn't change. Takes ownership of the URLs.
 */
export function printSheets(sheetUrls: string[]): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: `${SHEET_W_IN}in`,
    height: `${SHEET_H_IN}in`,
    border: '0',
  });
  iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>Shipping label</title><style>
@page { size: ${SHEET_W_IN}in ${SHEET_H_IN}in; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
img { display: block; width: ${SHEET_W_IN}in; height: ${SHEET_H_IN}in; break-after: page; }
img:last-child { break-after: auto; }
</style></head><body>${sheetUrls.map((u) => `<img src="${u}" alt="">`).join('')}</body></html>`;

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    sheetUrls.forEach((u) => URL.revokeObjectURL(u));
    iframe.remove();
  };
  iframe.onload = async () => {
    const win = iframe.contentWindow;
    if (!win) return cleanup();
    try {
      await Promise.all([...win.document.images].map((img) => img.decode().catch(() => {})));
      win.addEventListener('afterprint', () => setTimeout(cleanup, 1000));
      win.focus();
      win.print();
    } catch {
      /* print blocked — the fallback timer below still cleans up */
    }
  };
  document.body.appendChild(iframe);
  // In case afterprint never fires.
  setTimeout(cleanup, 10 * 60_000);
}

/**
 * Print one label file on 4x6 pages. If the file can't be redrawn (an
 * unreadable PDF, an old browser) it is printed as-is rather than not at all.
 */
export async function printShippingLabel(blob: Blob): Promise<void> {
  let sheets: string[];
  try {
    sheets = await labelSheets(blob);
  } catch (e) {
    console.warn('Could not fit the label to 4x6; printing the file as-is', e);
    printPdfBlob(blob);
    return;
  }
  printSheets(sheets);
}
