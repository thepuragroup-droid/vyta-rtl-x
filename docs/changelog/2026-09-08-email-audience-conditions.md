# 2026-09-08 — Email conditions: pick the audience by rule, not by hand

## Summary

The **Email customers** button above `/admin/customers` has always worked one
way: tick people, click, write. That is fine for five customers and hopeless for
a campaign — nobody hand-picks "everyone who joined this quarter who has not
already had the restock note" out of four hundred rows, and the two ways it goes
wrong are both customer-visible: the wrong people get the email, or the same
people get it twice.

So the selection now takes **conditions** first:

1. **Dates** — when somebody joined, and when they were last active. A promo
   aimed at lapsed buyers is a different list from one aimed at this month's
   signups, and both are now one date range rather than a manual sweep.
2. **Skip anyone already sent…** — one or more email types (any template either
   desk sends, cart chases included) plus how far back to look: ever, 7, 30, 90
   days or 6 months. Anyone who has already had one of those is dropped from the
   list before they can be ticked.

The conditions narrow the table itself, so what is on screen is exactly the
audience, and the existing "select all" tick then means what it says.

**The suppression rule is enforced twice, on purpose.** The page applies it to
build the list; the send route applies it again against the outreach log at the
moment the batch goes out. The page's copy is minutes old by the time a draft is
written — long enough for a colleague at another desk to send the very email
this batch is about to repeat. Only the second check can actually stop that, and
anyone it stops comes back in the result as *skipped*, named, with the email they
already had and when.

**No database migration.** This reads `customer_emails`, which the customer CRM
migration already creates.

---

## What changed

### The rules — `lib/customer/audience.ts` (new)

Isomorphic, so the browser filtering the table and the route refusing a
recipient run the same predicate rather than two that agree until they don't.

- `AudienceFilters` — the four dates, the template keys to skip, the window.
- `withinDayRange` / `matchesDateFilters` — inclusive whole **local** days at
  both ends. A row with no date is left **out** of a range rather than quietly
  kept in it: "joined since March" cannot honestly include somebody whose join
  date we do not have, and keeping them is how they end up in the send.
- `suppressionReason` — returns *which* email they already had and *when*, not a
  bare boolean, so both the table and the send result can say why somebody was
  held back. Times are compared as instants, never as strings: Postgres returns
  `…+00:00` and `toISOString()` produces `…Z`, and `'+' < '.'`, so a
  lexicographic test would read a send as older than the cutoff it sits exactly
  on and let that person straight back into the batch.
- `EMAIL_TYPE_OPTIONS` — built from `PROMO_TEMPLATES` + `RECOVERY_TEMPLATES`, so
  the chips can never drift from the keys `customer_emails.template` stores.

### Server — `lib/customer/outreach.ts`, `app/api/admin/customers/outreach/route.ts`

- `fetchOutreachHistory` folds the outreach log into "who has already had which
  kind of email", keyed by lower-cased address (as `fetchEmailHistory` matches —
  plenty of these people have no `customers` row at all). **Successful sends
  only**: a message the mail server rejected never reached anybody, and holding
  that person back would drop them from a campaign over an email they never got.
- `GET …/outreach?history=1&templates=…&withinDays=…` — the whole rule for a
  list of hundreds in one query instead of one per row. Only the named template
  keys come back, and no subjects, bodies or promo codes: this is a suppression
  lookup, not the correspondence history.
- `POST …/outreach` takes `suppress: { templates, withinDays }` and splits the
  resolved batch before anything is sent. If the log **cannot be read**, nothing
  goes out (503) — sending anyway would break the promise the admin made when
  they set the condition. If everyone is held back, that is a normal `200` with
  `sent: 0` and the skipped list, not a send error.
- The batch audit line records the held-back count, so an audit reader comparing
  a 12-person batch against a 20-person selection can see where the other eight
  went.

### Admin UI

- `app/(admin)/admin/customers/_components/AudienceFilters.tsx` (new) — the
  conditions panel, collapsed by default with a count on the button, so it costs
  nothing to the admin who just wants to look somebody up. Shows how many match
  and how many were held back, live.
- `page.tsx` — the conditions narrow the table, ticks reset when they change,
  and the results count and empty state say when rows are hidden because those
  people were already emailed rather than because nobody matched.
- `BulkEmailDialog.tsx` — carries the rule to the send, says in the composer's
  subheading that it will be re-checked, and lists who was skipped afterwards.

## Not changed

- Sends are still one email per person, resolved per recipient — no CC, no BCC,
  no shared cart or payment link. Conditions decide *who* is on the list; they
  change nothing about what each person receives.
- Promo codes are still generated on app.puramass.com and pasted in.
- The recipient cap of 40 per send is unchanged; conditions make a batch easier
  to build, not bigger.

## Tests

`lib/customer/audience.test.ts` — 17 cases over the rules that are wrong in a
customer-visible way: inclusive day ranges, a missing date failing a range, the
window putting people back in the list once it no longer covers them, the
most-recent reason winning when several types are named, case-insensitive
address matching, and the `+00:00` vs `Z` comparison above.

```
npx tsx --test lib/customer/audience.test.ts
```
