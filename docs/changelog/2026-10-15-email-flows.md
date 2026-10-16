# 2026-10-15 — Email flows: welcome series + cart abandonment

## Summary

Two automated 5-email sequences, sent from our own SMTP server and run from one
dashboard: **Admin → Marketing → Email Flows**. A switcher at the top picks the
flow. Each flow has its own Overview, people list, Emails editor and Settings.

### Welcome flow — new subscribers → first purchase

| # | Email | When | Discount code |
|---|---|---|---|
| 1 | Welcome | Immediately after signup | **required** — you choose |
| 2 | Education | Day 2, if no purchase | — |
| 3 | Trust | Day 4, if no purchase | — |
| 4 | Offer — "{{discount}} OFF your order today" | Day 6, if no purchase | **required** — you choose |
| 5 | Reminder + 24h countdown | Day 9, if no purchase | **required** — you choose |

**Who enters:** new customer accounts that ticked the marketing-consent box,
created after the flow was switched on.

### Cart abandonment — left carts → completed orders

| # | Email | When | Discount code |
|---|---|---|---|
| 1 | Reminder — "Still thinking about it?" + the cart | 1 hour after the cart was left | — |
| 2 | Educate — testing, COAs, sourcing + the cart | 24 hours, if no purchase | — |
| 3 | Offer — "{{discount}} OFF, your cart is waiting", valid 48h | 48 hours, if no purchase | **required** — you choose |
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
- **No code is ever assumed.** Offer emails (welcome 1, 4, 5; cart 3) ship
  with no code: you pick each one from Discount Codes in the Emails tab, using
  a dropdown of your real codes, never free text. Until you do:
  - the email can't be saved or test-sent while it's switched on;
  - its flow can't be switched on;
  - the email is held, never sent with an empty offer.

  Switch an offer email off if you don't want a discount in it.
- **Codes are the source of truth:** `{{discount}}` prints the chosen code's
  real value from Discount Codes at send time. An email whose code is switched
  off, expired or used up is **held**, with a warning on the page, rather than
  sent with a code checkout would refuse.

## Setup

1. Run **`email-flows-migration.sql`** in the Supabase SQL editor. If the
   first-draft `welcome-flow-migration.sql` was ever run, its data is carried
   over, and the old `welcome_flow_*` tables can be dropped afterwards.
2. Run **`supabase-cron-email-flows.sql`**. It runs `/api/cron/email-flows`
   every 15 minutes, reusing the `app_base_url` / `cron_secret` Vault secrets.
3. Optional: set `EMAIL_FLOWS_SECRET` (signs the unsubscribe/tracking links).
   It falls back to `CRON_SECRET`.
4. In **Discount Codes**, create the codes you want to offer. Then, in **Email
   Flows → Emails**, choose one for each offer email (welcome 1, 4, 5; cart 3).
   Neither flow can be switched on until you do.
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

## Brand header and icons

- **Header:** the horizontal lockup from the designs (the V mark beside the
  VYTA BIOSCIENCES wordmark, `public/images/email/vyta-lockup.png`), with a
  **View in browser** link. That link opens the email exactly as sent, from a
  stored copy (`email_flow_sends.body_html`, served by
  `/api/email-flows/view`, signed per send).
- **Welcome email 1:** "Welcome to" is set over the hero photo with **VYTA**
  in the white wordmark, as designed. An edited title that doesn't end in
  "VYTA" is set as plain text. Outlook for Windows doesn't show background
  photos; it shows the navy fallback, which the white title still reads
  against.
- **Icons:** every badge and benefit line carries its own icon, matching the
  designs (shield, maple leaf, truck, flask, COA document, snowflake, leaf,
  heart, sun, sprout, question mark, credit card…). List items sit in
  outlined circles with no fill, so a photo behind them shows through. Icons are 96px PNGs in `public/images/email/icons/`, navy for light
  grounds and white for the dark band, because Gmail and Outlook don't render
  SVG. In the editor each badge is a row: pick its icon, type its label. A new
  badge's icon is suggested from its wording.

## Images

**Supplied photography** is in `public/images/email/photos/`. Each photo is
cropped to the proportions the designs use, so no email shows a tall,
stretched cover:

