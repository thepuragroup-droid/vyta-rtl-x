import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canManageContent, type UserRole } from '@/lib/permissions';

/**
 * Shared actor resolution for the storefront-content admin routes
 * (announcements, site pages, articles).
 *
 * Every one of those routes needs the same three things — the caller's role,
 * their id and their email (for the audit log) — resolved from the bearer
 * token the browser sends, because the Supabase session lives in localStorage
 * rather than a cookie. Keeping it in one place means a permission change is a
 * one-line edit rather than six identical ones drifting apart.
 */

export interface ContentActor {
  role: UserRole;
  actor_id: string | null;
  actor_email: string | null;
}

const ANONYMOUS: ContentActor = { role: 'customer', actor_id: null, actor_email: null };

export async function resolveContentActor(
  db: SupabaseClient,
  req: NextRequest,
): Promise<ContentActor> {
  const header = req.headers.get('authorization');
  if (!header) return ANONYMOUS;
  try {
    const token = header.replace('Bearer ', '');
    const { data: { user }, error } = await db.auth.getUser(token);
    if (error || !user) return ANONYMOUS;
    const { data } = await db
      .from('customers')
      .select('id, email, role')
      .eq('id', user.id)
      .single();
    return {
      role: (data?.role ?? 'customer') as UserRole,
      actor_id: data?.id ?? user.id,
      actor_email: data?.email ?? user.email ?? null,
    };
  } catch {
    return ANONYMOUS;
  }
}

/** The actor, or null when they may not manage storefront content. */
export async function requireContentEditor(
  db: SupabaseClient,
  req: NextRequest,
): Promise<ContentActor | null> {
  const actor = await resolveContentActor(db, req);
  return canManageContent(actor.role) ? actor : null;
}

/**
 * Turn a Postgres error into something an operator can act on. The one failure
 * that is genuinely likely here is "the migration hasn't been run yet", and a
 * raw `relation "articles" does not exist` sends people hunting for a bug that
 * isn't in the code.
 */
export function contentErrorMessage(message: string, table: string): string {
  if (/does not exist|schema cache|could not find the/i.test(message)) {
    return `The ${table} table is missing — run pack-options-content-migration.sql.`;
  }
  return message;
}
