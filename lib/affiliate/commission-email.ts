/**
 * Email the affiliate when a paid order credits them a commission.
 *
 * Called right after `recordAffiliateCommission` books a NEW commission row
 * (`recorded: true`) on the live paid-order path
 * (lib/payments/puramass-fulfillment.ts `creditAffiliate`). The unique index
 * on `commissions.invoice_id` means only one caller ever gets `recorded:
 * true` for an invoice, so this goes out once per order with no claim of its
 * own. Admin backfills of old missed commissions don't call it.
 *
 * The admin notification list (`getAdminAlertEmails`, Admin → Settings) gets a
 * copy of the same email, sent separately so it goes out even when the
 * affiliate has no deliverable address or their send fails. An admin who is
 * also the affiliate isn't sent it twice.
 *
 * Every attempt is logged to `fulfillment_email_log` (kind
 * 'affiliate_commission', and 'affiliate_commission_admin_copy' for the
 * admins' copy). A failed send is logged, not retried.
 *
 * Never throws: a payment webhook must not fail because an email didn't send.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { SITE_URL } from '@/lib/config';
import { deliverableEmail } from '@/lib/order-confirmation-data';

const LOG_KIND = 'affiliate_commission';
const ADMIN_COPY_LOG_KIND = 'affiliate_commission_admin_copy';

export interface CommissionNotice {
  affiliateId: string;
  invoiceId: string;
  /** Commission booked. */
  amount: number;
  /** The base it was worked out on. */
  orderTotal: number;
  /** The code the sale came in on, if any. */
  code: string | null;
}

/** Whether the affiliate's own email went out; the admins' copy is logged on its own. */
export type CommissionNoticeOutcome =
  | { sent: true }
  | { sent: false; reason: 'no_affiliate' | 'no_email' | 'send_failed' | 'error' };

function trimOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

async function logAttempt(
  db: SupabaseClient,
  row: { invoice_id: string; to_email: string; subject: string; success: boolean; error: string | null; message_id: string | null },
  kind: string = LOG_KIND,
): Promise<void> {
  try {
    const { error } = await db.from('fulfillment_email_log').insert({
      ...row,
      order_id: null,
      sent_by: null,
      sent_by_email: null,
      kind,
    });
    if (error) console.error('[affiliate-email] logging the send failed:', error);
  } catch (err) {
    console.error('[affiliate-email] logging the send threw:', err);
  }
}

export async function notifyAffiliateOfCommission(
  db: SupabaseClient,
  notice: CommissionNotice,
): Promise<CommissionNoticeOutcome> {
  try {
    const { getAdminAlertEmails } = await import('@/lib/admin/alert-recipients');
    const [{ data: affiliate }, { data: invoice }, adminEmails] = await Promise.all([
      db
        .from('affiliates')
        .select('email, first_name, last_name')
        .eq('id', notice.affiliateId)
        .maybeSingle(),
      db
        .from('invoices')
        .select('invoice_number')
        .eq('id', notice.invoiceId)
        .maybeSingle(),
      getAdminAlertEmails(db),
    ]);
    if (!affiliate) return { sent: false, reason: 'no_affiliate' };
    const to = deliverableEmail(affiliate.email);

    const { sendAffiliateCommissionEmail } = await import('@/lib/email');
    const data = {
      affiliateName: [trimOrNull(affiliate.first_name), trimOrNull(affiliate.last_name)].filter(Boolean).join(' '),
      orderNumber: trimOrNull(invoice?.invoice_number) ?? notice.invoiceId,
      orderTotal: notice.orderTotal,
      commission: notice.amount,
      referralCode: trimOrNull(notice.code),
      dashboardUrl: `${SITE_URL}/affiliate/dashboard`,
    };

    const adminTo = adminEmails.filter((e) => !to || e.trim().toLowerCase() !== to.toLowerCase());
    if (adminTo.length > 0) {
      const copy = await sendAffiliateCommissionEmail(adminTo, data, { adminCopy: true });
      await logAttempt(
        db,
        {
          invoice_id: notice.invoiceId,
          to_email: adminTo.join(', '),
          subject: copy.subject,
          success: copy.success,
          error: copy.success ? null : copy.error ?? 'Failed to send email',
          message_id: copy.id ?? null,
        },
        ADMIN_COPY_LOG_KIND,
      );
      if (!copy.success) {
        console.error(`[affiliate-email] admin copy of the commission email for invoice ${notice.invoiceId} not sent: ${copy.error}`);
      }
    }

    if (!to) {
      console.warn(`[affiliate-email] affiliate ${notice.affiliateId} has no deliverable email — commission email not sent`);
      return { sent: false, reason: 'no_email' };
    }
    const res = await sendAffiliateCommissionEmail(to, data);
    await logAttempt(db, {
      invoice_id: notice.invoiceId,
      to_email: to,
      subject: res.subject,
      success: res.success,
      error: res.success ? null : res.error ?? 'Failed to send email',
      message_id: res.id ?? null,
    });
    return res.success ? { sent: true } : { sent: false, reason: 'send_failed' };
  } catch (err) {
    console.error(`[affiliate-email] commission email for invoice ${notice.invoiceId} failed:`, err);
    return { sent: false, reason: 'error' };
  }
}
