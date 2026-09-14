import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendStockReportEmail } from '@/lib/admin/stock-report-email';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/stock-report — scheduled Stock Report emailer.
 *
 * Meant to be invoked daily by Vercel Cron (or any external scheduler)
 * with `Authorization: Bearer $CRON_SECRET`. The endpoint decides
 * internally whether it's actually time to send based on the admin's
 * saved schedule:
 *
 *   daily:   send if last_sent_at is on a previous UTC day
 *   weekly:  send if last_sent_at is 7+ days ago (or never)
 *   monthly: send if last_sent_at falls in an earlier month
 *
 * This way a single daily cron ping covers all three cadences without
 * multiple schedules to maintain. When the toggle is off, or the guard
 * says "not yet", the call is a no-op and returns { sent: false, reason }.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: settings, error: settingsErr } = await db
    .from('site_settings')
    .select('id, stock_report_email_enabled, stock_report_email_recipients, stock_report_email_frequency, stock_report_email_last_sent_at')
    .limit(1)
    .maybeSingle();
  if (settingsErr) {
    return NextResponse.json({ error: settingsErr.message }, { status: 500 });
  }
  if (!settings) {
    return NextResponse.json({ sent: false, reason: 'no site_settings row' });
  }
  if (!settings.stock_report_email_enabled) {
    return NextResponse.json({ sent: false, reason: 'schedule disabled' });
  }

  const recipients: string[] = Array.isArray(settings.stock_report_email_recipients)
    ? settings.stock_report_email_recipients
    : [];
  if (recipients.length === 0) {
    return NextResponse.json({ sent: false, reason: 'no recipients configured' });
  }

  const frequency = (settings.stock_report_email_frequency ?? 'weekly') as
    | 'daily' | 'weekly' | 'monthly';
  const now = new Date();
  const last = settings.stock_report_email_last_sent_at
    ? new Date(settings.stock_report_email_last_sent_at)
    : null;

  if (!shouldFire(frequency, last, now)) {
    return NextResponse.json({
      sent: false,
      reason: 'not due yet',
      frequency,
      last_sent_at: settings.stock_report_email_last_sent_at,
    });
  }

  const result = await sendStockReportEmail(db, { recipients });

  // Advance the marker only on a real send so a transient SMTP failure
  // doesn't push the next attempt out by a whole cycle.
  if (result.success) {
    await db
      .from('site_settings')
      .update({ stock_report_email_last_sent_at: now.toISOString() })
      .eq('id', settings.id);
  }

  return NextResponse.json({
    sent: result.success,
    reason: result.success ? 'sent' : (result.error ?? 'send failed'),
    recipients: result.recipients,
    totals: result.totals,
    frequency,
  }, { status: result.success ? 200 : 500 });
}

/**
 * Decide whether the cadence guard is satisfied for the given last-sent
 * timestamp. `null` (or unparseable) last-sent always fires — first run.
 *
 * The thresholds sit deliberately UNDER the nominal period. The cron ticks
 * once a day at a fixed hour, so an exact "7 days" test skips a whole week
 * the moment a tick lands a few seconds early; 6.5 days lets an early tick
 * still count without ever firing twice in one cadence.
 */
const DUE_AFTER_HOURS: Record<'daily' | 'weekly' | 'monthly', number> = {
  daily: 20,
  weekly: 156,  // ~6.5 days
  monthly: 648, // ~27 days
};

function shouldFire(
  frequency: 'daily' | 'weekly' | 'monthly',
  last: Date | null,
  now: Date,
): boolean {
  if (!last || Number.isNaN(last.getTime())) return true;
  const hours = (now.getTime() - last.getTime()) / 3_600_000;
  return hours >= (DUE_AFTER_HOURS[frequency] ?? DUE_AFTER_HOURS.weekly);
}
