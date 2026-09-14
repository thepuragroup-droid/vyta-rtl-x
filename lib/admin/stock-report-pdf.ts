/**
 * Stock Report — PDF renderer (pdfkit).
 *
 * This is the ONLY real PDF in the report cluster: the printable HTML reports
 * become PDFs through the browser's print dialog, but an email attachment has
 * no browser, so this one is drawn by hand. Money-free by design, matching the
 * HTML variant. Uses pdfkit's built-in Helvetica so it runs on serverless Node.
 */
import PDFDocument from 'pdfkit';
import { drawInFooterStrip } from '../pdf-footer';
import { PO_STATUS_LABEL, type StockReport } from './stock-report';

const INK = '#161616';
const MUTED = '#6B7280';
const FAINT = '#9CA3AF';
const RULE = '#D2D5DA';
const ZEBRA = '#FAFAFA';
const SURFACE = '#F4F4F5';
const BRONZE = '#9C8B5A';
const GREEN_BG = '#D1FAE5';
const GREEN_FG = '#065F46';
const AMBER_BG = '#FEF3C7';
const AMBER_FG = '#92400E';
const RED_BG = '#FEE2E2';
const RED_FG = '#991B1B';

const MARGIN = 46;
/** Reserved strip at the foot of every page for the page-number rule. */
const FOOTER_STRIP = 64;

const ON_ORDER_NOTE =
  'On Order counts units from purchase orders that are still open — status ' +
  'Pending or Partially Fulfilled — and only the part that has not been ' +
  'received yet. A line that has fully landed already sits in Stock, so ' +
  'counting it again would double it. Need To Order is Min Quantity minus ' +
  '(Stock + On Order), floored at zero.';

/** Column widths as a fraction of the content width. */
const COL_RATIOS = [0.29, 0.19, 0.15, 0.12, 0.12, 0.13];
const COL_HEADERS = ['Product', 'Category', 'Stock', 'Min Qty', 'On Order', 'Need to Order'];

export interface StockReportPdfOptions {
  generatedAt?: Date;
}

export async function renderStockReportPdf(
  data: StockReport,
  opts: StockReportPdfOptions = {},
): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        bufferPages: true,
        info: {
          Title: 'PuraMass Stock Report',
          Author: 'PuraMass',
          Creator: 'PuraMass Admin',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const generatedAt = opts.generatedAt ?? new Date(data.generatedAt);

      drawTitle(doc, left, width, generatedAt);
      drawStats(doc, left, width, data);
      drawTable(doc, left, width, data);
      drawNote(doc, left, width, data);
      paginateFooters(doc);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function drawTitle(doc: any, left: number, width: number, generatedAt: Date): void {
  const top = doc.y;
  doc.font('Helvetica-Bold').fontSize(26).fillColor(INK).text('PURAMASS', left, top);
  const afterWordmark = doc.y;

  doc.font('Helvetica-Bold').fontSize(11).fillColor(BRONZE)
    .text('STOCK REPORT', left, afterWordmark + 2, { characterSpacing: 2 });
  doc.font('Helvetica').fontSize(10).fillColor(MUTED)
    .text(
      `Generated ${generatedAt.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}`,
      left,
      afterWordmark + 3,
      { width, align: 'right' },
    );

  const ruleY = Math.max(doc.y, afterWordmark + 18) + 8;
  doc.save().lineWidth(2).strokeColor(BRONZE)
    .moveTo(left, ruleY).lineTo(left + width, ruleY).stroke().restore();
  doc.y = ruleY + 18;
}

function drawStats(doc: any, left: number, width: number, data: StockReport): void {
  const gap = 10;
  const cardWidth = (width - gap * 3) / 4;
  const height = 66;
  const top = doc.y;

  const tiles = [
    { label: 'PRODUCTS', value: String(data.totals.products), meta: `${data.totals.active} active` },
    {
      label: 'STOCK ON HAND',
      value: `${data.totals.units}`,
      meta: `${data.totals.lowStock} low · ${data.totals.outOfStock} out`,
    },
    { label: 'ON ORDER', value: `${data.totals.onOrder}`, meta: 'units inbound' },
    {
      label: 'NEED TO ORDER',
      value: `${data.totals.needToOrder}`,
      meta: `${data.totals.needCount} product${data.totals.needCount === 1 ? '' : 's'}`,
      danger: data.totals.needToOrder > 0,
    },
  ];

  tiles.forEach((tile, i) => {
    const x = left + i * (cardWidth + gap);
    doc.save()
      .roundedRect(x, top, cardWidth, height, 8)
      .fillAndStroke('#FFFFFF', RULE)
      .restore();
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED)
      .text(tile.label, x + 12, top + 12, { width: cardWidth - 24, characterSpacing: 0.8 });
    doc.font('Helvetica-Bold').fontSize(20).fillColor(tile.danger ? RED_FG : INK)
      .text(tile.value, x + 12, top + 24, { width: cardWidth - 24 });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(tile.meta, x + 12, top + 49, { width: cardWidth - 24 });
  });

  doc.y = top + height + 22;
}

