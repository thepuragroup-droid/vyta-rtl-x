/**
 * The "we didn't catch your shipping address" email.
 *
 * Sent from /admin/stealth-health (Orders tab) when a PuraMass hand-off has no address on
 * it. The tone is a friendly nudge, not a dunning notice — the customer has
 * already paid; we simply can't ship without knowing where to.
 *
 * The email restates the whole order (invoice number, line items, totals,
 * transaction id and the link to the PuraMass transaction) for one reason: a
 * bare "click here to enter your address" mail is indistinguishable from
 * phishing. Everything shown is something only we and the buyer know.
 *
 * SERVER ONLY — sends through the shared SMTP transport (lib/smtp.ts).
 */
import { sendMail, defaultFrom } from '@/lib/smtp';
import { aminocanShell, escapeHtml } from '@/lib/email';
import { formatAddressLines } from './puramass-address';
import { formatSummaryMoney, type OrderSummary } from './puramass-order-summary';

const BRONZE = '#9C8B5A';
const INK = '#1A1A1A';
const MUTED = '#6B7280';

function firstName(name: string | null | undefined): string {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first || 'there';
}

function itemRows(summary: OrderSummary): string {
  if (summary.items.length === 0) {
    return `<tr><td colspan="3" style="padding:12px 0; font-size:13px; color:${MUTED};">Your order items</td></tr>`;
  }
  return summary.items
    .map((item) => {
      const price =
        item.line_total != null
          ? `$${item.line_total.toFixed(2)}`
          : item.unit_price != null
            ? `$${(item.unit_price * item.quantity).toFixed(2)}`
            : '';
      return `<tr>
        <td style="padding:10px 0; border-bottom:1px solid #E5E7EB; font-size:14px; color:${INK};">
          ${escapeHtml(item.name)}
          ${item.sku ? `<div style="font-size:11px; color:#9CA3AF; font-family:monospace;">${escapeHtml(item.sku)}</div>` : ''}
        </td>
        <td style="padding:10px 0; border-bottom:1px solid #E5E7EB; font-size:14px; color:${MUTED}; text-align:center;">×${item.quantity}</td>
        <td style="padding:10px 0; border-bottom:1px solid #E5E7EB; font-size:14px; color:${INK}; text-align:right; white-space:nowrap;">${price}</td>
      </tr>`;
    })
    .join('');
}

function totalsRows(summary: OrderSummary): string {
  const row = (label: string, value: string, strong = false) => `
    <tr>
      <td style="padding:${strong ? '12px 0 0' : '4px 0'}; font-size:${strong ? '15px' : '13px'}; color:${strong ? INK : MUTED}; ${strong ? `font-weight:700; border-top:2px solid ${INK};` : ''}">${label}</td>
      <td style="padding:${strong ? '12px 0 0' : '4px 0'}; font-size:${strong ? '15px' : '13px'}; color:${INK}; text-align:right; ${strong ? `font-weight:700; border-top:2px solid ${INK};` : ''}">${value}</td>
    </tr>`;

  const rows: string[] = [];
  if (summary.subtotal != null) {
    rows.push(row('Subtotal', formatSummaryMoney(summary.subtotal, summary.currency)));
  }
  if (summary.shipping != null) {
    rows.push(row('Shipping', formatSummaryMoney(summary.shipping, summary.currency)));
  }
  if (summary.total != null) {
    rows.push(row('Total paid', formatSummaryMoney(summary.total, summary.currency), true));
  }
  return rows.join('');
}

