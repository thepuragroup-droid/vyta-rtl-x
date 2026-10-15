# 2026-10-15 — Email flows: welcome series + cart abandonment

## Summary

Two automated 5-email sequences, sent from our own SMTP server and run from one
dashboard: **Admin → Marketing → Email Flows**. A switcher at the top picks the
flow. Each flow has its own Overview, people list, Emails editor and Settings.

### Welcome flow — new subscribers → first purchase

| # | Email | When | Code |
|---|---|---|---|
| 1 | Welcome | Immediately after signup | `WELCOME10` |
| 2 | Education | Day 2, if no purchase | — |
| 3 | Trust | Day 4, if no purchase | — |
| 4 | Offer — "20% OFF your order today" | Day 6, if no purchase | `VYTA20` |
| 5 | Reminder + 24h countdown | Day 9, if no purchase | `VYTA20` |

**Who enters:** new customer accounts that ticked the marketing-consent box,
created after the flow was switched on.

### Cart abandonment — left carts → completed orders

| # | Email | When | Code |
|---|---|---|---|
| 1 | Reminder — "Still thinking about it?" + the cart | 1 hour after the cart was left | — |
| 2 | Educate — testing, COAs, sourcing + the cart | 24 hours, if no purchase | — |
| 3 | Offer — "20% OFF, your cart is waiting", valid 48h | 48 hours, if no purchase | `VYTA20` |
| 4 | Address objections — FAQ topics, real support + the cart | 72 hours, if no purchase | — |
| 5 | Last chance — red banner, 24h countdown + the cart | 5 days, if no purchase | — |

**What counts as abandoned:** a cart left unchanged for step 1's delay (1 hour)
with no order since. It can come from either of two places:

- **A saved storefront cart.** The cart is now mirrored server-side (see
  below). The email comes from the account, or from the address the visitor
  typed at checkout.
- **An unpaid Stealth Health checkout** (`payment_pending`, `expired` or
  `cancelled`). A checkout an admin already chased by hand from the Abandoned
  tab is left to that conversation.

**Who may receive it:** anyone who ticked the marketing box (*express*
consent), plus anyone who started a checkout in the last 6 months (*implied*
consent: a CASL inquiry). Each entry records which basis applied.

**How often:** once per person per 30 days (Settings → Re-entry).

**"Return to cart":** every cart email links to `/cart?restore=<token>`, which
puts the exact cart back on any device, at today's prices and stock. Items no
longer sold are left out and the shopper is told. "Complete my order"
(`{{checkout_url}}`) restores the cart and goes straight to checkout with the
email's code filled in.

**If they come back:** a shopper who changes their cart before Email 1 isn't
abandoned yet, so the clock restarts from their last change. A shopper who
empties it leaves the flow.

### Rules both flows share

- **Stops on purchase:** a paid order on either checkout, matched by account
  *and* by email. The purchase is credited to the last flow email sent before
  it.
- **Cart takes priority:** while someone is in an active cart flow, their
  welcome emails **pause**, and they pick up again afterwards if the person
  still hasn't bought. The people list shows "Paused".
- **One gap across flows:** never two flow emails closer than the minimum gap
  (welcome 20h, cart 12h), counted from the last email of *any* flow.
- **Local time:** emails 2–5 wait for 9–11 AM in the recipient's time zone
  (from the province/state on the account, else a fallback zone). The first
  email of each flow is never held for the window.
- **Tagged:** "Welcome Flow" / "Cart Abandonment" on every entry, and as a
  Klaviyo profile property when Klaviyo is connected.
- **Unsubscribe:** a link in every email plus one-click `List-Unsubscribe`
  headers. Unsubscribing stops every flow, suppresses the address for good
  (guests included) and clears `contact_consent` on the account. An admin
  cannot resume someone who unsubscribed.
- **Codes are the source of truth:** `{{discount}}` prints the code's real
  value from Discount Codes at send time. An email whose code is missing, off
  or expired is **held**, with a warning on the page, rather than sent with a
  code checkout would refuse.

## Setup

1. Run **`email-flows-migration.sql`** in the Supabase SQL editor. If the
   first-draft `welcome-flow-migration.sql` was ever run, its data is carried
   over, and the old `welcome_flow_*` tables can be dropped afterwards.
2. Run **`supabase-cron-email-flows.sql`**. It runs `/api/cron/email-flows`
   every 15 minutes, reusing the `app_base_url` / `cron_secret` Vault secrets.
3. Optional: set `EMAIL_FLOWS_SECRET` (signs the unsubscribe/tracking links).
   It falls back to `CRON_SECRET`.
4. In **Discount Codes**, create `WELCOME10` (10%, first order only). `VYTA20`
   already exists.
5. In **Email Flows → Settings**, add the mailing address for the footer
   (CASL). It is shared by both flows.
6. Send yourself a test of every email, then **Switch on** each flow.
7. Turn off any Klaviyo welcome or abandoned-checkout flow, or both will send.

