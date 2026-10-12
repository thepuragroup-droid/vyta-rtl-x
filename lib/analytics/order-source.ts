/**
 * Order source — which earnings bucket one order lands in, and why.
 *
 * The earnings split on the analytics page (Paid ads / Affiliate / Organic &
 * referral / Direct / Unattributed) is a set of percentages. This module is the
 * per-order side of it: given the attribution snapshot frozen onto an order, it
 * names the bucket and spells out the evidence that put the order there — the
 * click ID, the UTM tags, the referring site — in a sentence an admin can check
 * against what they know about the sale.
 *
 * For unattributed orders it goes one step further and looks for a likely
 * answer elsewhere (a referral code on the order, the channel the customer's
 * account was won by, a tracked visitor with the same email). Those are hints,
 * shown as such; they never move the order out of the Unattributed bucket,
 * because the split must keep reporting only what was actually recorded.
 *
 * Isomorphic and dependency-light: the admin route builds the explanations and
 * the browser renders them.
 */

import { isPaidChannel, type AttributionTouch } from '@/lib/analytics/attribution';

/** Which earnings bucket a channel belongs to. Mirrors the summary route. */
export type EarningsGroupKey = 'paid' | 'affiliate' | 'organic' | 'direct' | 'unattributed';

export const EARNINGS_GROUP_KEYS: readonly EarningsGroupKey[] = [
  'paid',
  'affiliate',
  'organic',
  'direct',
  'unattributed',
];

export function isEarningsGroupKey(value: unknown): value is EarningsGroupKey {
  return EARNINGS_GROUP_KEYS.includes(value as EarningsGroupKey);
}

/**
 * The one rule that sorts a channel into a bucket. The summary route rolls its
 * channel rows up with this, and the drill-down filters orders with it, so the
 * list behind a percentage is always the list that produced it.
 *
 * An order with no channel at all is `unattributed` — never `direct`. "We don't
 * know" and "they came straight to us" are different facts.
 */
export function earningsGroupOf(channel: string | null | undefined): EarningsGroupKey {
  if (!channel) return 'unattributed';
  if (isPaidChannel(channel)) return 'paid';
  if (channel === 'affiliate') return 'affiliate';
  if (channel === 'direct') return 'direct';
  return 'organic';
}

/** A labelled fact behind the classification, shown as a chip. */
export interface SourceEvidence {
  label: string;
  value: string;
}

/** A likely channel for an order that has none recorded. */
export interface SourceHint {
  channel: string;
  /** Why we think so — one sentence. */
  reason: string;
}

export interface OrderSourceExplanation {
  group: EarningsGroupKey;
  channel: string | null;
  campaign: string | null;
  /** One sentence: why this order is in this bucket. */
  reason: string;
  evidence: SourceEvidence[];
  /** Unattributed only: our best guess at where it really came from. */
  hints: SourceHint[];
}

/** What the explainer reads off an order (native or hosted). */
export interface OrderSourceInput {
  kind: 'store' | 'hosted';
  attribution_channel: string | null;
  attribution_campaign: string | null;
  /** The JSONB snapshot — `{ first, last, anonymous_id? }` — or null. */
  attribution: unknown;
  referral_code: string | null;
  created_at: string | null;
}

/** Facts gathered outside the order row, used only for unattributed hints. */
export interface OrderSourceContext {
  /** The channel the buyer's customer account was won by, if any. */
  customerChannel?: string | null;
  /** First-touch channel of a tracked visitor with the buyer's email, if any. */
  visitorChannel?: string | null;
  /** Earliest order (of this kind) that carries a channel — when collecting began. */
  attributionStartedAt?: string | null;
}

const NETWORK_FOR_CLICK_ID: Record<string, string> = {
  gclid: 'Google Ads',
  gbraid: 'Google Ads',
  wbraid: 'Google Ads',
  fbclid: 'Meta',
  msclkid: 'Microsoft Ads',
  ttclid: 'TikTok',
  li_fat_id: 'LinkedIn',
};

/** Read `{ first, last }` out of the JSONB snapshot, tolerating any shape. */
export function touchesOf(attribution: unknown): {
  first: Partial<AttributionTouch> | null;
  last: Partial<AttributionTouch> | null;
} {
  if (!attribution || typeof attribution !== 'object') return { first: null, last: null };
  const a = attribution as Record<string, unknown>;
  const asTouch = (t: unknown) =>
    t && typeof t === 'object' ? (t as Partial<AttributionTouch>) : null;
  return { first: asTouch(a.first), last: asTouch(a.last) };
}

/** The chips: every non-empty field of the first touch that bears on the channel. */
function evidenceOf(touch: Partial<AttributionTouch> | null, campaign: string | null): SourceEvidence[] {
  const out: SourceEvidence[] = [];
  if (touch?.click_id_param) {
    out.push({ label: 'Click ID', value: touch.click_id_param });
  }
  if (touch?.source) out.push({ label: 'utm_source', value: String(touch.source) });
  if (touch?.medium) out.push({ label: 'utm_medium', value: String(touch.medium) });
  const name = campaign ?? touch?.campaign ?? null;
  if (name) out.push({ label: 'Campaign', value: String(name) });
  if (touch?.ref_code) out.push({ label: 'Referral code', value: String(touch.ref_code) });
  if (touch?.referrer_host) out.push({ label: 'Came from', value: String(touch.referrer_host) });
  if (touch?.landing_page) out.push({ label: 'Landing page', value: String(touch.landing_page) });
  if (touch?.landing_path) out.push({ label: 'Landed on', value: String(touch.landing_path) });
  if (touch?.at) out.push({ label: 'First visit', value: String(touch.at).slice(0, 10) });
  return out;
}