function columnXs(left: number, width: number): number[] {
  const xs: number[] = [];
  let x = left;
  for (const ratio of COL_RATIOS) {
    xs.push(x);
    x += width * ratio;
  }
  return xs;
}

function drawTableHeader(doc: any, left: number, width: number): void {
  const xs = columnXs(left, width);
  const y = doc.y;
  COL_HEADERS.forEach((header, i) => {
    const colWidth = width * COL_RATIOS[i] - 6;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED)
      .text(header.toUpperCase(), xs[i], y, {
        width: colWidth,
        align: i < 3 ? 'left' : 'right',
        characterSpacing: 0.6,
      });
  });
  const ruleY = y + 14;
  doc.save().lineWidth(1).strokeColor(RULE)
    .moveTo(left, ruleY).lineTo(left + width, ruleY).stroke().restore();
  doc.y = ruleY + 8;
}

function stockPill(doc: any, x: number, y: number, label: string, bg: string, fg: string): void {
  const textWidth = doc.font('Helvetica-Bold').fontSize(9.5).widthOfString(label);
  const pillWidth = textWidth + 14;
  doc.save().roundedRect(x, y - 2, pillWidth, 16, 8).fill(bg).restore();
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(fg).text(label, x + 7, y + 2, { lineBreak: false });
}

