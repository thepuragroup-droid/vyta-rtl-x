import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Resolve the operational admin-alert recipient list, in priority order:
 *   site_settings.admin_emails -> ADMIN_ALERT_EMAILS env -> invoice_cc_emails.
 *
 * Shared by the low-stock, registration and abandoned-registration alerts so
 * they all target the same list configured in Admin → Settings.
 */
export async function getAdminAlertEmails(db: SupabaseClient): Promise<string[]> {
  try {
    const { data } = await db
      .from('site_settings')
      .select('admin_emails, invoice_cc_emails')
      .limit(1)
      .single();

    const fromSettings = Array.isArray(data?.admin_emails)
      ? (data!.admin_emails as string[]).filter(Boolean)
      : [];
    if (fromSettings.length > 0) return fromSettings;

    const fromEnv = (process.env.ADMIN_ALERT_EMAILS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (fromEnv.length > 0) return fromEnv;

    const fromCc = Array.isArray(data?.invoice_cc_emails)
      ? (data!.invoice_cc_emails as string[]).filter(Boolean)
      : [];
    return fromCc;
  } catch {
    return (process.env.ADMIN_ALERT_EMAILS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
}
