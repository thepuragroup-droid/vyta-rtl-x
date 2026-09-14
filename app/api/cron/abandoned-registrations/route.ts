import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getAdminAlertEmails } from '@/lib/admin/alert-recipients';
import { sendAbandonedRegistrationAlert } from '@/lib/email';

/**
 * GET /api/cron/abandoned-registrations
 *
 * Fires the "registered but never checked out" admin alert. Meant to run on a
 * schedule (hourly). Authenticated with CRON_SECRET, matching the pattern used
 * by /api/cron/check-payments.
 *
 * Scheduled via Supabase Cron (pg_cron + pg_net) — see
 * supabase-cron-abandoned-registrations.sql, which calls this endpoint with
 * `Authorization: Bearer <CRON_SECRET>`.
 *
 * A customer qualifies when:
 *   - they are an active 'customer' registered more than the configured delay
 *     ago (default 12h) but within the last 7 days (so first deploys don't
 *     blast historical accounts),
 *   - they have not been alerted before (abandoned_alert_sent_at IS NULL),
 *   - and they have never placed an order.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getSupabase();

  const { data: settings } = await db
    .from('site_settings')
    .select('abandoned_registration_enabled, abandoned_registration_hours')
    .limit(1)
    .maybeSingle();

  if (settings && settings.abandoned_registration_enabled === false) {
    return NextResponse.json({ skipped: 'disabled' });
  }

  const hours = Math.max(1, Number(settings?.abandoned_registration_hours) || 12);
  const now = Date.now();
  const cutoff = new Date(now - hours * 3600 * 1000).toISOString();
  // Don't alert on accounts older than 7 days (guards a first-run backlog).
  const floor = new Date(now - 7 * 24 * 3600 * 1000).toISOString();

  const { data: candidates, error } = await db
    .from('customers')
    .select('id, first_name, last_name, email, contact_consent, created_at')
    .eq('role', 'customer')
    .eq('active', true)
    .eq('has_completed_first_order', false)
    .is('abandoned_alert_sent_at', null)
    .lte('created_at', cutoff)
    .gte('created_at', floor)
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const list = candidates ?? [];
  if (list.length === 0) {
    return NextResponse.json({ checked: 0, alerted: 0 });
  }

  const recipients = await getAdminAlertEmails(db);

  let alerted = 0;
  for (const customer of list) {
    // Skip anyone who has actually placed an order (belt-and-suspenders on
    // top of has_completed_first_order).
    const { count } = await db
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customer.id);
    if ((count ?? 0) > 0) {
      // Mark as handled so we don't re-check them every run.
      await db.from('customers').update({ abandoned_alert_sent_at: new Date().toISOString() }).eq('id', customer.id);
      continue;
    }

    // Stamp first (at-most-once), then send.
    await db
      .from('customers')
      .update({ abandoned_alert_sent_at: new Date().toISOString() })
      .eq('id', customer.id);

    if (recipients.length === 0) continue;

    const name = `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim();
    const hoursElapsed = customer.created_at
      ? (now - new Date(customer.created_at).getTime()) / 3600000
      : hours;

    await sendAbandonedRegistrationAlert({
      to: recipients,
      customerName: name,
      customerEmail: customer.email,
      hoursElapsed,
      contactConsent: Boolean(customer.contact_consent),
      customerId: customer.id,
    }).catch((e) => console.error('abandoned alert send failed:', e));
    alerted++;
  }

  return NextResponse.json({ checked: list.length, alerted });
}
