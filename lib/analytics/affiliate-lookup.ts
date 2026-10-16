/**
 * Who owns these affiliate codes — for the affiliate breakdown on Analytics.
 * Server-only.
 *
 * A code is an affiliate's referral code (`referral_codes`) or one of their
 * discount codes shared as a `?ref=` link (`discount_codes.affiliate_id`) —
 * the same two places `resolveReferralCodeOwner` credits a commission from.
 * Batched, and joined by hand rather than embedded: `referral_codes` carries
 * two foreign keys to `affiliates`, and PostgREST refuses an ambiguous embed.
 *
 * Best-effort: a failed read costs the names, never the figures — the rows
 * then show the bare code.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AffiliateOwner } from './earnings-breakdown';

type Db = SupabaseClient<any, any, any>;

const CHUNK = 200;

export async function loadAffiliateOwners(db: Db, rawCodes: string[]): Promise<Map<string, AffiliateOwner>> {
  const out = new Map<string, AffiliateOwner>();
  const codes = [...new Set(rawCodes.filter(Boolean).map((c) => c.toUpperCase()))];
  if (!codes.length) return out;

  const idByCode = new Map<string, string>();
  try {
    for (let i = 0; i < codes.length; i += CHUNK) {
      const slice = codes.slice(i, i + CHUNK);
      const [ref, disc] = await Promise.all([
        db.from('referral_codes').select('code, affiliate_id').in('code', slice),
        db.from('discount_codes').select('code, affiliate_id').in('code', slice).not('affiliate_id', 'is', null),
      ]);
      // Discount codes first, so a live referral code wins a (rare) clash.
      for (const r of [...((disc.data ?? []) as any[]), ...((ref.data ?? []) as any[])]) {
        if (r.code && r.affiliate_id) idByCode.set(String(r.code).toUpperCase(), String(r.affiliate_id));
      }
    }

    const ids = [...new Set(idByCode.values())];
    const nameById = new Map<string, string | null>();
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data } = await db
        .from('affiliates')
        .select('id, first_name, last_name, email')
        .in('id', ids.slice(i, i + CHUNK));
      for (const a of (data ?? []) as any[]) {
        const name = [a.first_name, a.last_name].filter(Boolean).join(' ').trim();
        nameById.set(String(a.id), name || a.email || null);
      }
    }

    for (const [code, affiliateId] of idByCode) {
      out.set(code, { affiliateId, name: nameById.get(affiliateId) ?? null });
    }
  } catch {
    /* names are a nicety */
  }
  return out;
}
