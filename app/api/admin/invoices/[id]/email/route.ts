import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditServer } from '@/lib/admin/audit';
import { getInvoiceCaller, callerCanWrite } from '@/lib/admin/invoice-access';
import { renderInvoicePdf } from '@/lib/invoice-pdf';
import {
  fetchPuramassContext,
  isPuramassInvoice,
  centsToAmount,
} from '@/lib/admin/puramass-invoice';
import { sendInvoiceEmail } from '@/lib/invoice-mailer';
import {
  buildInvoiceMergeVars,
  renderTemplate,
  plainTextToHtml,
  DEFAULT_CUSTOMER_SUBJECT,
  DEFAULT_CUSTOMER_BODY,
  DEFAULT_ADMIN_SUBJECT,
  DEFAULT_ADMIN_BODY,
} from '@/lib/invoice-email-templates';

export const runtime = 'nodejs';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST /api/admin/invoices/[id]/email
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const caller = await getInvoiceCaller(db, req);
  if (!caller.ok || !callerCanWrite(caller.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const overrideTo: string | undefined = body?.to;
  const overrideBcc: string[] | undefined = Array.isArray(body?.bcc) ? body.bcc : undefined;

  // Load invoice + relations.
  const { data: inv, error } = await db
    .from('invoices')
    .select('*, customers!invoices_customer_id_fkey (first_name, last_name, email, phone)')
    .eq('id', params.id)
    .single();
  if (error || !inv) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  const { data: lineItems } = await db
    .from('invoice_line_items')
    .select('*')
    .eq('invoice_id', params.id);
  const { data: payments } = await db
    .from('payments')
    .select('*')
    .eq('invoice_id', params.id)
    .order('paid_at', { ascending: false });

  const amountPaid = (payments ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const amountDue = Math.max(0, Number(inv.total) - amountPaid);

  // A PuraMass sale keeps the buyer's contact, ship-to address and refunds on
  // the hand-off ledger rather than on the invoice — pull them so the emailed
  // PDF carries them, and so a guest buyer still gets a name and a recipient.
  const puramass = isPuramassInvoice(inv) ? await fetchPuramassContext(db, inv.id) : null;

  const customerName = inv.customers
    ? `${inv.customers.first_name} ${inv.customers.last_name}`
    : (inv.customer_name ?? puramass?.customer_name ?? null);
  const customerEmail =
    inv.customers?.email ?? inv.customer_email ?? puramass?.customer_email ?? null;

  // Resolve recipient: override → denormalized → joined customer email.
  const recipient = overrideTo || inv.customer_email || customerEmail;
  if (!recipient) {
    return NextResponse.json({ error: 'No recipient email available' }, { status: 400 });
  }

  // Resolve BCC: caller-supplied wins, else site_settings.invoice_cc_emails.
  let settings: any = null;
  try {
    const { data } = await db.from('site_settings').select('*').limit(1).single();
    settings = data;
  } catch {
    settings = null;
  }
  const bcc = overrideBcc ?? (Array.isArray(settings?.invoice_cc_emails) ? settings.invoice_cc_emails : []);

  // Render templates.
  const vars = buildInvoiceMergeVars({
    invoice_number: inv.invoice_number,
    customer_name: customerName,
    customer_email: customerEmail,
    total: inv.total,
    amount_due: amountDue,
    due_date: inv.due_date,
    issue_date: inv.issue_date,
    currency: inv.currency ?? 'CAD',
  });
  const custSubject = renderTemplate(settings?.invoice_customer_email_subject || DEFAULT_CUSTOMER_SUBJECT, vars);
  const custBody = renderTemplate(settings?.invoice_customer_email_body || DEFAULT_CUSTOMER_BODY, vars);
  const adminSubject = renderTemplate(settings?.invoice_admin_email_subject || DEFAULT_ADMIN_SUBJECT, vars);
  const adminBody = renderTemplate(settings?.invoice_admin_email_body || DEFAULT_ADMIN_BODY, vars);

  // Render the PDF attachment.
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderInvoicePdf({
      invoice_number: inv.invoice_number,
      issue_date: inv.issue_date,
      due_date: inv.due_date,
      status: inv.status,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: inv.customers?.phone ?? inv.customer_phone ?? puramass?.customer_phone ?? null,
      subtotal: Number(inv.subtotal),
      tax_total: Number(inv.tax_total),
      shipping_cost: Number(inv.shipping_cost),
      total: Number(inv.total),
      notes: inv.notes,
      amount_paid: amountPaid,
      amount_due: amountDue,
      line_items: (lineItems ?? []).map((li: any) => ({
        description: li.description,
        qty: Number(li.qty),
        unit_price: Number(li.unit_price),
        discount_pct: Number(li.discount_pct),
        line_total: Number(li.line_total),
      })),
      payments: (payments ?? []).map((p: any) => ({
        amount: Number(p.amount),
        method: p.method,
        paid_at: p.paid_at,
      })),
      puramass: puramass
        ? {
            transaction_id: puramass.transaction_id,
            partner_reference: puramass.partner_reference,
            status: puramass.status,
            paid_at: puramass.paid_at,
            customer_name: puramass.customer_name,
            customer_phone: puramass.customer_phone,
            shipping_address: puramass.shipping_address,
            shipping_address_source: puramass.shipping_address_source,
            refunded_total: centsToAmount(puramass.refunded_total_cents) ?? 0,
          }
        : null,
    });
  } catch (err: any) {
    console.error('renderInvoicePdf failed:', err);
    return NextResponse.json({ error: 'Failed to render invoice PDF' }, { status: 500 });
  }

  const filename = `${inv.invoice_number}.pdf`;

  // Send the customer copy (with PDF).
  const sent = await sendInvoiceEmail({
    to: recipient,
    subject: custSubject,
    html: plainTextToHtml(custBody),
    pdf: { filename, content: pdfBuffer },
  });

  // Send a separate admin/BCC copy (best-effort, never blocks success).
  if (bcc.length) {
    await sendInvoiceEmail({
      to: bcc[0],
      bcc: bcc.slice(1),
      subject: adminSubject,
      html: plainTextToHtml(adminBody),
      pdf: { filename, content: pdfBuffer },
    });
  }

  // Log the attempt.
  await db.from('invoice_email_log').insert({
    invoice_id: params.id,
    sent_by: caller.actor_id,
    sent_by_email: caller.actor_email,
    to_email: recipient,
    bcc_emails: bcc,
    subject: custSubject,
    message_id: sent.id ?? null,
    success: sent.success,
    error: sent.error ?? null,
  });

  if (!sent.success) {
    return NextResponse.json({ error: sent.error ?? 'Failed to send email' }, { status: 502 });
  }

  // On success: bump last-emailed tracking and promote draft → sent.
  const update: Record<string, unknown> = {
    last_emailed_at: new Date().toISOString(),
    last_emailed_by: caller.actor_id,
    last_emailed_by_email: caller.actor_email,
    updated_at: new Date().toISOString(),
  };
  if (inv.status === 'draft') update.status = 'sent';
  await db.from('invoices').update(update).eq('id', params.id);

  await logAuditServer(db, { actor_id: caller.actor_id, actor_email: caller.actor_email }, {
    action: 'invoice.emailed',
    entity_type: 'invoice',
    entity_id: params.id,
  });

  return NextResponse.json({ success: true, message_id: sent.id ?? null });
}
