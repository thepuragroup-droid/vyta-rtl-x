/**
 * Affiliate payouts — what was actually sent to an affiliate, against what
 * they earned.
 *
 * `commissions` is what they earned; `affiliate_payouts` is what they were
 * paid. Recording a payout marks the commissions it settles as paid and points
 * them at it. Commissions marked paid before this ledger existed (the old
 * one-click "mark paid") have no payout row, so they are counted as paid out
 * separately rather than reappearing as owed.
 *
 * See affiliate-discount-codes-payouts-migration.sql.
 */

export const PAYOUT_METHODS = [
  { value: 'e_transfer', label: 'Interac e-Transfer' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'store_credit', label: 'Store credit' },
  { value: 'other', label: 'Other' },
] as const;

export type PayoutMethod = (typeof PAYOUT_METHODS)[number]['value'];

export function payoutMethodLabel(method: string | null | undefined): string {
  return PAYOUT_METHODS.find((m) => m.value === method)?.label ?? (method || 'Other');
}

export function isPayoutMethod(raw: unknown): raw is PayoutMethod {
  return PAYOUT_METHODS.some((m) => m.value === raw);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface CommissionForSummary {
  amount: number | string | null;
  order_total: number | string | null;
  status: string | null;
  payout_id?: string | null;
}

export interface PayoutForSummary {
  amount: number | string | null;
}

export interface AffiliateBalance {
  /** Goods revenue from every sale credited to them (cancelled excluded). */
  revenue: number;
  /** Sales credited to them. */
  orders: number;
  /** Commission earned, cancelled excluded. */
  earned: number;
  /** Sum of recorded payouts. */
  paidViaPayouts: number;
  /** Commissions marked paid with no payout record (legacy one-click). */
  paidUnrecorded: number;
  /** paidViaPayouts + paidUnrecorded. */
  paidOut: number;
  /** earned − paidOut. Negative means they were overpaid. */
  balance: number;
  /** Commissions still pending, and their total. */
  pendingCount: number;
  pendingAmount: number;
}

export function summarizeAffiliateBalance(
  commissions: CommissionForSummary[],
  payouts: PayoutForSummary[],
): AffiliateBalance {
  let revenue = 0;
  let orders = 0;
  let earned = 0;
  let paidUnrecorded = 0;
  let pendingCount = 0;
  let pendingAmount = 0;

  for (const c of commissions) {
    if (c.status === 'cancelled') continue;
    const amount = Number(c.amount) || 0;
    revenue += Number(c.order_total) || 0;
    orders += 1;
    earned += amount;
    if (c.status === 'paid' && !c.payout_id) paidUnrecorded += amount;
    if (c.status === 'pending') {
      pendingCount += 1;
      pendingAmount += amount;
    }
  }

  const paidViaPayouts = payouts.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const paidOut = paidViaPayouts + paidUnrecorded;

  return {
    revenue: round2(revenue),
    orders,
    earned: round2(earned),
    paidViaPayouts: round2(paidViaPayouts),
    paidUnrecorded: round2(paidUnrecorded),
    paidOut: round2(paidOut),
    balance: round2(earned - paidOut),
    pendingCount,
    pendingAmount: round2(pendingAmount),
  };
}
