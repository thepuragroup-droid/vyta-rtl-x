/**
 * Email flows — what the admin reads. Server-only.
 *
 * The funnel and the people table are derived from the tracking tables at
 * read time rather than kept as counters: a counter can drift from the rows it
 * counts, a GROUP BY over them cannot.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { SITE_URL } from '@/lib/config';
import { isMissingColumnError } from '@/lib/payments/puramass-columns';
import {
  ENTRY_STATUSES,
  STEP_NUMBERS,
  type EntryRow,
  type EntrySendRow,
  type EntryStatus,
  type FlowKey,
  type FlowOverview,
  type StepNumber,
  type StepStats,
} from './types';
import { decide, nextStep } from './schedule';
import { cartLineViews, restoreUrls, sanitizeCartLines } from './carts';
import { cartProducts, type FlowConfig } from './engine';

type Db = SupabaseClient<any, any, any>;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export async function computeOverview(db: Db, flow: FlowKey, sinceIso: string | null): Promise<FlowOverview> {
  const readEntries = (cols: string) => {
    let q = db.from('email_flow_entries').select(cols).eq('flow', flow).limit(20000);
    if (sinceIso) q = q.gte('enrolled_at', sinceIso);
    return q;
  };
  // converted_via arrives with email-flows-tracking-migration.sql.
  let hasVia = true;
  let { data: entries, error: entriesError } = await readEntries('id, status, converted_amount, attributed_step, converted_via');
  if (entriesError && isMissingColumnError(entriesError)) {
    hasVia = false;
    ({ data: entries } = await readEntries('id, status, converted_amount, attributed_step'));
  }
  const ids = new Set((entries ?? []).map((s: any) => s.id));

  let sendsQ = db.from('email_flow_sends').select('entry_id, step, status, opened_at, clicked_at').eq('flow', flow).limit(100000);
  if (sinceIso) sendsQ = sendsQ.gte('created_at', sinceIso);
  const { data: sends } = await sendsQ;

  const byStatus = Object.fromEntries(ENTRY_STATUSES.map((s) => [s, 0])) as Record<EntryStatus, number>;
  const steps = new Map<StepNumber, StepStats>(
    STEP_NUMBERS.map((n) => [n, { step: n, sent: 0, failed: 0, skipped: 0, opened: 0, clicked: 0, conversions: 0, clickConversions: 0, revenue: 0 }]),
  );
  let revenue = 0;
  const via = { click: 0, email_match: 0, unknown: 0 };

  for (const s of (entries ?? []) as any[]) {
    if (s.status in byStatus) byStatus[s.status as EntryStatus]++;
    if (s.status === 'converted') {
      const amount = Number(s.converted_amount) || 0;
      revenue += amount;
      const how: keyof typeof via = s.converted_via === 'click' || s.converted_via === 'email_match' ? s.converted_via : 'unknown';
      via[how]++;
      const st = steps.get(s.attributed_step as StepNumber);
      if (st) {
        st.conversions++;
        if (how === 'click') st.clickConversions++;
        st.revenue += amount;
      }
    }
  }
  for (const r of (sends ?? []) as any[]) {
    if (sinceIso && !ids.has(r.entry_id)) continue;
    const st = steps.get(r.step as StepNumber);
    if (!st) continue;
    if (r.status === 'sent') {
      st.sent++;
      if (r.opened_at) st.opened++;
      if (r.clicked_at) st.clicked++;
    } else if (r.status === 'failed') st.failed++;
    else if (r.status === 'skipped') st.skipped++;
  }

  const enrolled = (entries ?? []).length;
  return {
    enrolled,
    byStatus,
    conversionRate: enrolled ? round2((byStatus.converted / enrolled) * 100) : null,
    revenue: round2(revenue),
    conversionsVia: hasVia ? via : null,
    steps: [...steps.values()].map((s) => ({ ...s, revenue: round2(s.revenue) })),
  };
}

/** The next email an active entry will get, and roughly when. */
export function estimateNext(
  entry: Pick<EntryRow, 'status' | 'enrolled_at' | 'last_sent_at' | 'timezone' | 'paused_reason'>,
  sends: EntrySendRow[],
  config: FlowConfig,
  now: Date,
): { step: StepNumber; at: string } | null {
  if (entry.status !== 'active') return null;
  const records = sends.map((s) => ({ step: s.step, status: s.status, attempts: s.attempts }));
  let step = nextStep(records);
  while (step && !config.steps[step].enabled) {
    records.push({ step, status: 'skipped', attempts: 0 });
    step = nextStep(records);
  }
  if (!step) return null;
  const d = decide(
    {
      step,
      delayHours: config.steps[step].delay_hours,
      enrolledAt: new Date(entry.enrolled_at),
      lastSentAt: entry.last_sent_at ? new Date(entry.last_sent_at) : null,
      timezone: entry.timezone,
      windowStart: config.settings.send_window_start,
      windowEnd: config.settings.send_window_end,
      minGapHours: config.settings.min_gap_hours,
    },
    now,
  );
  return { step, at: (d.send ? now : d.at).toISOString() };
}

export const ENTRY_SELECT =
  'id, flow, customer_id, email, first_name, timezone, status, source, consent_basis, tags, enrolled_at, cart_id, last_step, last_sent_at, paused_reason, converted_at, converted_order_ref, converted_amount, converted_currency, attributed_step, exit_reason, exited_at, unsubscribed_at';

export const SEND_SELECT =
  'id, entry_id, step, status, attempts, subject, promo_code, offer_ends_at, error, sent_at, opened_at, open_count, clicked_at, click_count, created_at';

export function shapeEntry(row: any, sends: any[], config: FlowConfig | null, now: Date): EntryRow {
  const mine: EntrySendRow[] = sends
    .filter((s) => s.entry_id === row.id)
    .map((s) => ({
      id: s.id,
      step: s.step,
      status: s.status,
      attempts: s.attempts,
      subject: s.subject,
      promo_code: s.promo_code,
      offer_ends_at: s.offer_ends_at,
      error: s.error,
      sent_at: s.sent_at,
      opened_at: s.opened_at,
      open_count: s.open_count ?? 0,
      clicked_at: s.clicked_at,
      click_count: s.click_count ?? 0,
      created_at: s.created_at,
    }))
    .sort((a, b) => a.step - b.step);
  const entry: EntryRow = {
    ...row,
    tags: row.tags ?? [],
    converted_amount: row.converted_amount == null ? null : Number(row.converted_amount),
    sends: mine,
    cart: null,
  };
  entry.next = config ? estimateNext(entry, mine, config, now) : null;
  return entry;
}

/** Attach each cart entry's items (named from `products`) and its restore link. */
export async function attachCarts(db: Db, entries: EntryRow[]): Promise<void> {
  const ids = [...new Set(entries.map((e) => e.cart_id).filter(Boolean))] as string[];
  if (!ids.length) return;
  const { data: carts } = await db.from('saved_carts').select('id, restore_token, items, status').in('id', ids);
  const parsed = ((carts ?? []) as any[]).map((c) => ({ ...c, lines: sanitizeCartLines(c.items) }));
  const products = await cartProducts(db, parsed.flatMap((c) => c.lines));
  const byId = new Map(parsed.map((c) => [c.id, c]));
  for (const e of entries) {
    const c = e.cart_id ? byId.get(e.cart_id) : null;
    if (!c) continue;
    e.cart = {
      lines: cartLineViews(c.lines, products),
      status: c.status,
      restoreUrl: restoreUrls(SITE_URL, c.restore_token, null).cartUrl,
    };
  }
}
