/**
 * Welcome flow — what the admin reads. Server-only.
 *
 * The overview's funnel and the subscriber table are both derived from the two
 * tracking tables at read time, rather than kept as counters: a counter can
 * drift from the rows it counts, a GROUP BY over them cannot.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  STEP_NUMBERS,
  SUBSCRIBER_STATUSES,
  type FlowOverview,
  type StepNumber,
  type StepStats,
  type SubscriberRow,
  type SubscriberSendRow,
  type SubscriberStatus,
} from './types';
import { decide, nextStep } from './schedule';
import type { FlowConfig } from './engine';

type Db = SupabaseClient<any, any, any>;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export async function computeOverview(db: Db, sinceIso: string | null): Promise<FlowOverview> {
  let subsQ = db.from('welcome_flow_subscribers').select('id, status, converted_amount, attributed_step').limit(20000);
  if (sinceIso) subsQ = subsQ.gte('enrolled_at', sinceIso);
  const { data: subs } = await subsQ;
  const ids = new Set((subs ?? []).map((s: any) => s.id));

  let sendsQ = db.from('welcome_flow_sends').select('subscriber_id, step, status, opened_at, clicked_at').limit(100000);
  if (sinceIso) sendsQ = sendsQ.gte('created_at', sinceIso);
  const { data: sends } = await sendsQ;

  const byStatus = Object.fromEntries(SUBSCRIBER_STATUSES.map((s) => [s, 0])) as Record<SubscriberStatus, number>;
  const steps = new Map<StepNumber, StepStats>(
    STEP_NUMBERS.map((n) => [n, { step: n, sent: 0, failed: 0, skipped: 0, opened: 0, clicked: 0, conversions: 0, revenue: 0 }]),
  );
  let revenue = 0;

  for (const s of (subs ?? []) as any[]) {
    if (s.status in byStatus) byStatus[s.status as SubscriberStatus]++;
    if (s.status === 'converted') {
      const amount = Number(s.converted_amount) || 0;
      revenue += amount;
      const st = steps.get(s.attributed_step as StepNumber);
      if (st) {
        st.conversions++;
        st.revenue += amount;
      }
    }
  }
  for (const r of (sends ?? []) as any[]) {
    if (sinceIso && !ids.has(r.subscriber_id)) continue;
    const st = steps.get(r.step as StepNumber);
    if (!st) continue;
    if (r.status === 'sent') {
      st.sent++;
      if (r.opened_at) st.opened++;
      if (r.clicked_at) st.clicked++;
    } else if (r.status === 'failed') st.failed++;
    else if (r.status === 'skipped') st.skipped++;
  }

  const enrolled = (subs ?? []).length;
  // Conversion rate over people whose outcome is known or still possible —
  // everybody enrolled. Admin-removed rows stay in: removing a person does not
  // make the flow better at converting.
  return {
    enrolled,
    byStatus,
    conversionRate: enrolled ? round2((byStatus.converted / enrolled) * 100) : null,
    revenue: round2(revenue),
    steps: [...steps.values()].map((s) => ({ ...s, revenue: round2(s.revenue) })),
  };
}

/** The next email an active subscriber will get, and roughly when. */
export function estimateNext(
  sub: Pick<SubscriberRow, 'status' | 'enrolled_at' | 'last_sent_at' | 'timezone'>,
  sends: SubscriberSendRow[],
  config: FlowConfig,
  now: Date,
): { step: StepNumber; at: string } | null {
  if (sub.status !== 'active') return null;
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
      delayDays: config.steps[step].delay_days,
      enrolledAt: new Date(sub.enrolled_at),
      lastSentAt: sub.last_sent_at ? new Date(sub.last_sent_at) : null,
      timezone: sub.timezone,
      windowStart: config.settings.send_window_start,
      windowEnd: config.settings.send_window_end,
      minGapHours: config.settings.min_gap_hours,
    },
    now,
  );
  return { step, at: (d.send ? now : d.at).toISOString() };
}

export const SUBSCRIBER_SELECT =
  'id, customer_id, email, first_name, timezone, status, source, tags, enrolled_at, last_step, last_sent_at, converted_at, converted_order_ref, converted_amount, converted_currency, attributed_step, exit_reason, exited_at, unsubscribed_at';

export const SEND_SELECT =
  'id, subscriber_id, step, status, attempts, subject, promo_code, offer_ends_at, error, sent_at, opened_at, open_count, clicked_at, click_count, created_at';

export function shapeSubscriber(row: any, sends: any[], config: FlowConfig | null, now: Date): SubscriberRow {
  const mine: SubscriberSendRow[] = sends
    .filter((s) => s.subscriber_id === row.id)
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
  const sub: SubscriberRow = {
    ...row,
    tags: row.tags ?? [],
    converted_amount: row.converted_amount == null ? null : Number(row.converted_amount),
    sends: mine,
  };
  sub.next = config ? estimateNext(sub, mine, config, now) : null;
  return sub;
}