**Testing the cart flow on yourself:** sign in on the storefront and add
something to the cart. Then in Email Flows → Cart Abandonment → Abandoned
carts, click **Add** and enter your email. Your cart enters the flow and Email
1 goes straight away.

## The dashboard

- **Overview:** carts / enrolled, in flow, recovered / purchased (with rate),
  revenue, completed, unsubscribed. The flow is drawn as five steps, each
  showing sent / opened / clicked / purchases, plus the flow's rules as
  currently configured.
- **Subscribers / Abandoned carts:** everyone in the flow, filterable and
  searchable. A five-dot strip shows each email as sent, opened, clicked,
  failed or skipped. Expanding a row shows:
  - the full timeline, with times in the person's own zone;
  - the consent basis and source (signup, saved cart, unpaid checkout, admin);
  - for carts, what's in the cart and their restore link.

  From there you can remove someone, resume them, or fix their time zone.
- **Emails:** day/hour, subject, preview text, code, offer deadline, "show
  their cart" with its heading and text, copy, badges, buttons and images
  (with upload). There is a live preview: the real renderer, a sample cart from
  the catalogue, and the code's real value. You can send a test, or reset an
  email to the original design copy.
- **Settings:** send window, fallback zone, minimum gap, re-entry (cart), and
  the shared footer.
- **Run now** does exactly what the cron does, for the selected flow.

Assistants can read everything. Only admins can change anything or send.

## How it works

| Piece | File |
|---|---|
| Vocabulary, flow definitions, validation (isomorphic) | `lib/email-flows/types.ts` |
| Default settings and copy for both flows | `lib/email-flows/defaults.ts` |
| Time zones, send window, "which email next" (pure) | `lib/email-flows/schedule.ts` |
| The ten layouts, merge tags, the cart block, plain text (pure) | `lib/email-flows/render.ts` |
| Cart lines: sanitising, naming from `products`, restoring (pure) | `lib/email-flows/carts.ts` |
| Signed unsubscribe / open / click links | `lib/email-flows/tokens.ts` |
| Enrolment, purchase checks, holds, sending | `lib/email-flows/engine.ts` |
| Funnel and people table | `lib/email-flows/stats.ts` |
| Cart mirror and restore | `app/api/cart/sync`, `app/api/cart/restore`, `contexts/CartContext.tsx`, `components/CartRestorer.tsx` |
| Signup hook: welcome Email 1 after the response | `app/api/customer/register-alert/route.ts` |
| Cron (cart first, then welcome) | `app/api/cron/email-flows/route.ts` |
| Public: open pixel, click redirect, unsubscribe | `app/api/email-flows/*` |
| Admin API | `app/api/admin/email-flows/[flow]/*` |
| Admin page | `app/(admin)/admin/email-flows/page.tsx`, `components/admin/email-flows/*` |

### The saved cart

`CartContext` posts the cart's lines (`{ productId, packSize, quantity }` only)
to `/api/cart/sync`, debounced, whenever they change.

- **Who it belongs to:** a signed-in customer's cart is stored against the
  account. A guest's is stored against the visitor cookie, and only if they
  accepted the cookie banner (the same rule as the rest of the storefront
  tracking). Their email is attached later through `visitor_attribution`, when
  they type it at checkout or sign in.
- **The abandonment clock** (`updated_at`) moves only when the contents
  change, so re-syncing the same cart on a page load doesn't reset it.
- **Nothing in a cart email is taken from the browser.** Names, images and
  pack labels are read from `products`. Emails show no prices: checkout
  reprices every order, so a figure in the email could disagree with the page
  it links to.

### Safety

- **At-most-once sends:** an `email_flow_sends` row (unique per entry + step)
  is claimed *before* the SMTP call, so overlapping runs never double-send.
  Failures are retried up to 3 times.
- **One live entry per person per flow,** enforced by a unique index. That is
  also what stops two runs enrolling the same cart twice.
- **Unknown means wait:** if the order tables can't be read, no email goes out
  that run.
- **Logged to the customer history:** every send is also written to
  `customer_emails` (template `welcome_1`…`cart_5`). It shows on the customer
  page and in the desk's "Nudged" column.
- **Opens are approximate** (Apple Mail preloads images). Clicks and purchases
  are the firm numbers.

## Images

The images are placeholders in `public/images/email/welcome/` and
`public/images/email/cart/`, each labelled with the shot it stands in for and
its size. Swap them by uploading in the editor, or by replacing the files.

## Tests

```
npx tsx --test lib/email-flows/email-flows.test.ts
```

There are 29 cases.

- **Scheduling:** time zones, the send window, step order and retries, the
  minimum gap.
- **Content:** merge tags (cart links refused in the welcome flow, deadlines
  required for `{{offer_ends}}`), escaping and link safety, the countdown.
- **Carts:** sanitising lines from the browser, today's price and stock on
  restore, dropped products, restore links that carry the code only for
  checkout.
- **Rendering:** every email of both flows, with its cart and restore link.
- **Validation and links:** input validation and the signed links.
