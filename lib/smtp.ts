/**
 * Shared SMTP transport (nodemailer + custom SMTP).
 *
 * Single source of truth for outbound mail. Both the storefront/transactional
 * senders (lib/email.ts) and the invoice mailer (lib/invoice-mailer.ts) send
 * through this one transport so the whole system uses the custom SMTP server
 * configured via SMTP_* env vars — no third-party email API involved.
 *
 * Required env:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD
 * Optional:
 *   SMTP_FROM  (falls back to SMTP_USER)
 */
import nodemailer, { type Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

/** The transport options built from SMTP_* env — shared by sending and the setup check. */
function smtpOptions() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!host || !user || !pass) {
    throw new Error('SMTP is not configured (set SMTP_HOST / SMTP_USER / SMTP_PASSWORD)');
  }
  return {
    host,
    port,
    // 465 = implicit TLS; 587 = STARTTLS.
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user, pass },
  };
}

export function getTransport(): Transporter {
  if (!transporter) transporter = nodemailer.createTransport(smtpOptions());
  return transporter;
}

/**
 * Connect, negotiate TLS and log in to the SMTP server without sending
 * anything — proves the SMTP_* settings work. A throwaway transport with short
 * timeouts, so a firewalled host fails in seconds rather than minutes.
 */
export async function verifySmtp(): Promise<{ ok: boolean; error?: string; ms: number }> {
  const started = Date.now();
  try {
    const t = nodemailer.createTransport({
      ...smtpOptions(),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    await t.verify();
    t.close();
    return { ok: true, ms: Date.now() - started };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'Could not connect', ms: Date.now() - started };
  }
}

/**
 * Default From header for all outbound mail. Prefers SMTP_FROM, then the
 * authenticating SMTP user, then the legacy EMAIL_FROM value.
 */
export function defaultFrom(): string {
  return (
    process.env.SMTP_FROM ||
    process.env.SMTP_USER ||
    process.env.EMAIL_FROM ||
    'VYTA <noreply@aminocan.com>'
  );
}

export interface SendMailOptions {
  to: string | string[];
  bcc?: string | string[];
  cc?: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; content: Buffer }>;
  /** Extra headers, e.g. List-Unsubscribe on marketing email. */
  headers?: Record<string, string>;
}

/**
 * Send a single email through the shared SMTP transport.
 * Returns a uniform { success, id, error } result and never throws.
 */
export async function sendMail(
  opts: SendMailOptions,
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const info = await getTransport().sendMail({
      from: opts.from || defaultFrom(),
      to: opts.to,
      ...(opts.cc ? { cc: opts.cc } : {}),
      ...(opts.bcc && (Array.isArray(opts.bcc) ? opts.bcc.length : opts.bcc)
        ? { bcc: opts.bcc }
        : {}),
      ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
      subject: opts.subject,
      ...(opts.html ? { html: opts.html } : {}),
      ...(opts.text ? { text: opts.text } : {}),
      ...(opts.attachments ? { attachments: opts.attachments } : {}),
      ...(opts.headers ? { headers: opts.headers } : {}),
    });
    return { success: true, id: info.messageId };
  } catch (err: any) {
    console.error('sendMail (SMTP) failed:', err);
    return { success: false, error: err?.message ?? 'Failed to send email' };
  }
}