| Photo | Shape (h ÷ w) | Used in |
|---|---|---|
| `woman-lake-dark` (woman by the lake, left side darkened) | 0.80 | Welcome 1 hero, white title low on the left |
| `offer-card` (pale mountains, vials at the right) | 0.39 | Welcome 1 offer panel, copy over the left |
| `woman-portrait` (the supplied woman-in-the-sun photo, whole, on the right) | 1.30 | Welcome 2 hero: headline, line and benefits down the left, button centred at the foot |
| `quality-vials` (two vials on the right, pale haze at the upper left) | 0.84 | Welcome 3 hero, headline and line at the upper left |
| `man-lake-sky` (man by the lake, pale daylight sky above) | 1.50 | Welcome 5 hero, question, countdown and button over the sky |
| `man-lake` (man by the lake) | 1.35 | Cart 1 hero, headline over the sky |
| `man-lake-vial` (vial on leaves) | 0.55 | Cart 1 image above the button |
| `woman-lake` (woman by the lake) | 1.31 | Cart 2 hero, headline over the sky |
| `dropper` (dropper over a vial) | 1.06 | Cart 4, under the headline |
| `dropper-card` (the drop, closer in) | 0.85 | Welcome 3 "Research. Quality." card |
| `offer-cover` (the three vials darkened, navy fading down into them) | 1.25 | Welcome 4 cover, the offer set over its navy top |
| `three-vials` (vials on rock, mountains) | 0.75 | Cart 3, under the offer |
| `lab-vial` (vial in a gloved hand) | 0.94 | Welcome 2 "We Show Our Work" card; Cart 5, under the countdown |
| `support-agent` (agent with headset) | 0.90 | Cart 4 "Real People" card |

The welcome crops come from the full-height supplied covers, except
Welcome 2's, which is a photo supplied later.

- **Welcome 1** (`woman-lake-dark`): the side the white title sits on is
  darkened.
- **Welcome 2** (`woman-portrait`): the supplied photo of the woman in the
  sun, shown top to bottom. It is scaled to the cover's height, so it sits
  narrower on the right, and its own sky is stretched into a soft haze on
  the left behind the copy. It fades to white at its foot, into the email
  below, and is saved 1200 wide for sharp screens. On desktop the type is
  large: 46px headline, 21px line, a larger button, and the benefits in a
  short 200px label column beside 70px outlined icon rings. On phones the
  headline and line use the full width of the photo with slimmer side
  margins, and the benefits keep a short 150px column beside 48px rings.
- **Welcome 3** (`quality-vials`): built the same way. The vials photo, with
  its own mountains, is scaled to the cover's height on the right, and its
  edge is drawn into a pale haze on the left and across the top. On desktop
  the type is large: 48px headline, 20px line, 17px body, a wide button, and
  a larger panel with a 28px title. Phones set it back to a 32px headline,
  with the line broken after "Testing.".
- **Welcome 4** (`offer-cover`): one dark cover, as designed. The three
  vials photo is darkened, with navy fading down into it, and the offer
  (eyebrow, 76px "20% OFF", "Your Order Today", the line, and the code in a
  teal-outlined box) sits over the navy top. On phones the type steps down
  and the cover grows taller, so the photo stays whole below the code. Cart 3
  shares the layout but keeps its own look: offer on navy, photo below.
- **Welcome 5** (`man-lake-sky`): the sunset is toned to daylight and the
  sky paled at the top, as designed. Over it sit the question, the line,
  the countdown, the wide Claim button and the code. Desktop type is large:
  42px headline, 18px line, and countdown boxes with 36px numbers. On
  phones the type steps down and the cover grows taller, with the photo
  pinned whole at its foot and the pale sky running taller above it.

Where the designs set the text over the photo (Welcome 1, 2, 3 and 5,
Cart 1, Cart 2), it sits over the sky or the clear side of the photo. On
phones, where the photo is narrower and the copy runs over the subject, the
photo behind Welcome 1, 2 and 5's copy is washed by a media query: navy
behind white text, white behind navy text. The Welcome 1 offer panel gets a
pale wash and a smaller title.
Desktop is unchanged. Welcome 4 and the rest of the cart flow put the
headline, countdown or offer above the photo, as in the designs. The
welcome series has no placeholder art left.

