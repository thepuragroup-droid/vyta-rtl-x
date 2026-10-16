# 2026-10-16 — Meta ad clicks filed as organic

## What was wrong

A visit is credited to Meta Ads when its link carries an `fbclid`, or a Meta
`utm_source` with a medium that says paid (`cpc`, `paid`, `paid_social`…).
Two kinds of real Meta ad click got neither and were filed as organic:

- **Meta's dynamic URL parameters.** Ads Manager's parameter builder offers
  `utm_source={{site_source_name}}` (`fb`, `ig`, `msg`, `an`) and
  `utm_medium={{placement}}` (`Instagram_Stories`, `Facebook_Mobile_Feed`,
  `Audience_Network_Classic`…). None of those placement names is a "paid"
  medium, so a click that lost its `fbclid` became **Meta organic** (or
  **Referral**, for `an` / `msg`).
- **Common paid wording** — `paid_ads`, `social_paid`, `ads`, `sponsored` —
  wasn't on the paid list either.

The `fbclid` is lost more often than one would hope: iOS strips it in Mail,
Messages and private browsing, and some link shorteners and redirects drop it.

Also fixed: a tap from the Instagram or Facebook **Android app** arrives with
`android-app://com.instagram.android` as its referrer. That was discarded,
so the visit read as **Direct**. It now reads as Meta organic (or Google
organic, for the Google search app).

## What changed

- `classifyChannel` recognises Meta's placement names (the exact list Meta
  uses, so a hand-typed organic tag like `instagram_bio` stays organic), Meta's
  site-source names, and the extra paid wording. New visits are filed right.
- **Analytics → Acquisition → Check the unpaid visitors** shows what the
  organic, referral and direct visitors actually arrived with, and marks the
  groups that were ad clicks.
- **Move them** (admin only) moves every misfiled row — visitors, store and
  hosted orders, customers, across all history — to its paid channel. Only
  ever unpaid → paid. It re-reads each row's stored tags with the current
  rules, so nothing else changes. Customers moved to an ad channel who haven't
  ordered yet become eligible for the paid-ads welcome discount, exactly as if
  the tag had been read right first time.

## What this can't fix

Visits that carried nothing to say they came from an ad — no `fbclid`, no
paid tag — can't be recovered. The panel lists the other reasons our counts
won't match Meta's: first-touch credit, Meta's in-app browser keeping its own
cookies, the consent banner, and clicks that never finished loading.

**Recommended Ads Manager URL parameters:**
`utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}`

## Files

- `lib/analytics/attribution.ts` — the rules
- `lib/analytics/reclassify.ts` — re-reading stored touches (pure, tested)
- `app/api/admin/analytics/attribution/audit/route.ts` — `GET` audit, `POST` move
- `components/admin/AttributionAudit.tsx`
- Tests: `npx tsx --test lib/analytics/attribution.test.ts lib/analytics/reclassify.test.ts`
