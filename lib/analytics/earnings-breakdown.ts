/**
 * Earnings breakdown — what sits inside one bucket of the earnings split.
 *
 * "Paid ads 41%" says how much was bought; it doesn't say which platform
 * bought it. This module splits a bucket one level down, with one rule per
 * bucket, shared by the summary route (the figures) and the orders route (the
 * filter on the order list), so the orders listed under "Google Ads" are
 * exactly the ones its row counts:
 *
 *   paid       by platform (the channel: Google Ads, Meta Ads, …),
 *              then by campaign inside each platform
 *   affiliate  by affiliate (every code they own rolls up to them),
 *              then by the code the order carried
 *   organic    by source (Google organic, Meta organic, Email, Referral),
 *              then by referring site (referral) or flow email (email)
 *
 * Direct and Unattributed have nothing to split by.
 *
 * Isomorphic and pure: the affiliate names come in as a lookup the server
 * builds (affiliate-lookup.ts), so the rule itself is testable.
 */
import { normalizeReferralCode } from '@/lib/affiliate/utils';
import { channelLabel } from './attribution';
import type { EarningsGroupKey } from './order-source';
import { flowFromUtm, flowStepLabel } from '@/lib/email-flows/engagement';

/** The groups that have a breakdown. */
export const BREAKDOWN_GROUPS: readonly EarningsGroupKey[] = ['paid', 'affiliate', 'organic'];

export function hasBreakdown(group: EarningsGroupKey): boolean {
  return BREAKDOWN_GROUPS.includes(group);
}

/** What the rule reads off one paid order. */
export interface BreakdownFact {
  channel: string | null;
  campaign: string | null;
  /** The code on the order itself — what the affiliate commission is paid on. */
  referral_code: string | null;
  /** First touch: the `?ref=` code, utm source/medium, referring host. */
  first_ref: string | null;
  first_source: string | null;
  first_medium: string | null;
  first_host: string | null;
  /** Store orders carry CAD revenue, hosted ones the hosted figure — never summed. */
  order_revenue: number;
  hosted_revenue: number;
}

/** Who owns an affiliate code, as resolved on the server. */
export interface AffiliateOwner {
  affiliateId: string;
  name: string | null;
}

export type AffiliateLookup = (code: string) => AffiliateOwner | null;

export interface BreakdownChild {
  key: string;
  label: string;
  paid_orders: number;
  order_revenue: number;
  hosted_revenue: number;
}

export interface BreakdownRow extends BreakdownChild {
  /** One short line under the label: an affiliate's codes, "no campaign tags"… */
  detail: string | null;
  /** Share of the bucket's paid orders (%). */
  order_share: number;
  children: BreakdownChild[];
}

/** The key for "we know it's this bucket, not which one inside it". */
export const UNKNOWN_KEY = 'unknown';

/**
 * The affiliate code behind an affiliate order: the one on the order (it is
 * what the commission is paid on), else the `?ref=` on the first visit, else
 * nothing. Normalised the way codes are stored.
 */
export function affiliateCodeOf(fact: Pick<BreakdownFact, 'referral_code' | 'first_ref'>): string | null {
  for (const raw of [fact.referral_code, fact.first_ref]) {
    const code = normalizeReferralCode(raw);
    if (code) return code;
  }
  return null;
}

/** Row and child for one order inside its bucket. */
export function breakdownKeysOf(
  group: EarningsGroupKey,
  fact: BreakdownFact,
  affiliates: AffiliateLookup = () => null,
): { row: { key: string; label: string }; child: { key: string; label: string } | null } | null {
  const channel = fact.channel;
  switch (group) {
    case 'paid': {
      if (!channel) return null;
      const campaign = fact.campaign?.trim() || null;
      return {
        row: { key: channel, label: channelLabel(channel) },
        child: campaign ? { key: `campaign:${campaign}`, label: campaign } : { key: 'campaign:', label: 'No campaign tag' },
      };
    }
    case 'affiliate': {
      const code = affiliateCodeOf(fact);
      if (code) {
        const owner = affiliates(code);
        return {
          row: owner
            ? { key: `affiliate:${owner.affiliateId}`, label: owner.name || `Affiliate ${code}` }
            : { key: `code:${code}`, label: `Code ${code} (no affiliate found)` },
          child: { key: `code:${code}`, label: code },
        };
      }
      // `utm_medium=affiliate` links carry a source rather than a code.
      if (fact.first_source) {
        const src = fact.first_source;
        return { row: { key: `source:${src}`, label: `utm_source=${src}` }, child: null };
      }
      return { row: { key: UNKNOWN_KEY, label: 'Affiliate not recorded' }, child: null };
    }
    case 'organic': {
      if (!channel) return null;
      const row = { key: channel, label: channelLabel(channel) };
      if (channel === 'referral') {
        const host = fact.first_host || fact.first_source;
        return { row, child: host ? { key: `site:${host}`, label: host } : null };
      }
      if (channel === 'email') {
        const flow = flowFromUtm(fact.first_source, fact.first_medium ?? 'email', fact.campaign);
        if (flow) return { row, child: { key: `flow:${flow.flow}:${flow.step ?? ''}`, label: flowStepLabel(flow.flow, flow.step) } };
        const name = fact.campaign || fact.first_source;
        return { row, child: name ? { key: `email:${name}`, label: name } : null };
      }
      return { row, child: null };
    }
    default:
      return null;
  }
}

