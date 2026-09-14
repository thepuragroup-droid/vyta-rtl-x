# 2026-09-08 — "Nudged": see who we just emailed, before emailing them again

## Summary

The desk could already hold people back by rule — tick "skip anyone already
sent the discount nudge" in the conditions panel and they drop out of the list.
But that rule only bites once somebody has thought to set it, and the mistake
worth catching is the one nobody thinks to set a rule for: a colleague chased a
cart on Tuesday, and Thursday's batch chases it again.

So the answer is now on screen whether or not any condition is set:

1. **A "Nudged" column on `/admin/customers`** — when we last wrote to each
   person and which email it was, in **amber** when that was inside the last 14
   days, plain when it was longer ago, and "never emailed" when it never
   happened. The selection summary above the table counts them too: *"12
   selected · 3 already emailed in the last 14 days"*.
2. **A warning in the composer** — above the draft, for as long as anybody on
   the send heard from us inside that window, naming them, what they got and
   when. The recipient picker marks its rows the same way, so a repeat is
   visible at the moment somebody is added rather than after the batch is built.

It **warns and never blocks**. A second nudge is often exactly the right call —
that is what a last-chance email *is* — so the decision stays with the admin and
this only makes sure they are making it on purpose. Anyone who wants the
automatic version still has the conditions panel, and the warning says so.

Alongside it, one thing the nudge itself was getting wrong: a cart the PuraMass
ledger never priced was rendering as **"Subtotal $0.00 · Total $0.00"** under a
real basket, in an email offering 20% off it. A figure we do not have is now
left out rather than printed as zero — see below.

**No database migration.** This reads `customer_emails`, which the customer CRM
migration already creates.

---

## What changed

### The vocabulary — `lib/customer/audience.ts`

The recent-contact half sits next to the suppression rule it complements, and is
isomorphic for the same reason: the table marking a row and the composer naming
a person are running the same predicate, not two that agree until they don't.

- `RECENT_NUDGE_DAYS = 14` — how recently is "recently", stated once.
- `NudgeSummary` — the last successful send to one address: a template key, a
  timestamp, and how many sends landed inside the window. Deliberately tiny; no
  subjects, no bodies, no promo codes. The correspondence itself still lives on
  the customer's own page.
- `isRecentlyNudged` reads the count the index built rather than re-deriving the
  age from `sentAt`, so a page left open for hours cannot show a flag that
  disagrees with the number beside it.
- `describeNudge` / `nudgeAgeDays` / `recentlyNudged` — the wording and the
  ordering, so "Discount nudge, yesterday" is phrased the same everywhere. An
  unusable timestamp sorts last instead of returning `NaN` from the comparator
  and scrambling the whole list.

### Server — `lib/customer/outreach.ts`, the directory and outreach routes

- `fetchNudgeIndex` folds the outreach log into "when was this address last
  written to, and how often lately", keyed by lower-cased address. **Successful
  sends only**, exactly as `fetchOutreachHistory` counts them: a message the
  mail server rejected reached nobody.
- `since` narrows the **read**, not the meaning — `recentCount` is always
  counted from `RECENT_NUDGE_DAYS` ago. The customer table reads the whole log
  (its column shows the last send whatever its age); the composer and the picker
  read the recent window alone, because that is the only part they ask about and
  the picker's read runs on every search.
- Rows come back newest-first, so the `ROW_LIMIT` ceiling drops the **oldest**
  sends first: on a log big enough to hit it, somebody written to long ago reads
  as never written to, which is the harmless direction to be wrong in.
- `GET /api/admin/customers/directory` returns `nudge` per row plus
  `nudgesAvailable`. Read for **admin/assistant only** — `customer_emails` is
  service-role, and an affiliate's scoped view has no business reading what the
  desk sent their referrals.
- `OutreachRecipient` carries `nudge`, populated by `resolveOutreachRecipients`
  and `searchOutreachCandidates`, so every composer and every picker gets the
  signal without its own query.

### Admin UI

- `app/(admin)/admin/_components/RecentContactNotice.tsx` (new) — the amber
  panel above the draft. Names people rather than only counting them: *"3 of
  these 12 were emailed recently"* without saying who is a number nobody can
  act on. Renders nothing when the send is clean, so the ordinary case is
  unchanged.
- `EmailComposer` takes an optional `primaryRecipient`, counted into the warning
  alongside whoever is picked below — on a single-customer send the person the
  draft opened on *is* the one who might have been chased last week. Left unset,
  the warning still covers the extras, so no caller has to supply it to be safe.
- `RecipientPicker` marks a recently-emailed row in amber where it is added.
- `page.tsx` — the "Nudged" column, dropped entirely (not drawn blank) when the
  log could not be read: an empty cell in a column fed by a log reads as "we
  could not tell", and the point of the column is that it can.

### A zero is a missing figure, not a free order — `lib/customer/promo-email.ts`

Spotted in a discount-nudge preview: a real basket under **"Subtotal $0.00 ·
Total $0.00"**, in an email offering 20% off it. PuraMass sends
`subtotal_cents: 0` on a hand-off it never priced, and the builder printed that
figure faithfully.

`knownAmount` now treats a zero, negative or non-finite figure as "we do not
have this amount", and the cart block leaves out what it cannot back up: no
subtotal row, no discount row, no total, and an empty price cell on a line with
no price. The basket itself still lists what the buyer chose — that is what
makes the email recognisable — and the offer still stands, worded as "Applies to
your whole order" instead of "$X off this cart". The HTML and the plain-text
alternative drop the same figures, and the composer's preview is rendered by the
same function, so what an admin approves is what goes out.

A total that comes out at **zero because the discount took it there** is a
different thing and is still shown: that one is true, and it is the number the
customer most wants to see.

`cartAmount` in `outreach-types.ts` follows the same rule, so a "$0.00 USD" chip
in the recipient picker does not read as a worthless cart either.

## Not changed

- Nothing is held back. The conditions panel is still the only thing that
  removes anybody from a list, and it is untouched.
- Sends are still one email per person, resolved per recipient — no CC, no BCC,
  no shared cart or payment link.
- The 40-recipient cap per send is unchanged.

## Tests

`lib/customer/promo-email.test.ts` — five new cases over the zero rule: the
guard itself, an unpriced cart rendering its items and no totals, the offer
surviving without the arithmetic, the plain-text alternative dropping the same
figures, and a genuine 100%-off total still printing `$0.00`.

`lib/customer/audience.test.ts` — six new cases over the parts that are wrong in
a customer-visible way: a warning that never fires lets a second nudge through,
one that fires on everybody is one nobody reads. Covers the window boundary, the
count-not-the-clock rule, clock skew not rendering as "-1 days ago", the wording
per age, and the unusable-timestamp ordering.

```
npx tsx --test lib/customer/audience.test.ts lib/customer/promo-email.test.ts
```
