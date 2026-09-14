import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canCreate } from '@/lib/permissions';
import type { UserRole } from '@/lib/permissions';

// ---------------------------------------------------------------------------
// Shared logic for the Lab Results admin API.
//
// Kept in a lib module (not a `route.ts`) so both route files —
// `/api/admin/lab-results` and `/api/admin/lab-results/[id]` — can import it.
// The App Router only treats HTTP-method exports in `route.ts` as handlers, so
// cross-importing helpers between route files is avoided.
// ---------------------------------------------------------------------------

export interface LabResult {
  id: string;
  report_url: string;
  product_name: string;
  lab: string;
  sample_id: string | null;
  compound: string | null;
  cas_number: string | null;
  purity_pct: number | null;
  method: string;
  matrix: string | null;
  receiving_date: string | null;
  registration_date: string | null;
  report_date: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CoveredProduct {
  id: string;
  name: string;
  slug: string | null;
  strength: string | null;
  category: string | null;
  image_url: string | null;
  box_image_url: string | null;
}

export type LabResultWithProducts = LabResult & { products: CoveredProduct[] };

/**
 * Verify a request against the Lab Results admin API.
 *
 * - read  (requireMutation=false) → admin OR assistant.
 * - write (requireMutation=true)  → admin only (canCreate).
 *
 * Reads the `Authorization: Bearer` token, resolves the Supabase user, then
 * looks up their `customers.role`.
 */
export async function verifyLabResultsAccess(
  supabase: SupabaseClient,
  request: NextRequest,
  requireMutation: boolean = false,
): Promise<{ authorized: boolean; role: UserRole; actor_id: string | null; actor_email: string | null }> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return { authorized: false, role: 'customer', actor_id: null, actor_email: null };
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return { authorized: false, role: 'customer', actor_id: null, actor_email: null };
    }

    const { data: customer } = await supabase
      .from('customers')
      .select('id, email, role')
      .eq('id', user.id)
      .single();

    const role = (customer?.role || 'customer') as UserRole;
    const actor_id = customer?.id ?? user.id;
    const actor_email = customer?.email ?? user.email ?? null;

    if (requireMutation) {
      return { authorized: canCreate(role), role, actor_id, actor_email };
    }

    return { authorized: role === 'admin' || role === 'assistant', role, actor_id, actor_email };
  } catch (err) {
    console.error('Error verifying lab-results access:', err);
    return { authorized: false, role: 'customer', actor_id: null, actor_email: null };
  }
}

/**
 * Whitelist of columns a client may set on a lab result. Anything outside this
 * list is dropped by `sanitizeLabResult`.
 */
export const LAB_RESULT_EDITABLE_FIELDS = [
  'report_url',
  'product_name',
  'lab',
  'sample_id',
  'compound',
  'cas_number',
  'purity_pct',
  'method',
  'matrix',
  'receiving_date',
  'registration_date',
  'report_date',
  'active',
] as const;

type EditableField = (typeof LAB_RESULT_EDITABLE_FIELDS)[number];

/**
 * Normalise an incoming payload into a clean column patch. The single choke
 * point that keeps arbitrary/unknown keys out of writes:
 *   - only whitelisted keys that are actually present are kept,
 *   - empty strings become null,
 *   - `purity_pct` is coerced to a number (or null),
 *   - `active` is coerced to a strict boolean.
 */
export function sanitizeLabResult(body: Record<string, unknown>): Partial<Record<EditableField, unknown>> {
  const patch: Partial<Record<EditableField, unknown>> = {};
  if (!body || typeof body !== 'object') return patch;

  for (const key of LAB_RESULT_EDITABLE_FIELDS) {
    if (!(key in body)) continue;
    const raw = body[key];

    if (key === 'active') {
      patch.active = raw === true || raw === 'true';
      continue;
    }

    if (key === 'purity_pct') {
      if (raw === null || raw === undefined || raw === '') {
        patch.purity_pct = null;
      } else {
        const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
        patch.purity_pct = Number.isFinite(n) ? n : null;
      }
      continue;
    }

    // All remaining fields are text/date columns: trim strings, empty → null.
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      patch[key] = trimmed === '' ? null : trimmed;
    } else if (raw === undefined) {
      patch[key] = null;
    } else {
      patch[key] = raw;
    }
  }

  return patch;
}

/**
 * Build a `Map<report_url, CoveredProduct[]>` by iterating every product's
 * `coa_url` array (a product with multiple COAs contributes to multiple
 * reports). Covered products are sorted by name.
 *
 * @param activeOnly when true, only active products are considered (public
 *        surface); when false, all products are (admin surface).
 */
export async function coveredProductsByReport(
  supabase: SupabaseClient,
  activeOnly: boolean,
): Promise<Map<string, CoveredProduct[]>> {
  let query = supabase
    .from('products')
    .select('id, name, slug, strength, category, image_url, box_image_url, coa_url')
    .not('coa_url', 'is', null);

  if (activeOnly) query = query.eq('active', true);

  const { data: products, error } = await query;
  if (error) throw new Error(error.message);

  const map = new Map<string, CoveredProduct[]>();
  for (const p of products ?? []) {
    const urls: string[] = Array.isArray(p.coa_url) ? p.coa_url : [];
    const covered: CoveredProduct = {
      id: p.id,
      name: p.name,
      slug: p.slug ?? null,
      strength: p.strength ?? null,
      category: p.category ?? null,
      image_url: p.image_url ?? null,
      box_image_url: p.box_image_url ?? null,
    };
    for (const url of urls) {
      if (!url) continue;
      const list = map.get(url);
      if (list) list.push(covered);
      else map.set(url, [covered]);
    }
  }

  for (const list of map.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  }

  return map;
}
