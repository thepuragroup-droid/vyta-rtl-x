import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { UserPlus, GitCompareArrows, PackageX, Truck, Info } from 'lucide-react';

/**
 * In-app admin guides / wikis. Content lives here as structured blocks (not raw
 * markdown) so it renders in the site's palette with no extra dependencies and
 * stays easy to extend — add an entry to GUIDES and it shows up on both the
 * dashboard "Guides & How-Tos" panel and the /admin/guides index.
 */

export type GuideBlock =
  | { type: 'p'; text: string }
  | { type: 'h'; text: string }
  | { type: 'steps'; items: string[] }
  | { type: 'list'; items: string[] }
  | { type: 'note'; text: string }
  | { type: 'compare'; columns: { title: string; points: string[] }[] };

export interface Guide {
  slug: string;
  title: string;
  summary: string;
  category: string;
  minutes: number;
  icon: LucideIcon;
  body: GuideBlock[];
}

export const GUIDES: Guide[] = [
  {
    slug: 'setting-up-an-affiliate',
    title: 'Setting up an affiliate',
    summary: 'From application to their first paid commission — how affiliates join, get a referral code, and get paid.',
    category: 'Affiliates & Sales',
    minutes: 4,
    icon: UserPlus,
    body: [
      {
        type: 'p',
        text: 'An affiliate is an external partner — an influencer, a happy customer, a referrer — who sends business your way with a personal referral code and earns a commission on every order that uses it.',
      },
      { type: 'h', text: 'How someone becomes an affiliate' },
      {
        type: 'steps',
        items: [
          'They apply through the public affiliate portal at /affiliate/signup (or /affiliate/apply).',
          'New applications show up under Partners → Affiliates for you to review.',
          'Approve the ones you want. On approval a unique referral code is generated for them.',
        ],
      },
      { type: 'h', text: 'Their referral code' },
      {
        type: 'p',
        text: 'Each affiliate gets a unique code they can share as a link (yoursite.com?ref=CODE) or that a customer types into the referral field at checkout. Any order placed with that code is attributed to the affiliate automatically.',
      },
      { type: 'h', text: 'Commission' },
      {
        type: 'p',
        text: 'Affiliates earn a set commission on attributed orders — 10% by default, adjustable per affiliate. Each attributed order creates a "pending" commission that appears under Partners → Commissions.',
      },
      { type: 'h', text: 'Paying them out' },
      {
        type: 'steps',
        items: [
          'Open Partners → Commissions.',
          'Review the pending commissions grouped by affiliate.',
          'Pay the affiliate (e.g. to the payout wallet on their profile) and mark the commission Paid.',
        ],
      },
      {
        type: 'note',
        text: 'Affiliates have their own portal at /affiliate/login with a dashboard showing their referrals and pending vs. paid earnings — that view is self-service, you don’t manage it for them.',
      },
    ],
  },
  {
    slug: 'affiliate-vs-sales-person',
    title: 'Affiliate vs. Sales Person',
    summary: 'Both earn commission, but they’re for different relationships. A quick guide to picking the right one.',
    category: 'Affiliates & Sales',
    minutes: 3,
    icon: GitCompareArrows,
    body: [
      {
        type: 'p',
        text: 'Affiliates and sales people both earn commission on orders, but they model two different relationships. Use this to decide which to create.',
      },
      {
        type: 'compare',
        columns: [
          {
            title: 'Affiliate',
            points: [
              'External partner — influencer, referrer, customer advocate.',
              'Self-signs up through the public affiliate portal.',
              'Gets their own login and self-service dashboard.',
              'Has a shareable referral code customers enter at checkout.',
              'Commission 10% by default, set per affiliate.',
              'Best for word-of-mouth and online referrals at scale.',
            ],
          },
          {
            title: 'Sales Person',
            points: [
              'Internal rep or account manager you manage.',
              'Created by your team under Partners → Sales People.',
              'No portal or login — staff-managed only.',
              'Assigned to a specific invoice or order by staff, not a public code.',
              'Commission 5% by default, set per person.',
              'Best for wholesale accounts and deals your team closes directly.',
            ],
          },
        ],
      },
      { type: 'h', text: 'Rule of thumb' },
      {
        type: 'p',
        text: 'If the person brings orders through their own audience and a shareable code, make them an Affiliate. If they’re a rep your team assigns to specific invoices, make them a Sales Person.',
      },
    ],
  },
  {
    slug: 'reading-restock-alerts',
    title: 'Reading restock alerts',
    summary: 'What the dashboard’s "Restock needed" panel is telling you, and what to do about it.',
    category: 'Inventory',
    minutes: 2,
    icon: PackageX,
    body: [
      {
        type: 'p',
        text: 'The "Restock needed" panel on the dashboard lists active products whose sellable stock has dropped to or below their low-stock threshold, neediest first.',
      },
      { type: 'h', text: 'What the numbers mean' },
      {
        type: 'p',
        text: 'Each row shows current stock against the product’s threshold — for example 3 / 10. The threshold defaults to 10 and can be changed per product on the Products page.',
      },
      { type: 'h', text: 'What to do' },
      {
        type: 'steps',
        items: [
          'Open Products (or Purchase Orders) from the panel.',
          'Raise a purchase order for the low items, or adjust stock once a shipment is received.',
          'When stock rises back above the threshold, the product drops off the list automatically.',
        ],
      },
      {
        type: 'note',
        text: 'Stock is managed on the Products page — that’s the number the storefront actually sells from.',
      },
    ],
  },
  {
    slug: 'resolving-shipment-failures',
    title: 'Resolving shipment failures',
    summary: 'Why an auto-shipment fails and how to retry it from the dashboard.',
    category: 'Fulfillment',
    minutes: 2,
    icon: Truck,
    body: [
      {
        type: 'p',
        text: 'When an order is placed, the system tries to create its Easyship shipment automatically. If that call fails, the order appears in the dashboard’s "Shipment failures" panel with the reason it failed.',
      },
      { type: 'h', text: 'Common causes' },
      {
        type: 'list',
        items: [
          'Incomplete or invalid shipping address.',
          'No courier available for the destination or package weight.',
          'Easyship not configured or temporarily unreachable.',
        ],
      },
      { type: 'h', text: 'How to fix it' },
      {
        type: 'steps',
        items: [
          'Open the order from the panel and check the shipping address and items.',
          'Fix whatever the error points to — most often the address.',
          'Click Retry on the panel (or "Create shipment" on the order) to attempt again.',
        ],
      },
      {
        type: 'note',
        text: 'Retrying is safe — it re-attempts the same shipment and clears the failure once it succeeds.',
      },
    ],
  },
];

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

