import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { SITE_URL } from '@/lib/config';
import { readClick } from '@/lib/email-flows/tokens';

/**
 * GET /api/email-flows/click?t=<sendId>&u=<url>&s=<sig> — the click tracker.
 *
 * The signature covers the send AND the destination, so only links this
 * server wrote are followed — an edited `u` lands on the home page instead of
 * someone else's site.
 */
export async function GET(req: NextRequest) {
  const click = readClick(req.nextUrl.searchParams);
  if (!click) return NextResponse.redirect(SITE_URL, 302);
  try {
    await getSupabase().rpc('email_flow_track', { p_send_id: click.sendId, p_kind: 'click' });
  } catch {
    /* never block the customer on tracking */
  }
  return NextResponse.redirect(click.target, 302);
}
