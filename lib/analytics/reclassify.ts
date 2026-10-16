/**
 * Re-reading stored touches under the current classification rules.
 *
 * A channel is frozen onto a visitor, an order and a customer at the moment it
 * is recorded, so improving `classifyChannel` fixes new visits only. When a
 * rule was missing — Meta's `{{placement}}` tags, say — the visits it got
 * wrong stay wrong. Every row keeps the raw facts (utm source and medium,
 * referring host, click id, referral code) alongside the channel, so the
 * current rules can be run over them again.
 *
 * Deliberately one-way: a row only ever moves FROM an unpaid channel TO a paid
 * one. That is the mistake a missing ad rule makes (an ad click filed as
 * organic, referral or direct), and limiting the fix to it means re-running
 * the rules can never quietly rewrite anything else in the history.
 *
 * Isomorphic and pure; the audit route reads the rows and applies the moves.
 */
import { classifyChannel, isPaidChannel, type ClickIdParam } from './attribution';

/** The raw facts of one touch, as any of the three tables stores them. */
export interface StoredTouch {
  channel: string | null;
  source: string | null;
  medium: string | null;
  referrer_host: string | null;
  click_id_param: string | null;
  ref_code: string | null;
}

/** The channel these facts get today, or null when the row should stay as it is. */
export function correctedChannel(t: StoredTouch): string | null {
  if (!t.channel || isPaidChannel(t.channel)) return null;
  // `source` falls back to the referring host when the link had no utm_source
  // (parseTouch). Passing it back in as the source is harmless: a host is only
  // ever matched as a host or as an unknown source, exactly as it was then.
  const next = classifyChannel({
    clickIdParam: (t.click_id_param as ClickIdParam | null) ?? null,
    source: t.source,
    medium: t.medium,
    referrerHost: t.referrer_host,
    refCode: t.ref_code,
  });
  return isPaidChannel(next) && next !== t.channel ? next : null;
}

/** A visitor_attribution row's first and last touch. */
export function visitorTouches(row: Record<string, any>): { first: StoredTouch; last: StoredTouch } {
  return {
    first: {
      channel: row.first_channel ?? null,
      source: row.first_source ?? null,
      medium: row.first_medium ?? null,
      referrer_host: row.first_referrer ?? null,
      click_id_param: row.first_click_param ?? null,
      ref_code: row.first_ref_code ?? null,
    },
    last: {
      channel: row.last_channel ?? null,
      source: row.last_source ?? null,
      medium: row.last_medium ?? null,
      referrer_host: row.last_referrer ?? null,
      click_id_param: row.last_click_param ?? null,
      // The last touch doesn't keep the referral code; it only matters for
      // affiliate, which is never a target here.
      ref_code: null,
    },
  };
}

/** The first touch inside an order's or customer's attribution snapshot, with the row's channel. */
export function snapshotTouch(channel: string | null, attribution: unknown): StoredTouch | null {
  if (!attribution || typeof attribution !== 'object') return null;
  const a = attribution as Record<string, any>;
  const t = a.first && typeof a.first === 'object' ? a.first : a.last && typeof a.last === 'object' ? a.last : null;
  if (!t) return null;
  return {
    channel,
    source: t.source ?? null,
    medium: t.medium ?? null,
    referrer_host: t.referrer_host ?? null,
    click_id_param: t.click_id_param ?? null,
    ref_code: t.ref_code ?? null,
  };
}

/** One line of the audit: visitors who arrived the same way. */
export interface ArrivalGroup {
  channel: string;
  source: string | null;
  medium: string | null;
  referrer: string | null;
  click_id: string | null;
  visitors: number;
  /** The paid channel these visitors belong in under the current rules, if any. */
  corrected: string | null;
}

/** GET /api/admin/analytics/attribution/audit */
export interface AttributionAudit {
  range: { from: string | null; to: string | null };
  available: boolean;
  /** Visitors in range whose first touch is not a paid channel. */
  unpaid_visitors: number;
  /** Of those, how many the current rules say were paid clicks. */
  misfiled_visitors: number;
  groups: ArrivalGroup[];
  truncated: boolean;
}

/** POST /api/admin/analytics/attribution/audit */
export interface ReclassifyResult {
  applied: boolean;
  /** Rows that move to a paid channel, per table and per channel. */
  moves: {
    visitors_first: Record<string, number>;
    visitors_last: Record<string, number>;
    orders: Record<string, number>;
    hosted_orders: Record<string, number>;
    customers: Record<string, number>;
  };
  total: number;
}

/** Group unpaid visitors by what they arrived with, largest first. */
export function groupArrivals(rows: Array<Record<string, any>>, limit = 30): ArrivalGroup[] {
  const groups = new Map<string, ArrivalGroup>();
  for (const row of rows) {
    const { first } = visitorTouches(row);
    const channel = first.channel ?? 'direct';
    if (isPaidChannel(channel)) continue;
    const key = [channel, first.source, first.medium, first.referrer_host, first.click_id_param].join('|');
    let g = groups.get(key);
    if (!g) {
      g = {
        channel,
        source: first.source,
        medium: first.medium,
        referrer: first.referrer_host,
        click_id: first.click_id_param,
        visitors: 0,
        corrected: correctedChannel(first),
      };
      groups.set(key, g);
    }
    g.visitors++;
  }
  return [...groups.values()]
    .sort((a, b) => Number(!!b.corrected) - Number(!!a.corrected) || b.visitors - a.visitors)
    .slice(0, limit);
}
