import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAdminAlertEmails } from '@/lib/admin/alert-recipients';
import { sendRegistrationAlert } from '@/lib/email';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/**
 * POST /api/customer/register-alert  { customerId }
 *
 * Sends the "new customer registered" admin alert. Called right after signup.
 *
 * Anti-abuse / idempotency:
 *   - The customer must exist and have been created in the last 10 minutes
 *     (a real just-completed signup), so this can't be used to spam alerts for
 *     arbitrary accounts.
 *   - registration_alert_sent_at is stamped BEFORE sending, so a retry can
 *     never send twice.
 */
export async function POST(req: NextRequest) {
  let body: { customerId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  const customerId = String(body.customerId ?? '').trim();
  if (!customerId) return NextResponse.json({ ok: false }, { status: 200 });

  const { data: customer } = await db
    .from('customers')
    .select('id, first_name, last_name, email, contact_consent, created_at, registration_alert_sent_at')
    .eq('id', customerId)
    .maybeSingle();

  if (!customer) return NextResponse.json({ ok: false }, { status: 200 });

  // Only alert for a genuinely fresh signup, and only once.
  if (customer.registration_alert_sent_at) {
    return NextResponse.json({ ok: true, alreadySent: true });
  }
  const createdMs = customer.created_at ? new Date(customer.created_at).getTime() : 0;
  if (!createdMs || Date.now() - createdMs > 10 * 60 * 1000) {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  // Respect the admin toggle.
  const { data: settings } = await db
    .from('site_settings')
    .select('registration_alert_enabled')
    .limit(1)
    .maybeSingle();
  if (settings && settings.registration_alert_enabled === false) {
    return NextResponse.json({ ok: true, disabled: true });
  }

  const recipients = await getAdminAlertEmails(db);
  if (recipients.length === 0) {
    return NextResponse.json({ ok: true, noRecipients: true });
  }

  // Stamp first to guarantee at-most-once.
  await db
    .from('customers')
    .update({ registration_alert_sent_at: new Date().toISOString() })
    .eq('id', customerId);

  const name = `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim();
  const result = await sendRegistrationAlert({
    to: recipients,
    customerName: name,
    customerEmail: customer.email,
    contactConsent: Boolean(customer.contact_consent),
    customerId,
  });

  return NextResponse.json({ ok: result.success });
}
