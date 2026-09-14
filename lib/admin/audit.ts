import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as browserClient, getSupabase } from '@/lib/supabase';

export interface AuditActor {
  actor_id: string | null;
  actor_email: string | null;
}

export interface AuditEntry {
  action: string;
  entity_type: string;
  entity_id?: string | null;
}

export interface AuditLogRow {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
}

/**
 * Server-side audit log writer. Caller has already verified the bearer
 * token and resolved actor. `db` must be the service-role client.
 * Never throws.
 */
export async function logAuditServer(
  db: SupabaseClient,
  actor: AuditActor,
  entry: AuditEntry,
): Promise<void> {
  try {
    const { error } = await db.from('audit_logs').insert({
      actor_id: actor.actor_id,
      actor_email: actor.actor_email,
      action: entry.action,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id ?? null,
    });
    if (error) {
      console.error('logAuditServer insert failed:', error);
    }
  } catch (err) {
    console.error('logAuditServer threw:', err);
  }
}

/**
 * Browser-side audit log writer. Uses the shared anon client + the
 * current user's session to resolve actor.
 *
 * Note: under the default RLS policy the insert will be denied — this
 * is intentional. See docs/admin-audit-log.md §7.1. Never throws.
 */
export async function logAuditClient(entry: AuditEntry): Promise<void> {
  try {
    const { data: { user } } = await browserClient.auth.getUser();
    let actor_id: string | null = null;
    let actor_email: string | null = null;
    if (user) {
      actor_id = user.id;
      const { data: customer } = await browserClient
        .from('customers')
        .select('email')
        .eq('id', user.id)
        .single();
      actor_email = customer?.email ?? user.email ?? null;
    }

    const { error } = await browserClient.from('audit_logs').insert({
      actor_id,
      actor_email,
      action: entry.action,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id ?? null,
    });
    if (error) {
      console.error('logAuditClient insert failed:', error);
    }
  } catch (err) {
    console.error('logAuditClient threw:', err);
  }
}

/**
 * Server-only read helper. Always uses the service-role client.
 */
export async function getAuditLogs(limit = 200): Promise<AuditLogRow[]> {
  const clamped = Math.min(Math.max(limit, 1), 1000);
  const db = getSupabase();
  const { data, error } = await db
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(clamped);
  if (error) {
    console.error('getAuditLogs failed:', error);
    return [];
  }
  return (data ?? []) as AuditLogRow[];
}
