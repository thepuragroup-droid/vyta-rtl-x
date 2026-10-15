import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { runAllFlows } from '@/lib/email-flows/engine';

// Each run sends at most 40 emails across both flows; give SMTP room to answer them.
export const maxDuration = 60;

/**
 * GET /api/cron/email-flows
 *
 * Runs every email flow — cart abandonment, then welcome: enrolls new
 * abandoned carts and consenting signups, stops anyone who has purchased, and
 * sends whatever email is due inside each person's local send window. Safe to
 * call as often as you like — every send is claimed in the database first, so
 * overlapping runs never double-send.
 *
 * Scheduled every 15 minutes via Supabase Cron — see
 * supabase-cron-email-flows.sql. Authenticated with CRON_SECRET, like the
 * other /api/cron routes.
 */
export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const results = await runAllFlows(getSupabase());
  return NextResponse.json({ results });
}
