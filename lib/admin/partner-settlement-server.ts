/**
 * Storage for the partner settlement feed — snapshotting what
 * GET /partner/settlement returned, and reading it back.
 *
 * Every pull is kept rather than being read live and thrown away, because the
 * feed is not stable over time: the partner's own caveats say store cost is
 * joined from the CURRENT catalog rather than stamped at checkout, and that
 * CAD store products are summed as their USD-equivalent. The same window can
 * therefore answer differently next month. Keeping each pull with its
 * timestamp and its caveats is what turns that from a mystery into a
 * measurable drift between two snapshots.
 *
 * Schema arrives with stealth-health-partner-settlement-migration.sql. As
 * everywhere else in this area, migrations are applied by hand in the Supabase
 * SQL editor, so every read here degrades to "not migrated yet" instead of a
 * 500 when the tables aren't there.
 */
import { db, isMissingSchema } from '@/lib/admin/stealth-health-server';
import type {
  SettlementPull,
  SettlementCaveat,
  SettlementRow,
  SettlementTotalsReported,
} from '@/lib/payments/puramass-settlement';
import type { ReconcileResult } from '@/lib/admin/stealth-health-reconcile';
import type { StoredPull, PullDrift } from '@/lib/admin/partner-settlement-types';

export type { StoredPull, PullDrift };

export const MIGRATION_HINT =
  'Run stealth-health-partner-settlement-migration.sql in Supabase before pulling the partner settlement ledger.';

/** Rows per insert. Keeps a 400-day window off the statement size limit. */
const INSERT_CHUNK = 500;

