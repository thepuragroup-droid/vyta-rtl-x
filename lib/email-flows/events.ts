/**
 * Email flows — the event log. Server-only.
 *
 * Every write is best-effort: tracking is reporting, and nothing a customer
 * does (open an email, follow a link, pay) may wait on it or fail because of
 * it. Until email-flows-tracking-migration.sql runs, the table is missing and
 * every write is a silent no-op.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FlowKey, StepNumber } from './types';
import type { FlowClick, HitClassification, LinkKind } from './engagement';

type Db = SupabaseClient<any, any, any>;

export interface FlowEventRow {
  send_id: string | null;
  entry_id: string | null;
  flow: FlowKey;
  step: StepNumber | null;
  kind: 'open' | 'click' | 'checkout' | 'purchase';
  target_path?: string | null;
  link_kind?: LinkKind | null;
  machine?: boolean;
  machine_reason?: string | null;
  anonymous_id?: string | null;
  order_ref?: string | null;
  amount?: number | null;
  currency?: string | null;
}

export async function recordFlowEvent(db: Db, row: FlowEventRow): Promise<void> {
  try {
    await db.from('email_flow_events').insert(row);
  } catch {
    /* best-effort */
  }
}

/** The send a hit belongs to — what the event row is filed under. */
export async function sendForEvent(
  db: Db,
  sendId: string,
): Promise<{ id: string; entry_id: string; flow: FlowKey; step: StepNumber; sent_at: string | null } | null> {
  try {
    const { data } = await db
      .from('email_flow_sends')
      .select('id, entry_id, flow, step, sent_at')
      .eq('id', sendId)
      .maybeSingle();
    return (data as any) ?? null;
  } catch {
    return null;
  }
}

/** Log an open or click against its send. */
export async function recordHit(
  db: Db,
  send: { id: string; entry_id: string; flow: FlowKey; step: StepNumber },
  kind: 'open' | 'click',
  hit: HitClassification,
  extra: { target_path?: string | null; link_kind?: LinkKind | null; anonymous_id?: string | null } = {},
): Promise<void> {
  await recordFlowEvent(db, {
    send_id: send.id,
    entry_id: send.entry_id,
    flow: send.flow,
    step: send.step,
    kind,
    machine: hit.machine,
    machine_reason: hit.reason,
    ...extra,
  });
}

/**
 * A buyer who clicked a flow email has reached the hosted checkout. Logged at
 * hand-off, because that is the last moment their cookies are in reach — the
 * payment comes back later through a webhook that knows only an email.
 */
export async function recordFlowCheckout(
  db: Db,
  click: FlowClick | null,
  order: { ref: string; amount: number | null; currency: string | null; anonymousId?: string | null },
): Promise<void> {
  if (!click) return;
  let entryId: string | null = null;
  try {
    const { data } = await db.from('email_flow_sends').select('entry_id').eq('id', click.sendId).maybeSingle();
    entryId = (data as any)?.entry_id ?? null;
  } catch {
    /* the event still says which flow and step */
  }
  await recordFlowEvent(db, {
    send_id: click.sendId,
    entry_id: entryId,
    flow: click.flow,
    step: click.step,
    kind: 'checkout',
    anonymous_id: order.anonymousId ?? null,
    order_ref: order.ref,
    amount: order.amount,
    currency: order.currency,
  });
}

/**
 * Which flow entries (and which of their emails) opened the checkouts behind
 * these orders — so a buyer who clicked the email and then paid under a
 * different email address still counts as that entry's conversion.
 * `order_ref → entry_id → send_id`. Empty when the table isn't there.
 */
export async function checkoutEntriesByOrder(
  db: Db,
  refs: string[],
): Promise<Map<string, Map<string, string | null>>> {
  const out = new Map<string, Map<string, string | null>>();
  const unique = [...new Set(refs.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 200) {
    try {
      const { data, error } = await db
        .from('email_flow_events')
        .select('entry_id, send_id, order_ref')
        .eq('kind', 'checkout')
        .in('order_ref', unique.slice(i, i + 200))
        .order('created_at', { ascending: true });
      if (error) return out;
      for (const r of (data ?? []) as any[]) {
        if (!r.entry_id || !r.order_ref) continue;
        if (!out.has(r.order_ref)) out.set(r.order_ref, new Map());
        // Oldest first, so a later checkout from the same entry wins.
        out.get(r.order_ref)!.set(r.entry_id, r.send_id ?? null);
      }
    } catch {
      return out;
    }
  }
  return out;
}
