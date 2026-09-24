/**
 * Packing List — email orchestration.
 *
 * Loads the invoice + linked client + customer + line items, renders the
 * Packing List PDF (SKU/qty only, no pricing), and emails it to the
 * customer's client with a short branded HTML body. All fulfillment_email
 * writes go through the same log table as packed/shipped notifications.
 *
 * Called from two places:
 *   1. `POST /api/warehouse/queue/[id]/packing-list` — manual (re)send.
 *   2. `PATCH /api/warehouse/queue/[id]` — auto-fired via after() when a
 *      client shipment first reaches shipped/dropped_off.
 *
 * Never throws — returns a discriminated result so both call sites can
 * decide whether to surface an error to the user.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendMail } from '@/lib/smtp';
import {
  renderPackingListPdf,
  type PackingListInput,
  type PackingListLine,
} from './packing-list-pdf';

/** Fallback recipient when the client + customer have no email at all. */
const DEFAULT_CLIENT_EMAIL = process.env.PACKING_LIST_DEFAULT_EMAIL || 'aminoship@proton.me';

export interface SendPackingListOptions {
  /** Override the resolved recipient email (admin can force to a different address). */
  to?: string;
  /** Who triggered the send — logged to fulfillment_email_log.sent_by / _email. */
  actor_id?: string | null;
  actor_email?: string | null;
  /** Optional free-form note printed on the PDF and included in the email body. */
  notes?: string;
}

export type SendPackingListResult =
  | { ok: true; skipped: false; message_id: string | null; to: string; sent_at: string }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string };

function fullName(c: { first_name?: string | null; last_name?: string | null; email?: string | null } | null): string {
  if (!c) return '';
  const full = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
  return full || c.email || '';
}

export async function sendPackingList(
  db: SupabaseClient,
  invoiceId: string,
  opts: SendPackingListOptions = {},
): Promise<SendPackingListResult> {
  // Load the invoice + everything we need in one round trip. Client/order/
  // customer are all optional so we can produce a targeted skip message
  // for each missing dependency.
  const { data: invRaw, error: invErr } = await db
    .from('invoices')
    .select(`
      id, invoice_number, ships_to_client, client_id, customer_id, order_id, notes,
      packing_list_emailed_at, created_at,
      customer:customers!invoices_customer_id_fkey (id, first_name, last_name, email),
      client:customer_clients (id, first_name, last_name, address, city, state, postal_code, country, phone, email),
      order:orders!invoices_order_id_fkey (order_number),
      line_items:invoice_line_items (id, description, qty, price_type, product:products (sku, vials_per_box))
    `)
    .eq('id', invoiceId)
    .maybeSingle();

  if (invErr) return { ok: false, error: invErr.message };
  if (!invRaw) return { ok: false, error: 'Invoice not found' };
  // PostgREST's TS inference sometimes shapes joined relations as arrays
  // even for -to-one. Cast to `any` here — every field access below is
  // defensive already.
  const inv: any = invRaw;
  if (!inv.ships_to_client) {
    return { ok: true, skipped: true, reason: 'Not a client shipment' };
  }
  if (!inv.client) {
    return { ok: true, skipped: true, reason: 'Client record missing (was it deleted?)' };
  }
  if (!inv.client.address) {
    return { ok: true, skipped: true, reason: 'Client has no shipping address' };
  }

  // Recipient resolution: explicit override > client email > customer email > house default.
  const recipient =
    (opts.to && opts.to.trim())
      || (inv.client.email && inv.client.email.trim())
      || (inv.customer?.email && inv.customer.email.trim())
      || DEFAULT_CLIENT_EMAIL;

  const shipToName =
    fullName(inv.client as any)
      || fullName(inv.customer as any)
      || 'Customer';
  const billedToName = fullName(inv.customer as any) || 'Customer';

  const lines: PackingListLine[] = (inv.line_items ?? []).map((li: any) => ({
    description: li.description,
    sku: li.product?.sku ?? null,
    qty: Number(li.qty) || 0,
    price_type: li.price_type === 'vial' ? 'vial' : 'box',
    vials_per_box: li.product?.vials_per_box ?? null,
  }));
  if (lines.length === 0) {
    return { ok: true, skipped: true, reason: 'Invoice has no line items' };
  }

  const pdfInput: PackingListInput = {
    invoice_number: inv.invoice_number,
    order_number: inv.order?.order_number ?? null,
    issued_at: inv.created_at ?? null,
    notes: opts.notes ?? null,
    ship_to: {
      name: shipToName,
      company: null,
      address: inv.client.address,
      city: inv.client.city,
      state: inv.client.state,
      postal_code: inv.client.postal_code,
      country: inv.client.country,
      phone: inv.client.phone,
      email: inv.client.email,
    },
    billed_to_name: billedToName,
    line_items: lines,
  };

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderPackingListPdf(pdfInput);
  } catch (e: any) {
    return { ok: false, error: `PDF render failed: ${e?.message ?? 'unknown'}` };
  }

  const subject = `Packing List · ${inv.invoice_number}`;
  const bodyHtml = renderEmailBody({
    shipToName,
    billedToName,
    invoiceNumber: inv.invoice_number,
    orderNumber: inv.order?.order_number ?? null,
    notes: opts.notes ?? null,
  });
  const bodyText = renderEmailBodyText({
    shipToName,
    billedToName,
    invoiceNumber: inv.invoice_number,
    orderNumber: inv.order?.order_number ?? null,
    notes: opts.notes ?? null,
  });

  const mail = await sendMail({
    to: recipient,
    subject,
    html: bodyHtml,
    text: bodyText,
    attachments: [
      { filename: `packing-list-${inv.invoice_number}.pdf`, content: pdfBuffer },
    ],
  });

  const now = new Date().toISOString();

  // Log every attempt (success or fail) so the admin can audit deliveries.
  await db.from('fulfillment_email_log').insert({
    invoice_id: invoiceId,
    order_id: (inv as any).order_id ?? null,
    kind: 'packing_list',
    to_email: recipient,
    subject,
    message_id: mail.id ?? null,
    success: mail.success,
    error: mail.success ? null : (mail.error ?? 'send failed'),
    sent_by: opts.actor_id ?? null,
    sent_by_email: opts.actor_email ?? null,
  });

  if (!mail.success) {
    return { ok: false, error: mail.error ?? 'Failed to send packing list' };
  }

  // Stamp the invoice with delivery metadata so the UI can show a "Sent"
  // pill and the auto-send guard can short-circuit next time.
  await db.from('invoices').update({
    packing_list_emailed_at: now,
    packing_list_emailed_by: opts.actor_id ?? null,
    packing_list_emailed_to: recipient,
  }).eq('id', invoiceId);

  return { ok: true, skipped: false, message_id: mail.id ?? null, to: recipient, sent_at: now };
}

