/**
 * Browser-side calls for the Stealth Health Payouts tab. The client only ever
 * sends ids; every figure is worked out on the server.
 */
import { supabase } from '@/lib/supabase';
import type { FeeType, FeeRates, PayoutOrder, PayoutRequestView } from '@/lib/admin/stealth-health-payouts';

const BASE = '/api/admin/stealth-health/payout-requests';

export interface PayoutData {
  orders: PayoutOrder[];
  requests: PayoutRequestView[];
  rates: FeeRates;
  usd_rate: number;
  time_zone: string;
  portal_snapshots: boolean;
}

export class PayoutApiError extends Error {
  status: number;
  setupRequired: boolean;
  constructor(message: string, status: number, setupRequired: boolean) {
    super(message);
    this.name = 'PayoutApiError';
    this.status = status;
    this.setupRequired = setupRequired;
  }
}

async function authHeader(): Promise<Record<string, string>> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  } catch {
    return {};
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(await authHeader()), ...init.headers },
  });
  if (!res.ok) {
    let body: any = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    throw new PayoutApiError(body?.error ?? `Request failed: ${res.status}`, res.status, Boolean(body?.setup_required));
  }
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const getPayoutData = () => call<PayoutData>('');

export const createPayoutRequest = (body: {
  order_ids: string[];
  period_start?: string | null;
  period_end?: string | null;
  notes?: string | null;
}) => post<{ request: PayoutRequestView; skipped: Array<{ id: string; reason: string }> }>('', body);

export const setFeeType = (order_ids: string[], fee_type: FeeType) =>
  post<{ ids: string[] }>('/orders', { action: 'fee', order_ids, fee_type });

export const markPaidOut = (order_ids: string[]) =>
  post<{ ids: string[] }>('/orders', { action: 'paid', order_ids });

export const undoPaidOut = (order_ids: string[]) =>
  post<{ ids: string[] }>('/orders', { action: 'unpaid', order_ids });

export const receivePayoutRequest = (id: string, amount: number | null, reference: string | null) =>
  post<{ ids: string[] }>(`/${encodeURIComponent(id)}`, { action: 'receive', amount, reference });

export const voidPayoutRequest = (id: string) =>
  post<{ voided: boolean }>(`/${encodeURIComponent(id)}`, { action: 'void' });

export const saveFeeRates = (rates: FeeRates) =>
  call<{ rates: FeeRates }>('/rates', { method: 'PUT', body: JSON.stringify(rates) });

/** Download `{payout_number}.pdf`. */
export async function downloadPayoutPdf(id: string, payoutNumber: string): Promise<void> {
  const res = await fetch(`${BASE}/${encodeURIComponent(id)}/pdf`, { headers: await authHeader() });
  if (!res.ok) {
    let message = `Could not build the PDF (${res.status})`;
    try { message = (await res.json()).error ?? message; } catch { /* not JSON */ }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${payoutNumber}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
