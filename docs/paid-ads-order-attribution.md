# How an order comes to be shown as "Paid ads"

`MARKETING_ATTRIBUTION.md` describes the whole attribution system. This page
answers one narrower question that keeps coming up when reading the admin
screens: **when the dashboard says a sale came from Paid ads, what exactly made
it say that — and where does that same order show up elsewhere?**

Read it as a trace of a single order, from the click to the number on screen.

## The short version

1. The visitor arrives on a URL carrying a `gclid` (or `fbclid`, `msclkid`, or
   paid UTMs). `middleware.ts` writes that arrival into a cookie.
2. That arrival is classified into one **channel** — e.g. `google_ads`.
3. When the order row is created, the channel is **copied onto the order** in
   `orders.attribution_channel`. It is a snapshot, not a join.
4. The report reads that column back and rolls the six paid channels up into
   one bucket labelled **Paid ads**.

Nothing re-computes the channel later. What you see on the order in six months
is what its buyer's cookie said on the day they bought.

## Step by step

### 1. The click is captured — `middleware.ts`

Middleware runs before React and therefore sees the visitor's **first** landing
URL, which a client-side navigation would otherwise erase. On arrival it writes:

| Cookie | Holds |
| --- | --- |
| `aminocan_vid` | anonymous visitor id (~13 months) |
| `aminocan_sid` | session id, per visit |
| `aminocan_attr` | **first touch** — written once, never overwritten |
| `aminocan_attr_last` | most recent meaningful touch |

A visit carrying no acquisition signal (typed the domain, opened a bookmark)
writes nothing, so a returning customer never decays to `direct`.

`gclid` is deliberately **left in the address bar** — Google's conversion linker
and GA4 auto-tagging read it from the URL.

### 2. The touch becomes a channel — `lib/analytics/attribution.ts`

Click identifiers win outright over UTMs, because auto-tagging produces a
`gclid` with no UTMs at all:

| Channel | Recognised by |
| --- | --- |
| `google_ads` | `gclid`, `gbraid`, `wbraid`, or `utm_source=google` + a paid medium |
| `meta_ads` | `fbclid`, or a Meta source + a paid medium |
| `bing_ads` / `tiktok_ads` / `linkedin_ads` | `msclkid` / `ttclid` / `li_fat_id` |
| `other_paid` | any source with `utm_medium` in cpc, ppc, paid\*, cpm, display… |

Those six — and only those six — are `PAID_CHANNELS`. `isPaidChannel()` is the
single definition of "we paid for this", and every "Paid ads" figure in the
admin traces back to it. Everything else (`google_organic`, `referral`,
`affiliate`, `email`, `direct`) is not paid.

### 3. The channel is frozen onto the order

`attributionColumns()` in `lib/analytics/attribution-server.ts` reads the
cookies and returns three columns, written on the order row at creation:

| Column | Value |
| --- | --- |
| `attribution_channel` | `google_ads` — the classified channel |
| `attribution_campaign` | `utm_campaign`, when the ad was tagged with one |
| `attribution` (JSONB) | both touches in full: source, medium, term, content, click id, landing path, referrer host |

**First touch wins.** `attributionColumns` uses `ctx.first ?? ctx.last`: the
visit that won the customer keeps the credit, even if they came back later
through a Google search and ordered then. The order page says so out loud when
the two differ.

Two write paths reach that column:

- **Storefront orders** (`/api/orders-email`) read the buyer's own cookies at
  checkout and write straight into `orders`.
- **Hosted checkout** (`/api/checkout/puramass`) is harder: once the buyer is
  handed to PuraMass they leave our cookies behind, and payment returns through
  a webhook that knows only an email. So the channel is frozen onto
  `puramass_orders` **on the way out**, the buyer's email is attached to their
  visitor row at the same moment, and the webhook
  (`/api/webhooks/stealth-health`) or the poller (`lib/payments/puramass-poll.ts`)
  joins back on that email when the order flips to `paid`.

If the migration hasn't run, both paths detect the missing columns (Postgres
`42703`) and retry without them. An order is never lost to a reporting column.

### 4. The report rolls six channels into one bucket

`GET /api/admin/analytics/attribution` scans three tables for the range —
`visitor_attribution` (the funnel), `orders` (CAD revenue), `puramass_orders`
(USD revenue) — and groups the per-channel rows by **how the sale was won**:

| Group | Channels | Rule |
| --- | --- | --- |
| **Paid ads** | `google_ads`, `meta_ads`, `bing_ads`, `tiktok_ads`, `linkedin_ads`, `other_paid` | `isPaidChannel(channel)` |
| Affiliate | `affiliate` | a commission was owed |
| Organic & referral | `google_organic`, `meta_organic`, `referral`, `email` | earned |
| Direct | `direct` | came straight to us |
| Unattributed | — | order carries no channel at all |

An order only counts once its payment is real: status in `confirmed`,
`processing`, `shipped`, `delivered`, `paid` for storefront orders, and `paid`
for hosted ones. A pending order sits in no bucket's revenue.

