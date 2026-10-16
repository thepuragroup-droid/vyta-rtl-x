/**
 * Email flows on the Analytics page — are the flows earning their keep?
 *
 * Shown under Organic & referral, because that is where email sits in the
 * earnings split. But a flow email rarely WINS a customer — by the time
 * someone gets one they have already arrived through an ad, an affiliate or a
 * search, and the sale stays credited to that first touch. So the report reads
 * the flows from their own side as well as the split's:
 *
 *   engagement   what the emails sent in the range got: opens, people's clicks
 *                (with the mail-scanner clicks that were filtered out shown,
 *                not hidden), checkouts opened from a click, and where the
 *                clicks went.
 *   conversions  entries that converted in the range, split by whether the
 *                buyer clicked first — a click-through is the flow's sale; a
 *                purchase without one is at most influenced.
 *   orders       paid orders in the range that came through a flow email
 *                (click cookie or the flow's UTM tags), grouped by the
 *                earnings bucket they are credited to — the assist the split
 *                itself cannot show.
 *
 * Isomorphic and pure: the route reads the rows, this adds them up.
 */
import { earningsGroupOf, type EarningsGroupKey } from './order-source';
import {
  CONVERSION_VIA_LABELS,
  LINK_KIND_LABELS,
  emailFlowTouchOf,
  type ConversionVia,
  type LinkKind,
} from '@/lib/email-flows/engagement';
import { FLOWS, FLOW_KEYS, STEP_NUMBERS, isFlowKey, type FlowKey, type StepNumber } from '@/lib/email-flows/types';

export interface MoneyByCurrency {
  currency: string;
  amount: number;
}

export interface FlowStepReport {
  step: StepNumber;
  label: string;
  sent: number;
  opened: number;
  clicked: number;
  conversions: number;
  click_conversions: number;
}

export interface FlowReport {
  flow: FlowKey;
  label: string;
  sent: number;
  /** Sends opened at least once, as the send counter recorded it. */
  opened: number;
  /** Of those, sends whose every recorded open looked automatic (Apple prefetch, scanner). */
  opened_automatic_only: number;
  /** Sends a person clicked. */
  clicked: number;
  /** Sends clicked only by a mail scanner — filtered out of `clicked`. */
  machine_clicked: number;
  /** Checkouts opened from a flow email's click. */
  checkouts: number;
  conversions: Record<ConversionVia | 'unknown', number>;
  revenue: MoneyByCurrency[];
  click_revenue: MoneyByCurrency[];
  steps: FlowStepReport[];
  links: Array<{ kind: LinkKind; label: string; clicks: number }>;
}

export interface FlowOrdersReport {
  /** Paid orders in range that came through a flow email. */
  total: number;
  by_evidence: { click: number; utm: number };
  by_bucket: Array<{ group: EarningsGroupKey; label: string; orders: number }>;
  by_flow: Array<{ flow: FlowKey; label: string; orders: number; revenue: MoneyByCurrency[] }>;
}

export interface EmailFlowAnalytics {
  range: { from: string | null; to: string | null };
  /** False until email-flows-migration.sql has run. */
  available: boolean;
  /** False until email-flows-tracking-migration.sql has run — machine filtering, checkouts and links need it. */
  tracking: boolean;
  /** False until the converted_via column exists — conversions then all read "unknown". */
  conversion_split: boolean;
  flows: FlowReport[];
  orders: FlowOrdersReport;
}

// ---- Inputs, as the route reads them ----

export interface SendInput {
  id: string;
  flow: string;
  step: number;
  opened_at: string | null;
  clicked_at: string | null;
}

export interface EventInput {
  send_id: string | null;
  flow: string;
  step: number | null;
  kind: string;
  machine: boolean;
  link_kind: string | null;
  order_ref: string | null;
}

export interface ConversionInput {
  flow: string;
  attributed_step: number | null;
  converted_via: string | null;
  converted_amount: number | string | null;
  converted_currency: string | null;
}