const MAX_CHILDREN = 8;

const round2 = (n: number) => +n.toFixed(2);
const pct = (n: number, d: number) => (d > 0 ? +((n / d) * 100).toFixed(1) : 0);

/**
 * Split one bucket's paid orders into rows (and children), largest first.
 * Children past the eighth are summed into "N more" so a long tail of
 * campaign names can't swamp the panel.
 */
export function buildBreakdown(
  group: EarningsGroupKey,
  facts: BreakdownFact[],
  affiliates: AffiliateLookup = () => null,
): BreakdownRow[] {
  if (!hasBreakdown(group)) return [];
  const rows = new Map<string, BreakdownRow & { childMap: Map<string, BreakdownChild>; codes: Set<string> }>();
  let total = 0;

  for (const f of facts) {
    const keys = breakdownKeysOf(group, f, affiliates);
    if (!keys) continue;
    total += 1;
    let row = rows.get(keys.row.key);
    if (!row) {
      row = {
        ...keys.row,
        detail: null,
        paid_orders: 0,
        order_revenue: 0,
        hosted_revenue: 0,
        order_share: 0,
        children: [],
        childMap: new Map(),
        codes: new Set(),
      };
      rows.set(keys.row.key, row);
    }
    row.paid_orders += 1;
    row.order_revenue += f.order_revenue;
    row.hosted_revenue += f.hosted_revenue;
    if (keys.child) {
      if (group === 'affiliate') row.codes.add(keys.child.label);
      let child = row.childMap.get(keys.child.key);
      if (!child) {
        child = { ...keys.child, paid_orders: 0, order_revenue: 0, hosted_revenue: 0 };
        row.childMap.set(keys.child.key, child);
      }
      child.paid_orders += 1;
      child.order_revenue += f.order_revenue;
      child.hosted_revenue += f.hosted_revenue;
    }
  }

  return [...rows.values()]
    .map(({ childMap, codes, ...row }) => {
      const sorted = [...childMap.values()].sort((a, b) => b.paid_orders - a.paid_orders || a.label.localeCompare(b.label));
      const shown = sorted.slice(0, MAX_CHILDREN);
      const rest = sorted.slice(MAX_CHILDREN);
      if (rest.length) {
        shown.push({
          key: 'more',
          label: `${rest.length} more`,
          paid_orders: rest.reduce((n, c) => n + c.paid_orders, 0),
          order_revenue: rest.reduce((n, c) => n + c.order_revenue, 0),
          hosted_revenue: rest.reduce((n, c) => n + c.hosted_revenue, 0),
        });
      }
      const children = shown;
      let detail: string | null = null;
      if (group === 'affiliate' && codes.size) detail = `Code${codes.size > 1 ? 's' : ''} ${[...codes].join(', ')}`;
      if (group === 'paid' && children.length === 1 && children[0].key === 'campaign:') {
        detail = 'No campaign tags on these clicks — add utm_campaign to the ads to see which campaign sold.';
      }
      return {
        ...row,
        detail,
        order_revenue: round2(row.order_revenue),
        hosted_revenue: round2(row.hosted_revenue),
        order_share: pct(row.paid_orders, total),
        children: children.map((c) => ({ ...c, order_revenue: round2(c.order_revenue), hosted_revenue: round2(c.hosted_revenue) })),
      };
    })
    .sort((a, b) => b.paid_orders - a.paid_orders || a.label.localeCompare(b.label));
}
