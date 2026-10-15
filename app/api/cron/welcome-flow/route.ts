import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { runWelcomeFlow } from '@/lib/welcome-flow/engine';

// Each run sends at most 40 emails; give SMTP room to answer them.
export const maxDuration = 60;

/**
 * GET /api/cron/welcome-flow
 *
 * Runs the welcome email flow: enrolls consenting new signups, stops anyone who
 * has purchased, and sends each active subscriber whatever email is due inside
 * their local send window. Safe to call as often as you like — every send is
 * claimed in the database first, so overlapping runs never double-send.
 *
 * Scheduled every 15 minutes via Supabase Cron — see
 * supabase-cron-welcome-flow.sql. Authenticated with CRON_SECRET, like the
 * other /api/cron routes.
 */
export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await runWelcomeFlow(getSupabase());
  return NextResponse.json(result);
}
