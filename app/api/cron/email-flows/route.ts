import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { runAllFlows } from '@/lib/email-flows/engine';
import { FLOW_KEYS } from '@/lib/email-flows/types';

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
  // Fails closed: with CRON_SECRET unset, "Bearer undefined" must not pass.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const db = getSupabase();
  // The heartbeat the setup check reads: the scheduler reached us with the
  // right secret. Silently skipped until email-flows-health-migration.sql runs.
  await db.from('email_flow_settings').update({ last_cron_at: new Date().toISOString() }).in('flow', FLOW_KEYS);
  const results = await runAllFlows(db);
  return NextResponse.json({ results });
}