interface EmailVars {
  shipToName: string;
  billedToName: string;
  invoiceNumber: string;
  orderNumber: string | null;
  notes: string | null;
}

function renderEmailBody(v: EmailVars): string {
  const orderLine = v.orderNumber
    ? `<p style="margin:0 0 12px 0;color:#56707f">Order <strong>${escape(v.orderNumber)}</strong></p>`
    : '';
  const notesBlock = v.notes
    ? `<p style="margin:16px 0 0 0;padding:12px 14px;background:#f7fafb;border-left:3px solid #438b9e;border-radius:4px;color:#0E3F5F;font-size:13px;line-height:1.5">${escape(v.notes)}</p>`
    : '';
  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#07203a;background:#ffffff;padding:24px">
  <table role="presentation" width="100%" style="max-width:560px;margin:0 auto">
    <tr><td>
      <div style="font-weight:800;font-size:18px;letter-spacing:2px">VYTA</div>
      <div style="font-size:11px;color:#56707f;margin-bottom:20px">vytabio.com  ·  support@vytabio.com</div>
      <h2 style="margin:0 0 8px 0;font-size:20px">Packing list for ${escape(v.shipToName)}</h2>
      <p style="margin:0 0 12px 0;color:#56707f">
        Invoice <strong>${escape(v.invoiceNumber)}</strong>
      </p>
      ${orderLine}
      <p style="margin:0 0 12px 0">
        This shipment was arranged by <strong>${escape(v.billedToName)}</strong> on your behalf.
        The full itemized packing list is attached as a PDF — quantities only, no pricing.
      </p>
      ${notesBlock}
      <p style="margin:24px 0 0 0;color:#56707f;font-size:12px">
        Questions? Reply to this email or write us at support@vytabio.com.
      </p>
    </td></tr>
  </table>
</body></html>`;
}

function renderEmailBodyText(v: EmailVars): string {
  return [
    `VYTA  ·  vytabio.com`,
    ``,
    `Packing list for ${v.shipToName}`,
    `Invoice ${v.invoiceNumber}`,
    v.orderNumber ? `Order ${v.orderNumber}` : '',
    ``,
    `This shipment was arranged by ${v.billedToName} on your behalf.`,
    `The full itemized packing list is attached as a PDF — quantities only, no pricing.`,
    v.notes ? `\nNotes: ${v.notes}` : '',
    ``,
    `Questions? Reply to this email or write us at support@vytabio.com.`,
  ].filter(Boolean).join('\n');
}

function escape(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