/** Renders a guide's structured body in the site palette. */
export function GuideBody({ blocks }: { blocks: GuideBlock[] }) {
  return (
    <div className="space-y-5">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'h':
            return (
              <h2 key={i} className="text-base font-bold text-ink pt-2">
                {block.text}
              </h2>
            );
          case 'p':
            return (
              <p key={i} className="text-sm leading-relaxed text-ink-muted">
                {block.text}
              </p>
            );
          case 'list':
            return (
              <ul key={i} className="space-y-2">
                {block.items.map((item, j) => (
                  <li key={j} className="flex gap-2.5 text-sm leading-relaxed text-ink-muted">
                    <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-bronze" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            );
          case 'steps':
            return (
              <ol key={i} className="space-y-3">
                {block.items.map((item, j) => (
                  <li key={j} className="flex gap-3 text-sm leading-relaxed text-ink">
                    <span className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-full bg-bronze/10 text-xs font-bold text-bronze">
                      {j + 1}
                    </span>
                    <span className="pt-0.5 text-ink-muted">{item}</span>
                  </li>
                ))}
              </ol>
            );
          case 'note':
            return (
              <div
                key={i}
                className="flex gap-3 rounded-xl border border-line bg-surface px-4 py-3"
              >
                <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-bronze" />
                <p className="text-sm leading-relaxed text-ink-muted">{block.text}</p>
              </div>
            );
          case 'compare':
            return (
              <div key={i} className="grid gap-4 sm:grid-cols-2">
                {block.columns.map((col, j) => (
                  <div key={j} className="rounded-xl border border-line bg-white p-4">
                    <h3 className="mb-3 text-sm font-bold text-ink">{col.title}</h3>
                    <ul className="space-y-2">
                      {col.points.map((point, k) => (
                        <li
                          key={k}
                          className="flex gap-2.5 text-sm leading-relaxed text-ink-muted"
                        >
                          <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-bronze" />
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
