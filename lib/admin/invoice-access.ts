/**
 * Caller resolution for invoice API routes.
 *
 * Every invoice route runs with the service-role client (which bypasses
 * RLS), so the real authorization boundary is the per-route role check
 * resolved here.
 *
 * NOTE: Affiliate-scoped invoice access (read/create/edit limited to an
 * affiliate's bound customers or where they are the sales person) is a
 * planned future phase. The hooks below resolve the role but currently
 * only `admin` and `assistant` are granted any invoice access. When the
 * affiliate phase lands, wire scoping here and flip `canView`/`canWrite`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

export type CallerRole = 'admin' | 'assistant' | 'affiliate' | 'customer';

export interface InvoiceCaller {
  /** True when the caller may at least view invoices. */
  ok: boolean;
  role: CallerRole;
  actor_id: string | null;
  actor_email: string | null;
}

/**
 * Resolve the bearer token to a customer + role. Shared by the
 * list / detail / pdf / aging / payment / email routes.
 */
export async function getInvoiceCaller(
  db: SupabaseClient,
  req: NextRequest,
): Promise<InvoiceCaller> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  const empty: InvoiceCaller = { ok: false, role: 'customer', actor_id: null, actor_email: null };
  if (!token) return empty;

  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return empty;

  const { data } = await db
    .from('customers')
    .select('id, email, role')
    .eq('id', user.id)
    .single();

  const role = (data?.role ?? 'customer') as CallerRole;
  return {
    // Affiliate invoice access intentionally deferred → not `ok` yet.
    ok: role === 'admin' || role === 'assistant',
    role,
    actor_id: data?.id ?? user.id,
    actor_email: data?.email ?? user.email ?? null,
  };
}

/** Mutations (create/edit/delete/payments/email) are admin-only today. */
export function callerCanWrite(role: CallerRole): boolean {
  return role === 'admin';
}
