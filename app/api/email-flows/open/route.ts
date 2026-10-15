import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { readIdToken } from '@/lib/email-flows/tokens';

/** A transparent 1x1 GIF. */
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/**
 * GET /api/email-flows/open?t=<sendId>.<sig> — the open pixel.
 *
 * Always answers with the pixel, whatever the token: a broken image in an
 * inbox helps nobody. Opens are a soft signal — Apple Mail preloads images and
 * many clients block them — so the admin reads clicks as the firmer number.
 */
export async function GET(req: NextRequest) {
  const sendId = readIdToken('open', req.nextUrl.searchParams.get('t'));
  if (sendId) {
    try {
      await getSupabase().rpc('email_flow_track', { p_send_id: sendId, p_kind: 'open' });
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
