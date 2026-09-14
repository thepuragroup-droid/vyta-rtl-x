/**
 * Browser-side data layer for the Stealth Health settlement dashboard.
 *
 * Mirrors lib/admin/analytics.ts: thin typed wrappers over the admin API using
 * apiFetch (which attaches the Supabase bearer token). Money crosses the wire
 * in integer cents and is formatted at the last moment, so nothing here ever
 * rounds twice.
 */
import { apiFetch } from '@/lib/api-fetch';
import type { Currency } from '@/lib/currency';
import type {
  SettlementTerms,
  SettlementTotals,
  SettlementInvoiceStatus,
} from '@/lib/admin/stealth-health';
import type { ReconcileResult } from '@/lib/admin/stealth-health-reconcile';
import type { StoredPull, PullDrift } from '@/lib/admin/partner-settlement-types';

export interface StealthHealthDailyPoint {
  date: string;
  orders: number;
  earned_cents: number;
  gross_cents: number;
}

export interface SettlementInvoiceDTO {
  id: string;
  invoice_number: string;
  status: SettlementInvoiceStatus;
  stored_status: string;
  currency: Currency;
  period_start: string | null;
  period_end: string | null;
  issue_date: string | null;
  due_date: string | null;
  order_count: number;
  units: number;
  gross_cents: number;
  refunds_cents: number;
  shipping_cents: number;
  fee_cents: number;
  amount_due_cents: number;
  paid_cents: number;
  balance_cents: number;
  commission_pct: number;
  flat_fee_cents: number;
  shipping_remitted: boolean;
  notes: string | null;
  sent_at: string | null;
  voided_at: string | null;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface SettlementPayoutDTO {
  id: string;
  invoice_id: string | null;
  invoice_number: string | null;
  amount_cents: number;
  currency: Currency;
  received_at: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
  created_by_email?: string | null;
  created_at: string;
}

export interface SettlementOrderDTO {
  id: string;
  currency: Currency;
  gross_cents: number;
  refunds_cents: number;
  net_cents: number;
  shipping_cents: number;
  fee_cents: number;
  due_cents: number;
  units: number;
  day: string | null;
  billed: boolean;
  excluded: boolean;
  settleable?: boolean;
  status?: string | null;
  partner_reference: string | null;
  transaction_id: string | null;
  customer_email: string | null;
  paid_at?: string | null;
  created_at?: string | null;
  invoice_id: string | null;
  settlement_invoice_id?: string | null;
}

export interface StealthHealthSummary {
  range: { from: string | null; to: string | null };
  migrated: boolean;
  terms_summary: string;
  currency: Currency;
  earned: SettlementTotals;
  unbilled: SettlementTotals;
  billed: SettlementTotals;
  excluded_orders: number;
  balance: {
    earned_cents: number;
    invoiced_cents: number;
    paid_cents: number;
    outstanding_cents: number;
    uninvoiced_cents: number;
    overdue_cents: number;
    open_invoices: number;
  };
  daily: StealthHealthDailyPoint[];
  daily_truncated: boolean;
  recent_invoices: Array<
    Pick<
      SettlementInvoiceDTO,
      | 'id' | 'invoice_number' | 'status' | 'currency' | 'period_start' | 'period_end'
      | 'issue_date' | 'due_date' | 'order_count' | 'amount_due_cents' | 'paid_cents'
      | 'balance_cents' | 'created_at'
    >
  >;
  recent_payouts: SettlementPayoutDTO[];
}

const qs = (params: Record<string, string | null | undefined>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export async function getStealthHealthSummary(
  range?: { from?: string | null; to?: string | null },
): Promise<StealthHealthSummary | null> {
  try {
    const r = await apiFetch<{ summary: StealthHealthSummary }>(
      `/api/admin/stealth-health/summary${qs({ from: range?.from, to: range?.to })}`,
      { cache: 'no-store' },
    );
    return r.summary ?? null;
  } catch (e) {
    console.error(e);
    return null;
  }
}

export async function getSettlementTerms(): Promise<{
  terms: SettlementTerms;
  migrated: boolean;
  summary: string;
} | null> {
  try {
    return await apiFetch('/api/admin/stealth-health/settings', { cache: 'no-store' });
  } catch (e) {
    console.error(e);
    return null;
  }
}

export async function saveSettlementTerms(
  patch: Partial<SettlementTerms>,
): Promise<{ terms: SettlementTerms; summary: string }> {
  return apiFetch('/api/admin/stealth-health/settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function listSettlementInvoices(opts?: {
  page?: number;
  pageSize?: number;
  status?: string;
}): Promise<{ invoices: SettlementInvoiceDTO[]; total: number; migrated: boolean }> {
  return apiFetch(
    `/api/admin/stealth-health/invoices${qs({
      page: opts?.page != null ? String(opts.page) : null,
      pageSize: opts?.pageSize != null ? String(opts.pageSize) : null,
      status: opts?.status,
    })}`,
    { cache: 'no-store' },
  );
}

export async function getSettlementInvoice(id: string): Promise<{
  invoice: SettlementInvoiceDTO;
  orders: SettlementOrderDTO[];
  payouts: SettlementPayoutDTO[];
}> {
  return apiFetch(`/api/admin/stealth-health/invoices/${id}`, { cache: 'no-store' });
}

export async function createSettlementInvoice(input: {
  period_start?: string | null;
  period_end?: string | null;
  issue_date?: string | null;
  notes?: string | null;
}): Promise<{ invoice: SettlementInvoiceDTO }> {
  return apiFetch('/api/admin/stealth-health/invoices', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateSettlementInvoice(
  id: string,
  patch: { status?: SettlementInvoiceStatus; notes?: string | null; due_date?: string | null },
): Promise<{ invoice: SettlementInvoiceDTO }> {
  return apiFetch(`/api/admin/stealth-health/invoices/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteSettlementInvoice(id: string): Promise<{ deleted: boolean }> {
  return apiFetch(`/api/admin/stealth-health/invoices/${id}`, { method: 'DELETE' });
}

export async function listSettlementPayouts(opts?: {
  page?: number;
  pageSize?: number;
  invoiceId?: string | null;
}): Promise<{ payouts: SettlementPayoutDTO[]; total: number; migrated: boolean }> {
  return apiFetch(
    `/api/admin/stealth-health/payouts${qs({
      page: opts?.page != null ? String(opts.page) : null,
      pageSize: opts?.pageSize != null ? String(opts.pageSize) : null,
      invoice_id: opts?.invoiceId,
    })}`,
    { cache: 'no-store' },
  );
}

export async function recordSettlementPayout(input: {
  amount_cents: number;
  invoice_id?: string | null;
  currency?: Currency;
  received_at?: string;
  method?: string | null;
  reference?: string | null;
  notes?: string | null;
}): Promise<{ payout: SettlementPayoutDTO }> {
  return apiFetch('/api/admin/stealth-health/payouts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deleteSettlementPayout(id: string): Promise<{ deleted: boolean }> {
  return apiFetch(`/api/admin/stealth-health/payouts/${id}`, { method: 'DELETE' });
}

export async function listSettlementOrders(opts?: {
  from?: string | null;
  to?: string | null;
  unbilledOnly?: boolean;
  limit?: number;
}): Promise<{
  orders: SettlementOrderDTO[];
  totals: SettlementTotals;
  truncated: boolean;
  matched: number;
  migrated: boolean;
}> {
  return apiFetch(
    `/api/admin/stealth-health/orders${qs({
      from: opts?.from,
      to: opts?.to,
      unbilled: opts?.unbilledOnly ? '1' : null,
      limit: opts?.limit != null ? String(opts.limit) : null,
    })}`,
    { cache: 'no-store' },
  );
}

export async function setOrderSettlementExcluded(
  id: string,
  excluded: boolean,
): Promise<{ id: string; settlement_excluded: boolean }> {
  return apiFetch(`/api/admin/stealth-health/orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ settlement_excluded: excluded }),
  });
}

// ---- Partner settlement feed ----------------------------------------------
// The partner's own per-appointment financials (GET /partner/settlement),
// reconciled against our hand-off ledger. Types come from the server modules
// as `import type` only, so nothing server-only is pulled into the bundle.

export interface PartnerSettlementView {
  window: { start: string; end: string };
  reconcile: ReconcileResult | null;
  pull: StoredPull | null;
  drift: PullDrift | null;
  migrated: boolean;
  configured: boolean;
  migration_hint?: string;
}

/**
 * Read a window we have already pulled. Never calls the partner — a window
 * that has not been pulled comes back with `reconcile: null`.
 */
export async function getPartnerSettlement(
  window: { start?: string | null; end?: string | null; year?: string | null },
): Promise<PartnerSettlementView | null> {
  try {
    return await apiFetch<PartnerSettlementView>(
      `/api/admin/stealth-health/partner-settlement${qs({
        start: window.start,
        end: window.end,
        year: window.year,
      })}`,
      { cache: 'no-store' },
    );
  } catch (e) {
    console.error(e);
    return null;
  }
}

/** Every pull taken so far, newest first. */
export async function getPartnerSettlementPulls(): Promise<{
  pulls: StoredPull[];
  migrated: boolean;
  configured: boolean;
} | null> {
  try {
    return await apiFetch('/api/admin/stealth-health/partner-settlement', {
      cache: 'no-store',
    });
  } catch (e) {
    console.error(e);
    return null;
  }
}

/**
 * Pull a window live from the partner and snapshot it. Admin only.
 *
 * Given a long window can run to many pages, this allows far longer than the
 * default apiFetch timeout. Errors are thrown rather than swallowed: "the
 * endpoint isn't enabled for you yet" is something the operator must see.
 */
export async function pullPartnerSettlement(window: {
  start?: string | null;
  end?: string | null;
  year?: string | null;
  limit?: number;
}): Promise<PartnerSettlementView> {
  return apiFetch<PartnerSettlementView>('/api/admin/stealth-health/partner-settlement', {
    method: 'POST',
    body: JSON.stringify(window),
    timeoutMs: 120_000,
  });
}
