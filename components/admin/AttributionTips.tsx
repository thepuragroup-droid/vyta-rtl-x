'use client';

import React from 'react';
import type { EarningsGroupKey } from '@/lib/admin/attribution';

/**
 * The explanations behind the acquisition figures.
 *
 * Kept in one file because the same question — "why does this order count as
 * Paid ads?" — is asked of the dashboard card, the Analytics split and the
 * order page, and three differently-worded answers would be worse than none.
 *
 * The rule they all describe: the channel is decided from the visitor's FIRST
 * arrival, copied onto the order row when it is placed, and never recomputed.
 */

/** Small helper for the channel lists inside a tip. */
function Chips({ items }: { items: string[] }) {
  return (
    <span className="mt-1.5 flex flex-wrap gap-1">
      {items.map((c) => (
        <span key={c} className="rounded bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink">
          {c}
        </span>
      ))}
    </span>
  );
}

/** How an order lands in a bucket at all — the shared preamble. */
export function EarningsSplitTip() {
  return (
    <>
      <strong>Every paid order in range, split by how the sale was won.</strong>
      <p className="mt-1.5">
        When an order is placed, the marketing channel of the buyer&apos;s first visit is copied
        onto the order itself. This card reads that stored channel back and rolls the channels up
        into buckets — so the split is a snapshot of what was true at checkout, not a guess made
        later.
      </p>
      <p className="mt-1.5">
        An order joins the count once its payment is confirmed. Pending and cancelled orders are in
        no bucket. The buckets always sum to every paid order in range, unattributed included.
      </p>
    </>
  );
}

/** The one people actually ask about. */
export function PaidAdsTip() {
  return (
    <>
      <strong>Sales won by an ad we paid for.</strong>
      <p className="mt-1.5">
        An order lands here when the visitor arrived on a link carrying an ad click ID —{' '}
        <code className="text-[11px]">gclid</code>, <code className="text-[11px]">fbclid</code>,{' '}
        <code className="text-[11px]">msclkid</code>, <code className="text-[11px]">ttclid</code>,{' '}
        <code className="text-[11px]">li_fat_id</code> — or tagged as paid traffic
        (<code className="text-[11px]">utm_medium=cpc</code>, ppc, paid_social, display…). The click
        ID alone is enough: Google and Meta add it automatically, with no tagging on our side.
      </p>
      <Chips items={['Google Ads', 'Meta Ads', 'Microsoft Ads', 'TikTok Ads', 'LinkedIn Ads', 'Other paid']} />
      <p className="mt-2">
        Credit goes to the <strong>first</strong> visit that brought the customer, even if they came
        back later through search and ordered then — the ad is what won them.
      </p>
      <p className="mt-1.5">
        This is revenue those campaigns brought in, <strong>not profit</strong>. Ad spend isn&apos;t
        imported, so nothing here is ROAS.
      </p>
    </>
  );
}

export function AffiliateTip() {
  return (
    <>
      <strong>Sales won through an affiliate link.</strong>
      <p className="mt-1.5">
        The visitor arrived with a <code className="text-[11px]">?ref=</code> code. These are counted
        apart from paid ads because the cost is a commission on the sale rather than a budget spent
        up front — and an affiliate link wins the credit even if the visitor was tagged as paid too.
      </p>
    </>
  );
}

export function OrganicTip() {
  return (
    <>
      <strong>Sales we didn&apos;t pay to win.</strong>
      <p className="mt-1.5">
        Unpaid search, unpaid social, email, and links from other sites — a visitor who arrived from
        one of those platforms with no click ID and no paid tagging.
      </p>
      <Chips items={['Google organic', 'Meta organic', 'Referral', 'Email']} />
    </>
  );
}

export function DirectTip() {
  return (
    <>
      <strong>They came straight to us.</strong>
      <p className="mt-1.5">
        No campaign, no referring site — a typed address, a bookmark, or a link with no trace on it.
        A returning customer keeps the channel that first won them, so they never decay into here.
      </p>
    </>
  );
}

