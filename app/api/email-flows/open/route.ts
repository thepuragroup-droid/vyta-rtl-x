import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { readIdToken } from '@/lib/email-flows/tokens';
import { classifyHit, countsTowardSendStats } from '@/lib/email-flows/engagement';
import { recordHit, sendForEvent } from '@/lib/email-flows/events';

/** A transparent 1x1 GIF. */
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/**
 * GET /api/email-flows/open?t=<sendId>.<sig> — the open pixel.
 *
 * Always answers with the pixel, whatever the token: a broken image in an
 * inbox helps nobody. Opens are a soft signal — Apple Mail preloads images and
 * many clients block them — so the admin reads clicks as the firmer number.
 * Each load is also logged with whether it looked automatic, so the analytics
 * can show opens net of prefetching.
 */
export async function GET(req: NextRequest) {
  const sendId = readIdToken('open', req.nextUrl.searchParams.get('t'));
  if (sendId) {
    try {
      const db = getSupabase();
      const send = await sendForEvent(db, sendId);
      const hit = classifyHit({
        kind: 'open',
        method: req.method,
        userAgent: req.headers.get('user-agent'),
        sentAt: send?.sent_at ?? null,
      });
      if (countsTowardSendStats('open', hit)) {
        await db.rpc('email_flow_track', { p_send_id: sendId, p_kind: 'open' });
      }
      if (send) await recordHit(db, send, 'open', hit);
    } catch {
      /* tracking is best-effort */
    }
  }
  return new Response(PIXEL, {
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(PIXEL.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    },
  });
}
