# Marketing Attribution

How the site tells a Google Ads visitor apart from an organic one, and follows
them from the first click to a confirmed payment.

For the narrower question of **why one particular order is shown as "Paid ads"**
— what wrote that label, and where the same order appears across the dashboard,
Analytics and the order page — see
[`docs/paid-ads-order-attribution.md`](docs/paid-ads-order-attribution.md).

For **off-site landing pages** (a page on another domain that links here with
`?lp=<slug>` and advertises a discount the checkout then applies), see
[`LANDING_PAGES.md`](LANDING_PAGES.md). The landing page is recorded on the
touch alongside the channel described below, not as a channel of its own.

## The problem this solves

GA4 and GTM were already installed, so Google could report campaign performance
inside Google's own UI. But nothing reached our database:

- no `gclid`, `fbclid` or `utm_*` was captured anywhere;
- `orders.source` was always `'website'`;
- `customer_activity` only recorded **signed-in** customers, so the entire
  pre-signup journey — most of the funnel, and all of the part paid traffic
  lands in — was invisible;
- the PuraMass hosted checkout never fired a `purchase` event at all, so those
  conversions never reached Google Ads.

In `/admin`, a customer from a $40 Google Ads click looked exactly like an
organic one. Per-channel CAC and LTV were not computable.

## How it works

### 1. Capture — `middleware.ts`

Middleware is the only place that sees a visitor's **first** landing URL; by the
time React hydrates, a client-side navigation may have replaced it. On every
storefront request it:

- mints `aminocan_vid` (anonymous visitor id, ~13 months) and `aminocan_sid`
  (per-visit session id) if absent;
- parses the URL and `Referer` into a **touch** and stores it in
  `aminocan_attr` (first touch, written once and never overwritten) and
  `aminocan_attr_last` (most recent meaningful touch);
- keeps the pre-existing affiliate `?ref=` capture.

Only `?ref=` is stripped from the address bar. **`gclid` and friends are left in
place on purpose** — Google's conversion linker and GA4 auto-tagging read them
from the URL, and removing them would break the Ads reporting this is meant to
support.

A visit carrying no acquisition signal (typed the domain, opened a bookmark)
writes nothing, so a returning visitor never decays to `direct` and the campaign
that won them keeps the credit.

Because cookies are only written on a first visit or a campaign arrival, a
returning visitor's response carries no `Set-Cookie` and stays cacheable.

### 2. Classification — `lib/analytics/attribution.ts`

One touch becomes one channel. Click identifiers win outright — a `gclid` is
proof of a paid Google click however the campaign tagged its UTMs, which is
exactly what auto-tagging produces:

| Channel | Recognised by |
| --- | --- |
| `google_ads` | `gclid`, `gbraid`, `wbraid`, or `utm_source=google` + a paid medium |
| `meta_ads` | `fbclid`; a Meta source (`facebook`, `ig`, `fb`, `an`, `msg`…) + a paid medium; or Meta's own `{{placement}}` value as the medium (`Instagram_Stories`, `Facebook_Mobile_Feed`, …), which only an ad produces |
| `bing_ads` / `tiktok_ads` / `linkedin_ads` | `msclkid` / `ttclid` / `li_fat_id` |
| `other_paid` | any source with `utm_medium` in cpc, ppc, paid*, cpm, display… |
| `google_organic` / `meta_organic` | that platform, without a click id or paid medium |
| `email` | `utm_medium=email` and friends |
| `affiliate` | `?ref=` code, or `utm_medium=affiliate` |
| `referral` | any other referring host |
| `direct` | nothing at all |

Covered by `lib/analytics/attribution.test.ts` — run it with
`node --test --import tsx lib/analytics/attribution.test.ts`.

### 3. Anonymous journey tracking

`POST /api/customer/activity` now accepts visitors with no account, keyed on the
visitor cookie. Recorded events: `page`, `view`, `search`, `cart`, `click`,
`lab_result`, `checkout_start`, `signup`, `purchase`.

Lab-result (COA) opens are tracked specifically because they are the strongest
trust signal on the site — the people who read one are the ones deciding whether
to buy.

### 4. Stitching at signup / sign-in

`POST /api/customer/activity/identify` runs on every `SIGNED_IN` transition. It:

1. links the visitor row to the customer id and email;
2. freezes the acquisition channel onto `customers.attribution_channel`, **only
   if empty** — signing in from a later Meta ad must not rewrite history;
3. backfills `customer_id` onto the events recorded before the account existed,
   so `/admin/customers/[id]` shows the whole journey.

The signup milestone is only stamped when the account is younger than the visit
that led to it. Otherwise every returning login would be reported as an
acquisition for whichever channel that visitor happened to arrive from.

### 5. Closing the loop on purchases

Attribution is frozen onto the row at creation — copied, not joined — so a
report over a date range is one scan, and re-attributing a visitor later cannot
silently rewrite past revenue.

- **Storefront orders** (`/api/orders-email`) get the channel from the buyer's
  own cookies at checkout. Payment confirmation (`/api/orders/check-payment` and
  the cron sweep) marks the visitor as having purchased.
