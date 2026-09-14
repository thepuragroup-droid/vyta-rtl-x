/**
 * Operational / transactional alert senders.
 *
 * NOTE: this project sends mail through Resend (see lib/email.ts), not raw
 * SMTP. This module re-exports the relevant senders so callers can import
 * from `@/lib/email-smtp` per the architecture docs while the actual
 * implementation stays consolidated in lib/email.ts.
 */
export {
  sendBackInStockNotification,
  sendLowStockAlert,
} from '@/lib/email';
