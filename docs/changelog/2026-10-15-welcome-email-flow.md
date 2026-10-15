# 2026-10-15 — Welcome email flow

## Summary

A 5-email welcome series that turns new subscribers into first-time customers,
sent from our own SMTP server and run from **Admin → Marketing → Welcome Flow**.

| # | Email | When | Code |
|---|---|---|---|
| 1 | Welcome — brand intro, trust badges, first-order offer | Immediately after signup | `WELCOME10` |
| 2 | Education — the science, benefits, "we show our work" | Day 2, if no purchase | — |
| 3 | Trust — third-party testing, COAs, cold chain | Day 4, if no purchase | — |
| 4 | Offer — "20% OFF your order today" | Day 6, if no purchase | `VYTA20` |
| 5 | Reminder — "Still thinking about it?" + countdown | Day 9, if no purchase | `VYTA20` |

**Rules**

- **Who enters:** new customer accounts that ticked the marketing-consent box,
  created after the flow was switched on. CASL requires express consent for
  promotional email, so nobody else is enrolled automatically. Switching the
  flow on never emails the existing customer base.
- **Stops on purchase:** a paid order on either checkout (hosted/Stealth Health
  or legacy), matched by account *and* by email, ends the flow. The purchase is
  credited to the last flow email sent before it.
- **Local time:** emails 2–5 go out between 9 and 11 AM in the subscriber's own
  time zone. The zone comes from the province/state on the account, otherwise a
  fallback (America/Toronto). Email 1 is sent straight away. There are always at
  least 20 hours between two emails, so a backlog drains one email a day.
- **Tagged "Welcome Flow":** on the subscriber record, and as a profile property
  in Klaviyo when Klaviyo is connected.
- **Unsubscribe:** every email has a link and one-click `List-Unsubscribe`
  headers (Gmail/Yahoo bulk-sender rules). Unsubscribing removes them from the
  flow **and** clears `contact_consent` on the account.

## Setup

1. Run **`welcome-flow-migration.sql`** in the Supabase SQL editor.
2. Run **`supabase-cron-welcome-flow.sql`**. It schedules
   `/api/cron/welcome-flow` every 15 minutes, reusing the `app_base_url` /
   `cron_secret` Vault secrets.
3. Optional: set `WELCOME_FLOW_SECRET` (signs the unsubscribe/tracking links).
   It falls back to `CRON_SECRET`.
4. In **Discount Codes**, create `WELCOME10` (10%, first order only). `VYTA20`
   already exists. An email whose code is missing, off, or expired is **held**
   rather than sent with a code checkout would refuse, and the page says so.
5. In **Welcome Flow → Settings**, add the mailing address for the footer
   (CASL).
6. In **Welcome Flow → Emails**, check each email with *Send a test*, then
   **Switch on**.
7. If a Klaviyo welcome series is running, turn it off, or both will send.

## The admin page

- **Overview:** enrolled, in flow, purchased (with conversion rate), revenue,
  completed and unsubscribed. The flow is drawn as the five steps, each showing
  sent / opened / clicked / purchases, and any step held on a code is marked.
- **Subscribers:** every person in the flow, filterable by status and
  searchable. A five-dot strip shows each email as sent, opened, clicked, failed
  or skipped. Expand a row for the full timeline: send times in their zone, open
  and click counts, the code, email 5's deadline, and errors. From there you can
  correct the time zone, remove or resume them, or open their customer profile.
  **Add** puts an account in by hand (for testing on yourself), with a consent
  attestation.
- **Emails:** edit each email's day, subject, preview text, code, copy,
  badges, buttons and images, with upload. The preview is rendered by the same
  function that sends, using the code's real value. Merge tags:
  `{{first_name}}`, `{{code}}`, `{{discount}}`, `{{offer_ends}}`. *Reset*
  restores the original design copy.
- **Settings:** send window, fallback zone, minimum gap, countdown length,
  footer address and disclaimer.
- **Run now** does exactly what the cron does, without waiting for the next tick.

Assistants can read all of it. Only admins can change anything or send.

## How it works

| Piece | File |
|---|---|
| Vocabulary, default copy, input validation (isomorphic) | `lib/welcome-flow/types.ts` |
| Time zones, send window, "which email next" (pure) | `lib/welcome-flow/schedule.ts` |
| The five layouts, merge tags, plain-text part (pure) | `lib/welcome-flow/render.ts` |
| Signed unsubscribe / open / click links | `lib/welcome-flow/tokens.ts` |
| Enrolment, purchase checks, sending | `lib/welcome-flow/engine.ts` |
| Funnel and subscriber table | `lib/welcome-flow/stats.ts` |
| Signup hook: enroll and send email 1 after the response | `app/api/customer/register-alert/route.ts` |
| Cron | `app/api/cron/welcome-flow/route.ts` |
| Public: open pixel, click redirect, unsubscribe | `app/api/welcome-flow/*` |
| Admin API | `app/api/admin/welcome-flow/*` |
| Admin page | `app/(admin)/admin/welcome-flow/page.tsx`, `components/admin/welcome-flow/*` |

- **At-most-once:** a `welcome_flow_sends` row (unique on subscriber + step) is
  claimed *before* the SMTP call, so overlapping runs never double-send. A
  rejected send is retried by later runs, up to 3 attempts.
- **The code is the source of truth:** `{{discount}}` prints the code's real
  value from `discount_codes`, read at send time. The copy cannot say 20% while
  the code gives 15%.
- **Unknown means wait:** if the order tables can't be read, no email goes out
  that run, so a discount is never sent to somebody who may have just bought.
- **Logged to the customer history:** every send is also written to
  `customer_emails` (template `welcome_1`…`welcome_5`). It shows on the customer
  page and in the customer desk's "Nudged" column.
- **Email 5's countdown** is a per-recipient deadline (`final_offer_hours`
  after it's sent, default 24). It shows as boxes plus "Offer ends Wed, Oct 21
  at 10:00 AM EDT". It is a nudge only: `VYTA20` itself keeps working until it
  expires in Discount Codes.
- **Opens are approximate** (Apple Mail preloads images). Clicks and purchases
  are the firm numbers.

## Images

The images are placeholders in `public/images/email/welcome/`, labelled with
the shot they stand in for and their size. Swap them by uploading in the
editor, or by replacing the files with the same names.

## Tests

```
npx tsx --test lib/welcome-flow/welcome-flow.test.ts
```

Covers time zones by province/state, the local send window (including
Newfoundland's half-hour zone), step order and retries, the minimum gap, merge tags,
the code-dependent copy check, escaping and link safety, the countdown, input
validation, and the signed links.
