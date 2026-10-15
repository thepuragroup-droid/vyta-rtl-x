import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { SITE_URL } from '@/lib/config';
import { unsubscribe } from '@/lib/email-flows/engine';
import { readIdToken } from '@/lib/email-flows/tokens';
import { escapeHtml } from '@/lib/email-flows/render';

/**
 * /api/email-flows/unsubscribe?t=<entryId>.<sig>
 *
 * GET shows a confirm button and changes nothing — mail scanners follow every
 * link in a message, and an unsubscribe on GET would quietly drop people who
 * never clicked it. POST does the unsubscribe; it is also the target of the
 * one-click `List-Unsubscribe-Post` header Gmail and Yahoo send.
 *
 * Unsubscribing takes the person out of every flow, suppresses the address
 * for good (guests included), and withdraws marketing consent on their account
 * (CASL: an unsubscribe covers the sender's commercial email, not one series).
 */
function page(title: string, body: string, form = ''): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" /><title>${escapeHtml(title)} · VYTA</title></head>
<body style="margin:0;background:#EDF3F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#07203A;">
  <main style="max-width:440px;margin:64px auto;padding:0 16px;">
    <div style="background:#fff;border:1px solid #DCE7EB;border-radius:14px;padding:32px 28px;text-align:center;">
      <img src="${SITE_URL}/images/vyta-logo.png" alt="VYTA Biosciences" width="130" style="display:block;margin:0 auto 24px;height:auto;" />
      <h1 style="font-size:20px;margin:0 0 10px;">${escapeHtml(title)}</h1>
      <p style="font-size:14px;line-height:1.6;color:#56707F;margin:0;">${body}</p>
      ${form}
    </div>
  </main>
</body></html>`;
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('t');
  if (!readIdToken('unsub', token)) {
    return page('Link not recognised', 'This unsubscribe link is incomplete or has expired. Reply to any of our emails and we will remove you by hand.');
  }
  const form = `
    <form method="post" style="margin-top:22px;">
      <input type="hidden" name="t" value="${escapeHtml(token ?? '')}" />
      <button type="submit" style="background:#0A2A4A;color:#fff;border:0;border-radius:8px;padding:12px 26px;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;cursor:pointer;">Unsubscribe</button>
    </form>`;
  return page('Unsubscribe from VYTA emails?', 'You will stop receiving our marketing emails, including cart reminders. Order and shipping emails still arrive.', form);
}

export async function POST(req: NextRequest) {
  // One-click posts carry the token in the URL; the confirm form posts it in the body.
  let token = req.nextUrl.searchParams.get('t');
  if (!token) {
    const form = await req.formData().catch(() => null);
    token = (form?.get('t') as string | null) ?? null;
  }
  const id = readIdToken('unsub', token);
  if (!id) return page('Link not recognised', 'This unsubscribe link is incomplete or has expired.');
  await unsubscribe(getSupabase(), id);
  return page("You're unsubscribed", `You won't receive any more marketing emails from VYTA. Changed your mind? <a href="${SITE_URL}" style="color:#438B9E;">Visit the store</a>.`);
}
