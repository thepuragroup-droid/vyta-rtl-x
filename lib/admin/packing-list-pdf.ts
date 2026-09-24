/**
 * Packing List PDF (pdfkit).
 *
 * Ship-with-parcel document for drop-ship client shipments. Lists SKU +
 * description + quantity ONLY — **no pricing** ever, because the recipient
 * (the customer's client) is typically not the one being billed.
 *
 * Rendered live from the invoice + client + line items and streamed back
 * as a Buffer so the caller can attach it to an email or serve it as a
 * download. Uses pdfkit's built-in Helvetica fonts (no font files needed),
 * so it runs on Node.js serverless.
 */
import PDFDocument from 'pdfkit';

export interface PackingListLine {
  description: string;
  sku: string | null;
  qty: number;
  /** Optional per-line box/vial hint — rendered as a small chip. */
  price_type?: 'box' | 'vial' | null;
  vials_per_box?: number | null;
}

export interface PackingListRecipient {
  /** Full name the parcel is addressed to (usually the customer). */
  name: string;
  /** Optional company / attention line. */
  company?: string | null;
  /** Street address — required for shipment addressing. */
  address: string;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface PackingListInput {
  invoice_number: string;
  order_number?: string | null;
  issued_at?: string | null;
  /** Free-form note shown under the address (usually left blank). */
  notes?: string | null;
  ship_to: PackingListRecipient;
  /** Name of the entity the invoice is billed to — printed as small
   *  "Prepared for" text so the client knows who arranged the shipment. */
  billed_to_name: string;
  line_items: PackingListLine[];
}

const INK = '#07203A';
const MUTED = '#56707F';
const RULE = '#DCE7EB';
const ACCENT = '#438B9E';

/**
 * Render a Packing List to a Buffer. Never throws — errors surface via
 * the caller's promise chain so `send-packing-list.ts` can log them.
 */
export async function renderPackingListPdf(input: PackingListInput): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 48, bottom: 48, left: 48, right: 48 },
        info: {
          Title: `Packing List ${input.invoice_number}`,
          Author: 'VYTA',
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;
      const width = right - left;

      // ---- Header
      doc.font('Helvetica-Bold').fontSize(18).fillColor(INK)
        .text('VYTA', left, doc.y, { continued: false });
      doc.font('Helvetica').fontSize(9).fillColor(MUTED)
        .text('vytabio.com  ·  support@vytabio.com');
      // Right-aligned document title on the same header band.
      const headerY = 48;
      doc.font('Helvetica-Bold').fontSize(16).fillColor(INK)
        .text('PACKING LIST', left, headerY, { width, align: 'right' });
      doc.font('Helvetica').fontSize(10).fillColor(MUTED)
        .text(input.invoice_number, left, headerY + 20, { width, align: 'right' });
      if (input.order_number) {
        doc.text(`Order ${input.order_number}`, left, headerY + 34, { width, align: 'right' });
      }
      if (input.issued_at) {
        const d = new Date(input.issued_at);
        if (!Number.isNaN(d.getTime())) {
          doc.text(
            `Issued ${d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })}`,
            left, headerY + 48, { width, align: 'right' },
          );
        }
      }

      doc.moveDown(3);
      // Rule under header.
      doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor(RULE).stroke();
      doc.moveDown(1);

      // ---- Ship-to / Prepared for grid
      const gridTop = doc.y;
      const colW = (width - 24) / 2;

      doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED)
        .text('SHIP TO', left, gridTop);
      doc.font('Helvetica-Bold').fontSize(12).fillColor(INK)
        .text(input.ship_to.name, left, doc.y + 2, { width: colW });
      if (input.ship_to.company) {
        doc.font('Helvetica').fontSize(10).fillColor(INK)
          .text(input.ship_to.company, left, doc.y, { width: colW });
      }
      doc.font('Helvetica').fontSize(10).fillColor(INK)
        .text(input.ship_to.address, left, doc.y, { width: colW });
      const cityLine = [
        input.ship_to.city,
        input.ship_to.state,
        input.ship_to.postal_code,
      ].filter(Boolean).join(', ');
      if (cityLine) {
        doc.text(cityLine, left, doc.y, { width: colW });
      }
      if (input.ship_to.country) {
        doc.text(input.ship_to.country, left, doc.y, { width: colW });
      }
      if (input.ship_to.phone) {
        doc.fillColor(MUTED).text(input.ship_to.phone, left, doc.y, { width: colW });
      }

      const rightColX = left + colW + 24;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED)
        .text('PREPARED FOR', rightColX, gridTop);
      doc.font('Helvetica-Bold').fontSize(12).fillColor(INK)
        .text(input.billed_to_name, rightColX, gridTop + 12, { width: colW });
      doc.font('Helvetica').fontSize(9).fillColor(MUTED)
        .text('This shipment was arranged on their behalf.', rightColX, doc.y, { width: colW });

      doc.moveDown(2);

      // ---- Items table
      const cols = {
        sku: left,
        desc: left + 90,
        chip: right - 190,
        qty: right - 40,
      };
      let y = doc.y + 8;
      doc.moveTo(left, y).lineTo(right, y).strokeColor(INK).lineWidth(1).stroke();
      doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED);
      y += 6;
      doc.text('SKU', cols.sku, y);
      doc.text('DESCRIPTION', cols.desc, y);
      doc.text('QTY', cols.qty, y, { width: 40, align: 'right' });
      y += 14;
      doc.moveTo(left, y).lineTo(right, y).strokeColor(RULE).stroke();
      y += 6;

      doc.font('Helvetica').fontSize(10).fillColor(INK);
      for (const li of input.line_items) {
        // Wrap description; keep the row within 3 lines and add a page
        // break if we get too close to the bottom.
        const descText = li.description || '';
        const descHeight = doc.heightOfString(descText, { width: cols.chip - cols.desc - 8 });
        if (y + Math.max(descHeight, 14) > doc.page.height - 130) {
          doc.addPage();
          y = 60;
        }
        doc.fillColor(MUTED).font('Helvetica').fontSize(9)
          .text(li.sku ?? '-', cols.sku, y, { width: 80 });
        doc.fillColor(INK).font('Helvetica').fontSize(10)
          .text(descText, cols.desc, y, { width: cols.chip - cols.desc - 8 });
        // Type chip (right of description).
        if (li.price_type) {
          const chipText = li.price_type === 'vial' ? 'VIAL' : 'BOX';
          doc.font('Helvetica-Bold').fontSize(8).fillColor(ACCENT)
            .text(chipText, cols.chip, y, { width: 140, align: 'left' });
          if (li.price_type === 'box' && Number(li.vials_per_box) > 0) {
            doc.font('Helvetica').fontSize(8).fillColor(MUTED)
              .text(`${li.vials_per_box} vials/box`, cols.chip + 34, y, { width: 100 });
          }
        }
        doc.font('Helvetica-Bold').fontSize(11).fillColor(INK)
          .text(String(li.qty), cols.qty, y, { width: 40, align: 'right' });
        y += Math.max(descHeight, 14) + 8;
        doc.moveTo(left, y - 4).lineTo(right, y - 4).strokeColor(RULE).stroke();
      }

      // ---- Totals line: sum of quantities (never money).
      const totalQty = input.line_items.reduce((s, l) => s + (Number(l.qty) || 0), 0);
      y += 6;
      doc.font('Helvetica-Bold').fontSize(11).fillColor(INK)
        .text('Total units', cols.desc, y, { width: 200 });
      doc.text(String(totalQty), cols.qty, y, { width: 40, align: 'right' });

      // ---- Notes block
      if (input.notes) {
        doc.moveDown(2);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED)
          .text('NOTES', left, doc.y);
        doc.font('Helvetica').fontSize(10).fillColor(INK)
          .text(input.notes, left, doc.y + 4, { width });
      }

      // ---- Footer band
      const footerY = doc.page.height - 60;
      doc.moveTo(left, footerY).lineTo(right, footerY).strokeColor(RULE).stroke();
      doc.font('Helvetica').fontSize(8).fillColor(MUTED)
        .text('VYTA  ·  vytabio.com', left, footerY + 8, { width, align: 'left' });
      doc.text(
        'No pricing shown on packing lists.',
        left, footerY + 8, { width, align: 'right' },
      );

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
