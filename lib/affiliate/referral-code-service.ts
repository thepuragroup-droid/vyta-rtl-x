/**
 * Referral code allocation — SERVER SIDE ONLY.
 *
 * Every function here takes a SERVICE-ROLE Supabase client. An anon client
 * sees `referral_code_requests` as empty (RLS is on with no policies) and
 * would happily report a claimed code as free.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  generateReferralCode,
  normalizeReferralCode,
  referralCodeFormatError,
  suggestReferralCodeVariants,
} from './utils';

export interface CodeAvailability {
  available: boolean;
  reason: string | null;
}

/** The strings the availability check hands back. The UI shows them verbatim. */
export const CODE_TAKEN = 'That code is already taken.';
export const CODE_IS_YOURS = 'That is already your code.';
export const CODE_SPOKEN_FOR = 'That code is already spoken for.';

/**
 * Is `rawCode` free for `affiliateId` to take?
 *
 * Order matters, and so do the exact reasons — they are shown to whoever
 * typed the code.
 *
 *   1. bad format                                        -> the format message
 *   2. held in referral_codes by somebody else           -> already taken
 *   3. held in referral_codes by this affiliate          -> already your code
 *   4. claimed by somebody else's PENDING request        -> already spoken for
 *
 * Step 4 is why a pending request is a real claim: without it two affiliates
 * are both told "yes" and the second approval dies at the unique index with an
 * error nobody can act on.
 */
export async function checkReferralCodeAvailability(
  db: SupabaseClient,
  rawCode: string,
  affiliateId?: string | null,
): Promise<CodeAvailability> {
  const code = normalizeReferralCode(rawCode);

  const formatError = referralCodeFormatError(code);
  if (formatError) return { available: false, reason: formatError };

  const { data: existing } = await db
    .from('referral_codes')
    .select('affiliate_id')
    .eq('code', code)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return existing.affiliate_id === affiliateId
      ? { available: false, reason: CODE_IS_YOURS }
      : { available: false, reason: CODE_TAKEN };
  }

  const { data: claimed } = await db
    .from('referral_code_requests')
    .select('affiliate_id')
    .eq('requested_code', code)
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle();

  if (claimed && claimed.affiliate_id !== affiliateId) {
    return { available: false, reason: CODE_SPOKEN_FOR };
  }

  return { available: true, reason: null };
}

/**
 * A code nobody else holds, for `person`.
 *
 * Walks the vanity ladder (AMC + surname + 10, then the initial variant, then
 * a trailing digit), then falls back to random codes, and finally returns a
 * candidate anyway and lets the unique index have the last word. Because it
 * never returns a code someone else holds, callers can insert without a retry
 * loop of their own.
 */
export async function proposeReferralCode(
  db: SupabaseClient,
  person: { first_name?: string | null; last_name?: string | null },
  affiliateId?: string | null,
): Promise<string> {
  for (const candidate of suggestReferralCodeVariants(person.first_name, person.last_name)) {
    const { available } = await checkReferralCodeAvailability(db, candidate, affiliateId);
    if (available) return candidate;
  }

  let fallback = generateReferralCode();
  for (let i = 0; i < 10; i++) {
    fallback = generateReferralCode();
    const { available } = await checkReferralCodeAvailability(db, fallback, affiliateId);
    if (available) return fallback;
  }

  // Ten random 8-character collisions in a row is not a real scenario; if it
  // happens anyway the unique index refuses the insert and the caller 409s.
  return fallback;
}

export interface AssignResult {
  ok: boolean;
  code?: string;
  error?: string;
  status?: number;
}

/**
 * THE one write path that puts a code on an affiliate.
 *
 * A code change RENAMES the affiliate's existing referral_codes row — it never
 * inserts a second one. `commissions.referral_code_id` points at that row and
 * `referral_codes.uses_count` is the number on the affiliate's dashboard; a
 * second row would strand the history behind a code nobody uses and reset the
 * count to zero. The old string stops working — that is the point of changing
 * it, and the admin editor says so out loud before saving.
 */
export async function assignReferralCode(
  db: SupabaseClient,
  affiliateId: string,
  rawCode: string,
): Promise<AssignResult> {
  const code = normalizeReferralCode(rawCode);

  const availability = await checkReferralCodeAvailability(db, code, affiliateId);
  // "That is already your code" is forgiven — assigning is idempotent.
  if (!availability.available && availability.reason !== CODE_IS_YOURS) {
    return { ok: false, error: availability.reason ?? CODE_TAKEN, status: 409 };
  }

  const { data: current } = await db
    .from('referral_codes')
    .select('id')
    .eq('affiliate_id', affiliateId)
    .order('active', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const { error } = current
    ? await db.from('referral_codes').update({ code, active: true }).eq('id', current.id)
    : await db.from('referral_codes').insert({ affiliate_id: affiliateId, code, active: true });

  if (error) {
    if (error.code === '23505') return { ok: false, error: CODE_TAKEN, status: 409 };
    console.error('assignReferralCode failed:', error);
    return { ok: false, error: 'Could not save the referral code.', status: 500 };
  }

  return { ok: true, code };
}

export interface CurrentCode {
  code: string;
  uses: number;
  active: boolean;
}

/**
 * The affiliate's live code. Ordered `active DESC, created_at ASC` — a
 * deactivated affiliate's codes are switched off rather than deleted, so
 * "prefer the active row" matters.
 */
export async function getCurrentReferralCode(
  db: SupabaseClient,
  affiliateId: string,
): Promise<CurrentCode | null> {
  const { data } = await db
    .from('referral_codes')
    .select('code, uses_count, active')
    .eq('affiliate_id', affiliateId)
    .order('active', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    code: data.code,
    uses: Number(data.uses_count ?? 0),
    active: data.active !== false,
  };
}

export interface NotifyResult {
  notified: boolean;
  error?: string;
}

/**
 * Tell the affiliate their code changed.
 *
 * SUCCESSFUL CHANGES ONLY — call this after the code is actually saved.
 *
 * NEVER THROWS AND NEVER FAILS THE CHANGE. A dead mailbox or an unconfigured
 * SMTP host must not turn a live code into an error an admin reads as "it did
 * not save". The outcome comes back as a value so the route can report
 * "saved, but the email did not go out".
 */
export async function notifyAffiliateOfCodeChange(
  db: SupabaseClient,
  affiliateId: string,
  { code, previousCode }: { code: string; previousCode?: string | null },
): Promise<NotifyResult> {
  try {
    const { data: affiliate } = await db
      .from('affiliates')
      .select('email, first_name')
      .eq('id', affiliateId)
      .maybeSingle();

    if (!affiliate?.email) {
      return { notified: false, error: 'This affiliate has no email address on file.' };
    }

    const { sendReferralCodeChanged } = await import('@/lib/email');
    const result = await sendReferralCodeChanged({
      to: affiliate.email,
      affiliateName: affiliate.first_name ?? '',
      newCode: code,
      previousCode: previousCode ?? null,
    });

    return result.success
      ? { notified: true }
      : { notified: false, error: result.error ?? 'The email could not be sent.' };
  } catch (err) {
    console.error('notifyAffiliateOfCodeChange threw:', err);
    return { notified: false, error: 'The email could not be sent.' };
  }
}
