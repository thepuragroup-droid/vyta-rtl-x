/**
 * Invoice email sender.
 *
 * Delivers invoice mail (with optional PDF attachment) over the shared custom
 * SMTP transport defined in lib/smtp.ts — the same transport used for the
 * storefront/transactional emails in lib/email.ts.
 *
 * Required env:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM
 */
import { sendMail } from '@/lib/smtp';

export async function sendInvoiceEmail(opts: {
  to: string;
  bcc?: string[];
  subject: string;
  html: string;
  pdf?: { filename: string; content: Buffer };
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const { to, bcc, subject, html, pdf } = opts;
  return sendMail({
    to,
    ...(bcc && bcc.length ? { bcc } : {}),
    subject,
    html,
    ...(pdf ? { attachments: [{ filename: pdf.filename, content: pdf.content }] } : {}),
  });
}