function referenceRows(summary: OrderSummary): string {
  const cell = (label: string, value: string) => `
    <tr>
      <td style="padding:6px 0; font-size:12px; color:${MUTED}; width:140px;">${label}</td>
      <td style="padding:6px 0; font-size:13px; color:${INK}; font-family:monospace; word-break:break-all;">${value}</td>
    </tr>`;

  const rows: string[] = [];
  if (summary.invoice_number) rows.push(cell('Invoice', escapeHtml(summary.invoice_number)));
  if (summary.transaction_id) {
    const id = escapeHtml(summary.transaction_id);
    rows.push(
      cell(
        'Transaction',
        summary.transaction_link
          ? `<a href="${escapeHtml(summary.transaction_link)}" style="color:${BRONZE}; text-decoration:underline;">${id}</a>`
          : id,
      ),
    );
  }
  rows.push(cell('Order reference', escapeHtml(summary.reference)));
  rows.push(
    cell(
      'Placed',
      escapeHtml(
        new Date(summary.placed_at).toLocaleDateString('en-CA', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
      ),
    ),
  );
  return rows.join('');
}

export function buildMissingAddressEmailHtml(args: {
  summary: OrderSummary;
  link: string;
  /** Optional note an admin typed for this one customer. */
  note?: string | null;
}): string {
  const { summary, link, note } = args;
  const existing = formatAddressLines(summary.shipping_address);

  return aminocanShell(`
    <div style="padding: 32px 24px;">
      <h2 style="font-size:20px; font-weight:600; color:${INK}; margin:0 0 12px;">
        Hey ${escapeHtml(firstName(summary.customer_name))} — where should we send this?
      </h2>
      <p style="font-size:14px; line-height:1.6; color:${MUTED}; margin:0 0 16px;">
        Thanks for ordering with us! Everything went through on our side — we just didn't
        catch a shipping address with your order, so we can't get it moving yet.
      </p>
      <p style="font-size:14px; line-height:1.6; color:${MUTED}; margin:0 0 24px;">
        Tap the button below, fill in where you'd like it delivered, and we'll have your
        order processed and on its way <strong style="color:${INK};">within the next business day</strong>.
      </p>

      ${
        note
          ? `<div style="background:#FAF8F3; border-left:3px solid ${BRONZE}; padding:12px 16px; margin:0 0 24px;">
               <p style="font-size:13px; line-height:1.6; color:${INK}; margin:0;">${escapeHtml(note)}</p>
             </div>`
          : ''
      }

      <div style="text-align:center; margin:0 0 28px;">
        <a href="${escapeHtml(link)}"
           style="display:inline-block; padding:14px 32px; background:${INK}; color:#FFFFFF; text-decoration:none; border-radius:8px; font-size:15px; font-weight:600;">
          Add my shipping address
        </a>
        <p style="font-size:11px; color:#9CA3AF; margin:12px 0 0;">
          Takes about a minute. The link is private to your order.
        </p>
      </div>

      <div style="background:#F7F7F7; border-radius:8px; padding:16px 18px; margin:0 0 24px;">
        <p style="font-size:11px; color:${MUTED}; margin:0 0 10px; text-transform:uppercase; letter-spacing:0.06em;">Your order</p>
        <table style="width:100%; border-collapse:collapse; margin:0 0 12px;">
          <thead>
            <tr>
              <th style="text-align:left; padding:6px 0; border-bottom:2px solid #E5E7EB; font-size:10px; color:${MUTED}; text-transform:uppercase; letter-spacing:0.05em;">Item</th>
              <th style="text-align:center; padding:6px 0; border-bottom:2px solid #E5E7EB; font-size:10px; color:${MUTED}; text-transform:uppercase; letter-spacing:0.05em;">Qty</th>
              <th style="text-align:right; padding:6px 0; border-bottom:2px solid #E5E7EB; font-size:10px; color:${MUTED}; text-transform:uppercase; letter-spacing:0.05em;">Amount</th>
            </tr>
          </thead>
          <tbody>${itemRows(summary)}</tbody>
        </table>
        <table style="width:100%; border-collapse:collapse;">${totalsRows(summary)}</table>
      </div>

      <table style="width:100%; border-collapse:collapse; margin:0 0 24px;">
        <tbody>${referenceRows(summary)}</tbody>
      </table>

      ${
        existing.length > 0
          ? `<div style="border:1px solid #FDE68A; background:#FFFBEB; border-radius:8px; padding:14px 16px; margin:0 0 24px;">
               <p style="font-size:12px; color:#92400E; margin:0 0 6px; font-weight:600;">We have this on file — is it still right?</p>
               <p style="font-size:13px; color:#78350F; line-height:1.5; margin:0;">${existing.map((l) => escapeHtml(l)).join('<br/>')}</p>
             </div>`
          : ''
      }

      <p style="font-size:13px; line-height:1.6; color:${MUTED}; margin:0;">
        Something look off, or would you rather just reply with the address? Hit reply to this
        email and a real person will sort it out with you.
      </p>
    </div>
  `);
}

/** Plain-text fallback — some clients show it, and it helps deliverability. */
export function buildMissingAddressEmailText(args: {
  summary: OrderSummary;
  link: string;
  note?: string | null;
}): string {
  const { summary, link, note } = args;
  const lines: string[] = [];
  lines.push(`Hey ${firstName(summary.customer_name)},`);
  lines.push('');
  lines.push(
    "Thanks for ordering with us! Everything went through on our side — we just didn't catch a shipping address with your order, so we can't get it moving yet.",
  );
  lines.push('');
  lines.push(
    "Add your address here and we'll have the order processed and on its way within the next business day:",
  );
  lines.push(link);
  lines.push('');
  if (note) {
    lines.push(note);
    lines.push('');
  }
  lines.push('YOUR ORDER');
  for (const item of summary.items) {
    const price =
      item.line_total != null
        ? ` — $${item.line_total.toFixed(2)}`
        : item.unit_price != null
          ? ` — $${(item.unit_price * item.quantity).toFixed(2)}`
          : '';
    lines.push(`  ${item.name} x${item.quantity}${price}`);
  }
  if (summary.subtotal != null) {
    lines.push(`  Subtotal: ${formatSummaryMoney(summary.subtotal, summary.currency)}`);
  }
  if (summary.shipping != null) {
    lines.push(`  Shipping: ${formatSummaryMoney(summary.shipping, summary.currency)}`);
  }
  if (summary.total != null) {
    lines.push(`  Total paid: ${formatSummaryMoney(summary.total, summary.currency)}`);
  }
  lines.push('');
  if (summary.invoice_number) lines.push(`Invoice: ${summary.invoice_number}`);
  if (summary.transaction_id) lines.push(`Transaction: ${summary.transaction_id}`);
  if (summary.transaction_link) lines.push(`Transaction link: ${summary.transaction_link}`);
  lines.push(`Order reference: ${summary.reference}`);
  lines.push('');
  lines.push('Prefer to just reply with the address? Reply to this email and we will sort it out.');
  return lines.join('\n');
}

/** Subject line: recognisable, and not spammy. */
export function missingAddressSubject(summary: OrderSummary): string {
  const id = summary.invoice_number || summary.transaction_id?.slice(0, 10) || summary.reference;
  return `Quick one about your order ${id} — we need your shipping address`;
}

export async function sendMissingAddressEmail(args: {
  to: string;
  summary: OrderSummary;
  link: string;
  note?: string | null;
  replyTo?: string;
  /**
   * Optional copies — a second address for the same buyer, the sales person on
   * the account, a shared inbox. Visible to the customer, by design: a hidden
   * BCC on a "please send us your address" mail is the wrong default.
   */
  cc?: string[];
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const { to, summary, link, note, replyTo, cc } = args;
  return sendMail({
    from: defaultFrom(),
    to,
    ...(cc && cc.length > 0 ? { cc } : {}),
    subject: missingAddressSubject(summary),
    html: buildMissingAddressEmailHtml({ summary, link, note }),
    text: buildMissingAddressEmailText({ summary, link, note }),
    ...(replyTo ? { replyTo } : {}),
  });
}