function drawTable(doc: any, left: number, width: number, data: StockReport): void {
  const xs = columnXs(left, width);
  const bottomLimit = doc.page.height - FOOTER_STRIP;

  drawTableHeader(doc, left, width);

  if (data.rows.length === 0) {
    doc.font('Helvetica').fontSize(10).fillColor(MUTED)
      .text('No products match the filters.', left, doc.y + 10, { width, align: 'center' });
    doc.y += 30;
    return;
  }

  data.rows.forEach((row, index) => {
    const rowHeight = row.strength ? 30 : 22;
    if (doc.y + rowHeight > bottomLimit) {
      doc.addPage();
      drawTableHeader(doc, left, width);
    }

    const top = doc.y;
    if (index % 2 === 1) {
      doc.save().rect(left, top - 4, width, rowHeight).fill(ZEBRA).restore();
    }

    doc.font('Helvetica').fontSize(10.5).fillColor(INK)
      .text(row.name, xs[0], top, { width: width * COL_RATIOS[0] - 6, lineBreak: false, ellipsis: true });
    if (row.strength) {
      doc.font('Helvetica').fontSize(8.5).fillColor(FAINT)
        .text(row.strength, xs[0], top + 12, { width: width * COL_RATIOS[0] - 6, lineBreak: false, ellipsis: true });
    }

    doc.font('Helvetica').fontSize(9.5).fillColor(MUTED)
      .text(row.category ?? '—', xs[1], top + 1, { width: width * COL_RATIOS[1] - 6, lineBreak: false, ellipsis: true });

    if (row.stock <= 0) stockPill(doc, xs[2], top, 'Out of stock', RED_BG, RED_FG);
    else if (row.minQty > 0 && row.stock <= row.minQty) {
      stockPill(doc, xs[2], top, `Low · ${row.stock}`, AMBER_BG, AMBER_FG);
    } else stockPill(doc, xs[2], top, String(row.stock), GREEN_BG, GREEN_FG);

    doc.font('Helvetica').fontSize(10.5).fillColor(INK)
      .text(row.minQty > 0 ? String(row.minQty) : '—', xs[3], top, {
        width: width * COL_RATIOS[3] - 6, align: 'right', lineBreak: false,
      });
    doc.font('Helvetica').fontSize(10.5).fillColor(INK)
      .text(row.onOrder > 0 ? String(row.onOrder) : '—', xs[4], top, {
        width: width * COL_RATIOS[4] - 6, align: 'right', lineBreak: false,
      });
    doc.font(row.needToOrder > 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(10.5)
      .fillColor(row.needToOrder > 0 ? AMBER_FG : INK)
      .text(row.needToOrder > 0 ? String(row.needToOrder) : '—', xs[5], top, {
        width: width * COL_RATIOS[5] - 6, align: 'right', lineBreak: false,
      });

    const ruleY = top + rowHeight - 4;
    doc.save().lineWidth(0.5).strokeColor(RULE)
      .moveTo(left, ruleY).lineTo(left + width, ruleY).stroke().restore();
    doc.y = top + rowHeight;
  });
}

function drawNote(doc: any, left: number, width: number, data: StockReport): void {
  const padding = 14;
  const innerWidth = width - padding * 2;

  doc.font('Helvetica').fontSize(9);
  const noteHeight = doc.heightOfString(ON_ORDER_NOTE, { width: innerWidth });
  const listHeight = data.contributingPos.length > 0
    ? 18 + data.contributingPos.length * 13
    : 18;
  const boxHeight = padding * 2 + 16 + noteHeight + listHeight;

  if (doc.y + boxHeight > doc.page.height - FOOTER_STRIP) doc.addPage();

  const top = doc.y + 8;
  doc.save().roundedRect(left, top, width, boxHeight, 8).fill(SURFACE).restore();

  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED)
    .text('HOW "ON ORDER" IS CALCULATED', left + padding, top + padding, {
      width: innerWidth, characterSpacing: 0.6,
    });
  doc.font('Helvetica').fontSize(9).fillColor(INK)
    .text(ON_ORDER_NOTE, left + padding, top + padding + 16, { width: innerWidth });

  const listTop = doc.y + 10;
  if (data.contributingPos.length > 0) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED)
      .text(`PURCHASE ORDERS CONSIDERED (${data.contributingPos.length})`, left + padding, listTop, {
        width: innerWidth, characterSpacing: 0.6,
      });
    let y = listTop + 13;
    for (const po of data.contributingPos) {
      const label = PO_STATUS_LABEL[po.status] ?? po.status;
      doc.font('Helvetica').fontSize(9).fillColor(INK)
        .text(`•  ${po.poNumber} — ${label} · ${po.units} units`, left + padding, y, {
          width: innerWidth, lineBreak: false, ellipsis: true,
        });
      y += 13;
    }
    doc.y = y;
  } else {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text('No open purchase orders are currently contributing to On Order.', left + padding, listTop, {
        width: innerWidth,
      });
  }
}

/**
 * Draw "Page N of M" on every page once the total is known. Each footer is
 * wrapped in `drawInFooterStrip` — without it pdfkit reads the strip as
 * overflow and emits a blank twin page for every page in the document.
 */
function paginateFooters(doc: any): void {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const y = doc.page.height - 40;

    drawInFooterStrip(doc, () => {
      doc.save().lineWidth(0.5).strokeColor(RULE)
        .moveTo(left, y - 8).lineTo(left + width, y - 8).stroke().restore();
      doc.font('Helvetica').fontSize(8.5).fillColor(FAINT)
        .text('PURAMASS · Stock Report', left, y, { width, align: 'left', lineBreak: false });
      doc.font('Helvetica').fontSize(8.5).fillColor(FAINT)
        .text(`Page ${i + 1} of ${range.count}`, left, y, { width, align: 'right', lineBreak: false });
    });
  }
}
