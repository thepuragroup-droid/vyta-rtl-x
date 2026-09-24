import { NextRequest, NextResponse } from 'next/server';
import { sendMail } from '@/lib/smtp';
import { escapeHtml, vytaShell } from '@/lib/email';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

/**
 * Public partner-program application (the /partners landing page).
 *
 * Unlike /api/affiliate-requests this needs no customer account: the form is
 * emailed straight to the VYTA inbox, with Reply-To set to the applicant so the
 * team can answer from Gmail. Nothing is written to the database.
 */
const APPLICATION_INBOX = process.env.PARTNER_APPLICATION_EMAIL || 'Vytabiosciences@gmail.com';

const LIMIT = { max: 3, windowMs: 10 * 60_000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FIELDS = {
  name: { label: 'Name', max: 120, required: true },
  email: { label: 'Email', max: 200, required: true },
  paymentEmail: { label: 'Payment email', max: 200, required: false },
  phone: { label: 'Phone', max: 40, required: false },
  website: { label: 'Website / social', max: 300, required: false },
  audience: { label: 'Audience size', max: 60, required: false },
  promotion: { label: 'How they will promote VYTA', max: 3000, required: true },
} as const;

type Field = keyof typeof FIELDS;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`partner-app:${ip}`, LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many submissions. Please try again in a few minutes.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // Honeypot: real visitors never see this field. Pretend success so bots move on.
  if (typeof body.company === 'string' && body.company.trim()) {
    return NextResponse.json({ ok: true });
  }

  const values = {} as Record<Field, string>;
  for (const key of Object.keys(FIELDS) as Field[]) {
    const def = FIELDS[key];
    const raw = typeof body[key] === 'string' ? body[key].trim() : '';
    if (def.required && !raw) {
      return NextResponse.json({ error: `${def.label} is required` }, { status: 400 });
    }
    if (raw.length > def.max) {
      return NextResponse.json({ error: `${def.label} is too long` }, { status: 400 });
    }
    values[key] = raw;
  }

  if (!EMAIL_RE.test(values.email)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
  }
  if (values.paymentEmail && !EMAIL_RE.test(values.paymentEmail)) {
    return NextResponse.json({ error: 'Enter a valid payment email address' }, { status: 400 });
  }
  if (body.agreedToTerms !== true) {
    return NextResponse.json({ error: 'You must agree to the terms' }, { status: 400 });
  }

  const rows = (Object.keys(FIELDS) as Field[])
    .map((key) => {
      const value = values[key] || '—';
      return `<tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #DCE7EB; font-size: 12px; color: #56707F; width: 170px; vertical-align: top;">${FIELDS[key].label}</td>
          <td style="padding: 10px 0; border-bottom: 1px solid #DCE7EB; font-size: 14px; color: #07203A; white-space: pre-wrap;">${escapeHtml(value)}</td>
        </tr>`;
    })
    .join('');

  const html = vytaShell(`
    <div style="padding: 32px;">
      <p style="font-size: 11px; font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase; color: #2E8A92; margin: 0 0 8px;">Partner Program</p>
      <h1 style="font-size: 22px; color: #07203A; margin: 0 0 20px;">New partner application</h1>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">${rows}</table>
      <p style="font-size: 12px; color: #56707F; margin: 20px 0 0;">Reply to this email to respond to ${escapeHtml(values.name)} directly.</p>
    </div>
  `);

  const text = (Object.keys(FIELDS) as Field[])
    .map((key) => `${FIELDS[key].label}: ${values[key] || '—'}`)
    .join('\n');

  const result = await sendMail({
    to: APPLICATION_INBOX,
    replyTo: values.email,
    subject: `Partner application — ${values.name.replace(/[\r\n]+/g, ' ')}`,
    html,
    text,
  });

  if (!result.success) {
    return NextResponse.json(
      { error: 'We could not send your application. Please try again or email us directly.' },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