- **Hosted checkout** (`/api/checkout/puramass`) is the harder case: once the
  buyer is redirected to PuraMass they leave our cookies behind, and the payment
  comes back through a webhook that knows nothing but an email address. So the
  channel is frozen onto the ledger row **on the way out**, the buyer's email is
  attached to their visitor row at the same moment, and both the webhook
  (`/api/webhooks/stealth-health`) and the poller (`lib/payments/puramass-poll.ts`)
  join back on that email when the order flips to `paid`.

Because a person can have several visitor rows against one email (two devices,
cleared cookies), the email join stamps every match; the report counts distinct
visitors, so this does not double-count revenue.

### 6. Reporting

Attribution surfaces in four places.

**Earnings by source** — `components/admin/EarningsByChannel.tsx`, rendered on
the **admin dashboard**, the **Analytics → Overview** tab, and in full on
**Acquisition**. It splits revenue by how the sale was won:

| Group | Channels |
| --- | --- |
| Paid ads | `google_ads`, `meta_ads`, `bing_ads`, `tiktok_ads`, `linkedin_ads`, `other_paid` |
| Affiliate | `affiliate` |
| Organic & referral | `google_organic`, `meta_organic`, `referral`, `email` |
| Direct | `direct` |
| Unattributed | orders with no channel |

`unattributed` is a group of its own rather than being folded into direct —
"we don't know" and "they came straight to us" are different facts, and merging
them flatters the direct number. The groups always sum to every paid order in
range, so the split reads as a whole rather than a sample. When the unattributed
share is 20% or more the full view says so in as many words, because until it
falls the split is not yet trustworthy.

**Inside each bucket**: Paid ads, Affiliate and Organic & referral open a
breakdown one level down: **By platform** (Google Ads, Meta Ads, … and the
campaigns under each), **By affiliate** (every code an affiliate owns rolls up
to them; the order's own `referral_code` decides, else the first visit's
`?ref=`), and **By source** (Google organic, Meta organic, Referral by site,
Email by flow email). Every row opens, even with a single order, to show
what is under it and its own orders; the dropdown above the order list
narrows the full list to one platform / affiliate / source. The rule lives in
`lib/analytics/earnings-breakdown.ts` and is shared by the summary and the
order list, so they always agree. The dashboard's compact view shows the same
breakdown as one line ("Google Ads 10 · Meta Ads 4").

**Email flows** sit under Organic & referral, read from their own side: a flow
email almost never wins a customer, so the split keeps crediting the sale to
the first touch. The panel shows sends, opens, people's clicks (mail-scanner
clicks excluded), checkouts opened from a click, purchases split into *clicked
through* and *bought without clicking*, and the paid orders a flow email
closed, by the bucket they are credited to. See
`docs/changelog/2026-10-16-earnings-breakdown-and-email-flow-tracking.md`.

**Which orders are in each bucket**: in the full view every group row has a
*Which orders?* toggle. It lists the paid orders behind that percentage (from
`GET /api/admin/analytics/attribution/orders?group=…`), each with a one-line
reason and the evidence that decided it — the click ID (`gclid`, `fbclid`, …),
`utm_source` / `utm_medium` / campaign, referral code, referring site and
landing path from the order's first touch. The bucket rule is shared with the
summary (`earningsGroupOf` in `lib/analytics/order-source.ts`), so the list
always matches the count above it.

For **Unattributed** orders the reason says whether the order predates the first
attributed order (attribution wasn't collecting yet) or came after it (cookie
blocked, consent declined, another device). It also shows amber *Likely …*
hints from three places: a `referral_code` on the order (→ affiliate), the
channel the buyer's customer account was won by, and a tracked visitor with the
buyer's email. Hints are for reading only. They never move an order out of
Unattributed, so the split still counts only what was recorded.

The `analytics` role may open only the Paid ads bucket, and buyer emails are
withheld from it.

**Admin → Analytics → Acquisition** also shows the funnel per channel —
visitors, sign-ups, checkouts, purchasers, conversion — plus a campaign
drill-down from `utm_campaign`.

**Per-record**: the customer detail page shows a *Came from* row, and the order
detail page an *Acquisition* card with the channel, campaign, landing page,
referrer and click ID. Both hide themselves when the record carries no channel,
rather than reporting "Direct" on no evidence.

**Who sees how much of it**: admin and assistant read every channel. The
`analytics` marketing-partner role reads **paid ads only** — every sales figure
on every analytics surface is filtered to `PAID_CHANNELS` in the route before
aggregation, along with the traffic those figures are divided by. See
`lib/analytics/paid-scope.ts` and
`docs/changelog/2026-09-07-analytics-role-paid-ads-only.md`.

### Two rules the reporting enforces

Native orders are CAD and hosted orders are USD, so they are shown as **separate
figures and never summed**. For the same reason the share bar is drawn on
**order counts**, not revenue — there is no single denominator to divide by.

Paid-ads revenue is what those campaigns brought in, **not profit**: ad spend is
not imported, so none of this is ROAS.

### Visitor counts changed