export interface OrderInput {
  kind: 'store' | 'hosted';
  attribution_channel: string | null;
  /** Rebuilt `{ email_flow, first, last }` — enough for emailFlowTouchOf. */
  attribution: unknown;
  amount: number;
  currency: string;
}

const GROUP_LABELS: Record<EarningsGroupKey, string> = {
  paid: 'Paid ads',
  affiliate: 'Affiliate',
  organic: 'Organic & referral',
  direct: 'Direct',
  unattributed: 'Unattributed',
};

function addMoney(list: MoneyByCurrency[], currency: string | null, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const cur = String(currency || 'CAD').toUpperCase();
  const hit = list.find((m) => m.currency === cur);
  if (hit) hit.amount += amount;
  else list.push({ currency: cur, amount });
}

const roundMoney = (list: MoneyByCurrency[]) =>
  list.map((m) => ({ ...m, amount: +m.amount.toFixed(2) })).sort((a, b) => b.amount - a.amount);

function emptyFlow(flow: FlowKey): FlowReport {
  return {
    flow,
    label: FLOWS[flow].label,
    sent: 0,
    opened: 0,
    opened_automatic_only: 0,
    clicked: 0,
    machine_clicked: 0,
    checkouts: 0,
    conversions: { click: 0, email_match: 0, unknown: 0 },
    revenue: [],
    click_revenue: [],
    steps: STEP_NUMBERS.map((step) => ({
      step,
      label: FLOWS[flow].steps[step].label,
      sent: 0,
      opened: 0,
      clicked: 0,
      conversions: 0,
      click_conversions: 0,
    })),
    links: [],
  };
}