`unattributed` is a bucket of its own rather than being folded into direct —
"we don't know" and "they came straight to us" are different facts, and merging
them flatters the direct number. The buckets sum to **every** paid order in the
range, so the split reads as a whole rather than a sample.

## Where a paid-ads order actually appears

### Admin dashboard (`/admin`)

The **Earnings by source** card (`EarningsByChannel`, `variant="compact"`).
The order contributes to the **Paid ads** row: its order count, its CAD or USD
revenue, and the bronze segment of the share bar. "Full breakdown" links to
Analytics. The card hides itself entirely when there is nothing to show, rather
than sitting there as an empty shell.

### Analytics → Overview

The same card, again compact, inside the store report.

### Analytics → Acquisition

The fullest view, four ways:

- **Earnings by source**, full variant — Paid ads row with order count, CAD and
  USD revenue, average order value per currency, and the list of channels rolled
  up into it (`Google Ads · Meta Ads · …`).
- **Four paid-traffic KPIs** across the top — paid visitors, paid purchasers
  with conversion rate, paid revenue CAD, paid revenue USD. These sum only the
  rows where `paid` is true.
- **Channels table** — one row per channel, so the order shows under *Google Ads*
  specifically rather than the bucket. Paid rows carry a bronze **PAID** badge
  and a tinted background, and sort to the top.
- **Top campaigns** — keyed on `utm_campaign`, split by channel so the same
  campaign name under two networks doesn't merge.

### Admin → Analytics, read by the analytics role

The analytics/marketing role is an external partner, so it reads a **paid-ads
only** version of every page above: the store report, the operational summary,
the acquisition tab and the printable product report all filter to
`PAID_CHANNELS` server-side before anything is aggregated, traffic included, so
its conversion rate divides ad-won orders by the visitors those ads brought.
The order in this trace is one of the few it can see at all; an organic or
direct order is not in its totals anywhere.

The rule lives in `lib/analytics/paid-scope.ts` and fails closed — if the
attribution columns are missing, that reader sees zero rather than everything.
Admin and assistant read the whole business unchanged. See
`docs/changelog/2026-09-07-analytics-role-paid-ads-only.md`.

### The order itself (`/admin/orders/[id]`)

An **Acquisition** card showing channel, campaign, landing page, referrer and
click ID. When the last touch differs from the first, it adds a line saying so
and explaining that revenue is credited to the first touch.

The card is hidden — not shown as "Direct" — when the order carries no channel.
An order placed before attribution existed has no acquisition story, and
inventing one would be worse than saying nothing.

### The customer (`/admin/customers/[id]`)

A **Came from** row, frozen onto `customers.attribution_channel` at signup and
never rewritten, so signing in later from a Meta ad cannot rewrite history.

## Why an order might *not* say Paid ads

In rough order of how often it is the answer:

| Symptom | Cause |
| --- | --- |
| Shows as **Unattributed** | Placed before `marketing-attribution-migration.sql` ran, or the buyer blocked cookies. |
| Shows as **Direct** | The ad click never reached us with an identifier — a stripped `gclid`, a link opened from an app's in-app browser, or a new device on a returning customer. |
| Shows as **Google organic**, not Google Ads | Auto-tagging is off *and* the campaign carries no paid `utm_medium`. Nothing distinguishes it from a search result. |
| Shows in **Paid ads** but with no campaign name | Auto-tagging only. `gclid` classifies the channel; the campaign name comes from `utm_campaign`, which needs a tracking template in Ads. |
| Shows under **Affiliate**, not Paid ads | The `?ref=` code was on the URL. Affiliate classification wins — the commission is the real cost of that sale. |
| Nothing at all is collecting | The migration hasn't run. Acquisition says so outright instead of rendering zeroes. |

## Three rules the numbers obey

**CAD and USD are never summed.** Storefront orders bill in CAD, hosted checkout
in USD. They are separate figures everywhere, and the share bar is drawn on
**order counts** precisely because there is no single denominator. The campaign
table adds them for ranking only — treat that column as sort order, not money.

**Paid-ads revenue is not profit.** Ad spend is not imported from Ads or Meta,
so none of this is ROAS. It is what those campaigns brought in, full stop.

**A large unattributed share invalidates the split.** At 20% or more the full
view says so in as many words. Until that falls, the percentages are directional
at best.

## Reading it back from SQL

```sql
-- Every paid-ads storefront order in a range
select id, created_at, status, total, attribution_channel, attribution_campaign
from orders
where attribution_channel in
      ('google_ads','meta_ads','bing_ads','tiktok_ads','linkedin_ads','other_paid')
  and status in ('confirmed','processing','shipped','delivered','paid')
  and created_at >= '2026-08-01'
order by created_at desc;

-- The full touch detail behind one order
select attribution from orders where id = '…';
```

Both tables are indexed on `attribution_channel`; `puramass_orders` is the same
query with `status = 'paid'` and `subtotal_cents / 100`.