`customer_activity` now records anonymous visitors, so "visitors" and "active
shoppers" in Analytics count **distinct people, signed-in or not** — identified
by `customer_id` when known and the visitor cookie otherwise, so a session that
starts anonymous and ends signed-in counts once.

Both analytics routes were previously signed-in-only and undercounted traffic by
design. **Figures from before the migration are not comparable with those after
it**, and conversion rates in particular will drop sharply — the denominator got
much bigger and more honest. Visitors who decline the cookie banner are still
not recorded, so GA4 remains the fuller picture of total sessions.

## What the classification is used for, besides reporting

**The paid-ads welcome discount.** A visitor whose first or last touch was a
paid channel is offered a percentage off for creating an account, and gets it
automatically on their FIRST order once they have one. The offer is advertised
on a strip under the nav bar, restated on the cart and checkout, and settled
server-side at hand-off by lowering the line prices sent to PuraMass — the
hosted order has no discount field. Switched on in Admin → Promotions; the
arithmetic and the eligibility rule live in `lib/promos/ad-discount.ts`, and
`docs/changelog/2026-09-11-storefront-promos-and-ad-discount.md` explains both.

Eligibility is read from both places a channel is recorded — the cookies below
and `customers.attribution_channel` frozen at signup — so a buyer who cleared
their cookies since creating the account keeps the offer the ad won them.

It is a welcome offer, so it is spent once. Whether a customer still has it is
decided by `lib/promos/first-order.ts`, which the storefront and the hand-off
both read: a buyer counts as having ordered when the legacy
`customers.has_completed_first_order` flag is set, or when they already have a
hosted order that is paid or awaiting payment. An abandoned checkout that
expires or is cancelled gives the offer back. This is the only discount the
store runs — there is no blanket first-order discount for non-ad traffic.

## Consent

The visitor and attribution cookies are first-party, carry no personal data (an
opaque id and the campaign that produced the visit), and are set on arrival —
exactly as the pre-existing `ref_code` affiliate cookie already was.

What consent gates is **persistence**. Nothing is written to the database for an
anonymous visitor unless the consent banner is switched off in
Admin → Branding & Tracking, or the visitor pressed Accept. The banner decision
is mirrored from localStorage into an `aminocan_consent` cookie so the server can
read it. `isConsentRequired` fails closed: if the setting can't be read, consent
is assumed to be required.

Signed-in customers are always recorded — that is first-party service data about
their own account, alongside their order history.

If you want the cookies themselves gated behind the banner too, that is a
one-line change in `middleware.ts`, at the cost of losing the `gclid` for anyone
who accepts *after* landing.

## Setup

1. Run `marketing-attribution-migration.sql` in the Supabase SQL editor. It is
   idempotent. Until it runs, the app degrades cleanly: orders and signups keep
   working and the Acquisition tab says it is not collecting.
2. In **Google Ads**, leave auto-tagging on (it is the default). `gclid` arrives
   with no work needed.
3. For campaign-level breakdown, add a tracking template or final-URL suffix in
   Ads: `utm_source=google&utm_medium=cpc&utm_campaign={campaignid}`. Without
   it, a Google Ads click is counted in its channel but has no campaign name.
4. In **Meta Ads Manager**, add URL parameters:
   `utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}`.
   `fbclid` is added automatically and is enough to classify the channel, but
   the UTMs are what name the campaign.

## Known limitations

- **Hosted-checkout conversions still do not reach Google Ads.** Payment happens
  on PuraMass's domain, so no client-side `purchase` event can fire. Our own
  ledger knows the sale; Ads does not, so its bidding is optimising on partial
  data. Closing that needs a server-side conversion upload (Google Ads API
  offline conversions, keyed on the stored `gclid`) — the `gclid` is now
  captured and stored, which is the prerequisite.
- **Cross-device journeys break** unless the person signs in on both, which is
  why the email join exists for the checkout path.
- **Ad spend is not imported**, so the report shows revenue per channel, not
  ROAS. Spend would have to come from the Ads and Meta APIs.
- **Our visitor counts will not match Meta's click counts.** A visitor is
  credited to their first visit, so someone who found the store on Instagram or
  Google before clicking an ad stays organic. Instagram and Facebook open links
  in their own browser with its own cookies, so a person who clicks the ad and
  comes back later in Safari or Chrome is a new visitor with no tags. Visitors
  who decline the cookie banner are not recorded. And Meta counts link clicks
  whose page never finished loading.
- **A Meta ad link tagged `utm_medium=social`** (and without its `fbclid`) is
  read as Meta organic, because posts are tagged that way too. Use
  `utm_medium=paid_social`, or Meta's `{{placement}}`.

## Checking for misfiled ad clicks

**Analytics → Acquisition → Check the unpaid visitors** lists what the
visitors credited to organic, referral and direct actually arrived with — utm
source and medium, referring site, click id — and marks the groups the current
rules say were ad clicks. An admin can then move every such row (visitors,
orders, customers, all history) to its paid channel. The move is one-way —
unpaid to paid only — and re-reads the raw tags each row was stored with
(`lib/analytics/reclassify.ts`), so it fixes only what a missing rule got
wrong. It runs again safely; a second run finds nothing.