export function UnattributedTip() {
  return (
    <>
      <strong>Orders carrying no channel at all.</strong>
      <p className="mt-1.5">
        Placed before attribution started collecting, or by a visitor whose cookies were blocked or
        who declined the consent banner.
      </p>
      <p className="mt-1.5">
        Kept as its own bucket rather than folded into Direct on purpose: &ldquo;we don&apos;t
        know&rdquo; and &ldquo;they came straight to us&rdquo; are different facts, and merging them
        would flatter Direct. While this share is large, read the rest as directional.
      </p>
    </>
  );
}

/** Keyed by bucket so `EarningsByChannel` can render a tip per row. */
export const EARNINGS_GROUP_TIPS: Record<EarningsGroupKey, React.ReactNode> = {
  paid: <PaidAdsTip />,
  affiliate: <AffiliateTip />,
  organic: <OrganicTip />,
  direct: <DirectTip />,
  unattributed: <UnattributedTip />,
};

/** Why the two currency columns are never added up. */
export function CurrencyTip() {
  return (
    <>
      <strong>Two currencies, never summed.</strong>
      <p className="mt-1.5">
        Storefront orders bill in CAD and hosted-checkout orders in USD, so they are shown as
        separate figures and no exchange rate is applied. The share bar is drawn on{' '}
        <strong>order counts</strong> for the same reason — there is no single denominator to divide
        revenue by.
      </p>
    </>
  );
}

/** The channel table — what the PAID badge means and where the funnel comes from. */
export function ChannelTableTip() {
  return (
    <>
      <strong>One row per acquisition channel.</strong>
      <p className="mt-1.5">
        Visitors are counted against their <strong>first</strong> touch, so the campaign that won
        someone keeps the credit for everything they do afterwards — signing up, reaching checkout,
        paying.
      </p>
      <p className="mt-1.5">
        Rows badged <strong>PAID</strong> are the six channels that cost money, and they are what
        the Paid ads bucket above is built from. They sort to the top because they are the ones with
        a budget behind them.
      </p>
    </>
  );
}

/** Why a paid click can show up with no campaign name. */
export function CampaignTip() {
  return (
    <>
      <strong>Campaign names come from <code className="text-[11px]">utm_campaign</code>.</strong>
      <p className="mt-1.5">
        A Google Ads click with auto-tagging only — a <code className="text-[11px]">gclid</code> and
        nothing else — still counts in Paid ads and in its channel, but has no name to show here.
        Add a tracking template in Ads, or URL parameters in Meta, to break the channel down by
        campaign.
      </p>
      <p className="mt-1.5">
        Ranked by purchasers. The same campaign name under two networks is kept apart rather than
        merged.
      </p>
    </>
  );
}

/** On the order page: why this one order says what it says. */
export function OrderAcquisitionTip() {
  return (
    <>
      <strong>Where this order came from.</strong>
      <p className="mt-1.5">
        Recorded when the order was placed, from the buyer&apos;s first visit to the site — the ad
        click ID, campaign tags and referrer that arrived with them. It is stored on the order, so
        it never changes afterwards.
      </p>
      <p className="mt-1.5">
        Hosted-checkout orders are matched by email instead: payment happens on the partner&apos;s
        domain, where our cookies don&apos;t reach.
      </p>
      <p className="mt-1.5">
        Orders placed before attribution was collecting show no card at all, rather than being
        reported as Direct on no evidence.
      </p>
    </>
  );
}

/** On the customer page: why the channel here never moves. */
export function CustomerAcquisitionTip() {
  return (
    <>
      <strong>The channel that won this customer.</strong>
      <p className="mt-1.5">
        Frozen when the account was created and never rewritten — signing in later from a different
        ad must not rewrite how they were originally won.
      </p>
    </>
  );
}