const int = (v: unknown): number => {
  const n = Math.round(Number(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

/** Cents that may legitimately be absent — null survives as null. */
const nullableInt = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
};

export function shapePull(row: Record<string, any>): StoredPull {
  return {
    id: String(row.id),
    window_start: row.window_start ?? '',
    window_end: row.window_end ?? '',
    pulled_at: row.pulled_at ?? '',
    pulled_by_email: row.pulled_by_email ?? null,
    rows_returned: int(row.rows_returned),
    pages_fetched: int(row.pages_fetched),
    truncated: row.truncated === true,
    totals_reported: row.totals_reported === true,
    total_appointments: nullableInt(row.total_appointments),
    revenue_cents: int(row.revenue_cents),
    processing_fee_cents: int(row.processing_fee_cents),
    consult_fee_cents: int(row.consult_fee_cents),
    shipping_cents: nullableInt(row.shipping_cents),
    partner_split_cents: int(row.partner_split_cents),
    caveats: Array.isArray(row.caveats) ? (row.caveats as SettlementCaveat[]) : [],
    split_model_unconfigured: row.split_model_unconfigured === true,
  };
}

/**
 * Durable appointment → hand-off links an operator has confirmed.
 *
 * These take precedence over identifier matching, because a human knows more
 * than string equality does about which appointment paid for which hand-off.
 */
export async function loadAppointmentLinks(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const { data, error } = await db
    .from('stealth_health_appointment_links')
    .select('appointment_id, puramass_order_id')
    .limit(50000);
  if (error) {
    if (!isMissingSchema(error)) {
      console.error('[partner-settlement] link read failed:', error);
    }
    return out;
  }
  for (const row of (data ?? []) as any[]) {
    const appointment = row.appointment_id ? String(row.appointment_id) : null;
    const order = row.puramass_order_id ? String(row.puramass_order_id) : null;
    if (appointment && order) out[appointment] = order;
  }
  return out;
}

/**
 * Persist one pull and the appointment rows it returned.
 *
 * Returns null when the schema isn't there yet — the caller can still show the
 * live figures, it just can't keep them. Failing the whole pull because we
 * couldn't file it would be the wrong trade: the numbers are still useful.
 */
export async function savePull(args: {
  pull: SettlementPull;
  reconcile: ReconcileResult;
  actor: { id: string; email: string | null };
}): Promise<StoredPull | null> {
  const { pull, reconcile, actor } = args;
  const totals = reconcile.summary.partner;

  const { data, error } = await db
    .from('stealth_health_settlement_pulls')
    .insert({
      window_start: pull.window.start,
      window_end: pull.window.end,
      pulled_by: actor.id,
      pulled_by_email: actor.email,
      rows_returned: pull.rows.length,
      pages_fetched: pull.pages_fetched,
      truncated: pull.truncated,
      totals_reported: totals.from_reported_totals,
      total_appointments: totals.appointments,
      revenue_cents: totals.revenue_cents,
      processing_fee_cents: totals.processing_fee_cents,
      consult_fee_cents: totals.consult_fee_cents,
      shipping_cents: totals.shipping_cents,
      partner_split_cents: totals.split_cents,
      caveats: pull.caveats,
      split_model_unconfigured: pull.split_model_unconfigured,
    })
    .select('*')
    .single();

  if (error) {
    if (!isMissingSchema(error)) {
      console.error('[partner-settlement] pull insert failed:', error);
    }
    return null;
  }

  const pullId = String(data.id);
  // The match that applied at pull time, filed alongside the figures.
  const matchByAppointment = new Map(
    reconcile.lines.map((l) => [l.appointment_id, l]),
  );

  const rows = pull.rows.map((r) => {
    const line = matchByAppointment.get(r.appointment_id);
    return {
      pull_id: pullId,
      appointment_id: r.appointment_id,
      partner_created_at: r.created_at,
      condition: r.condition,
      medication: r.medication,
      visit_type: r.visit_type,
      source: r.source,
      split_model: r.split_model,
      white_label_account_settled: r.white_label_account_settled,
      revenue_cents: r.revenue_cents,
      processing_fee_cents: r.processing_fee_cents,
      consult_fee_cents: r.consult_fee_cents,
      shipping_cents: r.shipping_cents,
      partner_split_cents: r.partner_split_cents,
      puramass_order_id: line?.order_id ?? null,
      match_method: line?.match ?? 'none',
    };
  });

  let rowsFiled = true;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const { error: rowErr } = await db
      .from('stealth_health_settlement_rows')
      .insert(rows.slice(i, i + INSERT_CHUNK));
    if (rowErr) {
      console.error('[partner-settlement] row insert failed:', rowErr);
      rowsFiled = false;
      break;
    }
  }

  // A snapshot missing some of its detail must not read as complete. `truncated`
  // already means "this snapshot is partial" and every surface warns on it, so
  // reuse it rather than leaving a pull that quietly misrepresents itself.
  if (!rowsFiled) {
    await db
      .from('stealth_health_settlement_pulls')
      .update({ truncated: true })
      .eq('id', pullId);
    return shapePull({ ...data, truncated: true });
  }

  return shapePull(data);
}

/**
 * The most recent pull of a window, if one has been taken.
 *
 * `migrated` is reported separately because "this window has never been
 * pulled" and "the snapshot tables aren't there" are different problems with
 * different fixes, and a null pull alone cannot tell them apart.
 */
export async function loadLatestPull(
  window: { start: string; end: string },
): Promise<{ pull: StoredPull | null; migrated: boolean }> {
  const { data, error } = await db
    .from('stealth_health_settlement_pulls')
    .select('*')
    .eq('window_start', window.start)
    .eq('window_end', window.end)
    .order('pulled_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return { pull: null, migrated: false };
    console.error('[partner-settlement] pull read failed:', error);
    return { pull: null, migrated: true };
  }
  return { pull: data ? shapePull(data) : null, migrated: true };
}

/**
 * Read a snapshot's appointment rows back in the shape the reconciler works
 * on, so a stored window can be re-reconciled against the ledger as it stands
 * now rather than only at the moment it was pulled.
 *
 * `shipping_cents` is read with its null intact — it is the "nothing shipped"
 * signal, and coercing it to 0 here would claim free shipping.
 */
export async function loadPullRows(pullId: string): Promise<SettlementRow[]> {
  const { data, error } = await db
    .from('stealth_health_settlement_rows')
    .select('*')
    .eq('pull_id', pullId)
    .order('partner_created_at', { ascending: true })
    .limit(50000);
  if (error) {
    if (!isMissingSchema(error)) {
      console.error('[partner-settlement] snapshot row read failed:', error);
    }
    return [];
  }
  return ((data ?? []) as any[]).map((r) => ({
    appointment_id: String(r.appointment_id),
    created_at: r.partner_created_at ?? null,
    condition: r.condition ?? null,
    medication: r.medication ?? null,
    visit_type: r.visit_type ?? null,
    source: r.source ?? null,
    split_model: r.split_model ?? null,
    white_label_account_settled: r.white_label_account_settled === true,
    revenue_cents: int(r.revenue_cents),
    processing_fee_cents: int(r.processing_fee_cents),
    consult_fee_cents: int(r.consult_fee_cents),
    shipping_cents: nullableInt(r.shipping_cents),
    partner_split_cents: int(r.partner_split_cents),
  }));
}

/**
 * The window totals as the snapshot recorded them, or null when the partner
 * never sent a `totals` block for that pull. Null matters: it tells the
 * reconciler to fall back to summing rows and to say that is what it did.
 */
export function totalsFromPull(pull: StoredPull): SettlementTotalsReported | null {
  if (!pull.totals_reported) return null;
  return {
    appointments: pull.total_appointments,
    revenue_cents: pull.revenue_cents,
    processing_fee_cents: pull.processing_fee_cents,
    consult_fee_cents: pull.consult_fee_cents,
    shipping_cents: pull.shipping_cents,
    partner_split_cents: pull.partner_split_cents,
  };
}

/** Recent pulls across all windows, newest first. */
export async function loadRecentPulls(limit = 20): Promise<{
  pulls: StoredPull[];
  migrated: boolean;
}> {
  const { data, error } = await db
    .from('stealth_health_settlement_pulls')
    .select('*')
    .order('pulled_at', { ascending: false })
    .limit(Math.min(100, Math.max(1, limit)));
  if (error) {
    if (isMissingSchema(error)) return { pulls: [], migrated: false };
    console.error('[partner-settlement] pull list failed:', error);
    return { pulls: [], migrated: true };
  }
  return { pulls: ((data ?? []) as any[]).map(shapePull), migrated: true };
}

/**
 * Compare a window's two most recent pulls.
 *
 * This is the drift check the caveats make necessary: if store cost is joined
 * from the current catalog, the same window can settle differently after a
 * price change. Null when the window has been pulled fewer than twice.
 */
export async function loadPullDrift(
  window: { start: string; end: string },
): Promise<PullDrift | null> {
  const { data, error } = await db
    .from('stealth_health_settlement_pulls')
    .select('*')
    .eq('window_start', window.start)
    .eq('window_end', window.end)
    .order('pulled_at', { ascending: false })
    .limit(2);
  if (error || !data || data.length < 2) return null;

  const latest = shapePull(data[0] as any);
  const previous = shapePull(data[1] as any);
  return {
    previous,
    latest,
    split_delta_cents: latest.partner_split_cents - previous.partner_split_cents,
    appointment_delta: latest.rows_returned - previous.rows_returned,
  };
}
