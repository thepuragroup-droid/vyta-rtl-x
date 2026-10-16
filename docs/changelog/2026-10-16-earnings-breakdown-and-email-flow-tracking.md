# 2026-10-16 — Earnings by platform and affiliate, and email-flow tracking

## Summary

**Admin → Analytics → Earnings by source** now opens each bucket one level down:

| Bucket | Toggle | Rows | Under each row |
|---|---|---|---|
| Paid ads | **By platform** | Google Ads, Meta Ads, Microsoft, TikTok, LinkedIn, Other paid | its campaigns (`utm_campaign`) |
| Affiliate | **By affiliate** | each affiliate, by name | the codes the orders carried |
| Organic & referral | **By source** | Google organic, Meta organic, Referral, Email | referring site / flow email |

Each row shows orders, store (CAD) and hosted revenue, and its share of the
bucket. Click a row — or use the dropdown above the order list — to list only
that platform's / affiliate's / source's orders. The dashboard's compact card
shows the same breakdown in one line.

Which affiliate an order belongs to: the code on the order (what the
commission is paid on), else the `?ref=` code of the buyer's first visit,
matched to `referral_codes` and affiliate-owned `discount_codes`. An affiliate
order with no code shows as **Affiliate not recorded**.

## Email flows: are they producing anything?

Under **Organic & referral → By source** there is now an **Email flows** panel,
and the flows record a lot more than opens and clicks:

- **People, not scanners.** Corporate mail gateways (Safe Links, Proofpoint,
  Mimecast…) click every link the moment an email lands. Clicks are now
  classified (`lib/email-flows/engagement.ts`): HEAD requests, missing or
  scanner User-Agents, and clicks within 3 seconds of sending are logged as
  machine hits and **no longer count** as clicks. Apple Mail's privacy
  prefetch is flagged on opens but still counted, since it may be a real open.
- **Where the click went** — cart, a product, the shop, lab results, home. Only
  the path is kept; a cart link's query (its restore token) is never stored.
- **Click → checkout → sale.** A person's click sets a signed, httpOnly
  `aminocan_ef` cookie (14 days, the flows' attribution window). The hosted
  checkout copies it into the order's `attribution.email_flow` and logs a
  checkout event. When the payment lands, the engine matches the order to the
  flow entry through that event too, so a buyer who pays under a different
  email than the one we wrote to still counts.
- **Clicked through vs. bought without clicking.** Every conversion now
  records `converted_via`. The credited email is the one whose click led to
  the sale; before, it was always the last email sent.
- **Assists.** Paid orders that came through a flow email (click cookie, or the
  flow's UTM tags on the last touch), grouped by the earnings bucket they stay
  credited to — e.g. "3 Paid ads orders were closed by a cart email".

The Email Flows **Overview** shows the clicked-through split per flow and per
email, and the **Setup check** reports whether the tracking migration has run.

## To do once

Run **`email-flows-tracking-migration.sql`** in the Supabase SQL editor
(idempotent). It adds `email_flow_events` and
`email_flow_entries.converted_via`. Without it, flows send and convert exactly
as before; the panel says it is only recording opens and clicks.

The breakdown needs no migration.

## Files

- `lib/analytics/earnings-breakdown.ts`: the breakdown rule (pure, tested)
- `lib/analytics/affiliate-lookup.ts`: code → affiliate name
- `lib/analytics/email-flow-report.ts`: the email-flows panel figures (pure, tested)
- `app/api/admin/analytics/email-flows/route.ts`: `GET`, admin/assistant only
- `lib/email-flows/engagement.ts`: person-or-machine, link kinds, crediting a conversion
- `lib/email-flows/events.ts`: the event log writes
- `lib/email-flows/tokens.ts`: the signed click cookie
- `components/admin/EarningsByChannel.tsx`, `components/admin/EmailFlowsAttribution.tsx`
- Tests: `npx tsx --test lib/analytics/earnings-breakdown.test.ts lib/email-flows/engagement.test.ts`
