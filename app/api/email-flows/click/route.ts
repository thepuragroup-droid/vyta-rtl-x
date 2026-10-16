import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { SITE_URL } from '@/lib/config';
import { VISITOR_COOKIE } from '@/lib/analytics/attribution';
import {
  FLOW_CLICK_COOKIE,
  FLOW_CLICK_MAX_AGE,
  flowClickCookieValue,
  readClick,
} from '@/lib/email-flows/tokens';
import {
  classifyHit,
  countsTowardSendStats,
  linkKindOf,
  targetPathOf,
} from '@/lib/email-flows/engagement';
import { recordHit, sendForEvent } from '@/lib/email-flows/events';

/**
 * GET /api/email-flows/click?t=<sendId>&u=<url>&s=<sig> — the click tracker.
 *
 * The signature covers the send AND the destination, so only links this
 * server wrote are followed — an edited `u` lands on the home page instead of
 * someone else's site.
 *
 * Every click is logged (email_flow_events), but only a person's moves the
 * send's click counter and leaves the click cookie: mail security gateways
 * follow every link on delivery, and counting them would credit a flow with
 * engagement — and sales — it never had. See lib/email-flows/engagement.ts.
 */
export async function GET(req: NextRequest) {
  const click = readClick(req.nextUrl.searchParams);
  if (!click) return NextResponse.redirect(SITE_URL, 302);

  const response = NextResponse.redirect(click.target, 302);
  try {
    const db = getSupabase();
    const send = await sendForEvent(db, click.sendId);
    const now = new Date();
    const hit = classifyHit({
      kind: 'click',
      method: req.method,
      userAgent: req.headers.get('user-agent'),
      sentAt: send?.sent_at ?? null,
      now,
    });

    if (countsTowardSendStats('click', hit)) {
      await db.rpc('email_flow_track', { p_send_id: click.sendId, p_kind: 'click' });
    }

    if (send) {
      const path = targetPathOf(click.target);
      await recordHit(db, send, 'click', hit, {
        target_path: path,
        link_kind: linkKindOf(path),
        anonymous_id: req.cookies.get(VISITOR_COOKIE)?.value ?? null,
      });

      // The person's click travels to checkout in this cookie, which the
      // hand-off copies into the order's attribution snapshot. A newer click
      // replaces an older one: the latest email acted on is the one credited.
      if (!hit.machine) {
        response.cookies.set(
          FLOW_CLICK_COOKIE,
          flowClickCookieValue({ sendId: send.id, flow: send.flow, step: send.step, at: now.toISOString() }),
          {
            path: '/',
            sameSite: 'lax',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: FLOW_CLICK_MAX_AGE,
          },
        );
      }
    }
  } catch {
    /* never block the customer on tracking */
  }
  return response;
}
