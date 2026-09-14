/**
 * Caller resolution for the referral-code routes.
 *
 * The admin-side resolvers elsewhere in this codebase only say yes to an
 * ACTIVE affiliate. That is right for invoices and wrong here: an affiliate
 * whose account has been switched off still has a code, still has history, and
 * an admin still needs to be able to look at both. So the resolver below
 * accepts the affiliates row in ANY state and leaves the judgement to the
 * route, which is where the rules differ per endpoint.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

export interface SignedInUser {
  id: string;
  email: string | null;
}

export interface AffiliateCaller {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  active: boolean;
  /**
   * This codebase has no `affiliates.status` column: an affiliates row only
   * exists once an application has been accepted, and `active` is what an
   * admin switches off afterwards. So the spec's three states collapse to two
   * here — an accepted affiliate is `approved`, a switched-off one `rejected`.
   * An applicant still in the queue has no affiliates row at all; their code
   * choice rides on `affiliate_requests.requested_code` until approval.
   */
  status: 'approved' | 'rejected';
}

export type AffiliateCallerResult =
  | { ok: true; affiliate: AffiliateCaller }
  | { ok: false; status: 401 | 403; error: string };

/** Bearer token -> the signed-in Supabase user, or null. */
export async function resolveSignedInUser(
  db: SupabaseClient,
  request: NextRequest,
): Promise<SignedInUser | null> {
  const token = request.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return null;
  return { id: user.id, email: user.email ?? null };
}

/** Bearer token -> the caller's affiliates row, whatever state it is in. */
export async function resolveAffiliateCaller(
  db: SupabaseClient,
  request: NextRequest,
): Promise<AffiliateCallerResult> {
  const user = await resolveSignedInUser(db, request);
  if (!user) return { ok: false, status: 401, error: 'Unauthorized' };

  const columns = 'id, email, first_name, last_name, active';

  let { data: affiliate } = await db
    .from('affiliates')
    .select(columns)
    .eq('id', user.id)
    .maybeSingle();

  // Affiliates created through the modern flows share the auth user's id.
  // Rows from the older self-serve signup carry their own uuid and are matched
  // by email — the same fallback AffiliateContext already relies on — so both
  // cohorts reach their own referral code.
  if (!affiliate && user.email) {
    const { data: byEmail } = await db
      .from('affiliates')
      .select(columns)
      .eq('email', user.email.toLowerCase())
      .limit(1)
      .maybeSingle();
    affiliate = byEmail;
  }

  if (!affiliate) {
    return { ok: false, status: 403, error: 'No affiliate profile for this account.' };
  }

  return {
    ok: true,
    affiliate: {
      id: affiliate.id,
      email: affiliate.email,
      first_name: affiliate.first_name,
      last_name: affiliate.last_name,
      active: affiliate.active !== false,
      status: affiliate.active === false ? 'rejected' : 'approved',
    },
  };
}

export interface StaffCaller {
  id: string;
  email: string | null;
  /** Used for `decided_by_name` — who declined a code, kept next to the note. */
  name: string | null;
  role: string | null;
}

export type StaffCallerResult =
  | { ok: true; staff: StaffCaller }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Bearer token -> an admin (or, when `allowAssistant`, an assistant).
 *
 * Assistants read the review queue; only admins decide. That split is passed
 * in by the route rather than assumed here.
 */
export async function resolveStaffCaller(
  db: SupabaseClient,
  request: NextRequest,
  { allowAssistant = false }: { allowAssistant?: boolean } = {},
): Promise<StaffCallerResult> {
  const user = await resolveSignedInUser(db, request);
  if (!user) return { ok: false, status: 401, error: 'Unauthorized' };

  const { data: customer } = await db
    .from('customers')
    .select('id, email, first_name, last_name, role')
    .eq('id', user.id)
    .maybeSingle();

  const role = customer?.role ?? null;
  const permitted = role === 'admin' || (allowAssistant && role === 'assistant');
  if (!permitted) return { ok: false, status: 403, error: 'Unauthorized' };

  const name = `${customer?.first_name ?? ''} ${customer?.last_name ?? ''}`.trim();
  return {
    ok: true,
    staff: {
      id: user.id,
      email: customer?.email ?? user.email ?? null,
      name: name || customer?.email || user.email || null,
      role,
    },
  };
}
