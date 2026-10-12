/**
 * The Stealth Health payout request, as a PDF.
 *
 * pdfkit with its built-in Helvetica (no font files, so it runs on the Node
 * serverless runtime), US Letter, vector. The brand comes from lib/brand.ts
 * and nowhere else, so every site's request has the same layout with its own
 * branding.
 *
 * Built from the orders as they stand, so it always matches the screen. It
 * only presents what is owed; it carries no payment instructions.
 */
import PDFDocument from 'pdfkit';
import { BRAND } from '@/lib/brand';
import {
  formatRate,
  sumOrders,
  type PayoutOrder,
  type PayoutRequestView,
} from '@/lib/admin/stealth-health-payouts';

const INK = '#07203A';
const MUTED = '#56707F';
const LIGHT = '#6E8898';
const LINE = '#DCE7EB';
const BAND = '#F1F5F7';

const PAGE_MARGIN = 48;
const FOOTER_SPACE = 40;

function money(cents: number | null | undefined): string {
  const n = (Number(cents) || 0) / 100;
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? '-' : ''}$${s}`;
}

function fmtDay(value: string | null | undefined, timeZone: string): string {
  if (!value) return '—';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    timeZone: dateOnly ? 'UTC' : timeZone,
  });
}

export interface PayoutPdfInput {
  request: PayoutRequestView;
  /** The orders on the request, as they stand. */
  orders: PayoutOrder[];
}

export function renderPayoutRequestPdf({ request, orders }: PayoutPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const tz = BRAND.timeZone;
      const doc = new PDFDocument({
        size: 'LETTER',
        margin: PAGE_MARGIN,
        bufferPages: true,
        info: {
          Title: `Payout request ${request.payout_number}`,
          Author: BRAND.name,
          Subject: `Payout request to Stealth Health from ${BRAND.name}`,
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = PAGE_MARGIN;
      const right = doc.page.width - PAGE_MARGIN;
      const width = right - left;
      const bottom = () => doc.page.height - PAGE_MARGIN - FOOTER_SPACE;

      const fit = (text: string, w: number): string => {
        if (doc.widthOfString(text) <= w) return text;
        let t = text;
        while (t.length > 1 && doc.widthOfString(`${t}…`) > w) t = t.slice(0, -1);
        return `${t}…`;
      };
      const cell = (text: string, x: number, y: number, w: number, align: 'left' | 'right' = 'left') => {
        doc.text(fit(text, w), x, y, { width: w, align, lineBreak: false });
      };

      // 1. Header ---------------------------------------------------------
      let y = PAGE_MARGIN;
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(26)
        .text(BRAND.wordmark, left, y, { characterSpacing: 3, lineBreak: false });

      doc.fillColor(BRAND.accent).font('Helvetica-Bold').fontSize(15)
        .text('PAYOUT REQUEST', left, y + 2, { width, align: 'right', characterSpacing: 1.5 });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(10)
        .text(request.payout_number, left, y + 22, { width, align: 'right' });
      doc.fillColor(MUTED).font('Helvetica').fontSize(9)
        .text(`Issued ${fmtDay(request.created_at, tz)}`, left, y + 36, { width, align: 'right' });

      if (request.status === 'void' || request.status === 'received') {
        const label = request.status === 'void' ? 'VOID' : 'RECEIVED';
        const color = request.status === 'void' ? '#B42318' : '#067647';
        doc.font('Helvetica-Bold').fontSize(8);
        const pw = doc.widthOfString(label) + 16;
        const px = right - pw;
        const py = y + 50;
        doc.roundedRect(px, py, pw, 15, 7.5).fillAndStroke('#FFFFFF', color);
        doc.fillColor(color).text(label, px, py + 4, { width: pw, align: 'center', characterSpacing: 1 });
      }

      y += 76;
      doc.moveTo(left, y).lineTo(right, y).lineWidth(0.75).strokeColor(LINE).stroke();

      // 2. From / To --------------------------------------------------------
      y += 14;
      const half = width / 2;
      const block = (label: string, lines: string[], x: number) => {
        doc.fillColor(LIGHT).font('Helvetica-Bold').fontSize(8)
          .text(label, x, y, { characterSpacing: 1 });
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(lines[0], x, y + 13);
        doc.font('Helvetica').fontSize(9.5).fillColor(MUTED);
        lines.slice(1).forEach((l, i) => doc.text(l, x, y + 28 + i * 13));
      };
      block('FROM', [BRAND.name, BRAND.website, BRAND.email], left);
      block('TO', ['Stealth Health'], left + half);
      y += 70;

      // 3. Summary band -------------------------------------------------------
      const live = sumOrders(orders);
      const isVoid = request.status === 'void';
      const due = isVoid ? request.snapshot.net_cents : live.net_cents;
      const count = isVoid ? request.snapshot.count : live.count;
      const period = request.period_start || request.period_end
        ? `${fmtDay(request.period_start, tz)} – ${fmtDay(request.period_end, tz)}`
        : '—';

      const bandH = 46;
      doc.rect(left, y, width, bandH).fill(BAND);
      const cells: Array<[string, string, number]> = [
        ['PERIOD', period, 0.4],
        ['ORDERS', String(count), 0.15],
        ['CURRENCY', 'CAD', 0.15],
        ['NET PAYOUT DUE', money(due), 0.3],
      ];
      let cx = left + 12;
      for (const [label, value, share] of cells) {
        const last = label === 'NET PAYOUT DUE';
        const cw = width * share - (last ? 24 : 12);
        doc.fillColor(LIGHT).font('Helvetica-Bold').fontSize(7.5)
          .text(label, cx, y + 10, { width: cw, align: last ? 'right' : 'left', characterSpacing: 0.8 });
        doc.fillColor(last ? BRAND.accent : INK).font('Helvetica-Bold').fontSize(last ? 13 : 10.5);
        cell(value, cx, y + 23, cw, last ? 'right' : 'left');
        cx += width * share;
      }
      y += bandH + 22;

      // 4. Orders -------------------------------------------------------------
      const cols = [
        { key: 'date', label: 'DATE PAID', w: 64, align: 'left' as const },
        { key: 'txn', label: 'TRANSACTION ID', w: 118, align: 'left' as const },
        { key: 'customer', label: 'CUSTOMER', w: width - 64 - 118 - 78 - 62 - 70, align: 'left' as const },
        { key: 'total', label: 'TOTAL (CAD)', w: 78, align: 'right' as const },
        { key: 'fee', label: 'FEE', w: 62, align: 'right' as const },
        { key: 'net', label: 'NET', w: 70, align: 'right' as const },
      ];
      const pad = 4;

      const tableHeader = () => {
        let x = left;
        doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5);
        for (const c of cols) {
          doc.text(c.label, x + pad, y, { width: c.w - pad * 2, align: c.align, characterSpacing: 0.6, lineBreak: false });
          x += c.w;
        }
        y += 13;
        doc.moveTo(left, y).lineTo(right, y).lineWidth(1.25).strokeColor(BRAND.accent).stroke();
        y += 6;
      };

      if (orders.length === 0) {
        doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(
          isVoid
            ? 'This request was voided and its orders were released. The figures above are as requested.'
            : 'No orders are on this request.',
          left, y, { width },
        );
        y = doc.y + 16;
      } else {
        tableHeader();
        const rowH = 30;
        orders.forEach((o, i) => {
          if (y + rowH > bottom()) {
            doc.addPage();
            y = PAGE_MARGIN;
            tableHeader();
          }
          let x = left;
          const top = y + 3;
          const sub = top + 12;
          const put = (key: string, main: string, under: string | null) => {
            const c = cols.find((k) => k.key === key)!;
            doc.fillColor(INK).font(key === 'net' ? 'Helvetica-Bold' : 'Helvetica').fontSize(key === 'txn' ? 8 : 9);
            cell(main, x + pad, top, c.w - pad * 2, c.align);
            if (under) {
              doc.fillColor(LIGHT).font('Helvetica').fontSize(7.5);
              cell(under, x + pad, sub, c.w - pad * 2, c.align);
            }
            x += c.w;
          };
          put('date', fmtDay(o.paid_at, tz), null);
          put('txn', o.transaction_id ?? '—', null);
          put('customer', o.customer_name ?? o.customer_email ?? '—', o.customer_name ? o.customer_email : null);
          put(
            'total',
            money(o.gross_cents),
            o.original_currency === 'USD' && o.original_total_cents != null
              ? `${money(o.original_total_cents)} USD`
              : null,
          );
          put('fee', money(o.fee_cents), formatRate(o.rate));
          put('net', money(o.net_cents), null);

          y += rowH;
          if (i < orders.length - 1) {
            doc.moveTo(left, y - 2).lineTo(right, y - 2).lineWidth(0.5).strokeColor(LINE).stroke();
          }
        });
        y += 8;
      }

      // 5. Totals ---------------------------------------------------------------
      if (y + 120 > bottom()) {
        doc.addPage();
        y = PAGE_MARGIN;
      }
      const tw = 250;
      const tx = right - tw;
      const totalRow = (label: string, value: string) => {
        doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text(label, tx, y, { width: tw / 2 });
        doc.fillColor(INK).font('Helvetica').fontSize(9.5).text(value, tx + tw / 2, y, { width: tw / 2, align: 'right' });
        y += 16;
      };
      const gross = isVoid ? request.snapshot.gross_cents : live.gross_cents;
      const fees = isVoid ? request.snapshot.fee_cents : live.fee_cents;
      doc.moveTo(tx, y).lineTo(right, y).lineWidth(0.75).strokeColor(LINE).stroke();
      y += 8;
      totalRow('Gross total', money(gross));
      totalRow('Processing fees', `-${money(fees)}`);
      y += 2;
      doc.rect(tx, y, tw, 28).fill(BRAND.accent);
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10.5)
        .text('Net payout due', tx + 10, y + 9, { width: tw / 2 });
      doc.fontSize(12).text(`${money(due)} CAD`, tx + tw / 2 - 10, y + 8, { width: tw / 2, align: 'right' });
      y += 36;

      if (orders.length > 0) {
        const byRate = new Map<string, number>();
        for (const o of orders) byRate.set(formatRate(o.rate), (byRate.get(formatRate(o.rate)) ?? 0) + 1);
        const breakdown = [...byRate.entries()]
          .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
          .map(([r, n]) => `${n} order${n === 1 ? '' : 's'} at ${r}`)
          .join(' · ');
        doc.fillColor(LIGHT).font('Helvetica').fontSize(8).text(breakdown, tx - 100, y, { width: tw + 100, align: 'right' });
        y = doc.y + 3;
        if (live.usd_count > 0 && request.usd_rate) {
          doc.text(
            `USD orders converted to CAD at 1 CAD = ${request.usd_rate.toFixed(4)} USD.`,
            tx - 100, y, { width: tw + 100, align: 'right' },
          );
          y = doc.y + 3;
        }
      }

      // 6. Notes ------------------------------------------------------------------
      if (request.notes) {
        y += 14;
        if (y + 50 > bottom()) {
          doc.addPage();
          y = PAGE_MARGIN;
        }
        doc.fillColor(LIGHT).font('Helvetica-Bold').fontSize(8)
          .text('NOTES', left, y, { characterSpacing: 1 });
        doc.fillColor(INK).font('Helvetica').fontSize(9.5)
          .text(request.notes, left, y + 13, { width: width * 0.65 });
      }

      // 7. Footer on every page -----------------------------------------------------
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        // Writing inside the bottom margin would otherwise start a new page.
        const savedBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        const fy = doc.page.height - PAGE_MARGIN - 10;
        doc.moveTo(left, fy - 8).lineTo(right, fy - 8).lineWidth(0.5).strokeColor(LINE).stroke();
        doc.fillColor(LIGHT).font('Helvetica').fontSize(8);
        doc.text(`${BRAND.website}  ·  ${BRAND.email}  ·  ${request.payout_number}`, left, fy, {
          width: width * 0.75, lineBreak: false,
        });
        doc.text(`Page ${i - range.start + 1} of ${range.count}`, left, fy, {
          width, align: 'right', lineBreak: false,
        });
        doc.page.margins.bottom = savedBottom;
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
