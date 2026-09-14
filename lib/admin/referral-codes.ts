/**
 * Referral code client for the ADMIN DESK.
 *
 * Note the split return on the write calls: `success` is about the CODE,
 * `notified` / `notifyError` are about the EMAIL. A failed send never turns
 * into `success: false` — the code is live either way.
 */
import { apiFetch } from '@/lib/api-fetch';
import type { ReferralCodeRequest } from '@/lib/supabase';

export interface AdminReferralCodeRequest extends ReferralCodeRequest {
  affiliate_name: string | null;
  affiliate_email: string | null;
}

export async function getReferralCodeRequests({
  status = 'pending',
  affiliateId,
  limit,
}: {
  status?: 'pending' | 'decided' | 'all';
  affiliateId?: string;
  limit?: number;
} = {}): Promise<AdminReferralCodeRequest[]> {
  const params = new URLSearchParams({ status });
  if (affiliateId) params.set('affiliate_id', affiliateId);
  if (limit) params.set('limit', String(limit));
  try {
    const result = await apiFetch<{ requests: AdminReferralCodeRequest[] }>(
      `/api/admin/referral-code-requests?${params.toString()}`,
    );
    return result.requests ?? [];
  } catch {
    return [];
  }
}

export async function decideReferralCodeRequest(
  id: string,
  action: 'approve' | 'reject',
  notes?: string,
  notify = true,
): Promise<{ success: boolean; error?: string; notified?: boolean; notifyError?: string | null }> {
  try {
    const result = await apiFetch<{ notified: boolean; notify_error: string | null }>(
      `/api/admin/referral-code-requests/${id}`,
      { method: 'POST', body: JSON.stringify({ action, notes: notes || null, notify }) },
    );
    return { success: true, notified: result.notified, notifyError: result.notify_error };
  } catch (error: any) {
    return { success: false, error: error?.message ?? 'Could not record the decision.' };
  }
}

export async function setAffiliateReferralCode(
  affiliateId: string,
  code: string,
  notify = true,
): Promise<{
  success: boolean;
  code?: string;
  error?: string;
  notified?: boolean;
  notifyError?: string | null;
}> {
  try {
    const result = await apiFetch<{
      current: { code: string } | null;
      notified: boolean;
      notify_error: string | null;
    }>(`/api/admin/affiliates/${affiliateId}/referral-code`, {
      method: 'PUT',
      body: JSON.stringify({ code, notify }),
    });
    return {
      success: true,
      code: result.current?.code,
      notified: result.notified,
      notifyError: result.notify_error,
    };
  } catch (error: any) {
    return { success: false, error: error?.message ?? 'Could not save the referral code.' };
  }
}

export async function suggestAffiliateReferralCode(affiliateId: string): Promise<string | null> {
  try {
    const result = await apiFetch<{ suggestion: string | null }>(
      `/api/admin/affiliates/${affiliateId}/referral-code`,
    );
    return result.suggestion ?? null;
  } catch {
    return null;
  }
}

export async function checkReferralCodeForAffiliate(
  code: string,
  affiliateId: string | null,
): Promise<{ available: boolean; reason: string | null }> {
  const params = new URLSearchParams({ code, affiliate_id: affiliateId ?? 'none' });
  try {
    const result = await apiFetch<{ available: boolean; reason: string | null }>(
      `/api/affiliate/referral-code/check?${params.toString()}`,
    );
    return { available: result.available, reason: result.reason };
  } catch (error: any) {
    return { available: false, reason: error?.message ?? 'Could not check that code.' };
  }
}