/**
 * The sentence for an attributed order — the strongest piece of evidence that
 * decided its channel, in the same order `classifyChannel` checks them.
 */
function attributedReason(
  channel: string,
  touch: Partial<AttributionTouch> | null,
  kind: OrderSourceInput['kind'],
): string {
  const viaEmail =
    kind === 'hosted' && !touch
      ? ' (matched by email to a tracked visit, since hosted checkout runs on the partner’s domain)'
      : '';

  if (touch?.click_id_param) {
    const network = NETWORK_FOR_CLICK_ID[touch.click_id_param] ?? 'an ad network';
    return `The buyer first arrived through a ${network} ad click — the link carried a ${touch.click_id_param}, which only a paid click adds.`;
  }

  const medium = touch?.medium ? String(touch.medium) : null;
  const source = touch?.source ? String(touch.source) : null;

  if (isPaidChannel(channel)) {
    if (medium) {
      return `The buyer first arrived on a link tagged as paid (utm_medium=${medium}${source ? `, utm_source=${source}` : ''}).`;
    }
    return `Recorded as a paid-ad visit${viaEmail}.`;
  }

  switch (channel) {
    case 'affiliate':
      if (touch?.ref_code) {
        return `The buyer first arrived on an affiliate link (referral code ${touch.ref_code}).`;
      }
      if (medium === 'affiliate') return 'The buyer first arrived on a link tagged utm_medium=affiliate.';
      return `Recorded as an affiliate visit${viaEmail}.`;
    case 'email':
      return `The buyer first arrived from an email link (utm_medium=${medium ?? 'email'}).`;
    case 'google_organic':
      return touch?.referrer_host
        ? `The buyer first arrived from a Google search result (${touch.referrer_host}) — no ad click ID.`
        : `The buyer first arrived from Google with no ad click ID${viaEmail}.`;
    case 'meta_organic':
      return touch?.referrer_host
        ? `The buyer first arrived from a Facebook/Instagram post or profile (${touch.referrer_host}) — no ad click ID.`
        : `The buyer first arrived from Meta with no ad click ID${viaEmail}.`;
    case 'referral':
      if (touch?.referrer_host) return `The buyer first arrived from a link on ${touch.referrer_host}.`;
      if (source) return `The buyer first arrived on a link tagged utm_source=${source} that isn’t a known ad network.`;
      return `Recorded as a referral from another site${viaEmail}.`;
    case 'direct':
      return 'The buyer’s first recorded visit had no referrer, no tags and no click ID — a typed address, a bookmark, or a link from an app that strips its source.';
    default:
      return `Recorded with channel “${channel}”${viaEmail}.`;
  }
}

/** The sentence for an order with no channel recorded. */
function unattributedReason(input: OrderSourceInput, ctx: OrderSourceContext): string {
  const started = ctx.attributionStartedAt;
  if (started && input.created_at && input.created_at < started) {
    return `Placed before attribution started collecting (the first tracked ${input.kind === 'hosted' ? 'hosted' : 'store'} order is ${started.slice(0, 10)}).`;
  }
  if (!started) {
    return 'No channel was recorded — no order of this kind carries one yet, so attribution may not be collecting.';
  }
  if (input.kind === 'hosted') {
    return 'No channel was recorded and no tracked visit matched the buyer’s email — they likely browsed with cookies blocked, declined the consent banner, or visited on another device.';
  }
  return 'No channel was recorded — the buyer’s browser had no attribution cookie (blocked cookies, declined consent, private window), or the order was created outside the storefront.';
}

/** Our best guesses for an unattributed order, strongest first. */
function hintsFor(input: OrderSourceInput, ctx: OrderSourceContext): SourceHint[] {
  const hints: SourceHint[] = [];
  if (input.referral_code) {
    hints.push({
      channel: 'affiliate',
      reason: `The order carries referral code ${input.referral_code}, so an affiliate most likely sent it.`,
    });
  }
  if (ctx.customerChannel) {
    hints.push({
      channel: ctx.customerChannel,
      reason: 'The buyer’s customer account was won through this channel when they signed up.',
    });
  }
  if (ctx.visitorChannel && ctx.visitorChannel !== ctx.customerChannel) {
    hints.push({
      channel: ctx.visitorChannel,
      reason: 'A tracked visitor with the buyer’s email first arrived through this channel.',
    });
  }
  return hints;
}

/** Explain one order's place in the earnings split. */
export function explainOrderSource(
  input: OrderSourceInput,
  ctx: OrderSourceContext = {},
): OrderSourceExplanation {
  const channel = input.attribution_channel || null;
  const group = earningsGroupOf(channel);
  const { first, last } = touchesOf(input.attribution);
  // Channel and campaign are credited to the first touch; fall back to the last
  // only when the snapshot somehow carries just one.
  const touch = first ?? last;

  if (!channel) {
    return {
      group,
      channel: null,
      campaign: null,
      reason: unattributedReason(input, ctx),
      evidence: input.referral_code ? [{ label: 'Referral code', value: input.referral_code }] : [],
      hints: hintsFor(input, ctx),
    };
  }

  return {
    group,
    channel,
    campaign: input.attribution_campaign || null,
    reason: attributedReason(channel, touch, input.kind),
    evidence: evidenceOf(touch, input.attribution_campaign || null),
    hints: [],
  };
}