export function buildEmailFlowReport(input: {
  range: { from: string | null; to: string | null };
  tracking: boolean;
  conversionSplit: boolean;
  sends: SendInput[];
  events: EventInput[];
  conversions: ConversionInput[];
  orders: OrderInput[];
}): EmailFlowAnalytics {
  const flows = new Map<FlowKey, FlowReport>(FLOW_KEYS.map((f) => [f, emptyFlow(f)]));
  const stepOf = (r: FlowReport, n: number | null) => r.steps.find((s) => s.step === n) ?? null;

  // ---- Engagement, from the sends ----
  for (const s of input.sends) {
    if (!isFlowKey(s.flow)) continue;
    const r = flows.get(s.flow)!;
    const st = stepOf(r, s.step);
    r.sent++;
    if (st) st.sent++;
    if (s.opened_at) {
      r.opened++;
      if (st) st.opened++;
    }
    if (s.clicked_at) {
      r.clicked++;
      if (st) st.clicked++;
    }
  }

  // ---- What the event log adds ----
  // Per send: did a person open/click, or only machines?
  // Opens and clicks are read against the sends in range (the route reads
  // events from the range start onward, so a later click on an email sent in
  // range still counts); checkouts are the route's to bound by date.
  const openedSends = new Set(input.sends.filter((s) => s.opened_at).map((s) => s.id));
  const sendsInRange = new Set(input.sends.map((s) => s.id));
  const opens = new Map<string, { human: boolean; flow: FlowKey }>();
  const clicks = new Map<string, { human: boolean; flow: FlowKey }>();
  const checkouts = new Map<FlowKey, Set<string>>();
  const links = new Map<FlowKey, Map<LinkKind, number>>();
  for (const e of input.events) {
    if (!isFlowKey(e.flow)) continue;
    if ((e.kind === 'open' || e.kind === 'click') && !(e.send_id && sendsInRange.has(e.send_id))) continue;
    if (e.kind === 'open' && e.send_id) {
      const prev = opens.get(e.send_id);
      opens.set(e.send_id, { flow: e.flow, human: (prev?.human ?? false) || !e.machine });
    } else if (e.kind === 'click' && e.send_id) {
      const prev = clicks.get(e.send_id);
      clicks.set(e.send_id, { flow: e.flow, human: (prev?.human ?? false) || !e.machine });
      if (!e.machine) {
        if (!links.has(e.flow)) links.set(e.flow, new Map());
        const kind = (e.link_kind as LinkKind) in LINK_KIND_LABELS ? (e.link_kind as LinkKind) : 'other';
        const m = links.get(e.flow)!;
        m.set(kind, (m.get(kind) ?? 0) + 1);
      }
    } else if (e.kind === 'checkout') {
      if (!checkouts.has(e.flow)) checkouts.set(e.flow, new Set());
      checkouts.get(e.flow)!.add(e.order_ref ?? `${e.send_id}`);
    }
  }
  // "Of those": only sends the counter shows as opened can be automatic-only.
  for (const [sendId, { human, flow }] of opens) {
    if (!human && openedSends.has(sendId)) flows.get(flow)!.opened_automatic_only++;
  }
  for (const { human, flow } of clicks.values()) if (!human) flows.get(flow)!.machine_clicked++;
  for (const [flow, set] of checkouts) flows.get(flow)!.checkouts = set.size;
  for (const [flow, m] of links) {
    flows.get(flow)!.links = [...m.entries()]
      .map(([kind, n]) => ({ kind, label: LINK_KIND_LABELS[kind], clicks: n }))
      .sort((a, b) => b.clicks - a.clicks);
  }

  // ---- Conversions ----
  for (const c of input.conversions) {
    if (!isFlowKey(c.flow)) continue;
    const r = flows.get(c.flow)!;
    const via: ConversionVia | 'unknown' =
      c.converted_via === 'click' || c.converted_via === 'email_match' ? c.converted_via : 'unknown';
    r.conversions[via]++;
    const amount = Number(c.converted_amount) || 0;
    addMoney(r.revenue, c.converted_currency, amount);
    if (via === 'click') addMoney(r.click_revenue, c.converted_currency, amount);
    const st = stepOf(r, c.attributed_step);
    if (st) {
      st.conversions++;
      if (via === 'click') st.click_conversions++;
    }
  }

  // ---- Orders that came through a flow email ----
  const byBucket = new Map<EarningsGroupKey, number>();
  const byFlow = new Map<FlowKey, { orders: number; revenue: MoneyByCurrency[] }>();
  const evidence = { click: 0, utm: 0 };
  let total = 0;
  for (const o of input.orders) {
    const touch = emailFlowTouchOf(o.attribution);
    if (!touch) continue;
    total++;
    evidence[touch.evidence]++;
    const group = earningsGroupOf(o.attribution_channel);
    byBucket.set(group, (byBucket.get(group) ?? 0) + 1);
    const f = byFlow.get(touch.flow) ?? { orders: 0, revenue: [] };
    f.orders++;
    addMoney(f.revenue, o.currency, o.amount);
    byFlow.set(touch.flow, f);
  }

  return {
    range: input.range,
    available: true,
    tracking: input.tracking,
    conversion_split: input.conversionSplit,
    flows: [...flows.values()].map((r) => ({
      ...r,
      revenue: roundMoney(r.revenue),
      click_revenue: roundMoney(r.click_revenue),
    })),
    orders: {
      total,
      by_evidence: evidence,
      by_bucket: [...byBucket.entries()]
        .map(([group, orders]) => ({ group, label: GROUP_LABELS[group], orders }))
        .sort((a, b) => b.orders - a.orders),
      by_flow: [...byFlow.entries()]
        .map(([flow, v]) => ({ flow, label: FLOWS[flow].label, orders: v.orders, revenue: roundMoney(v.revenue) }))
        .sort((a, b) => b.orders - a.orders),
    },
  };
}

export const EMPTY_EMAIL_FLOW_ANALYTICS = (range: EmailFlowAnalytics['range']): EmailFlowAnalytics => ({
  range,
  available: false,
  tracking: false,
  conversion_split: false,
  flows: [],
  orders: { total: 0, by_evidence: { click: 0, utm: 0 }, by_bucket: [], by_flow: [] },
});

export { CONVERSION_VIA_LABELS };