**Welcome 1** follows the design: "Welcome to VYTA" in white, low on the
left of the photo, a wide Shop Now button, and the offer as a picture
panel with the copy over it and the code in bold. The design's photo (a
woman with her arms raised on a rock) wasn't among the supplied images.
The woman-by-the-lake shot stands in until it is uploaded in the editor.

**Saved emails pick up the new images.** The first visit to the admin saved
each email's defaults, so saved welcome emails still name the old images.
When an email is loaded, a welcome image that was a past default is swapped
for today's (with its shape and overlay setting). An image an admin uploaded
is never swapped. The old files stay in `public/` so emails already sent
still show their pictures.

**How the overlay works** (per email in the editor: *Set the headline over
this image* and *Text: dark / white*):

- The photo is the cell's background, sized to the image's own shape. The
  ratio is read when an image is uploaded.
- Classic Outlook gets the same photo through VML.
- On phones a media query scales the height with the width, so the photo
  isn't cropped.
- If an email client shows no background images at all, the text sits on a
  solid colour.

The lake photos were supplied about 330px wide and are scaled up to fill the
600px email, so they look slightly soft on high-resolution screens. Uploading
versions at least 1200px wide in the editor will sharpen them. The vials,
dropper and support photos are 1200px (480px for the card).

**Still placeholders** (in `public/images/email/welcome/` and
`public/images/email/cart/`): the Welcome 1 hero and card, the Welcome 2 and
Cart 2 "We Show Our Work" cards, and the Welcome 3 card.

## Test sends

**Admin → Email Flows → Test send** sends any of the ten emails to one or
more addresses. Only the addresses need filling in. Everything else starts
at a default:

| Detail | Default |
|---|---|
| Emails | The current flow's five. Any mix of both flows can be ticked. |
| First name | Alex |
| Discount code | Each email's own. A code chosen here replaces it on every email that offers one. |
| Time zone | The flow's default. It sets the countdown's "Ends …" time. |
| Sample cart | The first two catalogue products. Products, packs and quantities can be edited. |
| Subject tag | `Test`, so subjects read `[Test · Cart 3] …`. Clear it to see the subject exactly as customers do. |

How a test send works:

- Each address gets its own copy. One request takes up to 10 addresses and
  10 emails.
- Emails are rendered from their **saved** settings, so save edits in the
  Emails tab first. The *Send a test* box there still sends an unsaved draft
  to one address.
- Nothing is enrolled or tracked.
- The cart buttons open the store's cart page. They don't restore the sample
  cart.
- An email the live flow would hold is skipped, and the results say why. That
  happens when it has no code, or its code is off, expired or used up.
- Sending is admin only. Each run is written to the audit log.

The same thing from the command line, reading `.env.local` (Supabase
service key and SMTP settings):

```
npx tsx scripts/email-flows-test-send.ts --to a@x.com,b@y.com
npx tsx scripts/email-flows-test-send.ts --to qa@x.com --emails cart:3,welcome --name Sam --code VYTA20 --tz America/Vancouver
npx tsx scripts/email-flows-test-send.ts --emails cart --out ./email-tests    # write HTML files, send nothing
```

Other options are `--cart productId:pack:qty,…`, `--tag ""` and `--site`.
The full list is at the top of the script.

## Tests

```
npx tsx --test lib/email-flows/email-flows.test.ts
```

There are 50 cases.

- **Scheduling:** time zones, the send window, step order and retries, the
  minimum gap.
- **Content:** merge tags (cart links refused in the welcome flow, deadlines
  required for `{{offer_ends}}`), escaping and link safety, the countdown.
- **Codes:** none pre-filled; offer emails refuse to save without one (unless
  switched off), while the preview still renders the draft.
- **Carts:** sanitising lines from the browser, today's price and stock on
  restore, dropped products, restore links that carry the code only for
  checkout.
- **Rendering:** every email of both flows, with its cart and restore link.
- **Validation and links:** input validation and the signed links.
