/**
 * Referral code client for the AFFILIATE PORTAL.
 *
 * Everything goes through the API, never the browser Supabase client:
 * `referral_code_requests` is closed to everyone but the service role.
 */
import { apiFetch } from '@/lib/api-fetch';

/**
 * The NARROW shape. No `decision_notes`, no `decided_by_name` — an affiliate
 * is told a request was declined and nothing more. The route selects exactly
 * these columns; keeping the type equally narrow is documentation that
 * survives refactors.
 */
export interface MyCodeRequest {
  id: string;
  requested_code: string;
  previous_code: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  source: 'affiliate' | 'admin';
  created_at: string;
  decided_at: string | null;
}

export interface ReferralCodeState {
  current: { code: string; uses: number; active: boolean } | null;
  pending_request: MyCodeRequest | null;
  history: MyCodeRequest[];
  suggestion: string | null;
}

export async function getMyReferralCode(): Promise<ReferralCodeState | null> {
  try {
    return await apiFetch<ReferralCodeState>('/api/affiliate/referral-code');
  } catch {
    return null;
  }
}

export async function checkReferralCode(
  code: string,
): Promise<{ available: boolean; reason: string | null }> {
  try {
    const result = await apiFetch<{ available: boolean; reason: string | null }>(
      `/api/affiliate/referral-code/check?code=${encodeURIComponent(code)}`,
    );
    return { available: result.available, reason: result.reason };
  } catch (error: any) {
    return { available: false, reason: error?.message ?? 'Could not check that code.' };
  }
}

export async function requestReferralCode(code: string): Promise<{
  success: boolean;
  granted?: boolean;
  current?: { code: string; uses: number; active: boolean } | null;
  request?: MyCodeRequest | null;
  error?: string;
}> {
  try {
    const result = await apiFetch<{
      granted: boolean;
      current?: { code: string; uses: number; active: boolean };
      request: MyCodeRequest | null;
    }>('/api/affiliate/referral-code', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    return {
      success: true,
      granted: result.granted,
      current: result.current ?? null,
      request: result.request,
    };
  } catch (error: any) {
    return { success: false, error: error?.message ?? 'Could not send the request.' };
  }
}

export async function withdrawReferralCodeRequest(): Promise<{ success: boolean; error?: string }> {
  try {
    await apiFetch('/api/affiliate/referral-code', { method: 'DELETE' });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message ?? 'Could not withdraw the request.' };
  }
}
