import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { SITE_URL } from '@/lib/config';
import { readIdToken } from '@/lib/email-flows/tokens';

/**
 * GET /api/email-flows/view?t=<sendId>.<sig> — the header's "View in browser".
 *
 * Serves the email exactly as it was sent (the stored copy), so the countdown,
 * code and cart are what the recipient got. The token is signed per send, so
 * nobody can read another person's email by guessing an id. A link that
 * doesn't check out goes to the store instead of an error page.
 */
export async function GET(req: NextRequest) {
  const sendId = readIdToken('view', req.nextUrl.searchParams.get('t'));
  if (!sendId) return NextResponse.redirect(SITE_URL, 302);
  const { data } = await getSupabase().from('email_flow_sends').select('body_html').eq('id', sendId).maybeSingle();
  if (!data?.body_html) return NextResponse.redirect(SITE_URL, 302);
  return new NextResponse(data.body_html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
