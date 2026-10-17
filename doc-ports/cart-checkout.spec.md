# Cart + Checkout + Payments + Admin — Port Spec (single file)

> One self-contained spec for porting VYTA's cart, hosted Stealth Health ("Puramass") checkout,
> payment lifecycle and every admin control that configures or runs them to the sibling site
> (Aminocan). Hand this whole file to a coding agent. Read **Part 0** first; it gives the
> architecture, the pitfalls, the security fixes, the decisions to make, the phased build order and the QA plan.
> Parts 1–6 are the detailed reference, and Part 0 cites them as "01"–"06".
> Source: `thepuragroup-droid/vyta-rtl-x`, `main` at `817e7cf`. Everything was read from code; unconfirmed
> items are listed at the end of each part.

## Contents

- [Part 0 — Port guide (start here)](#part-0--port-guide-start-here)
- [Part 1 — Cart](#part-1--cart)
- [Part 2 — Checkout UI and post-payment pages](#part-2--checkout-ui-and-post-payment-pages)
- [Part 3 — Checkout server, pricing engine and payment partner API](#part-3--checkout-server-pricing-engine-and-payment-partner-api)
- [Part 4 — Payment lifecycle](#part-4--payment-lifecycle)
- [Part 5 — Admin controls](#part-5--admin-controls)
- [Part 6 — Database schema and migrations](#part-6--database-schema-and-migrations)

---

## Part 0 — Port guide (start here)

> Full guide for building VYTA's cart, hosted checkout, payment lifecycle and every admin control that
> configures or runs them on the sibling site (Aminocan). Everything here was read from the code in
> this repo (`vyta-rtl-x`, `main` at `817e7cf`). Anything that could not be confirmed from code is in
> each section's "unverified" list.
>
> **Supersedes** `doc-ports/orders-payment-cluster.spec.md` for the cart and checkout. That spec
> describes the old e-mail/crypto `orders` flow; the live checkout is the hosted Stealth Health
> ("Puramass") flow below.
>
> Stack: Next.js 15 App Router · React 19 · Supabase (service-role server clients, anon browser client)
> · Tailwind 3.4 · framer-motion 12 · lucide-react · Easyship (live rates and labels) · Klaviyo · SMTP
> (nodemailer).

### How to use this guide

| Part | Covers | Read it when you build |
|---|---|---|
| **Part 0** (this part) | Architecture, pitfalls, port order, security fixes, decisions to make, QA plan, file inventory | Before anything else |
| [Part 1](#part-1--cart) | `CartContext`, `/cart` page, upsell blocks (Frequently Bought Together, You May Also Like), limited-time offer, free-shipping bar and toast, ad-discount notice, nav cart icon, promos context, recommendation ranking | The cart |
| [Part 2](#part-2--checkout-ui-and-post-payment-pages) | `/checkout` client (form, validation, address autocomplete, rates picker, discount/referral fields, add-ons, summary, submit and redirect), `/order/success`, `/order/track`, `/shipping-address/[token]` | The checkout screen and the customer pages after payment |
| [Part 3](#part-3--checkout-server-pricing-engine-and-payment-partner-api) | `POST /api/checkout/puramass` and every supporting route, the pricing engine (with a worked example run through the real functions), the partner API client, the ledger/invoice rows written, env vars | The order API and pricing |
| [Part 4](#part-4--payment-lifecycle) | Status state machine, webhook / poll cron / admin sync / refresh paths, stock decrement, confirmation and admin emails, Klaviyo, affiliate commission, Easyship hand-off, settlement, abandoned-checkout recovery, missing-address flow | Everything after the buyer pays |
| [Part 5](#part-5--admin-controls) | Every admin screen and control: Settings, Promotions, Cart Upsells, Discount Codes, Landing Pages (offer parts), Stealth Health → Orders (plus dialogs), SKU sync/cleanup, confirmation/paid-alert email cards, dashboard widgets, roles, admin API routes | The admin side |
| [Part 6](#part-6--database-schema-and-migrations) | Every table, column, function, trigger, policy and cron involved; jsonb shapes; **migration order and the gap against the sibling's live schema** | The database (do this first) |

Each section has the same structure: components/routes → rules → UI/UX (Tailwind classes plus resolved
hex/px values) → config inputs → unverified/porting notes. Design tokens match those in
`doc-ports/product-detail-page.spec.md` §4.1 (ink `#07203A`, ink-muted `#56707F`, surface `#F7FAFB`,
line `#DCE7EB`, teal `#438B9E`, teal-dark `#1B5D83`, `rounded-xl` = 14px, `rounded-2xl` = 18px).

---

### 1. Architecture at a glance

**Vocabulary:** *Stealth Health*, *PuraMass* and *Puramass* name the same payment partner. Code
identifiers say `puramass`; admin UI and copy say "Stealth Health". The hosted checkout is the
**only** live checkout. The legacy `POST /api/orders` returns **410**.

```
 Browser                                   Our server (Next.js, service-role Supabase)          Partner (api.stealth.health)
 ───────                                   ─────────────────────────────────────────────         ────────────────────────────
 PDP / modal ──addItem──▶ CartContext (localStorage `northern_peptides_cart`)
      │                         │
      ▼                         ▼
   /cart  ── upsells: GET /api/products/recommendations
      │   ── promos:  GET /api/admin/settings · /api/promos/first-order · /api/promos/landing
      ▼
 /checkout ── POST /api/checkout/puramass/rates (Easyship live rates or flat fee)
      │     ── POST /api/checkout/discount-code (preview) · POST /api/checkout/referral-code (check)
      │     ── GET  /api/shipping/address-autocomplete (Canada only)
      │
      └─ POST /api/checkout/puramass ──▶ 1 re-price every line from the DB (overrides → pricelist → base → pack rule)
         {items:[{id,packSize,quantity=VIALS}],   2 map lines to partner SKUs (vial SKU / case SKU)
          customer, shipping?, discountCode?,     3 choose discounts on the server (code ⟂ ad-discount, × cart offer)
          referralCode?, declineLandingOffer?}    4 re-quote shipping on the server
                                                  5 POST /partner/store/orders ───────────────────────▶ creates hosted order
                                                  6 INSERT puramass_orders (ledger)          ◀─────────── {transaction_id, payment_link, status}
                                                    + invoices(pending_payment) + invoice_line_items
                                                  7 after(): Klaviyo "Started Checkout"
      ◀──────── { payment_link } ─────────────────┘
 window.location = payment_link ─────────────────────────────────────────────────────────────────▶ buyer pays on partner domain
                                                                                                    (return URL: set on partner side — unverified)
                                   POST /api/webhooks/stealth-health (HMAC) ◀───────────────────── store_order.payment_complete
                                   GET  /api/cron/puramass-poll (pg_cron, every 2 min) ───────────▶ GET /partner/store/orders/{id}
                                   admin Sync / Refresh (Stealth Health → Orders) ────────────────▶ (same)
                                                  │
                                                  ▼
                                   materializeStealthHealthFulfillment()  — every paid path ends here (idempotent)
                                     ├─ invoice pending_payment|expired → paid (`firstPaid` gate)
                                     ├─ take stock (RPC, `stock_adjusted` claim)
                                     ├─ Klaviyo "Placed Order" + "Ordered Product" (first pass only)
                                     ├─ affiliate commission (unique per invoice) + affiliate email
                                     ├─ Easyship draft shipment (no-op once it exists)
                                     ├─ buyer confirmation email (claim: confirmation_email_sent_at)
                                     └─ admin "order paid" email (claim: admin_paid_alert_sent_at)
```

**Key facts that shape the port:**

- **The browser never sends prices.** The server re-prices everything; the client totals are a
  preview that mirrors the server rules.
- **No `orders` / `order_items` rows are written by the hosted checkout.** The order is a
  `puramass_orders` ledger row plus an `invoices` row (`source = 'stealth_health'`) with
  `invoice_line_items`. Warehouse, fulfillment, settlement and commissions hang off the invoice.
- **Nothing irreversible happens at hand-off.** Stock, commission, emails and shipment happen
  only when payment is confirmed. A discount code's usage counts only `paid` ledger rows.
- **Discounts reach the partner as lowered `unit_price_cents`.** The partner API has no discount
  field, and a `0` price means "use the partner's own catalog price", so a discount that would zero
  any line is dropped entirely (03 §9).

---

### 2. Pitfalls up front (read before you write code)

1. **`quantity` in the checkout payload is total VIALS, not packs.** The client sends
   `it.quantity * it.packSize`; the server derives packs with `round(vials / packSize)` and clamps
   each merged line to 1–99 packs. (02 flow step 11, 03 §1)
2. **Cart line key is `${productId}::p${packSize}`.** A 1-pack, 3-pack and 10-pack of the same
   product are separate lines, each with its own stock cap `floor(stock_vials / packSize)` taken
   **at add time** and never refreshed. (01 business rules)
3. **Discount stacking (authoritative, 03 §8):**
   - a typed **or** landing-page discount code and the paid-ads welcome discount are **mutually
     exclusive**: the one with the larger effective share of the whole order wins, and a tie goes to
     the code;
   - the **limited-time cart offer stacks multiplicatively** on whichever won (25% then 10% =
     32.5%), capped at 99%;
   - a typed code **replaces** the landing default;
   - **referral codes take nothing off**; they only attribute commission.
4. **Free shipping is measured on the pre-discount subtotal**, and it only exists when live rates
   are on. With the flat fee, free shipping is impossible server-side. (03 §10)
5. **Flat fallback mismatch:** when live rates are on but the buyer ends up on the `'flat'` courier
   id, `lib/payments/puramass-shipping.ts:176` returns `flatHostedRate()` with **no argument**,
   which charges the hard-coded `DEFAULT_FLAT_SHIPPING = 35`, not the configured
   `puramass_flat_shipping`. (Verified in code.)
6. **Stock is not checked at checkout** and inactive products are not rejected; only a missing
   partner SKU (409) or a zero price (500) stops a line. Overselling is possible. (03 porting notes)
7. **If the ledger insert fails, the buyer is still redirected to pay.** The payment then arrives for
   an unknown `transaction_id` and is acknowledged as `unmatched`. Make the insert fatal, or insert
   before calling the partner. (03 porting note 3)
8. **The webhook and admin refresh have no terminal-status guard.** A late event can move a `paid`
   row backwards; only the poll/sync path treats `paid/expired/cancelled` as terminal. Make `paid`
   sticky in the port. (04)
9. **Orders expire at `created_at + 7d + 6h`** (poll sweep). A payment after that is only picked up
   by the webhook or a manual refresh. (04)
10. **Where the buyer lands after paying is not in this repo.** No return/cancel URL is sent to the
    partner, so it is configured on the partner side. The cart is cleared only when the buyer opens
    `/order/track?order=…`, and `/order/track` reads only the legacy `orders` table, so it **cannot
    find hosted orders**. Decide the post-payment page for the sibling. (02, 04)
11. **Guest checkout is enforced only in the UI**; `/api/checkout/puramass` does not check it. (02)
12. **`addItem` computes its boolean inside the `setItems` updater.** When it is called several
    times in one event (PDP quantity loop, "add selected" in Frequently Bought Together), later calls may
    report `false`, which can cause false "out of stock" toasts. Compute `added` from a ref of the
    current items. (01)
13. **`view_cart` never fires**: it is tied to a drawer flag nothing sets. Fire it on `/cart` mount
    instead. (01)
14. **`site_settings` is read with `select('*')` and shaped defensively.** Many columns are optional, and
    every optional-column write has a "strip and retry" fallback. On a fresh, fully migrated schema
    these ladders can go, but **a payment-status write must never fail because of an optional column**. (04)
15. **Back-stamp `confirmation_email_sent_at` / `admin_paid_alert_sent_at` on historical paid rows
    before enabling the automatic sends**, or old orders get emailed on the next poll pass. (04)

---

### 3. Security issues: fix these, don't copy them

| # | Issue | Where | Fix in the port |
|---|---|---|---|
| S1 | **"Service role" policies are written without `TO service_role`**: `FOR ALL USING (true) WITH CHECK (true)`. With Supabase's default table grants that gives the public anon key full read **and write** on every table below: customer names, emails, phones and addresses, payment links, invoices, and `site_settings`, which stores `klaviyo_private_api_key` and `easyship_api_key`. Nothing later in the repo SQL tightens these (the live VYTA DB was not checked). | `"Service role full access"`: `puramass_orders` (`puramass-hosted-checkout-migration.sql:79`), `puramass_address_requests` (`puramass-missing-address-migration.sql:86`), `site_settings` (`migration-site-settings.sql:51`), `orders` (`migration-orders*.sql`), `stealth_health_invoices` (`stealth-health-settlement-migration.sql:157`). `service_role_all` (dynamic SQL, `ecommerce-backend-migration.sql:228-240`): `invoices`, `invoice_line_items`, `payments`, `suppliers`, `product_variants`, `inventory_log` | Drop these policies (the service role bypasses RLS) or recreate them `TO service_role`. Add narrow read policies only where the browser really reads (it doesn't for any of these). **Check the VYTA production DB too.** |
| S7 | Stock RPCs `adjust_stock_for_invoice`, `restore_stock_for_invoice`, `adjust_stock_for_order` and the order restore have **no `REVOKE EXECUTE … FROM PUBLIC`**, so anyone with the anon key can call them through `/rest/v1/rpc`. Only `set_product_stock` and `take_stock_for_invoice_lines` are locked to `service_role` (`stock-ledger-migration.sql:426-431`). | `stock-ledger-migration.sql`, `case-vial-stock-decrement-migration.sql` | `REVOKE EXECUTE ON FUNCTION … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role;` for each. |
| S2 | `GET /api/admin/settings` has **no auth**. API keys are masked (`easyship_api_key_set: boolean`), but it returns admin email lists (`admin_emails`, `invoice_cc_emails`) and the email templates to anyone. The storefront depends on it for public flags. | `app/api/admin/settings/route.ts:185` | Split it: a public `/api/storefront-settings` returning only storefront flags, and an authenticated admin GET. |
| S3 | The rates endpoint returns internal settings and a debug string to the browser; `TEMP DEBUG` `console.error`s remain in the client rate effect. | `app/api/checkout/puramass/rates/route.ts`, `PuramassCheckoutContent.tsx` | Return only `{live, rates, note}`. |
| S4 | The rate limiter is in memory per instance (checkout, shipping-address token route), so it is weak on serverless. | `lib/rate-limit.ts` | Use a shared store (Upstash/Redis or a Postgres table) if abuse matters. |
| S5 | Attribution writes at checkout skip the consent gate (`isTrackingAllowed`). | `/api/checkout/puramass` side-effects 3–4 | Gate on consent if the sibling's banner requires it. |
| S6 | `getSupabase()` silently falls back to the **anon** key if `SUPABASE_SERVICE_ROLE_KEY` is unset. | `lib/supabase.ts:23` | Throw on a missing service key in server code. |

---

### 4. Decisions to make before porting

| # | Decision | Default recommendation |
|---|---|---|
| D1 | Payment partner: reuse the Stealth Health partner account (new `PURAMASS_PARTNER_ID` / key, new SKU namespace), or swap the processor? | Reuse. The guide is written for it. If you swap, `03` "Puramass payment integration" and `04` "payment confirmation paths" are the parts to replace; keep the ledger + invoice model. |
| D2 | Post-payment landing page and cart clearing | Configure the partner return URL to a sibling page that reads the **ledger** (not `orders`) by `partner_reference`, and clear the cart there. |
| D3 | Shipping: live Easyship rates or a flat fee; Canada-only? | Copy the current behaviour, then fix pitfall 5. Shipping is Canada-only today (`SHIPPING_COUNTRIES`, autocomplete forces `CA`, courier whitelist UPS + Canada Post). |
| D4 | Currency | Everything is CAD with `$` + `toFixed(2)`. `usd_exchange_rate` has no admin control. Some recovery/settlement code defaults to `'USD'` when the currency is null (04 note 13); set it explicitly. |
| D5 | Dead or legacy admin controls: Checkout Type, Pickup Address, `/admin/orders` (legacy, hidden), `puramass_checkout_enabled` (hard-wired on) | Omit them (05 porting notes 1–2, 7). |
| D6 | Dashboard KPIs read the legacy `orders` table, so hosted sales don't show there | Point the KPIs at `puramass_orders` / `invoices` in the port. |
| D7 | Replicate or fix each pitfall in §2 | Fix 5, 7, 8, 10, 11, 12, 13. Replicating the others as-is is fine. |

---

### 5. Brand-specific hard-codes to replace

| Kind | Values (VYTA) | Found in |
|---|---|---|
| Origin / URLs | `SITE_URL = "https://www.vytabio.com"`; `app.vytabio.com` (partner portal); `support@vytabio.com`; WhatsApp `https://wa.me/15147013824` | `lib/config.ts`, Klaviyo URLs, `/order/track`, checkout header |
| Names / logo | "VYTA", "Secure Checkout", `/images/vyta-mark.png`; email From default `'VYTA <noreply@aminocan.com>'` | checkout header, `lib/email.ts` / `lib/smtp.ts` |
| IDs | partner reference prefix `amc_`; SKU namespace `vyta-`; invoice number `'VYTA-' \|\| nextval(...)`; track placeholder `AMC-XXXXXXXX` | `/api/checkout/puramass`, SKU sync, invoices |
| Tracking defaults | GTM `GTM-M2J3D7SG`, GA4 `G-F44F1BB1QV`, Klaviyo `SY9j8v` (fallbacks in `/api/site-config`) | `app/api/site-config/route.ts`, `lib/site-config.ts` |
| Storage keys / cookies | localStorage `northern_peptides_cart`, `aminocan:` column prefs; sessionStorage `aminocan.freeShippingToast`; cookies `aminocan_vid`, `aminocan_sid`, `aminocan_attr`, `aminocan_attr_last`, `aminocan_consent`, `ref_code`, `vyta_lp` | contexts, middleware, analytics |
| Copy | "Canada-wide", "Proudly Canadian", "Ships in 24h", "(CAD)", "99%+ Purity Guaranteed", "Third-Party Tested (COA Available)", "Add some research compounds before checking out.", BAC-water reconstitution copy and regex, "Single vial" / "Pack of N" | cart, checkout, emails |
| Placeholders | phone "(416) 555-0199"; CC "colleague@aminocan.com" | checkout, admin settings |
| Partner | Photon User-Agent `aminocan-cad/1.0 …` (address autocomplete) | `app/api/shipping/address-autocomplete/route.ts` |

---

### 6. Port order (phased checklist)

Each phase can be shipped and tested on its own. Section refs in brackets.

**Phase 0: prerequisites**
- [ ] Products + pricing already ported (`product-catalog-inventory-cluster.spec.md`,
      `pricing-cluster.spec.md`, `product-detail-page.spec.md`); `customers`, `affiliates`,
      `invoices`, `invoice_line_items` exist.
- [ ] Partner account for the sibling: partner id, API key, webhook secret; webhook URL registered;
      return URL decided (D2).

**Phase 1: database** [06]
- [ ] Apply the migrations in the order given in Part 6 "migration order", which closes the
      gap against `_live-schema-snapshot.sql`.
- [ ] Apply the S1 and S7 fixes as you go.
- [ ] Gaps on the sibling that break checkout outright (06 "Diff"):
  - without `products.vial_price` / `vials_per_box`, every checkout returns 500;
  - without `product_history`, every stock RPC fails (they all write to it);
  - without `invoice_line_items.price_type`, invoice lines are dropped by the column-stripping fallback;
  - `commissions.order_id` must become nullable for invoice-based commissions.
- [ ] Don't re-run `stock-decrement-migration.sql` after the later stock migrations; it recreates
      single-argument overloads.
- [ ] `ad-discount-promo-migration.sql` turns a 25% ad discount **on** as soon as it runs. Set
      `ad_discount_enabled = false` until you want it.
- [ ] Seed and backfill statements in this repo carry Aminocan/VYTA values (GTM id, vault URL,
      cookie names). Review each one before running it on the sibling.
- [ ] Install the pg_cron poll job (`supabase-cron-puramass-poll.sql`) with the sibling URL and secret
      (do this last, once the route exists).

**Phase 2: env + server libraries** [03, 04]
- [ ] Env vars: see `03` "env vars & secrets" and `04` "env vars".
- [ ] `lib/pricing.ts`, `lib/pricing/resolve.ts`, `lib/promos/*`, `lib/affiliate/discount-codes.ts`,
      `lib/shipping/regions.ts`, `lib/phone.ts`, `lib/rate-limit.ts`.
- [ ] `lib/payments/puramass*.ts` (client, settings, shipping, rates, catalog, columns, address,
      fulfillment, poll, webhook-log, abandoned, recovery, address-request/email, order-summary,
      settlement).
- [ ] Port the `*.test.ts` files beside them; they pin the rules (cart-offer, first-order, shipping,
      order-body, address, webhook-log, settlement).

**Phase 3: storefront APIs** [03]
- [ ] `/api/checkout/puramass` (+ `/rates`), `/api/checkout/discount-code`,
      `/api/checkout/referral-code`, `/api/promos/first-order`, `/api/promos/landing`,
      `/api/shipping/address-autocomplete`, `/api/products/recommendations`, public settings route (S2).

**Phase 4: cart** [01]
- [ ] `CartContext` (with the pitfall 12 fix), `PromosContext`, `/cart`, upsell blocks, limited-time
      offer, free-shipping bar and toast, ad-discount notice, nav badge with fly-to-cart target.

**Phase 5: checkout** [02]
- [ ] `/checkout` (`CheckoutRouter` + `PuramassCheckoutContent`), `AddressAutocomplete`, the rates
      picker, code fields, add-ons, summary, submit and redirect, analytics.

**Phase 6: payment lifecycle** [04]
- [ ] `/api/webhooks/stealth-health` (HMAC), `/api/cron/puramass-poll`,
      `materializeStealthHealthFulfillment`, stock RPCs, confirmation and admin emails, Klaviyo
      events, affiliate commission, Easyship draft shipment.
- [ ] `/shipping-address/[token]` page + API; the post-payment landing page (D2).

**Phase 7: admin** [05]
- [ ] Settings (storefront section toggles, Stealth Health checkout, shipping/Easyship, Klaviyo,
      emails), Promotions, Cart Upsells, Discount Codes, Landing Pages offer fields.
- [ ] Stealth Health → Orders (table, tabs, search, bulk actions, recover / bulk-recover /
      request-address / delete dialogs, sync / refresh), SKU sync and cleanup, confirmation and
      paid-alert email cards, `PuramassInvoiceBlocks`, dashboard widgets (D6).
- [ ] Role gating per `lib/permissions.ts`. Assistants may sync, refresh, send recovery emails and
      send address requests, but not delete or send confirmation emails.

---

### 7. QA plan (run on the sibling before go-live)

| # | Scenario | Expected |
|---|---|---|
| Q1 | Add a 1-pack and a 3-pack of the same product | Two cart lines; each capped at `floor(stock/size)`; nav badge counts units |
| Q2 | Quantity at cap, then `+` | Blocked; stock message per 01 |
| Q3 | Cart total crosses the free-shipping threshold (live rates on) | Progress bar → "free"; toast once per session; checkout shipping "Free" |
| Q4 | Cart offer: `min_items` reached, before `ends_at` | Offer strip shows; the server applies `combineDiscountPercents` |
| Q5 | Paid-ads visitor + typed 30% code on a 25% ad discount | The larger effective discount wins (03 worked example: code wins at 28.88% effective) |
| Q6 | Landing visitor removes the auto-applied code | `declineLandingOffer: true` sent; server does not re-apply it; "Re-apply your …" link shows |
| Q7 | Referral code only | No price change; commission credited to the referrer on payment |
| Q8 | Live rates: change postal code | Re-quote after 600 ms; at most 5 options (UPS / Canada Post); CTA disabled while quoting |
| Q9 | Rates call fails | Flat fee shown; if the server's quote is live, 409 → "Those shipping options have changed…" |
| Q10 | Product without a partner SKU | 409 with the unmapped list; the client's own message |
| Q11 | Successful hand-off | Ledger row `payment_pending` + invoice `pending_payment`; redirect to `payment_link`; Klaviyo "Started Checkout" |
| Q12 | Webhook `paid` (valid HMAC) | Invoice `paid`; stock taken once; one confirmation + one admin email; commission row; Easyship draft |
| Q13 | Same webhook redelivered | No duplicate stock, email or commission (`last_event_id`, `stock_adjusted`, claim columns, unique index) |
| Q14 | No webhook; poll cron runs | Same result as Q12 within about 2 min |
| Q15 | Unpaid for 7d+6h | Ledger `expired`, invoice `expired`; appears in the Abandoned tab |
| Q16 | Admin "Recover checkout" | Recovery email sent; `recovery_email_count` increments |
| Q17 | Paid order without an address → "Ask for the shipping address" | 30-day token link; submission writes the address with `shipping_address_source='customer'`; the partner can't overwrite it; **create the shipment manually** (04 note 6) |
| Q18 | Anon key: `select * from puramass_orders` | **Denied** (S1 fixed) |
| Q19 | Unauthenticated `GET` of the admin settings | No admin emails or templates returned (S2 fixed) |
| Q20 | Guest checkout off, signed-out `POST /api/checkout/puramass` | Rejected server-side (pitfall 11 fixed) |

---

### 8. Source inventory (files to read while porting)

**Storefront: cart.** `contexts/CartContext.tsx`, `contexts/PromosContext.tsx`,
`contexts/SiteConfigContext.tsx`, `contexts/ToastContext.tsx`, `contexts/CustomerContext.tsx`,
`contexts/PurchaseModalContext.tsx`, `app/cart/page.tsx`, `components/cart/{FrequentlyBoughtTogether,
YouMayAlsoLike,LimitedTimeOffer,recommendations}.tsx|ts` (`ReferralCodeField.tsx` is dead code),
`components/{FreeShippingProgress,FreeShippingToast,AdDiscountNotice,Navigation}.tsx`,
`lib/products/recommendations.ts`, `app/api/products/recommendations/route.ts`,
`lib/analytics/{cart,ecommerce,klaviyo-onsite,attribution,attribution-client}.ts`,
`lib/customer/activity.ts`.

**Storefront: checkout.** `app/checkout/page.tsx`, `app/checkout/PuramassCheckoutContent.tsx`,
`components/AddressAutocomplete.tsx`, `app/order/success/page.tsx`, `app/order/track/page.tsx`,
`app/shipping-address/[token]/page.tsx`, `lib/api-fetch.ts`, `lib/phone.ts`,
`lib/shipping/regions.ts`.

**Server: checkout.** `app/api/checkout/puramass/route.ts` (+ `rates/route.ts`),
`app/api/checkout/{discount-code,referral-code}/route.ts`, `app/api/promos/{first-order,landing}/route.ts`,
`app/api/shipping/{address-autocomplete,rates}/route.ts`, `app/api/site-config/route.ts`,
`lib/pricing.ts`, `lib/pricing/resolve.ts`, `lib/promos/{ad-discount,cart-offer,first-order,landing,landing-server}.ts`,
`lib/affiliate/{discount-codes,commission,commission-email,route-auth}.ts`,
`lib/analytics/attribution-server.ts`, `lib/klaviyo/{events,settings}.ts`, `lib/rate-limit.ts`,
`lib/site-config.ts`, `lib/config.ts`, `lib/supabase.ts`.

**Payments and lifecycle.** `lib/payments/puramass.ts`, `puramass-{settings,shipping,rates-server,catalog,
columns,address,fulfillment,poll,webhook-log,abandoned,recovery,address-request,address-email,
order-summary,settlement}.ts` (+ tests), `app/api/webhooks/stealth-health/route.ts`,
`app/api/cron/puramass-poll/route.ts`, `app/api/shipping-address/[token]/route.ts`,
`app/api/customer/orders/[id]/claim/route.ts`, `lib/order-confirmation{,-data,-email}.ts`,
`lib/order-stock.ts`, `lib/email.ts`, `lib/smtp.ts`, `lib/customer/{promo-email,outreach,order-link,api}.ts`,
`lib/shipping/auto-shipment.ts`, `lib/easyship.ts`, `lib/admin/{stealth-health-paid-alert,
stealth-health-server,stealth-health-reconcile,partner-settlement-server,puramass-invoice,stock-ledger,
low-stock,alert-recipients}.ts`, `lib/warehouse/server.ts` (fulfillment status only).

**Admin.** `app/(admin)/admin/layout.tsx`, `lib/permissions.ts`, `lib/admin/admin-view.ts`;
`settings/page.tsx` + `app/api/admin/settings/route.ts`; `promos/page.tsx`;
`cart-upsells/page.tsx` + `app/api/admin/product-recommendations/route.ts`;
`discount-codes/page.tsx` + `app/api/admin/discount-codes/**` +
`components/admin/affiliates/{DiscountCodeModal,AffiliateCodesPayouts,api}.ts(x)`;
`landing-pages/page.tsx` + `components/admin/LandingPageModal.tsx` + `app/api/admin/landing-pages/**`;
`stealth-health/page.tsx` + `stealth-health/_components/**` (OrdersTab, columns,
RecoverCheckoutDialog, BulkRecoverDialog, RequestAddressDialog, DeletePuramassOrdersDialog,
CustomerOrderQuickview, Invoices/Payouts/Reconcile/Terms tabs) + `app/api/admin/puramass/**` +
`app/api/admin/stealth-health/**`; `components/admin/{OrderConfirmationEmailCard,
AdminPaidAlertEmailCard,PuramassInvoiceBlocks,ToggleSwitch}.tsx` +
`app/api/admin/{confirmation-email,paid-alert-email}/route.ts`; dashboard `app/(admin)/admin/page.tsx`.

**Legacy, don't port unless needed:** `app/api/orders/**` (410 / legacy lookups),
`app/api/cron/check-payments`, `lib/payment-monitor.ts`, `app/(admin)/admin/orders/**`,
`components/admin/OrderManagementPanel.tsx`, `src/**` (an old parallel app tree that the App Router
doesn't use).

---

## Part 1 — Cart

Source repo: `thepuragroup-droid/vyta-rtl-x` (Next.js ^15.5.4 App Router, React ^19.2.0, Tailwind ^3.4.18, framer-motion ^12.23.24, lucide-react ^0.546.0, Supabase JS).
All cart code is **client-side**. There is **no cart drawer / mini-cart**: the cart is a full page at `/cart`, reached from the nav cart icon. The cart state lives in `localStorage` only (no DB cart table).

Resolved-value conventions used below: Tailwind v3 defaults unless the repo overrides them. Breakpoints `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px. Spacing unit 0.25rem = 4px. Repo overrides: `rounded-xl` = 0.875rem (14px), `rounded-2xl` = 1.125rem (18px), `rounded-3xl` = 1.5rem; stock `rounded-lg` = 0.5rem (8px), `rounded-full` = 9999px. Font family `sans` = `var(--font-inter), Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, sans-serif`. Type scale (size / line-height): `text-[9px]`, `text-[10px]`, `text-[11px]` (arbitrary, inherit line-height), `text-xs` 12/16px, `text-sm` 14/20px, `text-base` 16/24px, `text-lg` 18/28px, `text-xl` 20/28px, `text-2xl` 24/32px, `text-3xl` 30/36px, `text-4xl` 36/40px. Weights: medium 500, semibold 600, bold 700. `leading-tight` 1.25, `leading-snug` 1.375. `tracking-tight` -0.025em.

Color tokens (tailwind.config.ts): ink `#07203A`, ink-muted `#56707F`, ink-light `#6E8898`, surface `#F7FAFB`, surface-2 `#EDF3F5`, line `#DCE7EB`, teal `#438B9E`, teal-dark `#1B5D83`, teal-light `#6EB2B8`, teal-50 `#F1F8F9`. Opacity modifiers resolve to rgba of the base, e.g. `teal/5` = rgba(67,139,158,0.05), `teal/10` = 0.10, `teal/15` = 0.15, `teal/25` = 0.25, `teal/40` = 0.40, `teal/50` = 0.50, `teal/70` = 0.70, `teal/[0.04]` = 0.04; `ink/90` = rgba(7,32,58,0.9), `ink/15` = rgba(7,32,58,0.15), `ink/40` = rgba(7,32,58,0.4); `line/70` = rgba(220,231,235,0.7); `surface/40` = rgba(247,250,251,0.4). Stock Tailwind v3 colors used: red-50 `#FEF2F2`, red-100 `#FEE2E2`, red-200 `#FECACA`, red-500 `#EF4444`, red-600 `#DC2626` (`red-600/90` = rgba(220,38,38,0.9)), red-700 `#B91C1C`; amber-700 `#B45309`; emerald-50 `#ECFDF5`, emerald-200 `#A7F3D0`, emerald-500 `#10B981`, emerald-600 `#059669`, emerald-700 `#047857`, emerald-800 `#065F46`. Shadows: `shadow-sm` = `0 1px 2px 0 rgb(0 0 0 / 0.05)`; `shadow-lg` = `0 10px 15px -3px …, 0 4px 6px -4px …` (with `shadow-black/20` the color is rgb(0 0 0 / 0.2)); `shadow-xl` = `0 20px 25px -5px …, 0 8px 10px -6px …` (with `shadow-black/10` → rgb(0 0 0 / 0.1)). Custom shadows `card`/`card-hover`/`focus` exist in config but are **not used** on the cart surface.

Global body background (app/globals.css): `linear-gradient(180deg, #ffffff 0%, var(--color-cloud) 50%, #ffffff 100%)`; the cart `<main>` paints `bg-surface/40` over it.

---

### Cart — components

#### Provider tree (app/layout.tsx, Server component rendering client providers)
Order (outer → inner), relevant parts only:
```
MaybeWeb3Provider > LanguageProvider > SiteConfigProvider > AffiliateProvider > CustomerProvider
  > CartProvider > PromosProvider > ToastProvider > PurchaseModalProvider > AuthGuard
      > AnnouncementBar, {children}, ChatBubble, FreeShippingToast, AgeVerification, SiteTracking, CustomerJourneyTracker
```
`PromosProvider` must be inside both `CustomerProvider` (signed-in state) and `CartProvider` (item count). `ToastProvider` is inside `PromosProvider`; the cart's suggestion blocks call `useToast()`.

---

#### `CartProvider` / `useCart()` — `contexts/CartContext.tsx` (Client, `'use client'`)
Purpose: single source of cart state, persistence, add/remove/update, totals, fly-to-cart animation overlay, nav bump counter, GA4/Klaviyo cart events, customer-activity logging.

Exports:
- `type PurchaseUnit = 'vial' | 'case'`
- `interface CartItem`:
  | field | type | meaning |
  |---|---|---|
  | `id` | `string` | line key `${productId}::p${packSize}` (derived, never supplied by callers) |
  | `productId` | `string` | catalog `products.id` UUID |
  | `unit` | `PurchaseUnit` | `'vial'` if packSize ≤ 1 else `'case'` (always re-derived from packSize) |
  | `packSize` | `number` | vials in ONE unit of this line (1, 3, 5, 10, …) |
  | `vialsPerBox` | `number` | vials in a full case of the product (default 10) |
  | `name` | `string` | product name |
  | `price` | `number` | CAD price of ONE unit of this line (i.e. one pack) |
  | `quantity` | `number` | number of packs |
  | `strength` | `string` | e.g. "10mg" (may be `''`) |
  | `image_url?` | `string` | product image |
  | `stock_quantity` | `number` | max selectable quantity **in this line's unit** (packs, already `floor(stockVials / packSize)`); `Infinity` if unknown |
- `cartLineId(productId: string, packSize: number): string` → `` `${productId}::p${Math.max(1, Math.floor(Number(packSize) || 1))}` ``
- `unitForPackSize(packSize: number): PurchaseUnit` → `Number(packSize) > 1 ? 'case' : 'vial'`
- `CartProvider({ children })`
- `useCart()` → throws `Error('useCart must be used within CartProvider')` outside provider.

Context value (`CartContextType`):
| member | type |
|---|---|
| `items` | `CartItem[]` |
| `addItem` | `(item: Omit<CartItem,'quantity'|'id'>) => boolean` — adds ONE unit |
| `removeItem` | `(id: string) => void` |
| `updateQuantity` | `(id: string, quantity: number) => void` |
| `clearCart` | `() => void` |
| `totalItems` | `number` = Σ quantity |
| `totalPrice` | `number` = Σ price × quantity (unrounded float) |
| `isOpen` / `setIsOpen` | `boolean` / `(open:boolean)=>void` — legacy drawer flag; **nothing in the app ever sets it true** (see Unverified) |
| `flyToCart` | `(source: HTMLElement | DOMRect | null, opts?: { image_url?: string }) => void` |
| `bumpKey` | `number` — increments on each successful add |

State: `items` (lazy-initialised synchronously from localStorage via `getInitialCart`), `isOpen` (false), `isHydrated` (false → true after mount), `bumpKey` (0), `flyers: Flyer[]` (`{id, startX, startY, image_url?}`), `flyerIdRef`.

Persistence:
- Key: **`localStorage['northern_peptides_cart']`** (JSON array of CartItem).
- Load: `getInitialCart()` — returns `[]` on server; parses JSON; if array → `map(normalizeCartItem)`; on error `console.error('Error loading cart:', error)` and `[]`.
- Save: effect on `[items, isHydrated]` writes `JSON.stringify(items)` once hydrated (note `Infinity` serialises to `null` and is restored to `Infinity` by normaliser).
- Cross-tab sync: `window` `storage` listener; if `e.key === STORAGE_KEY`, parse `e.newValue` (null → `[]`), map through normaliser, `setItems`. Malformed payloads ignored.

`normalizeCartItem(raw)` (legacy migration):
1. `productId = raw.productId ?? raw.id` (very old carts stored the product UUID as `id`).
2. `unit = raw.unit === 'vial' ? 'vial' : 'case'` (missing unit ⇒ case).
3. `vialsPerBox = Number(raw.vialsPerBox) > 0 ? Number(raw.vialsPerBox) : 10`.
4. `packSize = floor(raw.packSize)` if finite & > 0, else `unit==='vial' ? 1 : vialsPerBox`.
5. Returns `{...raw, id: cartLineId(productId, packSize), productId, unit: unitForPackSize(packSize), packSize, vialsPerBox, stock_quantity: raw.stock_quantity ?? Infinity}`.
(No dedupe of lines that normalise to the same id.)

Effects:
- `view_cart` effect on `[isOpen]`: when `isOpen` turns true → `trackViewCart(items.map(cartItemToAnalytics))`. Dead in practice (isOpen never true).

Actions:
- `addItem(newItem)`: `cap = newItem.stock_quantity ?? Infinity`; `lineId = cartLineId(productId, packSize)`. Inside `setItems` updater: if a line with that id exists → `newQty = qty+1`; if `newQty > cap` return unchanged; else set quantity. If no line: if `cap < 1` unchanged; else append `{...newItem, id: lineId, quantity: 1}`. A local `added` flag is set inside the updater. If `added`: `setBumpKey(k=>k+1)`; `trackAddToCart(cartItemToAnalytics({...newItem, id: lineId, quantity: 1}))`; lazy `import('@/lib/customer/activity').then(({trackActivity}) => trackActivity({ type:'cart', productId, productName: name, quantity: 1 }))` (errors swallowed). Returns `added`. NOTE: an existing line's stored `stock_quantity`/`price` are NOT refreshed by a later add — only the cap passed in this call is used for the check.
- `removeItem(id)`: finds line in current `items` (closure), filters it out, and if found `trackRemoveFromCart(cartItemToAnalytics(removed))` (reports the full removed quantity).
- `updateQuantity(id, quantity)`: if `quantity < 1` → `removeItem(id)`; else set `quantity = Math.min(quantity, item.stock_quantity)`. **Fires no analytics** for increments/decrements.
- `clearCart()`: `setItems([])`. **No analytics, no confirm dialog.**
- `flyToCart(source, opts)`: computes start rect (element → `getBoundingClientRect()`, DOMRect as-is, null → viewport centre). `startX = rect.left + rect.width/2 - 18`, `startY = rect.top + rect.height/2 - 18` (TILE_HALF=18). Pushes a flyer; overlay animates it.

Renders: `{children}` + `<FlyOverlay>` (portal into `document.body`, only after mount).

**FlyOverlay / FlyerTile** (same file):
- Overlay: `<div class="pointer-events-none fixed inset-0 z-[300] overflow-hidden">` with `<AnimatePresence>`.
- Destination: on tile mount, `document.querySelectorAll('[data-cart-target]')`, first one whose rect width > 0 (else first); end = its centre minus 18px. If none: `endX = innerWidth - 44`, `endY = 28`.
- Arc: `midX = (startX+endX)/2`, `midY = min(startY,endY) - 90`.
- Animation: `initial {x:startX, y:startY, scale:1, opacity:1}` → `animate { x:[startX,midX,endX], y:[startY,midY,endY], scale:[1,0.85,0.3], opacity:[1,1,0.2] }`, `transition { duration: 0.8, ease: 'easeInOut', times: [0, 0.55, 1] }`; `onAnimationComplete` removes flyer.
- Tile classes: `absolute left-0 top-0 flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-line bg-white shadow-lg shadow-black/20` (36×36px, radius 8px, 1px #DCE7EB border, white). Content: `<img class="h-full w-full object-contain p-1" alt="">` (padding 4px) or lucide `Beaker` `h-4 w-4 text-teal-dark` (16px, #1B5D83).

Used by: Navigation (totalItems, bumpKey), app/cart/page.tsx, components/cart/recommendations.ts, PromosContext (totalItems), FreeShippingToast (totalPrice), checkout (out of scope), app/order/track (clearCart), ProductDetailClient & PurchaseModalContext (addItem, flyToCart — the add-to-cart entry points, out of scope but see Business rules).

---

#### `lib/analytics/cart.ts` — `cartItemToAnalytics(item: CartItem): AnalyticsItem` (isomorphic helper)
```
packSize = Number(item.packSize) > 0 ? Number(item.packSize) : item.unit === 'case' ? (Number(item.vialsPerBox) || 10) : 1
→ { item_id: item.productId, item_name: item.name, item_variant: packSize > 1 ? `${packSize}-pack` : '1-pack',
    ...(item.strength ? { item_category: item.strength } : {}), price: item.price, quantity: item.quantity }
```

#### `lib/analytics/ecommerce.ts` (Client) — event sink used by CartContext
- `track(name, params)`: always calls `forwardEcommerceToKlaviyo(name, params)` first; then if mode `'off'` drop; `'pending'` buffer (max 20); else `dispatch`.
- `dispatch`: mode `gtm`/`both` → `dataLayer.push({ecommerce:null})` then `dataLayer.push({event:name, ecommerce: params})`; mode `gtag`/`both` → `gtag('event', name, params)`. Mode set by `SiteTracking` via `setAnalyticsMode`.
- Currency constant `'CAD'`. `value` = Σ price×quantity rounded to cents.
- Cart-relevant: `trackAddToCart(item)` → `add_to_cart {currency, value, items:[item]}`; `trackRemoveFromCart(item)` → `remove_from_cart`; `trackViewCart(items)` → `view_cart` (skipped when empty).
- Klaviyo (`lib/analytics/klaviyo-onsite.ts`): `add_to_cart` → `_klOnsite.push(['track','Added to Cart',{ $value, AddedItemProductName, AddedItemProductID, AddedItemVariant, AddedItemCategories:[item_category]|[], AddedItemPrice, AddedItemQuantity, CheckoutURL: `${location.origin}/cart`, Currency }])`; `view_cart` → `'Viewed Cart' { $value, ItemNames, Items:[{ProductID,ProductName,Variant,Quantity,ItemPrice}], Currency }`. `remove_from_cart` is NOT forwarded to Klaviyo. Klaviyo has its own pending/on/off gate (`setKlaviyoOnsiteMode`, buffer 20).

#### `lib/customer/activity.ts` — `trackActivity(event)` (Client)
Used by `addItem` with `{ type: 'cart', productId, productName, quantity: 1 }`. Gets Supabase session token (anon browser client `supabase` from `lib/supabase.ts`); `POST /api/customer/activity` with JSON body, `Authorization: Bearer <token>` if signed in, `credentials: 'same-origin'`, `keepalive: true`. Never throws. (The CartContext comment says "no-op when anonymous", but the code sends anonymous events too — the API keys them by the `aminocan_vid` cookie and decides by consent.)
Server (`app/api/customer/activity/route.ts`, service-role client): always HTTP 200; anonymous rate limit 120/min/IP; consent check (`isTrackingAllowed`); inserts into **`customer_activity`** `{ customer_id, anonymous_id, session_id, activity_type:'cart', search_query:null, product_id (UUID-validated else null), product_name (≤200 chars), quantity: max(1, floor(q)), page_path:null, page_title:null, referrer:null, metadata }`; fallback insert with legacy column set if new columns missing. No milestone for `cart`.

---

#### `PromosProvider` / `usePromos()` — `contexts/PromosContext.tsx` (Client)
Purpose: resolves the four storefront promos once per app load for nav, cart and checkout. Display-only.

Value (`PromosValue`):
| member | type | notes |
|---|---|---|
| `loading` | boolean | false once settings fetch settles |
| `freeShipping` | `{ active: boolean; threshold: number }` | from `puramass_free_shipping_active` / `puramass_free_shipping_threshold` |
| `adDiscount` | `{ enabled: boolean; percent: number; active: boolean }` | |
| `isAdVisitor` | boolean | any of first/last-touch channel is paid |
| `isFirstOrder` | boolean | from `/api/promos/first-order`; false for guests / while loading |
| `adDiscountEligible` | boolean | `qualifiesForAdDiscount({enabled: adDiscount.active, percent}, {signedIn: !!customer, firstOrder: isFirstOrder, channels})` |
| `adDiscountOn` | `(subtotal) => number` | `eligible ? adDiscountAmount(subtotal, percent) : 0` |
| `cartOffer` | `CartOfferValue` = `{enabled, minItems, percent, endsAt, earned, itemsAway, amountOn(subtotal)}` | measured against `useCart().totalItems` |
| `landingOffer` | `LandingOfferValue` = `{active, slug, code, percent, firstOrderOnly, excludedProductIds, exclusions, reason, amountOn(lines: {productId, amount}[])}` | |

Defaults (`EMPTY`): loading true, freeShipping `{active:false, threshold:0}`, adDiscount `{enabled:false, percent:25, active:false}`, cartOffer `{enabled:false, minItems:2, percent:10, endsAt:null, earned:false, itemsAway:0, amountOn:()=>0}`, landingOffer all-off (`amountOn:()=>0`).

Effects / data calls:
1. Mount: `setChannels(visitorChannels())` → `[firstTouch.channel, lastTouch.channel]` read from cookies `aminocan_attr` and `aminocan_attr_last` (`lib/analytics/attribution-client.ts`).
2. `[customerId]`: if no customer → `isFirstOrder=false`. Else `supabase.auth.getSession()` → `GET /api/promos/first-order` (`cache:'no-store'`, `Authorization: Bearer`) → `{ firstOrder: boolean }` → `setIsFirstOrder(!!json.firstOrder)`. Errors leave false. Server (`getSupabase()` service-role): `isCustomerFirstOrder` = false if `customers.has_completed_first_order` true or any `puramass_orders` row for customer with status in `['paid','payment_pending']`; 401 `{firstOrder:false}` without/invalid token.
3. `[customerId]` landing offer: only if `document.cookie` has `vyta_lp=`. `GET /api/promos/landing` (`no-store`, Bearer if session). Response `{ offer: { slug, code, percent, first_order_only, excluded_product_ids, exclusions, ends_at } | null, eligible: boolean, reason: string|null }`. If `!o?.code || !(percent > 0)` → no offer. Else `{active: json.eligible !== false, slug, code: String(code), percent, firstOrderOnly, excludedProductIds (array or []), exclusions ?? null, reason ?? null}`. Server reads `landing_pages` (by slug, must be `active`) + its `discount_codes` row (`discount_code_id`; must be active, `discount_type='percent'`, started, not expired, percent capped 99); `exclusions` = phrase from `products.name` of excluded ids (any bacteriostatic-water name collapses to "bacteriostatic water"; ≤3 joined with ", " and " and ", else "a, b, c and N more"); `eligible=false` + `reason` (e.g. "That code is for first orders only.") only for a signed-in customer who has ordered before on a first-order-only code.
4. Mount: `GET /api/admin/settings` (`cache:'no-store'`) → `json.settings`:
   - `freeShipping = { active: !!s.puramass_free_shipping_active, threshold: Number(s.puramass_free_shipping_threshold) || 0 }`
   - `adDiscount = { enabled: !!s.ad_discount_enabled, percent: Number(s.ad_discount_percent) || 0, active: !!s.ad_discount_active }`
   - `cartOffer = { enabled: !!s.cart_offer_active, minItems: Number(s.cart_offer_min_items) || 1, percent: Number(s.cart_offer_percent) || 0, endsAt: s.cart_offer_ends_at ?? null }`
   - non-OK/throw → nothing shown; `loading=false` in finally.
5. `[cartOffer.endsAt]`: if end in future and ≤ 2,147,483,647 ms away → `setTimeout(+250ms)` bumps `expiryTick` so the memo re-evaluates exactly once at expiry.

Memo deps: `loading, freeShipping, adDiscount, channels, customer, isFirstOrder, cartOffer, totalItems, expiryTick, landingOffer`. Landing `amountOn(lines)` = `active ? Math.round(eligibleSubtotal(lines, excludedProductIds) * percent) / 100 : 0` where `eligibleSubtotal` sums `amount` of lines whose `productId` (lower-cased) is not excluded.

#### `/api/admin/settings` GET (`app/api/admin/settings/route.ts`, Server route, service-role `createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`)
Unauthenticated. `site_settings.select('*').limit(1).maybeSingle()` → `{ settings: shape(row) }`. Cart-relevant shaped fields:
- `puramass_free_shipping_active` = `puramass_free_shipping_enabled` AND `puramass_shipping_rates_enabled` AND `threshold > 0` (via `shapeHostedShippingSettings`); `puramass_free_shipping_threshold` = number ≥ 0 (default 0).
- `ad_discount_enabled` = `ad_discount_active` = `!!ad_discount_enabled && percent>0`; `ad_discount_percent` = clamp 0–100 to 2 dp (default 25 when null).
- `cart_offer_enabled` = `cart_offer_active` = `!!cart_offer_enabled && percent>0`; `cart_offer_percent` = min(99, clamp) (default 10); `cart_offer_min_items` = clamp floor 1–99 (default 2); `cart_offer_ends_at` = ISO or null (unparseable → null).
- `cart_fbt_enabled ?? true`, `cart_similar_enabled ?? true`, `cart_trust_strip_enabled ?? true`.

#### `SiteConfigProvider` / `useSiteConfig()` — `contexts/SiteConfigContext.tsx` (Client)
Cart uses only `config.store_name` (in "Why Customers Choose {store_name}"). Starts from `DEFAULT_SITE_CONFIG` (`store_name: 'VYTA'`), replaced after `fetchSiteConfig()` → `GET /api/site-config` (`no-store`) → `{ config }` read from `site_settings` (service-role `getSupabase()`). Failure → defaults.

---

#### `CartPage` — `app/cart/page.tsx` (Client, `'use client'`, default export, route `/cart`)
No props, no `metadata` export (inherits root title `${store_name} - ${store_tagline}`). `/cart` is in `robots.ts` disallow list.

Hooks/state:
- `router = useRouter()`
- `{ items, removeItem, updateQuantity, totalPrice, totalItems, clearCart } = useCart()`
- `{ config } = useSiteConfig()`
- `{ frequentlyBoughtTogether, youMayAlsoLike } = useCartRecommendations()`
- `trustStripEnabled: boolean | null` (null until known) — own effect: `fetch('/api/admin/settings', {cache:'no-store'})` → `json?.settings?.cart_trust_strip_enabled ?? true`; on error `true`. Cancelled flag on unmount. (A second settings fetch independent of PromosProvider.)
- `{ freeShipping, adDiscount, adDiscountEligible, adDiscountOn, cartOffer, landingOffer } = usePromos()`
- `lowestStock = useMemo(min over items of Number(item.stock_quantity) where finite, else +Infinity)`; `scarce = isFinite(lowestStock) && lowestStock > 0 && lowestStock <= 5`.
- Effect: if `!siteConfig.ecommerceEnabled` → `router.replace('/products')`; render returns `null` in that case.

Constants: `LOW_STOCK_AT = 5`; `HEADER_TRUST` = [Truck "Free, Fast & Discreet Shipping" / "Canada-wide"; ShieldCheck "Secure Checkout" / "SSL encrypted"; Package "Carefully Packaged" / "Your privacy matters"]; `SUMMARY_TRUST` = [Package "Discreet Packaging"; Truck "Ships in 24 Hours"; Beaker "Canada Wide"; ShieldCheck "100% Secure"].

Money math: see Business rules. Renders: `Navigation`, `Footer`, `FreeShippingProgress (variant="bar")`, `FrequentlyBoughtTogether`, `YouMayAlsoLike`, `LimitedTimeOffer`. Links: `/products` (Continue Shopping, Browse Products), `/checkout` (Proceed to Secure Checkout — plain `<Link>`, no click handler, no analytics on cart side).

---

#### `useCartRecommendations()` + helpers — `components/cart/recommendations.ts` (Client module)
Exports:
- `interface RecommendedProduct { id; name; description_short: string|null; description: string|null; price: number; vial_price: number|null; vials_per_box: number; pack_sizes: number[]|null; pack_options: unknown; stock_quantity: number; strength: string|null; image_url: string|null; box_image_url: string|null; url_slug?: string|null; slug: string|null; category: string|null; recommendation_badge?: string|null; recommendation_reason?: 'bought-together'|'same-category'|'popular' }`
- `SUGGESTED_PACK_SIZE = 3`
- `defaultPackFor(product): ResolvedPackOption | null` — `packs = packOptionsFor(product)`; buyable ⇔ `packsInStock(stock_quantity, size) >= 1`; returns the 3-pack if offered and buyable, else first buyable pack (ascending size), else `null`.
- `cartLineFor(product, pack)` → `{ productId: product.id, unit: pack.size>1?'case':'vial', packSize: pack.size, vialsPerBox: vialsPerBoxOf(product.vials_per_box), name, price: pack.price, strength: product.strength ?? '', image_url: product.image_url || undefined, stock_quantity: packsInStock(stock, pack.size) }`
- `productHref(product)` → `/products/${url_slug || slug || id}`
- `useCartRecommendations(): { frequentlyBoughtTogether, youMayAlsoLike, loading }` — `idKey` = sorted unique productIds joined by `,`. Effect on `[idKey]`: empty → both `[]`, loading false. Else bump `requestId`, `AbortController`; get Supabase session; `GET /api/products/recommendations?ids=<encodeURIComponent(idKey)>` (`cache:'no-store'`, Bearer if signed in, `signal`); non-OK → throw; stale responses (requestId changed) ignored; errors → both lists `[]`. Cleanup aborts. Quantity changes don't refetch; adding/removing a distinct product does.
- `useAddSuggestion()` → `(product, source?) => boolean`: `pack = defaultPackFor(product)`; null → false; `added = addItem(cartLineFor(product, pack))`; if added → `flyToCart(source ?? null, { image_url })`. Returns added.

Pricing helpers it relies on (`lib/pricing.ts`):
- `vialPriceFor(p)` = `vial_price` if > 0 else `round2(price / vialsPerBoxOf(vials_per_box))`.
- `packOptionsFor(p)` — packs from `pack_options` (jsonb rows `{size,label,price,compare_at,badge,enabled}`), else `pack_sizes` (int[]), else legacy `[1, vials_per_box]` (or `[1]`); drops `enabled:false`; per pack: `undiscounted = round2(vialPrice*size)`, `price = option.price ?? undiscounted`, `compareAt = option.compare_at ?? (price < undiscounted ? undiscounted : null)` kept only if > price, `savings = round2(compareAt - price)`, `savingsPercent = round(savings/compareAt*100)`, `label = option.label ?? (size===1 ? 'Single vial' : 'Pack of N')`, `perVialPrice`.
- `packsInStock(stockVials, size) = floor(max(0, stockVials) / max(1, floor(size)))`.

#### `GET /api/products/recommendations` — `app/api/products/recommendations/route.ts` (Server route)
Client: service-role `createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`. Public.
- Query `ids` = comma list; each trimmed, must match `/^[0-9a-f-]{36}$/i`; deduped; max 50.
- Optional `Authorization: Bearer` → `auth.getUser` → customerId for pricing.
- Toggles: `site_settings.select('*')` → `fbt = cart_fbt_enabled ?? true`, `similar = cart_similar_enabled ?? true` (errors → both true).
- Catalog: `products.select('*').eq('active', true)`; error → `{ frequentlyBoughtTogether: [], youMayAlsoLike: [] }`.
- FBT (if fbt): `product_recommendations.select('recommended_product_id, sort_order, badge, enabled').in('product_id', cartIds).eq('enabled', true).order('sort_order', asc)`; first occurrence of each recommended id kept (with its `badge`); filter: exists in active catalog, not in cart, `stock_quantity > 0`; **limit 3**.
- You may also like (if similar): history = `order_items.select('order_id, product_id, quantity').order('created_at', desc).limit(4000)` + `puramass_orders.select('id, items, status').order('created_at', desc).limit(4000)` with `status === 'paid'` only, `items[].sku` mapped (lower-case) to products via `puramass_sku` / `puramass_sku_vial`. Ranked by `rankRecommendations` excluding cart + FBT ids, **limit 8**.
- Pricing: `applyResolvedPrices(db, customerId, [...fbt, ...similar])` — chain customer override (`customer_price_overrides`) > active pricelist (`pricelists.is_active`, `pricelist_items`) > catalog. When overridden: `price` replaced, `vial_price = round2(price / vialsPerBox)`, `pack_options = null`, plus `base_price`, `price_source`.
- Response 200: `{ frequentlyBoughtTogether: (productRow & { recommendation_badge: string|null })[], youMayAlsoLike: (productRow & { recommendation_reason })[] }` (full `products.*` rows).

#### `rankRecommendations` — `lib/products/recommendations.ts` (pure)
Score per candidate (skip if in cart/excluded or `stockQuantity <= 0`):
`min(coPurchases, 6) * 10` + (`sameCategory` ? 6 : 0) + `min(unitsSold/25, 1) * 5` + (`featured` ? 2 : 0), rounded to 2 dp.
- coPurchases = number of distinct baskets (orderId) containing both this product and any cart product.
- sameCategory = trimmed lower-case `category` equals a cart product's category.
- unitsSold = Σ quantity (invalid → 1) over all history lines.
- `reason` = `'bought-together'` if coPurchases>0, else `'same-category'` if sameCategory, else `'popular'`.
Sort: score desc → unitsSold desc → name `localeCompare` asc. Slice to limit (8). `reason` is returned but not displayed.

---

#### `FrequentlyBoughtTogether` — `components/cart/FrequentlyBoughtTogether.tsx` (Client, default export)
Props: `products: RecommendedProduct[]`; `pairedWith?: string` (cart passes `items[0]?.name`); `className?: string = ''`.
State: `selected: string[]`; `gridRef`. Hooks: `useToast()`, `useAddSuggestion()`.
- `buyable = products.filter(p => defaultPackFor(p) !== null)` (memo).
- Effect on `idKey` (buyable ids joined): `setSelected(all buyable ids)` — every card starts ticked and re-ticks whenever the list changes.
- Returns `null` if `buyable.length === 0`.
- `bestSaving` = max `defaultPackFor(p).savingsPercent` among selected buyable.
- `toggle(id)` add/remove.
- `addSelected()`: picked = selected buyable; none → return. For each: `addSuggestion(product, gridRef.current)`; collect names that returned false. All blocked → `toast.error(picked.length === 1 ? `${picked[0].name} is out of stock.` : "We couldn't add those — they're out of stock.")` and return. Some blocked → `toast.error(`${blocked.join(', ')} couldn't be added — out of stock.`)`. Then `toast.success(`Added ${addedCount} item${addedCount === 1 ? '' : 's'} to your cart.`)`.
Rendered by: CartPage (left column, after line-items card).

#### `YouMayAlsoLike` — `components/cart/YouMayAlsoLike.tsx` (Client, default export)
Props: `products: RecommendedProduct[]`; `className?: string = ''`.
State: `atStart` (true), `atEnd` (false); `railRef`. `syncArrows()`: `atStart = scrollLeft <= 4`; `atEnd = scrollLeft + clientWidth >= scrollWidth - 4`. Effect on `[syncArrows, products.length]`: sync, add passive `scroll` listener on rail + `resize` on window.
`scrollBy(dir)`: `rail.scrollBy({ left: dir * max(200, clientWidth*0.8), behavior: 'smooth' })`.
`buyable` filter as FBT; `null` if empty. `add(product, source=button)`: success → `toast.success(`${product.name} added to your cart.`)`; else `toast.error(`${product.name} is out of stock.`)`.
Rendered by: CartPage (left column, after FBT).

#### `LimitedTimeOffer` — `components/cart/LimitedTimeOffer.tsx` (Client, default export)
Props: `className?: string = ''`. Reads `usePromos().cartOffer`.
`useCountdown(endsAt)`: state `remaining: number|null`; effect on `[endsAt]`: none/invalid → null; else `tick = setRemaining(max(0, end - now))`, run now and every 1000 ms (`setInterval`). Returns null if remaining null or ≤ 0, else `HH:MM:SS` with hours unbounded (days folded into hours, zero-padded to ≥2 digits).
Render guards: `!enabled || percent <= 0` → null; `endsAt && !clock && !earned && itemsAway === 0` → null (expired).
Rendered by: CartPage, top of the sticky right column.

#### `FreeShippingProgress` — `components/FreeShippingProgress.tsx` (Client, default export)
Props: `subtotal: number` (CAD goods), `threshold: number`, `active: boolean`, `variant?: 'card' | 'bar'` (default `'card'`), `className?: string`.
`progress = active ? freeShippingProgress(subtotal, threshold) : null`; null → render nothing. Cart uses `variant="bar"` with `subtotal={totalPrice}`, `threshold={freeShipping.threshold}`, `active={freeShipping.active}`, `className="mt-1"`. (`card` variant is the checkout's.)
`freeShippingProgress` (`lib/payments/puramass-shipping.ts`): `target ≤ 0`/NaN → null; `spent = max(0, subtotal)`; `remaining = max(0, ceil((target - spent) * 100) / 100)`; `pct = clamp(spent/target*100, 0, 100)`; `unlocked = remaining <= 0`.

#### `FreeShippingToast` — `components/FreeShippingToast.tsx` (Client; mounted globally in layout)
Not shown on the cart: `SILENT_PATHS = ['/admin','/warehouse','/affiliate','/cart','/checkout']` (exact or prefix + `/`). Elsewhere: same progress math on `useCart().totalPrice`; appears after 1200 ms; dismissal stored in `sessionStorage['aminocan.freeShippingToast']` as the dismissed state (`'progress'` | `'unlocked'`), so crossing the threshold re-shows it. Copy: progress "You're $X.XX away from free shipping" / "Spend $T.TT or more and we'll cover the shipping. Keep shopping" (link `/products`); unlocked "You've got free shipping" / "Shipping is on us on orders over $T.TT — pick any courier at checkout and it's free." Dismiss button aria-label "Dismiss free shipping notice". Position `fixed bottom-4 left-4 right-[5.5rem] z-40 sm:right-auto sm:w-[340px]`; card `rounded-2xl border shadow-xl shadow-black/10 backdrop-blur` with `border-emerald-200 bg-emerald-50/95` (unlocked) or `border-line bg-white/95`; motion `initial {opacity:0,y:16,scale:0.97}` → `{1,0,1}`, exit same as initial, `duration 0.25, ease [0.16,1,0.3,1]`.

#### `AdDiscountNotice` + `useAdOfferNotice()` — `components/AdDiscountNotice.tsx` (Client)
Not on the cart body; rendered inside Navigation's disclaimer row on every page including `/cart`. `useAdOfferNotice()`: landing offer active → `{show:true, eligible:true, off: `${+percent.toFixed(2)}%`, firstOrder: firstOrderOnly}`; else `show = adDiscount.active && isAdVisitor && (customer ? adDiscountEligible : true)`, `{eligible: adDiscountEligible, off: `${adDiscount.percent}%`, firstOrder: true}`.
Render (fragment siblings): `<span class="text-line">•</span>` then
- eligible: `<span class="inline-flex items-center gap-1.5 whitespace-nowrap text-emerald-700">` Check `h-3 w-3` + **"{off} off"** (semibold) + `sm+`: "{ your first order if firstOrder} — applied at checkout" / `<sm`: " applied".
- not eligible: `<Link href="/signup" class="group inline-flex items-center gap-1.5 whitespace-nowrap transition-colors hover:text-ink">` BadgePercent `h-3 w-3 text-teal-dark` + "{off} off" (`font-semibold text-ink`) + `sm+` " your first order — sign up" / `<sm` " first order" + ArrowRight `hidden h-3 w-3 sm:inline`, `group-hover:translate-x-0.5`, `duration-200`.
When `adOffer.show`, Navigation hides the mobile "• Canada Only" span.

#### `Navigation` cart icon — `components/Navigation.tsx` (Client)
Uses `{ totalItems, bumpKey } = useCart()`. Two cart links, both only when `siteConfig.ecommerceEnabled`:
- Desktop (inside `hidden lg:flex items-center gap-2`): `<Link href="/cart" data-cart-target aria-label=…  class="relative flex items-center justify-center w-10 h-10 rounded-lg transition-all text-ink-muted hover:text-ink hover:bg-surface">` (40×40px, radius 8px, #56707F → hover #07203A on #F7FAFB).
- Mobile (inside `lg:hidden flex items-center gap-2`, before the hamburger): same but `class="relative flex items-center justify-center w-10 h-10 transition-colors text-ink-muted hover:text-ink"` (no radius/hover bg).
- aria-label: `Cart` or `Cart, {n} item` / `Cart, {n} items`.
- Icon: `<motion.span key={bumpKey} animate={bumpKey > 0 ? { scale: [1, 1.3, 1] } : { scale: 1 }} transition={{ duration: 0.35, ease: 'easeOut' }} class="flex items-center justify-center">` wrapping lucide `ShoppingCart` `w-5 h-5` (20px). Changing `key` remounts the span so each add replays the 1→1.3→1 bump.
- Badge (when `totalItems > 0`): `<span class="absolute -top-0.5 -right-0.5 text-[10px] rounded-full min-w-[18px] h-[18px] flex items-center justify-center font-bold px-1 bg-ink text-white">` text `totalItems > 99 ? "99+" : totalItems` (offset -2px top/right; 18px tall pill; 10px bold white on #07203A; 4px horizontal padding). Badge counts units (`totalItems`), not lines.
- `data-cart-target` is the fly-to-cart destination; the hidden variant reports zero width so the visible one is picked.
- Nav is `fixed w-full z-50` at `top: var(--announcement-h, 0px)`; bar `bg-white border-b border-line`, inner `h-[72px]`, plus disclaimer row `py-2 sm:py-1.5 bg-surface border-t border-line`. The mobile menu has no cart entry.

#### `ReferralCodeField` — `components/cart/ReferralCodeField.tsx` (Client) — **NOT MOUNTED**
Present in the cart folder but imported nowhere (git: "drop cart referral box"). Collapsible "Add a referral code" row that validates against `referral_codes` (anon client, `code` eq normalised, `active` true) and writes cookie `ref_code` (30 days, `path=/; SameSite=Lax`). Copy if ever revived: "Add a referral code" / "Referral code {CODE} applied"; placeholder "Enter code"; button "Apply"; errors "Codes are at least 4 characters.", "That code isn't valid.", "We couldn't check that code — try again at checkout."; helper "Credits whoever referred you. It does not change your total." / "We'll carry it through to checkout for you." Do not port unless wanted.

#### `ToastContext` (context used by suggestion blocks) — `contexts/ToastContext.tsx`
`useToast()` → `{ success, error, info }(message, duration = 6000)`. Container `fixed bottom-4 left-1/2 -translate-x-1/2 sm:left-auto sm:right-4 sm:translate-x-0 z-[200] flex flex-col gap-2 w-[min(92vw,360px)]`, `role="status" aria-live="polite"`. Card `flex items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg` + success `border-emerald-200 bg-emerald-50 text-emerald-800` (Check `w-4 h-4 text-emerald-600`), error `border-red-200 bg-red-50 text-red-700` (AlertCircle `text-red-600`). Motion `initial {opacity:0,y:16,scale:0.96}` → `{1,0,1}`, exit `{opacity:0,y:12,scale:0.96}`, `duration 0.2 easeOut`, `layout`. Hover pauses auto-dismiss. Close X `w-3.5 h-3.5`, aria-label "Dismiss".

---

### Cart — business rules

#### Line identity & caps
- One line per (productId, packSize): `id = "<productId>::p<packSize>"`. A 1-pack, 3-pack and 10-pack of the same product are separate lines.
- `price` on a line = price of one pack (already pack-level, may be a discounted fixed pack price). Line total = `price × quantity`.
- `stock_quantity` on a line = cap in packs = `floor(stockVials / packSize)` computed by the caller at add time. `addItem` refuses when `existing.quantity + 1 > cap` or (new line) `cap < 1`. `updateQuantity` clamps to `item.stock_quantity`; `< 1` removes the line. The "+" button is disabled at `quantity >= stock_quantity`. `stock_quantity` unknown ⇒ `Infinity` (no cap).
- Add-to-cart entry points (outside this section): PDP (`ProductDetailClient`) and the purchase modal call `addItem` once per unit in a loop of `qty`, with `stock_quantity = cap` for the selected pack, then `flyToCart(heroImage)`. Their toasts: `Not enough stock for a {label lower-cased}.` / `Not enough stock for a pack of {N}.` / `Out of stock.` / `Only {cap} in stock — that's all we have.`
- Suggestion cards add **one unit** of the default pack (3-pack if offered and ≥1 in stock, else first in-stock pack).

#### Totals math (cart page)
```
subtotal          = totalPrice = Σ item.price × item.quantity
landingSaving     = landingOffer.amountOn(items.map(i => ({ productId: i.productId, amount: i.price*i.quantity })))
                  = active ? round(eligibleSubtotal(lines, excludedIds) × percent) / 100 : 0
welcomeSaving     = adDiscountOn(subtotal) = eligible ? round(subtotal × clamp(percent)) / 100 : 0
landingWins       = landingSaving > 0 && landingSaving >= welcomeSaving     // never both
adSaving          = landingWins ? 0 : welcomeSaving
afterFirst        = max(0, subtotal − (landingWins ? landingSaving : adSaving))
offerSaving       = cartOffer.amountOn(afterFirst) = earned ? round(afterFirst × clamp(percent)) / 100 : 0
estimatedTotal    = max(0, afterFirst − offerSaving)
```
- The cart offer applies to the amount left **after** the first discount (multiplicative stacking; server uses `combineDiscountPercents`, e.g. 25% then 10% = 32.5%, capped 99%).
- Landing code and paid-ads welcome discount never stack: the larger saving wins; ties go to the landing code.
- Shipping is never added on the cart: row reads "Calculated at checkout". Currency label "(CAD)". All money formatted as `$` + `toFixed(2)` (no Intl, no thousands separator).
- The cart decides nothing about money — `/api/checkout/puramass` re-prices from catalog and re-evaluates every promo.

#### Free shipping
- Source: `site_settings.puramass_free_shipping_enabled` + `puramass_free_shipping_threshold` + `puramass_shipping_rates_enabled` → `puramass_free_shipping_active = rates_enabled && free_enabled && threshold > 0`.
- Measured against the **pre-discount** `totalPrice` (goods subtotal) on the cart.
- `remaining = max(0, ceil((threshold − subtotal)×100)/100)`, `pct = clamp(subtotal/threshold×100, 0, 100)`, unlocked when `remaining <= 0` (i.e. subtotal ≥ threshold).
- Bar hidden when not active or threshold ≤ 0.

#### Limited-time cart offer (`lib/promos/cart-offer.ts`, rules pinned by `cart-offer.test.ts`)
- Settings: `cart_offer_enabled`, `cart_offer_min_items`, `cart_offer_percent`, `cart_offer_ends_at`. Defaults (code) `DEFAULT_CART_OFFER = { enabled:false, minItems:2, percent:10, endsAt:null }`; `MAX_DISCOUNT_PERCENT = 99`.
- `shapeCartOfferSettings`: percent = `min(99, clampDiscountPercent(v ?? 10))` (clamp: non-finite/≤0 → 0; else min(100, round to 2dp)); `enabled = !!cart_offer_enabled && percent > 0` (0% forces off); `minItems = clampMinItems(v ?? 2)` (floor; <1/NaN → 1; max 99); `endsAt` ISO or null (unparseable → null, i.e. "never expires", not "expired").
- `cartOfferExpired`: `endsAt` set and `end <= now`.
- `qualifiesForCartOffer(settings, itemCount)`: enabled, percent>0, not expired, `floor(itemCount) >= minItems`. Unlocks AT the minimum (min 2: 1→false, 2→true).
- `itemsToUnlockCartOffer`: 0 if off/expired, else `max(0, minItems − floor(itemCount))`.
- Item count = cart **units** (`totalItems`, Σ quantity) — a line of 3 × 5-pack counts 3.
- `cartOfferAmount(subtotal, percent)` = `round(subtotal × pct)/100`; 0 if pct ≤ 0 or subtotal ≤ 0. Test values: 190@10% → 19; 199.99@10% → 20.
- `combineDiscountPercents(...p)` = `1 − Π(1 − p/100)` → rounded to 2dp, capped 99. Tests: (25,10)→32.5; (50,50)→75; (99,99)→99.
- Countdown shown only when `endsAt` is set; the PromosProvider re-evaluates once at expiry (+250 ms) so the strip and the summary line disappear together.

#### Paid-ads welcome discount (as the cart displays it)
- Eligible only if: `ad_discount_active` and percent > 0 AND signed in AND `isFirstOrder` (API) AND first- or last-touch channel ∈ {`google_ads`,`meta_ads`,`bing_ads`,`tiktok_ads`,`linkedin_ads`,`other_paid`}.
- Cart line shown only when `adDiscountEligible && adSaving > 0` (so hidden when the landing code wins). Guests never see it on the cart (they see the nav invitation instead).

#### Landing-page offer (as the cart displays it)
- Requires cookie `vyta_lp` (set by middleware from `?lp=<slug>`, 30 days). Offer = landing page's percent discount code; `active = eligible !== false` (false only for a signed-in customer who has ordered before on a first-order-only code). Excluded products contribute 0 to `landingSaving`.
- Cart line shown only when `landingWins`. Label `{+percent.toFixed(2)}% ` + (`firstOrderOnly` ? "first-order offer" : "welcome offer"); fine print "Code {code} is applied automatically at checkout" + (exclusions ? " · excludes {exclusions}" : "") + ".".

#### Upsell selection rules
- FBT: operator pairings from `product_recommendations` where `product_id ∈ cart products` and `enabled`, ordered by `sort_order` asc (first occurrence wins across cart products), excluding in-cart and `stock_quantity ≤ 0` products, max 3; then client filters to those with a buyable default pack. Badge = pairing's `badge`. Hidden when `cart_fbt_enabled = false` (server returns `[]`).
- You may also like: computed (score formula above), excluding cart + FBT products and out-of-stock, max 8; client filters to buyable. Hidden when `cart_similar_enabled = false`.
- Prices on suggestion cards are customer-resolved (override > pricelist > catalog). When a pricelist/override applies, pack_options are dropped → pack prices revert to `vial_price × size` and no compare-at saving shows.
- FBT "Save up to N%" = max `savingsPercent` of the **selected** cards' default packs (compare-at derived from `pack_options`), hidden when 0.

#### Stock messaging
- Per line: `low = isFinite(stock_quantity) && stock_quantity <= 5` → amber "Only {stock_quantity} left — order soon"; else emerald "In Stock – Ships in 24h".
- Summary scarcity box: `lowestStock` = min finite `stock_quantity` across lines; shown when `0 < lowestStock <= 5`: "Only {lowestStock} left in stock" / "Order now to avoid missing out."
- Note: `stock_quantity` is the cap captured at add time (not live stock).

#### What persists where
| data | where | key / lifetime |
|---|---|---|
| cart lines | `localStorage` | `northern_peptides_cart` (no expiry; synced across tabs via `storage` event) |
| free-shipping toast dismissal | `sessionStorage` | `aminocan.freeShippingToast` = `'progress'`/`'unlocked'` (not shown on /cart) |
| landing offer slug | cookie | `vyta_lp` (30 d, set by middleware) |
| attribution | cookies | `aminocan_attr` (first touch), `aminocan_attr_last` (last touch) |
| anonymous visitor id | cookie | `aminocan_vid` (used server-side by activity API) |
| cart-add activity | DB | `customer_activity` row (activity_type `'cart'`) |
| settings / promos | DB | `site_settings` singleton (read only) |
No server-side cart, no abandoned-cart capture from the cart page.

#### Analytics fired from the cart surface
| user action | GA4 event (gtag/dataLayer per mode) | Klaviyo onsite | customer_activity |
|---|---|---|---|
| add via FBT/YMAL (or PDP/modal) — each successful unit | `add_to_cart` {currency:'CAD', value: price×1, items:[{item_id, item_name, item_variant 'N-pack'/'1-pack', item_category=strength, price, quantity:1}]} | "Added to Cart" | `type:'cart', quantity:1` |
| trash icon, or "−" at quantity 1 | `remove_from_cart` (full line quantity) | — | — |
| "+" / "−" (qty stays ≥1) | none | none | none |
| Clear cart | none | none | none |
| page view of /cart | none (`view_cart` only fires on `isOpen`, which is never set) | none | (global page tracker, out of scope) |
| Proceed to Secure Checkout | none on cart (checkout page fires `begin_checkout`) | — | — |

#### Toast / error / UI strings (verbatim)
- FBT: `{name} is out of stock.` · `We couldn't add those — they're out of stock.` · `{name1, name2} couldn't be added — out of stock.` · `Added {n} item to your cart.` / `Added {n} items to your cart.`
- YMAL: `{name} added to your cart.` · `{name} is out of stock.`
- No error UI for failed settings/recommendations/promos fetches (silently hidden). `console.error('Error loading cart:', error)` on corrupt localStorage.

---

### Cart — UI/UX

#### Wireframe — desktop (≥ lg, 1024px+)
```
┌──────────────────────────── fixed Navigation (white, 72px + disclaimer row) ─────────── [🛒 badge] ┐
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
  ← Continue Shopping
  Your Cart (3)                                         🚚 Free, Fast & Discreet   🛡 Secure      📦 Carefully
  You're one step closer to a better you.                  Shipping / Canada-wide     Checkout /    Packaged /
                                                                                     SSL encrypted  Your privacy matters
┌────────────────────────────── left: minmax(0,1fr) ───────────────┐  ┌──── right: 22rem (352px), sticky top 144px ─┐
│ ┌ card (white, 1px line, r18) ─────────────────────────────────┐ │  │ ┌ Limited Time Offer strip ──────────────┐ │
│ │ [img 80] Name                              $123.00  🗑        │ │  │ │ [🎁] Limited Time Offer      05:12:33  │ │
│ │          10mg | Pack of 3                                     │ │  │ │      Add 1 more item and get 10% OFF   │ │
│ │          ✓ In Stock – Ships in 24h            [ − 2 + ]       │ │  │ │      your order!                       │ │
│ │ ───────────────────────────────────────────────────────────── │ │  │ └────────────────────────────────────────┘ │
│ │ [img] …next line…                                             │ │  │ ┌ Order Summary card ────────────────────┐ │
│ │ ┌ free-shipping bar ────────────────────────────────────────┐ │ │  │ │ Order Summary                          │ │
│ │ │[🚚] Add $27.00 for FREE shipping  ▓▓▓▓▓░░░  $123.00/$150.00│ │ │  │ │ Subtotal                     $246.00   │ │
│ │ └───────────────────────────────────────────────────────────┘ │ │  │ │ %  35% welcome offer         -$86.10   │ │
│ │                                                    Clear cart │ │  │ │   Code X is applied automatically…     │ │
│ └───────────────────────────────────────────────────────────────┘ │  │ │ 🎁 10% limited-time offer    -$15.99   │ │
│                                                                   │  │ │ Shipping        Calculated at checkout │ │
│ Frequently Bought Together                                        │  │ │ ─────────────────────────────────────  │ │
│ Complete your stack and save. These pair well with {first item}.  │  │ │ Estimated Total (CAD)       $143.91    │ │
│ ┌card ✓┐ ┌card ✓┐ ┌card +┐   (3 cols)                            │  │ │ Plus shipping, calculated at checkout… │ │
│ │badge │ │ img  │ │ img  │                                       │  │ │ [🔒 Proceed to Secure Checkout →]      │ │
│ │ name │ │ name │ │ name │                                       │  │ │ ─────────────────────────────────────  │ │
│ │$ was Save│ …                                                   │  │ │ 🛡 Why Customers Choose VYTA           │ │
│ └──────┘ └──────┘ └──────┘                                       │  │ │ ✓ 99%+ Purity Guaranteed … (5 rows)    │ │
│ [🛍 Add All Selected to Cart | Save up to 15%]  (full width)      │  │ │ [🔥 Only 3 left in stock …] (cond.)    │ │
│                                                                   │  │ │ ─────────────────────────────────────  │ │
│ You May Also Like                          View All Products →    │  │ │  📦       🚚        🧪       🛡        │ │
│ (‹) [img name/strength/$ 🛒] [ … ] [ … ] [ … ] → scroll (›)        │  │ │ Discreet Ships in Canada  100%        │ │
│                                                                   │  │ └────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘  │       3 items in your cart                 │
                                                                       └────────────────────────────────────────────┘
  Footer
```
Mobile (< lg): single column in DOM order: header (title, then trust strip wraps under it), line-items card, FBT (1 col <sm, 2 cols sm–lg), YMAL (no arrows <sm), then the right column (offer strip, summary, item count) — summary is NOT sticky and comes after the upsell blocks.

Empty state:
```
  ← Continue Shopping
  Your Cart
          ┌──────┐
          │  🛍  │   (white tile, line border)
          └──────┘
     Your cart is empty
  Looks like you haven't added any products yet.
      [🛒 Browse Products]   (ink button)
```

#### Page shell
- `<main className="min-h-screen bg-surface/40">` → bg rgba(247,250,251,0.4).
- Wrapper `pt-32 sm:pt-36 md:pt-44 pb-16 sm:pb-20 md:pb-28` → top 128 / 144 / 176px; bottom 64 / 80 / 112px (clears the fixed nav).
- Container `max-w-7xl mx-auto px-4 sm:px-8 lg:px-12` → max 1280px; gutters 16 / 32 / 48px.
- `<Navigation />` first, `<Footer />` last (Footer out of scope).

#### Header
- Wrapper `motion.div` `initial {opacity:0, y:20}` → `animate {opacity:1, y:0}` (framer default transition), `className="mb-6 sm:mb-8"` (24 / 32px).
- Back link `inline-flex items-center gap-2 text-ink-muted hover:text-ink transition-colors mb-4 text-sm` → 14px #56707F → hover #07203A, gap 8px, mb 16px; `ArrowLeft w-4 h-4` (16px) + "Continue Shopping"; href `/products`.
- Row `flex flex-wrap items-end justify-between gap-4 sm:gap-6` (16 / 24px).
- H1 `text-2xl sm:text-3xl md:text-4xl font-bold text-ink tracking-tight` → 24/30/36px, 700, #07203A, -0.025em. Text: `Your Cart` + (`items.length > 0` ? ` (${items.length})` : '') — counts **lines**.
- Subtitle (only with items) `mt-1 text-sm text-ink-muted` (4px, 14px): "You're one step closer to a better you."
- Trust strip (only with items AND `trustStripEnabled === true`; hidden while null): `flex flex-wrap items-center gap-4 sm:gap-6`; each `flex items-center gap-2`: icon `h-5 w-5 flex-shrink-0 text-ink-muted` (20px) + `div.leading-tight` with title `text-[11px] font-semibold text-ink` and note `text-[10px] text-ink-muted`. Items: Truck "Free, Fast & Discreet Shipping"/"Canada-wide"; ShieldCheck "Secure Checkout"/"SSL encrypted"; Package "Carefully Packaged"/"Your privacy matters".

#### Empty state
- `motion.div` `initial {opacity:0,y:20}` → `{1,0}`; `text-center py-12 sm:py-16 md:py-20` (48/64/80px vertical).
- Tile `w-16 sm:w-20 h-16 sm:h-20 bg-white rounded-2xl flex items-center justify-center mx-auto mb-5 sm:mb-6 border border-line` (64→80px square, radius 18px, mb 20/24px); `ShoppingBag w-8 sm:w-10 h-8 sm:h-10 text-ink-muted` (32→40px).
- H2 `text-lg sm:text-xl md:text-2xl font-bold text-ink mb-2 sm:mb-3` (18/20/24px; mb 8/12px): "Your cart is empty".
- P `text-ink-muted mb-6 sm:mb-8 text-sm`: "Looks like you haven't added any products yet."
- CTA `<Link href="/products">` `inline-flex items-center gap-2 bg-ink hover:bg-ink/90 text-white font-semibold px-5 sm:px-6 py-3 rounded-xl transition-all text-sm` (bg #07203A → rgba(7,32,58,.9), padding 12px × 20/24px, radius 14px); `ShoppingCart w-4 h-4` + "Browse Products".
- The FBT/YMAL/summary are not rendered when empty; recommendations hook skips the fetch.

#### Two-column grid
- `grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8` → gaps 16/24/32px; at lg: fluid left + fixed 352px right.
- Left `motion.div` `initial {opacity:0, x:-20}` → `{1, 0}`, `min-w-0 space-y-6 sm:space-y-8` (24/32px between blocks).
- Right `motion.div` `initial {opacity:0, x:20}` → `{1,0}`, `min-w-0`; inner `space-y-3 lg:sticky lg:top-36` (12px stack; sticky at 144px from top at lg+).

#### Line-items card
- Card `rounded-2xl border border-line bg-white p-3 sm:p-4` (radius 18px, 1px #DCE7EB, padding 12/16px). List `divide-y divide-line` (1px #DCE7EB separators).
- Row `motion.div key={item.id}` `initial {opacity:0, y:10}` → `{1,0}`, `transition {delay: index*0.05}` (50ms stagger); `flex items-start gap-3 py-3 sm:gap-4 sm:py-4` (gap 12/16px, vertical padding 12/16px).
- Image box `flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl border border-line bg-surface sm:h-20 sm:w-20` (64→80px, radius 14px, bg #F7FAFB). `<img class="h-full w-full rounded-xl object-contain p-1.5" alt={name}>` (6px padding) or `Beaker h-7 w-7 text-line` (28px, #DCE7EB).
- Body `min-w-0 flex-1`:
  - Top row `flex items-start justify-between gap-2`:
    - Left `min-w-0`: name `h3.truncate text-sm font-semibold text-ink sm:text-base` (14→16px, single-line ellipsis); meta `p.mt-0.5 text-[11px] text-ink-muted sm:text-xs` (2px; 11→12px): `{strength}` + `<span class="mx-1.5 text-line">|</span>` (6px margins, #DCE7EB) + (`packSize > 1` ? `Pack of {packSize}` : `Single vial`).
    - Right `flex items-start gap-2 sm:gap-3`: price `p.whitespace-nowrap text-sm font-bold text-ink tabular-nums sm:text-base` = `$` + (price×quantity).toFixed(2); remove button `p-1 text-ink-muted transition-colors hover:text-red-500` (4px padding; hover #EF4444), `aria-label="Remove {name} from cart"`, `Trash2 h-4 w-4`.
  - Bottom row `mt-2 flex flex-wrap items-center justify-between gap-3` (8px top, 12px gap):
    - Stock `p.inline-flex items-center gap-1.5 text-[11px] font-medium sm:text-xs` + `text-amber-700` (#B45309) when low else `text-emerald-700` (#047857); `CheckCircle2 h-3.5 w-3.5 flex-shrink-0` (14px) (same icon for both states). Copy: "Only {n} left — order soon" / "In Stock – Ships in 24h" (en dash).
    - Stepper `flex items-center gap-1.5 rounded-xl border border-line px-1 py-1` (radius 14px, 4px padding, 6px gap):
      - "−" `flex h-7 w-7 items-center justify-center rounded-lg text-ink transition-colors hover:bg-surface` (28px square, radius 8px, hover bg #F7FAFB), `aria-label="Decrease quantity of {name}"`, `Minus h-3.5 w-3.5`. Never disabled (at 1 it removes).
      - Qty `span.w-6 text-center text-sm font-semibold tabular-nums` (24px wide).
      - "+" same classes + `disabled:cursor-not-allowed disabled:opacity-40`, `disabled={quantity >= stock_quantity}`, `aria-label="Increase quantity of {name}"`, `Plus h-3.5 w-3.5`.
- Free-shipping bar after the list with `className="mt-1"` (see below).
- Clear row `mt-3 flex justify-end` (12px); button `text-xs font-medium text-ink-muted transition-colors hover:text-red-500` "Clear cart" (no confirmation).

#### Free-shipping bar (`FreeShippingProgress variant="bar"`)
- Container `flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3.5 py-3 transition-colors duration-300 mt-1` (gaps 12px/8px, padding 12px × 14px, radius 14px, colour transition 300ms). Locked: `border-teal/25 bg-teal/5`; unlocked: `border-emerald-200 bg-emerald-50`.
- Icon tile `flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg` (28px, r 8px): locked `bg-teal/15 text-teal-dark`; unlocked `bg-emerald-500 text-white`; `Truck h-3.5 w-3.5`.
- Message `p.text-xs font-semibold` locked `text-ink`: "Add ${remaining} for FREE shipping"; unlocked `text-emerald-800`: "You're eligible for FREE shipping!".
- Track group `flex min-w-[8rem] flex-1 items-center gap-2` (min 128px, wraps to its own line on narrow screens): track `h-1.5 flex-1 overflow-hidden rounded-full bg-line/70` (6px tall) `role="progressbar" aria-valuemin=0 aria-valuemax=100 aria-valuenow=round(pct) aria-label="Progress toward free shipping"`; fill `motion.div h-full rounded-full` locked `bg-gradient-to-r from-teal/70 to-teal`, unlocked `bg-emerald-500`; `initial={false}`, `animate {width: pct%}`, `transition {type:'spring', stiffness:180, damping:26}`.
- Trailing: unlocked `span.flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium text-emerald-700` with `CheckCircle2 h-3.5 w-3.5` + "Free shipping unlocked"; locked `span.whitespace-nowrap text-[11px] tabular-nums text-ink-muted` "${subtotal} / ${threshold}".

#### Frequently Bought Together
- `<section aria-labelledby="fbt-heading">`. H2 `#fbt-heading text-lg font-bold text-ink sm:text-xl` (18→20px) "Frequently Bought Together". Sub `p.mt-1 text-xs text-ink-muted sm:text-sm`: "Complete your stack and save." + (pairedWith ? " These pair well with {pairedWith}." : "").
- Grid `div ref=gridRef mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3` (16px top, 12px gap; 1 / 2 / 3 columns).
- Card `motion.div` `initial {opacity:0,y:8}` → `{1,0}`, `delay index*0.05`; `relative flex flex-col rounded-xl border p-3.5 transition-colors` (radius 14px, padding 14px) + selected `border-teal bg-teal/[0.04]` (border #438B9E, bg rgba(67,139,158,0.04)) / unselected `border-line bg-white`.
  - Badge (if `recommendation_badge`): `absolute left-3 top-3 z-[1] rounded-full bg-teal/10 px-2 py-0.5 text-[10px] font-semibold text-teal-dark` (12px inset, pill, 8×2px padding).
  - Toggle `button role="checkbox" aria-checked aria-label="{Remove|Add} {name}"` `absolute right-3 top-3 z-[1] flex h-7 w-7 items-center justify-center rounded-full border transition-colors` (28px circle) + selected `border-teal bg-teal text-white` with `Check h-4 w-4`; unselected `border-line bg-white text-ink-muted hover:border-teal/50` with `Plus h-4 w-4`.
  - Rest of card is `<Link href=productHref class="group flex flex-1 flex-col">`:
    - Image wrap `mx-auto mb-3 flex h-28 w-full items-center justify-center pt-4` (112px tall, 16px top padding, 12px bottom margin); `img.h-full max-w-[60%] object-contain transition-transform duration-200 group-hover:scale-105` or `Beaker h-10 w-10 text-line`.
    - Name `h3.text-sm font-semibold text-ink group-hover:text-teal-dark`.
    - Blurb (description_short, else first 70 chars of description + "…") `p.mt-1 line-clamp-2 text-xs leading-snug text-ink-muted`.
    - Price row `mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1`: price `text-sm font-bold text-ink tabular-nums` "$X.XX"; compare-at (if) `text-xs text-ink-muted line-through tabular-nums`; saving pill (if >0) `rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700` "Save {n}%".
    - Pack label `p.mt-1 text-[11px] text-ink-muted` (e.g. "Pack of 3" or operator label).
- Add button `mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-ink/15 bg-white px-4 py-3.5 text-sm font-semibold text-ink transition-colors hover:border-ink/40 hover:bg-surface disabled:opacity-40` (padding 14px × 16px, radius 14px), `disabled={selected.length === 0}`. Content: `ShoppingBag h-4 w-4` + "Add {All | n | ''} Selected to Cart" (All when every buyable card is selected; whitespace collapses) + if bestSaving>0: `<span class="text-line">|</span>` + `<span class="text-teal-dark">Save up to {n}%</span>`.
- Fly-to-cart origin for FBT adds = centre of the whole grid.

#### You May Also Like
- `<section aria-labelledby="similar-heading">`. Header `flex items-center justify-between gap-3`: H2 `#similar-heading text-lg font-bold text-ink sm:text-xl` "You May Also Like"; link `/products` `inline-flex flex-shrink-0 items-center gap-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink sm:text-sm` "View All Products" + `ArrowRight h-3.5 w-3.5`.
- Wrapper `relative mt-4`.
- Arrow buttons (hidden < sm): `absolute -left-2 | -right-2 top-1/2 z-[1] hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-white text-ink shadow-sm transition-opacity hover:bg-surface disabled:opacity-30 sm:flex` (32px circle overhanging 8px; disabled 30% opacity at ends); `ChevronLeft/ChevronRight h-4 w-4`; aria-labels "Scroll suggestions left" / "Scroll suggestions right".
- Rail `flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden` (12px gap, 4px bottom padding, hidden scrollbar).
- Card `flex w-[13rem] flex-shrink-0 snap-start items-center gap-3 rounded-xl border border-line bg-white p-3 transition-colors hover:border-teal/40` (208px wide, 12px padding, radius 14px).
  - Link `group flex min-w-0 flex-1 items-center gap-3`: image box `flex h-12 w-10 flex-shrink-0 items-center justify-center` (40×48px) with `img.h-full w-full object-contain transition-transform duration-200 group-hover:scale-105` or `Beaker h-6 w-6 text-line`; text `min-w-0`: name `p.truncate text-xs font-semibold text-ink group-hover:text-teal-dark`; strength (if) `p.truncate text-[11px] text-ink-muted`; price `p.mt-0.5 text-xs font-bold text-ink tabular-nums` (default pack price).
  - Add button `flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-ink transition-all hover:border-teal/50 hover:text-teal-dark active:scale-90` (32px, r 8px), `aria-label="Add {name} to cart"`, `ShoppingCart h-3.5 w-3.5`. Fly origin = this button.

#### Limited Time Offer strip (top of right column)
- `motion.div` `initial {opacity:0, y:-6}` → `{1,0}`; `rounded-xl border px-4 py-3` (radius 14px, 12px × 16px) + earned `border-emerald-200 bg-emerald-50` / not `border-teal/25 bg-teal/5`.
- Inner `flex items-start gap-3`; icon tile `flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg` (32px, r 8px) earned `bg-emerald-500 text-white` / not `bg-teal/15 text-teal-dark`; `Gift h-4 w-4`.
- Text `min-w-0 flex-1`: head row `flex flex-wrap items-center justify-between gap-2`: title `p.text-sm font-semibold` earned `text-emerald-800` "{percent}% OFF applied" / not `text-ink` "Limited Time Offer"; clock (if) `span.font-mono text-xs tabular-nums` earned `text-emerald-700` / not `text-ink-muted`, `aria-hidden="true"`, "HH:MM:SS".
- Body `p.mt-0.5 text-xs leading-snug` earned `text-emerald-700`: "Your **{percent}% discount** is in the total below." (bold span `font-semibold`); not earned `text-ink-muted`: "Add **{itemsAway} more item(s)** and get **{percent}% OFF** your order!" (bold spans `font-semibold text-ink`; "item" singular when itemsAway === 1).
- SR-only (when clock): "This offer ends {new Date(endsAt).toLocaleString()}."

#### Order Summary card
- `rounded-2xl border border-line bg-white p-4 sm:p-5` (radius 18px, padding 16/20px).
- H2 `mb-4 text-base font-semibold text-ink sm:text-lg` (16→18px, mb 16px) "Order Summary".
- Rows container `space-y-2.5` (10px):
  1. Subtotal `flex justify-between text-xs text-ink-muted sm:text-sm`: "Subtotal" | `span.font-medium text-ink tabular-nums` "$X.XX".
  2. (landingWins) `div.text-xs sm:text-sm` → `flex justify-between`: `span.inline-flex items-center gap-1.5 text-emerald-700` with `BadgePercent h-3.5 w-3.5` + "{p}% first-order offer|welcome offer" | `span.font-semibold text-emerald-700 tabular-nums` "-$X.XX"; fine print `p.mt-0.5 text-[10px] text-ink-muted sm:text-xs` "Code {code} is applied automatically at checkout[ · excludes {exclusions}]."
  3. (adDiscountEligible && adSaving>0) same row style, `BadgePercent` + "{adDiscount.percent}% first-order discount" | "-$X.XX".
  4. (offerSaving>0) same style, `Gift h-3.5 w-3.5` + "{cartOffer.percent}% limited-time offer" | "-$X.XX".
  5. Shipping `flex justify-between text-xs text-ink-muted sm:text-sm`: "Shipping" | `span.font-medium text-ink` "Calculated at checkout".
  6. Total block `border-t border-line pt-3` (12px): `flex items-baseline justify-between`: `span.text-sm font-semibold text-ink sm:text-base` "Estimated Total " + `span.text-xs font-normal text-ink-muted` "(CAD)" | `span.text-lg font-bold text-ink tabular-nums sm:text-xl` (18→20px) "$X.XX"; note `p.mt-1.5 text-[10px] text-ink-muted sm:text-xs` (6px) "Plus shipping, calculated at checkout once your address is entered."
- CTA `<Link href="/checkout">` `group mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-ink py-3.5 text-sm font-semibold text-white transition-all hover:bg-ink/90` (mt 16px, 14px vertical padding, radius 14px, #07203A → 90%): `Lock h-4 w-4` + "Proceed to Secure Checkout" + `ArrowRight h-4 w-4 transition-transform group-hover:translate-x-0.5` (nudges 2px on hover).
- Why-us block `mt-4 border-t border-line pt-4`: title `p.mb-2.5 flex items-center gap-2 text-sm font-semibold text-ink` (mb 10px) with `ShieldCheck h-4 w-4 text-ink-muted` + "Why Customers Choose {config.store_name}"; `ul.space-y-1.5` (6px) of `li.flex items-start gap-2 text-xs text-ink-muted` each `CheckCircle2 mt-px h-3.5 w-3.5 flex-shrink-0 text-emerald-600` + claim. Claims (in order): "99%+ Purity Guaranteed", "Third-Party Tested (COA Available)", "Free, Fast & Discreet Shipping", "Proudly Canadian", "Secure & Encrypted Checkout". (Always shown — NOT gated by `cart_trust_strip_enabled`.)
- Scarcity (if `scarce`) `mt-4 flex items-start gap-2.5 rounded-xl border border-red-100 bg-red-50 px-3.5 py-3` (r 14px, padding 12×14px): `Flame mt-0.5 h-4 w-4 flex-shrink-0 text-red-500`; `p.text-sm font-semibold text-red-700` "Only {lowestStock} left in stock"; `p.text-xs text-red-600/90` "Order now to avoid missing out."
- Icon grid `mt-4 grid grid-cols-4 gap-2 border-t border-line pt-4`: each `div.text-center` with icon `mx-auto mb-1 h-4 w-4 text-ink-muted` + `span.text-[9px] leading-tight text-ink-muted` label: "Discreet Packaging", "Ships in 24 Hours", "Canada Wide", "100% Secure". (Always shown.)
- Under card: `p.text-center text-[11px] text-ink-muted` "{totalItems} item(s) in your cart" ("item" when 1) — counts units.

#### Interaction / state summary
- Loading: no skeletons anywhere. Cart lines render synchronously from localStorage (lazy init) — on SSR the page renders the empty state then hydrates (the page is a client component; see Unverified). Trust strip waits for its settings fetch (null = hidden). Promo rows/strip/bar appear once `/api/admin/settings` resolves. Suggestions appear when the recommendations fetch resolves (no placeholder).
- Errors: every fetch failure degrades to "block hidden"; no error copy.
- Disabled: "+" at cap (40% opacity, not-allowed cursor); FBT add button when nothing selected (40%); YMAL arrows at rail ends (30%).
- Focus: no custom focus styles on any cart control (browser default outlines). 
- Hover: listed per element above (`hover:text-red-500` on trash/Clear cart; `hover:bg-surface` on steppers; `hover:bg-ink/90` on CTAs; image `scale-105` 200ms on suggestion cards; teal borders on suggestion cards/buttons).
- Animations: page entrance (header y:20→0, left x:-20→0, right x:20→0, all opacity 0→1 with framer default timing); line rows staggered 50ms; FBT cards staggered 50ms (y:8→0); offer strip y:-6→0; progress fill spring (stiffness 180, damping 26); nav icon bump scale [1,1.3,1] 0.35s easeOut; flyer 0.8s easeInOut arc; toasts 0.2s. No exit animations when removing a line (no AnimatePresence around lines — the row just disappears).
- Clock re-renders LimitedTimeOffer every 1s.

---

### Cart — admin/config inputs it reads

`site_settings` (singleton row, read via `GET /api/admin/settings` unless noted):
| column | DB default (migration) | effect on cart |
|---|---|---|
| `puramass_shipping_rates_enabled` | false | free-shipping bar can only be active when true |
| `puramass_free_shipping_enabled` | false | free-shipping bar on/off (with the above + threshold>0) |
| `puramass_free_shipping_threshold` | 0 | CAD subtotal target for the bar |
| `ad_discount_enabled` | true (code fallback when absent: off) | paid-ads welcome discount line |
| `ad_discount_percent` | 25 | its percent (clamped 0–100; API writes cap 99) |
| `cart_offer_enabled` | false | limited-time offer strip + summary line |
| `cart_offer_min_items` | 2 | units needed (clamped 1–99) |
| `cart_offer_percent` | 10 | percent off (capped 99; 0 forces off) |
| `cart_offer_ends_at` | null | countdown + hard expiry; null = no clock, never expires |
| `cart_fbt_enabled` | true | FBT block (read in `/api/products/recommendations`) |
| `cart_similar_enabled` | true | You May Also Like block (read in `/api/products/recommendations`) |
| `cart_trust_strip_enabled` | true | header trust strip (cart page's own fetch) |
| `store_name` | code default 'VYTA' | "Why Customers Choose {store_name}" (via `/api/site-config`) |

Other tables read for the cart surface:
- `product_recommendations` (`product_id`, `recommended_product_id`, `sort_order`, `badge`, `enabled`) — FBT pairings (admin `/admin/cart-upsells`).
- `products` (`*`, `active = true`; uses `id, name, category, featured, stock_quantity, price, vial_price, vials_per_box, pack_sizes, pack_options, strength, image_url, url_slug, slug, description_short, description, puramass_sku, puramass_sku_vial`).
- `order_items` (`order_id, product_id, quantity, created_at`), `puramass_orders` (`id, items, status, created_at`; `customer_id`, `status` for first-order check).
- `pricelists` (`is_active`), `pricelist_items` (`pricelist_id, product_id, price`), `customer_price_overrides` (`customer_id, product_id, override_price`).
- `customers.has_completed_first_order`.
- `landing_pages` (by `slug`, `active`, `discount_code_id`), `discount_codes` (`code, discount_type, discount_value, active, starts_at, expires_at, first_order_only, excluded_product_ids`).
- Writes: `customer_activity` (cart adds).

Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser client: session token lookup), `SUPABASE_SERVICE_ROLE_KEY` (all API routes above).

Code flags: `siteConfig.ecommerceEnabled` (`lib/config.ts`, `true`) — false hides nav cart icons and makes `/cart` redirect to `/products` (renders null). `siteConfig.authEnabled` affects only the nav.

Cookies read: `vyta_lp`, `aminocan_attr`, `aminocan_attr_last`, `aminocan_vid` (server), consent cookie (server, activity API). Analytics mode from SiteTracking (GA4/GTM/Klaviyo config — documented elsewhere).

---

### Cart — unverified / porting notes

Brand-specific hard-codes to replace on a sibling site:
- localStorage key `northern_peptides_cart` (legacy brand name), sessionStorage `aminocan.freeShippingToast`, cookies `aminocan_*`, `vyta_lp`.
- Copy: "Canada-wide", "Canada Wide", "Proudly Canadian", "(CAD)", "Ships in 24h"/"Ships in 24 Hours", "99%+ Purity Guaranteed", "Third-Party Tested (COA Available)", "You're one step closer to a better you.", "Complete your stack and save.", peptide-specific "Single vial"/"Pack of N", Beaker placeholder icon, "bacteriostatic water" exclusion phrasing.
- Currency is hard-coded CAD with `$` + `toFixed(2)` (no Intl formatting).
- Hosted checkout ("Stealth Health"/"puramass") naming in settings columns.

Odd behaviours / probable bugs (verified from code, runtime effect not executed):
- `view_cart` never fires: it is tied to `CartContext.isOpen`, a leftover drawer flag nothing sets to true (Navigation's `isOpen` is its own local mobile-menu state). Klaviyo "Viewed Cart" is therefore dead too. If porting, fire `view_cart` on `/cart` mount instead (decision for the porter).
- `addItem` returns a flag set *inside* the `setItems` updater. That is only reliable when React runs the updater eagerly (no other update pending on the provider). When `addItem` is called several times in one event (PDP/modal `qty` loop, FBT "Add selected" over several products), later calls may return `false` even though the updater later adds the item — which would skip `bumpKey`/`add_to_cart`/activity for those units and, in FBT, could produce a spurious "… couldn't be added — out of stock." toast. **Unverified at runtime**; a port should compute `added` from the current state outside the updater (e.g. via a ref mirror of items).
- `+`/`−` quantity changes fire no analytics; `clearCart` fires no `remove_from_cart`.
- Line `stock_quantity` is a snapshot from add time; never refreshed against live stock on the cart. A legacy line with `stock_quantity: 0` would show "Only 0 left — order soon" (the summary scarcity box requires > 0).
- Meta line renders a leading "| " when `strength` is empty.
- H1 count is number of lines; footer count and nav badge are units.
- The cart page performs its own `/api/admin/settings` fetch for `cart_trust_strip_enabled` in addition to PromosProvider's identical fetch (two requests).
- `cart_trust_strip_enabled` only hides the header strip; the summary's "Why Customers Choose" list and 4-icon grid are always shown.
- Free-shipping progress uses the pre-discount subtotal; whether the server's free-shipping check uses pre- or post-discount subtotal is checkout scope (unverified here).
- `normalizeCartItem` does not merge two stored lines that normalise to the same id.
- Root layout is server-rendered; `/cart` is a client component whose `items` lazy-init reads localStorage — on the server `items=[]` so SSR HTML is the empty state; the client's first render already has items (possible hydration mismatch warning). Not observed at runtime.
- framer-motion default transitions (no `transition` prop on page entrance / strip / cards) are library defaults of framer-motion v12 (spring for x/y, short tween for opacity) — exact numbers not pinned in code; node_modules not installed to confirm.
- `components/cart/ReferralCodeField.tsx` is dead code (removed from the cart by commit "drop cart referral box").
- A legacy parallel app exists under `src/` (`src/lib/cart.tsx`, key `aminocan_cart`, `src/app/checkout`) — not used by the App Router `app/` tree; ignore when porting.

Outside this section's scope (documented elsewhere): `/checkout` page and `begin_checkout`, `/api/checkout/puramass` money logic and `combineDiscountPercents` application, Footer, AnnouncementBar (`--announcement-h`), PDP / purchase-modal add-to-cart UIs, admin screens (`/admin/cart-upsells`, settings, landing pages), SiteTracking/consent.

---

## Part 2 — Checkout UI and post-payment pages

Scope: everything the browser runs between landing on `/checkout` and leaving for the hosted payment page, plus `/order/success`, `/order/track`, `/shipping-address/[token]` and (skimmed) `/account/orders`.
Source repo: `thepuragroup-droid/vyta-rtl-x` (Next.js 15 App Router, React client components, Tailwind 3.4, framer-motion, lucide-react, Supabase JS).

The payment processor is called "Stealth Health" in code comments and server logs. Internal identifiers still use the older name `puramass`. **No customer-facing copy names the partner.** The UI always says "our secure checkout partner" or "secure checkout page".

Token resolution used throughout (from `tailwind.config.ts`):

| token | hex | token | hex |
|---|---|---|---|
| `ink` / `navy` | `#07203A` | `teal` / `teal-500` | `#438B9E` |
| `ink-muted` | `#56707F` | `teal-dark` / `teal-600` / `vital` | `#1B5D83` |
| `ink-light` | `#6E8898` | `teal-light` / `teal-400` / `aqua` | `#6EB2B8` |
| `surface` / `cloud` | `#F7FAFB` | `teal-50` | `#F1F8F9` |
| `surface-2` | `#EDF3F5` | `teal-100` | `#E1EFF1` |
| `line` | `#DCE7EB` | `teal-200` | `#C4DFE3` |
| `ocean` / `teal-700` | `#0E3F5F` | `teal-300` | `#9CCBD1` |
| `mist` | `#BBD6D6` | `teal-900` | `#05182B` |

Radii: `rounded` = 0.25rem (4px, stock), `rounded-lg` = 0.5rem (8px, stock, **not** overridden), `rounded-xl` = 0.875rem (14px), `rounded-2xl` = 1.125rem (18px), `rounded-3xl` = 1.5rem (24px), `rounded-full` = 9999px.
Shadows: `shadow-sm` = `0 1px 2px 0 rgb(0 0 0/0.05)`; `shadow-md` = `0 4px 6px -1px rgb(0 0 0/0.1), 0 2px 4px -2px rgb(0 0 0/0.1)`; `shadow-lg` = `0 10px 15px -3px rgb(0 0 0/0.1), 0 4px 6px -4px rgb(0 0 0/0.1)`. The custom `shadow-card` / `shadow-focus` exist but are **not used** in the checkout.
Fonts: `font-sans` = `var(--font-inter), Inter, -apple-system, …`. `font-mono` = stock Tailwind mono stack.
Stock colours used: emerald-50 `#ECFDF5`, -100 `#D1FAE5`, -200 `#A7F3D0`, -300 `#6EE7B7`, -500 `#10B981`, -600 `#059669`, -700 `#047857`, -800 `#065F46`; amber-50 `#FFFBEB`, -100 `#FEF3C7`, -200 `#FDE68A`, -300 `#FCD34D`, -500 `#F59E0B`, -600 `#D97706`, -700 `#B45309`, -800 `#92400E`, -900 `#78350F`; red-50 `#FEF2F2`, -100 `#FEE2E2`, -200 `#FECACA`, -600 `#DC2626`, -700 `#B91C1C`, -800 `#991B1B`; purple-50 `#FAF5FF`, -100 `#F3E8FF`, -200 `#E9D5FF`, -600 `#9333EA`, -900 `#581C87`; yellow-100 `#FEF9C3`, -600 `#CA8A04`, -700 `#A16207`; cyan-100 `#CFFAFE`, -600 `#0891B2`, -700 `#0E7490`; blue-100 `#DBEAFE`, -600 `#2563EB`, -700 `#1D4ED8`; slate-100 `#F1F5F9`, -600 `#475569`.
Opacity modifiers resolve as rgba of the token, e.g. `bg-teal/5` = `rgba(67,139,158,0.05)`, `border-teal/30` = `rgba(67,139,158,0.30)`, `ring-teal/40` = `rgba(67,139,158,0.40)`, `bg-line/40` = `rgba(220,231,235,0.40)`, `bg-ink/90` = `rgba(7,32,58,0.90)`, `shadow-ink/15` = shadow colour `rgba(7,32,58,0.15)`.
Type scale (stock): `text-[9px]`, `text-[10px]`, `text-[11px]`, `text-xs` 12px/16px, `text-sm` 14px/20px, `text-base` 16px/24px, `text-lg` 18px/28px, `text-xl` 20px/28px, `text-2xl` 24px/32px, `text-3xl` 30px/36px. Letter spacing: `tracking-tight` -0.025em, `tracking-wide` 0.025em, `tracking-wider` 0.05em, `tracking-[0.15em]`. `leading-none` 1, `leading-snug` 1.375, `leading-relaxed` 1.625.

---

### Checkout — components

#### `app/checkout/page.tsx` — `CheckoutPage` (default export)
- **Client** (`"use client"`). Route: `/checkout`.
- Renders `<Suspense fallback={<CheckoutLoadingScreen/>}><CheckoutRouter/></Suspense>`.
- No `metadata` export. No route-level `layout.tsx` in `app/checkout/`. The global root layout applies, with these effects on this page:
  - The page shows **no** `Navigation` or `Footer`. It draws its own header.
  - Global siblings still render: `AnnouncementBar`, which is hidden only on `/admin`, `/warehouse` and `/affiliate`, so it **does** show here; `ChatBubble`; `AgeVerification`; `SiteTracking`; `CustomerJourneyTracker`.
  - `FreeShippingToast` is silenced on `/checkout` because `/checkout` is in its `SILENT_PATHS = ["/admin","/warehouse","/affiliate","/cart","/checkout"]`.
  - `AuthGuard` treats `/checkout` as public. Only paths under the `/account` prefix are private.

#### `CheckoutLoadingScreen` (in `page.tsx`)
- No props or state. A branded skeleton shown while the settings load.
- Markup and classes:
  - Root: `min-h-screen bg-white`.
  - Header bar: `bg-white border-b border-line` → inner `max-w-6xl mx-auto px-5 sm:px-8 py-6` (max 1152px; side padding 20px, 32px at ≥640px; vertical 24px) → `flex items-center justify-between`.
    - Left side: a logo tile `relative w-10 h-10 bg-ink rounded-xl flex items-center justify-center` (40×40, `#07203A`, 14px radius) holding a lucide `Beaker` `w-5 h-5 text-white animate-pulse`. **This differs from the loaded header, which uses an `<img>`.**
    - Text column `flex flex-col`:
      - "VYTA": `text-lg font-bold text-ink tracking-tight leading-none`.
      - "Secure Checkout": `text-[10px] text-teal-dark tracking-[0.15em] font-medium uppercase mt-0.5`.
    - Right side: pill `flex items-center gap-2 px-4 py-2 bg-surface rounded-full border border-line` containing `Loader2 w-4 h-4 text-teal-dark animate-spin` and the text "Loading checkout…" (`text-sm font-medium text-ink-muted`).
  - Body: `px-5 sm:px-8 py-8 md:py-12` → `max-w-6xl mx-auto`:
    - Banner skeleton: `h-16 rounded-2xl border border-line bg-surface/60 animate-pulse mb-6` (64px tall).
    - Grid: `grid grid-cols-1 lg:grid-cols-3 gap-6`, with 3 cards. Each card is `rounded-2xl border border-line bg-white p-5` with inline `animationDelay: col*120ms`.
    - Inside each card:
      - Head row `flex items-center gap-3 mb-4`: a 40px `h-10 w-10 rounded-xl bg-line/40 animate-pulse` tile, then `flex-1 space-y-2` with two bars: `h-3.5 w-1/2 rounded bg-line/40 animate-pulse` and `h-2.5 w-3/4 rounded bg-line/30 animate-pulse`.
      - Then `space-y-3` with 3 rows of `h-11 rounded-lg bg-line/30 animate-pulse` (44px).

#### `CheckoutRouter` (in `page.tsx`)
- **Client**. Loads the public settings, then mounts `PuramassCheckoutContent`.
- State (all `useState`):

| name | initial |
|---|---|
| `loaded` | `false` |
| `guestCheckoutEnabled` | `true` |
| `shippingRatesEnabled` | `false` |
| `addonsEnabled` | `true` |
| `verifyNoticeEnabled` | `true` |
| `flatShipping` | `DEFAULT_FLAT_SHIPPING` (= `35`, from `lib/payments/puramass-settings.ts`) |
| `freeShipping` | `{ active: false, threshold: 0 }` |

- Effect (mount once):
  1. Calls `GET /api/admin/settings` with `{ cache: "no-store" }`. The route is public and unauthenticated.
  2. Reads `json.settings ?? {}` and sets:
     - `guestCheckoutEnabled = s.guest_checkout_enabled ?? true`
     - `shippingRatesEnabled = !!s.puramass_shipping_rates_enabled`
     - `addonsEnabled = s.checkout_addons_enabled ?? true`
     - `verifyNoticeEnabled = s.checkout_verify_notice_enabled ?? true`
     - `flatShipping = Number(s.puramass_flat_shipping ?? 35)`, kept only if finite and `>= 0`, else `35`. A saved `0` is honoured, meaning free flat shipping.
     - `freeShipping = { active: !!s.puramass_free_shipping_active, threshold: Number(s.puramass_free_shipping_threshold) || 0 }`
  3. Any exception is swallowed and the defaults stay. `finally` sets `loaded = true`, guarded by a `cancelled` flag.
- Render: while `!loaded` it returns `<CheckoutLoadingScreen/>`. Otherwise it returns `<PuramassCheckoutContent guestCheckoutEnabled shippingRatesEnabled addonsEnabled verifyNoticeEnabled flatShipping freeShippingActive={freeShipping.active} freeShippingThreshold={freeShipping.threshold}/>`.
- Server-side shaping of these flags (`app/api/admin/settings/route.ts` `shape()` and `lib/payments/puramass-settings.ts` `shapeHostedShippingSettings`):
  - `puramass_free_shipping_active` = `ratesEnabled && puramass_free_shipping_enabled && threshold > 0`. **Free shipping can never be active while live rates are off.**
  - `puramass_flat_shipping` is the stored value if it is finite and `>= 0`, else 35.

#### `app/checkout/PuramassCheckoutContent.tsx` — `PuramassCheckoutContent` (default export)
- **Client**. The whole checkout screen.
- **Props:**

| prop | type | default | meaning |
|---|---|---|---|
| `guestCheckoutEnabled` | `boolean` | — | When `false` and not signed in, the "Account required" gate is shown |
| `shippingRatesEnabled` | `boolean` | — | Show the ship-to form and the live courier picker. When `false`, the flat fee applies and the partner collects the address |
| `addonsEnabled` | `boolean?` | `true` | Show column 2, "Complete your order" |
| `verifyNoticeEnabled` | `boolean?` | `true` | Show the "A few quick questions first." notice under the CTA |
| `flatShipping` | `number` | — | Flat fee (CAD) used when rates are off or unavailable |
| `freeShippingActive` | `boolean` | — | Free-shipping promo is live |
| `freeShippingThreshold` | `number` | — | Goods subtotal (CAD) that unlocks it |

- **Contexts consumed:**
  - `useCart()` → `{ items, totalPrice }`.
  - `useCustomer()` → `{ customer }`. **`isLoading` is not read.**
  - `usePurchaseModal()` → `{ openPurchaseModal }`.
  - `usePromos()` → `{ adDiscount, adDiscountEligible, adDiscountOn, cartOffer, landingOffer }`.
- **Module constants:**
  - `emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/`
  - `EMPTY_SHIPPING = { country:"CA", address:"", address2:"", city:"", state:"", zip:"", phone:"" }` (type `ShippingForm`)
  - `canQuote(f) = !!(f.country && f.address.trim() && f.city.trim() && f.zip.trim())`. The state is **not** required to quote.
  - `INPUT_CLASS = "w-full px-4 py-2.5 bg-surface rounded-lg border border-line text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-transparent transition"`. This resolves to: padding 16px/10px; bg `#F7FAFB`; radius 8px; 1px border `#DCE7EB`; 14px text `#07203A`; placeholder `#56707F`; on focus, a 2px ring `rgba(67,139,158,.4)` with a transparent border.
  - `isBacName(name) = /bacteriostatic|bac[\s-]?water/i.test(name||"")`
  - `containerVariants = { hidden:{opacity:0}, show:{opacity:1, transition:{staggerChildren:0.08, delayChildren:0.04}} }`
  - `itemVariants = { hidden:{opacity:0,y:16}, show:{opacity:1,y:0, transition:{duration:0.45, ease:[0.16,1,0.3,1]}} }`
- **State (every `useState`, in declaration order):**

| name | type | initial |
|---|---|---|
| `email` | string | `""` |
| `phoneTouched` | boolean | `false` |
| `firstName` | string | `""` |
| `lastName` | string | `""` |
| `submitting` | boolean | `false` |
| `error` | string \| null | `null` |
| `unmapped` | string[] | `[]` |
| `referralCode` | string | `""` |
| `referralStatus` | `"idle"\|"checking"\|"match"\|"no-match"\|"error"` | `"idle"` |
| `addons` | `AddonProduct[]` | `[]` |
| `codeInput` | string | `""` |
| `appliedCode` | `AppliedDiscountCode \| null` | `null` |
| `codeError` | string \| null | `null` |
| `codeChecking` | boolean | `false` |
| `landingTriedFor` | number \| null | `null` |
| `landingDeclined` | boolean | `false` |
| `shipping` | `ShippingForm` | `EMPTY_SHIPPING` |
| `addressErrors` | `ShippingAddressErrors` (`Partial<Record<'full_name'\|'phone'\|'address'\|'address2'\|'city'\|'state'\|'zip'\|'country', string>>`) | `{}` |
| `rates` | `HostedShippingRate[]` | `[]` |
| `ratesLive` | boolean | `false` |
| `ratesNote` | string \| null | `null` |
| `ratesLoading` | boolean | `false` |
| `courierId` | string \| null | `null` |
| `addonsLoading` | boolean | `true` |
| `linkCodeTried` | boolean | `false` (declared mid-file, beside its effect) |

- **Types:**
  - `AppliedDiscountCode = { code: string; discountType: "percent"|"fixed"; discountValue: number; description: string; excludedProductIds: string[]; firstOrderOnly: boolean; fromLanding: boolean }`
  - `AddonProduct = { id, name, strength: string|null, price: number, vial_price: number|null, vials_per_box: number|null, pack_sizes: number[]|null, pack_options: unknown, stock_quantity: number, image_url: string|null, box_image_url: string|null, allowedUnits: ('vial'|'case')[], fromPrice: number }`
  - `HostedShippingRate` (from `lib/payments/puramass-shipping.ts`) = `{ courier_id: string; courier_name: string; service_name: string; min_delivery_time: number; max_delivery_time: number; total_charge: number /* CAD, processing fee folded in */; currency: string }`
- **Effects:**
  1. **Referral prefill** (on mount): `setReferralCode(readReferralCode())`. `readReferralCode()` finds the cookie row starting `ref_code=` in `document.cookie`, `decodeURIComponent`s and trims it (on decode failure it uses the raw value trimmed), and returns `""` if absent. The cookie is set by middleware from `?ref=`, lasts 30 days, holds at most 64 chars, and the param is stripped from the URL.
  2. **Referral check** `[referralCode]`:
     - If `referralCode.trim()` is empty → status `"idle"`.
     - Otherwise status becomes `"checking"`, then after a **400 ms debounce** it sends `POST /api/checkout/referral-code` with headers `{ "Content-Type": "application/json" }` and body `{ code }` (trimmed).
     - If `!res.ok` → `"error"`. Otherwise `json.match ? "match" : "no-match"`. An exception → `"error"`.
     - Cleanup cancels the request and clears the timer.
     - Server details: 15 requests/min/IP. A 429 returns `{error:'Too many attempts. Please wait a moment.'}`, which the client shows as `"error"`. An empty code or one longer than 64 chars returns `{match:false}`.
  3. **Link discount code** `[totalPrice, linkCodeTried]`:
     - Runs once, after `totalPrice > 0`, and sets `linkCodeTried = true`.
     - Reads `?discount=` or, failing that, `?code=` from `window.location.search`.
     - If one is present: `setCodeInput(raw)` (as typed, not upper-cased here) and `applyDiscountCode(raw)`.
  4. **Landing-offer auto-apply** (deps: `linkCodeTried, totalPrice, landingOffer.active, landingOffer.code, landingDeclined, appliedCode, codeInput, codeChecking, landingTriedFor`).
     - It returns early unless **all** of these hold:
       - `linkCodeTried`, `totalPrice > 0` and `!codeChecking`;
       - `landingOffer.active && landingOffer.code && !landingDeclined`;
       - `!appliedCode && !codeInput.trim()`;
       - `landingTriedFor !== totalPrice`.
     - When it proceeds, it sets `landingTriedFor = totalPrice` and calls `applyDiscountCode(landingOffer.code, { fromLanding: true })`.
     - A miss is retried only when `totalPrice` changes.
  5. **Add-ons load** `[addonsEnabled]`:
     - If `!addonsEnabled` → `addonsLoading = false` and return.
     - Otherwise it calls `supabase.auth.getSession()` for the token, then `GET /api/products?addon=1` with `{ cache:"no-store", headers: token ? {Authorization:"Bearer "+token} : {} }`.
     - On `!res.ok` it returns silently. `finally` still sets `addonsLoading = false`, so the "empty" state shows.
     - Mapping per product `p`:
       - `boxOk` = `p.puramass_sku` is a string and matches `/-(case|10-pack)$/` after trim+lowercase.
       - `vialOk` = `p.puramass_sku_vial` is a string that ends with `-vial` (lowercased).
       - `allowedUnits = [vialOk && "vial", boxOk && "case"]`, without the falsy entries.
       - `packs = packOptionsFor(p).filter(o => o.size === 1 ? vialOk : boxOk)`.
       - `fromPrice = packs.length ? min(packs.map(o=>o.price)) : vialPriceFor(p)`.
     - Products with no allowed units are dropped. Errors are swallowed and the upsell is hidden.
     - Server: `products` where `active=true AND is_checkout_addon=true`, ordered by name, with customer-specific prices resolved.
  6. **Customer prefill** `[customer]`:
     - When `customer` exists, each value is filled **only if the field is currently empty**: `email ← customer.email`, `firstName ← customer.first_name`, `lastName ← customer.last_name`, `shipping.phone ← customer.phone`.
  7. **Courier quote** (deps: `shippingRatesEnabled, addressReady, shipping.country, shipping.zip, shipping.city, shipping.state, totalVials`):
     - It is a no-op unless `shippingRatesEnabled`.
     - If `!addressReady` → `rates=[]`, `ratesLive=false`, `courierId=null`.
     - Otherwise `ratesLoading=true`, then after a **600 ms debounce** it sends `POST /api/checkout/puramass/rates` with body `{ vials: totalVials, destination: { country, postal_code: zip.trim(), city: city.trim(), state: state.trim() } }`.
     - On `!res.ok || !json.live` it logs `console.error("[checkout] shipping rates fallback", {status,error,note,debug})`. The code labels this `TEMP DEBUG`.
     - On `!res.ok` → `rates=[]`, `ratesLive=false`, `ratesNote=null`.
     - Otherwise:
       - `rates = Array.isArray(json.rates) ? json.rates : []`
       - `ratesLive = !!json.live`
       - `ratesNote = json.note ?? null`
       - `courierId` is kept only if it is still in the new list, else `null`.
     - An exception gets the same reset plus `console.error("[checkout] shipping rates request failed", err)`.
     - `finally` sets `ratesLoading = false` (if not cancelled). Cleanup cancels, clears the timer **and sets `ratesLoading=false`**.
     - **Note:** `shipping.address` (the street) is **not** a dependency. Editing only the street does not re-quote, although `addressReady` flipping does.
- **Derived values (computed every render):**
  - `emailValid = emailRegex.test(email.trim())`
  - `accountRequired = !guestCheckoutEnabled && !customer`
  - `totalVials = Σ it.quantity * it.packSize`
  - `regions = regionsFor(shipping.country)`. CA → 13 provinces, US → 52 states plus DC and PR, otherwise `null`.
  - `addressReady = canQuote(shipping)`
  - `selectedRate = ratesLive ? (rates.find(r => r.courier_id === courierId) ?? null) : (rates[0] ?? null)`
  - `freeShipping = freeShippingActive && freeShippingThreshold > 0 && totalPrice >= freeShippingThreshold`
  - The totals values are listed in "Totals as displayed" below.
  - `deliveryChosen = !shippingRatesEnabled || !ratesLive || !!selectedRate`
  - `namesValid = firstName.trim() !== "" && lastName.trim() !== ""`
  - `phoneValid = isValidPhone(shipping.phone)`
  - `shippingPending = shippingRatesEnabled && (!addressReady || ratesLoading || (ratesLive && !selectedRate))`
  - `canSubmit = emailValid && namesValid && phoneValid && (!shippingRatesEnabled || addressReady) && !ratesLoading && deliveryChosen`
  - `bacWater = addons.filter(isBac)`, `otherAddons = addons.filter(!isBac)`
  - `peptideVials = Σ over non-BAC cart lines of quantity*packSize`
- **Handlers:**
  - `setShip(patch)` merges into `shipping` and **clears all `addressErrors`**. This applies to the phone too.
  - `applyDiscountCode(raw, {fromLanding?})`. See the data-access section below.
  - `openAddon(p)` calls `openPurchaseModal({ id, name, strength, price, vial_price, vials_per_box, pack_sizes, pack_options, stock_quantity, image_url, box_image_url, allowedUnits, ignoreStock: true })`. That opens the global vial/pack picker modal (`contexts/PurchaseModalContext.tsx`):
    - It logs a `trackActivity({type:'view'})`.
    - Its "Add" button adds the item to the cart with the fly-to-cart animation.
    - Its "Buy Now" button runs `router.push('/checkout')`.
    - `ignoreStock: true` caps quantity at 99.
  - `handleSubmit()`. See the flow section below.
- **Data access:**

| call | method | headers | body | response used |
|---|---|---|---|---|
| `/api/checkout/referral-code` | POST | JSON | `{ code }` | `{ match: boolean }` (or a 429 `{error}`) |
| `/api/checkout/discount-code` | POST | JSON + `Authorization: Bearer <supabase access_token>` when signed in | `{ code, subtotal: totalPrice, items: [{ productId, amount: price*quantity }] }` | success: `{ ok:true, code, percent, discount_type:'percent'\|'fixed', discount_value:number, description:string /* "20% off" or "$10.00 off" */, first_order_only:boolean, excluded_product_ids:string[] }`; failure (HTTP 200): `{ ok:false, error:string }`; HTTP 429: `{ ok:false, error:'Too many attempts. Please wait a moment.' }` |
| `/api/products?addon=1` | GET | Bearer when signed in; `cache:'no-store'` | — | `{ products: Product[] }`. Fields used: `id, name, strength, price, vial_price, vials_per_box, pack_sizes, pack_options, stock_quantity, image_url, box_image_url, puramass_sku, puramass_sku_vial` |
| `/api/checkout/puramass/rates` | POST | JSON | `{ vials:number, destination:{country, postal_code, city, state} }` | `{ live:boolean, rates:HostedShippingRate[], note:string\|null, settings, debug? }`. 400 `{error:'Enter a full address to see shipping options.'}`; 429 `{error:'Too many requests. Please try again shortly.'}` |
| `/api/checkout/puramass` | POST | JSON + Bearer when signed in | see the flow section | `{ payment_link, transaction_id, status, shipping_total, free_shipping, ad_discount_percent, discount_code, discount_code_percent, discount_code_from_landing, cart_offer_percent, discount_percent, ad_discount }`. The client reads only `payment_link` and `ad_discount` |
| `supabase.auth.getSession()` | — | — | — | `session.access_token` (called before discount-code, addons and submit) |

  - `applyDiscountCode(raw, opts)` step by step:
    1. `code = raw.trim()`. If empty, return.
    2. Set `codeChecking=true` and `codeError=null`.
    3. POST as in the table.
    4. If `json.ok`:
       - `appliedCode = { code: json.code, discountType: json.discount_type==="fixed"?"fixed":"percent", discountValue: Number(json.discount_value)||0, description: json.description, excludedProductIds: array or [], firstOrderOnly: !!json.first_order_only, fromLanding: !!opts.fromLanding }`
       - `codeInput = json.code`
       - If `fromLanding`, `landingDeclined=false`.
    5. Otherwise `appliedCode=null` and `codeError = json.error || "That code isn't valid."`.
    6. An exception sets `codeError = "Could not check that code. Please try again."`.
    7. `finally` sets `codeChecking=false`.
  - Server rejection copy shown in `codeError` (`REJECTION_MESSAGES` in `lib/affiliate/discount-codes.ts`):
    - not-found: "That code isn't valid."
    - inactive: "That code is no longer active."
    - not-started: "That code isn't active yet."
    - expired: "That code has expired."
    - used-up: "That code has reached its usage limit."
    - below-minimum: "Your order is below the minimum for that code."
    - own-code: "You can't use your own affiliate code."
    - first-order-only: "That code is for first orders only."
    - first-order-unverified: "We couldn't check that code right now. Please try again."
    - nothing-eligible: "That code doesn't apply to the items in your cart."
  - Server code rules: the code is normalised to uppercase with non `[A-Z0-9]` removed, and must match `/^[A-Z0-9]{3,32}$/`.
- **Renders:** three mutually exclusive top-level branches, checked in this order:
  1. `items.length === 0` → empty-cart screen.
  2. `accountRequired` → account gate.
  3. Main checkout.

  All three start with the same `Header` element (see UI/UX).

#### Local sub-components in `PuramassCheckoutContent.tsx`

##### `FieldError({ message?: string })`
- Returns `null` when there is no message.
- Otherwise `<p className="mt-1.5 text-[11px] text-amber-700">` (6px top margin, 11px text, `#B45309`).

##### `RateOption({ rate, selected, free?, onSelect })`
- `eta = deliveryEstimate(rate)`:
  - `null` if both min and max are 0.
  - `"{max||min} business days"` if min is 0 or min === max.
  - `"{min}+ business days"` if max is 0.
  - otherwise `"{min}–{max} business days"` (en dash).
- Renders a `<button type="button" aria-pressed={selected}>` with classes `flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-left transition-all duration-200` plus:
  - selected: `border-teal bg-teal/5 shadow-sm`
  - otherwise: `border-line bg-white hover:border-teal/40`
- Left side `flex min-w-0 items-center gap-2.5`:
  - Radio dot `flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border transition` plus `border-teal bg-teal-dark text-white` when selected or `border-line` otherwise. Selected shows `Check h-2.5 w-2.5`.
  - Text block:
    - `rate.courier_name` in `block truncate text-xs font-semibold text-ink`
    - `rate.service_name` + (eta ? ` · ${eta}` : "") in `block truncate text-[11px] text-ink-muted`
- Right side `flex-shrink-0 text-sm font-semibold tabular-nums`:
  - If `free`: `<span class="mr-1.5 text-xs font-normal text-ink-muted line-through">$X.XX</span><span class="text-emerald-700">Free</span>`
  - Else: `<span class="text-ink">$X.XX</span>`, using `total_charge.toFixed(2)`.

##### `AddonSkeleton()`
- `flex items-center gap-3 rounded-xl border border-line p-3`, containing:
  - a 48px `h-12 w-12 rounded-lg bg-line/40 animate-pulse`;
  - two bars `h-3 w-3/4` (bg-line/40) and `h-2.5 w-1/2` (bg-line/30), both `rounded animate-pulse`, in `min-w-0 flex-1 space-y-2`;
  - a 36px `h-9 w-9 rounded-lg bg-line/40 animate-pulse`.

##### `AddonRow({ p, featured?, onAdd })`
- A `motion.div variants=itemVariants` with `group flex items-center gap-3 rounded-xl border p-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm` plus:
  - featured: `border-teal/40 bg-teal/[0.04] hover:border-teal/60`
  - otherwise: `border-line hover:border-teal/40`
- Thumbnail `relative flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface`:
  - `<img src={image_url} alt="" class="h-full w-full object-contain p-1">`
  - or `Beaker h-6 w-6 text-line` when there is no image.
- Text `min-w-0 flex-1`:
  - Row `flex items-center gap-1.5`: name in `truncate text-sm font-medium text-ink`. When featured, add the badge "Essential": `inline-flex flex-shrink-0 items-center rounded-full border border-teal/30 bg-teal/10 px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wide text-teal-dark`.
  - Sub-line `mt-0.5 text-xs text-ink-muted`: `{strength ? strength+" · " : ""}from $X.XX`.
- Button: `<button type="button" aria-label="Add {name}">`, `flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-ink text-white transition-all duration-150 hover:bg-ink/90 active:scale-90`, containing `Plus h-4 w-4`.

##### `discountCodePercent(code, subtotal)`
- `raw` is `discountValue` for percent codes. For fixed codes it is `(discountValue/subtotal)*100`, or 0 when `subtotal <= 0`.
- Returns `min(99, max(0, round(raw*100)/100))`.

##### `readReferralCode()`
See effect 1 above.

#### `components/AddressAutocomplete.tsx` (default export)
- **Client**. Used for the Street address field on checkout only. The `/shipping-address/[token]` page uses a plain input.
- **Props:**
  - `value: string`, `onChange(next: string)`, `onPick(s: AddressSuggestion)`
  - `placeholder?` (default `'Start typing your street address…'`)
  - `name?`, `disabled?`, `onLoadingChange?(loading:boolean)`
- `AddressSuggestion = { label, address, city, state /* 2-letter province code */, postalCode, country }`
- **State:**
  - `suggestions` `[]`, `open` `false`, `active` `-1`, `loading` `false`, `mounted` `false`, `pos` `null` (`{top,left,width}`)
  - refs: `wrapRef`, `listRef`, `ignoreNextFetchRef = false`
- **Effects:**
  - Sets `mounted`. Reports `loading` to `onLoadingChange`.
  - While `open`, repositions the list on scroll (capture phase) and resize: `top = rect.bottom + 4`, `left = rect.left`, `width = rect.width`.
  - Document `mousedown` outside both the wrapper and the list closes it.
  - **Debounced fetch** `[value]`:
    - Skipped once after a pick.
    - If `value.trim().length < 3`, clears and closes.
    - Otherwise waits **220 ms**, then `GET /api/shipping/address-autocomplete?q=<encoded>`. The endpoint is a Photon/OSM proxy limited to Canada.
    - On success, sets `suggestions = data.suggestions ?? []`, `active=-1`, `open = next.length>0`.
    - On error, clears suggestions.
- **Keyboard:** ArrowDown/ArrowUp move `active` (clamped from -1 to len-1, with preventDefault). Enter picks the active suggestion if `active >= 0`. Escape closes.
- **Focus:** reopens if suggestions exist.
- **Markup:**
  - Input `type="text" autoComplete="off"` with class `w-full pl-10 pr-4 py-3 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-transparent text-sm bg-white text-ink placeholder-ink-muted`. **This differs from `INPUT_CLASS`: white background, `py-3` (12px), 14px radius, 40px left padding.**
  - Left icon: `absolute inset-y-0 left-3 flex items-center pointer-events-none text-ink-muted`, showing `Search w-4 h-4 animate-pulse` while loading, else `MapPin w-4 h-4`.
  - Dropdown: portalled to `document.body` as `<ul role="listbox" style="position:fixed;top;left;width" class="z-[300] bg-white border border-line rounded-xl shadow-lg max-h-72 overflow-auto">` (max height 288px).
  - Each item: `<li role="option" aria-selected>` with `px-3 py-2 text-sm cursor-pointer` plus `bg-teal/10 text-ink` when active, else `text-ink`.
    - Line 1: `font-medium` `{address}`.
    - Line 2: `text-xs text-ink-muted` `[city,state,postalCode].filter(Boolean).join(' · ')`.
    - Picked on `onMouseDown` with preventDefault.
- **On pick in checkout:** `setShip({ address, city, state, zip: postalCode, country: "CA" })`.

#### `components/FreeShippingProgress.tsx` (default export)
- **Client**. Props:
  - `subtotal: number`, `threshold: number`, `active: boolean`
  - `variant?: "card"|"bar"` (default `"card"`)
  - `className?` (default `""`)
- Checkout uses `variant="card"` with `className="mt-4"`, `subtotal=totalPrice` (pre-discount), `threshold=freeShippingThreshold`, `active=freeShippingActive`.
- **Progress values:** `progress = active ? freeShippingProgress(subtotal, threshold) : null`. It renders nothing when `null` (inactive, or threshold not a positive number).
  - `remaining = max(0, ceil((threshold - spent)*100)/100)` (rounded **up** to the cent)
  - `pct = clamp(spent/threshold*100, 0, 100)`
  - `unlocked = remaining <= 0`
- **Card markup:**
  - Wrapper `rounded-xl border p-3.5 transition-colors duration-300` plus `border-emerald-200 bg-emerald-50` when unlocked, or `border-teal/25 bg-teal/5`.
  - Row `flex items-start gap-2.5`:
    - Icon tile `flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg` plus `bg-emerald-500 text-white` (icon `PartyPopper h-4 w-4`) when unlocked, or `bg-teal/15 text-teal-dark` (icon `Truck h-4 w-4`).
    - Body `min-w-0 flex-1`:
      - Top row `flex items-baseline justify-between gap-3`:
        - Message in `text-xs font-semibold` (`text-emerald-800` unlocked, `text-ink` otherwise): **"Free shipping unlocked!"** or **"Add $R.RR for free shipping"**.
        - Right side `flex-shrink-0 text-[11px] tabular-nums text-ink-muted`: `<span class={unlocked?"text-emerald-700":"text-ink"}>$S.SS</span><span class="mx-0.5">/</span><span>$T.TT</span>`.
      - Bar track `mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line/70` (6px tall) with `role="progressbar" aria-valuemin=0 aria-valuemax=100 aria-valuenow={round(pct)} aria-label="Progress toward free shipping"`.
      - Fill: `motion.div` `h-full rounded-full` plus `bg-emerald-500` when unlocked, or `bg-gradient-to-r from-teal/70 to-teal`. `initial={false}`, `animate={{width: pct+"%"}}`, spring `{stiffness:180, damping:26}`.
      - Footer `mt-1.5 text-[11px] leading-snug` (`text-emerald-700` unlocked, `text-ink-muted` otherwise):
        - unlocked: **"Shipping is on us — pick any courier at checkout and it's free."**
        - otherwise: **"Spend $T.TT or more and we'll cover the shipping."**
- **`bar` variant** (cart only, not checkout): same data. Copy is "You're eligible for FREE shipping!" / "Add $R.RR for FREE shipping" / "Free shipping unlocked".

#### `contexts/PromosContext.tsx` — `PromosProvider` / `usePromos()`
- **Client**, mounted globally in the root layout inside `CustomerProvider` and `CartProvider`. The checkout only reads it.
- **State:**
  - `loading` `true`
  - `freeShipping` `{active:false, threshold:0}`
  - `adDiscount` `{ enabled:false, percent:25, active:false }`
  - `cartOffer` `{ enabled:false, minItems:2, percent:10, endsAt:null }`
  - `expiryTick` `0`
  - `channels` `[]`
  - `isFirstOrder` `false`
  - `landingOffer` = `NO_LANDING_OFFER` (`{active:false, slug:null, code:null, percent:0, firstOrderOnly:false, excludedProductIds:[], exclusions:null, reason:null}`)
- **Effects:**
  1. `channels = visitorChannels()`, which is `[firstTouch.channel, lastTouch.channel]` read from cookies `aminocan_attr` and `aminocan_attr_last`.
  2. `[customerId]`:
     - With no customer, `isFirstOrder=false`.
     - Otherwise `GET /api/promos/first-order` with Bearer and `no-store` → `{ firstOrder: boolean }`. A 401 or no token leaves it `false`.
  3. `[customerId]`:
     - If there is no `vyta_lp` cookie, uses `NO_LANDING_OFFER`.
     - Otherwise `GET /api/promos/landing` (`no-store`, Bearer if any) → `{ offer: { slug, code, percent, first_order_only, excluded_product_ids, exclusions, ends_at } | null, eligible: boolean, reason: string|null }`.
     - If `!offer.code || !(percent > 0)`, it falls back to `NO_LANDING_OFFER`.
     - Otherwise `active = json.eligible !== false`.
  4. Mount: `GET /api/admin/settings` (`no-store`) and sets:
     - `freeShipping = {active: !!s.puramass_free_shipping_active, threshold: Number(s.puramass_free_shipping_threshold)||0}`
     - `adDiscount = {enabled: !!s.ad_discount_enabled, percent: Number(s.ad_discount_percent)||0, active: !!s.ad_discount_active}`
     - `cartOffer = {enabled: !!s.cart_offer_active, minItems: Number(s.cart_offer_min_items)||1, percent: Number(s.cart_offer_percent)||0, endsAt: s.cart_offer_ends_at ?? null}`
  5. One timeout at `cartOffer.endsAt` (+250 ms) bumps `expiryTick`. It is skipped if the end is more than 2,147,483,647 ms away or already past.
- **Value exposed:**
  - `adDiscountEligible = qualifiesForAdDiscount({enabled: adDiscount.active, percent}, {signedIn: !!customer, firstOrder: isFirstOrder, channels})`. This is true only when all of these hold:
    - `enabled && percent > 0`;
    - the visitor is signed in;
    - `isFirstOrder`;
    - some channel is in `PAID_CHANNELS = ['google_ads','meta_ads','bing_ads','tiktok_ads','linkedin_ads','other_paid']`.
  - `adDiscountOn(sub) = eligible ? adDiscountAmount(sub, percent) : 0`, where `adDiscountAmount = round(sub * clampPct)/100` and `clampPct = min(100, round(p*100)/100)` (0 if `<= 0`).
  - `cartOffer`:
    - `earned = qualifiesForCartOffer(cfg, totalItems)` = `enabled && percent>0 && !expired && floor(totalItems) >= minItems`
    - `itemsAway`
    - `amountOn(sub) = earned ? round(sub*clampPct)/100 : 0`
    - `totalItems` = Σ `quantity` (pack units, not vials).
  - `landingOffer.amountOn(lines) = active ? round(eligibleSubtotal(lines, excluded)*percent)/100 : 0`. The checkout does not call this.

#### Other close dependencies
- `contexts/CartContext.tsx`:
  - `CartItem = { id: "${productId}::p${packSize}", productId, unit:'vial'|'case', packSize, vialsPerBox, name, price /* per ONE unit of this line, CAD */, quantity /* units */, strength, image_url?, stock_quantity }`
  - `totalPrice = Σ price*quantity`, `totalItems = Σ quantity`.
  - Persisted to **localStorage `northern_peptides_cart`**, loaded synchronously on the client with a lazy initialiser, and synced across tabs via the `storage` event.
- `contexts/CustomerContext.tsx`:
  - `customer` is a `customers` row (`email`, `first_name`, `last_name`, `phone: string|null`, …) or `null`, plus `isLoading` (initially `true`).
- `lib/phone.ts`:
  - `isValidPhone(p)`: the trimmed value must match `/^\+?[\d\s().-]+$/`, and the digit count must be between 10 and 15 inclusive.
- `lib/shipping/regions.ts`:
  - `SHIPPING_COUNTRIES = [{code:'CA', name:'Canada'}]`. This is the only option in the country `<select>`.
  - `regionLabel`: US → "State", CA → "Province", else "State / Province / Region".
  - `postalLabel`: US → "ZIP code", else "Postal code".
  - `CA_PROVINCES`: AB Alberta, BC British Columbia, MB Manitoba, NB New Brunswick, NL Newfoundland and Labrador, NS Nova Scotia, NT Northwest Territories, NU Nunavut, ON Ontario, PE Prince Edward Island, QC Quebec, SK Saskatchewan, YT Yukon.
- `lib/affiliate/discount-codes.ts`:
  - `eligibleSubtotal(lines, excludedIds)` sums `amount` over lines whose `productId` (case-insensitive) is not excluded.
- `lib/pricing.ts`:
  - `vialPriceFor(p)`: `vial_price` if > 0 (rounded to 2dp), else `round2(price / (vials_per_box || 10))`.
  - `packOptionsFor(p)`: enabled pack options. Each `price = option.price ?? round2(vialPrice*size)`.
- Analytics: `lib/analytics/ecommerce.ts` (`trackBeginCheckout`), `lib/analytics/cart.ts` (`cartItemToAnalytics`) and `lib/customer/activity.ts` (`trackActivity`). See the flow section.

---

### Checkout — form & validation

There is **no `<form>` element** around the contact or address fields, so the native `required` attributes never block anything. All gating goes through `canSubmit`. The Discount code input is the only one wrapped in its own `<form>`, so Enter submits it. No `name` attributes are set on checkout inputs, and no `id`s either, except `discount-code` and `affiliate-code`. Labels are not linked via `htmlFor`, except for those two.

| Label (verbatim, `*` = red-teal asterisk span) | State key | Element / type | `required` attr | autoComplete | Placeholder | Client validation rule | Error copy (where shown) | Shown when | Persistence |
|---|---|---|---|---|---|---|---|---|---|
| `Email *` | `email` | `<input type="email">` with a `Mail` icon at the left and an animated green check at the right when valid | no | `email` | `you@example.com` | `emailRegex.test(email.trim())` | No inline error. Helper under CTA: "Enter a valid email to continue." Server 400: "Enter a valid email address." in the banner | always | none (prefilled from `customer.email` if empty) |
| `First name *` | `firstName` | `<input type="text">` | yes (inert) | `given-name` | `First name` | `trim() !== ""` | Helper under CTA: "Enter your first and last name to continue." Server 400: "Enter your first and last name." | always | prefill `customer.first_name` |
| `Last name *` | `lastName` | `<input type="text">` | yes (inert) | `family-name` | `Last name` | `trim() !== ""` | same as First name | always | prefill `customer.last_name` |
| `Phone *` | `shipping.phone` | `<input type="tel" inputMode="tel">`; `onBlur` → `phoneTouched=true` | yes (inert) | `tel` | `(416) 555-0199` | `isValidPhone` (10–15 digits, chars `+ digits space ( ) . -`, `+` only leading) | Inline `FieldError`: "Enter a valid phone number (at least 10 digits)." (only after blur and while invalid), else server `addressErrors.phone` = "Enter a valid phone number." Helper under CTA: "Enter a valid phone number to continue." Fixed hint under field: "Used only if we or the courier need to reach you about your order." | always | prefill `customer.phone` |
| `Country *` | `shipping.country` | `<select>`, options from `SHIPPING_COUNTRIES` (only "Canada"/`CA`) | no | none | — | none | Server `fields.country` "We only ship within Canada." is **not rendered inline** (banner only) | `shippingRatesEnabled` | changing it also resets `state` to `""` |
| `Street address *` | `shipping.address` | `AddressAutocomplete` | no | `off` (component) | `Start typing your street address…` | part of `canQuote` (`trim()` non-empty) | `FieldError addressErrors.address` → server "Please enter a street address." Helper: "Enter your shipping address to continue." | `shippingRatesEnabled` | none |
| `Apartment, suite, unit` | `shipping.address2` | `<input type="text">` | no | `address-line2` | `Optional` | none | — | `shippingRatesEnabled` | none |
| `City *` | `shipping.city` | `<input type="text">` | no | `address-level2` | none | part of `canQuote` | `FieldError addressErrors.city` → "Please enter a city." | `shippingRatesEnabled` | none |
| `{postalLabel(country)} *` → "Postal code *" | `shipping.zip` | `<input type="text">` | no | `postal-code` | none | part of `canQuote` (no format check) | `FieldError addressErrors.zip` → "Please enter a postal or ZIP code." | `shippingRatesEnabled` | none |
| `{regionLabel(country)}` → "Province" + ` *` when `regions` exist | `shipping.state` | `<select>` with first option `""` "Select…", then 13 provinces; free-text `<input placeholder="Optional" autoComplete="address-level1">` if the country has no region list (unreachable today) | no | none (select) | `Select…` | **not validated client-side** (not in `canQuote`/`canSubmit`) | `FieldError addressErrors.state` → server "Please choose a province." (or "Please choose a state." for US), with banner "Enter a complete shipping address." | `shippingRatesEnabled` | none |
| `Discount code` (with `Ticket` icon) | `codeInput` | `<input id="discount-code">` in a `<form>`; value upper-cased on change | no | `off` | `Enter code` | Apply disabled while `codeChecking \|\| !codeInput.trim()` | `codeError` under field (`text-xs text-amber-700 mt-1.5`): server rejection messages, "That code isn't valid." (fallback), "Could not check that code. Please try again.", "Too many attempts. Please wait a moment." | always | from `?discount=` / `?code=` URL params; landing code |
| `Affiliate code (optional)` (with `UserCheck` icon) | `referralCode` | `<input id="affiliate-code" maxLength=64 autoCorrect="off" autoCapitalize="off" spellCheck=false aria-describedby="affiliate-code-status">` | no | `off` | `Who referred you?` | none (sent as typed, trimmed) | Status line (aria-live polite) — see below | always | prefilled from cookie `ref_code` |

Affiliate status line (`<p id="affiliate-code-status" class="mt-1.5 text-xs">`):

| `referralStatus` | copy | colour |
|---|---|---|
| `idle` or `checking` | "Credits whoever referred you." | `text-ink-muted` |
| `match` | "Affiliate matched — they'll be credited for this order." | `text-emerald-700` |
| `no-match` | "No affiliate matches this code." | `text-amber-700` |
| `error` | "Couldn't check this code right now — it will still be sent with your order." | `text-ink-muted` |

The affiliate input border changes with status:
- `match`: `border-emerald-300 focus:border-emerald-500`
- `no-match`: `border-amber-300 focus:border-amber-500`
- otherwise: `border-line focus:border-teal`

Its right-hand icon is `Loader2 h-4 w-4 animate-spin text-ink-muted` while checking, `Check h-4 w-4 text-emerald-600` on match, and `AlertCircle h-4 w-4 text-amber-600` on no-match.

**Courier choice** is an implicit field. When `shippingRatesEnabled && ratesLive`, the buyer must click a `RateOption`, which sets `courierId`. There is no default selection. The helper text says "Choose a courier to continue."

**CTA helper text** (`<p class="mt-3 text-center text-xs text-ink-muted">`). The first matching row wins:
1. `!emailValid` → "Enter a valid email to continue."
2. `!namesValid` → "Enter your first and last name to continue."
3. `!phoneValid` → "Enter a valid phone number to continue."
4. `shippingRatesEnabled && !addressReady` → "Enter your shipping address to continue."
5. `ratesLoading` → "Calculating shipping rates…"
6. `!deliveryChosen` → "Choose a courier to continue."
7. otherwise → "You'll be redirected to complete payment securely, in CAD."

**Form persistence:** none. Contact, shipping, code and courier state live only in React state and are lost on reload. Nothing is written to localStorage or sessionStorage by the checkout.

What the checkout reads from the browser:

| key | storage | what reads it | purpose |
|---|---|---|---|
| `northern_peptides_cart` | localStorage | via `CartContext` | the cart |
| `ref_code` | cookie | the checkout | affiliate code prefill |
| `vyta_lp` | cookie | `PromosContext` (presence check only) | whether to fetch a landing offer |
| `aminocan_attr`, `aminocan_attr_last` | cookies | `PromosContext` | paid-ad attribution |
| Supabase auth session | Supabase JS default storage | the checkout | access token |

---

### Checkout — flow & state machine

1. **Navigate to `/checkout`.** Entry points are the cart page "Proceed", the cart drawer, and the purchase modal "Buy Now" (`router.push('/checkout')`). Optional query parameters: `?discount=CODE` or `?code=CODE`.
2. **`CheckoutPage`** renders the Suspense fallback or `CheckoutLoadingScreen` until `CheckoutRouter` finishes `GET /api/admin/settings`, success or failure.
3. **`PuramassCheckoutContent` mounts.** In parallel:
   - Global providers have already started their own work. `CustomerContext` is loading the customer. `PromosContext` is fetching settings, first-order status and the landing offer.
   - The referral cookie is copied into the Affiliate field. If it is non-empty, a 400 ms debounced `/api/checkout/referral-code` check runs.
   - Add-ons load if `addonsEnabled`. Three `AddonSkeleton` rows show until then.
4. **Branch: empty cart** (`items.length === 0`):
   - Header plus a card showing the heading "Your cart is empty", the body "Add some research compounds before checking out." and a CTA "Browse Catalog" → `/products`.
   - Stop.
5. **Branch: account required** (`!guestCheckoutEnabled && !customer`):
   - Header plus a card showing the heading "Account required" and the body "Please sign in to your account to continue to secure checkout."
   - Two buttons: "Continue Shopping" → `/products` and "Sign in" → `/` (**links to the home page, not `/login`**).
   - Stop. `customer` re-renders when it loads, and the gate disappears for signed-in users. Because `isLoading` is ignored, signed-in users see this gate flash while the customer loads.
6. **Main screen.**
   - The customer prefill fires when `customer` arrives.
   - Once `totalPrice > 0`, the URL discount code (if any) is applied (effect 3).
   - After that, if a landing offer is active and the field is empty, the landing code is auto-applied (effect 4). It is marked `fromLanding`, and its row reads "Applied automatically from your welcome offer".
7. **Buyer fills the contact fields.**
   - Leaving the phone field invalid and blurring shows the inline error.
   - Any change to a shipping or phone field clears every server `addressErrors`. The `error` banner is **not** cleared until the next submit.
8. **If `shippingRatesEnabled`:**
   - The buyer fills the address, or picks an autocomplete suggestion, which forces `country:"CA"` and fills city, province and postal code.
   - When `canQuote` is true, a 600 ms debounced quote runs. While it runs:
     - the Delivery area shows the spinner "Checking courier rates…";
     - the Shipping total line shows "Calculating…";
     - the CTA is disabled.
   - Result **live** (`json.live === true`):
     - The Delivery area lists `RateOption`s, at most 5, UPS and Canada Post only, fastest first.
     - Shipping line: "Choose a courier above". It does not count toward the total until a courier is picked.
     - Clicking a rate sets `courierId`, and the shipping line shows its price, or "Free" when free shipping is earned.
   - Result **not live** (rates disabled server-side, Easyship not configured or erroring, or no rates):
     - `rates = [flat rate]` and `ratesLive=false`, so `selectedRate = rates[0]`, whose price is the server's flat fee.
     - Delivery copy: `{note + " "}` followed by either "Tracked shipping applies to this order, and it's **free**." (free shipping) or "Flat **$X.XX** tracked shipping applies to this order."
     - The note, when present, is "Live shipping rates are unavailable right now." or "No courier rates were returned for this address.".
   - Result HTTP error:
     - `rates=[]` and `ratesLive=false`, so `selectedRate = null` and `quotedShipping = flatShipping` (the client prop). The same "Flat …" copy shows, with no note.
9. **If `!shippingRatesEnabled`:**
   - No address section.
   - Delivery shows either "Flat **$X.XX** tracked shipping on every order. You'll give the courier your delivery address on the secure checkout page." or, when `flatShipping === 0`, "**Free** tracked shipping on every order. You'll give …".
10. **Discount code interactions:**
    - **Apply** runs `applyDiscountCode`, with a spinner inside the button. Success replaces the input with the green applied row. Failure shows `codeError`.
    - The **remove (X)** button on the applied row does the following:
      - if the code came from the landing page, `landingDeclined = true`, so neither this screen nor the server re-applies it;
      - otherwise `landingTriedFor = null`, so the landing code may auto-apply again;
      - then it clears `appliedCode`, `codeInput` and `codeError`.
    - **Re-apply link.** It shows when `!appliedCode && !codeError && landingDeclined && landingOffer.active && landingOffer.code`. Copy: "Re-apply your {+percent.toFixed(2)}% welcome offer ({CODE})". Clicking it sets the input and applies with `fromLanding`.
11. **CTA "Continue to secure checkout".** It is disabled when `!canSubmit || submitting`. On click, `handleSubmit()`:
    1. Guard: return if `items.length===0 || !canSubmit || submitting`.
    2. Set `submitting=true`, `error=null`, `unmapped=[]`, `addressErrors={}`. The button now shows `Loader2` and "Redirecting…".
    3. Get `access_token` from `supabase.auth.getSession()`.
    4. `POST /api/checkout/puramass` with headers JSON + `Authorization: Bearer …` (if signed in) and this payload:
       ```json
       {
         "items": [{ "id": "<productId>", "packSize": <it.packSize>, "quantity": <it.quantity * it.packSize /* TOTAL VIALS */> }],
         "customer": { "email": "<trimmed>", "firstName": "<trimmed or undefined>", "lastName": "<trimmed or undefined>", "phone": "<shipping.phone trimmed>" },
         "shipping": /* only when shippingRatesEnabled, else omitted */ {
           "country": "CA", "address": "...", "address2": "...", "city": "...", "state": "ON", "zip": "...", "phone": "...",
           "full_name": "First Last", "courier_id": "<selectedRate.courier_id or null>"
         },
         "referralCode": "<trimmed or undefined>",
         "discountCode": "<appliedCode.code or undefined>",
         "declineLandingOffer": true   /* only when landingDeclined && !appliedCode, else undefined */
       }
       ```
       - In the not-live case, `courier_id` is `"flat"` (`PURAMASS_FLAT_COURIER_ID`), because `selectedRate = rates[0]` is the flat rate.
    5. Parse JSON, falling back to `{}` on a parse error.
    6. **On `!res.ok`, branches are checked in this order:**
       - **a. `json.discount_code_error` is truthy** (HTTP 400, `json.error` = a rejection message):
         - `wasLanding = appliedCode.fromLanding`; then `appliedCode = null` and `codeError = json.error || "That code no longer applies."`.
         - If `wasLanding`: `landingDeclined = true` and `error = "${json.error || "Your welcome offer doesn't apply to this order."} You can continue without it."`.
         - Else: `error = "${json.error || "That discount code no longer applies."} Remove it or try another to continue."`.
       - **b. HTTP 409 with `Array.isArray(json.unmapped)`**:
         - `unmapped = json.unmapped` (product names).
         - `error = "Some items aren't available for the secure hosted checkout."`. This is **client copy**; the server's own string, "Some items are not available for hosted checkout.", is ignored.
         - The banner lists the names in a bullet list.
       - **c. HTTP 409 with `Array.isArray(json.rates)`** (couriers re-quoted):
         - `rates = json.rates`, `ratesLive = true`, `courierId = null`.
         - `error = json.error || "Please choose a delivery method again."`. The server sends "Those shipping options have changed. Please choose a delivery method again."
       - **d. Otherwise:**
         - If `json.fields` is an object, `addressErrors = json.fields`.
         - `error = json.error || "Could not start checkout. Please try again."`.
       - In every branch, finish with `submitting = false` and return.
       - Server `json.error` strings that reach branch d verbatim:
         - 429 "Too many requests. Please try again shortly."
         - 503 "Hosted checkout is not available right now."
         - 400 "Invalid JSON"
         - 400 "Your cart is empty."
         - 400 "Enter a valid email address."
         - 400 "Enter your first and last name."
         - 400 "Enter a valid phone number." (+ `fields.phone`)
         - 400 "We only ship within Canada." (+ `fields.country`)
         - 400 "Enter a complete shipping address." (+ `fields` from `validateShippingAddress`: `full_name` "Please tell us who the parcel is addressed to.", `address` "Please enter a street address.", `city` "Please enter a city.", `zip` "Please enter a postal or ZIP code.", `country` "Please choose a country.", `state` "Please choose a province."/"Please choose a state.")
         - 500 "Could not load your cart."
         - 500 "We could not price your cart. Please try again or contact support."
         - 4xx partner `err.detail` (free text, at most 300 chars)
         - 502 "Checkout is temporarily unavailable."
    7. **On OK with `json.payment_link`:**
       - `trackBeginCheckout(items.map(cartItemToAnalytics))`. This is the GA4 `begin_checkout` event with `{ currency:'CAD', value: round2(Σ price*quantity), items:[{ item_id: productId, item_name: name, item_variant: packSize>1 ? "${packSize}-pack" : "1-pack", item_category?: strength, price, quantity }] }`.
         - It goes to `gtag('event',…)` and/or `dataLayer.push({ecommerce:null}); dataLayer.push({event:'begin_checkout', ecommerce})`, depending on the `SiteTracking` mode. Events are buffered (max 20) while the mode is 'pending'.
         - **It is not forwarded to Klaviyo client-side.** `forwardEcommerceToKlaviyo` ignores `begin_checkout`. Klaviyo "Started Checkout" is sent server-side by the hand-off route.
       - `void trackActivity({ type:"checkout_start", metadata:{ kind:"puramass", items: items.length, value: Number((json.ad_discount ? totalPrice - json.ad_discount : totalPrice).toFixed(2)) } })`. This is a `POST /api/customer/activity` with a Bearer token if one exists, `keepalive`, `credentials:'same-origin'`.
       - `window.location.href = json.payment_link`. `submitting` **stays true**, so the CTA stays locked as "Redirecting…".
       - No `add_payment_info` or `purchase` event fires anywhere client-side on this path.
    8. **On OK without `payment_link`:** `error = "Could not start checkout. Please try again."` and `submitting = false`.
    9. **On an exception** (network): the same message, and `submitting = false`.
12. **Hosted payment page** (partner domain). The buyer may answer verification questions, which is why the "A few quick questions first." notice exists. Taxes may be added there.
13. **Return.**
    - **No return, success or cancel URL is sent by this codebase.** `buildPuramassOrderBody` sends `items`, `currency`, `customer`, `payment:{mode:'customer'}`, `partner_reference` and the optional `shipping_total_cents` only.
    - Where the buyer lands afterwards is configured partner-side: **Unverified**.
    - Payment confirmation arrives through a webhook (server scope).
    - The cart is **not cleared** by the checkout. It is cleared only by `/order/track` when it is opened with `?order=`.
    - Confirmation emails link to `/order/track?order=<orderNumber>` (`lib/email.ts`).
    - A missing shipping address triggers an emailed `/shipping-address/<token>` link.

Toasts: the checkout itself uses **no toasts**. All feedback is inline or in the amber error banner.

---

### Checkout — totals as displayed

All values are JS numbers in CAD. Inputs: `items` (cart), `totalPrice`, the promo context, `appliedCode`, the rates state, and the props.

```
subtotal          = totalPrice = Σ(item.price × item.quantity)          // item.price = price of ONE unit of the line (vial or whole pack)

// 1. First-order (paid-ads welcome) discount — off the full subtotal
welcomeSaving     = adDiscountEligible ? round(subtotal × pct_ad) / 100 : 0
                    // pct_ad = clamp(settings.ad_discount_percent) to [0,100], 2dp; round = Math.round on (subtotal×pct) i.e. cents

// 2. Discount code — off the eligible lines only
codeBase          = appliedCode ? Σ(price×qty over lines whose productId ∉ excludedProductIds, case-insensitive) : 0
codePercent       = appliedCode ? discountCodePercent(appliedCode, codeBase) : 0
                    // percent code: discountValue; fixed code: discountValue / codeBase × 100; then round to 2dp, clamp [0, 99]
codeFullSaving    = round(codeBase × codePercent) / 100
codeWins          = appliedCode && codePercent > 0 && codeFullSaving >= welcomeSaving      // tie → code wins
codeSaving        = codeWins ? codeFullSaving : 0
adSaving          = codeWins ? 0 : welcomeSaving          // code and first-order DO NOT stack: larger CAD saving applies
firstSaving       = codeSaving + adSaving

// 3. Limited-time cart offer — off what is left after step 1/2
offerSaving       = cartOffer.earned ? round(max(0, subtotal − firstSaving) × pct_offer) / 100 : 0
                    // earned = cart_offer_active && percent>0 && not expired (ends_at) && totalItems(Σ quantity) ≥ min_items

discount          = firstSaving + offerSaving
discountedSubtotal= max(0, subtotal − discount)

// 4. Shipping
freeShipping      = freeShippingActive && threshold > 0 && subtotal ≥ threshold      // measured on PRE-discount subtotal
selectedRate      = ratesLive ? rates.find(courier_id === courierId) ?? null : rates[0] ?? null
quotedShipping    = selectedRate?.total_charge ?? flatShipping                       // flat stands in until a quote lands
shippingCost      = freeShipping ? 0 : quotedShipping
shippingPending   = shippingRatesEnabled && (!addressReady || ratesLoading || (ratesLive && !selectedRate))

// 5. Total
total             = discountedSubtotal + (shippingPending ? 0 : shippingCost)
```

Additional notes on the totals:
- **Processing / handling fee:** never shown. It is already folded into each courier's `total_charge` server-side (`applyProcessingFee` with `shipping_handling_fee_type/value`, rounded to cents).
- **Tax:** none is computed. There is a fixed note: "Any applicable taxes are added on the secure checkout page."
- **Pack pricing:** no separate pack discount line. Pack prices are already in `item.price`.
- **Landing offer:** it has no line of its own. It is applied as a discount code with `fromLanding: true`, so its line label is "Welcome offer {CODE}".
- **Rounding:** each saving is rounded to cents independently (`Math.round(x*pct)/100`). Display uses `.toFixed(2)` with a `$` prefix and no thousands separators. **No currency code is shown on checkout amounts.** CAD is stated only in the explainer and in the helper text "…securely, in CAD.".
- **Server versus display:** the server recomputes everything and may round "a cent further in the buyer's favour". The displayed total is a floor on the saving, not a guarantee.

**Totals block rows**, rendered in this order inside `mt-4 pt-4 border-t border-line space-y-2`:
1. "Subtotal" — `$subtotal`. Label `text-sm text-ink-muted`; value `text-sm text-ink tabular-nums`.
2. If `codeSaving > 0`:
   - Label: `Ticket` icon + `"{appliedCode.fromLanding ? "Welcome offer" : "Code"} {CODE}"`.
   - Value: `-$codeSaving`.
3. If `adDiscountEligible && adSaving > 0`:
   - Label: `BadgePercent` icon + `"{adDiscount.percent}% first-order discount"`.
   - Value: `-$adSaving`.
4. If `offerSaving > 0`:
   - Label: `Gift` icon + `"{cartOffer.percent}% limited-time offer"`.
   - Value: `-$offerSaving`.
5. "Shipping". The first matching condition decides the value:
   - `shippingRatesEnabled && !addressReady` → "Enter address above" (muted)
   - `shippingRatesEnabled && ratesLoading` → spinner + "Calculating…"
   - `shippingRatesEnabled && ratesLive && !selectedRate` → "Choose a courier above"
   - `freeShipping || shippingCost === 0` → **"Free"** (`font-semibold text-emerald-700`)
   - otherwise → `$shippingCost`
6. "Total" — `$total`. Row is `pt-2 border-t border-line`; label `text-sm font-medium text-ink`; value `text-lg font-bold text-ink tabular-nums`.

Styling for the discount rows (2–4):
- Label: `inline-flex items-center gap-1.5 text-sm text-emerald-700`, icon `h-3.5 w-3.5`.
- Value: `text-sm font-semibold text-emerald-700 tabular-nums`.

**"Already applied" callout** (when `discount > 0`):
- It builds a list of the applied labels:
  - the code, if `codeSaving > 0`:
    - landing code: `"${description without trailing ' off'} welcome offer (code ${CODE})"`, e.g. "20% welcome offer (code WELCOME20)";
    - any other code: `"code ${CODE}"`;
  - `"${adDiscount.percent}% first-order discount"`;
  - `"${cartOffer.percent}% limited-time offer"`.
- Copy line 1 (bold): "Your {labels.join(" and ")} {labels.length>1 ? "are" : "is"} already applied."
- Copy line 2: "The secure checkout page shows the discounted prices — $DISCOUNTED instead of $SUBTOTAL — so there is no code to enter there."

---

### Checkout — UI/UX

#### Wireframe — desktop (≥1024px, `lg`), add-ons enabled

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ [AnnouncementBar (global, optional)]                                                      │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  [mark] VYTA                                                       ( 🔒 SSL Encrypted )   │  header, max-w 1152, py 24
│         SECURE CHECKOUT                                                                   │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ 🛡 You'll finish on our secure checkout partner.                                       │ │  explainer (teal tint)
│ │    Your order is priced in Canadian dollars and payment is collected on …              │ │
│ └──────────────────────────────────────────────────────────────────────────────────────┘ │
│ ┌────────────────────────┐ ┌────────────────────────┐ ┌────────────────────────┐ (sticky) │
│ │[👤] Contact information│ │[💧] Complete your order│ │[🛒] Your order          │          │
│ │     We'll send your …  │ │     Reconstitution …   │ │     N items             │          │
│ │ EMAIL *                │ │ ┌ Most peptides ship … │ │ Name           $xx.xx   │          │
│ │ [✉ you@example.com  ✓] │ │ │ ⚗ N vials in your …  │ │ 5mg·[Pack of 10] × 1    │          │
│ │ FIRST NAME * LAST NAME*│ │ └──────────────────────│ │ ───────────────────     │          │
│ │ [         ] [        ] │ │ ┌[💬] Not sure how …  →│ │ [🚚 Add $x for free …]  │          │
│ │ PHONE *                │ │ └──────────────────────│ │ ─ 🚚 Delivery ───────── │          │
│ │ [(416) 555-0199      ] │ │ [img] BAC Water [ESS.] │ │  (rates / flat copy)    │          │
│ │ Used only if we …      │ │       from $x      [+] │ │ ─ 🎟 Discount code ──── │          │
│ │ ── 📍 Shipping address │ │ ── ALSO RECOMMENDED ── │ │ [ENTER CODE   ][Apply]  │          │
│ │ COUNTRY *  [Canada  ▾] │ │ [img] Other   from $x[+]│ │ ─ 👤 Affiliate code ─── │          │
│ │ STREET ADDRESS *       │ │                         │ │ [Who referred you?   ✓] │          │
│ │ [📍 Start typing …   ] │ │                         │ │ Credits whoever …       │          │
│ │ APARTMENT, SUITE, UNIT │ │                         │ │ ─────────────────────── │          │
│ │ CITY *    POSTAL CODE *│ │                         │ │ Subtotal        $xx.xx  │          │
│ │ PROVINCE * [Select… ▾] │ │                         │ │ Code X         -$x.xx   │          │
│ │ ── ✓ Payment details … │ │                         │ │ Shipping        $xx.xx  │          │
│ │    ✓ Receipt & …       │ │                         │ │ ───────────────────     │          │
│ │    ✓ No card data …    │ │                         │ │ Total          $xxx.xx  │          │
│ └────────────────────────┘ └────────────────────────┘ │ [% Your … already applied]│          │
│                                                        │ [i Any applicable taxes…] │          │
│                                                        │ [! error banner]          │          │
│                                                        │ [🛡 Continue to secure checkout →]  │
│                                                        │  helper text              │          │
│                                                        │ [? A few quick questions] │          │
│                                                        │ ─ 🛡 Secure  🔒 SSL ─────  │          │
│                                                        └────────────────────────┘          │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```
With add-ons disabled, the grid is `lg:grid-cols-2`: Contact | Your order.

#### Wireframe — mobile (<1024px)

```
┌──────────────────────────────┐
│ [mark] VYTA     (🔒 SSL Encr.)│  px 20 (sm: 32)
│ SECURE CHECKOUT               │
├──────────────────────────────┤
│ ┌ 🛡 You'll finish on … ────┐ │
│ └───────────────────────────┘ │
│ ┌ Contact information ──────┐ │  (full width, stacked, gap 24)
│ │ … fields … reassurance    │ │
│ └───────────────────────────┘ │
│ ┌ Complete your order ──────┐ │  (if addonsEnabled)
│ └───────────────────────────┘ │
│ ┌ Your order (not sticky) ──┐ │
│ │ lines, progress, delivery │ │
│ │ code, affiliate, totals   │ │
│ │ [Continue to secure …]    │ │
│ └───────────────────────────┘ │
└──────────────────────────────┘
```
The First/Last name and City/Postal pairs stay `grid-cols-2` at every width. There is no mobile-specific sticky CTA.

#### Page shell
- Root: `min-h-screen bg-white`.
- **Header** (shared by all three branches):
  - Outer `bg-white border-b border-line`, inner `max-w-6xl mx-auto px-5 sm:px-8 py-6`, row `flex items-center justify-between`.
  - Left: `<Link href="/" className="flex items-center gap-3">` containing:
    - `<img src="/images/vyta-mark.png" alt="" aria-hidden className="relative w-10 h-10 object-contain">` (40×40);
    - a column with "VYTA" (`text-lg font-bold text-ink tracking-tight leading-none`) and "Secure Checkout" (`text-[10px] text-teal-dark tracking-[0.15em] font-medium uppercase mt-0.5`).
  - Right pill: `flex items-center gap-2 px-4 py-2 bg-surface rounded-full border border-line` containing `Lock w-4 h-4 text-teal-dark` and "SSL Encrypted" (`text-sm font-medium text-ink-muted`).
- Body wrapper: `px-5 sm:px-8 py-8 md:py-12`, i.e. 20px/32px sides and 32px (48px at ≥768px) vertical.
- Main container: `motion.div variants=containerVariants initial="hidden" animate="show" className="max-w-6xl mx-auto"`. Children stagger by 0.08s after a 0.04s delay. Each item fades in from y=16px over 0.45s with ease `[0.16,1,0.3,1]`.

#### Empty-cart card
- `motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} transition={{duration:0.4, ease:[0.16,1,0.3,1]}}` with `max-w-lg mx-auto bg-surface rounded-2xl p-10 md:p-12 text-center border border-line` (max 512px; padding 40px, or 48px at ≥768px).
- Icon tile: `w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 border border-line` with `ShoppingCart w-8 h-8 text-ink-muted`.
- Heading: `h2 text-xl font-bold text-ink mb-2` "Your cart is empty".
- Body: `p text-ink-muted mb-6 text-sm` "Add some research compounds before checking out."
- CTA: `Link /products` with `inline-flex items-center gap-2 bg-ink hover:bg-ink/90 text-white px-6 py-3 rounded-xl font-semibold transition-all text-sm`, text "Browse Catalog", followed by `ArrowRight w-4 h-4`.
- The body wrapper here is `px-5 sm:px-8 py-12`.

#### Account-required card
- Same motion as the empty-cart card. Classes: `max-w-lg mx-auto bg-white rounded-2xl p-8 md:p-10 text-center border border-line`.
- Icon tile: `w-16 h-16 bg-teal/10 rounded-2xl … mx-auto mb-4` with `Lock w-8 h-8 text-teal-dark`.
- Heading: "Account required" (`text-xl font-bold text-ink mb-2`).
- Body: "Please sign in to your account to continue to secure checkout." (`text-ink-muted mb-6 text-sm`).
- Buttons in `flex flex-col sm:flex-row gap-3 justify-center`:
  - "Continue Shopping" → `/products`: `px-6 py-2.5 border border-line rounded-xl text-sm font-medium text-ink hover:bg-surface transition-colors`.
  - "Sign in" → `/`: `px-6 py-2.5 bg-ink text-white rounded-xl text-sm font-medium hover:bg-ink/90 transition-colors`.

#### Redirect explainer
- `motion.div variants=itemVariants`: `flex items-start gap-3 rounded-2xl border border-teal/30 bg-teal/5 p-4 mb-6`.
- Icon: `ShieldCheck w-5 h-5 text-teal-dark flex-shrink-0 mt-0.5`.
- Text block `text-sm text-ink`:
  - Bold line: "You'll finish on our secure checkout partner." (`font-semibold`).
  - Second line (`text-ink-muted mt-0.5`): "Your order is priced in Canadian dollars and payment is collected on the secure hosted checkout page. ", followed by one of:
    - when `shippingRatesEnabled`: "Tell us where it's going and pick a courier below — that shipping price is locked in before you pay."
    - otherwise: "Shipping and any applicable taxes are added there."

#### Grid
- `grid grid-cols-1 gap-6` plus `lg:grid-cols-3` (add-ons on) or `lg:grid-cols-2`. Gap is 24px.
- Each column is a `motion.section variants=itemVariants`.

#### Column 1 — Contact
- Card: `h-full rounded-2xl border border-line bg-white p-5` (padding 20px, radius 18px).
- Head: `flex items-center gap-3 mb-4`.
  - Icon tile: `flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface` with `User h-5 w-5 text-teal-dark`.
  - Title: `h2 text-base font-semibold text-ink` "Contact information".
  - Subtitle: `p text-xs text-ink-muted` "We'll send your receipt here."
- Fields stack: `space-y-3` (12px).
- Label class for every field: `block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1.5`. The required mark is `<span class="text-teal-dark">*</span>`.
- **Email** input: `w-full pl-10 pr-10 py-2.5 bg-surface rounded-lg border border-line text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-transparent transition`.
  - Left icon: `Mail absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted`.
  - Valid check: `motion.span initial={{scale:0,opacity:0}} animate={{scale:1,opacity:1}} transition={{type:"spring", stiffness:400, damping:20}}` with `absolute right-3 top-1/2 -translate-y-1/2 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white` and `Check h-3 w-3`.
- **First/Last name:** `grid grid-cols-2 gap-3`. Inputs use `px-4` and the same `INPUT_CLASS` look.
- **Phone:** `INPUT_CLASS`, then `FieldError`, then the hint `mt-1.5 text-[11px] leading-snug text-ink-muted`.
- **Ship-to block** (only when `shippingRatesEnabled`):
  - Wrapper `border-t border-line pt-4 mt-1`.
  - Heading row `flex items-center gap-2 mb-3`: `MapPin h-4 w-4 text-teal-dark` and `h3 text-sm font-semibold text-ink` "Shipping address".
  - Fields in `space-y-3`. Selects and inputs use `INPUT_CLASS`. City and Postal sit in `grid grid-cols-2 gap-3`.
- **Reassurance list:** `ul mt-1 space-y-2 border-t border-line pt-4`. Each `li` is `flex items-start gap-2 text-xs text-ink-muted` with `Check mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-teal-dark`. Lines:
  - "Payment details entered on the encrypted partner page"
  - "Receipt & tracking emailed to you"
  - "No card data ever touches our servers"

#### Column 2 — Complete your order (only if `addonsEnabled`)
- Card: the same as column 1.
- Head icon tile: `rounded-xl border border-teal/20 bg-teal/10` with `Droplets h-5 w-5 text-teal-dark`. Title "Complete your order"; subtitle "Reconstitution essentials".
- **Info box:** `rounded-xl border border-teal/20 bg-teal/5 p-3.5 mb-4`.
  - `p text-xs leading-relaxed text-ink`: "**Most peptides ship freeze-dried** (lyophilized) and must be reconstituted with **bacteriostatic water** before use. Add enough to mix everything in your cart."
  - If `peptideVials > 0`: `p mt-2.5 flex items-center gap-1.5 rounded-lg bg-white/70 px-2.5 py-1.5 text-[11px] font-medium text-teal-dark` with `FlaskConical h-3.5 w-3.5`, reading "{N} vial{s} in your cart — don't forget the water to reconstitute {it|them}."
- **WhatsApp card:** `<a href="https://wa.me/15147013824" target="_blank" rel="noopener noreferrer">`, classes `group mb-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-sm`.
  - Icon tile: `flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-white transition-transform duration-200 group-hover:scale-105` with `MessageCircle h-4 w-4`.
  - Text: "Not sure how to do this?" (`text-xs font-semibold text-ink`) and "Message us on WhatsApp and we'll guide you through it." (`text-[11px] leading-snug text-ink-muted`).
  - Trailing icon: `ArrowRight h-4 w-4 flex-shrink-0 text-emerald-600 transition-transform duration-200 group-hover:translate-x-0.5`.
- **Add-on list states:**
  - Loading: `space-y-2.5` with three `AddonSkeleton`s.
  - Empty: `rounded-xl border border-dashed border-line px-4 py-6 text-center`, `Droplets mx-auto mb-2 h-6 w-6 text-line`, and "Reconstitution supplies can be added on the secure checkout page." (`text-xs text-ink-muted`).
  - List: `motion.div variants=containerVariants initial="hidden" animate="show" className="space-y-2.5"`:
    - BAC-water rows first, as `featured`;
    - then, if both groups exist, a divider `flex items-center gap-2 pt-1` built from `span h-px flex-1 bg-line`, the label "Also recommended" (`text-[10px] font-medium uppercase tracking-wider text-ink-muted`) and another `span h-px flex-1 bg-line`;
    - then the other rows.

#### Column 3 — Your order (summary + CTA)
- Wrapper `lg:sticky lg:top-6` (sticky with a 24px offset at ≥1024px), then the card `rounded-2xl border border-line bg-white p-5`.
- Head: `ShoppingCart` in a surface tile. Title "Your order"; subtitle "{n} item{s}", where `n` is the number of cart **lines**.
- **Lines:** `divide-y divide-line/60`. Each line is a `flex items-start justify-between gap-3 py-3` row:
  - Name: `text-sm font-medium text-ink truncate`.
  - Meta: `mt-0.5 text-xs text-ink-muted` showing `"{strength} · "`, then a pill (`inline-flex items-center rounded-full border border-line bg-surface px-1.5 py-[1px] text-[10px] font-medium text-ink-muted`) reading "Pack of N" or "Single vial", then `<span class="ml-1.5">× {quantity}</span>`.
  - Right: `text-sm text-ink tabular-nums whitespace-nowrap` `$(price×qty)`.
- **`FreeShippingProgress`** (card) with `mt-4`.
- **Delivery block:** `mt-4 pt-4 border-t border-line`.
  - Header: `Truck h-4 w-4 text-teal-dark` and `h3 text-sm font-semibold text-ink` "Delivery".
  - Body copy: `text-xs leading-relaxed text-ink-muted`. Prices inside are `font-semibold text-ink`; "Free" is `font-semibold text-emerald-700`.
  - Loading: `flex items-center gap-2 text-xs text-ink-muted` with `Loader2 h-3.5 w-3.5 animate-spin` and "Checking courier rates…".
  - Rates list: `space-y-2`.
- **Discount code block:** `mt-4 pt-4 border-t border-line`.
  - Label: `mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink` with `Ticket h-3.5 w-3.5 text-ink-muted`.
  - Input row: `<form class="flex gap-2">`.
    - Input: `min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2 font-mono text-sm uppercase text-ink placeholder:font-sans placeholder:normal-case placeholder:text-ink-muted focus:border-teal focus:outline-none`. There is no ring; focus shows a teal border.
    - Apply button: `inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface disabled:opacity-50`, with `Loader2 h-3.5 w-3.5 animate-spin` while checking and the text "Apply".
  - Applied row: `flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2`.
    - Text: `text-sm text-emerald-800` with `<span class="font-mono font-semibold">CODE</span><span class="ml-2 text-xs">{description}</span>`.
    - Optional sub-lines, each `mt-0.5 block text-[11px] text-emerald-700`:
      - "Applied automatically from your welcome offer{ · first order only}."
      - "Not discounted by this code: {names, comma-joined, de-duplicated}."
      - "Your first-order discount is larger, so it applies instead." (when `!codeWins && codePercent > 0`).
    - Remove button: `rounded p-1 text-emerald-700 transition-colors hover:bg-emerald-100` with `aria-label="Remove discount code"` and `X h-3.5 w-3.5`.
  - Error: `mt-1.5 text-xs text-amber-700`.
  - Re-apply link: `mt-1.5 text-xs font-medium text-teal-dark hover:underline`.
- **Affiliate block:** `mt-4 pt-4 border-t border-line`.
  - Label: as for Discount code, with the icon `UserCheck` and the suffix `<span class="font-normal text-ink-muted">(optional)</span>`.
  - Input: `w-full rounded-lg border bg-white px-3 py-2 pr-9 font-mono text-sm text-ink placeholder:font-sans placeholder:text-ink-muted focus:outline-none`, plus the status border classes. It is **not** upper-cased.
  - Icon slot: `pointer-events-none absolute right-3 top-1/2 -translate-y-1/2`.
- **Totals:** see the previous section.
- **Already-applied callout:** `mt-3 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5`.
  - Icon: `BadgePercent mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600`.
  - Text: `text-[11px] leading-snug text-emerald-800`. The first `p` is `font-semibold`; the second is `mt-0.5 text-emerald-700`.
- **Tax note:** `mt-3 flex items-start gap-2 rounded-lg bg-surface px-3 py-2` with `Info w-3.5 h-3.5 text-ink-muted flex-shrink-0 mt-0.5` and "Any applicable taxes are added on the secure checkout page." (`text-[11px] leading-snug text-ink-muted`).
- **Error banner:** `mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3`, containing `flex items-start gap-2` with `AlertCircle w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5` and `div text-sm text-amber-800`. That div holds `<p>{error}</p>` and, when there are unmapped items, `ul mt-1 list-disc list-inside text-xs`.
- **CTA** `<button type="button">`: `group relative mt-5 w-full overflow-hidden inline-flex items-center justify-center gap-2 bg-ink hover:bg-ink/90 text-white font-semibold py-3.5 rounded-2xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-ink/15 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none text-sm`.
  - Geometry: 14px vertical padding, 18px radius, `#07203A` background; it lifts 2px on hover.
  - Shine overlay: `span pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full`, a 700ms sweep on hover.
  - Content:
    - idle: `ShieldCheck w-4 h-4`, "Continue to secure checkout", then `ArrowRight w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5`;
    - submitting: `Loader2 w-4 h-4 animate-spin` and "Redirecting…".
- **Helper text** (`mt-3 text-center text-xs text-ink-muted`): see the form section.
- **Verify notice** (when `verifyNoticeEnabled`): `mt-4 flex items-start gap-2 rounded-xl border border-teal/20 bg-teal/5 px-3.5 py-3` with `HelpCircle mt-0.5 h-4 w-4 flex-shrink-0 text-teal-dark` and `p text-[11px] leading-relaxed text-ink-muted`. Copy: "**A few quick questions first.** Our checkout partner runs a secure, encrypted page and will ask you to answer a short set of questions to confirm the order is really yours. Once they're answered you can pay, and we'll get your parcel moving." The bold part is `font-semibold text-ink`.
- **Trust badges:** `mt-4 flex items-center justify-center gap-5 pt-4 border-t border-line`. Two items, each `flex items-center gap-1.5 text-ink-muted` with a `h-3.5 w-3.5 text-teal-dark` icon and a `text-[11px]` label:
  - `ShieldCheck` "Secure checkout"
  - `Lock` "SSL encrypted"

#### Interaction and animation summary
- Focus styles:
  - Inputs using `INPUT_CLASS` and the email input: 2px teal/40 ring, transparent border.
  - Discount and affiliate inputs: border colour only.
  - Autocomplete input: ring like `INPUT_CLASS`, on a white background.
- Hover effects:
  - Add-on rows and the WhatsApp card lift 2px with `shadow-sm`.
  - Rate options change their border to teal/40.
  - The CTA lifts, gains a shadow and runs the shine sweep.
- Disabled state: the CTA and Apply button are 50% opacity, and the CTA shows `cursor-not-allowed`.
- Motion:
  - The page stagger uses framer variants.
  - The email check pops in with a spring.
  - The free-shipping bar width animates with a spring.
  - The loading skeleton uses `animate-pulse`.
  - Spinners use `animate-spin`.
- No exit animations are used. There is no `AnimatePresence` on the checkout.

---

### Post-payment pages

#### `/order/success` — `app/order/success/page.tsx`
- **Client.** It is a legacy page. Its comment says it is no longer part of the checkout flow.
- `OrderSuccessRedirect` uses `useSearchParams()` to read `order` and `email`.
  - Effect: `router.replace('/order/track?order=…&email=…')`, copying only the parameters that are present, or `'/order/track'` when there are none.
  - Renders `min-h-screen flex items-center justify-center bg-white` containing `flex items-center gap-3 text-ink`, with `Loader2 w-5 h-5 animate-spin` and "Taking you to your order…" (`text-sm`).
- The Suspense fallback is the same centred layout with "Loading…" (`text-ink text-sm`).
- No data calls.

#### `/order/track` — `app/order/track/page.tsx`
- **Client**. `OrderTrackContent` sits inside Suspense, whose fallback is "Loading..." (`text-ink text-sm sm:text-xl`, centred). The page has no Navigation or Footer.
- **State:**
  - `orderInput` = `?order` or `""`
  - `emailInput` = `?email` or `""`
  - `orderData` `null`
  - `loading` `false`
  - `error` `''`
  - `copied` `null`
- **Effects:**
  - If `?order` is present → `clearCart()`. **This is the only place the cart is cleared after checkout.**
  - If both `?order` and `?email` are present → auto-search.
- **`searchOrder(order, email)`:**
  - Empty order → error "Please enter an order number".
  - Empty email → error "Please enter the email address used on the order".
  - Otherwise `apiFetch('/api/orders?orderNumber=…&email=…')` (GET). On error it shows `err.message`, falling back to "Failed to find order".
  - Server errors:
    - 400 "Order number required"
    - 400 "Enter the email address used on the order to view it."
    - 404 "No order found matching that order number and email."
    - 500 "Failed to look up order"
  - The lookup queries the **`orders` table only** (native orders). Hosted (Stealth Health) orders live elsewhere (`puramass_orders` / `invoices`), so this page probably cannot find them. **Unverified** that partner orders are ever mirrored into `orders`.
  - Response fields used: `order_number`, `status`, `items[{name,quantity,price,strength?}]`, `total`, `crypto?`, `payment_amount_expected?`, `payment_tx_hash?`, `shipping_address{firstName,lastName,address,city,state,postalCode,country}`, `tracking_number`, `tracking_url?` (not rendered), `created_at`.
- **UI** (container `min-h-screen bg-white py-8 sm:py-12 px-4` → `max-w-2xl mx-auto`, max 672px):
  - **Header** (centred, `mb-6 sm:mb-8`):
    - Logo link `/`: the `vyta-mark.png` image (40px) and "VYTA" (`text-lg font-bold text-ink`).
    - `h1` "Track Your Order" (`text-2xl sm:text-3xl font-bold text-ink mb-1 sm:mb-2`).
    - Sub-line "Enter your order number to check status" (`text-ink-muted text-xs sm:text-sm`).
  - **Form:** card `bg-white rounded-xl border border-line shadow-sm p-3 sm:p-4 space-y-3`.
    - Labels: `block text-xs sm:text-sm font-medium text-ink-muted mb-1.5 sm:mb-2`.
    - "Order Number": input `#track-order`, upper-cased on change, placeholder "AMC-XXXXXXXX", `autoComplete=off`, classes `w-full px-3 sm:px-4 py-2.5 sm:py-3 border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-teal/40 font-mono uppercase text-xs sm:text-sm`.
    - "Email used on the order": `#track-email`, `type=email`, `autoComplete=email`, placeholder "you@example.com".
    - Submit button (`aria-label="Track order"`): `px-4 sm:px-6 py-2.5 sm:py-3 bg-ink text-white rounded-lg font-semibold hover:bg-ink/90 transition-all disabled:opacity-50 flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm`. It shows a CSS spinner (`animate-spin rounded-full h-4 sm:h-5 w-4 sm:w-5 border-2 border-white border-t-transparent`) while loading; otherwise `Search` and "Track" (the text is hidden below 640px).
  - **Error:** `mb-4 sm:mb-6 bg-red-50 border border-red-200 rounded-xl p-3 sm:p-4 flex items-start gap-2 sm:gap-3` with `AlertCircle text-red-600` and the message in `text-red-800 text-xs sm:text-sm`.
  - **Order card:** `bg-white rounded-2xl border border-line shadow-lg overflow-hidden`.
    - Header band `bg-ink px-4 sm:px-6 py-3 sm:py-4`, white text:
      - "Order Number" (`text-white/60 text-[10px] sm:text-sm`), then the number (`font-bold text-base sm:text-lg`).
      - Status pill: `px-2 sm:px-3 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-sm font-semibold` with UPPERCASE text, coloured by status:
        - pending → `text-yellow-600 bg-yellow-100`
        - received → cyan-600/100
        - confirmed and processing → blue-600/100
        - shipped → purple-600/100
        - delivered → emerald-600/100
        - expired and cancelled → red-600/100
        - anything else → slate-600/100
    - **Progress** (hidden for expired and cancelled):
      - Steps: "Placed", "Received", "Confirmed", "Processing", "Shipped", "Delivered", mapped from statuses `pending`, `received`, `confirmed`, `processing`, `shipped`, `delivered`. An unknown status maps to 0.
      - Each circle: `w-8 sm:w-10 h-8 sm:h-10 rounded-full`.
        - Active: `bg-emerald-500 text-white` with a `Check`.
        - Inactive: `bg-surface text-ink-muted border border-line` with the step number.
        - Current: also `ring-2 sm:ring-4 ring-emerald-200`.
      - Labels: `text-[8px] sm:text-xs font-medium`, `text-emerald-700` when active.
      - Connector track: `absolute top-4 sm:top-5 left-0 right-0 h-0.5 bg-surface -z-10 mx-6 sm:mx-10`, with a fill `bg-emerald-500` whose width is `step/5*100%`.
    - **Tracking** (if `tracking_number`): `bg-purple-50 rounded-xl p-3 sm:p-4 border border-purple-200` with `Truck text-purple-600`, the label "Tracking Number", the number in `code font-mono font-semibold text-purple-900`, and a copy button. The copy button is `bg-purple-100 hover:bg-purple-200 text-purple-600` and turns `bg-emerald-100 text-emerald-600` with a `Check` icon for 2s after copying, via `navigator.clipboard`.
    - **Two-column info** (`grid grid-cols-2 gap-4 sm:gap-6`):
      - "Order Date" (`Clock`): `toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})`.
      - "Total" (`Package`): `$X.XX CAD`, plus the crypto amount line if present.
    - **Transaction** (if `payment_tx_hash`): `bg-surface rounded-lg p-2 sm:p-3 break-all border border-line` with an explorer link. Explorers by chain: btc mempool.space, eth etherscan, sol explorer.solana.com.
    - **Shipping Address** (`MapPin`) block in `bg-surface p-2 sm:p-3 rounded-lg border border-line`, four lines:
      1. `{firstName} {lastName}`
      2. `{address}`
      3. `{city}, {state} {postalCode}`
      4. `{country}`
    - **Items:** `border-t border-line pt-4 sm:pt-6`, `h3` "Items". Each row is `flex justify-between items-center p-2 sm:p-3 bg-surface rounded-lg` with the name, strength, "Qty: n" and `$(price*qty)`.
  - **Help card:** `bg-white rounded-xl border border-line p-4 sm:p-6`.
    - Heading "Need Help?".
    - Text: "If you have questions about your order, please contact our support team with your order number: `{n}`".
    - Link "Contact Support →" → `mailto:support@vytabio.com` (`text-teal-dark hover:text-ink font-medium`).
  - **Back link:** "← Continue Shopping" → `/products` (`text-ink-muted hover:text-teal-dark`).

#### `/shipping-address/[token]` — `app/shipping-address/[token]/page.tsx`
- **Client**. It is the "Where should we send it?" page linked from the missing-address email. It shows the global `Navigation` and `Footer`.
- `token` comes from `useParams()`.
- **State:**
  - `data` `null` (`{order: OrderView, request:{submitted_at, expires_at}}`)
  - `loading` `true`
  - `loadError` `null` (`{kind, message}`)
  - `form` `EMPTY_FORM` (`{full_name:'', phone:'', address:'', address2:'', city:'', state:'', zip:'', country:'CA'}`)
  - `errors` `{}`
  - `submitting` `false`
  - `submitError` `null`
  - `saved` `null` (`{lines: string[], name}`)
  - `editing` `false`
- **Load** (`[token]`): `GET /api/shipping-address/{encodeURIComponent(token)}` with `no-store`.
  - On `!ok` → `loadError = {kind: json.error ?? 'not_found', message: json.message ?? 'We could not open this link.'}`.
  - On OK → `data = json`, and the form is prefilled:
    - `full_name = order.customer_name ?? ''`
    - `phone = order.customer_phone ?? ''`
    - address, address2, city and zip from `order.shipping_address`
    - `state` only if the address country is CA
    - `country = 'CA'`
  - On a network error → `{kind:'network', message:'We could not reach the server. Please check your connection and try again.'}`.
  - Server responses:
    - 404 `{error:'not_found', message:"We couldn't find an order for this link. Double-check you copied the whole link, or just reply to our email and we'll sort it out."}`
    - 410 `{error:'expired', message:'This link has expired. Reply to the email we sent you and we will send a fresh one right away.'}`
    - 429 `{error:'rate_limited', message:'Too many requests. Please wait a moment.'}`
    - 200 `{order:{reference, transaction_id, transaction_link, invoice_number, status, placed_at, paid_at, currency, customer_name, customer_phone, customer_email_masked, items:[{name, sku, quantity, unit_price, line_total}], subtotal, shipping, total, shipping_address}, request:{submitted_at, expires_at}}`
- **`set(key, value)`** updates the form and clears that key's error.
- **Submit:**
  1. Client-side `validateShippingAddress(form)`. This is the same validator as the server, and the phone is **optional** here.
  2. If it fails → `errors = check.errors` and stop.
  3. Otherwise `POST` to the same URL with JSON body = `form`.
  4. On `!ok` → `errors = json.errors` (if present) and `submitError = json.message ?? 'We could not save that. Please try again.'`.
  5. On OK → `saved = {lines: formatAddressLines(json.address ?? check.value.address), name: json.full_name ?? check.value.full_name}`, `editing=false`, and a smooth `scrollTo` top.
  6. On a network error → "We could not reach the server. Please try again in a moment."
  - Server POST errors:
    - 429 "Too many submissions. Please wait a moment."
    - 400 "Invalid request."
    - 400 "We only ship within Canada." (+ `errors.country`)
    - 400 "Please check the highlighted fields." (+ `errors`)
    - 500 `save_failed`
  - Success body: `{success:true, address, full_name, phone, submitted_at}`.
- **States:**
  1. **Loading:** inside `Centered` (`main min-h-screen bg-white`, Navigation, `mx-auto flex max-w-2xl flex-col items-center px-4 py-20`, Footer): `Loader2 h-6 w-6 animate-spin text-teal-dark` and "Opening your order…" (`mt-4 text-sm text-ink-muted`).
  2. **Load error:** inside `Centered`, a card `w-full rounded-2xl border border-line bg-white p-8 text-center`.
     - Icon circle: `h-12 w-12 rounded-full bg-amber-100` with `Clock` (expired) or `AlertCircle`, in `h-6 w-6 text-amber-600`.
     - `h1 text-xl font-bold text-ink mb-2`: "This link has expired" or "We couldn't open this link".
     - The message (`mx-auto max-w-md text-sm leading-relaxed text-ink-muted`).
     - Buttons:
       - "Contact us →" → `/contact` (`rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-white hover:bg-ink/90`).
       - "Browse products" → `/products` (`rounded-lg border border-line px-5 py-2.5 text-sm font-medium text-ink hover:border-ink/30`).
  3. **Thank-you / already on file.** Shown when `saved`, or when `request.submitted_at && !editing`. Layout: `max-w-2xl px-4 py-14`.
     - Icon circle: `h-14 w-14 rounded-full bg-emerald-100` with `CheckCircle2 h-7 w-7 text-emerald-600`.
     - `h1 text-2xl font-bold`:
       - saved: "Thank you — we’ve got it!"
       - on file: "Your address is already on file"
     - Body (`max-w-lg text-sm leading-relaxed text-ink-muted`):
       - saved: "Your shipping address is saved to your order. Our team will pack and process it within the next business day, and you’ll get a tracking email the moment it ships."
       - on file: "We already have a shipping address for this order. If anything below looks wrong, you can update it right here."
     - **"Shipping to"** card: `rounded-2xl border border-line bg-white p-6`.
       - Heading: `MapPin` and `text-sm font-semibold uppercase tracking-wider`.
       - `<address class="not-italic text-sm leading-relaxed text-ink">` with the name in bold and the address lines in `text-ink-muted`.
       - Button "Spotted a typo? Update the address" (`PencilLine`, `text-xs font-semibold text-teal-dark`). It sets `saved=null` and `editing=true`.
     - **"What happens next"** card: `rounded-2xl border border-line bg-surface/60 p-6`. It is an `ol space-y-4` of three steps. Each step has a 28px circle: `bg-emerald-100 text-emerald-600` for done, otherwise `bg-white text-teal-dark border border-line`.
       1. "Address received" — "It is attached to your order now — nothing else is needed from you." (done)
       2. "Packed and processed" — "Our team prepares your order within the next business day. Everything ships in plain, discreet packaging."
       3. "Tracking on its way" — "As soon as it leaves us, your tracking number lands in your inbox."
     - **`OrderCard`** (see below).
     - Closing card: "Questions about this order? Reply to the email we sent you, or **get in touch** (`/contact`). A real person answers." plus a "Continue shopping →" button → `/products`.
  4. **Form.** Layout: `max-w-2xl px-4 py-14`.
     - Intro:
       - Pill `inline-flex items-center gap-2 rounded-full bg-teal/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-teal-dark` with `MapPin` and "One quick step".
       - `h1 text-2xl sm:text-3xl font-bold` "Where should we send your order?"
       - Paragraph: "Thanks for ordering with us! Everything went through on our side — we just didn't catch a shipping address with your order. Fill it in below and we'll have your order processed and on its way **within the next business day**."
     - The `OrderCard`.
     - If an address is on file: an amber box (`rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900`) with "We have this on file — update it if it's not right:" and the one-line address.
     - Form card: `rounded-2xl border border-line bg-white p-6 sm:p-8`.
       - `h2` "Shipping address" (`text-lg font-bold`).
       - Sub-line "Please give us the address the courier should deliver to."
       - Grid: `grid grid-cols-1 gap-5 sm:grid-cols-2`.
     - `Field` wrapper:
       - Label: `mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-muted`. The required mark is `<span class="ml-0.5 text-teal-dark">*</span>`.
       - Error: `mt-1 flex items-center gap-1 text-xs text-red-600` with `AlertCircle h-3 w-3`.
       - Hint: `mt-1 text-xs text-ink-light`.
     - Input class: `w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink placeholder-ink-light focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/30`.
     - Fields:

| label | id / name | autoComplete | type | required | placeholder / hint | span |
|---|---|---|---|---|---|---|
| Full name | `full_name` / `name` | `name` | text | yes | "Who is the parcel addressed to?" | `sm:col-span-2` |
| Country | `country` / `country` | `country` | select (Canada only); change resets `state` | yes | — | `sm:col-span-2` |
| Street address | `address` / `address-line1` | `address-line1` | text | yes | "123 Main Street" | `sm:col-span-2` |
| Apartment, suite, unit | `address2` / `address-line2` | `address-line2` | text | no | "Apt 4B"; hint "Optional — but it helps the courier find you." | `sm:col-span-2` |
| City | `city` | `address-level2` | text | yes | — | 1 col |
| Province (`regionLabel`) | `state` | `address-level1` | select "Select…" + provinces | yes for CA/US | — | 1 col |
| Postal code (`postalLabel`) | `zip` / `postal-code` | `postal-code` | text | yes | — | 1 col |
| Phone | `phone` / `tel` | `tel` | tel | no | hint "Optional — couriers use it for delivery issues only." | 1 col |

     - Validation copy (from `validateShippingAddress`):
       - "Please tell us who the parcel is addressed to."
       - "Please enter a street address."
       - "Please enter a city."
       - "Please enter a postal or ZIP code."
       - "Please choose a country."
       - "Please choose a province." / "Please choose a state."
       - Length limits (silently truncated): full_name 120, phone 40, address 200, address2 200, city 100, state 80, zip 20, country 40.
     - Submit error: `mt-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700`.
     - Submit button: `mt-7 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-6 py-3.5 text-sm font-semibold text-white hover:bg-ink/90 disabled:opacity-60`. Text "Save address & process my order →", or `Loader2` + "Saving…" while submitting.
     - Footnote: `Lock h-3 w-3` + "Used only to ship this order. Every parcel goes out in plain, discreet packaging." (`text-xs text-ink-light`, centred).
     - Below the card: "Would rather just tell us? **Message our team** (`/contact`) — or simply reply to the email we sent you."
- **`OrderCard`:** `rounded-2xl border border-line bg-white overflow-hidden`.
  - Header: `border-b border-line bg-surface px-5 py-3` with `Package` and "Your order" (`text-sm font-semibold uppercase tracking-wider`). If `status==='paid'`, a pill "Paid" (`ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700` with `CheckCircle2 h-3 w-3`).
  - Items: `divide-y divide-line/60`. Each row (`px-5 py-3`) shows the name, the SKU (`font-mono text-[11px] text-ink-light`), `×qty` and the `line_total` (or `unit_price*qty`) in a `w-20 text-right` cell. With no items, it shows "Your order items".
  - Totals:
    - "Subtotal" and "Shipping" rows.
    - "Total paid" (`border-t border-ink/80 pt-2 text-base font-bold`).
    - Money format: `$X.XX {currency}`, or "—" when null.
  - `dl` (`bg-surface/60 px-5 py-4 text-xs`): Invoice, Transaction (linked, with `ExternalLink`), Order reference, Placed (`toLocaleDateString(undefined,{year,month:'long',day})`), and "Confirmation sent to" (masked email).

#### `/account/orders` (skimmed; signed-in only)
- `AuthGuard` protects `/account/*`. Signed-out visitors are redirected to `/login?redirect=…`.
- `getCustomerOrders(customer.id)` merges two sources:
  - `orders` for this customer;
  - `invoices` with `source='stealth_health'` and status not in `(draft, pending_payment, expired)`.
- So a paid hosted order appears here as an invoice row, and its method label shows "Secure checkout".
- Detail page `/account/orders/[id]`: it can download an invoice (`/api/customer/orders/{id}/invoice?download=1`) and claim an order (`/api/customer/orders/{id}/claim`). Not detailed further: outside the checkout path.

---

### Checkout — config inputs read

| Source | Field | Default (client) | Read by | Effect |
|---|---|---|---|---|
| `GET /api/admin/settings` → `settings.guest_checkout_enabled` | bool | `true` | CheckoutRouter | `false` + no customer → "Account required" gate. **Not enforced by `/api/checkout/puramass`** (no guest check found there) |
| `settings.puramass_shipping_rates_enabled` | bool | `false` | CheckoutRouter | Shows the address form and courier picker, sends `shipping` in the payload, and enables the shipping gating. The server checks its own copy |
| `settings.checkout_addons_enabled` | bool | `true` | CheckoutRouter | Shows column 2 and fetches add-ons; grid is 3 vs 2 columns |
| `settings.checkout_verify_notice_enabled` | bool | `true` | CheckoutRouter | Shows the "A few quick questions first." notice |
| `settings.puramass_flat_shipping` | number ≥0 | `35` | CheckoutRouter | Flat fee copy and fallback shipping cost; `0` → "Free" copy |
| `settings.puramass_free_shipping_active` | bool (server: rates on && enabled && threshold>0) | `false` | CheckoutRouter + PromosContext | Free-shipping progress card and zeroed shipping |
| `settings.puramass_free_shipping_threshold` | number | `0` | CheckoutRouter + PromosContext | Threshold for the above (on the pre-discount subtotal) |
| `settings.ad_discount_active` / `ad_discount_percent` (`ad_discount_enabled` also stored) | bool / number | `false` / `25`→`Number()||0` once loaded | PromosContext | First-order paid-ads discount (needs signed-in, first order, paid channel) |
| `settings.cart_offer_active` / `cart_offer_min_items` / `cart_offer_percent` / `cart_offer_ends_at` | bool / int / number / ISO | `false` / `1` (fallback after load; `2` before) / `0` / `null` | PromosContext | Limited-time cart offer line |
| `GET /api/promos/first-order` → `firstOrder` | bool | `false` | PromosContext | Ad-discount eligibility |
| `GET /api/promos/landing` → `offer`, `eligible`, `reason` | — | no offer | PromosContext | Landing code auto-apply and re-apply link |
| Cookie `ref_code` | string | `""` | checkout | Affiliate field prefill |
| Cookie `vyta_lp` | presence | absent | PromosContext | Whether to fetch the landing offer |
| Cookies `aminocan_attr`, `aminocan_attr_last` | JSON touch | — | PromosContext | Paid-channel detection |
| URL `?discount=` / `?code=` | string | — | checkout | Auto-apply a discount code |
| `useCustomer().customer` | row | `null` | checkout | Prefill email, names and phone; account gate; Bearer tokens |
| `siteConfig.authEnabled` (`lib/config.ts`, hard-coded `true`) | bool | `true` | AuthGuard | Route guarding (checkout is public) |
| `SiteConfigContext` | — | — | **not used** by checkout, order or shipping-address pages | — |
| Env vars | `NEXT_PUBLIC_SUPABASE_URL` (falls back to a hard-coded project URL), `NEXT_PUBLIC_SUPABASE_ANON_KEY` | — | `lib/supabase.ts` | Auth session only. The checkout reads no other env vars client-side |

---

### Checkout — unverified / porting notes

**Brand and other hard-codes to replace on a sibling site:**
- Wordmark "VYTA" and the subtitle "Secure Checkout".
- Logo `/images/vyta-mark.png`. The loading screen uses a `Beaker`-in-navy tile instead.
- WhatsApp link `https://wa.me/15147013824`.
- Support email `support@vytabio.com` on `/order/track`.
- Track placeholder "AMC-XXXXXXXX".
- Phone placeholder "(416) 555-0199".
- Copy "Add some research compounds before checking out."
- The BAC-water regex and the reconstitution copy, which are product-specific.
- Canada-only shipping (`SHIPPING_COUNTRIES`, and the autocomplete forces `CA`).
- CAD wording.
- The default country `"CA"`.
- Courier whitelist UPS and Canada Post (server).
- Partner name "Stealth Health" in comments and logs only.

**Odd behaviours and porting cautions:**
1. **Account gate flicker.** `accountRequired` ignores `CustomerContext.isLoading`. With guest checkout off, signed-in users briefly see "Account required". Its "Sign in" button links to `/`, not `/login`.
2. **Guest checkout is UI-only.** No guest check was found in `/api/checkout/puramass`.
3. **`required` attributes are inert.** There is no wrapping `<form>`. The email input has no `required` at all.
4. **Province is not validated client-side.** Only the server rejects a missing province (400 "Enter a complete shipping address." with an inline "Please choose a province."). Server errors for `country` and `full_name` have no inline slot.
5. **Street edits do not re-quote.** The quote effect does not depend on `shipping.address`, only on country, zip, city, state and `addressReady`.
6. **Any shipping or phone keystroke clears all `addressErrors`.** The amber `error` banner persists until the next submit.
7. **`TEMP DEBUG` logging.** `console.error` calls in the rate effect are marked for removal.
8. **The 409 unmapped message is client-authored.** It replaces the server's wording.
9. **Fallback after a rates HTTP error.** If the rates call fails, the client falls back to its own `flatShipping` prop (from settings) and sends `courier_id: null`. The server's `resolveHostedShipping` then re-quotes:
   - If the quote is not live, it charges the flat `rates[0]`, which matches what was shown.
   - If the quote is now live, `selectHostedRate(null)` returns null and the server answers 409 with `rates`. The client then shows the picker and the error "Those shipping options have changed. Please choose a delivery method again."
10. **Landing-code mismatch.** The server applies the landing code on its own whenever `discountCode` is empty and the buyer did not decline it. If a URL code fails, `codeInput` keeps the bad code, so the client never auto-applies the landing code and the UI may **understate** the discount actually charged.
11. **Discount math caveats.** The cart offer's minimum counts **units** (`totalItems = Σ quantity`). The free-shipping threshold uses the **pre-discount** subtotal. Both mirror the server per its comments; the server code was not verified in this section.
12. **`submitting` stays true after redirect.** If the browser restores the page from bfcache on Back, the CTA may remain on "Redirecting…". **Unverified.**
13. **No return URL is set.** Where the hosted page sends the buyer after payment is **unverified** (partner configuration). The cart is never cleared on that path unless the buyer opens `/order/track?order=…`.
14. **`/order/track` may not find hosted orders.** It reads only the `orders` table. **Unverified** whether partner orders are mirrored there. `/order/success` is a pure redirect to it.
15. **Analytics.**
    - Client side: GA4 `begin_checkout` only, fired after the server succeeds and just before redirect.
    - The `checkout_start` activity row is sent to `/api/customer/activity`.
    - No `add_payment_info` or `purchase` fires client-side.
    - Klaviyo onsite does not forward `begin_checkout`; "Started Checkout" is server-side.
16. **The settings endpoint is fetched twice per load** (CheckoutRouter and PromosContext). `/api/admin/settings` GET is unauthenticated and its `shape()` also returns `admin_emails`, `invoice_cc_emails` and the email templates to any caller. That is a privacy concern to fix when porting.
17. **Inconsistent explainer copy.** With live rates off, the explainer says "Shipping and any applicable taxes are added there." Meanwhile the summary already shows and totals the flat fee, and the server sends that fee as `shipping_total_cents`.
18. **Input style variants differ.** Contact fields use a `bg-surface` fill with a ring; the autocomplete uses white `py-3` with a 14px radius; the code fields use white with a border-only focus. Port them as-is if pixel parity matters.
19. **`text-line` icons.** These render in `#DCE7EB` (very faint). This is intentional for placeholders.
20. **`cart_offer_min_items` fallbacks.** PromosContext uses `|| 1` once loaded, while `DEFAULT_CART_OFFER.minItems` is 2 before the settings load.
21. **Add-on prices.** "from $X" uses customer-resolved prices from `/api/products?addon=1`. The pack price shown equals the price charged (comment in code).

---

## Part 3 — Checkout server, pricing engine and payment partner API

Source repo: `thepuragroup-droid/vyta-rtl-x` (Next.js 15 App Router + Supabase). Everything below was read from code. Anything I could not confirm from code is under **Unverified** at the end.

**Vocabulary.** "Stealth Health" and "PuraMass/Puramass" are the same partner. Code identifiers say `puramass`, user-facing strings and comments say "Stealth Health". The hosted checkout is the **only** live checkout. The legacy `POST /api/orders` now returns 410.

**Big picture.** The browser never sends prices. `POST /api/checkout/puramass` does the following, in order:

1. Re-prices the cart from the catalog.
2. Maps each line to a partner SKU.
3. Decides every discount on the server.
4. Re-quotes shipping.
5. Creates a hosted order at the partner (`POST https://api.stealth.health/partner/store/orders`).
6. Writes a ledger row (`puramass_orders`) and a `pending_payment` invoice (`invoices` + `invoice_line_items`).
7. Fires the Klaviyo "Started Checkout" event (inside `after()`).
8. Returns the `payment_link`. The browser redirects to it.

Payment happens on the partner's domain. Payment confirmation arrives later, through a webhook or a poller. Only at that point are stock taken, commission recorded, the shipment booked and the emails sent.

**Supabase clients.** None of the routes in scope use the anon browser client `supabase` from `lib/supabase.ts`. Every route uses a service-role client, built in one of two ways:
- **(a)** Module-scope `createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)`. Used by `checkout/puramass`, `checkout/puramass/rates`, `checkout/discount-code`, `checkout/referral-code`, `promos/landing` and `webhooks/stealth-health`.
- **(b)** `getSupabase()` from `lib/supabase.ts`. It uses the service role key and falls back to `NEXT_PUBLIC_SUPABASE_ANON_KEY` if the service key is unset, with `{auth:{autoRefreshToken:false,persistSession:false}}`. Used by `promos/first-order`, `orders`, `orders/my-orders` and `site-config`.

In this document, "service role" means either of these.

---

### Server — API routes

#### Shared: rate limiter (`lib/rate-limit.ts`)

- It is an in-memory `Map<string,{count,resetAt}>`, held per server instance. It is **not** distributed.
- `checkRateLimit(key, {max, windowMs})`:
  - The first hit, or a hit after `resetAt`, sets `count = 1` and `resetAt = now + windowMs`, then returns `{allowed:true, retryAfter:0}`.
  - If `count >= max`, it returns `{allowed:false, retryAfter: ceil((resetAt-now)/1000)}`.
  - Otherwise it increments `count`.
- `RATE_LIMITS = { orders: {max:5, windowMs:60_000}, general: {max:60, windowMs:60_000} }`.
- `getClientIp(req)` returns, in order: the first entry of `x-forwarded-for`, trimmed; then `x-real-ip`; then `'127.0.0.1'`.

#### Shared: bearer auth pattern

- `const token = req.headers.get('authorization')?.replace('Bearer ', '')`, followed by `db.auth.getUser(token)` on the service-role client.
- The storefront session is held in localStorage, so the browser sends `Authorization: Bearer <access_token>`. Cookies are not used for auth.

---

#### `POST /api/checkout/puramass` — create the hosted order (THE order endpoint)

File: `app/api/checkout/puramass/route.ts`. It imports `after` from `next/server`.

**Auth:** optional bearer. A guest gets `customerId = null`. A bearer that fails to resolve is silently treated as a guest.

**Rate limit:** key `puramass:${ip}`, `RATE_LIMITS.orders` (5 per 60s per IP).

##### Request body (JSON)

```ts
{
  items: Array<{
    id: string;          // products.id (uuid)
    packSize: number;    // vials in ONE unit of the line: 1 = single vial, N>1 = pack of N
    quantity: number;    // TOTAL VIALS in the line (client sends units * packSize)
  }>;
  customer: {
    email: string;
    firstName?: string;
    lastName?: string;
    phone?: string;      // falls back to shipping.phone
  };
  shipping?: {           // client sends it only when hosted live rates are enabled
    full_name?: string;  // server prefers `${firstName} ${lastName}`
    phone?: string;
    address?: string; address2?: string; city?: string;
    state?: string; zip?: string; country?: string;  // ISO-2, client default "CA"
    courier_id?: string | null;   // Easyship courier_service id, or 'flat'
  };
  referralCode?: string;         // affiliate ref code (raw, stored as typed, trimmed)
  discountCode?: string;         // discount code typed / auto-filled by the landing page
  declineLandingOffer?: boolean; // true ONLY when the buyer removed the landing page code
}
```

The real client (`app/checkout/PuramassCheckoutContent.tsx` around lines 822–852) sends:
- `items[i] = { id: it.productId, packSize: it.packSize, quantity: it.quantity * it.packSize }`
- `customer = { email, firstName, lastName, phone: shipping.phone }`
- `shipping = shippingRatesEnabled ? { ...shippingForm(country,address,address2,city,state,zip,phone), full_name, courier_id } : undefined`

##### Processing, in exact order (every early return is listed)

1. **Rate limit.**
   - On block → `429 {"error":"Too many requests. Please try again shortly."}` with header `Retry-After: <seconds>`.
2. **Partner configured?** `isPuramassConfigured()` (both `PURAMASS_API_KEY` and the partner id are truthy).
   - If not → `503 {"error":"Hosted checkout is not available right now."}`.
3. **Settings.** `readSiteSettings()` runs `db.from('site_settings').select('*').limit(1).maybeSingle()`.
   - On error or throw it returns `{}`, which every shaper reads as "nothing on".
   - This DB read happens **before** the body is parsed.
4. **Parse body.**
   - On failure → `400 {"error":"Invalid JSON"}`.
   - `rawItems = Array.isArray(body.items) ? body.items : []`. If empty → `400 {"error":"Your cart is empty."}`.
   - `email = String(body.customer.email ?? '').trim()` must match `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`.
     - Failure → `400 {"error":"Enter a valid email address."}`.
   - `firstName` and `lastName` are trimmed, and an empty string becomes `undefined`. Both are required.
     - Failure → `400 {"error":"Enter your first and last name."}`.
   - `phone = String(body.customer.phone ?? body.shipping.phone ?? '').trim()` must pass `isValidPhone`. The rule (`lib/phone.ts`):
     - The raw value matches `/^\+?[\d\s().-]+$/`.
     - It has 10 to 15 digits.
     - Failure → `400 {"error":"Enter a valid phone number.","fields":{"phone":"Enter a valid phone number."}}`.
   - `referralCode = String(body.referralCode ?? '').trim() || null`. It is not validated.
   - `discountCodeInput = String(body.discountCode ?? '').trim() || null`.
   - `declineLandingOffer = body.declineLandingOffer === true`.
5. **4b. Ship-to.**
   - `shippingSettings = shapeHostedShippingSettings(settingsRow)` (see pricing).
   - `address = validateShippingAddress({ full_name: [firstName,lastName].join(' ') || shipping.full_name, phone, address, address2, city, state, zip, country })`.
     - This comes from `lib/payments/puramass-address.ts`. It trims each field and caps its length: full_name 120, phone 40, address 200, address2 200, city 100, state 80, zip 20, country 40 (country is upper-cased).
     - Errors, verbatim, keyed by field:
       - `full_name`: `"Please tell us who the parcel is addressed to."`
       - `address`: `"Please enter a street address."`
       - `city`: `"Please enter a city."`
       - `zip`: `"Please enter a postal or ZIP code."`
       - `country`: `"Please choose a country."`
       - `state` (only when country is US or CA): `"Please choose a state."` for US, `"Please choose a province."` for CA.
     - `value = { address:{address, address2||null, city, state, zip, country}, full_name, phone: phone||null }`.
   - **Country gate:** `shipCountry = String(body.shipping.country ?? '').trim()`. If it is non-empty and `!isShippableCountry(shipCountry)` (only `CA` is allowed, case-insensitive):
     - → `400 {"error":"We only ship within Canada.","fields":{"country":"We only ship within Canada."}}`.
     - The check is skipped when no country was sent, which is the flat-fee checkout.
   - If `shippingSettings.ratesEnabled && !address.ok`:
     - → `400 {"error":"Enter a complete shipping address.","fields": address.errors}`.
     - With rates off, the address is **not** required. The partner collects it on its hosted page instead.
6. **5. Normalise lines.** For each raw item:
   - `id = String(line.id).trim()`, `packSize = Number(line.packSize)`, `quantity = Number(line.quantity)`.
   - The line is skipped silently if `!id`, if packSize is non-finite or ≤0, or if quantity is non-finite or ≤0.
   - `vials = Math.round(quantity)`. `totalVials += vials`.
   - `cartUnits += Math.max(1, Math.round(vials / Math.round(packSize)))`. This is the unit count the cart offer is measured against.
   - Push `{ id, packSize: Math.round(packSize), vials }`.
   - If nothing survives → `400 {"error":"Your cart is empty."}`.
7. **6. Customer id.** If a bearer was sent: `db.auth.getUser(token)` → `customerId = user?.id ?? null`. A throw gives `null`.
8. **7. Load products.**
   - Query: `db.from('products').select('id, name, price, vial_price, vials_per_box, pack_options, puramass_sku, puramass_sku_vial').in('id', ids)`.
   - On error, fallback query: `select('id, name, price, vial_price, vials_per_box, puramass_sku')`.
   - If the fallback also errors → `500 {"error":"Could not load your cart."}`.
   - Inactive products are **not** filtered out here.
9. **7a. SKU mapping.** For each line:
   - `asBox = packSize > 1`.
   - `mapping = asBox ? 'box' : 'vial'`.
   - `packSize = asBox ? packSize : 1`.
   - `units = clampPacks(asBox ? max(1, round(vials/packSize)) : vials)`, where `clampPacks(n) = Math.min(99, Math.max(1, n))`.
   - So every pack of more than one vial (3, 5, 10, 20…) maps to the **case SKU** `products.puramass_sku`, one unit per pack. A single vial maps to `products.puramass_sku_vial`, with the unit count equal to the vial count.
10. **8. Price + merge.**
    - `unitCentsByLine = priceCartLines(normalized, byId, customerId)` (see pricing engine). It is keyed `${productId}::${packSize}` and holds the cents for **one pack**.
    - Merge key is `${sku}::${packSize}`:
      - `quantity = clampPacks(prev + units)`.
      - `unitPriceCents = prev.unitPriceCents || unitCentsByLine.get(...) || 0`. It uses `||` so a zero price never blocks a sibling product that shares the SKU.
      - `productId` and `productName` are taken from the first line merged in.
    - A line with no SKU (trimmed) adds a label to `unmapped`: `"${name} (single vial)"` or `"${name} (pack of ${packSize})"`.
    - If `unmapped.length` → `409 {"error":"Some items are not available for hosted checkout.","unmapped":[...labels]}`.
11. **8a.** If any merged line has `unitPriceCents <= 0`:
    - It logs `[puramass] hand-off refused: no price for <skus>`.
    - → `500 {"error":"We could not price your cart. Please try again or contact support."}`.
12. **8b. Automatic promos.**
    - `visitor = readVisitorContext(req.cookies)`.
    - `adDiscountSettings = shapeAdDiscountSettings(settingsRow)`.
    - `earnedAd = earnsAdDiscount(...)` (see pricing engine).
    - `cartOfferSettings = shapeCartOfferSettings(settingsRow)`.
    - `earnedOffer = qualifiesForCartOffer(cartOfferSettings, cartUnits)`.
13. **8c. Discount code.**
    - `listSubtotalCents = Σ unitPriceCents*quantity` over the merged lines.
    - `codeLines = [{productId, amount: unitPriceCents*quantity/100}]`.
    - Landing fallback: if no code was typed, `!declineLandingOffer`, and the `vyta_lp` cookie holds a valid slug:
      - Run `resolveLandingOffer(db, slug)`.
      - If it returns an offer with a code: `codeToApply = offer.code` and `codeFromLanding = true`.
    - If `codeToApply`, call `lookupDiscountCode(db, codeToApply, { subtotal: listSubtotalCents/100, customerId, email, lines: codeLines })`. The email used is the one from the request body.
      - **ok:** `appliedCode = { id, code, percent, excluded: Set(lower-cased excluded_product_ids), eligibleCents: round(eligibleSubtotal(codeLines, excluded)*100) }`.
      - **not ok and the code came from the landing page:** it logs `console.info('[puramass] landing offer %s not applied for this buyer: %s', slug, reason)` and continues without a code.
      - **not ok and the buyer typed the code** → `400 {"error": <REJECTION_MESSAGES[reason]>, "discount_code_error": true}`. The messages are listed under the discount-code route.
14. **Decide the percentages and split the discount** (see the pricing engine for the exact maths). This yields `discount` (or null), `discountedBySku`, `items` (the partner payload) and `ledgerItems`.
15. **9. Shipping.**
    - `goodsSubtotal = Σ unitPriceCents*quantity/100` (list price, before any discount).
    - `freeShipping = shippingSettings.freeShippingEnabled ? qualifiesForFreeShipping(settings, round2(goodsSubtotal)) : false`.
    - `resolveHostedShipping(settings, String(shipping.courier_id).trim()||null, {country, postal_code: zip, city, state}, totalVials, freeShipping)`. The destination comes from `address.value`, even when that value is invalid (the rates-off path never uses it).
    - If `rate === null` → `409 {"error":"Those shipping options have changed. Please choose a delivery method again.","rates": HostedShippingRate[]}`.
    - `shippingTotalCents = Math.round(rate.total_charge * 100)`.
16. **10.** `partnerReference = 'amc_' + crypto.randomUUID()` from `node:crypto`. It is a fresh value on every request.
17. **11. Create the partner order.** `createPuramassOrder({ items, customer:{email, first_name, last_name, phone}, partnerReference, currency:'cad', shippingTotalCents })`.
    - A `PuramassApiError` with `400 <= status < 500` → `NextResponse.json({error: err.detail}, {status: err.status})`. The sanitised partner message is passed through.
    - Any other `PuramassApiError` → `502 {"error":"Checkout is temporarily unavailable."}`. This covers 5xx, 502 "Could not reach Stealth Health", 504 timeout, 503 not configured, and 500 `No price for <sku>` from the body builder.
    - Any non-`PuramassApiError` throw → `502 {"error":"Checkout is temporarily unavailable."}`.
18. **12. Ledger insert** into `puramass_orders`. It is best-effort, uses 7 progressively smaller column sets, and is documented in the order-record section.
    - **If the insert fails for any reason, the response is still 200 with the payment link.**
19. **12b. Pending invoice.** Only runs if the ledger insert returned an id: `await createPendingStealthHealthInvoice(db, {...})`. It is awaited, best-effort and never throws.
20. **Visitor attribution** (fire-and-forget with `void`, **not** inside `after()`):
    - `linkVisitorIdentity(db, anonymousId, {email, customerId})`
    - `stampVisitorMilestone(db, anonymousId, 'checkout_at')`
21. **Klaviyo.** `after(() => trackStartedCheckout(db, {...}))` runs after the response is sent.
22. **Response 200:**

```jsonc
{
  "payment_link": "https://…",          // redirect target
  "transaction_id": "…",                // partner id
  "status": "payment_pending",          // partner status (default 'payment_pending')
  "shipping_total": 18.4,               // CAD, rate.total_charge (0 when free)
  "free_shipping": true,
  "ad_discount_percent": 25,            // discount && usedAd ? settings.percent : 0
  "discount_code": "STANDARDS35" | null,// appliedCode?.code (even if it lost to the ad discount)
  "discount_code_percent": 35,          // discount && codeBeatsAd ? code.percent : 0
  "discount_code_from_landing": false,  // codeFromLanding && appliedCode !== null
  "cart_offer_percent": 10,             // discount && earnedOffer ? offer.percent : 0
  "discount_percent": 32.5,             // overallPercent (see pricing)
  "ad_discount": 303.88                 // whole saving in CAD = discount.discountCents/100 (any promo), else 0
}
```

**DB reads, in order:**
- `site_settings(*)`
- `auth.getUser`
- `products(...)` and possibly its fallback
- inside `resolvePriceMap`: `products(id,price)`, `pricelists(id) where is_active`, `pricelist_items(product_id,price)`, `customer_price_overrides(product_id,override_price)`
- inside `earnsAdDiscount`: `customers(attribution_channel)`, `customers(has_completed_first_order)`, `puramass_orders` count
- inside landing resolution: `landing_pages(*)`, `discount_codes(*)`
- inside `lookupDiscountCode`: `discount_codes(*)`, `affiliates(active)`, `puramass_orders` count, and the first-order reads
- inside the Easyship quote: `site_settings(*)` again, via `getShippingConfig`

**DB writes:**
- `puramass_orders` insert
- `invoices` insert
- `invoice_line_items` insert
- `puramass_orders.invoice_id` update
- `visitor_attribution` updates

**External calls:**
- Easyship `POST {EASYSHIP_API_URL||https://public-api.easyship.com/2024-09}/rates`, only when rates are enabled.
- Partner `POST /partner/store/orders`.
- Klaviyo `POST https://a.klaviyo.com/api/events`, after the response.

---

#### `POST /api/checkout/puramass/rates` — courier options for the checkout screen

File: `app/api/checkout/puramass/rates/route.ts`.
- **Auth:** none.
- **Rate limit:** `puramass-rates:${ip}`, `RATE_LIMITS.general` (60/min). Blocked → `429 {"error":"Too many requests. Please try again shortly."}` with `Retry-After`.
- **Body:** `{ vials: number, destination: { country, postal_code, city, state? } }`.

**Validation:**
- An invalid JSON body → `400 {"error":"Invalid JSON"}`.
- `country` is trimmed and upper-cased. `postal_code`, `city` and `state` are trimmed.
- If any of country, postal_code or city is missing → `400 {"error":"Enter a full address to see shipping options."}`.

**Processing:** `quoteHostedRates(db, {country, postal_code, city, state}, Number(body.vials))`, returned **verbatim** as JSON.

**Response:**
```ts
{ live: boolean; rates: HostedShippingRate[]; note: string|null;
  settings: { ratesEnabled, flatShipping, freeShippingEnabled, freeShippingThreshold };
  debug?: string }   // "TEMP DEBUG" field — leaks e.g. "easyship not configured (enabled=false, apiKey=missing)"
```

`HostedShippingRate = { courier_id, courier_name, service_name, min_delivery_time, max_delivery_time, total_charge /*CAD, fee folded in*/, currency }`.

`note` takes one of these values:
- `null`
- `'Live shipping rates are unavailable right now.'` (Easyship threw)
- `'No courier rates were returned for this address.'` (nothing left after filtering)

The route only reads and creates nothing. The amounts are re-quoted at hand-off.

---

#### `POST /api/checkout/discount-code` — preview a code (display only)

File: `app/api/checkout/discount-code/route.ts`.
- **Auth:** optional bearer. When present, it supplies `customerId = user.id` and `email = user.email`. A guest's email is **deliberately not** taken from the body.
- **Rate limit:** `discount-code:${ip}`, `{max:15, windowMs:60_000}`. Blocked → `429 {"ok":false,"error":"Too many attempts. Please wait a moment."}` with `Retry-After`.
- **Body:** `{ code: string, subtotal?: number /*CAD list*/, items?: Array<{productId: string, amount: number /*CAD line list total*/}> }`.
  - An invalid JSON body is read as `{}`.
  - `items` is filtered to entries where productId is truthy, amount is finite and amount ≥ 0.
  - If `items` is absent, `lines` is undefined and the whole subtotal counts as eligible.

**Processing:** `lookupDiscountCode(db, body.code, { subtotal: finite? subtotal : 0, customerId, email, lines })`.

**Responses (always HTTP 200 unless rate-limited):**
- Fail: `{ "ok": false, "error": <message> }`
- Success:
  ```json
  { "ok": true, "code": "CODE", "percent": 15, "discount_type": "percent"|"fixed",
    "discount_value": 15, "description": "15% off" | "$20.00 off",
    "first_order_only": false, "excluded_product_ids": ["uuid", ...] }
  ```
  The affiliate is never named. `description = describeDiscount(code)`: fixed codes give `` `$${v.toFixed(2)} off` ``, percent codes give `` `${+v.toFixed(2)}% off` ``.

**Rejection messages (`REJECTION_MESSAGES` in `lib/affiliate/discount-codes.ts`, verbatim):**

| reason | message |
|---|---|
| not-found | `That code isn't valid.` |
| inactive | `That code is no longer active.` |
| not-started | `That code isn't active yet.` |
| expired | `That code has expired.` |
| used-up | `That code has reached its usage limit.` |
| below-minimum | `Your order is below the minimum for that code.` |
| own-code | `You can't use your own affiliate code.` |
| first-order-only | `That code is for first orders only.` |
| first-order-unverified | `We couldn't check that code right now. Please try again.` |
| nothing-eligible | `That code doesn't apply to the items in your cart.` |

---

#### `POST /api/checkout/referral-code` — does an affiliate code match anyone?

File: `app/api/checkout/referral-code/route.ts`.
- **Auth:** none.
- **Rate limit:** `referral-code:${ip}`, `{max:15, windowMs:60_000}`. Blocked → `429 {"error":"Too many attempts. Please wait a moment."}`.
- **Body:** `{ code: string }`. An invalid JSON body is read as `{}`.
- `code` is trimmed if it is a string. If it is empty or longer than 64 characters → `200 {"match": false}`.

**Processing:** `resolveReferralCodeOwner(db, code)` (`lib/affiliate/commission.ts`). These are the same rules the paid sale is credited by.
1. `lookup = code.trim().toUpperCase()`. Nothing else is stripped.
2. `referral_codes.select('id, code, affiliate_id, active').eq('code', lookup).eq('active', true).limit(1).maybeSingle()` → `via 'referral_code'`.
3. If there is no match: `discount_codes.select('id, code, affiliate_id, commission_rate, active').eq('code', lookup).limit(1).maybeSingle()`. It must have `affiliate_id` and `active !== false` → `via 'discount_code'`, with `commissionRate = Number(commission_rate)` or null.
4. `affiliates.select('active').eq('id', affiliateId)`. If the affiliate is missing or `active === false`, the result is null.
5. If `referralCodeId` is still null, the affiliate's live referral code is looked up: `referral_codes.eq('affiliate_id').eq('active', true).limit(1)`.
6. Never throws. Errors give null.

**Response:** `200 {"match": boolean}`. The affiliate is never named.

---

#### `GET /api/promos/first-order` — is the signed-in buyer still on their first order (display only)

File: `app/api/promos/first-order/route.ts`. Uses `getSupabase()`.
- **Auth:** bearer is **required**.
  - Missing token → `401 {"firstOrder": false}`.
  - `getUser` returns no user → `401 {"firstOrder": false}`.
- **Processing:** `isCustomerFirstOrder(db, user.id)`.
- **Response:** `200 {"firstOrder": boolean}` with header `Cache-Control: no-store`.

It decides no money. The hand-off calls `isCustomerFirstOrder` again for itself.

---

#### `GET /api/promos/landing` — the landing-page offer this visitor holds (display only)

File: `app/api/promos/landing/route.ts`. Service role.
- **Auth:** optional bearer.
- **Input:** the `vyta_lp` cookie, normalised by `normalizeLandingSlug`: trimmed, lower-cased, must match `/^[a-z0-9][a-z0-9-]{1,39}$/`, otherwise null.

**Responses** (every one carries the header `Cache-Control: no-store`):
- No valid slug → `{"offer": null}`.
- `resolveLandingOffer` returns null → `{"offer": null, "slug": slug}`.
- Otherwise:
  ```json
  { "offer": { "slug", "code", "percent", "first_order_only", "excluded_product_ids",
               "exclusions": "bacteriostatic water and X" | null, "ends_at": iso|null },
    "eligible": true|false, "reason": string|null }
  ```

**Eligibility:**
- `eligible` is set to false only when the offer is `firstOrderOnly`, a bearer resolves to a user, and `firstOrderRejection(await firstOrderStatus(db,{customerId:user.id,email:user.email}))` is non-null.
- In that case `reason = REJECTION_MESSAGES[rejection]`.
- If the bearer path throws, the visitor is treated as a guest: eligible, and checked again at hand-off.

**Fine-print helper:** `exclusions = exclusionsPhrase(productNames(db, excludedIds))`.
- `productNames` reads `products(id,name)` and sorts the names.
- Any name matching `/bacteriostatic|bac[\s-]?water/i` collapses into the single phrase `"bacteriostatic water"`.
- With up to 3 parts the result reads "a, b and c". Beyond that it reads "a, b, c and N more".

---

#### `POST /api/shipping/rates` — legacy storefront Easyship quote (not used by the hosted checkout)

File: `app/api/shipping/rates/route.ts`.
- **Auth:** none.
- **Rate limit:** none.
- **Body:** `{ shipping?: {firstName,lastName,address,city,state,postalCode,country,phone}, items?: [{quantity?|qty?}] }`.

**Responses:**
- Invalid JSON → `400 {"error":"invalid json"}`. This error string is lower-case.
- `postalCode` or `country` missing → `200 {"rates":[],"fallback_rate":null,"note":"address required"}`.
- `cfg = getShippingConfig()` reads `site_settings(*)` and falls back to env. `fallback_rate = Number(cfg.flatRate ?? 0)`. The `flatRate` default is 20 and comes from `site_settings.shipping_flat_rate`.
- Easyship disabled or no key → `{"rates":[],"fallback_rate":N,"note":"easyship disabled"}`.
- Otherwise the parcel weight is `computeScaledWeight(items, unitWeightKg(cfg))`, defined as `max(base * max(1, Σqty), MIN_SHIPMENT_WEIGHT_KG)`.
  - The rates call is `getShippingQuoteOrFallback(payload)`. It filters to UPS and Canada Post, folds in the handling fee and sorts by price ascending.
  - Success → `{rates: EasyshipRate[], fallback_rate, origin_postal, note: rates.length===0 ? 'no live rates returned (run admin → settings → shipping → Test connection)' : undefined}`.
  - On a throw → `{rates:[], fallback_rate, note: e.message ?? 'rate lookup failed'}`.

---

#### `GET /api/shipping/address-autocomplete?q=` — Canada-only address suggestions

File: `app/api/shipping/address-autocomplete/route.ts`.
- **Auth:** none.
- **Rate limit:** none.
- **DB:** none.

**Behaviour:**
- If `q` is missing or shorter than 3 characters after trimming → `{"suggestions": []}`.
- **Proxy call:** `GET https://photon.komoot.io/api/` with query parameters `q`, `limit=8`, `lang=en`, `bbox=-141.0,41.6,-52.6,83.2`, `lat=56.13`, `lon=-106.35` and `location_bias_scale=0.2`.
  - Headers: `User-Agent: aminocan-cad/1.0 (+checkout address autocomplete)` and `Accept: application/json`.
  - Fetch option: `cache:'no-store'`.
- **Filtering:** a feature is kept only if `countrycode` (upper-cased) is `'CA'`. When `countrycode` is absent, `country` lower-cased must equal `'canada'`.
- **Mapping:**
  - `address = [housenumber, street].join(' ') || name`. Features without an address are dropped.
  - `city = city || town || village || locality`.
  - `state = provinceCode(state)`. A full province name maps to its 2-letter code, and a 2-letter value is upper-cased.
  - `postalCode = postcode`.
  - `country = 'CA'`.
  - `label = [street-or-name, city, state, postalCode].filter(Boolean).join(', ')`.
- **Response:** `{suggestions: Array<{label,address,city,state,postalCode,country}>}`.
- A non-ok upstream response gives `{suggestions:[]}`. A throw gives `200 {suggestions:[], note}`.

---

#### `POST /api/orders` → 410; `GET /api/orders?orderNumber=&email=` — public order lookup (legacy `orders` table)

File: `app/api/orders/route.ts`. Uses `getSupabase()`.

**POST:**
- Always `410 {"error":"Crypto checkout is no longer accepted at this endpoint.","hint":"Use the hosted checkout at /checkout."}`.

**GET:**
- `orderNumber` is trimmed. `email` is trimmed and lower-cased.
- Missing orderNumber → `400 {"error":"Order number required"}`.
- Missing email → `400 {"error":"Enter the email address used on the order to view it."}`.
- **Query:** `orders.select('order_number, email, status, items, total, subtotal, shipping_cost, discount_total, shipping_address, shipping_carrier, shipping_method, fulfillment_type, tracking_number, tracking_url, tracking_status, created_at, shipped_at, delivered_at').eq('order_number', orderNumber).maybeSingle()`.
- **Errors:**
  - A DB error → `500 {"error":"Failed to look up order"}`.
  - No row, or the stored email (lower-cased) ≠ the supplied email → `404 {"error":"No order found matching that order number and email."}`. This is the uniform not-found response.
  - A throw → `500 {"error":"Failed to look up order"}`.
- **Response:** the row with `email` removed.
- **Note:** hosted (Stealth Health) orders are **not** in `orders`. They live in `puramass_orders` and `invoices`, so this lookup never finds them.

---

#### `GET /api/orders/my-orders` — signed-in customer's legacy orders

File: `app/api/orders/my-orders/route.ts`. Uses `getSupabase()`.

- **Auth:** bearer is required.
  - Missing token → `401 {"error":"Not authenticated"}`.
  - No user → `401 {"error":"Not authenticated"}`.
- **Query:** `orders.select('order_number, status, total, crypto, payment_tx_hash, tracking_number, created_at').eq('customer_id', user.id).order('created_at', {ascending:false})`.
- **Errors:** a DB error → `500 {"error":"Failed to fetch orders"}`.
- **Response:** the array (an empty array when there are no rows).
- **Note:** only legacy `orders` rows are returned. I found no client caller in app/components; it is only mentioned in a comment. Hosted orders show in the account through `invoices` (source `stealth_health`), via `lib/customer/api.ts`, which is outside this section.

---

#### `GET /api/site-config` — public branding/tracking config

File: `app/api/site-config/route.ts`. A module-scope `getSupabase()` client.

- **Processing:** `readSiteConfigRow(db)` runs `site_settings.select('*')` and passes the row to `shapeSiteConfig`. On error it returns `DEFAULT_SITE_CONFIG`.
- **Response:** `{config: SiteConfig}`.

**`SiteConfig` fields and defaults:**

| Field | Default |
|---|---|
| `store_name` | 'VYTA' |
| `store_tagline` | 'Biosciences' |
| `logo_url` | null |
| `favicon_url` | null |
| `hero_video_url` | null |
| `hero_image_url` | null |
| `gtm_container_id` | env `NEXT_PUBLIC_GTM_CONTAINER_ID`, else 'GTM-M2J3D7SG' |
| `ga4_measurement_id` | env `NEXT_PUBLIC_GA4_MEASUREMENT_ID`, else 'G-F44F1BB1QV' |
| `meta_pixel_id` | — |
| `klaviyo_public_key` | if the row has `klaviyo_enabled`, `klaviyoOnsiteKey(row, fallback)`; otherwise the cleaned `klaviyo_public_key`. The fallback is env `NEXT_PUBLIC_KLAVIYO_SITE_ID`, else 'SY9j8v' |
| `tracking_consent_required` | true unless the row has `false` |
| `product_*_enabled` (6 flags) | true unless the row has `false` |

No checkout or pricing data is returned here. The hosted shipping and promo settings reach the storefront through other routes outside this scope; see Unverified.

---

#### (Post-payment, for completeness) `POST /api/webhooks/stealth-health` and `GET /api/cron/puramass-poll`

These are not part of "placing" an order, but they are where stock, commission, emails and Placed Order happen.

**Webhook** (`runtime='nodejs'`, service role):

1. It reads the raw body.
   - `PURAMASS_WEBHOOK_SECRET` unset → `500 {"error":"webhook not configured"}`.
   - Signature check: HMAC-SHA256 of the raw body, keyed by the secret, compared constant-time against the `X-Stealth-Signature: sha256=<hex>` header. Failure → `401 {"error":"bad signature"}`.
2. Body unparseable → `200 {"received":true,"matched":false}`.
3. Payload fields:
   - `event_id`, `partner_reference`, `data.{transaction_id|order_id, status, currency, occurred_at}`.
   - The order body is taken from `data.order ?? payload.order ?? data`.
4. The ledger row is matched by `transaction_id`, then by `partner_reference`.
   - Unmatched → `200 {"received":true,"matched":false}`.
   - Same `last_event_id` → `200 {"received":true,"deduped":true}`.
5. It updates `status`, `last_event_id`, `currency`, `paid_at` (on paid), `transaction_id` if it was missing, and the contact/address/detail patches.
   - A DB failure → `500 {"error":"update failed"}`, which makes the partner retry.
6. On `paid`: `attributeHostedPurchase`, then `materializeStealthHealthFulfillment`.
7. On `expired` or `cancelled`: `expireStealthHealthInvoices`.
8. Then `200 {"received":true,"matched":true}`.
9. Every delivery is logged to `puramass_webhook_events` (`logWebhookEvent`).

**Cron** (`/api/cron/puramass-poll`):
- Its auth secret is `PURAMASS_CRON_SECRET || CRON_SECRET`.
- It is scheduled through Supabase pg_cron + pg_net (`supabase-cron-puramass-poll.sql`).
- It calls `GET /partner/store/orders/{transaction_id}` and `applyPuramassStatus`, which has the same paid side-effects as the webhook.

---

### Server — pricing engine

All money is **CAD**. The hand-off currency is `PURAMASS_CURRENCY = 'cad'`, lower-case. The partner order is denominated in CAD so the hosted page charges our CAD prices; it does not convert to the partner's USD listings. USD helpers exist in `lib/pricing.ts` (`usdFromCad`, `DEFAULT_USD_RATE = 0.73`, `products.price_usd`), but **checkout does not use them**.

#### 1. Line price, per pack (`priceCartLines` in the route)

**Step 1 — resolve the base price per product** with `resolvePriceMap(db, {customerId, productIds})` in `lib/pricing/resolve.ts`. Layers, later ones winning:
1. `products.price` → `{price, source:'base', base:price}`.
2. The active pricelist: `pricelists.select('id').eq('is_active',true).maybeSingle()`, then `pricelist_items(product_id, price).eq('pricelist_id').in('product_id')` → `{price: item.price, source:'pricelist', base}`.
3. Only if signed in: `customer_price_overrides(product_id, override_price).eq('customer_id').in('product_id')` → `{price: override, source:'override', base}`.

Notes on the resolver:
- If `resolvePriceMap` throws, the route logs `[puramass] price resolution failed:` and every product falls back to `{price: products.price, source:'base'}`.
- **Affiliate overrides:** `lib/admin/affiliate-pricelist.ts applyAffiliatePricelist(customerId, affiliateId)` copies `affiliate_price_overrides(product_id, override_price)` into `customer_price_overrides` when a customer is bound to an affiliate. It deletes that customer's existing rows for those products first. At checkout, affiliate pricing therefore arrives **only** through `customer_price_overrides`.

**Step 2 — pick the vial price.**
```
vialsPerBox = vialsPerBoxOf(product.vials_per_box)   // >0 ? n : 10
if source === 'base':
   vialPrice = vialPriceFor({ price: base, vial_price: product.vial_price, vials_per_box })
            // = round2(vial_price) if vial_price != null && vial_price > 0
            //   else round2(base / vialsPerBox)
else (pricelist/override):
   vialPrice = round2(resolved.price / vialsPerBox)   // override restates the CASE price
```

**Step 3 — pick the pack price.**
```
unit = packPriceFor({ price: base, vial_price: vialPrice, vials_per_box,
                      pack_options: source==='base' ? product.pack_options : null }, packSize)
// packPriceFor: n = max(1, floor(size));
//   if normalizePackOptions(pack_options).find(o => o.size === n)?.price != null → that price
//   else round2(vialPriceFor(product) * n)
unitCents = (finite && unit > 0) ? Math.round(unit * 100) : 0
```

Two consequences:
- A pricelist or customer override **drops** the per-pack fixed prices in `pack_options`. The pack price then becomes `round2(override/vpb) × size`.
- `packPriceFor` honours a configured pack price **even when that pack option has `enabled:false`**. The route does not check that `packSize` is one of the product's offered sizes.

`pack_options` normalisation (`normalizePackOptions`):
- It accepts an array of objects or of bare numbers.
- `size = floor(Number)`, within 1..1000.
- `price` and `compare_at` must be non-negative and are rounded with round2; any other value becomes null.
- `label` is trimmed to 60 characters. `badge` is trimmed to 24.
- `enabled = row.enabled !== false`.
- A later duplicate size wins. Results are sorted ascending and capped at 8.

`round2(n) = Math.round((Number(n)||0)*100)/100`.

#### 2. Subtotals

- `listSubtotalCents = Σ(unitPriceCents × quantity)` over the merged SKU lines, **after** each quantity is clamped to 1–99.
- `goodsSubtotal` (CAD) is the same figure divided by 100. Free shipping is measured against it, at **list** price before any discount.
- `cartUnits` (used by the cart offer) is counted from the raw lines **before** merging and clamping: `Σ max(1, round(vials/round(packSize)))`.

#### 3. Automatic promo A — paid-ads welcome discount (`lib/promos/ad-discount.ts`)

**Settings:** `shapeAdDiscountSettings(row)`:
- `percent = clampDiscountPercent(row.ad_discount_percent ?? 25)`. The clamp gives 0 for non-finite or ≤0 values, else `min(100, round(n*100)/100)`.
- `enabled = !!row.ad_discount_enabled && percent > 0`.
- If the row is missing or empty, the promo is **off**.
- DB defaults: `ad_discount_enabled DEFAULT true`, `ad_discount_percent DEFAULT 25`. The admin route caps the percentage at 99; see Unverified.

**`earnsAdDiscount(settings, customerId, visitor)`** (in the route). It returns false if the promo is disabled or the buyer is a guest. Otherwise:
1. `frozen = customers.select('attribution_channel').eq('id', customerId)`. A throw is ignored.
2. If none of `[frozen, visitor.first.channel, visitor.last.channel]` is a paid channel, return false. `PAID_CHANNELS = google_ads, meta_ads, bing_ads, tiktok_ads, linkedin_ads, other_paid`.
3. `firstOrder = isCustomerFirstOrder(db, customerId)`, from `lib/promos/first-order.ts`. It fails closed:
   - The customer row read errors, or `has_completed_first_order` is true → false.
   - The count of `puramass_orders` where `customer_id = id` and status is in `['paid','payment_pending']` errors or is > 0 → false.
   - Otherwise true.
   - Statuses `expired` and `cancelled` do **not** consume the offer.
4. `qualifiesForAdDiscount(settings, {signedIn:true, firstOrder, channels})`: enabled, percent > 0, signed in, first order, and paid traffic.

Consequence: a pending hand-off (`payment_pending`) consumes the welcome discount. A second hand-off attempt by the same customer does not get it until the first one expires or is cancelled.

#### 4. Automatic promo B — limited-time cart offer (`lib/promos/cart-offer.ts`)

**Settings:** `shapeCartOfferSettings(row)`:
- `percent = min(99, clampDiscountPercent(row.cart_offer_percent ?? 10))`
- `enabled = !!row.cart_offer_enabled && percent > 0`
- `minItems = clampMinItems(row.cart_offer_min_items ?? 2)`, where the clamp is `floor(n)` within 1..99
- `endsAt` is the ISO string of `cart_offer_ends_at`, or null if it is unparseable

**`qualifiesForCartOffer(settings, cartUnits, now=Date.now())`:** enabled, percent > 0, not expired, and `floor(cartUnits) >= minItems`.
- `cartOfferExpired` is true only when `endsAt` is set, parses, and `end <= now`.
- An unparseable end date is treated as no end date.

The offer is open to guests. Its unlock is inclusive: minItems 2 unlocks at exactly 2 units.

#### 5. Discount code (typed, or the landing-page default) (`lib/affiliate/discount-codes.ts`)

**`lookupDiscountCode(db, raw, {subtotal, customerId, email, lines})`:**
1. `normalized = String(raw).toUpperCase().replace(/[^A-Z0-9]/g,'')`. It must match `/^[A-Z0-9]{3,32}$/`, otherwise `not-found`.
2. `discount_codes.select('*').eq('code', normalized).maybeSingle()`. An error or no row gives `not-found`. The lookup fails closed, including when the table is missing.
3. `shapeDiscountCodeRow` defaults `first_order_only` to false. `excluded_product_ids` is normalised to lower-case UUIDs, at most 500.
4. If `affiliate_id` is set: `affiliates.select('active').eq('id')`. If the affiliate exists with `active === false` → `inactive`.
5. `usesCount` is only computed when `max_uses != null`: the count of `puramass_orders` where `discount_code_id = id` and `status IN ('paid')`. A count error gives 0.
6. `firstOrder` is only computed when `first_order_only` and (customerId or email): `firstOrderStatus(db, {customerId, email})`. It returns one of three values:
   - `'unknown'`: neither identity is present, or any read errored.
   - `'ordered'`: any of these is true:
     - `customers.has_completed_first_order` on the customer's own row.
     - The same flag on any `customers` row whose email ILIKE matches the escaped email (limit 5).
     - An `orders` row with that email where `payment_confirmed_at` is set or status is in `confirmed, paid, processing, shipped, delivered, completed`.
     - A `puramass_orders` row with `status='paid'`, matched by customer_id or by `customer_email` ILIKE.
   - `'first'`: none of the above.
   - **Pending hand-offs do NOT count here**, unlike the ad discount.
7. `evaluateDiscountCode(code, ctx)` checks, in order:
   1. `!active` → inactive.
   2. `starts_at > now` → not-started.
   3. `expires_at <= now` → expired.
   4. `max_uses != null && usesCount >= max_uses` → used-up.
   5. `affiliate_id === customerId` → own-code.
   6. `first_order_only` with firstOrder known: `'ordered'` → first-order-only; `'unknown'` → first-order-unverified. If firstOrder is undefined (a guest preview with no email), the check is deferred and the code passes.
   7. `min_subtotal && subtotal < min_subtotal` → below-minimum. This is measured against the **list** subtotal.
   8. There are exclusions, subtotal > 0, and the eligible amount is ≤ 0 → nothing-eligible.
   9. Percent: `fixed` gives `value / eligible × 100` (eligible ≤ 0 → below-minimum); `percent` gives the value as-is. The result is clamped to `min(99, max(0, round(p*100)/100))`. If it is ≤ 0 → not-found.
8. Any throw gives `not-found`.

**At hand-off**, the eligible amount is `eligibleSubtotal(codeLines, excluded)`: the sum of line list totals whose productId is not excluded, compared case-insensitively. `appliedCode.eligibleCents = round(eligible × 100)`.

#### 6. Landing-page offer (`lib/promos/landing.ts`, `landing-server.ts`)

- **Source:** the `vyta_lp` cookie, set by `middleware.ts` from `?lp=<slug>`. It has a 30-day max-age (`LANDING_COOKIE_MAX_AGE`).
- **`resolveLandingOffer(db, slug)`:**
  1. Reads `landing_pages(*)` by slug. It must exist and have `active = true`.
  2. Reads `discount_codes(*)` by `landing.discount_code_id`.
  3. Applies `landingOfferFrom`: the code must be active, `discount_type === 'percent'`, started, and not expired. `percent = min(99, round2(discount_value))` and must be > 0. Otherwise there is no offer.
- **How it is used:** only to **default** `codeToApply` when the buyer typed no code and did not send `declineLandingOffer:true`. It then goes through exactly the same `lookupDiscountCode`. A landing code that fails lookup is dropped silently (logged with `console.info`). A **typed** code that fails is a 400.
- **Not an independent discount.** The landing offer **is** the discount code. It can never stack with a typed code.

#### 7. First-order promo

There is no separate "first-order promo" discount. "First order" is a **condition**:
- On the ad discount, through `isCustomerFirstOrder`, where pending counts.
- On `first_order_only` discount codes, through `firstOrderStatus`, where only paid counts.

`/api/promos/first-order` exposes the first of these to the UI.

#### 8. How they stack (authoritative)

```
adPercent        = earnedAd ? adDiscountSettings.percent : 0
codeEffectivePct = appliedCode && listSubtotalCents>0
                     ? appliedCode.percent * appliedCode.eligibleCents / listSubtotalCents : 0
codeBeatsAd      = appliedCode !== null && codeEffectivePct >= adPercent   // tie → code wins
usedAd           = earnedAd && !codeBeatsAd
offerPercent     = earnedOffer ? cartOfferSettings.percent : 0

per line:
  first   = codeBeatsAd ? (line.productId excluded ? 0 : appliedCode.percent)
          : usedAd      ? adPercent
          : 0
  percent = combineDiscountPercents(first, offerPercent)
          // = min(99, max(0, round((1 - Π(1 - clamp(p)/100)) * 10000)/100))
          // 25 & 10 → 32.5 ; 50 & 50 → 75 ; 99 & 99 → 99
```

- **Code vs ad discount:** mutually exclusive. The one with the larger effective share of the whole order wins.
- **Cart offer:** stacks multiplicatively with whichever of those two won. It applies to excluded lines too, because exclusions only affect the code.
- **Landing offer and typed code:** mutually exclusive. A typed code replaces the landing default.
- **Referral code:** takes **nothing** off. It is commission attribution only.

#### 9. Splitting the discount onto line prices (`distributeLineDiscounts` → `distributeAdDiscount`)

The partner API has no discount field. The discount is applied by lowering each line's `unit_price_cents`.

1. Only if `percentLines.some(l => l.percent > 0)`.
2. Lines are grouped by `clampDiscountPercent(percent)`, and each group is split independently by `distributeAdDiscount(group, pct)`:
   ```
   clean lines: unitPriceCents = max(0, round), quantity = max(0, round); drop quantity==0
   subtotalCents = Σ unit*qty
   if pct<=0 || subtotal<=0 → passthrough
   targetTotal = subtotalCents - Math.round(subtotalCents * pct / 100)
   rate = 1 - pct/100
   draft.unit = floor(unitPriceCents * rate); remainder = ideal - unit
   total = Σ draft.unit * qty
   order = sort by remainder desc, tie → smaller quantity first
   loop while progressed && total < targetTotal:
       for d in order: skip if d.unit >= list price; skip if total + qty > targetTotal;
                       d.unit += 1; total += qty; if total >= target break
   discountCents = subtotalCents - total
   ```
   The result is never a markup. The buyer saves at least the advertised percentage, and the overshoot is at most one cent per unit.
3. The lines are returned in the caller's order, with `subtotalCents`, `discountCents` and `totalCents` summed over the groups.
4. **Zero guard:** if any `discountedUnitPriceCents <= 0`, the whole discount is dropped. It logs `[puramass] discount skipped: <p%/q%> would zero a line price; sending list prices` and sends every line at list price. The reason: the partner reads 0 as "use your own catalog price".
5. **Overall percentage reported:**
   - If every line shares one percentage, it is that percentage.
   - Otherwise it is `round(discountCents / max(1, subtotalCents) * 10000) / 100`.
   - If there was no discount, it is 0.

#### 10. Shipping (`resolveHostedShipping` in the route, plus `lib/payments/puramass-{settings,shipping,rates-server}.ts`)

**Settings:** `shapeHostedShippingSettings(row)`:
- `ratesEnabled = !!row.puramass_shipping_rates_enabled`. DB default false.
- `flatShipping = row.puramass_flat_shipping`, kept if it is finite and ≥ 0, else `DEFAULT_FLAT_SHIPPING = 35`. DB default 35.
- `freeShippingThreshold = row.puramass_free_shipping_threshold`, kept if finite and ≥ 0, else 0.
- `freeShippingEnabled = ratesEnabled && !!row.puramass_free_shipping_enabled && threshold > 0`. **Free shipping is impossible with the flat fee.**

**`qualifiesForFreeShipping(s, subtotal)`:** enabled and `subtotal >= threshold`. The check is inclusive.

**`resolveHostedShipping(settings, courierId, dest, vials, freeShipping)`:**
- `!ratesEnabled` → `flat = flatHostedRate(settings.flatShipping)`, which is `{courier_id:'flat', courier_name:'Standard shipping', service_name:'Tracked delivery', min:0, max:0, total_charge: fee, currency:'CAD'}`. The rate is the flat rate, zeroed if free (unreachable here).
- Otherwise `quote = quoteHostedRates(db, dest, vials, settings)`:
  - It never throws, and it always returns at least one rate.
  - `getShippingConfig(db)` reads `site_settings(*)`:
    - `easyship_enabled` and `easyship_api_key || env EASYSHIP_API_KEY`
    - `shipping_origin` (jsonb; `line_1` is bridged to `address`)
    - `shipping_box` (jsonb)
    - `shipping_item_weight_kg` (default 0.05)
    - `shipping_flat_rate` (default 20; not used here)
    - `shipping_handling_fee_type` ('flat' or 'pct')
    - `shipping_handling_fee_value` (default 0)
  - If Easyship is disabled or has no key → `{live:false, rates:[flat]}`.
  - Otherwise `fetchEasyshipRates` is called with:
    - Origin: `cfg.origin.{country_alpha2 ?? 'CA', postal_code, state, city}`.
    - Destination: country upper-cased, postal code, city, state.
    - `total_actual_weight = hostedParcelWeight(vials, cfg.itemWeightKg) = max(per, round(vials*per*1000)/1000)`, where `per = itemWeightKg > 0 ? itemWeightKg : 0.05`.
    - `quantity = max(1, round(vials))`.
    - `boxes = [{length, width, height, weight: box.weight ?? 0.05}]`.
  - It then runs `rankHostedRates(raw, cfg)`:
    1. Keep courier names matching `\bups\b` or `\bcanada post\b`, case-insensitive.
    2. `total_charge = round2(applyProcessingFee(rate, fee))`. A 'pct' fee gives `cost × (1 + v/100)`; a flat fee gives `cost + v`; 0 or absent gives `cost`.
    3. Drop rates with an empty courier_id or `total_charge ≤ 0`.
    4. Sort by speed (`max_delivery_time || min_delivery_time || ∞`) ascending, then by price ascending.
    5. Keep the first 5 (`PURAMASS_RATE_LIMIT`).
  - An Easyship throw → `{live:false, rates:[flat], note:'Live shipping rates are unavailable right now.'}`.
  - Nothing left after ranking → `{live:false, rates:[flat], note:'No courier rates were returned for this address.'}`.
- Not live → the rate is `quote.rates[0]`, the configured flat rate. **The courier id the buyer sent is ignored.**
- Live → `selectHostedRate(quote.rates, courierId)`:
  - An exact `courier_id` match wins.
  - Else, `courierId === 'flat'` gives `flatHostedRate()` at the **bare default of 35**, not the configured fee.
  - Else null, which produces the 409 re-pick response.
- `freeShipping` gives `{...rate, total_charge: 0}`. The courier is kept so the shipment can be booked later.
- `shippingTotalCents = Math.round(total_charge × 100)`. It is sent to the partner as `shipping_total_cents`, and 0 is sent explicitly.

**Regions:** `SHIPPING_COUNTRIES = [{code:'CA', name:'Canada'}]` (`lib/shipping/regions.ts`). `CA_PROVINCES` lists AB, BC, MB, NB, NL, NS, NT, NU, ON, PE, QC, SK, YT. The province itself is only validated as non-empty, not against this list.

#### 11. Totals, tax, rounding

- **Tax:** none is computed. The partner handles tax, and the invoice is written with `tax_total: 0`.
- **Charged goods** = `Σ discountedUnitPriceCents × qty`.
- **Charged total** = goods + `shippingTotalCents`, as computed by the partner. The partner's own total is not read back; only `subtotal_cents` is stored.
- **Rounding:** cents are integers throughout. Discount splits floor first, then hand cents back. Rates are rounded to cents after the fee. The invoice uses `round2` (`+n.toFixed(2)` in the fulfillment module).

#### 12. Worked example (verified by running the real lib functions)

**Catalog:**
- Product A: `price 1000`, `vial_price null`, `vials_per_box 10`, `pack_options [{size:5, price:450}]`, `puramass_sku 'vyta-a-case'`.
- Product B: `price 300`, `vial_price 35`, `vpb 10`, `puramass_sku_vial 'vyta-b-vial'`.

**Request:** `items: [{id:A, packSize:5, quantity:10}, {id:B, packSize:1, quantity:1}]`. The buyer is signed in, the first touch is `meta_ads`, it is their first order and no code is typed.

**Settings:** `ad_discount 25%` on; cart offer 10% with min 2 items; rates enabled; free shipping threshold 300.

| step | value |
|---|---|
| A vial price | `vialPriceFor` → 1000/10 = 100.00 |
| A 5-pack price | `pack_options` size 5 → **450.00** → 45000¢, units = 10/5 = 2, SKU `vyta-a-case` |
| B single price | `vial_price` 35 → **35.00** → 3500¢, units 1, SKU `vyta-b-vial` |
| listSubtotalCents | 2×45000 + 3500 = **93500** |
| cartUnits | 2 + 1 = 3 ≥ 2 → offer earned |
| earnedAd | yes (25) ; no code → usedAd |
| per-line percent | combine(25,10) = **32.5** |
| split target | 93500 − round(93500×0.325 = 30387.5 → 30388) = 63112 |
| draft units | A floor(45000×0.675=30375) = 30375 ; B floor(2362.5) = 2362 ; total 63112 = target |
| discountCents | **30388** ($303.88) |
| partner items | `[{sku:'vyta-a-case',quantity:2,unit_price_cents:30375},{sku:'vyta-b-vial',quantity:1,unit_price_cents:2362}]` |
| free shipping | goodsSubtotal 935.00 ≥ 300 → courier kept, `shipping_total_cents: 0` |
| response | `ad_discount_percent 25, cart_offer_percent 10, discount_percent 32.5, ad_discount 303.88, discount_code_percent 0` |
| invoice | lines "A — Pack of 5" qty 2 @303.75, "B — Single vial" qty 1 @23.62; subtotal 631.12; shipping 0; total 631.12; note `Discount applied: 25% first-order discount + 10% limited-time offer — saved $303.88 CAD.` |

**Variant: the code wins.** Same cart, but the buyer typed a 30% code that excludes B.
- `eligibleCents = 90000`, so `codeEffective = 30 × 90000 / 93500 = 28.88 ≥ 25`, and the code beats the ad discount.
- Line A: `combine(30,10) = 37%` → 28350¢. Line B: `combine(0,10) = 10%` → 3150¢.
- `discountCents = 33650`. The percentages are not uniform, so `overallPercent = round(33650/93500 × 10000)/100 = 35.99`.
- Ledger: `discount_code_cents = round(90000 × 30/100) = 27000`, `ad_discount_percent = 0`, `ad_discount_cents = 33650`.

**Fixed-code conversion.** A $50 fixed code with eligible $900 gives `50/900 = 5.56%`.

---

### Server — Puramass payment integration

Files:
- `lib/payments/puramass.ts`: the client. Server-only; it imports `node:crypto`.
- `lib/payments/puramass-settlement.ts`: the settlement ledger, `GET /partner/settlement`, which is not used at checkout.

#### Config (read at call time)

```ts
apiKey        = process.env.PURAMASS_API_KEY || ''
partnerId     = process.env.PURAMASS_PARTNER_ID || 'ptr_puramass'
baseUrl       = (process.env.PURAMASS_API_BASE_URL || 'https://api.stealth.health').replace(/\/+$/, '')
webhookSecret = process.env.PURAMASS_WEBHOOK_SECRET || ''
isPuramassConfigured()        = Boolean(apiKey && partnerId)
isPuramassWebhookConfigured() = Boolean(webhookSecret)
```

#### Transport: `puramassFetch(path, init)`

- If there is no apiKey, it throws `PuramassApiError(503, 'Stealth Health is not configured')`.
- `fetch(baseUrl + path, {...init, cache:'no-store', signal, headers: {'X-Partner-ID': partnerId, 'X-Api-Key': apiKey, ...init.headers}})`.
- Timeout is 20 000 ms through an `AbortController`. An abort throws `PuramassApiError(504, 'Stealth Health request timed out')`. Any other fetch error throws `PuramassApiError(502, 'Could not reach Stealth Health')`.
- The body is read as text and parsed as JSON; an empty or invalid body becomes `{}`.
- A non-2xx response throws `PuramassApiError(res.status, sanitizeDetail(json))`. `sanitizeDetail` takes the first non-empty string among `error`, `message`, `detail` and `JSON.stringify(errors)`, trimmed and cut to 300 characters. Otherwise the detail is `Stealth Health API error <status>`.
- `class PuramassApiError extends Error { status: number; detail: string; name = 'PuramassApiError' }`.

#### Endpoints used

| Method/path | Used by | Request | Response handling |
|---|---|---|---|
| `POST /partner/store/orders` | checkout (`createPuramassOrder`) | JSON body below, header `Content-Type: application/json` | `order = json.order ?? json`; `payment_link = order.payment_link ?? order.paymentLink`; `transaction_id = order.transaction_id ?? order.transactionId`. If either is missing, throws `PuramassApiError(502,'Stealth Health did not return a payment link')`. Returns `{status: String(order.status ?? 'payment_pending'), transaction_id, payment_link, currency: lower-cased string or null, subtotal_cents: Number(order.subtotal_cents ?? 0) \|\| 0, items: array or []}` |
| `GET /partner/store/orders/{encodeURIComponent(transaction_id)}` | poller and admin refresh (`fetchPuramassOrderStatus`) | — | `{transaction_id, status, partner_reference, currency, subtotal_cents, payment_link, created_at, paid_at, expires_at, items, refunded_total_cents, refunds, shipping: normalizePuramassShipping(order.shipping ?? order.shipping_address), customer: normalizePuramassContact(order.customer)}` |
| `GET /partner/store/products` | admin SKU sync only (`fetchPuramassCatalog`) | — | Accepts a bare array, `{products:[]}` or `{data:[]}`. Price is read as `price_cents`, or `price`×100. Normalised to `{sku, name, price_cents, image}`; entries without a sku are dropped |
| Webhook in: `store_order.payment_complete` | `/api/webhooks/stealth-health` | `X-Stealth-Signature: sha256=<hex HMAC-SHA256(rawBody, PURAMASS_WEBHOOK_SECRET)>` | see the routes section |

#### Create-order body: `buildPuramassOrderBody(args)` (exact)

```jsonc
{
  "items": [ { "sku": "vyta-…-case", "quantity": 2, "unit_price_cents": 30375 } ],
  "currency": "cad",                                     // String(args.currency || 'cad').trim().toLowerCase()
  "customer": { "email": "a@b.c", "first_name": "Ada", "last_name": "L", "phone": "+1 555…" },
  "payment": { "mode": "customer" },
  "partner_reference": "amc_<uuid>",
  "shipping_total_cents": 0                              // omitted only if undefined/null/negative/NaN
}
```

- `unit_price_cents` must be a positive number; it is rounded with `Math.round`. Otherwise the builder throws `PuramassApiError(500, 'No price for <sku>')`.
- `customer`: `email` is always present and trimmed. `first_name`, `last_name` and `phone` are included only when non-blank, and are trimmed.
- **No shipping address is sent.** The partner collects it, unless we collected it ourselves, in which case it is stored only on our side. Address data comes back through the webhook or poll and is merged by `buildPuramassContactPatch`. That patch never overwrites a `shipping_address_source='customer'` address, and only fills a missing email.
- `quantity` is the clamped pack count (1–99) of catalog units. There is one case-SKU unit per pack of any size, so a 5-pack and a 10-pack of the same product go as **separate lines with the same SKU** and different `unit_price_cents`.

#### SKU / catalog mapping

- **Mapping columns:**
  - `products.puramass_sku` (VARCHAR(80)) is the "case" SKU, used for **every** pack with size > 1.
  - `products.puramass_sku_vial` (VARCHAR(80)) is the single-vial SKU.
  - Both come from `puramass-hosted-checkout-migration.sql`.
- **At checkout** the mapping is read from the DB only. There is **no** live catalog call and the client SKU is never trusted.
- **SKU fill-in** is admin-only: `POST /api/admin/puramass/sync-skus`.
  - It fetches the live catalog, or falls back to `PURAMASS_CATALOG_SNAPSHOT`.
  - It keeps SKUs starting with `vyta-`. Those ending in `-vial` form the vial set; the rest form the box set.
  - For each active product it runs `matchProductToPuramass(name, strength, set)`:
    1. Tier exact: normalised names are equal.
    2. Tier matched: the dose tokens are equal, the product's words are a subset of the candidate's, and the candidate adds the fewest extra words.
    3. Otherwise ambiguous or unmatched.
  - It writes only exact or matched results, and does not overwrite an existing SKU unless `overwrite:true`.
- **Downstream rule:** `puramassPriceType(item)` in fulfillment treats a SKU ending in `-vial` as vial and anything else as box.

#### Hosted checkout session details

- **Return / cancel URLs:** **none are sent** in the create-order body. Where the buyer lands after paying is configured on the partner side; see Unverified.
- **Metadata:** none apart from `partner_reference`. Attribution, discount and referral are kept on our side, in `puramass_orders`.
- **Idempotency:** `partner_reference = 'amc_' + crypto.randomUUID()`. It is unique in `puramass_orders` (`partner_reference TEXT NOT NULL UNIQUE`) and is echoed back on webhooks.
  - The client comment says "reusing the same reference is a safe retry".
  - The route generates a **new** reference on every request and never retries. A double-submit creates two partner orders; the client guards against this with a `submitting` lock.
- **Status lifecycle (`puramass_orders.status`):**
  - `payment_pending` is the insert default and the partner default.
  - `paid` comes from the webhook or poll and also sets `paid_at`.
  - `expired` and `cancelled` are terminal; the pending invoice becomes `expired`.
  - `PURAMASS_TERMINAL_STATUSES = ['paid','expired','cancelled']`.

---

### Server — order record

The hosted checkout writes **no `orders` row and no `order_items` rows**. The order record is:
1. `puramass_orders`: the hand-off ledger, one row per hand-off.
2. `invoices`, with `source='stealth_health'` and `status='pending_payment'`, plus `invoice_line_items`. This is the fulfillment record.

#### 1. `puramass_orders` row written at checkout

The insert is retried with shrinking column groups. `isMissingColumnError` matches code `42703` or `PGRST204`, or a message matching `/\bcolumn\b.*does not exist/` or `/in the schema cache/`. On such an error the next tier is tried. Any other error logs `[puramass] ledger insert failed:` and **stops**: no ledger row and no invoice, but the 200 response is still returned. The tiers, richest first:

1. base + attribution + address + shipping + discount + code + landing
2. − landing
3. − code
4. − discount
5. − shipping
6. − address
7. base only

| column | value / source | group |
|---|---|---|
| `partner_reference` | `'amc_'+randomUUID()` | base |
| `transaction_id` | partner `order.transaction_id` | base |
| `payment_link` | partner `order.payment_link` | base |
| `status` | `order.status \|\| 'payment_pending'` | base |
| `currency` | `order.currency ?? 'cad'` (lower-case) | base |
| `subtotal_cents` | `order.subtotal_cents ?? null`. In practice always a number; it is 0 when the partner omits it | base |
| `customer_id` | bearer user id, or null | base |
| `customer_email` | body email, trimmed, **case kept** | base |
| `items` (jsonb) | `ledgerItems` — see below | base |
| `referral_code` | body `referralCode`, trimmed, or null. Not validated or normalised | base |
| `attribution_channel` | `(visitor.first ?? visitor.last)?.channel ?? null` | attribution |
| `attribution_campaign` | `(first ?? last)?.campaign ?? null` | attribution |
| `attribution` (jsonb) | `{first: touch\|null, last: touch\|null, anonymous_id, session_id}`, or null when there are no touches. `anonymous_id` and `session_id` are added only if the `aminocan_vid` cookie exists | attribution |
| `shipping_address` (jsonb) | `{address, address2\|null, city, state, zip, country}`, **only if `address.ok`** | address |
| `shipping_address_source` | `'customer'` | address |
| `shipping_address_updated_at` | `new Date().toISOString()` | address |
| `customer_name` | `address.value.full_name \|\| null` | address |
| `customer_phone` | `address.value.phone` | address |
| `shipping_total_cents` | `Math.round(rate.total_charge*100)`, 0 when free | shipping |
| `shipping_courier` | if a courier was picked (`courier_id !== 'flat'`): `` `${courier_name} · ${service_name}` `` + (`' (free shipping)'` if free); else null | shipping |
| `shipping_courier_id` | the Easyship courier_service id, or null for flat | shipping |
| `ad_discount_percent` | only if `discount`: `usedAd ? settings.percent : 0` | discount |
| `ad_discount_cents` | only if `discount`: `discount.discountCents`, the **whole** saving from any promo | discount |
| `cart_offer_percent` | only if `discount`: `earnedOffer ? percent : null` | discount |
| `cart_offer_min_items` | only if `discount`: `earnedOffer ? minItems : null` | discount |
| `discount_code_id` | `appliedCode.id`, written whenever a code applied, **even if it lost to the ad discount** | code |
| `discount_code` | `appliedCode.code` (normalised upper-case) | code |
| `discount_code_percent` | `codeBeatsAd && discount ? code.percent : 0` | code |
| `discount_code_cents` | `codeBeatsAd && discount ? round(eligibleCents × percent / 100) : 0` — the code's own share | code |
| `landing_page` | `landingPageOf(visitor)`: the `vyta_lp` cookie, else `first.landing_page`, else `last.landing_page`; only if non-null | landing |

Defaults and triggers:
- DB defaults fill `id` (uuid), `created_at`, `updated_at` and `status`.
- The trigger `puramass_orders_updated_at` maintains `updated_at`.
- `invoice_id` is set immediately afterwards by the invoice step.
- `paid_at` and `last_event_id` are set later by the webhook.
- Later columns that the checkout leaves null include `expires_at`, `refunded_total_cents`, `refunds`, `paid_items`, `address_requested_at`, `recovery_*`, `confirmation_email_sent_at` and `admin_paid_alert_sent_at`.

**`items` jsonb shape (ledger):**
```jsonc
[ { "sku": "vyta-a-case", "quantity": 2,
    "unit_price_cents": 30375,        // charged (after discount)
    "list_unit_price_cents": 45000,   // before discount
    "product_id": "<uuid>",           // first product merged into this sku::pack line
    "pack_size": 5 } ]                // 1 for single vial
```

**RLS:** `puramass_orders` has RLS enabled with a single policy, `"Service role full access" FOR ALL USING (true) WITH CHECK (true)`. All access is server-side.

**Migrations that create these columns** (base table plus later additions):
- `puramass-hosted-checkout-migration.sql`
- `marketing-attribution-migration.sql`
- `puramass-shipping-address-migration.sql`
- `puramass-missing-address-migration.sql`
- `puramass-hosted-shipping-migration.sql`
- `ad-discount-promo-migration.sql`
- `cart-upsells-migration.sql` (cart offer columns)
- `affiliate-discount-codes-payouts-migration.sql` (discount_code_*)
- `landing-pages-migration.sql` (landing_page)
- `puramass-order-details-migration.sql`

#### 2. `invoices` row (pending) — `createPendingStealthHealthInvoice` in `lib/payments/puramass-fulfillment.ts`

It is only called when `ledgerId` is set.

**Insert:**
```
issue_date: todayInAppTz()           // 'YYYY-MM-DD' in America/New_York
source: 'stealth_health'
customer_id: customerId | null
customer_email: email (body)
customer_name: (address.ok ? address.value.full_name : '') || `${firstName} ${lastName}` || null
customer_phone: phone (validated)
fulfillment_type: 'shipment'
fulfillment_status: 'pending'
status: 'pending_payment'
currency: 'CAD'
subtotal: round2(Σ qty × charged unit_price)       // after discount
tax_total: 0
shipping_cost: round2(shippingTotalCents/100)
total: round2(subtotal + shipping)
is_backorder: false
non_payable: false
notes: 'Placed via the Stealth Health checkout. Payment and taxes are handled by Stealth Health.'
       + '\n' + discountNote (if any)
easyship_courier_id: courierId    // only when a courier was picked; on a missing-column error, retried without it
```

- `invoice_number` comes from the DB default: `'VYTA-' || nextval('invoice_number_seq')` (`invoice-number-vyta-prefix-migration.sql`).
- `.select('id, invoice_number').single()`.
- **discountNote** is only written when a discount landed: `` `Discount applied: ${parts.join(' + ') || `${overallPercent}% off`} — saved $${(discountCents/100).toFixed(2)} CAD.` ``. The `parts`, in order:
  - `` `code ${CODE}, ${pct}% off` `` + `' eligible items (excluded products at list price)'` when the code won and excluded lines are in the cart.
  - `` `${adPercent}% first-order discount` `` when the ad discount was used.
  - `` `${offerPercent}% limited-time offer` `` when the cart offer was earned.

**`invoice_line_items` rows**, one per merged SKU/pack line:
```
invoice_id, product_id,
description: packSize>1 ? `${productName} — Pack of ${packSize}` : `${productName} — Single vial`   // em dash
qty: quantity (packs), unit_price: charged cents/100, line_total: round2(qty*unit_price),
discount_pct: 0, price_type: packSize>1 ? 'box' : 'vial', vials_per_unit: packSize,
qty_fulfilled: 0, qty_backordered: 0
```

- If the insert fails on a missing column (`vials_per_unit` does not exist yet), it is retried without `vials_per_unit`. In the retry, `product_id` is **also removed from pack lines (vials_per_unit ≠ 1)** so they take no stock.

Then it runs `puramass_orders.update({invoice_id}).eq('id', ledgerId).is('invoice_id', null)`. Errors are logged; nothing throws.

**Invoice statuses allowed** (`stealth-health-pending-invoice-migration.sql`): draft, sent, partial, paid, overdue, cancelled, pending_payment, expired.

#### Stock handling timing

- **At checkout: none.** Stock is neither checked nor reserved nor decremented, and the hand-off does not compare stock levels.
- **On payment:** `materializeStealthHealthFulfillment`:
  1. Flips the invoice `pending_payment|expired → paid` with a conditional update. Only the caller that makes the change gets `firstPaid = true`.
  2. If the invoice is missing, it creates one already paid from the ledger `items`, or from the partner's `paid_items` for legacy rows.
  3. On **every** pass, it calls `takeStealthHealthStock`, which calls `adjustInvoiceStock(db, invoiceId, 'stealth-health')`. That runs `rpc('adjust_stock_for_invoice', {p_invoice_id, p_actor_email})`, falling back to `{p_invoice_id}` alone if that signature is missing.
- **The RPC** is the latest definition, in `stock-ledger-migration.sql`, the same as `stealth-health-pending-invoice-migration.sql`:
  - It locks `invoices` `FOR UPDATE` and returns unless `stock_adjusted = false`.
  - It aggregates `SUM(qty * COALESCE(vials_per_unit,1))` per `product_id` over lines with a non-null `product_id`.
  - It sets `products.stock_quantity = GREATEST(0, old - qty)`.
  - It inserts one `product_history` row per product, with `change_type 'stock'`, `field 'stock_quantity'`, `source 'invoice_paid'`, `reference_type 'invoice'`, `reference_id = invoice id`, note `'Stock decremented by N when invoice was marked paid'` and `actor_email`.
  - It sets `invoices.stock_adjusted = true`.
- **After stock is taken:** lines without a product are logged as needing attention, and `checkLowStockForProducts(db, productIds)` runs when stock was taken.
- **Cron self-heal:** `healStealthHealthPaidOrders`. Within the last 14 days it re-materialises paid ledger rows whose invoice is still unpaid, and takes stock for paid `stealth_health` invoices where `stock_adjusted = false`.
- **Not used by hosted checkout:** `order-stock-decrement-jsonb-migration.sql` and `stock-decrement-migration.sql` define `adjust_stock_for_order(p_order_id, p_actor_email)`. It reads `orders.items` jsonb (`[{id, quantity}]`) and is guarded by `orders.stock_adjusted`. It serves the legacy `orders` path only.

#### Affiliate/referral fields

- At checkout: `puramass_orders.referral_code` (raw string) and `discount_code_id` / `discount_code` are recorded.
- **No commission is written at checkout.** Commission is booked on payment; see side-effects.

---

### Server — side-effects

#### At hand-off (`POST /api/checkout/puramass`)

All of these run **after** the partner order was created successfully. Nothing is written if creation fails.

| # | effect | how | blocking? |
|---|---|---|---|
| 1 | `puramass_orders` insert | tiered insert (see order record) | awaited; failure is swallowed |
| 2 | pending invoice + lines + ledger link | `await createPendingStealthHealthInvoice(...)`, only if the ledger row exists | awaited; never throws |
| 3 | `visitor_attribution` identity link | `void linkVisitorIdentity(db, anonymousId, {email, customerId})` → `update({updated_at, customer_email: lower(email), customer_id?}).eq('anonymous_id', id)`; no-op without the `aminocan_vid` cookie | fire-and-forget (`void`, **not** `after()`) |
| 4 | funnel milestone | `void stampVisitorMilestone(db, anonymousId, 'checkout_at')` → `update({checkout_at: now, updated_at: now}).eq('anonymous_id', id).is('checkout_at', null)` | fire-and-forget |
| 5 | Klaviyo "Started Checkout" | `after(() => trackStartedCheckout(db, {...}))` | runs after the response |

Note: the consent gate (`isTrackingAllowed`) is **not** consulted for effects 3 and 4 at checkout.

**Klaviyo Started Checkout details** (`lib/klaviyo/events.ts`):
- **Gate:** `readKlaviyoSettings(db)` reads `site_settings(*)` and requires `klaviyo_enabled === true`, `klaviyo_server_events_enabled !== false`, and a private key (`klaviyo_private_api_key` from the DB, else env `KLAVIYO_PRIVATE_API_KEY`). The email must also be valid.
- **Call:** `POST https://a.klaviyo.com/api/events` with headers `Authorization: Klaviyo-API-Key <pk>`, `revision: 2025-07-15`, and content type `application/vnd.api+json`.
- **Event body:**
  - `metric: 'Started Checkout'`
  - `profile: {email, first_name, last_name, external_id: customerId}`
  - `value = Σ(item.price × qty) + rate.total_charge`, rounded to 2 decimal places, with `value_currency 'CAD'`
  - `unique_id = partnerReference`
  - `properties: {CheckoutId, CheckoutURL: payment_link ?? 'https://www.vytabio.com/cart', Categories: [], ItemNames, ItemCount, Items: [{ProductID: sku, SKU, ProductName, Variant: null, Quantity, ItemPrice, RowTotal, ProductURL: null, ImageURL: null, Categories: []}], Currency: 'CAD'}`
  - The item name is `"<product name> (single vial)"` or `"<product name> (pack of N)"`, and the price is the **discounted** unit price.
- Never throws.

**No emails are sent at hand-off.**

#### At payment (webhook / poll / admin refresh → `materializeStealthHealthFulfillment`)

Order of operations:
1. `attributeHostedPurchase` (called by the webhook or poll before materialising):
   - It marks `visitor_attribution.purchased_at` on every visitor row with `customer_email = lower(email)` that has none yet.
   - If the ledger row has no `attribution_channel`, it backfills the channel and campaign from the earliest visitor row.
2. Invoice → `paid` (or create one already paid), which sets `firstPaid`.
3. Stock (`takeStealthHealthStock`), on every pass.
4. If `firstPaid`: Klaviyo "Placed Order" plus one "Ordered Product" per line.
   - `uniqueId = invoiceId`, and `${invoiceId}:${idx}` for each product event.
   - `value = invoice.total`.
   - Items come from `invoice_line_items`; `Variant` is 'Single vial' or 'Box'.
   - Other fields: `discountCode = ledger.discount_code`, `source 'stealth_health'`, `OrderURL = SITE_URL + '/account'`.
5. **Affiliate commission** (`recordAffiliateCommission`), on every pass. It is idempotent:
   1. A pre-check: `commissions` where `invoice_id = X` exists → `already-recorded`.
   2. Attribution priority:
      1. The `discount_code_id` on the ledger, if that code has an `affiliate_id` that is not the buyer.
      2. The bound customer: `customers.affiliate_id`, if it is not the buyer themselves, plus that affiliate's active referral code.
      3. `resolveReferralCodeOwner(ledger.referral_code)`, if the owner is not the buyer.
   3. Base = `ledger.subtotal_cents/100` (the partner's subtotal). If it is ≤ 0 → `no-base`, and nothing is written.
   4. Rate: a code's own `commission_rate` (a percentage, clamped 0–100, then /100) wins. Otherwise `normalizeCommissionRate(affiliates.commission_rate)`: ≤ 1 is read as a fraction, > 1 as a percentage, and an invalid value gives 0.10.
   5. Insert into `commissions`: `{affiliate_id, invoice_id, order_id: null, referral_code_id, amount: round2(base×rate), order_total: base, commission_rate: round2(rate×100), status: 'pending', discount_code_id?}`.
      - Unique index `idx_commissions_invoice_unique` and check `commissions_one_source` (`num_nonnulls(order_id, invoice_id) = 1`), both from `affiliate-commission-hosted-checkout-migration.sql`.
      - A `23505` error means `already-recorded`.
   6. On `recorded`: `notifyAffiliateOfCommission` emails the affiliate.
6. **Shipment** (`autoCreateShipmentForInvoice(db, invoiceId, true, courierId ? {courierIdOverride} : {courierPreference:'best_value'})`): an Easyship draft, on every pass, a no-op once one exists.
7. **Buyer confirmation email** (`sendStealthHealthOrderConfirmationOnce`), claimed through `puramass_orders.confirmation_email_sent_at`, on every pass until sent. It uses SMTP (`lib/email` → `lib/smtp`).
8. **Admin "new order paid" email** (`sendStealthHealthPaidAlertOnce`), claimed through `puramass_orders.admin_paid_alert_sent_at`.

**On `expired` or `cancelled`:** `expireStealthHealthInvoices` runs `invoices.update({status:'expired'}).in('id', ids).eq('status','pending_payment')`.

**Discount code usage limit:** it counts `puramass_orders.status = 'paid'` rows carrying `discount_code_id`. A code's use is therefore consumed when the payment lands, not at hand-off.

---

### Server — env vars & secrets

| name | purpose | required? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL for every server client. `lib/supabase.ts` falls back to a hard-coded project URL; the checkout routes use `!` with no fallback | **yes** |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key (RLS bypass) used by every route here | **yes** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser client; `getSupabase()` falls back to it if the service key is unset, which would break RLS-protected reads | yes (client) |
| `PURAMASS_API_KEY` | partner API key, sent as `X-Api-Key`. Without it the checkout returns 503 | **yes** |
| `PURAMASS_PARTNER_ID` | `X-Partner-ID` header. Default `'ptr_puramass'` | optional (has default; set per site) |
| `PURAMASS_API_BASE_URL` | partner base URL. Default `https://api.stealth.health` | optional |
| `PURAMASS_WEBHOOK_SECRET` | HMAC secret for `X-Stealth-Signature`. Without it the webhook returns 500 | **yes** for payment confirmation by webhook |
| `PURAMASS_CRON_SECRET` / `CRON_SECRET` | auth for `/api/cron/puramass-poll` (pg_cron sends it) | yes for the poller |
| `EASYSHIP_API_KEY` | Easyship bearer token. Fallback when `site_settings.easyship_api_key` is empty | needed only if live rates are on |
| `EASYSHIP_API_URL` | Easyship base. Default `https://public-api.easyship.com/2024-09` | optional |
| `EASYSHIP_ORIGIN_NAME/_COMPANY/_PHONE/_EMAIL/_ADDRESS/_CITY/_POSTAL/_COUNTRY` | origin defaults when `site_settings.shipping_origin` lacks them (country default 'CA') | optional |
| `KLAVIYO_PRIVATE_API_KEY` | fallback when `site_settings.klaviyo_private_api_key` is empty | optional |
| `NEXT_PUBLIC_GTM_CONTAINER_ID`, `NEXT_PUBLIC_GA4_MEASUREMENT_ID`, `NEXT_PUBLIC_KLAVIYO_SITE_ID` | `/api/site-config` fallbacks. The code has built-in VYTA defaults — **change them on a sibling site** | optional |
| `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` / `EMAIL_FROM` | post-payment emails (confirmation, admin alert, affiliate). Default From is `'VYTA <noreply@aminocan.com>'` | yes for emails |

Hard-coded constants to change on a sibling site:
- `SITE_URL = "https://www.vytabio.com"` in `lib/config.ts`. Klaviyo URLs use it.
- `partner_reference` prefix `amc_`.
- Photon User-Agent `aminocan-cad/1.0 …`.
- Cookie names: `aminocan_vid`, `aminocan_sid`, `aminocan_attr`, `aminocan_attr_last`, `aminocan_consent`, `ref_code`, `vyta_lp`.
- Admin SKU prefix `vyta-`.

**site_settings columns read by checkout** (singleton row, `select('*')`):
- Hosted shipping: `puramass_shipping_rates_enabled`, `puramass_flat_shipping`, `puramass_free_shipping_enabled`, `puramass_free_shipping_threshold`.
- Ad discount: `ad_discount_enabled`, `ad_discount_percent`.
- Cart offer: `cart_offer_enabled`, `cart_offer_min_items`, `cart_offer_percent`, `cart_offer_ends_at`.
- Easyship: `easyship_enabled`, `easyship_api_key`, `shipping_origin`, `shipping_box`, `shipping_item_weight_kg`, `shipping_flat_rate`, `shipping_handling_fee_type`, `shipping_handling_fee_value`.
- Klaviyo: `klaviyo_enabled`, `klaviyo_private_api_key`, `klaviyo_server_events_enabled`.
- `puramass_checkout_enabled` exists but is **ignored**: the hosted checkout is always on.

---

### Server — unverified / porting notes

#### Unverified

1. **Partner response contract.** What `order.status` actually returns on create (the code defaults to `'payment_pending'`). Whether `subtotal_cents` is pre- or post-discount, and whether it includes shipping. The commission base trusts `subtotal_cents`; I assume it is the goods total of our discounted `unit_price_cents × quantity`, but nothing in the repo confirms it.
2. **Partner idempotency.** Whether the partner really dedupes on `partner_reference`. The client doc comment claims it, but our route never reuses a reference.
3. **Return/cancel URL after payment.** No URL is sent in the body. Where the buyer lands afterwards (for example an order-confirmation page) must be configured in the partner portal, or is not configurable. The repo does not show it.
4. **Webhook event types and payload.** Only `store_order.payment_complete` is named in comments. The handler reacts to `data.status` values `paid`, `expired` and `cancelled`, and stores any other status string verbatim.
5. **Middleware.** How `middleware.ts` writes `aminocan_attr`, `aminocan_attr_last`, `aminocan_vid`, `ref_code` and `vyta_lp`: their exact encoding and expiry, other than `vyta_lp`'s 30-day max-age and the touch encoding in `lib/analytics/attribution.ts` (`encodeTouch`/`decodeTouch` use compact keys, URI-encoded JSON). That file is outside this section.
6. **Settings reach the storefront by another route.** Which public route serves the hosted shipping and promo settings (free-shipping threshold, cart offer, ad discount) to the storefront. It is not `/api/site-config`; probably an admin or public settings route, outside this scope.
7. **Ad-discount percentage cap.** The comment says the admin settings route caps `ad_discount_percent` at 99. The shaper itself clamps only to 100, and the zero-price guard catches 100%. I did not verify this.
8. **`lib/customer/api.ts`.** How the account page lists hosted orders (invoices with source `stealth_health`). Not read.
9. **Email templates.** The content of the confirmation, admin-alert and affiliate emails is not documented here.

#### Porting notes (behaviours that are easy to miss)

1. **Rate limiting** is in-memory per instance. On serverless with many instances it is weak.
2. **The settings row** is read before the body is validated, and again inside `getShippingConfig` and `readKlaviyoSettings`. That is up to three reads of `site_settings` per checkout.
3. **The ledger insert can fail** (for a reason other than a missing column) while the buyer is still redirected to pay. The payment then arrives for an unknown `transaction_id`, and the webhook ACKs it as `unmatched`. Consider making the ledger insert fatal, or inserting before calling the partner.
4. **Attribution writes use `void`, not `after()`.** `linkVisitorIdentity` and `stampVisitorMilestone` can be cut off on serverless. Only Klaviyo is inside `after()`.
5. **`quantity` means total vials**, not packs. The server derives packs with `round(vials/packSize)` and clamps each merged line to 1–99. A browser that sends packs instead would under-order.
6. **Pack validity is not checked.** Any `packSize > 1` maps to the case SKU, priced by `pack_options[size].price` (even when disabled) or `vialPrice × size`. Add a check against `packSizesFor(product)` if needed.
7. **Inactive products** are not rejected at checkout. Only a missing SKU (409) or a zero price (500) stops them.
8. **Two different "first order" rules:**
   - The ad discount counts `paid` **and** `payment_pending` hand-offs by `customer_id` only, plus the legacy flag.
   - First-order-only codes count only `paid`, by customer id **or** email, across `customers`, `orders` and `puramass_orders`.
   - A buyer retrying a checkout loses the ad discount, but not a first-order code, until the first pending hand-off expires.
9. **Code vs ad discount** is decided by the effective share of the whole order, and a tie goes to the code. The cart offer always composes on top. The landing code and a typed code never stack.
10. **`discount_code_id` is recorded even when the code lost to the ad discount.** The affiliate behind the code is then still credited at payment, because `resolveDiscountCodeCredit` uses `discount_code_id`. Likewise, `countDiscountCodeUses` counts that paid order against `max_uses`.
11. **`ad_discount_cents`** is the **total** saving from all promos, not only the ad discount.
12. **Picking 'flat' while live rates exist** charges the bare default of 35 CAD, not the configured `puramass_flat_shipping`, because `selectHostedRate` falls back to `flatHostedRate()` with no argument.
13. **Free shipping requires live rates.** It is forced off when `puramass_shipping_rates_enabled` is false. It is measured on the **list** subtotal, so it is not reduced by discounts.
14. **The rates endpoint leaks `settings` and a `debug` string** to the browser (marked TEMP DEBUG). Strip both when porting.
15. **Address requirement depends on the rates switch.**
    - Rates enabled: the server requires a full address and stores it as `shipping_address_source='customer'`. Later partner payloads cannot overwrite it.
    - Rates disabled: no address is required, and the partner's address fills the row later.
    - The country gate (CA only) applies whenever a country was sent.
16. **No stock check at hand-off.** Overselling is possible, because stock is decremented only when payment is confirmed, through `adjust_stock_for_invoice`, which counts `qty × vials_per_unit` and floors at 0.
17. **`/api/orders` and `/api/orders/my-orders`** only read the legacy `orders` table. They will not show hosted orders. For a pure-hosted sibling site, either drop them or point them at `puramass_orders` / `invoices`.
18. **Supabase clients.** Every route here uses the service role. When porting, use `getSupabase()` (or an equivalent service-role client) for all of them. Never use the anon `supabase` client for these reads or writes, because `puramass_orders`, `discount_codes`, `landing_pages`, `visitor_attribution` and `commissions` are service-only tables.
19. **Migrations needed for full behaviour** (each is optional at runtime thanks to the column shedding):
    - `puramass-hosted-checkout-migration.sql`
    - `marketing-attribution-migration.sql`
    - `puramass-shipping-address-migration.sql`
    - `puramass-missing-address-migration.sql`
    - `puramass-hosted-shipping-migration.sql`
    - `puramass-order-details-migration.sql`
    - `ad-discount-promo-migration.sql`
    - `cart-upsells-migration.sql`
    - `affiliate-discount-codes-payouts-migration.sql`
    - `landing-pages-migration.sql`
    - `stealth-health-pending-invoice-migration.sql`, or `stock-ledger-migration.sql`, which re-carries it
    - `affiliate-commission-hosted-checkout-migration.sql`
    - `invoice-number-vyta-prefix-migration.sql`
    - the order-confirmation and admin-paid-alert migrations, which provide `confirmation_email_sent_at` and `admin_paid_alert_sent_at`

---

## Part 4 — Payment lifecycle

Scope: everything after `POST /api/checkout/puramass` returns `{ payment_link, ... }` and the browser does
`window.location.href = json.payment_link` (app/checkout/PuramassCheckoutContent.tsx:923).

Naming: the processor is called **Puramass / PuraMass** in code identifiers (`puramass_*` tables, `lib/payments/puramass*.ts`)
and **Stealth Health** in comments, log prefixes, admin UI and env-facing text. They are the same partner. The
partner API base URL is `https://api.stealth.health`. Webhook path is `/api/webhooks/stealth-health`.

Two independent order systems exist in this repo — keep them apart when porting:

| System | Table | Paid signal | Relevant to the Puramass port? |
|---|---|---|---|
| Hosted checkout (Puramass / Stealth Health) | `puramass_orders` (the "hand-off ledger") + a linked `invoices` row (`source = 'stealth_health'`) | webhook `store_order.payment_complete`, pg_cron poller, admin refresh/sync | **YES — this is the live checkout** |
| Legacy crypto storefront | `orders` | blockchain check (`/api/orders/check-payment`, `/api/cron/check-payments`) | No (legacy; documented only for completeness, §Routes) |

All server code in this section uses the **service-role** Supabase client: either `getSupabase()` from `lib/supabase.ts`
(`createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken:false, persistSession:false } })`)
or a module-scope `createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)`.
No anon-key client is used anywhere in the post-payment path. `puramass_orders` RLS policy is
`"Service role full access" FOR ALL USING (true) WITH CHECK (true)` (no role clause — see porting note 14).

---

### Lifecycle — order status state machine

#### Tables and the status-bearing columns

**`puramass_orders`** (created by `puramass-hosted-checkout-migration.sql`, extended by many later migrations):

| Column | Type | Meaning / writer |
|---|---|---|
| `id` | uuid PK | |
| `partner_reference` | text NOT NULL UNIQUE | our id sent to the partner (idempotency key) |
| `transaction_id` | text | partner order id (`GET /partner/store/orders/{transaction_id}`) |
| `payment_link` | text | hosted payment URL |
| `status` | text NOT NULL DEFAULT `'payment_pending'` | **free text, no CHECK** — values seen: `payment_pending`, `paid`, `expired`, `cancelled` (copied verbatim from the partner) |
| `subtotal_cents` | int | |
| `customer_id` | uuid → customers ON DELETE SET NULL | |
| `customer_email` | text | the email typed at our checkout (never overwritten by partner) |
| `items` | jsonb NOT NULL DEFAULT '[]' | lines sent at hand-off: `{ sku, quantity, unit_price_cents, product_id, pack_size, list_unit_price_cents }` |
| `referral_code` | text | |
| `paid_at` | timestamptz | set when status → paid |
| `currency` | text | lower-case, e.g. `'cad'` |
| `last_event_id` | text | last processed webhook `event_id` (dedupe) |
| `invoice_id` | uuid (no FK) | linked `invoices.id` |
| `created_at`, `updated_at` | timestamptz | `updated_at` maintained by trigger `puramass_orders_updated_at` |
| `shipping_address` jsonb, `customer_name`, `customer_phone` | | puramass-shipping-address-migration.sql |
| `shipping_address_source` (`'puramass'`/`'customer'`), `shipping_address_updated_at`, `address_requested_at` | | puramass-missing-address-migration.sql |
| `expires_at`, `refunded_total_cents`, `refunds` jsonb, `paid_items` jsonb | | puramass-order-details-migration.sql |
| `shipping_total_cents`, `shipping_courier`, `shipping_courier_id` | | puramass-hosted-shipping-migration.sql |
| `recovery_email_sent_at`, `recovery_email_count` int NOT NULL DEFAULT 0, `recovery_promo_code`, `recovery_discount_type` (`'percentage'`/`'fixed'`), `recovery_discount_value` numeric(10,2) | | abandoned-checkout-recovery-migration.sql |
| `confirmation_email_sent_at` | timestamptz | order-confirmation-email-migration.sql — customer email claim |
| `admin_paid_alert_sent_at` | timestamptz | stealth-health-admin-paid-alert-migration.sql — admin email claim |
| `attribution_channel`, `attribution_campaign`, `attribution` jsonb | | marketing-attribution-migration.sql |
| `discount_code_id`, `discount_code`, `discount_code_percent`, `discount_code_cents`, `ad_discount_percent`, `ad_discount_cents`, `cart_offer_percent`, `cart_offer_min_items`, `landing_page` | | written at hand-off (see checkout section); read post-payment for commission + email discount label |
| `settlement_invoice_id` uuid → stealth_health_invoices, `settlement_excluded` bool NOT NULL DEFAULT false | | stealth-health-settlement-migration.sql |

**`invoices`** (the fulfillment record behind a Stealth Health order, `source = 'stealth_health'`):
- `status` CHECK ∈ `draft, sent, partial, paid, overdue, cancelled, pending_payment, expired` (stock-ledger-migration.sql).
  Stealth Health invoices only ever use `pending_payment`, `expired`, `paid` automatically (admins can set others manually).
- `fulfillment_status` text NOT NULL DEFAULT `'pending'`; warehouse moves it to `packed`, `shipped`, `picked_up`, `dropped_off` (lib/warehouse/server.ts).
- `stock_adjusted boolean NOT NULL DEFAULT false` — stock idempotency flag.
- `invoice_number` default `'VYTA-' || nextval('invoice_number_seq')`.

**`orders`** (legacy crypto): `pending → received → confirmed`, `pending → expired`; tracker UI also knows `processing, shipped, delivered, cancelled`.

#### Diagram — `puramass_orders.status`

```
                       (hand-off insert by POST /api/checkout/puramass:
                        status = partnerOrder.status || 'payment_pending')
                                        |
                                        v
                              +-------------------+
                              |  payment_pending  |
                              +-------------------+
          remote 'paid'        |       |        |   remote 'cancelled'
   (webhook / poll / sync /    |       |        +-----------------------------+
    admin refresh)             |       |  created_at < now-7d-6h              |
                               |       |  (poll cron expiry sweep)            |
                               v       |  or remote 'expired'                 v
                          +--------+   |                               +-----------+
                          |  paid  |   +--------------> +---------+    | cancelled |
                          +--------+                    | expired |    +-----------+
                               ^                        +---------+
                               |  remote 'paid' on an expired row:          |
                               +--- ONLY webhook or admin refresh ----------+
                                    (poll + sync treat expired/cancelled/paid as terminal)
```

Terminal set used by poll + sync (`PURAMASS_TERMINAL_STATUSES` in lib/payments/puramass-poll.ts): `['paid', 'expired', 'cancelled']`.
The **webhook and the admin refresh do NOT honour terminal states** — they write whatever `status` the partner reports
(see Unverified/porting notes).

#### Diagram — linked `invoices` row (source = 'stealth_health')

```
 hand-off (createPendingStealthHealthInvoice) ──> pending_payment ──(markInvoicePaid)──> paid
                                                       │                                ^
          sweep / remote expired|cancelled             │                                │
          (expireStealthHealthInvoices: only           v                                │
           WHERE status='pending_payment')          expired ────(markInvoicePaid)───────┘
                                                                (late payment in grace window)

 no invoice at paid time (legacy hand-off / invoice deleted) ──> createPaidInvoice ──> paid (inserted directly)
 admin PATCH /api/admin/invoices/[id] {status:'cancelled'} on a stocked invoice ──> restore_stock_for_invoice
```

#### Who sets each transition (exhaustive)

| Transition | Who | Guard |
|---|---|---|
| insert `payment_pending` (or partner-returned status) | `POST /api/checkout/puramass` | `partner_reference` UNIQUE |
| `payment_pending → paid/expired/cancelled/<any>` | webhook `POST /api/webhooks/stealth-health` | only `last_event_id !== event_id`; **no status guard** |
| `payment_pending → <remote status>` | `applyPuramassStatus` (poll cron, admin sync) | skip if local status ∈ terminal, remote empty, or equal; conditional update `.eq('status', order.status)` |
| `payment_pending → expired` (time) | poll cron step 1 | `.eq('status','payment_pending').lt('created_at', now − 7d − 6h)` |
| `<any> → <remote status>` | admin refresh `POST /api/admin/puramass/orders/refresh` | none (update by `transaction_id`) |
| invoice `pending_payment|expired → paid` | `markInvoicePaid` inside `materializeStealthHealthFulfillment` | `.in('status', ['pending_payment','expired'])`; returns true only for the call that changed the row (`firstPaid`) |
| invoice `pending_payment → expired` | `expireStealthHealthInvoices` (poll sweep; webhook & poll on remote `expired`/`cancelled`) | `.eq('status','pending_payment')` |
| invoice `→ paid` manually | admin `PATCH /api/admin/invoices/[id]` or `POST /api/admin/invoices/[id]/payments` (full payment) | `!wasPaid`; **does not** change `puramass_orders.status` |

`paid_at` is set: webhook → `data.occurred_at ?? payload.created_at ?? now`; poll/sync → `remote.paid_at ?? now`; refresh → `status.paid_at ?? now`.

---

### Lifecycle — payment confirmation paths

There are four paths that observe a payment for a hosted order, plus the admin manual mark-paid. All paid paths
converge on `materializeStealthHealthFulfillment(db, ledger, paidItems)` (lib/payments/puramass-fulfillment.ts), which is
idempotent and re-runnable.

#### Partner API used by polling paths

`fetchPuramassOrderStatus(transactionId)` — `GET {PURAMASS_API_BASE_URL || 'https://api.stealth.health'}/partner/store/orders/{encodeURIComponent(transactionId)}`
headers `X-Partner-ID: PURAMASS_PARTNER_ID || 'ptr_puramass'`, `X-Api-Key: PURAMASS_API_KEY`, `cache: 'no-store'`, 20 000 ms timeout (AbortController).
Errors → `PuramassApiError(status, detail)`: no key → 503 `'Stealth Health is not configured'`; timeout → 504 `'Stealth Health request timed out'`;
network → 502 `'Could not reach Stealth Health'`; non-2xx → `(res.status, body.error ?? body.message ?? body.detail ?? JSON(errors) (≤300 chars) ?? 'Stealth Health API error <status>')`.
Response envelope: `json.order ?? json`. Normalized to:

```ts
interface PuramassOrderStatus {
  transaction_id: string; status: string /* '' if absent */; partner_reference: string|null;
  currency: string|null; subtotal_cents: number|null; payment_link: string|null;
  created_at: string|null; paid_at: string|null; expires_at: string|null;
  items: { sku?, name?, quantity?, unit_price_cents? }[];
  refunded_total_cents: number|null; refunds: unknown[];
  shipping: { address, address2, city, state, zip, country } | null;   // normalizePuramassShipping(order.shipping ?? order.shipping_address)
  customer: { name, email, phone };                                     // normalizePuramassContact(order.customer)
}
```
`normalizePuramassShipping` accepts aliases `address|address1|line1`, `address2|line2`, `state|province|region`, `zip|postal_code|postcode`; all-blank → null.
`normalizePuramassContact`: `name` = `r.name` else `first_name + ' ' + last_name`.

#### Shared patch builders (lib/payments/puramass.ts)

`buildPuramassContactPatch(row, { shipping, customer })` — additive:
- writes `shipping_address` (+ `shipping_address_source:'puramass'`, `shipping_address_updated_at: now`) only if the incoming normalized address is non-null, differs (JSON compare) from the stored normalized address, AND the row is NOT customer-owned (`shipping_address_source === 'customer' && shipping_address` → never overwritten).
- `customer_name` / `customer_phone` written when non-empty and different.
- `customer_email` only filled when the row has none.

`buildPuramassOrderDetailPatch({ expires_at, refunded_total_cents, refunds, items })`:
`expires_at` if non-empty string; `refunded_total_cents` if number; `refunds` if array; `paid_items` = items that have `unit_price_cents` or `name` (if ≥1).

Missing-column tolerance (lib/payments/puramass-columns.ts): `isMissingColumnError(err)` = code `42703` or `PGRST204`, or message matches `/\bcolumn\b/i && /does not exist/i` or `/in the schema cache/i`. `stripUnmigratedFields(patch)` drops every key in `PURAMASS_OPTIONAL_COLUMNS` (address, order-detail, shipping and recovery column groups listed in that file). Every write path retries once with the stripped patch.

#### Path A — Webhook `POST /api/webhooks/stealth-health` (push)

File: app/api/webhooks/stealth-health/route.ts. `export const runtime = 'nodejs'`. Public; HMAC is the auth.

1. `raw = await req.text()`.
2. `handle()`:
   1. If `PURAMASS_WEBHOOK_SECRET` unset → outcome `not_configured`, **500** `{ "error": "webhook not configured" }` (console: `[stealth-health] PURAMASS_WEBHOOK_SECRET not set — rejecting`).
   2. Verify header `x-stealth-signature`: value `sha256=<hex>` (prefix optional). Expected = `HMAC_SHA256(PURAMASS_WEBHOOK_SECRET, rawBody utf8).hex`; length-guarded `timingSafeEqual` on the hex strings. Fail → `bad_signature`, **401** `{ "error": "bad signature" }`.
   3. `JSON.parse(raw)` fails → `unparseable`, **200** `{ "received": true, "matched": false }`.
   4. Extract: `eventId = payload.event_id`, `partnerReference = payload.partner_reference`, `data = payload.data ?? {}`,
      `orderBody = data.order ?? payload.order ?? data`, `transactionId = data.transaction_id ?? data.order_id`,
      `status = data.status`, `currency = data.currency`, `occurredAt = data.occurred_at ?? payload.created_at`.
   5. Match ledger row: by `transaction_id`, then by `partner_reference`. Select ladder (first that does not raise a missing-column error):
      - `id, status, last_event_id, transaction_id, customer_id, customer_email, items, subtotal_cents, invoice_id, referral_code, currency, shipping_total_cents, shipping_courier_id, shipping_address, shipping_address_source, customer_name, customer_phone`
      - same minus `shipping_total_cents, shipping_courier_id`
      - base only (`id … currency`).
   6. No row → `unmatched`, **200** `{ "received": true, "matched": false }`.
   7. `eventId && row.last_event_id === eventId` → `deduped`, **200** `{ "received": true, "deduped": true }`.
   8. Build `update`: `status`, `last_event_id`, `currency`, `paid_at` (if status==='paid'), `transaction_id` (if matched by reference and row had none), + contact patch (from `orderBody.shipping/customer`) + detail patch (from `orderBody.expires_at/refunded_total_cents/refunds/items`).
   9. `UPDATE puramass_orders SET … WHERE id = row.id`; on missing-column error retry with `stripUnmigratedFields`. Any other error → `update_failed`, **500** `{ "error": "update failed" }` (partner retries).
   10. If `status === 'paid'`: `attributeHostedPurchase(db, { id, customer_email, attribution_channel: row.attribution_channel ?? null })` then `materializeStealthHealthFulfillment(db, {id, customer_id, customer_email, customer_name, items, subtotal_cents, invoice_id, referral_code}, orderBody.items ?? [])`. Runs on **every** paid delivery (idempotent).
   11. If `status === 'expired' || 'cancelled'`: `expireStealthHealthInvoices(db, [row.invoice_id])`.
   12. → `matched`, **200** `{ "received": true, "matched": true }`.
3. Any throw → `error`, **500** `{ "error": "internal error" }`.
4. **Every** delivery (any outcome) is logged via `logWebhookEvent` → INSERT `puramass_webhook_events` (best-effort, never changes the response).

Sample authentic payload (from lib/payments/puramass-webhook-log.test.ts):
```json
{ "event_id":"evt_b275e85d6d491024c589b486", "event_type":"store_order.payment_complete", "referral_id":null,
  "partner_reference":"amc_f71956b5-09c6-435c-99d5-2b1793fe3a75",
  "data":{ "status":"paid", "product_category":null, "occurred_at":"2026-09-24T04:38:42.083Z",
    "transaction_id":"7ylSVLdOqhvvc9BRZPt9", "order_id":"7ylSVLdOqhvvc9BRZPt9", "payment_mode":"customer", "currency":"cad",
    "customer":{"first_name":"Test","last_name":"Buyer","email":"buyer@example.com","phone":null},
    "shipping":{"address":"6 Milepost Place","address2":"206","city":"Toronto","state":"ON","zip":"M4H 1C9","country":"CA"},
    "items":[{"sku":"aminocan-retatrutide-10mg-vial","name":"Retatrutide 10mg","quantity":2,"unit_price_cents":15000}] },
  "metadata":{}, "created_at":"2026-09-24T04:38:42.083Z", "patient_id":null, "appointment_id":null }
```
Note: `customer`/`shipping`/`items` sit directly under `data` (the `orderBody = data` fallback); `occurred_at` is under `data`.

`puramass_webhook_events` row (`buildWebhookEventRow`, puramass-webhook-events-migration.sql):
`event_id, event_type, partner_reference` (top level); `transaction_id = data.transaction_id ?? data.order_id`; `status, currency` from `data`;
`customer_email = (data.order ?? payload.order ?? data).customer.email`; `occurred_at = valid-date(data.occurred_at) ?? valid-date(payload.created_at)`;
`signature_valid`; `payload` (parsed object or null); `raw_body` = raw (≤ 64×1024 chars) **only when nothing parsed**; `puramass_order_id`; `outcome`
∈ `matched|unmatched|deduped|bad_signature|not_configured|unparseable|update_failed|error`; `response_status`; `response_body`; `error`.
Table also has `id BIGSERIAL`, `received_at DEFAULT now()`; FK `puramass_order_id → puramass_orders ON DELETE SET NULL`; RLS enabled with no policy (service role only). Note: payload is not passed to the logger for `bad_signature` (ctx.payload unset) so `raw_body` holds the raw text.

#### Path B — Poll cron `GET /api/cron/puramass-poll` (pull fallback)

File: app/api/cron/puramass-poll/route.ts. Constants: `SEVEN_DAYS_MS = 7*24*3600*1000`, `GRACE_MS = 6*3600*1000`, `CONCURRENCY = 8`, `MAX_PER_RUN = 200`.

1. Auth: `cronSecret = PURAMASS_CRON_SECRET || CRON_SECRET`; provided = `x-cron-key` header || `?key=` query || `Authorization: Bearer …`. Missing secret or mismatch → **401** `{ "error": "Unauthorized" }` (fails closed).
2. `!isPuramassConfigured()` (needs `PURAMASS_API_KEY` and partner id) → **200** `{ "skipped": "not_configured" }`.
3. `windowStart = now − 7d − 6h`.
4. **Expiry sweep**: `UPDATE puramass_orders SET status='expired' WHERE status='payment_pending' AND created_at < windowStart RETURNING id, invoice_id`; then `expireStealthHealthInvoices(those invoice_ids)`.
5. **Self-heal**: `healStealthHealthPaidOrders(db)` (defaults `days=14`, `limit=50`) — runs before polling so a 429 can't skip it:
   - Read `puramass_orders` `status='paid' AND invoice_id NOT NULL AND created_at >= now−14d` ORDER BY created_at DESC LIMIT 200; read their invoices; for those whose invoice status ∈ `pending_payment|expired` (first 50) re-run `materializeStealthHealthFulfillment(..., null)`. Rows with no invoice or a deleted invoice are deliberately skipped.
   - `invoices WHERE source='stealth_health' AND status='paid' AND stock_adjusted=false AND created_at >= since LIMIT 50` → `takeStealthHealthStock`.
6. **Poll set**: `puramass_orders WHERE status='payment_pending' AND created_at >= windowStart AND transaction_id IS NOT NULL ORDER BY created_at ASC LIMIT 200`, select ladder:
   full (`id, status, transaction_id, customer_id, customer_email, customer_name, customer_phone, items, subtotal_cents, invoice_id, referral_code, currency, shipping_total_cents, shipping_courier_id, shipping_address, shipping_address_source, created_at`) → minus shipping cols → minimal. Other error → **500** `{ "error": <message> }`.
7. Chunks of 8 in parallel: `fetchPuramassOrderStatus` → `applyPuramassStatus`. A `PuramassApiError` with status 429 sets `rateLimited` and stops further chunks.
8. **200** response:
```json
{ "polled": n, "paid": n, "expired": n, "cancelled": n, "errors": n, "rate_limited": bool,
  "pending_total": n, "healed_invoices": n, "healed_stock": n }
```
(`expired` = swept + polled-to-expired.)

`applyPuramassStatus(db, order, remote)` (lib/payments/puramass-poll.ts) → `{ changed, status, materialized, contactUpdated }`:
- Build contact + detail patches.
- **No-op path** (local status terminal, or remote status empty, or equal): if patches non-empty, `UPDATE … WHERE id` (retry stripped; errors ignored). Returns `changed:false`. This is how an address/refund gets back-filled onto a paid order.
- **Flip path**: `update = {...contact, ...detail, status: remote.status, currency?, subtotal_cents?, paid_at? }` then
  `UPDATE puramass_orders SET … WHERE id = order.id AND status = order.status RETURNING id` (`maybeSingle`); retry stripped on missing column. Error or no row returned → lost the race → `changed:false`, **no side-effects**.
- On `paid`: `attributeHostedPurchase(db, {id, customer_email})` then `materializeStealthHealthFulfillment(db, {..., subtotal_cents: remote.subtotal_cents ?? order.subtotal_cents}, remote.items)`; `materialized = res.created`.
- On `expired`/`cancelled`: `expireStealthHealthInvoices(db, [order.invoice_id])`.

#### Path C — Admin bulk sync `POST /api/admin/puramass/orders/sync`

Admin/assistant (Bearer Supabase JWT; `customers.role ∈ {admin, assistant}`) else **403** `{ "error": "Unauthorized" }`. Not configured → **503** `{ "error": "Stealth Health is not configured." }`.
Body (all optional, empty body allowed): `{ ids?: string[], statuses?: string[], limit?: number }`; `limit = min(250, max(1, limit||250))`.
Query: `transaction_id NOT NULL`, ORDER BY created_at DESC, `ids` (precedence) or `statuses` filter. Select `LEDGER_SELECT` → legacy fallback. Query error → **500** `{ "error": "Could not load orders: <msg>" }`.
Concurrency 6; same `applyPuramassStatus` (so terminal rows only get contact/detail patches); stops on 429.
Response **200** `{ total, polled, changed, paid, addresses, errors, rate_limited }` (`addresses` = rows with `contactUpdated`). Empty set returns all zeros.

#### Path D — Admin per-row refresh `POST /api/admin/puramass/orders/refresh`

Admin/assistant else **403** `{ "error": "Unauthorized" }`; not configured **503** `{ "error": "Stealth Health is not configured." }`; bad JSON **400** `{ "error": "Invalid JSON" }`; missing **400** `{ "error": "transaction_id is required." }`.
Body `{ transaction_id: string }`.
1. `fetchPuramassOrderStatus` — `PuramassApiError` 4xx → `{ error: err.detail }` with that status; otherwise **502** `{ "error": "Could not reach Stealth Health." }`.
2. Read existing `shipping_address, shipping_address_source, customer_name, customer_phone, customer_email` by `transaction_id`.
3. `update` = `status`, `currency`, `subtotal_cents`, `paid_at` (if paid) + contact patch + detail patch. **No status guard.**
4. `UPDATE … WHERE transaction_id = $1 RETURNING id, status, paid_at, currency, subtotal_cents, shipping_total_cents, shipping_courier_id, customer_id, customer_email, customer_name, customer_phone, shipping_address, shipping_address_source, items, invoice_id, referral_code` with 2 fallbacks (drop shipping cols; then strip patch + minimal select). Error → **500** `{ "error": "Could not update the order: <msg>" }`; no row → **404** `{ "error": "No matching order found." }`.
5. If remote `paid` → `materializeStealthHealthFulfillment(db, row, status.items)` (**no** `attributeHostedPurchase`, **no** invoice expiry on expired/cancelled).
6. **200** `{ "success": true, "status": <remote status>, "order": <row> }`.

#### Path E — Admin marks the linked invoice paid (manual)

`PATCH /api/admin/invoices/[id]` with `status:'paid'` (first transition) or `POST /api/admin/invoices/[id]/payments` that brings `totalPaid >= total − 0.001`:
`adjustInvoiceStock(db, id, actor_email)` (+ low-stock check), then `after(() => sendConfirmationForPaidInvoice(db, id))` and `after(() => sendStealthHealthPaidAlertForInvoice(db, id))` (`paidVia:'admin'`, `transition:true`).
It does **not** set `puramass_orders.status/paid_at`, does not credit the affiliate, does not send Klaviyo, does not book the Easyship shipment (unless the PATCH body sets `create_easyship_shipment`).

#### `materializeStealthHealthFulfillment(db, ledger, paidItems)` — the convergence point

Signature: `(db: SupabaseClient, ledger: { id; customer_id?; customer_email?; customer_name?; items?; subtotal_cents?; invoice_id?; referral_code? }, paidItems: {sku?,name?,quantity?,unit_price_cents?}[] | null) => Promise<{ created: boolean; invoiceId?: string }>`. Never throws.

Steps, in order:
1. `stored = SELECT * FROM puramass_orders WHERE id` (tolerates unmigrated columns).
2. `invoiceId = ledger.invoice_id ?? stored.invoice_id`. If set, read `invoices(id,status)`; a deleted invoice → treated as none.
3. **No invoice** → `createPaidInvoice` (inserted already `status:'paid'`), `firstPaid = true`. Lines:
   - from `ledger.items` when every line has `product_id` and `pack_size ≥ 1`: `description = "<product name> — Pack of N"` or `"<name> — Single vial"`, `qty`, `unit_price = unit_price_cents/100`, `price_type = pack>1 ? 'box':'vial'`, `vials_per_unit = pack`;
   - else from `paidItems` (or ledger sku/qty): `price_type` from SKU suffix (`-vial` → vial) or name ending `(Single Vial)`; only vial SKUs are mapped to a product via `products.puramass_sku_vial`; `vials_per_unit = 1`.
   Header: `source:'stealth_health', customer_id, customer_email, customer_name, fulfillment_type:'shipment', fulfillment_status:'pending', status:'paid', currency:'CAD', subtotal = subtotal_cents/100 (else line sum), tax_total:0, shipping_cost = shipping_total_cents/100 (else 35), total, is_backorder:false, non_payable:false, notes:'Placed via the Stealth Health checkout. Payment and taxes are handled by Stealth Health.', issue_date: todayInAppTz()`, plus `easyship_courier_id = stored.shipping_courier_id` (dropped on missing column). Then link `puramass_orders.invoice_id` `WHERE invoice_id IS NULL`.
4. **Invoice in `pending_payment|expired`** → `markInvoicePaid`: `UPDATE invoices SET status='paid', customer_email?, customer_name? WHERE id AND status IN ('pending_payment','expired') RETURNING id` → `firstPaid = rows>0`.
5. `takeStealthHealthStock(db, invoiceId)` — **every pass** (see side-effects).
6. If `firstPaid`: `onFirstPaid` → Klaviyo `trackPlacedOrder`.
7. `creditAffiliate` — every pass (idempotent).
8. `bookShipment` — every pass (no-op once invoice has `easyship_shipment_id`).
9. `sendConfirmation` → `sendStealthHealthOrderConfirmationOnce` — every pass (claimed once).
10. `sendAdminAlert` → `sendStealthHealthPaidAlertOnce(db, ledgerId, { transition: firstPaid, paidVia: 'checkout' })` — every pass (claimed once).
Returns `{ created: firstPaid, invoiceId }`.

#### Idempotency guards summary

| Effect | Guard |
|---|---|
| Webhook redelivery | `puramass_orders.last_event_id === event_id` |
| Poll/sync status flip | conditional `UPDATE … WHERE status = <old>`; terminal statuses skipped |
| Invoice → paid | `UPDATE … WHERE status IN ('pending_payment','expired')` returns rows |
| Invoice creation on paid | link `UPDATE puramass_orders SET invoice_id WHERE invoice_id IS NULL` (two racing creators could each insert an invoice — see notes) |
| Stock | `adjust_stock_for_invoice` locks `invoices` row `FOR UPDATE` and returns if `stock_adjusted IS DISTINCT FROM false` |
| Klaviyo Placed Order | only when `firstPaid`; Klaviyo `unique_id = invoiceId` (`<invoiceId>:<idx>` for Ordered Product) |
| Affiliate commission | pre-check `commissions.invoice_id`; partial UNIQUE index `idx_commissions_invoice_unique`; `23505` treated as already-recorded |
| Customer confirmation email | claim `puramass_orders.confirmation_email_sent_at NULL → now()`; released on send failure |
| Admin paid alert | claim `puramass_orders.admin_paid_alert_sent_at NULL → now()`; released on send failure |
| Easyship shipment | skipped when invoice `easyship_shipment_id` already set |
| Attribution | `visitor_attribution.purchased_at` only set where null; `puramass_orders.attribution_channel` only where null |

---

### Lifecycle — post-paid side-effects

#### 1. Stock decrement

`takeStealthHealthStock(db, invoiceId): Promise<{ taken: boolean; unlinked: string[] }>` (puramass-fulfillment.ts):
1. `SELECT status, stock_adjusted FROM invoices WHERE id`. Not found or `status !== 'paid'` → `{taken:false}`.
2. If `stock_adjusted !== true` → `adjustInvoiceStock(db, invoiceId, 'stealth-health')` (lib/admin/stock-ledger.ts):
   `db.rpc('adjust_stock_for_invoice', { p_invoice_id, p_actor_email: 'stealth-health' })`; if the RPC is missing (`PGRST202`/`42883`/message `could not find the function|function .* does not exist`) retry `rpc('adjust_stock_for_invoice', { p_invoice_id })`.
3. Reads lines; lines with `product_id IS NULL` are logged (`[stealth-health] invoice %s has lines with no product — no stock taken for: …`) and returned as `unlinked` (`"<description> × <qty>"`). They surface in Stock Ledger → Needs attention (`take_stock_for_invoice_lines` RPC links them later).
4. If taken: `checkLowStockForProducts(db, productIds)` (lib/admin/low-stock.ts — sets `products.low_stock_alerted=true` then emails admin list when `stock_quantity <= low_stock_threshold ?? 10`; resets when recovered).

Current RPC body (stock-ledger-migration.sql — supersedes stock-decrement-migration.sql / product-history-migration.sql / stealth-health-pending-invoice-migration.sql versions; all define the same 2-arg signature):

```sql
CREATE OR REPLACE FUNCTION adjust_stock_for_invoice(p_invoice_id uuid, p_actor_email text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_already boolean;
BEGIN
  SELECT stock_adjusted INTO v_already FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_already IS DISTINCT FROM false THEN RETURN; END IF;   -- not found, or already adjusted
  WITH agg AS (
    SELECT product_id, SUM(qty * COALESCE(vials_per_unit, 1))::int AS qty
    FROM invoice_line_items WHERE invoice_id = p_invoice_id AND product_id IS NOT NULL GROUP BY product_id
  ), before AS (
    SELECT p.id, COALESCE(p.stock_quantity, 0) AS old_qty, agg.qty FROM products p JOIN agg ON p.id = agg.product_id
  ), upd AS (
    UPDATE products p SET stock_quantity = GREATEST(0, b.old_qty - b.qty) FROM before b WHERE p.id = b.id RETURNING p.id
  )
  INSERT INTO product_history (product_id, change_type, field, old_value, new_value, source, reference_type, reference_id, note, actor_email)
  SELECT b.id, 'stock', 'stock_quantity', b.old_qty::text, GREATEST(0, b.old_qty - b.qty)::text,
         'invoice_paid', 'invoice', p_invoice_id::text,
         'Stock decremented by ' || b.qty || ' when invoice was marked paid', p_actor_email
  FROM before b;
  UPDATE invoices SET stock_adjusted = true WHERE id = p_invoice_id;
END; $$;
```
Key facts: stock unit is **vials**; a pack line takes `qty × vials_per_unit`; floor at 0; one `product_history` row per product; the flag is set even when no line has a product.
Inverse `restore_stock_for_invoice(p_invoice_id, p_actor_email)`: `UPDATE invoices SET stock_adjusted=false WHERE id AND stock_adjusted=true` (returns if not found), adds the same vial sums back, history `source 'invoice_cancel'`, note `'Stock restored (+' || qty || ') when invoice was cancelled'`. Called only by admin `PATCH /api/admin/invoices/[id]` on transition to `cancelled`. **Refunds/cancellations reported by the partner never restore stock.**

Legacy crypto `orders`: `adjustStockForConfirmedOrder(db, orderId, actorEmail=null)` (lib/order-stock.ts) → short-circuit on `orders.stock_adjusted`, then `rpc('adjust_stock_for_order', { p_order_id, p_actor_email })`. Current definition (case-vial-stock-decrement-migration.sql) reads `orders.items` JSONB: per element with uuid `id`, qty = `quantity × (unit='case' ? GREATEST(1, vials_per_box) : 1)`; floor at 0; history `source 'order_confirmed'`, note `'Stock decremented by N vials when order was confirmed'`; sets `orders.stock_adjusted = true`. (order-stock-decrement-jsonb-migration.sql and product-history-migration.sql hold older versions; product-history's reads `order_items` instead.)

#### 2. Customer confirmation email (Stealth Health)

`sendStealthHealthOrderConfirmationOnce(db, puramassOrderId): Promise<ConfirmationOutcome>` (lib/order-confirmation.ts). `ConfirmationOutcome = {sent:true} | {sent:false, reason:'not_found'|'not_eligible'|'already_sent'|'no_email'|'not_migrated'|'send_failed'|'error'}`.
1. Load `puramass_orders.*`; if `invoice_id`: `invoices.*` and `invoice_line_items.*`. `paid = invoice exists && (ledger.status==='paid' || invoice.status==='paid')`. Customer row = `customers.*` by `invoice.customer_id ?? ledger.customer_id`.
2. Not paid / no invoice → `not_eligible`. Column `confirmation_email_sent_at` absent from row → `not_migrated` (console warning). Already set → `already_sent`. No deliverable address → `no_email`.
3. **Claim**: `UPDATE puramass_orders SET confirmation_email_sent_at = now() WHERE id AND confirmation_email_sent_at IS NULL RETURNING id`. No row → `already_sent`.
4. `deliver` → `enrichForEmail` (product images: `products.image_url` → absolute `SITE_URL + encodeURI(path)`; `viewOrderUrl` via `buildViewOrderUrl`) → `sendOrderConfirmation(data)`.
5. Log every attempt: INSERT `fulfillment_email_log { order_id:null, invoice_id, to_email, subject, message_id, success, error, sent_by:null, sent_by_email:null, kind:'order_confirmation' }`.
6. Failure → release claim (`SET confirmation_email_sent_at = NULL`) → `send_failed` (retried next pass).

Payload `stealthHealthOrderSummary(ledger, invoice, lines, customer)` (lib/order-confirmation-data.ts):
- `to` = first deliverable of `[customer.email, invoice.customer_email, ledger.customer_email]`; deliverable = matches `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` and does not end in `.local|.invalid|.test|.example`.
- `customerName` = `ledger.customer_name || invoice.customer_name || 'there'`.
- `orderNumber` = `invoice.invoice_number || ledger.partner_reference || ledger.id`.
- items from invoice lines; description `"Name — Pack of N"` / `"Name — Single vial"` split into name + `unit` (`case`/`vial`) + `vialsPerBox`.
- `shipping = invoice.shipping_cost`, `tax = invoice.tax_total`, `total = invoice.total`.
- If every line has a list price in `ledger.items[].list_unit_price_cents` (matched by `product_id|pack_size`) and list sum − charged subtotal ≥ 0.01 → lines shown at list price, `subtotal = listSum`, `discount = difference`, `discountLabel = discountLabelFor(ledger)` = join(' + ') of `discount_code` (if `discount_code_percent>0`), `"<ad_discount_percent>% first-order discount"`, `"<cart_offer_percent>% limited-time offer"`.
- `orderDate = invoice.paid_at || ledger.paid_at || invoice.created_at`; `paymentStatus = 'Paid'`; `currency` = invoice/ledger currency upper-case, default `'CAD'`.
- `shipTo` from `ledger.shipping_address` (country `CA` → `Canada`, `US` → `United States`).
- `accountOrderId = invoice.id`.

Sender: `sendOrderConfirmation` (lib/email.ts) → `sendMail({ from: defaultFrom(), to, subject, html, text })` via nodemailer SMTP (lib/smtp.ts). `defaultFrom() = SMTP_FROM || SMTP_USER || EMAIL_FROM || 'VYTA <noreply@aminocan.com>'`.

Template (lib/order-confirmation-email.ts), verbatim strings:
- Subject: `` `Order Confirmed - ${orderNumber}` ``
- `<title>` = subject; preheader: `` `Your payment has been received — order ${orderNumber}.` ``
- Eyebrow: `Order confirmed`; H1: `Thank you<br>for <span style="color: #0E68AE;">your order.</span>`
- Intro: `` `Hi ${customerName}, your payment has been received and your order is being processed. We’ll send you another email with tracking information once your order ships.` ``
- Header strip cells: `Order Number`, `Order Date` (formatted `en-US` long date in `America/New_York`, e.g. "October 4, 2026"), `Payment Status` (`paymentStatus || 'Paid'`).
- Items section heading `Your Order`; columns `Product`, `Qty`, `Unit price`, `Total`; sub-line `Pack of N` (default 10 if unknown) / `Single vial` · strength.
- `Order Summary`: `Subtotal`, `Discount (<label>)` as `-$x` in green `#047857`, `Shipping` (`Free` when 0), `Tax`, `Total` `$x.xx CUR`. Right column `Shipping Address` with name/lines/phone.
- `What Happens Next?`: `1. Order Processing` / `We’re preparing your order.`; `2. Order Ships` / `You’ll receive a tracking email once it ships.`; `3. Delivery` / `Your order will be on its way to you soon.`
- `Need Help?`: `If you have any questions about your order, reply to this email or contact us at support@vytabio.com. We’re happy to help.` + button `View Order Details` → `viewOrderUrl`, under it `Sign in or create an account to view it.`
- Footer badges `Third-party<br>lab tested`, `High purity<br>&amp; quality`, `Canadian<br>owned &amp; operated`; footer line `For research purposes only. Not for human or veterinary use.`
- Assets: `${SITE_URL}/images/email/order-hero.jpg`, `/images/vyta-mark.png`, `/images/vyta-wordmark.png`, icons `/images/email/<icon>.png` (file-text-blue, calendar-blue, check-teal, map-pin-blue, package-blue, truck-blue, package-open-blue, mail-blue, flask-conical-blue/white, shield-check-white, canadian-maple-leaf-white, arrow-right-white, arrow-right-muted).
- Plain text: first line `ORDER CONFIRMED — Thank you for your order.`, then `Hi <name>, your payment has been received and your order is being processed.`, `We’ll email you tracking information once it ships.`, `Order number: …`, `Order date: …`, `Payment status: …`, `Your order:` lines `  <name> (<pack>) × <qty> — $x`, totals, `Shipping address:` block, `View your order (sign in or create an account first): <url>`, `Questions? Reply to this email or write to support@vytabio.com.`, `For research purposes only. Not for human or veterinary use.`

"View Order Details" link (lib/customer/order-link.ts): `buildViewOrderUrl(db, SITE_URL, invoiceId, email)` →
`${SITE_URL}/${hasAccount ? 'login' : 'signup'}?redirect=<encoded /account/orders/<invoiceId>?claim=<token>>&email=<email>`, where `hasAccount` = a `customers` row `ilike email`. Token `signOrderClaim(orderId, email) = base64url(HMAC_SHA256(ORDER_LINK_SECRET || SUPABASE_SERVICE_ROLE_KEY, "order-claim:v1:<orderId>:<lowercased email>"))`. The order page POSTs it to `/api/customer/orders/[id]/claim` (see Routes).

Admin manual send: `sendConfirmationManually` (POST `/api/admin/confirmation-email`) — not once-only; for Stealth Health requires paid + invoice (else 422 `This order isn’t paid yet — the confirmation goes out once it’s paid.`); logs with `sent_by`/`sent_by_email`; stamps `confirmation_email_sent_at` afterwards.
Storefront `orders` auto-send (`sendStorefrontOrderConfirmationOnce`) only for `source` starting with `e-transfer` — none on this site.

Migration `order-confirmation-email-migration.sql` back-stamps `confirmation_email_sent_at = now()` on existing paid rows (so the deploy doesn't mass-mail history) and drops any CHECK on `fulfillment_email_log.kind`.

#### 3. Admin "new order paid" email

`sendStealthHealthPaidAlertOnce(db, puramassOrderId, { transition, paidVia })` (lib/admin/stealth-health-paid-alert.ts). Outcome reasons: `not_found|not_paid|already_sent|no_recipients|not_migrated|send_failed|error`.
- Requires ledger with `invoice_id`, invoice exists, and (`invoice.status==='paid' || ledger.status==='paid'`).
- If column `admin_paid_alert_sent_at` absent: send only when `transition` is true, unclaimed. Else skip if set; claim `NULL → now()` like the customer email; release on failure.
- Recipients `getAdminAlertEmails(db)`: `site_settings.admin_emails` (array) → env `ADMIN_ALERT_EMAILS` (comma-separated) → `site_settings.invoice_cc_emails`. Empty → `no_recipients`.
- Send `sendAdminOrderPaidAlert(to[], data)`: one email to all recipients; subject
  `` `${source==='manual' ? 'Invoice paid' : 'New order'}: ${orderNumber || 'Stealth Health order'} · ${customer.name || customer.email || 'Guest'} · ${money(total)} ${currency}` `` (money = `$x.xx`, sign-aware).
  Body = **identical to the customer confirmation HTML/text** (`renderAdminOrderPaidHtml` returns `renderOrderConfirmationHtml(data.order)`).
- Log `fulfillment_email_log { invoice_id, to_email: to.join(', '), subject, success, error, order_id:null, message_id:null, kind:'admin_paid_alert', sent_by, sent_by_email }`.
- Manual: `POST /api/admin/paid-alert-email { invoiceId }` (Routes).

#### 4. Klaviyo events

- At hand-off (checkout route, `after()`): `trackStartedCheckout` metric `Started Checkout`, `unique_id = partner_reference`, `CheckoutURL = payment_link`.
- On first paid (only `firstPaid` passes): `trackPlacedOrder(db, { orderId: invoiceId, orderNumber: invoice_number, email: invoice.customer_email ?? ledger.customer_email, firstName/lastName: splitName(customer_name), customerId, items: lines→{productId, name: description, quantity: qty, price: unit_price, variant: price_type==='vial' ? 'Single vial' : 'Box'}, subtotal, shipping: shipping_cost, discountCode: stored.discount_code, total, currency (default 'CAD'), source: 'stealth_health' })`.
  Sends metric `Placed Order` (`value = total`, `unique_id = invoiceId`, properties `OrderId, OrderNumber, Source, Categories, ItemNames, ItemCount, Items[], Subtotal, Shipping, DiscountCode, DiscountValue, Currency, ShippingAddress, OrderURL: SITE_URL + '/account'`) and one `Ordered Product` per line (`unique_id = "<invoiceId>:<idx>"`).
- Gate: `site_settings.klaviyo_enabled === true && klaviyo_server_events_enabled !== false && privateKey` where privateKey = `site_settings.klaviyo_private_api_key || env KLAVIYO_PRIVATE_API_KEY`. All Klaviyo calls are best-effort and never throw.
- No Klaviyo event is sent by the manual invoice-paid path. `trackOrderStatus` (Confirmed/Fulfilled/Delivered/Cancelled/Refunded Order) is only wired for `orders`, not for hosted orders.

#### 5. Attribution (analytics)

`attributeHostedPurchase(db, { id, customer_email, attribution_channel? })` (lib/analytics/attribution-server.ts), called by webhook and poll (not refresh) just before materialize:
`attributeEmailPurchase` → `SELECT anonymous_id, first_channel, first_campaign, purchased_at, first_seen_at FROM visitor_attribution WHERE customer_email = lower(trim(email)) ORDER BY first_seen_at ASC LIMIT 20`; sets `purchased_at = updated_at = now` on rows where null; returns earliest row's channel/campaign. Then, if a channel was found and the order has none, `UPDATE puramass_orders SET attribution_channel, attribution_campaign WHERE id AND attribution_channel IS NULL`. Best-effort.
Client side: GA4 `begin_checkout` fires before redirect; no client `purchase` event is possible.

#### 6. Affiliate commission

`creditAffiliate` → `recordAffiliateCommission(db, { invoiceId, subtotalCents: ledger.subtotal_cents, customerId: ledger.customer_id, referralCode: ledger.referral_code, discountCodeId: stored.discount_code_id })` (lib/affiliate/commission.ts). Returns `{recorded:true, commissionId, amount, affiliateId, orderTotal, code}` or `{recorded:false, reason:'no-attribution'|'no-base'|'already-recorded'|'error'}`.
1. Pre-check `commissions WHERE invoice_id` → `already-recorded`.
2. Attribution priority: (a) `discount_codes` row `discountCodeId` with `affiliate_id` ≠ customerId (code's `commission_rate` is a percentage override); (b) bound customer `customers.affiliate_id` (≠ customer id) + its active `referral_codes` row; (c) `resolveReferralCodeOwner(referralCode)`: exact upper-cased match on active `referral_codes.code`, else affiliate-assigned active `discount_codes.code`; owner `affiliates.active !== false`; self-referral rejected.
3. `base = subtotal_cents/100` (goods only, no shipping/tax); `base <= 0` → `no-base`.
4. `rate` = code rate/100 clamped [0,1] if present, else `normalizeCommissionRate(affiliates.commission_rate)` (≤1 = fraction, >1 = percent, invalid/≤0 → 0.10; >100% → 0.10). `amount = round2(base × rate)`.
5. INSERT `commissions { affiliate_id, invoice_id, order_id:null, referral_code_id, amount, order_total: base, commission_rate: round2(rate*100), status:'pending', discount_code_id? }`. `23505` → `already-recorded`.
6. If `recorded`: `notifyAffiliateOfCommission` (lib/affiliate/commission-email.ts) → `affiliates.email/first_name/last_name`, deliverable check, `sendAffiliateCommissionEmail` subject `` `You earned a ${money(commission)} commission on order ${orderNumber}` `` (orderNumber = invoice_number ?? invoiceId), intro `A customer just placed an order using your affiliate link or code.`, dashboard `${SITE_URL}/affiliate/dashboard`; text body ends `Your commission has been recorded and will be included in your next payout.`; logged to `fulfillment_email_log` kind `affiliate_commission`. Failed send is logged, not retried.

DB (affiliate-commission-hosted-checkout-migration.sql): `commissions.invoice_id uuid REFERENCES invoices ON DELETE CASCADE`; `order_id` made nullable; CHECK `commissions_one_source: num_nonnulls(order_id, invoice_id) = 1`; partial unique indexes `idx_commissions_order_unique (order_id) WHERE order_id IS NOT NULL`, `idx_commissions_invoice_unique (invoice_id) WHERE invoice_id IS NOT NULL`.
Backfill for missed commissions: lib/affiliate/commission-backfill.ts via `app/api/admin/commissions/backfill/route.ts` and `app/api/admin/invoices/[id]/commission/route.ts` (no affiliate email).

#### 7. Fulfillment hand-off (warehouse + Easyship)

- Warehouse queue `app/api/warehouse/queue/route.ts` excludes `invoices.status IN (pending_payment, expired)` and `is_backorder = true`; so the invoice appears in the pick/pack queue the moment it flips to `paid`. Ship-to is attached from `puramass_orders.shipping_address` (`attachPuramassShipTo`).
- Customer account pages exclude `(draft, pending_payment, expired)` (lib/customer/api.ts).
- `bookShipment(db, invoiceId, courierId)` → `autoCreateShipmentForInvoice(db, invoiceId, force=true, courierId ? { courierIdOverride: courierId } : { courierPreference: 'best_value' })` (lib/shipping/auto-shipment.ts). Creates an Easyship **draft** shipment (label purchase governed by `easyship_auto_buy_label` setting). Skips (recorded as attempt) when: invoice already has `easyship_shipment_id`, pickup, Easyship disabled, or no destination/postal code (`destinationReason`). Destination resolved from the ledger's `shipping_address`.
- No `backorders` rows are created by the payment path (`is_backorder:false`, `qty_backordered:0` on every line).

#### 8. Settlement (partner money)

Not triggered by payment; admin-driven reconciliation.
- Live partner ledger: `fetchPartnerSettlement({ start?, end?, year?, limit? })` (lib/payments/puramass-settlement.ts) → `GET /partner/settlement?start=YYYY-MM-DD&end=YYYY-MM-DD&limit=N[&cursor=…]`, following `pagination.next_cursor ?? next_cursor` until null; stops on a repeated cursor or after 200 pages (`truncated:true`). Window: `year` → `YYYY-01-01..YYYY-12-31` (2000–2999); else valid start/end, end ≥ start, ≤ 400 days inclusive; violations throw `PuramassApiError(400, …)` with messages `year must be a four-digit calendar year`, `start and end must be YYYY-MM-DD dates`, `end must be on or after start`, `` `window is ${days} days; the settlement endpoint accepts at most 400` ``. Page size default 100, clamp 1–500. Rows from first of `json`, `appointments`, `rows`, `data`, `results`, `settlements`; deduped by `appointment_id`; money → integer cents once (`Math.round(n*100)`); `shipping` null stays null; `totals`/`caveats` taken from first page; `split_model_unconfigured` = caveat code `split_model_unconfigured` or any row with null `split_model`.
- Admin route `GET|POST /api/admin/stealth-health/partner-settlement` (GET reads stored pulls only; POST admin-only live pull + reconcile + snapshot into `stealth_health_settlement_pulls` / `stealth_health_settlement_rows`, audit `action:'read'`, entity `stealth_health_settlement_pull`). Partner 401/403/404 → **409** with hint `The settlement endpoint is not enabled for this account. It is off by default and switched on per partner account, requires clinical tier, and is not available in sandbox. Ask Stealth Health to enable it.`; not configured → 409 `No Stealth Health partner API key is configured in this environment.`
- Internal receivable (stealth-health-settlement-migration.sql): `stealth_health_settings` (terms singleton: `commission_pct`, `flat_fee_cents`, `shipping_fee_cents` DEFAULT 3500, `shipping_remitted`, `payment_terms_days` 14, `currency` 'USD'), `stealth_health_invoices` (`invoice_number` DEFAULT `'SH-' || nextval(stealth_health_invoice_seq START 1000)`, status `draft|sent|partial|paid|void`, frozen cent totals), `stealth_health_payouts`; `puramass_orders.settlement_invoice_id` (prevents double billing) and `settlement_excluded` (`PATCH /api/admin/stealth-health/orders/[id] { settlement_excluded }`, admin only; 400 `This order is already on a settlement invoice — void that invoice first.` when excluding a billed order).

#### 9. Legacy crypto side-effects (orders table only)

On `confirmed`: `adjustStockForConfirmedOrder`, `attributeEmailPurchase(email)`, (check-payment route only) `customers.has_completed_first_order = true WHERE id AND has_completed_first_order = false`, `sendPaymentConfirmed` (subject `` `Payment Confirmed - ${orderNumber}` ``), `sendAdminPaymentNotification` (to hard-coded `info@aminocan.com`, subject `` `Payment Received - ${orderNumber} - $${total.toFixed(2)} CAD` ``).

---

### Lifecycle — abandoned checkout recovery

There is **no automatic recovery email from this app**. Recovery is (a) Klaviyo's own flow triggered by the `Started Checkout` event at hand-off (resume URL = `payment_link`; Klaviyo stops the flow on `Placed Order`), and (b) admin-sent emails from `/admin/stealth-health` (Orders tab) and the customer desk.

#### Detection rules (lib/payments/puramass-abandoned.ts — client-safe, shared with the admin table)

- `RECOVERABLE_STATUSES = ['payment_pending', 'expired', 'cancelled']` — chaseable from the per-order dialog.
- `PAYMENT_LINK_STATUSES = ['payment_pending', 'expired']` — eligible for bulk outreach / "live link" (`hasReusablePaymentLink`).
- Abandoned = status ∈ RECOVERABLE and `created_at <= abandonedCutoff(hours)` where `abandonedCutoff(h) = new Date(now − max(0,h)×3600000).toISOString()`.
- `hours = loadAbandonedHours(db)` = `site_settings.abandoned_checkout_hours` (INTEGER NOT NULL DEFAULT 1); invalid/≤0/missing → `DEFAULT_ABANDONED_HOURS = 1`; capped at `24*30 = 720`.
- Priority for one cart per buyer (`byAbandonedPriority`): `payment_pending`(0) < `expired`(1) < other(2), then newest `created_at` first.
- `wasRecovered(row)` (derived, never stored) = `status==='paid' && recovery_email_sent_at && (!paid_at || paid_at >= recovery_email_sent_at)`.
- `recoveryOffer(row)` → `"<v>% off"` or `"$<v.toFixed(2)> off"` from `recovery_discount_type/value`, else null.
- Admin list `GET /api/admin/puramass/orders?abandoned=1` applies `.in('status', RECOVERABLE_STATUSES).lte('created_at', cutoff)`; response includes `abandonedHours` and `counts.abandoned`.
- Admin UI shows the recover (cart) button on every row with `status !== 'paid'`.

#### Per-order recovery `GET|POST /api/admin/puramass/orders/recover` (runtime nodejs)

Auth: Bearer JWT, `customers.role ∈ {admin, assistant}` else **403** `{ "error": "Unauthorized" }`.

GET `?id=<puramass_orders.id>` → 400 `{ "error": "id is required." }` / 404 `{ "error": "No matching order found." }` / 200:
```json
{ "order": { "id", "reference", "status", "payment_link", "customer_email", "customer_name", "created_at", "recoverable": bool },
  "firstName": "<first token of customer_name> | null",
  "cart": { "items":[{"name","quantity","lineTotal"}], "subtotal", "currency", "reference" },
  "checkoutNote": "<see below>", "senderName": "<admin first last> | null",
  "recovery": { "recovery_email_sent_at", "recovery_email_count", "recovery_promo_code", "recovery_discount_type", "recovery_discount_value" } }
```

POST body:
```ts
{ id: string; subject: string; body: string; templateKey?: string /* default 'custom' */;
  email?: string; cc?: string | string[]; promoCode?: string; discountType?: 'percentage'|'fixed';
  discountValue?: number|string; promoDetails?: string; promoExpires?: string; includeCart?: boolean /* default true */ }
```
Validation (in order; all 400 unless noted): `Invalid JSON`; `id is required.`; `A subject is required.`; `The message body is empty.`; `Unknown template` (key not in RECOVERY_TEMPLATE_MAP); 404 `No matching order found.`; **409** `This checkout was paid — there is nothing to recover.` (paid) or `` `A ${status.replace(/_/g,' ')} order cannot be recovered.` ``; `That email address is not valid.`; `This hand-off has no customer email — there is nobody to email.`; CC: `` `Not a valid email address: ${invalid.join(', ')}` `` (`field:'cc'`), `You can copy at most 5 people on one email.` (`field:'cc'`); discount: `The discount must be a positive amount, and a percentage cannot be more than 100.` (`field:'discount'`); `Add the promo code the discount belongs to, or describe the offer, so the customer knows how to claim it.` (`field:'promoCode'`).
`promoCode` is trimmed + upper-cased. `normalizeDiscount(type, value)`: type ∈ {percentage, fixed}, value finite > 0, percentage ≤ 100, rounded to 2 dp.

Processing: `buildOrderSummary` → `buildRecoveryEmailInput` → `sendRecoveryEmail({ to, cc, replyTo: admin email, input })` → `sendMail({ to, cc?, subject: renderSubject(input), html: renderPromoEmail(input), text: renderPromoEmailText(input), from: defaultFrom(), replyTo? })`.
Always logs INSERT `customer_emails { scope:'customer', customer_id, to_email, cc_emails, subject, body_html, template, promo_code, promo_details, promo_expires, sent_by_id, sent_by_email, sent_by_name, success, error, message_id }` (missing table tolerated).
Send failure → **502** `` `The recovery email could not be sent: ${error ?? 'the mail server rejected it.'}` ``.
Success → `stampRecoverySend`: `UPDATE puramass_orders SET recovery_email_sent_at=now, recovery_email_count=prev+1, recovery_promo_code, recovery_discount_type, recovery_discount_value WHERE id` (best-effort) → audit `puramass.recovery_email_sent` (entity `puramass_order`) → **200**
`{ ok:true, to, cc, subject, sent_at, attempt: prev+1, promo_code, discount, recorded: bool, logged: bool }`.

Codes are never issued here — they are generated on app.vytabio.com and pasted in; the discount only affects wording/"estimated" totals (`PROMO_SOURCE_NOTE`: `Promo codes are generated in app.vytabio.com (the Stealth Health platform). Create the code there first, then paste it below to include it in this email.`).

#### Recovery email content (lib/customer/promo-email.ts + lib/payments/puramass-recovery.ts)

Recovery link = the partner's hosted `payment_link` itself (no new link is minted). Button label `Complete your order`; rendered only if `safeHttpUrl` (http/https).
`checkoutNote(status)`:
- `expired` → `This checkout link has expired — open it anyway and we will send you a fresh one, or just reply to this email.`
- `cancelled` → `This order was cancelled. Reply to this email and we will set it up again for you.`
- otherwise → `Secure checkout — your cart is exactly as you left it.`

Templates (`RECOVERY_TEMPLATES`; merge fields `{{first_name}}` → first name or `there`, `{{discount}}` → `"15% off"`/`"$25.00 off"` or `a discount`):

| key | label | subject | body |
|---|---|---|---|
| `recovery_discount` | Discount nudge | `Here is {{discount}} to finish your order, {{first_name}}` | `Hi {{first_name}},` / blank / `You were part-way through an order with us and did not quite make it to the end — no problem at all, it happens to the best of us.` / blank / `To help you finish your checkout, here is {{discount}}. Your cart is saved exactly as you left it, so it is waiting whenever you are ready.` / blank / `If something went wrong at checkout, or you just want to ask us about anything first, hit reply — we are always happy to help.` |
| `recovery_reminder` | Plain reminder | `You left something in your cart` | `Hi {{first_name}},` / blank / `We noticed you did not finish checking out. Your cart is saved, so you can pick up exactly where you left off.` / blank / `If something went wrong at payment, just reply to this email and we will sort it out.` |
| `recovery_last_chance` | Last chance | `Last chance on your cart` | `Hi {{first_name}},` / blank / `This is the last reminder about the order you started — after this we will leave you alone.` / blank / `The link below still works, so if you want it, it is one click away.` |
| `custom` | Blank | `` | `` |

HTML structure: 600px table; dark hero (`#05182B`) with wordmark `VYTA` + `Canadian Peptides`; when a discount is set the hero shows eyebrow `Your discount`, large figure (`15%` + italic `off`) and subline (`promoDetails` or `` `That is $X CUR off this cart.` `` or `Applies to your whole order.`); white card with paragraphs (blank-line split), cart block (eyebrow `Your cart · <reference>`; lines; `Subtotal`; `Discount (15% off)` in green `#0F7A57`; `Estimated total`/`Total`; note `The discount is applied at checkout once you enter the code.`), promo code block (eyebrow `Your code`, monospace code, `Enter at checkout · Valid <expires>`), checkout button, signature `— <senderName>` + `VYTA Biosciences`; footer `VYTA · Canadian research peptides`. Zero/unknown amounts are never printed (`knownAmount` > 0). Currency label default `USD` when cart currency missing (the summary passes `order.currency.toUpperCase()`, default `'USD'` in `buildOrderSummary`).

#### Bulk recovery from the customer desk

`/api/admin/customers/outreach` (lib/customer/outreach.ts): one cart per email among `PAYMENT_LINK_STATUSES` rows (`fetchAbandonedOrders` limit 5000), chosen by `byAbandonedPriority`; at send time `loadRecipientCheckout` re-reads the ledger and drops the cart/button if the status left `payment_pending|expired`; each recipient gets an individual email; `MAX_BULK_RECIPIENTS = 40`, `SEND_CONCURRENCY = 5`, `CANDIDATE_LIMIT = 50`; CC only on the first recipient's message; each successful send calls `stampRecoverySend` on that cart.

#### Missing-column tolerance
`loadRecoveryState`/`loadRecoveryStates` return "never chased" (`EMPTY_RECOVERY_STATE`) if the recovery columns are missing; admin list reports `recoveryAvailable:false`.

---

### Lifecycle — missing shipping address flow

#### Detection
- No automatic detection or email. An order lacks an address when `toShippingAddress(puramass_orders.shipping_address) === null` (accepts object or JSON string; a bare non-JSON string becomes `{address: <string>}`; all-blank → null).
- Admin Orders tab shows `No address yet` (tooltip: pending → `Stealth Health reports the address once the order is paid. Sync to re-check.`; else `Stealth Health has not returned a shipping address for this order. Sync to re-check, or ask the customer directly.`) and `Asked <timeAgo>` when `address_requested_at` set. The request button is shown on every row (highlighted when no address and never asked).
- Addresses normally arrive via webhook/poll contact patches, or are captured at our own checkout (`shipping_address_source:'customer'`).

#### Token generation / expiry (lib/payments/puramass-address-request.ts, server-only)
- `generateAddressToken()` = `randomBytes(32).toString('base64url')`; only `hashAddressToken(token) = sha256(token).hex` is stored.
- `looksLikeAddressToken(t)` = `/^[A-Za-z0-9_-]{20,120}$/`.
- `ADDRESS_REQUEST_TTL_DAYS = 30` (`expires_at = now + 30d`; table default identical).
- Link: `` `${SITE_URL.replace(/\/+$/,'')}/shipping-address/${token}` `` (SITE_URL = `"https://www.vytabio.com"` constant in lib/config.ts).
- `createAddressRequest(db, order, email)`: if an open request (`submitted_at IS NULL`, newest) exists → rewrite `token_hash, email, expires_at` in place (`reused:true`; old link dies); else INSERT. Returns `{ request, token, link, reused }` or `{ error }`.
- Table `puramass_address_requests` (puramass-missing-address-migration.sql): `id uuid PK, puramass_order_id uuid NOT NULL → puramass_orders ON DELETE CASCADE, token_hash text NOT NULL UNIQUE, email text NOT NULL, expires_at timestamptz NOT NULL DEFAULT now()+30 days, sent_at, sent_count int NOT NULL DEFAULT 0, sent_by uuid, sent_by_email, submitted_at, submitted_ip, submitted_address jsonb, created_at, updated_at (trigger)`; RLS "Service role full access".

#### Admin send `POST /api/admin/puramass/orders/request-address`
Auth admin/assistant (403 `{ "error": "Unauthorized" }`). Body `{ id: string, email?: string, cc?: string|string[], note?: string }` (note trimmed, ≤500 chars).
Errors: 400 `Invalid JSON`; 400 `id is required.`; 404 `No matching order found.`; 400 `That email address is not valid.`; 400 `This order has no customer email — there is nobody to ask.`; 400 `` `Not a valid email address: …` `` (`field:'cc'`); 400 `You can copy at most 5 people on one request.` (`field:'cc'`); 500 `` `Could not create the address request: ${error}. If this mentions a missing table, run puramass-missing-address-migration.sql.` ``; 502 `` { error: `The address request could not be emailed: ${error}`, link } `` (link returned so it can be sent another way).
CC parsing `parseCcList(raw, primary)`: array or string split on `[,;\n]`, regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, case-insensitive dedupe excluding primary, max `MAX_CC_RECIPIENTS = 5` (excess → `truncated`), invalid entries (≤80 chars) reported.
Success: `markAddressRequestSent` → `UPDATE puramass_address_requests SET sent_at=now, sent_count=+1, sent_by, sent_by_email`; `UPDATE puramass_orders SET address_requested_at = sent_at` (missing column ignored); audit `puramass.address_request_sent`. Response **200**
`{ success:true, email, cc, link, reused, sent_at, expires_at, had_address: bool }`.

#### The email (lib/payments/puramass-address-email.ts)
`sendMissingAddressEmail({ to, summary, link, note?, replyTo?: adminEmail, cc? })` → `sendMail({ from: defaultFrom(), to, cc?, subject, html, text, replyTo? })`. CC is visible (not BCC) by design.
- Subject: `` `Quick one about your order ${id} — we need your shipping address` `` with `id = invoice_number || transaction_id?.slice(0,10) || reference`.
- HTML wrapped in `vytaShell(...)` (lib/email.ts). Heading `` `Hey ${firstName || 'there'} — where should we send this?` ``;
  `Thanks for ordering with us! Everything went through on our side — we just didn't catch a shipping address with your order, so we can't get it moving yet.`;
  `Tap the button below, fill in where you'd like it delivered, and we'll have your order processed and on its way <strong>within the next business day</strong>.`;
  optional note box (`#F1F8F9`, left border `#438B9E`); button `Add my shipping address` (bg `#07203A`); `Takes about a minute. The link is private to your order.`;
  `Your order` table (Item / Qty / Amount; empty → `Your order items`), totals `Subtotal`, `Shipping`, `Total paid` (`$x.xx CUR`, unknown → `—`);
  reference rows `Invoice`, `Transaction` (linked to `payment_link`), `Order reference`, `Placed` (`en-CA` long date);
  if an address is on file: `We have this on file — is it still right?` + lines;
  `Something look off, or would you rather just reply with the address? Hit reply to this email and a real person will sort it out with you.`
- Text: `Hey <first>,` … `Add your address here and we'll have the order processed and on its way within the next business day:` + link … `YOUR ORDER` … `Prefer to just reply with the address? Reply to this email and we will sort it out.`
- Summary source `buildOrderSummary(db, order)` (lib/payments/puramass-order-summary.ts): invoice header + `invoice_line_items(description, qty, unit_price, line_total)` when invoiced; else ledger SKUs named via `products.puramass_sku` (`name`) / `puramass_sku_vial` (`"<name> (single vial)"`); `currency = (order.currency || 'USD').toUpperCase()`; `total` falls back to subtotal(+shipping).

#### Public API `GET|POST /api/shipping-address/[token]`
File app/api/shipping-address/[token]/route.ts; module-scope service-role client; no login (token is the credential). In-memory rate limiter (lib/rate-limit.ts, per process) keyed by `x-forwarded-for` first IP → `x-real-ip` → `127.0.0.1`:
GET `shipping-address:get:<ip>` 30/60 s; POST `shipping-address:post:<ip>` 10/60 s. Exceeded → **429** `{ error:'rate_limited', message:'Too many requests. Please wait a moment.' }` (POST: `Too many submissions. Please wait a moment.`) + `Retry-After` seconds.

Lookup `loadAddressRequestByToken`: bad shape / unknown hash / DB error → `not_found` → **404** `{ error:'not_found', message:"We couldn't find an order for this link. Double-check you copied the whole link, or just reply to our email and we'll sort it out." }`; `expires_at < now` → **410** `{ error:'expired', message:'This link has expired. Reply to the email we sent you and we will send a fresh one right away.' }`; ledger missing → `order_missing` (also 404 not_found). A request already submitted is still readable/resubmittable until expiry.

GET 200 (header `Cache-Control: no-store`):
```json
{ "order": { "reference","transaction_id","transaction_link","invoice_number","status","placed_at","paid_at","currency",
             "customer_name","customer_phone","customer_email_masked","items":[{"name","sku","quantity","unit_price","line_total"}],
             "subtotal","shipping","total","shipping_address": {address,address2,city,state,zip,country}|null },
  "request": { "submitted_at", "expires_at" } }
```
`customer_email_masked`: first ≤2 chars of local part + `•` × max(2, rest) + `@domain`.

POST body `{ full_name, phone?, address, address2?, city, state, zip, country }`:
- Invalid JSON → 400 `{ error:'invalid', message:'Invalid request.' }`.
- `validateShippingAddress` (lib/payments/puramass-address.ts): trims and caps (`full_name` 120, `phone` 40, `address` 200, `address2` 200, `city` 100, `state` 80, `zip` 20, `country` 40, upper-cased). Errors: `full_name` `Please tell us who the parcel is addressed to.`; `address` `Please enter a street address.`; `city` `Please enter a city.`; `zip` `Please enter a postal or ZIP code.`; `country` `Please choose a country.`; `state` required for US/CA: `Please choose a state.` / `Please choose a province.`. Empty `address2`/`phone` → null.
- Valid but `!isShippableCountry(country)` (only `CA`) → 400 `{ error:'invalid', message:'We only ship within Canada.', errors:{ country:'We only ship within Canada.' } }`.
- Invalid → 400 `{ error:'invalid', message:'Please check the highlighted fields.', errors }`.
- `applySubmittedAddress` failure → **500** `{ error:'save_failed', message }` where message is `We could not save the address right now. Please contact us and we will take it down manually.` (columns missing) or `We could not save the address right now. Please try again.`
- 200 `{ success:true, address, full_name, phone, submitted_at }`.

#### How the address is written back (`applySubmittedAddress`)
1. `UPDATE puramass_orders SET shipping_address = {address,address2,city,state,zip,country}, shipping_address_source='customer', shipping_address_updated_at=now, customer_name=full_name[, customer_phone=phone] WHERE id` — must succeed.
2. `UPDATE puramass_address_requests SET submitted_at=now, submitted_ip, submitted_address = {...address, full_name, phone} WHERE id` (best-effort).
3. If `order.invoice_id`: `UPDATE invoices SET customer_name[, customer_phone] WHERE id` (best-effort). The invoice has no address column for hosted orders — warehouse and Easyship read the ledger's `shipping_address`.
4. A later partner payload can never overwrite it (provenance guard in `buildPuramassContactPatch`).
The submission does **not** trigger shipment booking (see notes).

---

### Lifecycle — routes & crons

#### GET /api/cron/puramass-poll
- Schedule: Supabase **pg_cron** job `puramass-poll`, `*/2 * * * *` (every 2 minutes), via `supabase-cron-puramass-poll.sql`: `net.http_get(url := vault 'app_base_url' || '/api/cron/puramass-poll', headers := {'Authorization': 'Bearer ' || vault 'cron_secret'})`. Requires extensions `pg_cron`, `pg_net`; Vault secrets `app_base_url` (no trailing slash) and `cron_secret`. **Not** in vercel.json.
- Auth: `PURAMASS_CRON_SECRET || CRON_SECRET` via `x-cron-key` / `?key=` / `Authorization: Bearer`.
- Request: none. Response: see Path B. Status codes 200/401/500.

#### GET /api/cron/check-payments (legacy crypto `orders`)
- Schedule: **none found in repo** (not in vercel.json, no SQL). Auth: `Authorization === 'Bearer ' + CRON_SECRET` exactly, else 401 `{ "error": "Unauthorized" }`.
- Reads `orders` (`id, order_number, email, crypto, payment_address, payment_amount_expected, payment_expires_at, total, items, status`) where `status IN ('pending','received') AND payment_address IS NOT NULL`. Fetch error → 500 `{ "error": "Failed to fetch orders" }`.
- Per order (sequential, 250 ms sleep): expire pending past `payment_expires_at`; `checkPayment(crypto, address, expected)` (lib/payment-monitor.ts; `REQUIRED_CONFIRMATIONS = { btc:1, eth:12, sol:1 }`); confirmed → `status:'confirmed', payment_amount_received, payment_tx_hash, payment_confirmations, payment_confirmed_at` + side-effects (§9); seen but unconfirmed → `received` (or update `payment_confirmations`).
- 200 `{ checked, received, confirmed, expired, total }`.

#### GET /api/orders/check-payment?orderNumber= (legacy crypto, public client poller)
- No auth. 400 `{ "error": "Order number required" }`; 404 `{ "error": "Order not found" }`.
- Same logic as the cron for one order; also sets `customers.has_completed_first_order`. Responses `{ status, confirmations, requiredConfirmations }` (expired → `{status:'expired', confirmations:0, requiredConfirmations:1}`).
- Not used by the Puramass flow.

#### POST /api/webhooks/stealth-health
See Path A. Runtime nodejs; public; HMAC header `x-stealth-signature`. Every delivery logged to `puramass_webhook_events`.

#### POST /api/webhooks/easyship
Shipping/tracking webhook (Easyship HMAC/JWT `X-EASYSHIP-SIGNATURE`); **not a payment webhook** — it updates shipment/tracking state on orders/invoices after fulfillment. Out of scope for this section.

#### POST /api/admin/puramass/orders/refresh
See Path D. Admin/assistant.

#### POST /api/admin/puramass/orders/sync
See Path C. Admin/assistant.

#### GET /api/admin/puramass/orders
Admin/assistant. Query: `page` (0-based), `pageSize` (1–100, default 25), `status` (comma list), `abandoned=1`, `q` (≤120 chars; `,()*` stripped; ilike over `customer_email, partner_reference, transaction_id, referral_code[, customer_name]`). Column ladder (core + address + recovery → … → core). Attaches `invoice` (`id, invoice_number, customer_id, customer_email, status, fulfillment_status, fulfillment_type, due_date, packed_at, fulfilled_at, currency, subtotal, shipping_cost, total, created_at`), `confirmation` (summary from `fulfillment_email_log` kind `order_confirmation` by invoice), `affiliate` (`{id, name, active}` from referral code). Response `{ orders, total, page, pageSize, addressesAvailable, recoveryAvailable, abandonedHours, counts:{ all, payment_pending, paid, expired, cancelled, abandoned } }`; 500 `{ "error": "Could not load orders: <msg>" }`.

#### DELETE /api/admin/puramass/orders
Admin only. Body `{ ids: string[], cascadeInvoice?: boolean }`. 400 `Invalid JSON body` / `ids[] is required.`; 404 `No matching orders found.`; 500 `Could not load the orders to delete.` / `Could not delete the orders.`. Deletes ledger rows; with `cascadeInvoice` also deletes linked invoices (lines cascade). Audit `puramass.order_delete` / `puramass.order_delete_cascade`. 200 `{ ok, deleted, linkedInvoices, invoicesDeleted, warning? }`. Note: deleting the invoice of a paid order makes heal skip it (no recreation).

#### GET|POST /api/admin/puramass/orders/recover
See Abandoned checkout recovery.

#### POST /api/admin/puramass/orders/request-address
See Missing shipping address flow.

#### GET|POST /api/shipping-address/[token]
See Missing shipping address flow. Page `app/shipping-address/[token]/page.tsx` calls only these two endpoints.

#### GET|POST /api/admin/confirmation-email
Staff check: Bearer JWT → `customers.role`. GET (admin or assistant) `?orderId=|invoiceId=|puramassOrderId=` (first valid UUID wins) → 400 `{ "error": "Pass orderId, invoiceId or puramassOrderId." }`; `{ applicable:false }` when target not found; else `{ applicable:true, kind, summary:{sendCount,lastSentAt,lastSentTo,lastSentBy,lastAttemptFailed,lastError}, history:[{created_at,to_email,success,error,sent_by_email}] (≤50), recipient, orderNumber, blockedReason }`. blockedReason strings: `Not paid yet — the confirmation goes out once the order is paid.`, `Mark the invoice paid first — this email tells the customer their payment was received.`, `No email address on this order or its customer account — add one to send the confirmation.`, `` `“${email}” can’t receive email — update the customer’s email address to send the confirmation.` ``.
POST (admin only, 403 otherwise) body `{ orderId | invoiceId | puramassOrderId }` → `sendConfirmationManually`; errors with status from the lib (404/422/502) or 500; success audit `order.confirmation_email_sent` → `{ success:true, to, sent_at }`.

#### GET|POST /api/admin/paid-alert-email
GET staff `?invoiceId=` (400 `{ "error": "Pass invoiceId." }`) → `{ applicable:false }` for storefront-order invoices, else `{ applicable:true, kind, summary, history, recipients, blockedReason }` (`Mark the invoice paid first — this email tells the team an order was paid.` / `No admin recipients — add them under Settings → Admin Email Notifications.`).
POST admin only `{ invoiceId }` → `sendAdminPaidAlertManually` (404 `Invoice not found, or it belongs to a storefront order.`, 422 not paid / no recipients, 502 send failure); stamps `admin_paid_alert_sent_at` if null; audit `invoice.admin_paid_alert_sent`; `{ success:true, to, sent_at }`.

#### POST /api/customer/orders/[id]/claim
Service-role client. Bearer Supabase session required (401 `{ "error": "Unauthorized" }`). Body `{ token }`. `id` must be a UUID and `verifyOrderClaim(id, user.email, token)` true, else **403** `{ "error": "This order link was sent to a different email address than the one you are signed in with." }`. No `customers` row for `user.id` → **409** `Finish setting up your account, then try again.`
Stealth Health: `invoices WHERE id AND source='stealth_health'` — owned by someone else → 409 `This order belongs to another account.`; else `UPDATE invoices SET customer_id = user.id WHERE id AND customer_id IS NULL` and `UPDATE puramass_orders SET customer_id = user.id WHERE invoice_id = id AND customer_id IS NULL`. Fallback to `orders`. 404 `Order not found`; 500 `Could not link this order. Please try again.`; success `{ linked: true }`.

#### GET /api/admin/invoices/[id]/puramass
Invoice caller check (`getInvoiceCaller`) → 403; 404 `Invoice not found`; `{ puramass: null }` if not a Stealth Health invoice; else `{ puramass: fetchPuramassContext(db, id) }` (ledger context incl. address/phone; internals not read for this section).

#### GET|POST /api/admin/stealth-health/partner-settlement, PATCH /api/admin/stealth-health/orders/[id]
See Settlement.

#### Customer-facing order pages
- `app/order/success/page.tsx`: makes **no server call**; client-redirects to `/order/track?order=&email=`.
- `app/order/track/page.tsx`: calls `GET /api/orders?orderNumber=<n>&email=<e>` which reads **only the `orders` table** (`order_number, status, items, totals, shipping_*, tracking_*, created_at, shipped_at, delivered_at`; email must match, uniform 404 `No order found matching that order number and email.`). Hosted (Stealth Health) orders are **not trackable here**; they appear in `/account/orders` (invoices with `source='stealth_health'`, excluding `draft/pending_payment/expired`) after the claim flow.

#### vercel.json crons
Only `{ "path": "/api/cron/stock-report", "schedule": "0 13 * * *" }` (daily stock report email; unrelated to payment). `/api/cron/abandoned-registrations` (hourly via `supabase-cron-abandoned-registrations.sql`, Bearer `CRON_SECRET`) is an admin alert for registered customers who never ordered — **not** abandoned checkout.

---

### Lifecycle — env vars

| Var | Used by | Notes |
|---|---|---|
| `PURAMASS_API_KEY` | lib/payments/puramass.ts (`X-Api-Key`) | required for poll/refresh/sync/settlement; missing → `isPuramassConfigured()` false |
| `PURAMASS_PARTNER_ID` | `X-Partner-ID` | default `ptr_puramass` |
| `PURAMASS_API_BASE_URL` | base URL | default `https://api.stealth.health`; trailing slashes stripped |
| `PURAMASS_WEBHOOK_SECRET` | webhook HMAC | missing → webhook 500 `not_configured` |
| `PURAMASS_CRON_SECRET` | /api/cron/puramass-poll | falls back to `CRON_SECRET`; must equal Vault `cron_secret` |
| `CRON_SECRET` | puramass-poll fallback, check-payments, abandoned-registrations, stock-report | |
| `NEXT_PUBLIC_SUPABASE_URL` | all clients | lib/supabase.ts has a hard-coded fallback project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | all post-payment DB access; also order-claim HMAC fallback | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `getSupabase()` falls back to it if service key missing | |
| `SMTP_HOST`, `SMTP_PORT` (default 587; 465 = implicit TLS, else STARTTLS required), `SMTP_USER`, `SMTP_PASSWORD` | lib/smtp.ts | all emails |
| `SMTP_FROM` → `SMTP_USER` → `EMAIL_FROM` | `defaultFrom()` | final fallback `VYTA <noreply@aminocan.com>` |
| `ADMIN_ALERT_EMAILS` | admin paid alert / low-stock recipients | used only when `site_settings.admin_emails` empty |
| `ORDER_LINK_SECRET` | claim-token HMAC | falls back to `SUPABASE_SERVICE_ROLE_KEY` |
| `KLAVIYO_PRIVATE_API_KEY` | Klaviyo server events | used only when `site_settings.klaviyo_private_api_key` empty |

Non-env config: `SITE_URL = "https://www.vytabio.com"` (constant, lib/config.ts) — used for email links/images and the address link. `SUPPORT_EMAIL = 'support@vytabio.com'`. DB settings: `site_settings.abandoned_checkout_hours`, `admin_emails`, `invoice_cc_emails`, `klaviyo_*`, `easyship_auto_buy_label` (and other Easyship settings).

---

### Lifecycle — unverified / porting notes

#### Unverified
- **Where the buyer lands after paying.** `buildPuramassOrderBody` sends no return/success URL; the post-payment redirect (if any) is configured on the partner side. Not determinable from the repo.
- The full set of partner `status` values. Code only special-cases `paid`, `expired`, `cancelled`, `payment_pending`; any other string (e.g. a refund status) would be written verbatim. Whether the partner sends events other than `store_order.payment_complete` (e.g. expiry/cancel/refund events) is not documented in the repo.
- The signature header encoding beyond `sha256=<hex>` (code also accepts bare hex).
- Schedule for `/api/cron/check-payments` (legacy) — no scheduler config found.
- Internals of `lib/admin/stealth-health-reconcile.ts`, `lib/admin/partner-settlement-server.ts`, `lib/admin/stealth-health-server.ts`, `lib/admin/puramass-invoice.ts` (`fetchPuramassContext`), `lib/shipping/auto-shipment.ts` destination resolution and Easyship payloads — not read in full for this section.
- `invoice_line_items.vials_per_unit` and `invoices.stock_adjusted` existence is assumed migrated (stock-ledger-migration.sql); without `vials_per_unit` the insert fallback drops `product_id` from pack lines (they then take no stock).
- Whether Klaviyo's own abandoned-checkout flow is configured in the Klaviyo account (outside repo).

#### Porting notes / gotchas (as the code behaves today)
1. **Webhook has no terminal-status guard.** Dedupe is only `last_event_id === event_id`; a delayed or replayed event with a *different* `event_id` (e.g. an older `payment_pending`) can move a `paid` row backwards. The poll/sync path guards this; the webhook and admin refresh do not. A port may want `paid` to be sticky.
2. **Late payment after the 7d+6h sweep** is only confirmed by the webhook or the per-row admin refresh — `applyPuramassStatus` treats `expired` as terminal, and the poller only selects `payment_pending`. `markInvoicePaid` does accept `expired` invoices.
3. **Admin refresh skips** `attributeHostedPurchase` and invoice expiry on remote `expired`/`cancelled`; it also updates by `transaction_id` with `maybeSingle()` (duplicate transaction ids would error).
4. **Manual "mark invoice paid"** stocks + emails but does not set the ledger to `paid`, credit affiliates, send Klaviyo, or book shipment.
5. **Invoice creation race:** two concurrent first-paid passes on a hand-off with no invoice can both `createPaidInvoice`; only one wins the `invoice_id IS NULL` link, the other invoice is orphaned but already `paid` and will take stock when its own pass calls `takeStealthHealthStock`. Since invoices are created at hand-off now, this only affects legacy rows / failed hand-off invoice writes.
6. **Address submitted after payment does not book the shipment.** `bookShipment` only runs inside `materializeStealthHealthFulfillment`; the cron heal only re-materializes when the invoice is still unpaid. An order paid without an address will have its Easyship attempt recorded as skipped; after the customer submits, a shipment must be created from the admin (`/api/admin/invoices/[id]/create-shipment`) or by an admin refresh/webhook redelivery that re-runs materialize.
7. **Admin paid-alert body ignores** `courier`, `discountCode`, `stockWarnings`, `invoiceUrl`, `paidVia` fields of `AdminOrderPaidEmailData` — it renders the customer email verbatim; only the subject differs.
8. **Partner refunds/cancellations never restore stock**; only an admin cancelling the invoice calls `restore_stock_for_invoice`.
9. **`/order/track` cannot find hosted orders** (reads `orders` only). Hosted buyers get the account link in the confirmation email instead.
10. The shipping-address rate limiter is in-memory per server instance (not shared across serverless instances).
11. Every optional-column read/write has a "strip and retry" fallback — when porting to a fresh schema with all migrations applied, these ladders can be dropped, but keep the rule "payment status write must never fail because of an optional column".
12. Migrations that back-stamp `confirmation_email_sent_at` / `admin_paid_alert_sent_at` on existing paid rows must run before enabling the automatic sends, or historical orders will be emailed on the next poll/heal pass.
13. Currency: hand-offs are CAD (`PURAMASS_CURRENCY = 'cad'`, invoices `currency:'CAD'`), but `buildOrderSummary` (address email, recovery cart) defaults to `'USD'` when the ledger currency is null, and the Stealth Health settlement tables default to `'USD'`; `puramass-account-orders-migration.sql` stamped legacy invoices with `USD` and $35 shipping.
14. `getSupabase()` silently falls back to the anon key if `SUPABASE_SERVICE_ROLE_KEY` is unset. RLS as written: `puramass_orders` and `puramass_address_requests` have a policy named "Service role full access" that is `FOR ALL USING (true) WITH CHECK (true)` **with no `TO service_role` clause** — as written it does not restrict by role (it would also admit anon/authenticated if table grants allow). Only server code reads these tables, but a port should scope the policy `TO service_role` (or drop it; the service role bypasses RLS anyway). `puramass_webhook_events` and `product_history` have RLS enabled with no permissive policy (service role only).

---

## Part 5 — Admin controls

Source repo: `thepuragroup-droid/vyta-rtl-x` (Next.js 15 App Router + Supabase + Tailwind).

**Naming.** In code the hosted payment processor is "Puramass" (`puramass_*` columns, `/api/admin/puramass/*`, `lib/payments/puramass*.ts`). Every admin label calls it **"Stealth Health"**. A port should keep that split: internal identifiers use `puramass`, UI copy uses the partner's display name. Env vars: `PURAMASS_API_KEY`, `PURAMASS_PARTNER_ID`, `PURAMASS_API_BASE_URL`, `PURAMASS_WEBHOOK_SECRET`. `isPuramassConfigured()` returns true only when **both** `PURAMASS_API_KEY` and `PURAMASS_PARTNER_ID` are set.

All admin pages are client components (`'use client'`) under `app/(admin)/admin/…`. They read the effective role from `useUserRole()`, which the layout exports.

---

### Admin — navigation & permissions

#### Roles (`lib/permissions.ts`)

`UserRole = 'customer' | 'assistant' | 'admin' | 'affiliate' | 'warehouse' | 'analytics'`. The role is stored in `customers.role`.

| Function | Returns true for |
|---|---|
| `canAccessAdmin(role)` | `admin`, `assistant`, `analytics` |
| `canAccessAdminPage(role, href)` | `admin`/`assistant`: every page. `analytics`: only `ANALYTICS_PAGES` (exact match or sub-route). Everyone else: nothing |
| `ANALYTICS_PAGES` | `/admin/analytics`, `/admin/products`, `/admin/categories`, `/admin/marketing`, `/admin/announcements`, `/admin/testimonials`, `/admin/pages`, `/admin/articles` |
| `adminLandingPage(role)` | `analytics` → `/admin/analytics`, otherwise `/admin` |
| `canEdit` / `canCreate` / `canDelete` | `admin` only |
| `canManageMarketing(role)` | `admin`, `analytics` |
| `canViewAnalytics(role)` | `admin`, `assistant`, `analytics` |
| `canViewInvoices` | `admin`, `assistant`, `affiliate` |
| `canEditInvoice` | `admin`, `affiliate` |
| `getRoleName` | customer→"Customer", affiliate→"Affiliate", assistant→"Assistant", admin→"Administrator", warehouse→"Warehouse", analytics→"Analytics" |

**Consequence for this feature.** The analytics role can reach none of the cart, checkout or order screens; Branding & Tracking is its only overlap. The assistant role reaches every screen but is read-only: pages disable controls and the APIs refuse writes. Affiliates and warehouse staff never reach `/admin`.

#### Admin layout (`app/(admin)/admin/layout.tsx`)

- **Auth check on mount.** It calls `supabase.auth.getSession()`, then `POST /api/auth/customer` with `{ accessToken }` to get `customer.role`. If `canAccessAdmin(role)` passes, the panel renders. Otherwise:
  - **No session:** an inline login form appears (card titled "VYTA" / "Admin Panel"; Email and Password inputs; "Sign In" button; empty fields give the error "Enter your email and password"). It signs in with `supabase.auth.signInWithPassword`.
  - **Signed in but not staff:** "Access Denied", with the text "Your account does not have admin privileges." and a "Go Home" button.
  - **Error:** the text "Something went wrong. Try refreshing."
  - **While checking:** "Loading admin panel...".
- **Effective role and view switch.** Admin and assistant users can switch the panel to "Viewing as: Admin | Analytics" using `lib/admin/admin-view.ts`, which stores the choice in localStorage key `admin-view-mode`. While previewing, a violet banner reads "Viewing as Analytics staff. … Your own access has not changed." with a "Back to my view" button. Pages see the *effective* role. A route guard redirects to `adminLandingPage(effectiveRole)` when `!canAccessAdminPage(effectiveRole, pathname)`.
- **Assistant banner** (amber, on every page): "You have read-only access. Contact an administrator to make changes." The sidebar role label shows "· Read Only".
- **Sidebar.** Dark (`bg-ink text-white`), `w-64`, collapsing to `76px` on desktop (persisted in localStorage `admin-sidebar-collapsed`). On mobile it is an off-canvas drawer with a hamburger. Nav items the effective role cannot reach are filtered out.

#### Nav entries relevant to this feature

| Group | Label | href | Icon (lucide) | Reachable by |
|---|---|---|---|---|
| Overview | Dashboard | `/admin` | LayoutDashboard | admin, assistant |
| Sales | Invoices | `/admin/invoices` | FileText | admin, assistant |
| Sales | Stealth Health | `/admin/stealth-health` (Orders tab = `?tab=orders`) | Handshake | admin, assistant |
| Sales | Pricing | `/admin/pricing` | Tag | admin, assistant |
| Partners | Affiliates | `/admin/affiliates` | Users | admin, assistant |
| Partners | Discount Codes | `/admin/discount-codes` | Ticket | admin, assistant |
| Marketing | Branding & Tracking | `/admin/marketing` | Megaphone | admin, assistant (read-only), analytics |
| Marketing | Promotions | `/admin/promos` | Sparkles | admin, assistant |
| Marketing | Landing Pages | `/admin/landing-pages` | Globe | admin, assistant |
| Marketing | Cart Upsells | `/admin/cart-upsells` | Layers | admin, assistant |
| Administration | Settings | `/admin/settings` (+ `/admin/settings/email-templates`, `/admin/settings/error-log`) | Settings | admin, assistant |

**Not in the nav:** `/admin/orders`, `/admin/orders/[id]` and `/admin/orders/new` (legacy storefront orders). The layout comment says: "Orders were merged into Invoices … Orders is intentionally hidden from the nav (the /admin/orders routes still work by direct URL)." The Dashboard still links to them ("View All" → `/admin/orders`).

#### Auth mechanism for admin API routes

- **No middleware.** Every route authenticates on its own.
- **Token.** The client sends `Authorization: Bearer <supabase access_token>`, taken from `supabase.auth.getSession()`. Each page has a local `authHeaders()` helper, or uses `adminFetch` (`components/admin/affiliates/api.ts`) or `apiFetch` (`lib/api-fetch.ts`).
- **Server.** A service-role Supabase client (`createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`) runs `db.auth.getUser(token)`, then `customers.select('role').eq('id', user.id)`. The role is compared per route (details under each route below).
- **Shared helpers:**
  - `resolveStaffCaller(db, req, { allowAssistant })` in `lib/affiliate/route-auth.ts`: no or invalid token → 401 "Unauthorized"; wrong role → 403 "Unauthorized".
  - `requireReader` (admin/assistant) and `requireAdmin` (admin) in `lib/admin/stealth-health-server.ts`.
  - `isKlaviyoAdmin` in `lib/klaviyo/admin-auth.ts`: admin only.
- **Failure response.** Most routes return `403 { error: 'Unauthorized' }`.
- **Audit.** Writes call `logAuditServer(db, { actor_id, actor_email }, { action, entity_type, entity_id })`, which inserts into `audit_logs`.

---

### Admin — Settings controls

**Page:** `/admin/settings` (`app/(admin)/admin/settings/page.tsx`).

- **Header:** H1 "Site Settings", subtitle "Global configuration for checkout, notifications, and shipping."
- **Read-only flag:** `isReadOnly = role === 'assistant'`. Every control has `disabled={isReadOnly}`.
- **Load:** `GET /api/admin/settings` (unauthenticated). The response is `{ settings }`, shaped as described under the API section.
- **Save:** every control calls `saveSettings(partial)`, which sends `PUT /api/admin/settings` with a Bearer token. Success shows the toast "Settings saved". Failure shows a toast with the server's `error`, or "Save failed".
- **Toggle behaviour:** toggles and select-cards update local state optimistically, then save immediately. Text and number inputs have an explicit Save button, and Enter also saves.
- **Storage:** all values live on the singleton row of `site_settings`.

**Component styles.** Each card is `bg-white rounded-xl border border-line p-5`: a 16px teal-dark icon, an `h2 font-semibold`, and a subtitle in `text-xs text-ink-muted`. A SelectCard is a two-up `grid sm:grid-cols-2 gap-3` button: `p-4 rounded-lg border`. When selected it gets `border-teal bg-teal/5` and a teal check circle at top-right. Each SelectCard has an icon, a title and a desc. `ToggleSwitch` is `components/admin/ToggleSwitch.tsx`, with props `checked, disabled, onChange, icon, label, description`.

#### 1. Change Password (personal; not gated by read-only)

| Control | Type | Default | Column | Effect |
|---|---|---|---|---|
| `<ChangePasswordForm variant="admin" />` | form | — | Supabase auth | Changes the signed-in user's password. Not checkout-related |

#### 2. Checkout Type — subtitle "How customers pay at checkout."

| Control label | Type | Default | Column | Storefront effect |
|---|---|---|---|---|
| "Email Invoice" — "Send an invoice; customer pays manually." / "Cryptocurrency" — "Accept BTC / ETH / SOL on-chain." | 2 SelectCards (`checkout_type: 'email' \| 'crypto'`) | `crypto` (any value other than `'email'` reads as `crypto`) | `site_settings.checkout_type` | **None found.** Nothing in `app/`, `components/`, `contexts/` or `lib/` reads `checkout_type`; the hosted Stealth Health checkout is the only checkout. Legacy/dead control. The footer info box still says "Checkout type changes take effect immediately on the storefront." Server validation error: "checkout_type must be email or crypto" |

#### 3. Admin Email Notifications — subtitle "Recipients for operational alerts (orders, low stock)."

| Control | Type | Default | Column | Effect |
|---|---|---|---|---|
| email input (placeholder `admin@example.com`) + "Add" button (Enter also adds) | `type="email"` | `[]` | `site_settings.admin_emails` (text[]) | Recipients of operational alerts, including the admin "order paid" alert for Stealth Health invoices (`lib/admin/stealth-health-paid-alert`) and low-stock alerts. Fallback chain (`lib/admin/alert-recipients.ts`): `admin_emails` → env `ADMIN_ALERT_EMAILS` → `invoice_cc_emails` |
| Remove (Trash2 icon per row; hidden when read-only) | button | — | same | Removes the address and saves |

- **Client validation:** "Enter a valid email" (regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`), "Already added".
- **Server:** trims, de-duplicates and drops empty entries. Error: `Invalid email: <x>`.
- **Empty list text:** "No addresses added yet."

#### 4. Registration Alerts — subtitle "Email the admin recipients above when a customer registers, and again if they never check out."

| Control | Type | Default | Column | Effect |
|---|---|---|---|---|
| "On new registration": Enabled ("Send an alert the moment a customer signs up.") / Disabled ("Don't send a registration alert.") | SelectCards | `true` | `registration_alert_enabled` | Admin email on signup |
| "Abandoned registration (no checkout)": Enabled ("Follow up if a customer doesn't check out in time.") / Disabled ("No follow-up alert.") | SelectCards | `true` | `abandoned_registration_enabled` | Admin follow-up email |
| "Send follow-up after (hours)" + Save; hint "Default 12 hours" | `number`, min 1, step 1; disabled when abandoned registration is off | `12` | `abandoned_registration_hours` | Delay before the follow-up. Client error: "Enter a whole number of hours (at least 1)". Server error: "abandoned_registration_hours must be a whole number of hours (>= 1)" |
| **"Abandoned checkout (started, never paid)"** "Treat as abandoned after (hours)" + Save; hint "Default 1 hour" | `number`, min 1, max 720, step 1 | `1` | `abandoned_checkout_hours` | Sets the window behind the **Abandoned** tab on Stealth Health → Orders (unpaid hand-offs older than N hours). Nothing is sent automatically. Client error: "Enter a whole number of hours between 1 and 720". Server error: "abandoned_checkout_hours must be a whole number of hours between 1 and 720". `loadAbandonedHours()` caps the value at 720 and falls back to 1 |

Help text under the abandoned-checkout field, verbatim: "How long a hosted checkout sits unpaid before the Abandoned tab on **Stealth Health Orders** lists it as a cart worth chasing. Nothing is sent automatically — the tab is where an admin picks a cart and emails the payment link back, optionally with a promo code."

#### 5. Invoice Emails — subtitle "BCC recipients and the editable invoice email templates."

| Control | Type | Default | Column | Effect |
|---|---|---|---|---|
| email input (placeholder `bcc@example.com`) + Add, plus per-row remove | email list | `[]` | `invoice_cc_emails` | BCC on invoice emails (`app/api/admin/invoices/[id]/email`); also the last fallback for alerts |
| "Edit invoice email templates" (link, ChevronRight) | link | — | — | Goes to `/admin/settings/email-templates` |

That sub-page has H1 "Invoice Email Templates" and subtitle "Edit the customer and admin invoice emails."

- **Tabs:** customer and admin, each with Subject and Body fields.
- **Merge-variable buttons** insert `{{token}}`. There is a "Live preview" and a reset-to-default button.
- **Saving** sends `PUT /api/admin/settings` with `invoice_customer_email_subject`, `invoice_customer_email_body`, `invoice_admin_email_subject` and `invoice_admin_email_body` (plain strings). Defaults come from `lib/invoice-email-templates.ts`.
- **Scope:** these templates are for manual invoices, not the checkout confirmation.

#### 5b. Error Tracking

- **Subtitle:** "Fallback log for background failures. Order emails now send after checkout completes, so this is where a failed send shows up."
- **Link:** "View error log (failed emails)" → `/admin/settings/error-log`. That page uses `app/api/admin/error-log`; it was not inspected in depth.

#### 6. Pickup Address — subtitle "Shown to customers who choose local pickup."

| Control | Type | Default | Column | Effect |
|---|---|---|---|---|
| text input (placeholder `123 Main St, City, Province`) + Save; "Current: …" line below | text | `''` | `pickup_address` | **No storefront consumer found** by grep. Treat as legacy |

#### 7. Guest Checkout — subtitle "Allow customers to check out without an account."

| Control | Type | Default | Column | Storefront effect |
|---|---|---|---|---|
| Enabled ("Guests can place orders.") / Disabled ("Account required to check out.") | SelectCards | `true` | `guest_checkout_enabled` | `app/checkout/page.tsx` reads `s.guest_checkout_enabled ?? true` and passes `guestCheckoutEnabled` to the checkout form. When false, an account is required |

#### 7a. Storefront Sections — subtitle "Show or hide the optional sections on the product, cart and checkout pages."

All controls in this section are ToggleSwitches with default ON: the server reads `?? true`, and the page uses `!== false`. Each is saved immediately with `{ [key]: bool }`. Changing any `product_*` key triggers `revalidatePath('/products/[slug]','page')`.

| Sub-heading | Label (verbatim) | Description (verbatim) | Column | Storefront effect |
|---|---|---|---|---|
| Product page | Trust badges | "\"99% Purity\", \"GMP Certified\", \"COA Available\" and \"Ships from Canada\" with their icons, under the product image." | `product_trust_badges_enabled` | PDP strip |
| Product page | Purity / Strength / Form | "The three spec tiles under the product name." | `product_specs_enabled` | PDP |
| Product page | Key Research Benefits | "The bulleted benefits list under the Add to Cart badges." | `product_benefits_enabled` | PDP |
| Product page | Add to Cart badges | "\"99% Purity\", \"Third-Party Tested\", \"COA Available\" and \"Ships from Canada\" with their icons, under the Add to Cart button." | `product_cta_badges_enabled` | PDP |
| Product page | Quality Certifications | "The dark panel lower on the page — 99%+ Purity, GMP Certified, ISO Compliant, COA Available and the \"For Research Purposes Only\" line." | `product_certifications_enabled` | PDP |
| Product page | Customer reviews | "The Customer Reviews section — ratings, the review list and the write-a-review form." | `product_reviews_enabled` | PDP |
| **Cart page** | Trust badges | "\"Free, Fast & Discreet Shipping\", \"Secure Checkout\" and \"Carefully Packaged\" with their icons, at the top of the cart." | `cart_trust_strip_enabled` | `app/cart/page.tsx` fetches settings and sets `trustStripEnabled = json.settings.cart_trust_strip_enabled ?? true` |
| **Cart page** | You May Also Like | "Suggested products under the cart items. Same switch as Promotions → Cart suggestions." | `cart_similar_enabled` | `app/api/products/recommendations/route.ts` returns `similar: cart_similar_enabled ?? true` |
| **Checkout page** | Checkout add-ons | "The \"Complete your order\" box — reconstitution help, the WhatsApp link and products flagged as checkout add-ons. Hidden, checkout shows contact and order summary only." | `checkout_addons_enabled` | `app/checkout/page.tsx` → `setAddonsEnabled(s.checkout_addons_enabled ?? true)` |
| **Checkout page** | Verification notice | "\"A few quick questions first\" — the note under the pay button explaining the checkout partner's confirmation questions." | `checkout_verify_notice_enabled` | `app/checkout/page.tsx` → `setVerifyNoticeEnabled(… ?? true)` |

Note: the "Frequently bought together" switch (`cart_fbt_enabled`) is **only** on the Promotions page.

#### 7b. Stealth Health Checkout (the hosted payment processor)

Subtitle: "Checkout hands the cart off to the Stealth Health hosted checkout. Pricing, shipping, and fulfilment are handled by Stealth Health."

**Credential banner.** It shows `settings.puramass_configured`, which is computed server-side from env and never stored.
- **Green**, with a Check icon: "API key detected — hosted checkout can run."
- **Amber:** "No API key detected. Set PURAMASS_API_KEY on the server — checkout cannot take orders without it."

There is **no on/off toggle** for the hosted checkout. The API always returns `puramass_checkout_enabled: true`, with the comment "Stealth Health hosted checkout is the only checkout".

**"Shipping" sub-block.** Help text, verbatim: "With live rates on, the checkout asks for the delivery address and offers the fastest UPS and Canada Post services for it — the buyer picks one and that amount is sent to Stealth Health as the shipping total. The **Processing fee** configured under Shipping & Easyship is folded into every quoted price and never itemised for the buyer. Off, everyone pays the flat fee below and Stealth Health collects the address on its own page."

| Control | Type | Default | Column | Storefront effect |
|---|---|---|---|---|
| "Live courier rates" ("Buyer enters their address and chooses a courier.") / "Flat fee" ("One shipping price for every order.") | SelectCards (Truck / ToggleLeft icons) | `false` | `puramass_shipping_rates_enabled` | **On:** the checkout collects the address and quotes UPS / Canada Post through Easyship (`lib/payments/puramass-rates-server.ts`, `lib/payments/puramass-shipping.ts`: couriers `['ups','canada post']`, top 5 services); the chosen rate is sent as `shipping_total_cents`. **Off:** everyone pays the flat fee. Also gates free shipping (see Promotions) |
| "Flat shipping fee (CAD)" + Save (secondary button style) | `number` min 0 step 0.01, placeholder `35` | `35` (`DEFAULT_FLAT_SHIPPING`) | `puramass_flat_shipping` | Charged when live rates are off, and as the fallback when a quote fails. It is also what the fulfilment invoice records. Client error: "Enter a shipping fee of zero or more." Server error: "puramass_flat_shipping must be a non-negative number" |

- Help under the flat fee, verbatim: "Charged when live rates are off, and as the fallback whenever a courier quote can't be had. Also what the fulfillment invoice records for those orders."
- **Amber warning** shown when `puramass_shipping_rates_enabled && !easyship_enabled`: "Easyship live rates are switched off below, so buyers will still be quoted the flat fee. Turn Easyship on to offer real courier prices."

**"Product SKU mapping" sub-block.** Help text: "Match your products to Stealth Health catalog SKUs by name + strength."

- **"Clean up non-vyta SKUs"** (secondary button, Trash2 icon; tooltip "Clear mappings whose SKU is not prefixed vyta-"; shows "Cleaning…" while running).
  - Asks `window.confirm('Clear all Stealth Health SKU mappings whose value is not prefixed "vyta-"? You can re-run Sync afterward.')`.
  - Then sends `POST /api/admin/puramass/cleanup-skus` with `{}`.
  - Toast: `Cleared {n} mapping(s) on {m} product(s)`.
  - Result box: "Cleared **N** mapping(s) (packs X, vials Y) on **M** product(s) not prefixed `vyta-`.", followed by the affected product names.
- **"Sync SKUs from catalog"** (primary button, RefreshCw icon that spins; shows "Syncing…").
  - Sends `POST /api/admin/puramass/sync-skus` with `{}`.
  - Toast: `Synced — {updated} mapped, {ambiguous} to review`.
  - Report: four stat tiles — Mapped (emerald), Already set, Needs review (amber), Unmatched.
  - Source line: "Catalog source: **live|snapshot** (N `vyta-` SKUs of M · packs X, vials Y mapped)".
  - If the vial column is missing (amber): "Single-vial column not found — run the migration to enable vial SKU mapping."
  - "Needs review — pick a SKU by hand:" followed by a list of `name (vial|pack) → candidates`.
  - "Unmatched (no Stealth Health equivalent found):" followed by a comma-separated list.
- **Effect:** writes `products.puramass_sku` (pack/case) and `products.puramass_sku_vial`. The checkout hand-off needs these SKUs to build the Stealth Health order lines.
- **Roles:** both buttons are disabled for read-only users. Both routes are admin-only.

#### 8. Shipping (Easyship) — subtitle "Live-rate or flat-rate shipping via Easyship."

All controls except the toggle are saved together by **"Save shipping settings"**.

| Control | Type | Default | Column | Effect |
|---|---|---|---|---|
| "Live rates" ("Quote real carrier rates at checkout.") / "Flat rate" ("Charge a single flat shipping fee.") | SelectCards, saved immediately | `false` | `easyship_enabled` | Required for live courier quotes on the hosted checkout (see warning above). Also used by `lib/easyship.ts` and invoice shipping readiness |
| "Easyship API token" label + status "• configured" (emerald) / "• not set" | `password`; placeholder `•••••••• (leave blank to keep)` or `Paste your Easyship API token` | — | `easyship_api_key` (write-only; GET returns only `easyship_api_key_set`) | Sent only when non-empty; a single space clears it. Input is cleared after a successful save |
| "Origin / warehouse": AddressAutocomplete (placeholder "Start typing the warehouse street address…"), then City, State / Province, Postal code, Country (e.g. CA; maxLength 2, uppercased), "Sender / company name", "Sender phone" (tel), "Sender email" (email) | text inputs; picking a suggestion fills city, state, postal and country (default `CA`) | `{}` | `shipping_origin` jsonb `{line_1,city,state,postal_code,country_alpha2,company,phone,email}` | Origin for live-rate quotes and shipment creation |
| "Default parcel & flat rate": L (cm), W (cm), H (cm) | `number` min 0 | `{}` | `shipping_box` jsonb `{length,width,height}` (server coerces to numbers ≥0) | Parcel for quotes |
| "Per-vial weight (kg)" | `number` min 0 step 0.01 | `0.05` | `shipping_item_weight_kg` | Parcel weight = vials × this |
| "Flat rate ($)" | `number` min 0 step 0.01 | `20` | `shipping_flat_rate` | Legacy storefront/Easyship flat rate (`lib/easyship.ts`). **Different from** `puramass_flat_shipping` |
| "Processing fee": `<select>` "Fixed amount ($)" (`flat`) / "Percentage (%)" (`pct`) plus a value input (placeholder `% of rate (e.g. 10)` or `Amount ($)`) | select + number | `flat`, `0` | `shipping_handling_fee_type`, `shipping_handling_fee_value` | Added on top of each live carrier rate and baked into the quoted price, never itemised. Used by `lib/payments/puramass-shipping.ts` and `lib/easyship.ts` |
| "Easyship webhook": read-only input showing `EASYSHIP_WEBHOOK_URL` (select-on-focus), "Copy" button (toast "Webhook URL copied"), and a `<details>` "Subscribed events (N)" | display only | — | — | Help text: "Registered in Easyship → Connect → Webhooks. Label and tracking events update the order and invoice and send the shipped email. The webhook's secret key goes in the server's EASYSHIP_WEBHOOK_SECRET." |
| "Save shipping settings" | primary button | — | all of the above | Client coerces blank numbers to 0 |
| "Test connection" (shows "Testing…") | secondary button | — | — | `GET /api/admin/shipping/diagnose` (admin/assistant). Results box title: "EasyShip is configured and reachable" or "EasyShip is not fully working". Check rows: Base URL, DB read, Settings row present, EasyShip columns present, Live rates enabled, API token set, Origin address complete, EasyShip reachable, Webhook secret set; each shows ✓/✗/–. Then "Issues found:" with a list |

Server errors for the numeric fields: `<key> must be a non-negative number`.

#### 9. Klaviyo — subtitle "Email & SMS marketing: sync customers, orders and onsite activity to Klaviyo for flows, campaigns and signup forms."

This section affects checkout tracking events.

| Control | Type | Default | Column | Effect |
|---|---|---|---|---|
| Enabled ("Send events and load Klaviyo on the storefront.") / Disabled ("Nothing is sent to Klaviyo.") | SelectCards | via `shapeKlaviyoSettings` (not inspected) | `klaviyo_enabled` | Master switch |
| "Private API key" + status "• set via KLAVIYO_PRIVATE_API_KEY" / "• configured" / "• not set" | `password`, autoComplete off; placeholder `pk_…` or `•••••••• (leave blank to keep, a single space clears)` | — | `klaviyo_private_api_key` (write-only) | Error: "Klaviyo private API key should start with \"pk_\" (Klaviyo → Settings → API keys)." (regex `^pk_[A-Za-z0-9_]{10,}$`) |
| "Public API key / Site ID" | text, maxLength 12 | `''` | `klaviyo_public_key` | Loads klaviyo.js (`lib/site-config.ts`; built-in fallback Site ID `SY9j8v`). Error: `Klaviyo public key / Site ID looks invalid: <v>` |
| "Newsletter list": a select ("— Don't subscribe anyone —" plus the lists from the test) or a text input (maxLength 16) | select/text | `''` | `klaviyo_list_id` | Error: `Klaviyo list ID looks invalid: <v>` |
| "Onsite tracking & signup forms" — "Loads klaviyo.js (after cookie consent): Viewed Product, Added to Cart, Viewed Cart, and any pop-up or embedded forms you publish in Klaviyo." | ToggleSwitch | — | `klaviyo_onsite_enabled` | Cart tracking |
| "Order & checkout events" — "Started Checkout, Placed Order, Ordered Product, Confirmed / Fulfilled / Delivered / Cancelled / Refunded Order." | ToggleSwitch | — | `klaviyo_server_events_enabled` | Server-side checkout and order events |
| "Sync new accounts" — "Creates the profile and a Created Account event on signup, and subscribes consenting customers to the list above." | ToggleSwitch | — | `klaviyo_sync_signups` | — |
| "Save Klaviyo settings" | button | — | public key, list id, and private key (if typed) | — |
| "Test connection" | button | — | — | `POST /api/admin/klaviyo/test` with `{ private_api_key?, test_email? }`. Fills in the Site ID |
| "Sync consenting customers" (disabled until a list is saved; tooltip "Save a newsletter list first") | button + confirm "Subscribe every existing customer who gave marketing consent at signup to the selected Klaviyo list?" | — | — | `POST /api/admin/klaviyo/sync-customers`. Toast: `Sent N consenting customer(s) to Klaviyo` |
| test email input (placeholder `you@example.com`) + "Send test event" | email + button | — | — | Result text: "Test event sent to X — look for “VYTA Test Event” in Klaviyo → Analytics → Metrics." |

The Klaviyo admin routes accept admin only (`isKlaviyoAdmin`).

#### 10. Info box (blue), verbatim

"Checkout type changes take effect immediately on the storefront." / "Admin emails receive order and low-stock notifications." / "Email checkout requires SMTP/Resend configuration; crypto checkout requires wallet setup."

#### Not on this page (checked)

- **Currency / USD rate.** The column `site_settings.usd_exchange_rate` exists (`invoice-spec-integration-migration.sql`, `numeric NOT NULL DEFAULT 1`). `app/(admin)/admin/products/page.tsx` tries to read `settings.usd_exchange_rate` from `GET /api/admin/settings`, but `shape()` does **not** return it and PUT does not accept it. The products page therefore always uses `DEFAULT_USD_RATE = 0.73` (`lib/pricing.ts`). **No admin control edits the USD rate.**
- **Branding and tracking IDs** are on `/admin/marketing` (below).
- **Free shipping, ad discount, cart offer and FBT** are on `/admin/promos` (below).

#### Branding & Tracking (`/admin/marketing`) — checkout attribution and tracking parts

- **Header:** H1 "Branding & Tracking", subtitle "Store branding plus analytics tags behind a GDPR consent banner."
- **Access:** `canManage = canManageMarketing(role)` (admin, analytics). Otherwise the amber banner "Read-only access. Contact an administrator to make changes." is shown.
- **Saving:** one "Save Changes" button sends `PUT /api/admin/marketing`. Success text: "Marketing settings saved".

| Control (section "Tracking & consent") | Type | Default | Column | Effect |
|---|---|---|---|---|
| "GTM Container ID" (placeholder `GTM-XXXXXXX`; help "Loads the container for Ads / remarketing tags. GA4 below runs separately and directly — do not also add a GA4 tag inside the container, or every hit is counted twice.") | text mono | DB → `NEXT_PUBLIC_GTM_CONTAINER_ID` → built-in `GTM-M2J3D7SG` | `gtm_container_id` | Error: "GTM Container ID should look like GTM-XXXXXXX" (`/^GTM-[A-Z0-9]{4,}$/`, uppercased) |
| "GA4 Measurement ID" (placeholder `G-XXXXXXXXXX`) | text mono | DB → `NEXT_PUBLIC_GA4_MEASUREMENT_ID` → `G-F44F1BB1QV` | `ga4_measurement_id` | Error: "GA4 Measurement ID should look like G-XXXXXXXXXX" (`/^G-[A-Z0-9]{4,}$/`) |
| "Meta Pixel ID" (placeholder `000000000000000`) | text | null | `meta_pixel_id` | — |
| checkbox "Require cookie consent (GDPR)" — "When on, GA4 and the Meta Pixel do not load until the visitor accepts the consent banner. Turn off to load tracking immediately." | checkbox | `true` | `tracking_consent_required` | — |

The branding fields (Store name, Tagline, Logo, Favicon, Hero image) are also used by checkout and emails as the store name and logo.

---

### Admin — Cart upsells

**Page:** `/admin/cart-upsells` (`app/(admin)/admin/cart-upsells/page.tsx`).

- **Header:** Layers icon tile, H1 "Cart Upsells", subtitle "What the cart offers alongside each product — the “Frequently bought together” row."
- **Read-only:** `isReadOnly = role !== 'admin'`.

**Data.** `GET /api/admin/product-recommendations` returns:
- `products[]`: `id, name, sku, price, vial_price, vials_per_box, pack_options, pack_sizes, image_url, category, stock_quantity, active`
- `recommendations[]`: rows of `product_recommendations` `{ id, product_id, recommended_product_id, sort_order, badge, enabled }`
- `warning?`: when the table is missing, "The product_recommendations table is missing — run cart-upsells-migration.sql."

**Banners:**
- `warning` (amber), when present.
- A neutral info box, verbatim: "Pairings are one-way: what you set here is shown when THIS product is in the cart. The cart shows the first three. Whether the row appears at all is the [Promotions] page's “Cart suggestions” switch."

**Layout.** `grid lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] gap-5`.

**Left panel: product list.**
- Search input (`type="search"`, placeholder "Search products…") filters by name or SKU. Only `active` products are listed.
- Each row shows a 40px image, the name, and "N pairing(s)" or "No pairings yet". The selected row is `bg-teal/5` with a teal ArrowRight. The list scrolls (`max-h-[32rem]`).
- No match: "No products match that search."
- Opening a product discards unsaved edits to the previous one.

**Right panel: editor.**
- **Empty state:** "Pick a product to pair" / "Choose one on the left, then add what should be offered with it."
- **Heading:** "Shown when the cart contains" over the product name in H2.
- **Save button:** label "Save pairings" when dirty, otherwise "Saved". Disabled when read-only, saving or not dirty.
- **Empty draft:** "Nothing paired yet. The cart falls back to “You may also like” for this product."
- **Each draft row:**
  - Index bubble, image, name ("Product removed" if missing), price `$x.xx`.
  - When `stock_quantity <= 0`, an amber note: "Out of stock — the cart hides it".
  - **Badge** text input (placeholder "Badge (optional)", datalist presets `Most Popular`, `Best Value` from `PACK_BADGE_PRESETS`).
  - Move up / Move down (ArrowUp/ArrowDown) and Remove (Trash2) buttons.
- **"Add a product"** (Plus) opens an inline picker:
  - Search placeholder "Search products to pair…", X to close.
  - Lists up to 30 active products, excluding the current product and ones already chosen.
  - Empty: "Nothing left to add from that search."
  - Disabled at 6 items. Trying to add a seventh gives the toast "That's the most a product can recommend (6)."
- **Footer:** "{n}/6 paired — the cart shows the first three, in this order."

**Save.** `PUT /api/admin/product-recommendations` with `{ productId, items: [{ recommendedProductId, badge }] }`. Toast "Pairings saved". The local rows for that product are replaced with the response.

**Storefront effect.**
- `/api/products/recommendations` serves these pairings as "Frequently bought together" (first three, in `sort_order`, out-of-stock hidden) when `cart_fbt_enabled` is on.
- When a product has no pairings, the cart falls back to "You may also like", which is ranked automatically (`lib/products/recommendations.ts`) and gated by `cart_similar_enabled`.

---

### Admin — Discount codes (incl. affiliate codes)

**Page:** `/admin/discount-codes` (`app/(admin)/admin/discount-codes/page.tsx`).

- **Header:** H1 "Discount Codes", subtitle "Codes buyers enter at checkout. Assign one to an affiliate and every paid order that uses it is credited to them."
- **Permissions:** `editable = canEdit(role)` (admin). Assistants see the list read-only.
- **"New code" button:** primary, with a Plus icon. Shown only when editable and the migration has run.
- **Migration banner** (amber): "Run `affiliate-discount-codes-payouts-migration.sql` in the Supabase SQL editor to enable discount codes."

**Data.** `GET /api/admin/discount-codes` (adminFetch). It returns codes with `affiliate_name`, `affiliate_email`, `landing_page`, and `stats{orders, revenue, discount_given, commission, commission_pending}`. Stats are computed from `puramass_orders` where `status='paid'` and from `commissions` where `status != 'cancelled'`.

**Stat tiles** (4, `grid sm:grid-cols-2 lg:grid-cols-4`), computed over the filtered rows:

| Tile | Value | Hint |
|---|---|---|
| Orders | count | "N code(s)" |
| Revenue | `fmtMoney` (`$x,xxx.xx`, en-CA) | "Goods, after discount" |
| Discount given | money | — |
| Commission | money | "$X unpaid" |

**Filters:**
- Search input (placeholder "Search codes or affiliates"). Matches the uppercase code, affiliate name or affiliate email.
- Select: "All codes" / "Affiliate codes" / "Store codes" / "Active" / "Not active".
- Select: "All affiliates" plus each affiliate found in the codes.

**Table columns:**
- **Code:** mono, bold. If the code backs a landing page, a teal pill "Landing: {slug}" links to `/admin/landing-pages`. Notes are shown truncated beneath.
- **Affiliate:** links to `/admin/affiliates/{id}`, or shows "Store promo".
- **Discount:** "15% off" or "$20.00 off". Below it, a subline joined with " · ": "{rate}% commission" or "Default commission" (affiliate codes), "min $X", "first order only", "excl. N product(s)", "ends {date}".
- **Uses:** `orders` or `orders / max_uses`.
- **Revenue.**
- **Discount given.**
- **Commission:** "—" for store codes.
- **Status pill** from `codeStatus()`: "Inactive" (gray), "Expired" (red), "Scheduled" (amber), "Used up" (red), "Active" (green).
- **Actions:**
  - Copy (title "Copy checkout link"; copies `${origin}/checkout?discount=CODE`; toast "Checkout link copied").
  - Edit (admin).
  - Activate/Deactivate (Power icon, emerald when active). Sends `PATCH /api/admin/discount-codes/{id}` with `{ active: !active }`. Toast `CODE deactivated|activated`.
  - Delete (admin, and only when `stats.orders === 0 && stats.commission === 0`). Asks `confirm("Delete CODE? This cannot be undone.")`, then `DELETE`. Toast "CODE deleted".

**Empty states:** "No discount codes yet." / "No codes match these filters." Loading shows a centred spinner.

#### `DiscountCodeModal` (`components/admin/affiliates/DiscountCodeModal.tsx`)

Title "New discount code" or "Edit discount code". Modal: `max-w-lg`, `max-h-[90vh]`, scrolls.

| Field | Type / rules | Default | Column |
|---|---|---|---|
| "Code" + "Random" button (Shuffle) | text, mono, uppercase. Input is stripped to `[A-Z0-9]`, maxLength 32. Random = 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. Hint "Letters and numbers only. Buyers type it at checkout." | `''` | `discount_codes.code` (unique) |
| "Assigned affiliate" | select: "None — store-wide promo code" or "{name} ({email})[ — inactive]". Options come from `GET /api/admin/affiliates/directory`. Hidden (fixed text) when the modal is opened from an affiliate profile. Hint: "{name} earns commission on every paid order that uses this code." or "No commission is paid; sales are still tracked against the code." | none | `affiliate_id` |
| "Discount type" | select "Percent off" / "Fixed amount off" | percent | `discount_type` |
| "Percent" / "Amount (CAD)" | number min 0 step 0.01 | `10` | `discount_value` |
| "Commission rate (%)" (only when an affiliate is set) | number 0–100 step 0.01, placeholder "Affiliate's default rate". Hint "Of the discounted goods subtotal (shipping and tax excluded). Leave blank to use the affiliate's own rate." | blank | `commission_rate` |
| "Minimum order (CAD)" | number, placeholder "None" | blank | `min_subtotal` |
| "Usage limit" | number min 1, placeholder "Unlimited" | blank | `max_uses` |
| "Starts" / "Ends" | `datetime-local` (local time, sent as ISO) | blank | `starts_at`, `expires_at` |
| Landing page notice (when the code backs one) | text: "This code is the offer for the {slug} landing page, which displays its percentage. Changing it here changes what that page shows." | — | — |
| `CodeRestrictionsFields`: checkbox "First order only" — "Refused to anyone who already has a paid order — checked by account and by email, so guest checkouts count too. An unpaid checkout does not use it up." | checkbox | false | `first_order_only` |
| "Excluded products": chips with ✕, search input ("Search products to exclude", max 8 matches, catalogue from `/api/products`), "+ Exclude all bacteriostatic water (N)" shortcut (regex `/bacteriostatic\|bac[\s-]?water/i`). Hint "Excluded lines keep their list price; the percentage comes off everything else." Empty text "None — the code applies to the whole cart." | multi-select | `[]` | `excluded_product_ids` (uuid[]) |
| "Internal notes" | textarea, 2 rows, placeholder "e.g. Podcast sponsorship, Oct 2026" | — | `notes` |
| "Active" | checkbox | true | `active` |

- **Buttons:** "Cancel" and "Create code" / "Save changes". Save is disabled while saving or when the code has fewer than 3 characters.
- **Errors:** shown in a red box at the top.
- **Success toast:** "Discount code created" / "Discount code saved".

**Server validation errors** (`shapeDiscountCodeInput`, verbatim):
- "Codes are 3-32 letters or numbers."
- "Enter how much the code takes off."
- "A percentage discount can be at most 99%."
- "Commission rate must be between 0 and 100%."
- "Minimum order cannot be negative."
- "Usage limit must be at least 1, or blank for unlimited."
- "The end date must be after the start date."

Other errors:
- "Affiliate not found" (404)
- `{CODE} is already in use.` (409 on create) / "That code is already in use." (409 on edit)
- `RESTRICTIONS_NEED_MIGRATION` = "Run landing-pages-migration.sql in the Supabase SQL editor to use first-order-only codes and product exclusions."

**Storefront / checkout effect** (`lib/affiliate/discount-codes.ts`):
- The buyer types the code at checkout. `?discount=CODE` on `/checkout` pre-fills it.
- `lookupDiscountCode` normalises the code to uppercase `[A-Z0-9]`, then checks in order: active, starts_at, expires_at, max_uses (counts paid `puramass_orders`), own-affiliate code, first-order-only, min_subtotal, eligible lines.
- A fixed amount is converted to a percent of the eligible subtotal, capped at 99%.
- The discount is applied by lowering per-line `unit_price_cents` on the Stealth Health hand-off (`distributeLineDiscounts`). Excluded lines keep list price.
- A code whose affiliate is inactive is rejected as "inactive".
- Buyer-facing rejection messages:
  - "That code isn't valid."
  - "That code is no longer active."
  - "That code isn't active yet."
  - "That code has expired."
  - "That code has reached its usage limit."
  - "Your order is below the minimum for that code."
  - "You can't use your own affiliate code."
  - "That code is for first orders only."
  - "We couldn't check that code right now. Please try again."
  - "That code doesn't apply to the items in your cart."

#### Affiliate-side controls that affect checkout (`/admin/affiliates/[id]`)

- **Discount codes panel** (`components/admin/affiliates/AffiliateCodesPayouts.tsx`):
  - Panel title "Discount codes" with a "New" button (admin). The modal opens with `fixedAffiliate`.
  - Data: `GET /api/admin/discount-codes?affiliate_id=…`.
  - Columns: Code, Discount, Uses, Revenue, Commission, Status.
  - Actions: "Copy checkout link" and "Edit".
  - Next to it, a "Payments to affiliate" panel lists payouts with a "Void payout" action. This is commission bookkeeping, not checkout.
  - Migration notice: "Discount codes and payouts need `affiliate-discount-codes-payouts-migration.sql` to …".
- **"Referral link" panel:**
  - Shows the active referral code, "N use(s)", and a copy button for `${origin}?ref=CODE`.
  - "Change" or "Set code" (admin) opens `EditReferralCodeModal` ("Change referral code" / "Set referral code").
  - A pending code request can be approved or declined inline.
  - A referral code is a tracking link only and **takes nothing off**. It is captured from `?ref=` and stored as `puramass_orders.referral_code` at hand-off. A discount code shared as a `?ref=` link is also credited (`resolveReferralCodeOwner`).
- **Commission rate:** "{n}% commission" is shown in the header. The editing modal (`EditAffiliateModal`) was not inspected in detail.

---

### Admin — Promotions (first-order, ad discount, cart offer, landing promos)

**Page:** `/admin/promos` (`app/(admin)/admin/promos/page.tsx`).

- **Header:** Sparkles tile, H1 "Promotions", subtitle "Customer-facing offers on the storefront and hosted checkout."
- **Read-only:** `isReadOnly = role === 'assistant'`.
- **Load:** `GET /api/admin/settings`. Load error toast: "Failed to load promotions".
- **Save:** `PUT /api/admin/settings`. Toast "Promotions saved" or the server error.
- **Loading state:** spinner with "Loading promotions…".
- **Cards:** same style as the Settings cards. Running/Off are SelectCard-style buttons with ToggleRight/ToggleLeft icons and a teal check when selected.

#### Card 1 — "Free shipping over a spend" (Truck)

Description, verbatim: "Once a cart's subtotal reaches the threshold, shipping is free — whichever courier the buyer picks at checkout. Their cart shows a progress bar with how much more they need to add. The subtotal is re-checked against the catalog when the order is placed, so the offer can't be claimed from the browser."

**Lock:** `locked = isReadOnly || !puramass_shipping_rates_enabled`. When rates are off, an amber box reads: "Live courier rates are switched off, so every order pays the flat shipping fee and there is nothing for this promo to waive. Turn on **Stealth Health Checkout → Shipping → Live courier rates** first. [Open Site Settings →]".

| Control | Type | Default | Column | Behaviour |
|---|---|---|---|---|
| "Running" ("Carts over the threshold ship free.") / "Off" ("Everyone pays for shipping as quoted.") | buttons | off | `puramass_free_shipping_enabled` | Running requires threshold > 0, otherwise the toast "Set a spend threshold above zero first.". It sends `{ puramass_free_shipping_enabled: true, puramass_free_shipping_threshold: N }`. Off sends `{ …enabled: false }` |
| "Spend threshold (CAD)" + "Save threshold" | number min 0 step 0.01, placeholder "e.g. 300"; hint "Goods only — shipping and taxes don't count toward it." | `0` (the input shows blank when 0) | `puramass_free_shipping_threshold` | Client error "Enter a threshold of zero or more." |
| Live banner (emerald) | text: "Live: carts of **$X.XX** or more ship free." | — | — | Shown when enabled and threshold > 0 |

**Effective rule** (`shapeHostedShippingSettings`): `freeShippingEnabled = ratesEnabled && puramass_free_shipping_enabled && threshold > 0`. The API exposes `puramass_free_shipping_active`. `PromosContext` and `app/checkout/page.tsx` read it to draw the cart progress bar and the free rate. `/api/checkout/puramass` re-checks against the catalogue-priced subtotal.

#### Card 2 — "Paid-ads welcome discount" (Megaphone)

This is the **first-order** promo: the first-order condition is part of this discount, and there is no separate first-order control.

Description, verbatim: "Visitors who arrive on a Google, Meta, Microsoft, TikTok or LinkedIn ad see a strip under the nav bar offering this much off if they create an account. Once they have one it applies to their order automatically — no code to enter. The saving is taken off the line prices sent to the hosted checkout, and who qualifies is re-decided server-side from the attribution already being collected, so it can't be claimed from the browser."

**Lock:** `adLocked = isReadOnly || !puramass_checkout_enabled`. The API always returns true, so in practice only read-only locks it. The unreachable amber copy reads: "The Stealth Health hosted checkout is switched off, and it is the only checkout that carries our own line prices — so there is nowhere for this discount to be applied. Turn on **Stealth Health Checkout** first. [Open Site Settings →]".

| Control | Type | Default | Column | Behaviour |
|---|---|---|---|---|
| "Running" ("Signed-in ad visitors get the discount.") / "Off" ("No strip, and everyone pays list price.") | buttons | off | `ad_discount_enabled` | Running requires percent > 0 ("Set a discount above zero first.") and also sends `ad_discount_percent` |
| "Discount (% off the subtotal)" + "Save discount" | number min 0 max 100 step 0.01, placeholder "e.g. 25"; hint "Goods only — taken off before shipping and taxes. Zero switches the offer off." | `25` (`DEFAULT_AD_DISCOUNT_PERCENT`; the input is blank if the stored value is 0) | `ad_discount_percent` | Client error "Enter a discount between 0 and 100 percent." Server rejects >99: "ad_discount_percent must be a number between 0 and 99 — the hosted checkout cannot be sent a zero line price." |
| Live banner (emerald, BadgePercent) | "Live: signed-in visitors who arrived on a paid ad get **N% off** their order." | — | — | — |

**Qualification** (`qualifiesForAdDiscount`) requires all of:
- `enabled && percent > 0`
- the visitor is signed in
- **first order** — `lib/promos/first-order.ts`. The offer counts as used once there is a `puramass_orders` row in `paid` or `payment_pending`, or `customers.has_completed_first_order` is true. `expired` and `cancelled` rows give the offer back.
- at least one paid-ad attribution channel (the first-touch cookie or `customers.attribution_channel`).

The API exposes `ad_discount_active` (= enabled after shaping).

#### Card 3 — "Limited-time cart offer" (Gift)

Description, verbatim: "A strip at the top of the cart summary: once the cart carries the minimum number of items, this much comes off the order. Below that minimum it tells the shopper how many more to add. Open to everyone — what earns it is the cart, not the buyer — and it stacks with the welcome discount above, the two composing rather than adding (25% then 10% is 32.5% off, never 35%)."

It has the same lock and amber copy as Card 2.

| Control | Type | Default | Column | Behaviour |
|---|---|---|---|---|
| "Running" ("Carts at the minimum get the discount.") / "Off" ("No strip, and everyone pays list price.") | buttons | off | `cart_offer_enabled` | Running requires percent > 0 ("Set a discount above zero first.") and sends `cart_offer_percent` and `cart_offer_min_items` (`max(1, floor(input) \|\| 1)`) |
| "Discount (% off the subtotal)" | number min 0 max 99 step 0.01, placeholder "e.g. 10" | `10` | `cart_offer_percent` | — |
| "Minimum items to unlock" | number min 1 step 1, placeholder "e.g. 2"; hint "Counted as cart lines × quantity — a pack of 5 is one item, the way the shopper counts it." | `2` | `cart_offer_min_items` (server clamps to 1–99) | — |
| "Ends (optional)" + "Clear" link + "Save offer" | `datetime-local`; hint "Your local time. The cart counts down to it and the checkout stops honouring the discount at it, so the clock never promises something the order then refuses. Leave it empty and the offer runs with no countdown until you switch it off." | null | `cart_offer_ends_at` (ISO) | "Save offer" sends all three values. Client errors: "Enter a discount between 0 and 99 percent.", "Enter a minimum of at least one item.", "That end date could not be read." |
| Live banner (emerald) | "Live: carts with N item(s) or more get **P% off**, until {toLocaleString}." (or ending in ".") | — | — | Shown when enabled, percent > 0 and not ended |
| Ended banner (amber) | "This offer's end date has passed, so nothing is being discounted and the cart shows no strip. Give it a new end date (or clear the field) to run it again." | — | — | — |

Server errors:
- "cart_offer_percent must be a number between 0 and 99 — the hosted checkout cannot be sent a zero line price."
- "cart_offer_min_items must be a whole number of items (>= 1)"
- "cart_offer_ends_at must be a date/time, or empty for no end date"

**Stacking:** the ad discount and cart offer combine as `combineDiscountPercents` = `1 − Π(1 − p)`, capped at 99. The API exposes `cart_offer_active`.

#### Card 4 — "Cart suggestions" (Sparkles)

Description: "The two blocks under the cart's line items. Neither discounts anything — they only decide what gets suggested."

| Control | Type | Default | Column |
|---|---|---|---|
| "Frequently bought together" — "Your own pairings, set per product in **Cart Upsells**." | toggle button (ToggleRight/ToggleLeft) | `true` | `cart_fbt_enabled` |
| "You may also like" — "Ranked automatically from what customers buy together — nothing to configure." | toggle button | `true` | `cart_similar_enabled` (same as Settings → Cart page → You May Also Like) |
| "Edit the pairings →" | link | — | `/admin/cart-upsells` |

#### Landing promos (`/admin/landing-pages`, promo parts)

- **Header:** H1 "Landing Pages", subtitle "Pages on other domains that send visitors here. Each one prints the percentage set below, and checkout puts its code into the discount field for everyone who arrives from it."
- **Controls:**
  - Date-range select ("All time" / "90 days" / "30 days" / "7 days"; sends `?days=`).
  - "New landing page" (admin, when migrated).
- **Banners:**
  - Missing table: "Run `landing-pages-migration.sql` … to enable landing pages. Until then no landing offer is applied."
  - Missing counters: "Run `landing-page-counters-migration.sql` … to count page views, click-throughs and visitors. Sign-ups, checkouts and orders are counted already."
- **Each page card:**
  - Name.
  - Status pill: "Off" (gray), "Live · N% off" (emerald), "Offer not live" (amber) or "No offer".
  - Subline: `slug · domain · code CODE · first order only · excl. N products`.
  - Amber note when the code is not live: "Its code is switched off, not started, ended or not a percentage — the landing page is being told there is no offer."
  - Icon actions: "Open the button link", "Edit", "Switch off/on" (`PATCH { active }`), and "Delete". Delete is only offered when there are no paid orders; it asks `confirm('Delete "NAME"? Its discount code goes with it. This cannot be undone.')`.
  - Copy rows: "Button link" (`cta_url` = `SITE_URL{destination}?lp={slug}`) and "Offer API" (`SITE_URL/api/landing/{slug}`).
  - Stat tiles: Page views, Clicked through, Visitors, Sign-ups, Checkouts, Purchasers, Paid orders, Revenue (per currency), Discounts given.

**`LandingPageModal`** (`components/admin/LandingPageModal.tsx`):

| Field | Rules / default | Column |
|---|---|---|
| Name (hint "Internal only.", placeholder "Meta — first order 35%") | required, ≤120 | `landing_pages.name` |
| Slug (lowercased, stripped to `[a-z0-9-]`, max 40; hint "Rides on the button link as ?lp={slug}.") | `/^[a-z0-9][a-z0-9-]{1,39}$/` | `slug` (unique). Changing it on edit shows the amber warning "Changing the slug breaks the live landing page until its config is updated to the new one, and visitors already holding the old one lose the offer." |
| Landing domain (placeholder `getvyta.ca`) | normalised host | `domain` |
| Button goes to (placeholder `/products`) | site path | `destination_path` (default `/products`) |
| checkbox "This landing page offers a discount" | default true (new) | — |
| Percent off | number 1–99 step 0.5, default `35` | becomes a **real `discount_codes` row** (`discount_type='percent'`) |
| Discount code | auto = `SLUG+PCT` uppercase (`suggestLandingCode`) until edited | `discount_codes.code` |
| CodeRestrictionsFields | first order only (default **true** here), excluded products, bac-water shortcut | code `first_order_only`, `excluded_product_ids` |
| Starts / Ends / Usage limit | datetime-local / number | code `starts_at`, `expires_at`, `max_uses` |
| Internal notes | textarea | `landing_pages.notes` |
| checkbox "Active — switch off to stop the offer everywhere at once" | default true | `landing_pages.active` |

- **Buttons:** "Create landing page" / "Save changes". Disabled unless a name is set and the slug has at least 2 characters.
- **Effect:** the landing page links to the store with `?lp=slug`. The storefront stores the cookie `vyta_lp` for 30 days and checkout auto-fills the page's code.
- **Removing the offer** on edit deactivates the code (`active=false`).

---

### Admin — Orders / Puramass operations

#### A. Stealth Health page shell (`/admin/stealth-health`, `app/(admin)/admin/stealth-health/page.tsx`)

- **Header:** H1 (Handshake icon) "Stealth Health". The subtitle "Stealth Health collects payment on its hosted checkout and we ship the goods, so every paid hand-off is money they hold for us." is followed by `summary.terms_summary`. A "Refresh" button reloads the summary.
- **Balance KPI strip** (always all-time), from `GET /api/admin/stealth-health/summary`:
  - "Earned all-time" — "net of refunds and their cut"
  - "Paid to us"
  - "They owe us"
  - "Invoiced & unpaid"
- **Tabs** (deep-linkable with `?tab=`): Overview | Reconcile | Invoices | Payouts | **Orders** | Terms. Active tab: `border-teal text-teal-dark`.
- **States:** loading shows "Loading Stealth Health settlement…"; failure shows "Could not load the settlement dashboard." with a "Try again" button.
- `isAdmin = role === 'admin'` is passed to the settlement tabs.

**Settlement tabs** (not checkout; summarised):
- **Overview:** 7d/30d/90d chips and From/To dates, KPIs, "How the money splits", "Billing status" with an "Invoice $X →" CTA, "Earned per day" bars, "Latest settlement invoices".
- **Invoices:** create a settlement invoice (Period start, Period end, Issue date, Notes, preview totals), delete draft (confirm "Delete draft INV? Its N orders go back to unbilled.").
- **Payouts:** record a payout (Amount, Received on, Apply to invoice, Method, Reference, Notes); remove (confirm "Remove the $X payout from DATE? The balance owed goes back up.").
- **Reconcile:** pulls the partner settlement.
- **Terms**, saved to `stealth_health_settings` with `PUT /api/admin/stealth-health/settings` (admin). Fields and defaults:
  - Partner name ("Stealth Health")
  - Partner email
  - Partner billing address
  - Commission % (0)
  - Flat fee per order (0)
  - Settlement currency (USD | CAD)
  - Flat shipment fee (3500 cents)
  - "Remitted to us" checkbox (true)
  - Payment terms (days) (14)
  - Notes

#### B. Orders tab (`_components/orders/OrdersTab.tsx`) — the hosted-checkout ledger (`puramass_orders`)

- **Section heading:** H2 "Stealth Health Orders" (CreditCard icon), subtitle "Every hosted-checkout hand-off, for reconciliation. Payment, fulfilment, and emails are handled by Stealth Health."
- **Roles:**
  - Admin and assistant can view, sync, refresh, recover and request addresses.
  - `canDeleteOrders = canDelete(role)` (admin) controls delete.
  - `canSendConfirmation = canEdit(role)` (admin) controls the confirmation email button.

**Top-right actions:**

1. **"Sync {all|paid|pending|abandoned|expired|cancelled} from Stealth Health"** (teal-dark primary, CloudDownload or spinner).
   - Tooltip: "Re-read every {x} order from Stealth Health — picks up statuses and shipping addresses" (or "Re-read every order from Stealth Health").
   - Calls `POST /api/admin/puramass/orders/sync` with `{ statuses }`: `[status]`, `RECOVERABLE_STATUSES` for the Abandoned tab, or undefined for All.
   - Toast when `total === 0`: "Nothing to sync in {label}."
   - Otherwise: "Polled P of T · N status change(s) · A address(es) updated · E failed".
   - If `rate_limited`, error toast: "… Stealth Health rate-limited us — run it again shortly."
   - Reloads the list afterwards.
2. **Reload** (RefreshCw icon only; title "Reload this list"; 42×42).
3. **"Columns"** picker (Columns3 icon; a badge `visible/total` when columns are hidden).
   - Popover header "Show columns" with a "Reset" link.
   - One checkbox per column, with its hint; locked columns show "always on".
   - Closes on outside click or Escape.

**Missing-addresses banner** (amber), shown when `addressesAvailable === false`: "Shipping addresses are unavailable: the database is missing the `shipping_address` columns. Run `puramass-shipping-address-migration.sql` in the Supabase SQL editor — everything else on this page works meanwhile."

**Status filter tabs** (underline tabs, each with a count pill; the active pill is `bg-teal-dark text-white`). The default tab is **Paid**.

| Tab | key | Query |
|---|---|---|
| Paid | `paid` | `status=paid` |
| Pending | `payment_pending` | `status=payment_pending` |
| Abandoned (title "Unpaid carts old enough to chase with a recovery email") | `abandoned` | `abandoned=1` → status in `payment_pending, expired, cancelled` AND `created_at <= now − abandoned_checkout_hours` |
| Expired | `expired` | `status=expired` |
| Cancelled | `cancelled` | `status=cancelled` |
| All | `all` | no filter |

**Abandoned-tab info box** (teal), verbatim: "Carts started more than {an hour | N hours} ago that never reached payment. Their Stealth Health checkout links are still live, so the cart button on each row emails one back to the buyer — with a promo code and a discount if you want to sweeten it. Tick several and **Chase carts** writes the message once and sends every buyer their own email, with their own cart and their own payment link."

If `recoveryAvailable === false`, it adds: "Send history is not being recorded yet — run abandoned-checkout-recovery-migration.sql to track which carts have been chased."

**Search and reset:**
- Search input (placeholder "Search email, name, transaction or reference…"; clear-X button). Debounced 300 ms; resets to page 0.
- The server matches `customer_email`, `partner_reference`, `transaction_id`, `referral_code` and `customer_name` (when available) with `ilike`. The characters `,()*` are stripped.
- "Reset filters" link appears when status ≠ paid or a search is set; it returns to Paid with an empty search.

**Columns** (`columns.ts`). Visibility is saved per browser in localStorage `aminocan:puramass-orders:columns:v2` (legacy key `…:columns`, migrated by adding `referral`).

| key | Header | Hint | Locked | Default visible | Cell |
|---|---|---|---|---|---|
| date | Date | When the hand-off was created | ✓ | ✓ | date plus `HH:MM` (`text-[11px]`) |
| customer | Customer | Name, email and phone | ✓ | ✓ | name (bold), email (break-all), phone |
| address | Ship to | Shipping address from Stealth Health | | ✓ | MapPin plus address lines. A "From customer" emerald chip appears when `shipping_address_source='customer'` (tooltip: "…A Stealth Health sync will not overwrite it."). A copy button shows on hover. With no address: "No address yet", plus amber "Asked {timeAgo}" if requested |
| items | Items | SKUs and quantities | | ✓ | `sku × qty, …` |
| total | Subtotal | Order subtotal and currency | | ✓ | `$x.xx CUR`; currency defaults to `usd` uppercased. Right-aligned |
| status | Status | Payment status | ✓ | ✓ | Capitalised badge: payment_pending amber, paid emerald, expired gray, cancelled red. Below it: paid date; "Recovered" emerald chip (Sparkles) when paid after a recovery email, or amber "Chased N×"; and for paid rows with an invoice, a ConfirmationLine: "Confirmation failed" (red), "Confirmed {ago} · N×" (emerald) or "No confirmation sent" (amber) |
| recovery | Recovery | Abandoned-cart chases: how many, when, and the code offered | | | "N email(s) · {ago}", the promo code in mono, and the offer ("15% off" / "$25.00 off"). Otherwise "Not chased" (or "—" if paid) |
| invoice | Invoice | Linked invoice, its status and fulfilment | | ✓ | link to `/admin/invoices/{id}` (mono number), payment badge from `INVOICE_STATUS_META[effectiveStatus]`, fulfilment chip (Pending, Packed, Shipped, Picked up, Dropped off). With no invoice: "Not created" (paid) or "—" |
| account | Customer view | Whether the buyer sees this order | | | pill "Visible" (emerald) / "Not linked" (amber) / "Hidden" (gray); the tooltip gives the reason (see `accountVisibility`) |
| transaction | Transaction | Stealth Health transaction id | | | first 12 characters + "…", linking to `payment_link` with ExternalLink |
| reference | Reference | Our partner_reference | | | mono |
| referral | Affiliate | Affiliate code captured at checkout, and whose it is | | ✓ | code (teal mono), then affiliate name plus amber "(inactive)", or italic "Unrecognised code" |
| updated | Updated | Last change to the ledger row | | | date |

`accountVisibility` reasons, verbatim:
- "Not paid yet — no customer order exists until Stealth Health confirms payment."
- "Paid, but not yet materialised into an invoice — nothing shows in the account until it is."
- "Invoice X lapsed unpaid, so the account page hides it." (or "…is waiting for payment on the Stealth Health checkout — it appears in the account once paid.")
- "The linked invoice is a draft, which the account page hides."
- "Invoice X exists but is not linked to a customer account (guest email), so no one sees it. Run the account backfill to link it by email."
- "Visible in {email}'s account as X."

**Row actions** (right-aligned 32×32 icon buttons; a teal-bordered style marks a suggested next action):

1. **Eye — "Preview exactly what the customer sees".** Opens `CustomerOrderQuickview`, which renders `/account/orders/[id]` markup from the invoice. If the order is not shown to any customer it displays "Not shown to any customer" plus the reason.
2. **ShoppingCart** (only when `status !== 'paid'`).
   - Tooltip: "Email this cart back to the customer with their payment link", or "This hand-off has no payment link — the email goes out without a checkout button".
   - Teal border when never chased.
   - Opens **RecoverCheckoutDialog**.
3. **MailPlus** (always).
   - Tooltip: "Ask the customer to confirm or correct their shipping address" or "Email the customer for their shipping address".
   - Teal border when there is no address and none has been requested.
   - Opens **RequestAddressDialog**.
4. **MailCheck** (admin, paid, with an invoice): "Send the order confirmation email" / "Resend the order confirmation email".
   - If already sent, asks `confirm("{to} has already been sent this confirmation {once|N times}. Send it again?")`.
   - Sends `POST /api/admin/confirmation-email` with `{ puramassOrderId }`.
   - Toast `Order confirmation (re)sent to X.`; the row is patched locally.
5. **RefreshCw — "Re-read this order from Stealth Health".** Disabled without `transaction_id`, where the tooltip is "No transaction to refresh".
   - Sends `POST /api/admin/puramass/orders/refresh` with `{ transaction_id }`.
   - Patches status, paid_at, currency, subtotal, address and contact; absent fields never blank existing values.
   - Toast `Status: {status}`.
6. **Trash2** (admin): "Delete this hand-off record" opens **DeletePuramassOrdersDialog** for this one row.

**Bulk selection.** A header checkbox selects all rows on the current page; each row has its own checkbox. Selection resets on every reload. With a selection, a teal bar shows "N order(s) selected" and:
- "Clear"
- **"Chase N cart(s)"**, shown when some selected rows are `payment_pending` or `expired` (`hasReusablePaymentLink`) and have an email or customer.
  - N counts distinct buyers.
  - Tooltip: "Email N buyer(s) their own cart and payment link — one separate email each".
  - Opens **BulkRecoverDialog**.
- "Sync selected": `POST /api/admin/puramass/orders/sync` with `{ ids }`.
- "Delete selected" (admin; red) opens the Delete dialog.

**Pagination:** `PAGE_SIZE = 25`; the server allows up to 100. Footer: "{total} {filter} order(s) · Page X of Y", with "Prev" and "Next".

**Table states:**
- Loading: "Loading…" with a spinner.
- Error: red text.
- Empty: "No {filter} orders match this search." (with filters), otherwise "No paid hosted-checkout orders yet."

#### C. RecoverCheckoutDialog (single abandoned cart)

1. **Before opening the composer**, it calls `GET /api/admin/puramass/orders/recover?id=…` to get the server-resolved cart (product names and prices, not SKUs).
2. **Shell states**, in a `max-w-lg` modal titled "Recover this checkout":
   - Loading: "Loading the cart…".
   - Load error: the error text in red with an AlertTriangle.
   - Blockers, checked against the fresh draft:
     - "This checkout has since been paid — there is nothing to recover."
     - "A {status} hand-off cannot be recovered."
     - "This hand-off has no customer email on it, so there is nobody to send to. Sync it from Stealth Health first — the buyer's address arrives with the order."
   - Sent: green check, "Sent to {email}", then "That is recovery email #N for this cart." or "Their payment link is on its way."
   - If `recorded === false`, amber: "The email went out, but the send could not be recorded against the order — run abandoned-checkout-recovery-migration.sql so the history shows it."
   - Footer button: "Done" or "Close".
3. **Composer:** `EmailComposer` (`app/(admin)/admin/_components/EmailComposer.tsx`, a `max-w-3xl` modal with a live HTML preview built by `renderPromoEmail`). Props: heading "Recover this checkout"; `toEmail` = the order's email.
   - **Subheading:** `{reference} · started {ago}` plus amber "already chased N×, last {ago} with CODE".
   - **Template buttons** (`RECOVERY_TEMPLATES`):
     - "Discount nudge" — subject "Here is {{discount}} to finish your order, {{first_name}}"
     - "Plain reminder" — subject "You left something in your cart"
     - "Last chance" — subject "Last chance on your cart"
     - "Blank"
     - Merge fields are `{{first_name}}` and `{{discount}}`.
   - **Fields:** Subject; Message; "Promo code" (uppercased, placeholder `SUMMER15`); "Valid until" (free text, placeholder "Valid until 30 September", hint "Free text — shown as written."); "Discount type" (Percentage / Fixed); "Amount"; "What the code gets them"; "CC" (placeholder `colleague@aminocan.com`).
   - **Cart block and checkout button:** "Complete your order", linking to `payment_link`, with `checkoutNote`.
   - **Promo note**, verbatim: "Promo codes are generated in app.vytabio.com (the Stealth Health platform). Create the code there first, then paste it below — the type and amount you pick only decide how the offer is worded; Stealth Health applies the real discount when the customer enters the code at checkout."
   - **Send button:** "Send recovery email".
   - **Send is disabled** unless a subject and body are present and there are no bad CC addresses. A discount amount that doesn't parse shows "Enter a percentage between 0 and 100." or "Enter an amount greater than zero."; a discount with neither code nor details shows "Add the promo code this discount belongs to, or describe how to claim it."
   - **Vague-discount hint:** "No amount entered, so {{discount}} will read \"a discount\". Fill in the amount below to name the figure."
4. **Send:** `POST /api/admin/puramass/orders/recover` with `{ id, templateKey, subject, body, promoCode, promoDetails, promoExpires, cc, discountType, discountValue }`.
   - Success toast: `Recovery email sent to X (+N copied).`
   - The row is patched with `recovery_*`.
   - Errors appear in a bottom-floating red box.

#### D. BulkRecoverDialog ("Chase these carts")

- **Recipients:** rows are converted to people with `outreachIdFor(row)`, which de-duplicates by customer. Rows without an email are counted as `noEmail`.
- **Loading:**
  - If no row has an email: "None of the selected orders have a customer email on them, so there is nobody to write to. Sync them from Stealth Health first."
  - Otherwise it calls `GET /api/admin/customers/outreach?ids=a,b,…`, which returns `recipients` and `primary{cart, checkout}`. Error if none resolve: "None of the selected buyers could be resolved to a customer record."
- **Composer settings:** heading "Chase these carts"; subheading "N buyer(s) from your selection, each getting their own email · M selected order(s) had no email and were left out".
  - `attachable` checkbox, default on: "Send each buyer their own cart and payment link" — "Every recipient gets the basket they left and the Stealth Health link that still takes payment for it, looked up per person when the email goes out."
  - Bulk section "Also send this to other customers": search `GET /api/admin/customers/outreach?q=&abandoned=1|0&exclude=…`, defaulting to abandoned only.
  - Promo note: same as the single dialog, but saying "…the same code goes to everyone on this send…".
  - Send label "Send recovery emails", or "Send N emails" when there are extra recipients.
- **Send:** `POST /api/admin/customers/outreach` with `{ templateKey, subject, body, promoCode, promoDetails, promoExpires, cc, discountType, discountValue, attachCheckout, recipients: [ids] }`. Maximum 40 recipients; CC goes only on the first email (max 10).
- **Result screen:** "Sent N email(s) — one to each customer." / "W carried the buyer's own cart and payment link."
  - Failures listed under "N could not be sent:".
  - Amber note when sends could not be recorded.
  - The table reloads.

#### E. RequestAddressDialog ("Ask for the shipping address")

- **Header:** MapPin tile, H2 "Ask for the shipping address", with the first 18 characters of `partner_reference` below.
- **Intro, verbatim:** "We'll email the customer a private link to a page that shows this order and asks for their shipping address. Whatever they submit is written straight onto this hand-off."
- **If an address exists** (amber): "This order already has an address on file:" followed by the address, then "Sending anyway lets the customer correct it."
- **If asked before:** "Last asked {date}. Re-sending re-uses the same link, so the earlier email keeps working."
- **Fields:**
  - "Send to": email input, prefilled with `customer_email`, placeholder `customer@example.com`. If there is no email on file, amber: "This hand-off has no email on file — enter one to reach the customer."
  - "Copy someone else" link reveals "CC (optional)" (placeholder "someone@example.com, another@example.com"; hint "Up to 5, separated by commas. They see the same email — and the customer sees who was copied.").
  - "Add a note (optional)": textarea, 3 rows, max 500 characters, placeholder "Anything you'd like to say to them — appears in the email."
- **Buttons:** "Cancel" and "Send request" (or "Send again" when asked before). An empty recipient gives "Enter the email address to send this to."
- **Send:** `POST /api/admin/puramass/orders/request-address` with `{ id, email, cc, note }`.
- **Success view:** green "Emailed to X, copying Y. [The link from the earlier email still works.]", then "Their link" (read-only input with Copy and Open buttons) and the text "Anyone with this link can set the address on this one order, so share it only with the customer. It expires in 30 days." plus a "Done" button.
- **Mail failure:** the link is still returned, shown under "{error} The link below is live — you can send it another way."
- **Toast:** `Address request sent to X (+N copied).` The row's `address_requested_at` is patched.
- **Customer page:** `/shipping-address/<token>`. The token is hashed (sha256) in `puramass_address_requests`; TTL is 30 days.

#### F. DeletePuramassOrdersDialog (admin)

- **Title:** "Delete N Stealth Health order(s)".
- **Text:** "You are about to remove **N hand-off ledger record(s)**. This is the reconciliation record of the Stealth Health hosted-checkout hand-off."
- **Preview:** up to 6 rows (email or "Guest", reference), then "+N more…".
- **If any rows have an invoice:**
  - Amber: "{All|N of these} order(s) have a materialised customer invoice (P paid). By default that invoice is kept — the customer keeps seeing the order in their account and it stays in the fulfillment queue."
  - Red checkbox "Also delete the linked customer invoice(s) (N)" — "Removes the order from the customer's account and the fulfillment queue, along with its line items. This cannot be undone."
- **Otherwise:** "None of these have a materialised customer invoice, so nothing on the customer's account or the fulfillment queue is affected."
- **Buttons:** "Cancel" and the red "Delete order(s)" (or "Delete order(s) + invoice(s)"). Shows "Deleting…" while running. Errors appear inline and keep the dialog open.
- **API:** `DELETE /api/admin/puramass/orders` with `{ ids, cascadeInvoice }`.
- **Toasts:** "Deleted N order(s) and M invoice(s)." / "Deleted N order(s)." The `warning` text is shown as an error toast.

#### G. SKU sync and cleanup

These run from Settings → Stealth Health Checkout (§7b). Matching (`matchProductToPuramass` in `lib/payments/puramass-catalog.ts`):
- Uses the live catalogue (`fetchPuramassCatalog`), falling back to `PURAMASS_CATALOG_SNAPSHOT`.
- Only SKUs prefixed `vyta-` are considered.
- `…-vial` SKUs map to `puramass_sku_vial`; all others to `puramass_sku`.
- Only `exact`/`matched` results are written. Existing values are skipped unless `overwrite`.

#### H. Legacy storefront orders (`/admin/orders`, hidden from the nav)

**List page** (`app/(admin)/admin/orders/page.tsx`). Data comes from the client via `getAllOrders()`: `supabase.from('orders').select('*, customers(email, first_name, last_name)')`.
- **Search:** "Search orders, customers..." (order number, name, email).
- **Status select:** All Statuses / Pending / Paid / Processing / Shipped / Delivered / Cancelled.
- **Summary line:** "N orders · N pending · N paid".
- **Columns:** (checkbox), Order, Customer, Total, Status, Shipment, Time, Actions. Rows are grouped by day, and clicking a group header selects that whole day.
- **Shipment column:**
  - "Print Label" or "Buy & Print Label"
  - "No shipment" / "Auto-create failed" / "Create Shipment"
  - tracking link
- **Actions:**
  - Status `<select>` (admin; values pending/paid/processing/shipped/delivered/cancelled). Sends `PATCH /api/admin/orders/{id}` with `{ status }`.
  - Eye → detail page.
  - "Generate invoice" (FileText; admin).
  - "Delete order" (admin): confirm "Delete N order(s)? This also removes any linked invoices and cannot be undone.", then `DELETE /api/admin/orders/{id}`.
- **Bulk actions:** Clear, "Create shipments", "Generate labels" (`BulkShipmentDialog`: "Create shipment records" / "Generate shipping labels", with eligible and skipped lists and reasons such as "Pickup order — no shipment needed", "Shipment already created", "Missing shipping address", "Missing postal code", "Missing country", "No shipment yet — create one first", "Label already purchased"), and "Delete selected".

**Detail page** (`/admin/orders/[id]`). Sections: Order Items, Payment Details (copy address / tx hash), Acquisition, Affiliate Commission, Customer, Shipping Address, Easyship Shipment, Tracking, Update Status, Email Customer.
- **Easyship Shipment:** "Courier" select (from `GET /api/admin/orders/{id}/rates`; "Easyship default (cheapest)") and "Create Shipment with Courier".
- **Tracking:** "Enter tracking number" input plus a Save button.
- **Update Status** select: Pending, Payment Received, Confirmed, Processing, Shipped, Delivered, Cancelled.
- **OrderConfirmationEmailCard** (target `{ orderId }`, `canSend = canEdit`).
- **Email Customer:** "Send Shipping Notification", disabled without a tracking number (note "Add tracking number to enable shipping email"); calls `POST /api/email`.

**New order** (`/admin/orders/new`). H1 "New Order".
- Customer select ("— Walk-in / Offline Customer —").
- Order Items via a variant picker ("Search products...").
- Shipping and Billing address (with a same-as toggle).
- Customer Notes and Staff Notes (internal).
- Shipping Method (placeholder "e.g. Canada Post Xpresspost"), Tax Rate (%), Shipping Cost ($).
- Submit → `POST /api/admin/orders`.

#### I. Dashboard widgets (`/admin`, `app/(admin)/admin/page.tsx`)

- **Header:** H1 "Dashboard", subtitle "Today's snapshot and anything that needs your attention."
- **`FulfillmentAlerts`:** a live banner read from `invoices`; it hides itself when there is nothing to show.
- **KPI cards** from `getAdminStats()`, which reads the **legacy `orders` table only**, not `puramass_orders`:
  - Revenue = Σ `orders.total`
  - Pending = count of status in pending, received or confirmed
  - Affiliates
  - Owed (pending commissions)
- **`EarningsByChannel`** (compact).
- **Restock needed.**
- **Shipment failures:** per-row Retry calls `createOrderShipment` → `POST /api/admin/orders/{id}/create-shipment`.
- **Recent Orders:** 8 rows from `orders`, with status dots and "View All" → `/admin/orders`.
- **Recent invoices:** 6 rows; "View All" → `/admin/invoices`.
- **Guides.**

#### J. `PuramassInvoiceBlocks` (`components/admin/PuramassInvoiceBlocks.tsx`)

Used on `/admin/invoices` and `/admin/invoices/[id]`.
- **`InvoiceSourceBadge`:** a teal Stealth Health chip, keyed on `invoices.source`. Tooltip: "Placed through the Stealth Health hosted checkout. Payment, taxes and the shipping address are collected by the partner and reported back to us." Other invoices read "Raised in this admin — customer, pricing and shipping were entered here."
- **`PuramassShipTo` / `PuramassShipToPanel`:** "Ship To" with a "via Stealth Health" tag. Each address shows its source, plus "Asked {ago}".
- **`PuramassOrderPanel`:** "Stealth Health Order", status badge.
  - Rows: Transaction (copy), Our reference (copy), Goods charged, Paid, Link expires, Placed.
  - "Refunded by Stealth Health" with a list of refunds.
  - "Stealth Health SKUs" list.
  - Links: "Stealth Health transaction" (`payment_link`) and "Stealth Health Orders" (`/admin/stealth-health?tab=orders`).
  - The panel is read-only.
- **`InvoiceTotalAmount`:** shows the goods amount (ledger currency) and the USD shipment fee separately, never summed across currencies.

The invoice detail page also shows `OrderConfirmationEmailCard` and `AdminPaidAlertEmailCard`.

---

### Admin — Confirmation email & other checkout-related admin tools

#### `OrderConfirmationEmailCard` (`components/admin/OrderConfirmationEmailCard.tsx`)

- **Targets:** `{ orderId } | { invoiceId } | { puramassOrderId }`.
- **Used on:** `/admin/invoices/[id]`, `/admin/orders/[id]` and `components/admin/OrderManagementPanel.tsx`. The compact `OrderConfirmationCell` is used on `/admin/customers/[id]`.
- **Load:** `GET /api/admin/confirmation-email?{target}`. If `applicable: false` (a manual invoice with no order), the card renders nothing.
- **Card:** white card, Mail icon, H3 "Order confirmation email".
  - Loading: "Checking…".
  - **Sent** (emerald box): "Sent[ N times]" / "Last {Mon D, YYYY h:mm} to **{email}** · by {who} | automatically on payment".
  - **Not sent** (amber box): "Not sent" / "This customer hasn't been sent an order confirmation."
  - **Failure:** "Last attempt failed: {error}" (red).
- **Button** (`canSend`, typically `canEdit`): "Send order confirmation" or "Resend order confirmation" (`bg-teal/10 border-teal/20`).
  - Disabled when `blockedReason` is set; the caption below shows `blockedReason` or "Goes to {recipient}".
  - Blocked reasons: "Not paid yet — the confirmation goes out once the order is paid." / "Mark the invoice paid first — this email tells the customer their payment was received." / a no-email reason.
  - If already sent, asks to confirm the resend.
  - Sends `POST` with the target (30 s timeout).
  - Toast `Order confirmation (re)sent to X.`
- **"Show/Hide send history (N)":** rows with ✓/✗, date, `to_email`, and `sent_by_email` or "automatic"; failed rows show their error.
- **Storage:** sends and history are logged in `fulfillment_email_log` (`lib/order-confirmation.ts`).

#### Admin paid-alert email (`components/admin/AdminPaidAlertEmailCard.tsx`, on `/admin/invoices/[id]`)

- **Card:** H3 "Admin notification email", showing "Not sent" or the sent state.
- **Button:** "Send admin notification" / "Resend admin notification". If already sent, asks "The admin notification has already gone out {times}. Send it again?".
- **Recipients:** the Admin Email Notifications list.
- **API:** `GET` and `POST /api/admin/paid-alert-email`.

#### Other tools

These are all covered in earlier sections:
- Recovery and outreach emails (§C, §D)
- Address requests (§E)
- Shipping diagnostics and Klaviyo test (Settings §8 and §9)
- Error log (`/admin/settings/error-log`)

---

### Admin — API routes

Conventions:
- **Auth:** "Bearer" means the `Authorization: Bearer <supabase access token>` header, resolved to `customers.role`.
- **Errors:** responses are JSON `{ error }` unless noted.

#### GET /api/admin/settings
- **Auth:** **none** (public). It is also read by the storefront: cart, checkout, `PromosContext` and recommendations.
- **DB:** `site_settings.select('*').limit(1).maybeSingle()`.
- **Response:** `{ settings }`. Fields and defaults:
  - `id`
  - `checkout_type` ('email' \| 'crypto')
  - `admin_emails[]`
  - `invoice_cc_emails[]`
  - `invoice_customer_email_subject|body`, `invoice_admin_email_subject|body` (defaults from `lib/invoice-email-templates.ts`)
  - `pickup_address` ('')
  - `guest_checkout_enabled` (true)
  - `puramass_checkout_enabled` (always true)
  - `puramass_shipping_rates_enabled` (false)
  - `puramass_flat_shipping` (35)
  - `puramass_free_shipping_enabled` (folded: rates && enabled && threshold>0)
  - `puramass_free_shipping_threshold` (0)
  - `puramass_free_shipping_active`
  - `puramass_configured` (env)
  - `ad_discount_enabled` / `ad_discount_percent` (25) / `ad_discount_active`
  - `cart_offer_enabled` / `cart_offer_min_items` (2) / `cart_offer_percent` (10) / `cart_offer_ends_at` / `cart_offer_active`
  - `cart_fbt_enabled`, `cart_similar_enabled`, `checkout_addons_enabled`, `cart_trust_strip_enabled`, `checkout_verify_notice_enabled` (all true)
  - six `product_*_enabled` flags (true)
  - `easyship_enabled` (false)
  - `easyship_api_key_set`
  - `shipping_origin` ({})
  - `shipping_box` ({})
  - `shipping_item_weight_kg` (0.05)
  - `shipping_flat_rate` (20)
  - `shipping_handling_fee_type` ('flat')
  - `shipping_handling_fee_value` (0)
  - `klaviyo_enabled`, `klaviyo_private_key_set`, `klaviyo_private_key_source`, `klaviyo_public_key`, `klaviyo_list_id`, `klaviyo_onsite_enabled`, `klaviyo_server_events_enabled`, `klaviyo_sync_signups`
  - `registration_alert_enabled` (true)
  - `abandoned_registration_enabled` (true)
  - `abandoned_registration_hours` (12)
  - `abandoned_checkout_hours` (1)
  - `created_at`, `updated_at`
- **Never returned:** API keys.

#### PUT /api/admin/settings
- **Auth:** Bearer, **admin only**. Assistant and analytics are refused. Error: `403 Unauthorized`.
- **Body:** any subset of the writable keys. Invalid JSON → `400 Invalid JSON`.
- **Validation (verbatim errors):**
  - "checkout_type must be email or crypto"
  - `Invalid email: <x>` / "Expected a list of emails"
  - Booleans are coerced with `Boolean()`: guest_checkout_enabled, easyship_enabled, registration_alert_enabled, abandoned_registration_enabled, puramass_shipping_rates_enabled, puramass_free_shipping_enabled, ad_discount_enabled, cart_offer_enabled, cart_fbt_enabled, cart_similar_enabled, checkout_addons_enabled, cart_trust_strip_enabled, checkout_verify_notice_enabled, the six product_* flags, klaviyo_enabled, klaviyo_onsite_enabled, klaviyo_server_events_enabled, klaviyo_sync_signups.
  - `Klaviyo public key / Site ID looks invalid: <v>`, `Klaviyo list ID looks invalid: <v>`
  - `Klaviyo private API key should start with "pk_" (Klaviyo → Settings → API keys).`
  - "ad_discount_percent must be a number between 0 and 99 — the hosted checkout cannot be sent a zero line price."
  - "cart_offer_percent must be a number between 0 and 99 — the hosted checkout cannot be sent a zero line price."
  - "cart_offer_min_items must be a whole number of items (>= 1)"
  - "cart_offer_ends_at must be a date/time, or empty for no end date" (an empty value stores null)
  - "abandoned_registration_hours must be a whole number of hours (>= 1)"
  - "abandoned_checkout_hours must be a whole number of hours between 1 and 720"
  - Strings stored as given: invoice_* templates, pickup_address.
  - `shipping_origin` and `shipping_box` are coerced; `shipping_handling_fee_type` is 'pct' or 'flat'.
  - `<key> must be a non-negative number`, for shipping_item_weight_kg, shipping_flat_rate, shipping_handling_fee_value, puramass_flat_shipping, puramass_free_shipping_threshold.
  - `easyship_api_key` and `klaviyo_private_api_key` are written only when non-empty; a single space clears them.
- **DB:** updates the existing singleton, or inserts `{checkout_type:'crypto', admin_emails:[], …updates}`. Any `product_*` change triggers `revalidatePath('/products/[slug]','page')`.
- **Response:** `{ success: true, settings }`. On DB error, `500 { error: message }`.

#### GET /api/admin/marketing
- **Auth:** Bearer, with `canViewAnalytics` (admin, assistant, analytics).
- **Response:** `{ config: SiteConfig }`.

#### PUT /api/admin/marketing
- **Auth:** `canManageMarketing` (admin, analytics).
- **Body:** store_name, store_tagline, logo_url, favicon_url, hero_video_url, hero_image_url (trimmed; empty → null); gtm_container_id; ga4_measurement_id; meta_pixel_id; tracking_consent_required.
- **Errors:** "GTM Container ID should look like GTM-XXXXXXX", "GA4 Measurement ID should look like G-XXXXXXXXXX", "No editable fields provided".
- **DB:** upserts `site_settings`. Audit action `marketing.update`.
- **Response:** `{ success, config }`.

#### GET /api/admin/product-recommendations
- **Auth:** `canAccessAdminPage(role,'/admin/cart-upsells')` (admin, assistant).
- **Response:** `{ recommendations, products, warning? }`.

#### PUT /api/admin/product-recommendations
- **Auth:** `canEdit` (admin).
- **Body:** `{ productId, items:[{ recommendedProductId (or recommended_product_id), badge? }] }`.
- **Cleaning:** drops self-references and duplicates, keeps at most 6, truncates badges to 24 characters.
- **Errors:** "productId is required" / "items must be an array" (400); "Unknown product" (404); "One of those products no longer exists — reload and try again." (409); the migration hint (409) or the DB message (500).
- **DB:** deletes all rows for the product, then inserts `{product_id, recommended_product_id, badge, sort_order: index, enabled: true}`. Audit action `product_recommendations.update`.
- **Response:** `{ recommendations }` for that product.

#### DELETE /api/admin/product-recommendations?productId=
- **Auth:** admin.
- **Effect:** clears that product's list. Audit action `product_recommendations.clear`.
- **Response:** `{ success: true }`.

#### GET /api/admin/discount-codes[?affiliate_id=]
- **Auth:** `resolveStaffCaller(allowAssistant)`.
- **Response:** `{ codes: AdminDiscountCode[] }`, or `{ codes: [], migrationNeeded: true }` when the table is missing (42P01). Other failures: 500 "Could not load discount codes".

#### POST /api/admin/discount-codes
- **Auth:** admin (`resolveStaffCaller`).
- **Body:** `{ code, affiliate_id, discount_type, discount_value, commission_rate, min_subtotal, max_uses, starts_at, expires_at, active, notes, first_order_only?, excluded_product_ids? }`.
- **Validation:** see the Discount codes section. Also "Affiliate not found" (404).
- **Errors:** `{CODE} is already in use.` (409); `RESTRICTIONS_NEED_MIGRATION` (400); "Could not create the code" (500).
- **DB:** inserts into `discount_codes` with `created_by`. Audit action `discount_code.create`.
- **Response:** `201 { code }`.

#### PATCH /api/admin/discount-codes/[id]
- **Auth:** admin.
- **Body:** either `{ active: bool }` alone, or a full payload validated like a create.
- **Errors:** "That code is already in use." (409); "Code not found" (404); "Could not update the code" (500).
- **DB:** updates the row and `updated_at`. Audit action `discount_code.update`.
- **Response:** `{ code }`.

#### DELETE /api/admin/discount-codes/[id]
- **Auth:** admin.
- **Refusal:** if any `puramass_orders` or `commissions` reference the code: 409 "This code has been used, so its history is kept. Deactivate it instead."
- **Audit:** `discount_code.delete`.
- **Response:** `{ deleted: true }`.

#### GET /api/admin/landing-pages[?days=]
- **Auth:** staff (admin or assistant).
- **Response:** `{ landingPages, countersMissing }`, or `{ landingPages: [], migrationNeeded: true }`.

#### POST /api/admin/landing-pages
- **Auth:** admin.
- **Body:** `{ name, slug, domain, destination_path, active, notes, offer: { code, percent, first_order_only, excluded_product_ids, starts_at, expires_at, max_uses } | null }`.
- **Validation errors:**
  - "The slug is 2–40 lower-case letters, numbers or dashes, e.g. \"standards\"."
  - "Give the landing page a name."
  - "That domain does not look right, e.g. \"getvyta.ca\"."
  - "The destination is a path on this site, e.g. \"/products\"."
  - "Enter the percentage the landing page offers."
  - All discount-code rules.
  - The migration message "Run landing-pages-migration.sql in the Supabase SQL editor to enable landing pages."
  - `{code} is already used by another discount code.` (409)
  - `The slug "x" is already in use.` (409)
- **DB:** creates the `discount_codes` row first (notes `Offer for the "slug" landing page.`), then the `landing_pages` row; the code is rolled back if the page insert fails. Audit action `landing_page.create`.
- **Response:** `201 { landingPage }`.

#### PATCH /api/admin/landing-pages/[id]
- **Auth:** admin.
- **Body:** `{ active }` alone, or a full payload. A full payload edits or creates the code in place (forcing `discount_type='percent', active=true`). A null offer deactivates the existing code.
- **Errors:** "Landing page not found" (404).
- **Response:** `{ ok: true }`.

#### DELETE /api/admin/landing-pages/[id]
- **Auth:** admin.
- **Refusal:** if any `puramass_orders.landing_page = slug`: 409 "Orders came through this landing page, so its history is kept. Switch it off instead."
- **Code handling:** the code is deleted when unused, otherwise deactivated.
- **Response:** `{ deleted: true }`.

#### GET /api/admin/puramass/orders
- **Auth:** Bearer, admin or assistant. Error `403 Unauthorized`.
- **Query:** `page` (0-based), `pageSize` (1–100, default 25), `status` (comma list), `abandoned=1`, `q` (≤120 characters).
- **DB:** `puramass_orders` with `count: 'exact'`, ordered by `created_at desc`. The column ladder steps down when address or recovery columns are missing.
  - Core columns: `id, partner_reference, transaction_id, payment_link, status, subtotal_cents, customer_id, customer_email, items, referral_code, paid_at, currency, created_at, updated_at, invoice_id`.
  - Address columns: `customer_name, customer_phone, shipping_address, shipping_address_source, shipping_address_updated_at, address_requested_at`.
  - Recovery columns: `recovery_email_sent_at, recovery_email_count, recovery_promo_code, recovery_discount_type, recovery_discount_value`.
  - Joins `invoices` (id, invoice_number, customer_id, customer_email, status, fulfillment_status, fulfillment_type, due_date, packed_at, fulfilled_at, currency, subtotal, shipping_cost, total, created_at), confirmation summaries, and the referral-code → affiliate lookup.
- **Response:** `{ orders, total, page, pageSize, addressesAvailable, recoveryAvailable, abandonedHours, counts: { all, payment_pending, paid, expired, cancelled, abandoned } }`. The counts honour the search.
- **Error:** `500 "Could not load orders: <msg>"`.

#### DELETE /api/admin/puramass/orders
- **Auth:** admin only.
- **Body:** `{ ids: string[], cascadeInvoice?: boolean }`.
- **Errors:** "Invalid JSON body" / "ids[] is required." (400); "No matching orders found." (404); "Could not load the orders to delete." / "Could not delete the orders." (500).
- **DB:** deletes the `puramass_orders` rows. When `cascadeInvoice` is set, also deletes the linked `invoices`; a failure there is returned as `warning: "Orders deleted, but linked invoice cleanup failed: …"`.
- **Audit:** `puramass.order_delete` or `puramass.order_delete_cascade`, per id.
- **Response:** `{ ok, deleted, linkedInvoices, invoicesDeleted, warning? }`.

#### POST /api/admin/puramass/orders/refresh
- **Auth:** admin or assistant.
- **Errors:** "Stealth Health is not configured." (503); "transaction_id is required." (400); partner 4xx → the partner's detail with the same status; other failures → 502 "Could not reach Stealth Health."
- **Body:** `{ transaction_id }`.
- **Partner call:** `fetchPuramassOrderStatus`.
- **DB update:** status, currency, subtotal_cents, paid_at (when paid), the contact/address patch (never clears existing values), and expires_at, refunds and items (`buildPuramassOrderDetailPatch`). Falls back to fewer columns if they are missing. When paid, it calls `materializeStealthHealthFulfillment`, which creates the invoice (idempotent).
- **Errors after update:** 404 "No matching order found."; 500 "Could not update the order: …".
- **Response:** `{ success, status, order }`.

#### POST /api/admin/puramass/orders/sync
- **Auth:** admin or assistant. Returns 503 if Puramass is not configured.
- **Body** (optional): `{ ids?, statuses?, limit? }`. Only rows with a transaction id are considered.
- **Limits:** at most 250 rows, 6 concurrent partner reads, and the run stops on a 429.
- **Processing:** each row goes through `applyPuramassStatus` (the same function the cron uses).
- **Response:** `{ total, polled, changed, paid, addresses, errors, rate_limited }`.

#### GET /api/admin/puramass/orders/recover?id=
- **Auth:** admin or assistant.
- **Errors:** "id is required." (400); "No matching order found." (404).
- **Response:** `{ order: { id, reference, status, payment_link, customer_email, customer_name, created_at, recoverable }, firstName, cart, checkoutNote, senderName, recovery: { recovery_email_sent_at, recovery_email_count, recovery_promo_code, recovery_discount_type, recovery_discount_value } }`.

#### POST /api/admin/puramass/orders/recover
- **Auth:** admin or assistant. Runtime is nodejs (nodemailer).
- **Body:** `{ id, subject, body, templateKey?, email?, cc?, promoCode?, discountType?: 'percentage'|'fixed', discountValue?, promoDetails?, promoExpires?, includeCart? }`.
- **Errors (verbatim):**
  - "id is required."
  - "A subject is required."
  - "The message body is empty."
  - "Unknown template"
  - 404 "No matching order found."
  - 409 "This checkout was paid — there is nothing to recover." / "A {status} order cannot be recovered."
  - "That email address is not valid."
  - "This hand-off has no customer email — there is nobody to email."
  - `Not a valid email address: …` (field cc)
  - "You can copy at most 5 people on one email."
  - "The discount must be a positive amount, and a percentage cannot be more than 100." (field discount)
  - "Add the promo code the discount belongs to, or describe the offer, so the customer knows how to claim it." (field promoCode)
  - 502 `The recovery email could not be sent: …`
- **DB:** inserts into `customer_emails` (success or failure). After a successful send it stamps `puramass_orders.recovery_email_sent_at`, `recovery_email_count+1`, `recovery_promo_code`, `recovery_discount_type` and `recovery_discount_value`. Audit action `puramass.recovery_email_sent`.
- **Response:** `{ ok, to, cc, subject, sent_at, attempt, promo_code, discount, recorded, logged }`.

#### POST /api/admin/puramass/orders/request-address
- **Auth:** admin or assistant.
- **Body:** `{ id, email?, cc?, note? }` (note ≤500 characters).
- **Errors:**
  - "id is required."
  - 404 "No matching order found."
  - "That email address is not valid."
  - "This order has no customer email — there is nobody to ask."
  - cc errors (max 5): "You can copy at most 5 people on one request."
  - 500 `Could not create the address request: … If this mentions a missing table, run puramass-missing-address-migration.sql.`
  - 502 `The address request could not be emailed: …` (includes `link`)
- **DB:** upserts `puramass_address_requests` (token hash, email, expires_at +30d); one live link per order is reused. Stamps `sent_at` / `sent_count` / `sent_by` and `puramass_orders.address_requested_at`. Audit action `puramass.address_request_sent`.
- **Response:** `{ success, email, cc, link, reused, sent_at, expires_at, had_address }`.

#### POST /api/admin/puramass/sync-skus
- **Auth:** admin only.
- **Body:** `{ overwrite?, dryRun? }`.
- **Response:** `{ source: 'live'|'snapshot', catalog_count, partner_catalog_count, dry_run, vial_column_available, counts: { updated, skipped_already_set, ambiguous, unmatched }, by_mapping: { box, vial }, updated[], skipped_already_set[], ambiguous[{id,name,mapping,candidates}], unmatched[] }`.
- **DB:** writes `products.puramass_sku` and `puramass_sku_vial` (active products only). Audit action `puramass.sync_skus`.
- **Error:** 500 "Could not load products."

#### POST /api/admin/puramass/cleanup-skus
- **Auth:** admin only.
- **Body:** `{ dryRun? }`.
- **Effect:** nulls any mapping whose value does not start with `vyta-`.
- **Response:** `{ dry_run, vial_column_available, cleared_products, cleared_box, cleared_vial, cleared_values, products: names[] }`. Audit action `puramass.cleanup_skus`.

#### GET /api/admin/confirmation-email?orderId|invoiceId|puramassOrderId=
- **Auth:** admin or assistant.
- **Error:** 400 "Pass orderId, invoiceId or puramassOrderId." (the id must be a UUID).
- **Response:** `{ applicable: false }` or `{ applicable: true, kind: 'storefront'|'stealth_health'|'manual', summary: { sendCount, lastSentAt, lastSentTo, lastSentBy, lastAttemptFailed, lastError }, history[], recipient, orderNumber, blockedReason }`.

#### POST /api/admin/confirmation-email
- **Auth:** **admin only**. Assistants can read but not send.
- **Body:** `{ orderId } | { invoiceId } | { puramassOrderId }`.
- **Errors:** 404 "No order or invoice found for this." / "Invoice not found." / "Order not found."; 422 "Mark the invoice paid first…" / "This order isn’t paid yet — the confirmation goes out once it’s paid." / a no-email reason; 502 on mail failure.
- **DB:** logs to `fulfillment_email_log`. Audit action `order.confirmation_email_sent`.
- **Response:** `{ success, to, sent_at }`.

#### GET /api/admin/paid-alert-email?invoiceId= / POST /api/admin/paid-alert-email
- **GET auth:** admin or assistant.
- **POST:** admin only; body `{ invoiceId }`; audit action `invoice.admin_paid_alert_sent`.
- **Errors:** "Pass invoiceId."

#### GET /api/admin/customers/outreach and POST /api/admin/customers/outreach
- **Auth:** CRM actor (admin or assistant, per its comment).
- **GET:** `?ids=` (resolve), `?q=&abandoned=&exclude=` (search, ≤50 candidates), `?history=1`.
- **POST body:** `{ templateKey, subject, body, promoCode, promoDetails, promoExpires, cc, discountType, discountValue, attachCheckout, recipients: ids[], suppress? }`.
- **Errors:** "A subject is required." / "The message body is empty." / "Unknown template" / "Pick at least one recipient." / "One send can address at most 40 customers. Send this batch, then pick the rest." / `Not a valid CC address: …` / "Too many CC addresses (max 10)." / discount errors as in recover / 404 "None of those recipients could be found."
- **Response:** `{ ok, sent, failed, withCart, logged, unresolved, skipped, results, cc }`. Status is 200 if anything was sent, otherwise 502 with an error.

#### GET /api/admin/shipping/diagnose
- **Auth:** admin or assistant.
- **Response:** `{ ok, base_url, db_read_ok, settings_row_present, easyship_columns_present, enabled, has_api_key, origin_complete, reachable, webhook_secret_set, errors[] }`.

#### POST /api/admin/klaviyo/test and POST /api/admin/klaviyo/sync-customers
- **Auth:** admin only.
- **sync-customers errors:** "Save a Klaviyo private API key first." / "Choose a newsletter list first."

#### GET /api/admin/orders and POST /api/admin/orders (legacy)
- **GET:** admin or assistant. Filters `status, search, date_from, date_to, customer_id`. Returns `{ orders }` with customer_name, customer_email and customer_phone.
- **POST:** admin only. Body `{ customer_id, billing_address, shipping_address, shipping_method, notes, staff_notes, items[{product_variant_id, sku_snapshot, name_snapshot, qty, unit_price, discount_pct}], tax_total, shipping_cost, discount_total }`.
  - Error: "At least one order item is required".
  - Creates `orders` (number `ORD-YYMM-#####`, status pending) and `order_items`, then a draft invoice and an Easyship shipment (forced).
  - Response: `201 { order }`.

#### GET/PATCH/DELETE /api/admin/orders/[id] (legacy)
- **GET:** admin or assistant.
- **PATCH:** admin only.
  - Body: `{ status?, billing_address, shipping_address, notes, staff_notes, shipping_method, shipping_carrier, tracking_number }`.
  - Error 422 "Order can only be edited while pending or confirmed".
  - Status `confirmed`: runs an oversell guard (422 `Insufficient stock to confirm: "X" has N on hand but the order needs M. Restock or create a backorder first.`, code `insufficient_stock`), decrements stock, creates the invoice, sets `customers.has_completed_first_order=true`, and sends the confirmation email once.
  - `cancelled` / `refunded`: restores stock.
  - `packed` / `shipped` / `delivered` / `refunded`: set the matching timestamps.
  - Sends a Klaviyo status event.
- **DELETE:** admin only. Deletes linked invoices, commissions, crypto_transactions, shipment_auto_logs, sol_addresses and order_items, then the order. Audit action `order.delete`.

#### Other legacy order routes
- **POST /api/admin/orders/[id]/refund:** admin. Body `{ full_refund, line_items[{order_item_id, qty, restock}], reason }`. Error 422 `Cannot refund order with status "x"`.
- **create-shipment / buy-label:** admin.
- **rates / label-readiness / report:** admin or assistant.
- **label:** admin, assistant or warehouse.
- **shipping-address PATCH:** admin or assistant.

#### Price lists and overrides (they set the catalogue prices checkout charges)
- **`GET/POST /api/admin/pricelists`:** GET admin or assistant; POST admin. Error "Pricelist name is required"; a new list is seeded from products.
- **`GET/PATCH/DELETE /api/admin/pricelists/[id]`:** PATCH `{ name, is_active, items }`. Setting `is_active: true` deactivates every other list.
- **`POST /api/admin/pricelists/[id]/apply-to-customer`:** admin. Body `{ customer_id, mode: 'override'|'keep_existing' }`. Upserts into `customer_price_overrides` and stamps `customers.applied_pricelist_id`. Response `{ applied, skipped, mode, … }`.
- **`GET /api/admin/price-overrides`:** admin, assistant or affiliate. Filters `?customer_id` / `?product_id`.
- **`POST /api/admin/price-overrides`:** admin or affiliate (own customers only). Upserts `{ customer_id, product_id, override_price }`. Errors: "customer_id and product_id are required", "override_price must be a non-negative number", "You can only price your own customers".
- **`DELETE /api/admin/price-overrides?id=`** or by `(customer_id, product_id)`.
- **`/api/admin/price-overrides/import`:** GET returns the template; POST takes a multipart file plus `customer_id`.
- **Checkout effect:** `/api/checkout/puramass` prices each line with `resolvePriceMap` (`lib/pricing/resolve.ts`): `customer_price_overrides.override_price` → active `pricelist_items.price` → `products.price`. An override or pricelist price restates the per-vial price and drops the catalogue pack prices (`pack_options`). Promo discounts are then applied on top.
- **Pricing page:** `/admin/pricing`, H1 "Pricing", toggle between "Price Lists" and "Customer Pricing".

#### Stealth Health settlement routes
- **GET (`requireReader`, admin/assistant):** `summary`, `orders`, `invoices`, `invoices/[id]`, `payouts`, `partner-settlement`, `settings`.
- **Writes (`requireAdmin`):**
  - `PUT settings`. Errors: "partner_name cannot be empty", `Invalid email: …`, "commission_pct must be between 0 and 100", `<key> must be a non-negative number`, "Nothing to update", 409 "Run stealth-health-settlement-migration.sql before editing the terms."
  - `PATCH orders/[id]` with `{ settlement_excluded }`. Error 400 "This order is already on a settlement invoice — void that invoice first."
  - `POST invoices`. Errors: "period_start must be on or before period_end", "No unbilled paid orders in that period — nothing to invoice."
  - `PATCH` / `DELETE invoices/[id]`.
  - `POST payouts`. Errors: "amount must be greater than zero", "received_at must be YYYY-MM-DD".
  - `DELETE payouts/[id]`.
  - `POST partner-settlement`.

---

### Admin — UI layout notes

- **Shell:** `bg-surface` page; content is `max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 py-8`. On desktop the content is offset `lg:pl-64` (or `lg:pl-[76px]` when the sidebar is collapsed).
- **Page widths:** Settings and Promotions use `max-w-4xl space-y-6`. Cart Upsells, Discount Codes and Landing Pages are full width with `space-y-6`.
- **Design tokens** (Tailwind theme): `ink`, `ink-muted`, `ink-light`, `line`, `surface`, `teal`, `teal-dark`, `teal-light`, `ocean`.
  - Primary button: `bg-ink text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-ink/90 disabled:opacity-50`.
  - Secondary button: `bg-surface border border-line text-ink hover:border-teal/40`.
  - Stealth Health actions: `bg-teal-dark text-white hover:bg-ocean`.
  - Input: `px-4 py-2.5 bg-surface rounded-lg border border-line text-sm focus:ring-2 focus:ring-teal/40`.
- **Status colours:**
  - Emerald boxes: `bg-emerald-50 border-emerald-200 text-emerald-800`.
  - Amber warnings: `bg-amber-50 border-amber-200 text-amber-800`.
  - Red errors: `bg-red-50 border-red-200 text-red-700`.
  - Pills: `rounded-full px-2 py-0.5 text-[11px] font-medium`.
- **Tables:** `rounded-xl border border-line bg-white overflow-hidden` with an `overflow-x-auto` inner wrapper. Header row `bg-surface text-[11px]|text-xs uppercase tracking-wider text-ink-muted font-semibold`; body `divide-y divide-line/50`; cells `px-4|5 py-3|4`.
- **Modals:** `fixed inset-0 z-50 bg-black/50 (or /40) p-4`, with a panel `bg-white rounded-xl max-w-md|lg|xl|3xl max-h-[90vh] overflow-y-auto`. The header is `p-6 border-b` with an icon tile `w-10 h-10 rounded-lg bg-teal/10` and an X close button. Footer button pairs are `flex gap-3` using `flex-1`.
- **Toasts:** `useToast()` from `contexts/ToastContext`, with `toast.success` and `toast.error`.
- **Loading states:**
  - Settings: "Loading settings…"
  - Promotions: spinner with "Loading promotions…"
  - Cart Upsells: "Loading cart upsells…"
  - Stealth Health: "Loading Stealth Health settlement…"
  - Orders table: a "Loading…" row
- **Read-only pattern:** controls are rendered but `disabled` (`opacity-50`), and destructive or edit icons are hidden. The assistant role also sees the global read-only banner.

---

### Admin — unverified / porting notes

1. **Dead or legacy controls:**
   - `checkout_type` (Email Invoice / Cryptocurrency) and `pickup_address` are saved but no consumer was found in `app/`, `components/`, `contexts/` or `lib/`.
   - The info box still claims checkout-type changes are live.
   - Decide whether to port these. They are probably safe to omit.
2. **No hosted-checkout on/off switch.** `puramass_checkout_enabled` is hard-wired to `true`. The Promotions locks that depend on it (`adLocked` / `offerLocked`) only ever lock for read-only users, and the amber "hosted checkout is switched off" copy is unreachable.
3. **USD exchange rate is not editable.** The `site_settings.usd_exchange_rate` column exists, but `/api/admin/settings` neither returns nor accepts it. The Products page therefore always uses `DEFAULT_USD_RATE = 0.73`. There is no currency control in admin. Checkout currency comes from the Stealth Health ledger (`puramass_orders.currency`, displayed with fallback `usd`).
4. **Credential banner text** says "Set PURAMASS_API_KEY", but `isPuramassConfigured()` also requires `PURAMASS_PARTNER_ID`.
5. **Promotions percent input** allows up to 100 on the client for the ad discount, but the server caps it at 99. A value of 100 returns the server error.
6. **Dashboard KPIs** (Revenue, Pending) and "Recent Orders" read the **legacy `orders` table**, not `puramass_orders`. Hosted-checkout sales are not counted there. They appear on Stealth Health → Orders, on Invoices, and in `FulfillmentAlerts` (which reads invoices).
7. **`/admin/orders` is hidden from the nav** but still routable, and the Dashboard links to it. It manages legacy storefront orders (crypto/e-transfer era) and Easyship labels. Port it only if the sibling site still has a non-hosted order path.
8. **Not inspected in detail:**
   - `shapeKlaviyoSettings` defaults (`lib/klaviyo/settings.ts`)
   - `EditAffiliateModal` and the commission-rate editing flow
   - the full `CustomerOverridesView` and `PriceListsView` UIs (only their APIs are summarised)
   - the `ReconcileTab`, `InvoicesTab` and `PayoutsTab` internals
   - the `error-log` page
   - `CustomerOrderQuickview`'s data source (its comment says it uses the same `getOrderWithItems` path as `/account/orders/[id]`)
   - exact `noEmailReason` strings in `lib/order-confirmation.ts`
   - the `EASYSHIP_WEBHOOK_EVENTS` list
9. **Pricing page comments mention affiliates** ("Affiliates are forced to the overrides view"), but `canAccessAdminPage` blocks affiliates from `/admin`. That code path is presumably reused by the affiliate portal; not verified.
10. **Assistant permissions on Stealth Health Orders.** Assistants can sync, refresh, send recovery emails and send address requests: these customer-facing sends are allowed for assistants by the API. They cannot delete or send confirmation emails. Keep this split in a port.
11. **Promo codes in recovery emails are presentation only.** Codes are generated on the partner platform (`app.vytabio.com`) and only described in the email. They are separate from `discount_codes`, which apply on our hand-off.
12. **`GET /api/admin/settings` is public.** Partner commercial terms are deliberately stored in `stealth_health_settings` instead. Never add secrets to `site_settings` fields that `shape()` returns.
13. **Migrations referenced** (columns are read with `select('*')` and defensive fallbacks):
    - `puramass-hosted-shipping-migration.sql`
    - `cart-upsells-migration.sql`
    - `affiliate-discount-codes-payouts-migration.sql`
    - `landing-pages-migration.sql`
    - `landing-page-counters-migration.sql`
    - `puramass-shipping-address-migration.sql`
    - `abandoned-checkout-recovery-migration.sql`
    - `puramass-missing-address-migration.sql`
    - `stealth-health-settlement-migration.sql`
    - `gtm-ga4-tracking-migration.sql`
    - `marketing-branding-migration.sql`
    - `invoice-spec-integration-migration.sql`
14. **Hard-coded brand values to replace on a sibling site:**
    - "VYTA" strings
    - built-in GTM `GTM-M2J3D7SG`, GA4 `G-F44F1BB1QV` and Klaviyo `SY9j8v`
    - the SKU namespace prefix `vyta-`
    - `app.vytabio.com`
    - the column-preference localStorage key prefix `aminocan:`
    - the CC placeholder `colleague@aminocan.com`

---

## Part 6 — Database schema and migrations

Source repo: `thepuragroup-droid/vyta-rtl-x` at `main` `817e7cf` (2026-10-12). All SQL below is copied from the root-level `*.sql` migrations named in each block. Nothing has been rewritten. Where several migrations touch one object, the blocks appear in the order they must run, and the **final shape** is given as a table after them.

Conventions used in this section:

* **"Hosted checkout"** is the only live checkout. `POST /api/checkout/puramass` hands the cart to Puramass (shown in the UI as "Stealth Health"). It writes one `puramass_orders` row and one `invoices` row in status `pending_payment`, plus `invoice_line_items`.
* **"Legacy orders"** means the `orders` / `order_items` / `sol_addresses` tables from the retired crypto and e-Transfer checkout. `POST /api/orders` now returns **410 Gone**. The tables are still **read** by the first-order check, the tracking lookup (`GET /api/orders`), the order confirmation and recommendations, and the stock RPCs still target them. **A paid hosted sale never creates an `orders` row.** It appears as an `invoices` row with `source = 'stealth_health'`.
* All app access goes through the **service-role** client, which bypasses RLS. The browser never touches these tables directly.
* Every hosted-checkout writer tolerates missing columns: it retries without them on Postgres `42703` or PostgREST `PGRST204` (`lib/payments/puramass-columns.ts`). A missing column therefore loses data silently instead of throwing an error. Run every migration listed here.

---

### Schema — tables

#### 1. `puramass_orders` — hand-off ledger (one row per hosted-checkout hand-off) — **CORE**

Base table (`puramass-hosted-checkout-migration.sql`):

```sql
-- 1. Per-product PuraMass SKU mapping
ALTER TABLE products ADD COLUMN IF NOT EXISTS puramass_sku      VARCHAR(80);  -- 10-pack SKU
ALTER TABLE products ADD COLUMN IF NOT EXISTS puramass_sku_vial VARCHAR(80);  -- single-vial SKU
CREATE INDEX IF NOT EXISTS idx_products_puramass_sku
  ON products (puramass_sku) WHERE puramass_sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_puramass_sku_vial
  ON products (puramass_sku_vial) WHERE puramass_sku_vial IS NOT NULL;

-- 1b. Checkout add-on flag
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_checkout_addon BOOLEAN NOT NULL DEFAULT false;

-- 2. Admin toggle on the singleton site_settings row
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS puramass_checkout_enabled BOOLEAN NOT NULL DEFAULT false;

-- 3. Hand-off ledger
CREATE TABLE IF NOT EXISTS puramass_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_reference TEXT NOT NULL UNIQUE,       -- our id, echoed back; unique => safe retry
  transaction_id    TEXT,                       -- PuraMass id
  payment_link      TEXT,
  status            TEXT NOT NULL DEFAULT 'payment_pending',
  subtotal_cents    INTEGER,
  customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_email    TEXT,
  items             JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ sku, quantity }, …] sent to PuraMass
  referral_code     TEXT,                       -- captured for manual reconciliation
  paid_at           TIMESTAMPTZ,                -- set when status → paid
  currency          TEXT,                       -- e.g. 'usd'
  last_event_id     TEXT,                       -- last processed webhook event_id (dedupe)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS paid_at       TIMESTAMPTZ;
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS currency      TEXT;
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS last_event_id TEXT;

CREATE INDEX IF NOT EXISTS idx_puramass_orders_transaction
  ON puramass_orders (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_customer
  ON puramass_orders (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_created
  ON puramass_orders (created_at DESC);

CREATE OR REPLACE FUNCTION update_puramass_orders_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS puramass_orders_updated_at ON puramass_orders;
CREATE TRIGGER puramass_orders_updated_at
  BEFORE UPDATE ON puramass_orders
  FOR EACH ROW EXECUTE FUNCTION update_puramass_orders_updated_at();

ALTER TABLE puramass_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON puramass_orders;
CREATE POLICY "Service role full access" ON puramass_orders FOR ALL USING (true) WITH CHECK (true);

-- 4. Fulfillment-queue surfacing
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS invoice_id UUID;   -- NOTE: no FK
```

Later additive columns, in the order they should be applied:

```sql
-- puramass-shipping-address-migration.sql
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS shipping_address JSONB,
  ADD COLUMN IF NOT EXISTS customer_name    TEXT,
  ADD COLUMN IF NOT EXISTS customer_phone   TEXT;
NOTIFY pgrst, 'reload schema';

-- puramass-missing-address-migration.sql (part 1 — ledger columns)
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS shipping_address_source     TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS address_requested_at        TIMESTAMPTZ;
UPDATE puramass_orders
SET shipping_address_source = 'puramass'
WHERE shipping_address IS NOT NULL
  AND shipping_address_source IS NULL;

-- puramass-order-details-migration.sql
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS expires_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_total_cents  INTEGER,
  ADD COLUMN IF NOT EXISTS refunds               JSONB,
  ADD COLUMN IF NOT EXISTS paid_items            JSONB;
NOTIFY pgrst, 'reload schema';

-- puramass-hosted-shipping-migration.sql (ledger part; site_settings part is in §site_settings)
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS shipping_total_cents INTEGER;
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS shipping_courier TEXT;
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS shipping_courier_id TEXT;

-- marketing-attribution-migration.sql (puramass_orders part)
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS attribution_channel  TEXT,
  ADD COLUMN IF NOT EXISTS attribution_campaign TEXT,
  ADD COLUMN IF NOT EXISTS attribution          JSONB;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_attribution_channel
  ON puramass_orders (attribution_channel, created_at DESC)
  WHERE attribution_channel IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_email
  ON puramass_orders (lower(customer_email)) WHERE customer_email IS NOT NULL;

-- ad-discount-promo-migration.sql (puramass_orders part)
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS ad_discount_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS ad_discount_cents INTEGER;

-- cart-upsells-migration.sql (puramass_orders part)
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS cart_offer_percent   numeric(5,2),
  ADD COLUMN IF NOT EXISTS cart_offer_min_items integer;

-- affiliate-discount-codes-payouts-migration.sql (puramass_orders part; needs discount_codes)
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS discount_code_id UUID REFERENCES discount_codes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_code VARCHAR(32),
  ADD COLUMN IF NOT EXISTS discount_code_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS discount_code_cents INTEGER;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_discount_code
  ON puramass_orders (discount_code_id) WHERE discount_code_id IS NOT NULL;

-- landing-pages-migration.sql (puramass_orders part)
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS landing_page TEXT;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_landing_page
  ON puramass_orders (landing_page, created_at DESC) WHERE landing_page IS NOT NULL;

-- abandoned-checkout-recovery-migration.sql (puramass_orders part)
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS recovery_email_sent_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recovery_email_count    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_promo_code     TEXT,
  ADD COLUMN IF NOT EXISTS recovery_discount_type  TEXT,
  ADD COLUMN IF NOT EXISTS recovery_discount_value NUMERIC(10,2);
CREATE INDEX IF NOT EXISTS idx_puramass_orders_recovery_sent
  ON puramass_orders (recovery_email_sent_at DESC)
  WHERE recovery_email_sent_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_status_created
  ON puramass_orders (status, created_at DESC);

-- order-confirmation-email-migration.sql (puramass_orders part)
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS confirmation_email_sent_at TIMESTAMPTZ;

-- stealth-health-admin-paid-alert-migration.sql
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS admin_paid_alert_sent_at TIMESTAMPTZ;

-- stealth-health-settlement-migration.sql (partner settlement; needs stealth_health_invoices)
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS settlement_invoice_id UUID
    REFERENCES stealth_health_invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS settlement_excluded BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_settlement
  ON puramass_orders (settlement_invoice_id) WHERE settlement_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_unbilled
  ON puramass_orders (status, paid_at) WHERE settlement_invoice_id IS NULL;
```

The backfill `UPDATE`s in `order-confirmation-email-migration.sql` and `stealth-health-admin-paid-alert-migration.sql` (they stamp already-paid rows) are reproduced in the functions section.

**Final column list for `puramass_orders`, and who writes each column:**

| column | type / null / default | migration | written by |
|---|---|---|---|
| id | uuid PK default gen_random_uuid() | hosted-checkout | DB |
| partner_reference | text NOT NULL UNIQUE | hosted-checkout | checkout: `amc_${crypto.randomUUID()}` |
| transaction_id | text | hosted-checkout | checkout (from Puramass response); webhook fills it if missing |
| payment_link | text | hosted-checkout | checkout |
| status | text NOT NULL default 'payment_pending' (no CHECK) | hosted-checkout | checkout (`order.status \|\| 'payment_pending'`); webhook/poll mirror the remote status; poll sweep sets `'expired'` |
| subtotal_cents | integer | hosted-checkout | checkout (`order.subtotal_cents ?? null`, the Puramass figure); poll overwrites with remote `subtotal_cents` on flip |
| customer_id | uuid FK customers ON DELETE SET NULL | hosted-checkout | checkout (bearer token user id, else null) |
| customer_email | text | hosted-checkout | checkout; webhook/poll fill only if null |
| items | jsonb NOT NULL default '[]' | hosted-checkout | checkout (ledger line shape, see jsonb section) |
| referral_code | text | hosted-checkout | checkout (`body.referralCode`) |
| paid_at | timestamptz | hosted-checkout | webhook (`occurred_at` or now) / poll (`remote.paid_at` or now) |
| currency | text | hosted-checkout | checkout (`order.currency ?? 'cad'`), webhook/poll |
| last_event_id | text | hosted-checkout | webhook (dedupe key) |
| created_at / updated_at | timestamptz NOT NULL default now() | hosted-checkout | DB / trigger |
| invoice_id | uuid (**no FK**) | hosted-checkout | `createPendingStealthHealthInvoice` / `createPaidInvoice` (`.is('invoice_id', null)` guard) |
| shipping_address | jsonb | shipping-address | checkout (when an address was collected) / webhook / poll / address-request form |
| customer_name | text | shipping-address | checkout / webhook / poll |
| customer_phone | text | shipping-address | checkout / webhook / poll |
| shipping_address_source | text ('puramass'\|'customer') | missing-address | checkout writes `'customer'`; partner patches write `'puramass'` and never overwrite `'customer'` |
| shipping_address_updated_at | timestamptz | missing-address | same as above |
| address_requested_at | timestamptz | missing-address | admin address-request flow |
| expires_at | timestamptz | order-details | webhook / poll |
| refunded_total_cents | integer | order-details | webhook / poll |
| refunds | jsonb | order-details | webhook / poll (verbatim) |
| paid_items | jsonb | order-details | webhook / poll (priced lines) |
| shipping_total_cents | integer | hosted-shipping | checkout (`Math.round(rate.total_charge*100)`; 0 = free shipping) |
| shipping_courier | text | hosted-shipping | checkout (`"<courier_name> · <service_name>"` + `" (free shipping)"`), null for the flat fee |
| shipping_courier_id | text | hosted-shipping | checkout (Easyship courier_service_id), null for the flat fee |
| attribution_channel | text | marketing-attribution | checkout (first touch, else last); `attributeHostedPurchase` fills it on payment if null |
| attribution_campaign | text | marketing-attribution | same |
| attribution | jsonb | marketing-attribution | checkout |
| ad_discount_percent | numeric | ad-discount | checkout (only when a discount split landed: `usedAd ? percent : 0`) |
| ad_discount_cents | integer | ad-discount | checkout (`discount.discountCents` = the **whole** saving from all promos) |
| cart_offer_percent | numeric(5,2) | cart-upsells | checkout (null if the offer was not earned) |
| cart_offer_min_items | integer | cart-upsells | checkout |
| discount_code_id | uuid FK discount_codes ON DELETE SET NULL | affiliate-discount-codes-payouts | checkout (whenever a code was accepted, even if the split did not land) |
| discount_code | varchar(32) | same | checkout |
| discount_code_percent | numeric | same | checkout (`codeBeatsAd && discount ? percent : 0`) |
| discount_code_cents | integer | same | checkout (the code's own share) |
| landing_page | text | landing-pages | checkout (`landingPageOf(visitor)`) |
| recovery_email_sent_at / _count / _promo_code / _discount_type / _discount_value | see DDL | abandoned-checkout-recovery | admin recovery composer |
| confirmation_email_sent_at | timestamptz | order-confirmation-email | claim-then-send (NULL→now(), cleared on failure) |
| admin_paid_alert_sent_at | timestamptz | stealth-health-admin-paid-alert | claim-then-send |
| settlement_invoice_id / settlement_excluded | see DDL | stealth-health-settlement | partner-settlement admin (out of scope for checkout) |

How the checkout insert falls back (`app/api/checkout/puramass/route.ts`, step 12): it tries progressively smaller rows and drops a column group only on a missing-column error. The order is `base+attribution+address+shipping+discount+code+landing`, then without landing, then without code, then without discount, then without shipping, then without address, then without attribution, then `base`. Here `base` = `partner_reference, transaction_id, payment_link, status, currency, subtotal_cents, customer_id, customer_email, items, referral_code`.

Status values the code uses: `payment_pending` (default), `paid`, `expired`, `cancelled`. The terminal set is `['paid','expired','cancelled']`. There is no CHECK constraint, and any remote status string is mirrored as-is.

---

#### 2. `puramass_webhook_events` — webhook delivery log (`puramass-webhook-events-migration.sql`)

```sql
CREATE TABLE IF NOT EXISTS puramass_webhook_events (
  id                 BIGSERIAL PRIMARY KEY,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Copied out of the payload for filtering (NULL when absent/unparseable).
  event_id           TEXT,
  event_type         TEXT,
  partner_reference  TEXT,
  transaction_id     TEXT,
  status             TEXT,
  currency           TEXT,
  customer_email     TEXT,
  occurred_at        TIMESTAMPTZ,

  -- What arrived.
  signature_valid    BOOLEAN NOT NULL DEFAULT false,
  payload            JSONB,          -- parsed body; NULL if it did not parse
  raw_body           TEXT,           -- only kept when the body did not parse as JSON

  -- What we did with it.
  puramass_order_id  UUID REFERENCES puramass_orders(id) ON DELETE SET NULL,
  outcome            TEXT,           -- matched | unmatched | deduped | bad_signature | not_configured | unparseable | update_failed | error
  response_status    INTEGER,
  response_body      JSONB,
  error              TEXT
);

CREATE INDEX IF NOT EXISTS idx_puramass_webhook_events_received
  ON puramass_webhook_events (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_puramass_webhook_events_event
  ON puramass_webhook_events (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_webhook_events_partner_ref
  ON puramass_webhook_events (partner_reference) WHERE partner_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_webhook_events_transaction
  ON puramass_webhook_events (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_webhook_events_order
  ON puramass_webhook_events (puramass_order_id) WHERE puramass_order_id IS NOT NULL;

ALTER TABLE puramass_webhook_events ENABLE ROW LEVEL SECURITY;   -- zero policies = service role only

COMMENT ON TABLE puramass_webhook_events IS
  'One row per delivery to /api/webhooks/stealth-health: the payload PuraMass sent, whether its signature checked out, and the response we returned.';

NOTIFY pgrst, 'reload schema';
```

Purpose: every POST to `/api/webhooks/stealth-health` is logged here, including bad signatures and unparseable bodies. `buildWebhookEventRow` (`lib/payments/puramass-webhook-log.ts`) caps `raw_body` at 64 KiB and stores it only when the body did not parse. Retries of the same `event_id` each get their own row. The idempotency check is `puramass_orders.last_event_id`, not this table.

---

#### 3. `puramass_address_requests` — "we didn't catch your shipping address" tokens (`puramass-missing-address-migration.sql`, part 2)

```sql
CREATE TABLE IF NOT EXISTS puramass_address_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  puramass_order_id UUID NOT NULL REFERENCES puramass_orders(id) ON DELETE CASCADE,
  token_hash        TEXT NOT NULL UNIQUE,
  email             TEXT NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  sent_at           TIMESTAMPTZ,
  sent_count        INTEGER NOT NULL DEFAULT 0,
  sent_by           UUID,
  sent_by_email     TEXT,
  submitted_at      TIMESTAMPTZ,
  submitted_ip      TEXT,
  submitted_address JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_puramass_address_requests_order
  ON puramass_address_requests (puramass_order_id);
CREATE INDEX IF NOT EXISTS idx_puramass_address_requests_open
  ON puramass_address_requests (expires_at) WHERE submitted_at IS NULL;

CREATE OR REPLACE FUNCTION update_puramass_address_requests_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS puramass_address_requests_updated_at ON puramass_address_requests;
CREATE TRIGGER puramass_address_requests_updated_at
  BEFORE UPDATE ON puramass_address_requests
  FOR EACH ROW EXECUTE FUNCTION update_puramass_address_requests_updated_at();

ALTER TABLE puramass_address_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON puramass_address_requests;
CREATE POLICY "Service role full access" ON puramass_address_requests
  FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
```

Purpose: after payment. Only the SHA-256 hex of the emailed token is stored. The `/shipping-address/<token>` form writes `submitted_address` and copies it onto `puramass_orders.shipping_address` with `shipping_address_source='customer'`.

---

#### 4. `discount_codes` — checkout discount codes, optionally owned by an affiliate

`affiliate-discount-codes-payouts-migration.sql`, section 1:

```sql
CREATE TABLE IF NOT EXISTS discount_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stored normalised: uppercase A-Z / 0-9 only (normalizeDiscountCode).
  code            VARCHAR(32) NOT NULL UNIQUE,
  -- Who earns on it. NULL = a store promo with no affiliate.
  affiliate_id    UUID REFERENCES affiliates(id) ON DELETE SET NULL,
  discount_type   VARCHAR(10) NOT NULL DEFAULT 'percent'
                    CHECK (discount_type IN ('percent', 'fixed')),
  -- Percent (0-99) when discount_type = 'percent', CAD when 'fixed'.
  discount_value  NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
  -- Commission on orders using this code, as a percentage. NULL = the
  -- affiliate's own rate (affiliates.commission_rate, else the 10% default).
  commission_rate NUMERIC(5,2) CHECK (commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 100)),
  -- Goods subtotal (CAD, list price) the cart must reach. NULL/0 = none.
  min_subtotal    NUMERIC(10,2),
  -- Total paid orders allowed. NULL = unlimited.
  max_uses        INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  starts_at       TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  active          BOOLEAN NOT NULL DEFAULT true,
  notes           TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discount_codes_affiliate ON discount_codes (affiliate_id);

COMMENT ON TABLE discount_codes IS
  'Checkout discount codes. Optionally assigned to an affiliate, who then earns commission on every paid order that uses the code.';

ALTER TABLE discount_codes ENABLE ROW LEVEL SECURITY;   -- zero policies = service role only
```

`landing-pages-migration.sql`, section 1 (restrictions):

```sql
ALTER TABLE discount_codes
  ADD COLUMN IF NOT EXISTS first_order_only BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS excluded_product_ids UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN discount_codes.first_order_only IS
  'Refuse the code to a buyer who already has a paid or pending order (by customer id or email).';
COMMENT ON COLUMN discount_codes.excluded_product_ids IS
  'Products the code takes nothing off, e.g. bacteriostatic water. Empty = applies to the whole cart.';
```

How the code uses it (`lib/affiliate/discount-codes.ts`):

* Lookup is `select('*').eq('code', normalizeDiscountCode(input))`. Normalisation is `toUpperCase().replace(/[^A-Z0-9]/g,'')`, and the admin form accepts 3–32 characters.
* If the code has an `affiliate_id`, the code is refused when `affiliates.active === false`.
* Use count = `count(puramass_orders where discount_code_id = code.id and status in ['paid'])`. There is no `uses_count` column.
* `first_order_only` goes through `firstOrderStatus()`, which reads `customers.has_completed_first_order` (by id and by email), `puramass_orders` with status `paid` (by `customer_id` and by `customer_email` ilike), and `orders` (`status, payment_confirmed_at` by `email` ilike). Legacy completed statuses are `['confirmed','paid','processing','shipped','delivered','completed']`.
* A lookup that fails because the table is missing **fails closed**: no discount is applied.

---

#### 5. `landing_pages` + `landing_page_daily` (offer delivery to checkout)

`landing-pages-migration.sql`, section 2:

```sql
CREATE TABLE IF NOT EXISTS landing_pages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              VARCHAR(40) NOT NULL UNIQUE
                      CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name              TEXT NOT NULL,
  domain            TEXT,
  destination_path  TEXT NOT NULL DEFAULT '/products',
  discount_code_id  UUID REFERENCES discount_codes(id) ON DELETE SET NULL,
  active            BOOLEAN NOT NULL DEFAULT true,
  notes             TEXT,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_landing_pages_code ON landing_pages (discount_code_id);

ALTER TABLE landing_pages ENABLE ROW LEVEL SECURITY;   -- zero policies = service role only

-- 3. visitor_attribution landing columns
ALTER TABLE visitor_attribution
  ADD COLUMN IF NOT EXISTS first_landing_page TEXT,
  ADD COLUMN IF NOT EXISTS last_landing_page  TEXT;
CREATE INDEX IF NOT EXISTS idx_visitor_attr_first_lp
  ON visitor_attribution (first_landing_page) WHERE first_landing_page IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_visitor_attr_last_lp
  ON visitor_attribution (last_landing_page) WHERE last_landing_page IS NOT NULL;

-- 4. customers
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS attribution_landing_page TEXT;

-- 5. puramass_orders.landing_page  (shown in §1)
```

`landing-page-counters-migration.sql`:

```sql
CREATE TABLE IF NOT EXISTS landing_page_daily (
  slug      TEXT NOT NULL,
  day       DATE NOT NULL,
  views     INTEGER NOT NULL DEFAULT 0,
  arrivals  INTEGER NOT NULL DEFAULT 0,
  visitors  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, day)
);
ALTER TABLE landing_page_daily ENABLE ROW LEVEL SECURITY;
-- + landing_page_bump() (functions section)
CREATE INDEX IF NOT EXISTS idx_customers_attribution_landing_page
  ON customers (attribution_landing_page, created_at DESC)
  WHERE attribution_landing_page IS NOT NULL;
```

Purpose at checkout: when the buyer sends no code and has not declined the offer, `resolveLandingOffer(db, visitor.landingPage)` reads the landing page (`select('*')`) and then its `discount_codes` row. That code is applied server-side as a backstop.

---

#### 6. `commissions` — affiliate earnings per sale (final shape)

Original table (`supabase-schema.sql`; `database-schema-complete.sql` has the same table but with `order_id UUID REFERENCES orders(id)` and nullable):

```sql
CREATE TABLE IF NOT EXISTS commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id),                  -- database-schema-complete.sql form
  -- supabase-schema.sql form: order_id VARCHAR(255) NOT NULL
  referral_code_id UUID REFERENCES referral_codes(id),
  amount DECIMAL(10, 2) NOT NULL,
  order_total DECIMAL(10, 2) NOT NULL,
  commission_rate DECIMAL(5, 2) DEFAULT 10.00, -- 10% commission rate
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  paid_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT fk_affiliate_commission FOREIGN KEY (affiliate_id) REFERENCES affiliates(id),
  CONSTRAINT fk_referral_code FOREIGN KEY (referral_code_id) REFERENCES referral_codes(id)
);
CREATE INDEX IF NOT EXISTS idx_commissions_affiliate ON commissions(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_commissions_status ON commissions(status);
CREATE INDEX IF NOT EXISTS idx_commissions_order ON commissions(order_id);
```

`affiliate-commission-hosted-checkout-migration.sql`:

```sql
ALTER TABLE commissions
  ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE;

ALTER TABLE commissions
  ALTER COLUMN order_id DROP NOT NULL;

ALTER TABLE commissions
  DROP CONSTRAINT IF EXISTS commissions_one_source;
ALTER TABLE commissions
  ADD CONSTRAINT commissions_one_source
  CHECK (num_nonnulls(order_id, invoice_id) = 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_commissions_order_unique
  ON commissions (order_id) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_commissions_invoice_unique
  ON commissions (invoice_id) WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_commissions_affiliate
  ON commissions (affiliate_id);

COMMENT ON COLUMN commissions.invoice_id IS
  'The invoice this commission was earned on. Set for hosted (Stealth Health) checkout, where the sale materialises as an invoice and never as an orders row. Mutually exclusive with order_id.';
COMMENT ON COLUMN commissions.order_id IS
  'The order this commission was earned on. Set for storefront/legacy orders. Mutually exclusive with invoice_id.';
COMMENT ON COLUMN commissions.order_total IS
  'The base the commission was calculated from — the goods subtotal, excluding shipping and tax. Named order_total for backwards compatibility.';
```

`affiliate-discount-codes-payouts-migration.sql`, sections 3 and 5:

```sql
ALTER TABLE commissions
  ADD COLUMN IF NOT EXISTS discount_code_id UUID REFERENCES discount_codes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payout_id UUID REFERENCES affiliate_payouts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_commissions_discount_code
  ON commissions (discount_code_id) WHERE discount_code_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commissions_payout
  ON commissions (payout_id) WHERE payout_id IS NOT NULL;
-- + replaced update_affiliate_earnings() (functions section)
```

Row written on payment (`recordAffiliateCommission`, `lib/affiliate/commission.ts`):

```
{ affiliate_id, invoice_id, referral_code_id (null when credited via discount code),
  amount = round2(base * rate), order_total = base (= subtotal_cents/100, goods only),
  commission_rate = round2(rate*100)   -- stored as PERCENT,
  status: 'pending', discount_code_id? }
```

Idempotency works in three layers. A pre-check `select id where invoice_id = ?` runs first. The unique index `idx_commissions_invoice_unique` backs it, and a `23505` error is treated as success. A base of 0 or less (no `subtotal_cents`) skips the insert, so a zero row never blocks the real one.

Rate precedence: the discount code's `commission_rate` (a percent) wins. Otherwise `affiliates.commission_rate` is passed through `normalizeCommissionRate`, which reads ≤1 as a fraction and >1 as a percent. The default is 0.10.

Attribution precedence: an affiliate-owned discount code wins, then the customer's bound `customers.affiliate_id`, then `referral_code`. Self-referral is ignored.

---

#### 7. `affiliate_payouts` (`affiliate-discount-codes-payouts-migration.sql`, section 2)

```sql
CREATE TABLE IF NOT EXISTS affiliate_payouts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id     UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  amount           NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  -- e_transfer | crypto | paypal | bank | cheque | store_credit | other
  method           VARCHAR(30) NOT NULL DEFAULT 'e_transfer',
  reference        VARCHAR(255),
  notes            TEXT,
  paid_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by      UUID,
  recorded_by_name VARCHAR(255),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_payouts_affiliate
  ON affiliate_payouts (affiliate_id, paid_at DESC);

ALTER TABLE affiliate_payouts ENABLE ROW LEVEL SECURITY;   -- zero policies
```

Not touched by checkout. It must exist before `commissions.payout_id` is added.

---

#### 8. Affiliate referral codes: `affiliates`, `referral_codes`, `referral_code_requests`, `affiliate_requests`

`affiliates` and `referral_codes` originals (`supabase-schema.sql`):

```sql
CREATE TABLE IF NOT EXISTS affiliates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  wallet_address VARCHAR(42),
  password_hash TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  total_earnings DECIMAL(10, 2) DEFAULT 0.00,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  code VARCHAR(8) UNIQUE NOT NULL,
  active BOOLEAN DEFAULT true,
  uses_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT fk_affiliate FOREIGN KEY (affiliate_id) REFERENCES affiliates(id)
);
CREATE INDEX IF NOT EXISTS idx_affiliates_email ON affiliates(email);
CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_referral_codes_affiliate ON referral_codes(affiliate_id);
```

`migration-affiliate-commission-rate.sql`:

```sql
ALTER TABLE public.affiliates
  ADD COLUMN IF NOT EXISTS commission_rate numeric(5, 4) NOT NULL DEFAULT 0.10;
UPDATE public.affiliates
  SET commission_rate = 0.10
  WHERE commission_rate IS NULL;
ALTER TABLE public.affiliates
  ADD CONSTRAINT affiliates_commission_rate_check
    CHECK (commission_rate >= 0 AND commission_rate <= 1);
-- (file ends with a verification SELECT)
```

`referral-code-requests-migration.sql`:

```sql
ALTER TABLE referral_codes ALTER COLUMN code TYPE VARCHAR(32);

CREATE TABLE IF NOT EXISTS referral_code_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id    UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  requested_code  VARCHAR(32) NOT NULL,
  previous_code   VARCHAR(32),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','withdrawn')),
  source          VARCHAR(20) NOT NULL DEFAULT 'affiliate'
                    CHECK (source IN ('affiliate','admin')),
  decided_by      UUID,
  decided_by_name VARCHAR(255),
  decided_at      TIMESTAMPTZ,
  decision_notes  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_code_requests_one_pending
  ON referral_code_requests(affiliate_id) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_code_requests_pending_code
  ON referral_code_requests(requested_code) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_referral_code_requests_affiliate
  ON referral_code_requests(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_referral_code_requests_status
  ON referral_code_requests(status, created_at DESC);

ALTER TABLE referral_code_requests ENABLE ROW LEVEL SECURITY;   -- ZERO policies, deliberately

ALTER TABLE affiliate_requests ADD COLUMN IF NOT EXISTS requested_code VARCHAR(32);
```

`affiliate_requests` (`affiliate-program-migration.sql`): the sibling already has the table. Only `requested_code` is new. This migration also adds `customers.affiliate_id`, which the sibling already has.

Checkout use: `POST /api/checkout/referral-code` and payment-time attribution call `resolveReferralCodeOwner`. It reads `referral_codes (id, code, affiliate_id, active)` with `eq code, eq active=true`. If that misses, it falls back to `discount_codes (id, code, affiliate_id, commission_rate, active)` by code. It then checks `affiliates.active`. Referral codes are stored uppercase.

---

#### 9. `invoices` + `invoice_line_items` — what the hosted checkout writes (dependency; the invoicing cluster owns the full DDL)

Base table (`ecommerce-backend-migration.sql`):

```sql
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1000;

CREATE TABLE IF NOT EXISTS invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE DEFAULT ('VYTA-' || nextval('invoice_number_seq')),
  order_id       uuid REFERENCES orders(id) ON DELETE SET NULL,
  customer_id    uuid REFERENCES customers(id) ON DELETE SET NULL,
  issue_date     date NOT NULL DEFAULT CURRENT_DATE,
  due_date       date NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '30 days'),
  subtotal       numeric(10,2) NOT NULL DEFAULT 0,
  tax_total      numeric(10,2) NOT NULL DEFAULT 0,
  shipping_cost  numeric(10,2) NOT NULL DEFAULT 0,
  total          numeric(10,2) NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','sent','paid','partial','overdue')),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id          uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_variant_id  uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  description         text NOT NULL,
  qty                 integer NOT NULL DEFAULT 1,
  unit_price          numeric(10,2) NOT NULL,
  discount_pct        numeric(5,2) NOT NULL DEFAULT 0,
  line_total          numeric(10,2) NOT NULL
);
```

Additions the hosted checkout depends on:

```sql
-- puramass-hosted-checkout-migration.sql
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source TEXT;                 -- 'stealth_health'

-- stock-decrement-migration.sql (sibling already has it)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stock_adjusted boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_invoices_stock_adjusted ON invoices(stock_adjusted);

-- currency-support-migration.sql (sibling already has invoices.currency, customers.preferred_currency)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'CAD';
-- + CHECK invoices_currency_check (currency IN ('CAD','USD')), idx_invoices_currency

-- easyship-invoice-shipment-migration.sql
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS easyship_courier_id  TEXT;   -- checkout sheds it if missing
-- (also easyship_shipment_id, tracking_number, tracking_status, tracking_url, carrier,
--  label_state, label_url, tracking_checkpoints JSONB, auto_shipment_* — used by post-payment shipment booking)

-- puramass-account-orders-migration.sql
CREATE INDEX IF NOT EXISTS idx_invoices_source ON invoices (source);

-- stock-ledger-migration.sql (supersedes stealth-health-pending-invoice-migration.sql §1-2)
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status = ANY (ARRAY[
    'draft'::text, 'sent'::text, 'partial'::text, 'paid'::text,
    'overdue'::text, 'cancelled'::text, 'pending_payment'::text, 'expired'::text
  ]));
ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS vials_per_unit integer NOT NULL DEFAULT 1;
DO $$ BEGIN
  ALTER TABLE invoice_line_items
    ADD CONSTRAINT invoice_line_items_vials_per_unit_positive CHECK (vials_per_unit >= 1);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- invoice-spec-integration-migration.sql §7
ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS price_type text NOT NULL DEFAULT 'box';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_line_items_price_type_check'
  ) THEN
    ALTER TABLE invoice_line_items
      ADD CONSTRAINT invoice_line_items_price_type_check
      CHECK (price_type = ANY (ARRAY['box'::text, 'vial'::text]));
  END IF;
END $$;
```

Invoice header written at hand-off by `createPendingStealthHealthInvoice` (`lib/payments/puramass-fulfillment.ts`):

```
{ issue_date: todayInAppTz() /* America/New_York day */, source: 'stealth_health',
  customer_id, customer_email, customer_name, customer_phone,
  fulfillment_type: 'shipment', fulfillment_status: 'pending', status: 'pending_payment',
  currency: 'CAD', subtotal (charged, post-discount), tax_total: 0, shipping_cost,
  total: subtotal + shipping, is_backorder: false, non_payable: false,
  notes: 'Placed via the Stealth Health checkout. Payment and taxes are handled by Stealth Health.'
         + '\n' + optional discount note,
  easyship_courier_id? }
```

Lines:

```
{ invoice_id, product_id, description: '<name> — Pack of N' | '<name> — Single vial',
  qty, unit_price (CAD, discounted), line_total: round2(qty*unit_price), discount_pct: 0,
  price_type: 'box'|'vial', vials_per_unit: N, qty_fulfilled: 0, qty_backordered: 0 }
```

If insertion fails on a missing column, the retry drops `vials_per_unit`, and it also drops `product_id` from lines with `vials_per_unit ≠ 1`. **`price_type` is never dropped.** A database without `invoice_line_items.price_type` therefore loses every line.

Status lifecycle: `pending_payment` becomes `paid` (via `markInvoicePaid`, guarded `.in('status',['pending_payment','expired'])`), or becomes `expired` (via `expireStealthHealthInvoices`, guarded `.eq('status','pending_payment')`). A hand-off that has no invoice is created directly as `paid` on payment.

RLS: `ALTER TABLE invoices/invoice_line_items ENABLE ROW LEVEL SECURITY` plus `CREATE POLICY service_role_all ON <tbl> USING (true) WITH CHECK (true)` (`ecommerce-backend-migration.sql`).

The columns `fulfillment_type`, `fulfillment_status`, `is_backorder`, `non_payable`, `customer_name`, `customer_email` and `customer_phone` come from invoicing-cluster migrations. The sibling snapshot already has all of them.

---

#### 10. `fulfillment_email_log` — confirmation, admin-alert and commission email history

Original (`doc-ports/migrations-ref/warehouse-emails-orders-migration.sql`):

```sql
CREATE TABLE IF NOT EXISTS fulfillment_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid REFERENCES invoices (id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders (id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('packed', 'shipped')),
  to_email text NOT NULL,
  subject text,
  message_id text,
  success boolean NOT NULL DEFAULT false,
  error text,
  sent_by uuid REFERENCES customers (id) ON DELETE SET NULL,
  sent_by_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fulfillment_email_log_invoice
  ON fulfillment_email_log (invoice_id, created_at DESC);
ALTER TABLE fulfillment_email_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fulfillment_email_log_staff_read ON fulfillment_email_log;
CREATE POLICY fulfillment_email_log_staff_read ON fulfillment_email_log
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role IN ('admin', 'assistant', 'warehouse')
    )
  );
```

`order-confirmation-email-migration.sql` and `stealth-health-admin-paid-alert-migration.sql` both run the same block, which **drops every CHECK naming `kind`**:

```sql
DO $$
DECLARE c record;
BEGIN
  IF to_regclass('public.fulfillment_email_log') IS NULL THEN
    RETURN;
  END IF;
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.fulfillment_email_log'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE public.fulfillment_email_log DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- order-confirmation-email-migration.sql only:
CREATE INDEX IF NOT EXISTS idx_fulfillment_email_log_kind_order
  ON fulfillment_email_log (kind, order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fulfillment_email_log_kind_invoice
  ON fulfillment_email_log (kind, invoice_id) WHERE invoice_id IS NOT NULL;
```

`kind` values written by this cluster: `'order_confirmation'` (`lib/order-confirmation.ts`), `'admin_paid_alert'` (`lib/admin/stealth-health-paid-alert.ts`) and `'affiliate_commission'` (`lib/affiliate/commission-email.ts`). The confirmation log row is `{order_id, invoice_id, to_email, subject, message_id, success, error, sent_by, sent_by_email, kind}`.

---

#### 11. `product_history` — stock ledger written by every stock RPC (`stock-ledger-migration.sql` §1; identical in `product-history-migration.sql`)

```sql
CREATE TABLE IF NOT EXISTS product_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  change_type    TEXT NOT NULL CHECK (change_type IN ('price', 'stock', 'general')),
  field          TEXT NOT NULL,
  old_value      TEXT,
  new_value      TEXT,
  source         TEXT NOT NULL DEFAULT 'admin_edit',
  reference_type TEXT,
  reference_id   TEXT,
  note           TEXT,
  actor_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  actor_email    TEXT
);

CREATE INDEX IF NOT EXISTS idx_product_history_product
  ON product_history (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_history_change_type
  ON product_history (change_type);
CREATE INDEX IF NOT EXISTS idx_product_history_created_at
  ON product_history (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_history_reference
  ON product_history (reference_type, reference_id);

ALTER TABLE product_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "product_history_service_only" ON product_history;
CREATE POLICY "product_history_service_only" ON product_history
  FOR ALL TO public USING (false) WITH CHECK (false);
```

`source` values written by the order lifecycle: `invoice_paid`, `invoice_cancel`, `order_confirmed`, `order_cancelled`, `untracked`, and `admin_edit` (the default). `reference_type` is `'invoice'` or `'order'`. The Stealth Health actor email is the literal `'stealth-health'` (`STOCK_ACTOR`).

---

#### 12. `product_recommendations` — "Frequently bought together" (`cart-upsells-migration.sql` §2)

```sql
CREATE TABLE IF NOT EXISTS product_recommendations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id             uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  recommended_product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort_order             integer NOT NULL DEFAULT 0,
  badge                  text,
  enabled                boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_recommendations_not_self CHECK (product_id <> recommended_product_id),
  CONSTRAINT product_recommendations_unique UNIQUE (product_id, recommended_product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_recommendations_product
  ON product_recommendations (product_id, sort_order);

CREATE OR REPLACE FUNCTION update_product_recommendations_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS product_recommendations_updated_at ON product_recommendations;
CREATE TRIGGER product_recommendations_updated_at
  BEFORE UPDATE ON product_recommendations
  FOR EACH ROW EXECUTE FUNCTION update_product_recommendations_updated_at();

ALTER TABLE product_recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Product recommendations are viewable by everyone" ON product_recommendations;
CREATE POLICY "Product recommendations are viewable by everyone" ON product_recommendations
  FOR SELECT USING (true);
```

Read by `GET /api/products/recommendations` with `select('recommended_product_id, sort_order, badge, enabled').in('product_id', cartIds).eq('enabled', true).order('sort_order')`, which is directional. "You may also like" has no table of its own. It is computed from `order_items(order_id, product_id, quantity)` plus paid `puramass_orders.items`, whose SKUs are mapped back through `products.puramass_sku` and `puramass_sku_vial`.

---

#### 13. `products` — columns the cart and checkout depend on

```sql
-- puramass-hosted-checkout-migration.sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS puramass_sku      VARCHAR(80);  -- case / pack SKU (every pack > 1)
ALTER TABLE products ADD COLUMN IF NOT EXISTS puramass_sku_vial VARCHAR(80);  -- single-vial SKU
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_checkout_addon BOOLEAN NOT NULL DEFAULT false;
-- + two partial indexes (see §1)

-- invoice-spec-integration-migration.sql §6
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS vials_per_box integer NOT NULL DEFAULT 10;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_vials_per_box_check'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_vials_per_box_check CHECK (vials_per_box > 0);
  END IF;
END $$;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_usd  numeric;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vial_price numeric;
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS usd_exchange_rate numeric NOT NULL DEFAULT 1;

-- pack-options-content-migration.sql §1
ALTER TABLE products ADD COLUMN IF NOT EXISTS pack_sizes integer[];
-- + CHECK products_pack_sizes_positive_chk (pack_sizes IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(pack_sizes) AS s WHERE s < 1))

-- pack-option-pricing-migration.sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS pack_options jsonb;
-- + CHECK products_pack_options_shape_chk (array of objects, integer size 1..1000, price/compare_at >= 0)
```

Exact checkout reads (`app/api/checkout/puramass/route.ts` §7):

* `select('id, name, price, vial_price, vials_per_box, pack_options, puramass_sku, puramass_sku_vial')`.
* Fallback: `select('id, name, price, vial_price, vials_per_box, puramass_sku')`.
* If both fail, the route returns 500 "Could not load your cart."
* Stock is `products.stock_quantity` (integer NOT NULL default 0, **counted in vials**). Low-stock checks after decrement read `low_stock_threshold` and `low_stock_alerted`; the sibling has both.

---

#### 14. `customers` — columns the checkout and promos read or write

| column | source migration | use |
|---|---|---|
| id, email | base | `customer_id` on the ledger is the Supabase auth user id (`db.auth.getUser(token)`) |
| has_completed_first_order boolean NOT NULL default false | catch-up-schema | first-order checks (welcome discount, `first_order_only` codes) |
| affiliate_id uuid FK affiliates ON DELETE SET NULL | affiliate-program | bound-affiliate commission attribution |
| attribution_channel, attribution_campaign text, attribution jsonb, anonymous_id text | marketing-attribution | paid-ad welcome discount reads `attribution_channel` |
| attribution_landing_page text | landing-pages | reporting |
| preferred_currency text NOT NULL default 'CAD' CHECK in ('CAD','USD') | currency-support | not used by the hosted hand-off (always CAD) |
| allow_pickup, allow_shipping boolean default true | migration-checkout-config | legacy checkout only |

`security-hardening-migration.sql` adds the `trg_prevent_client_privilege_escalation` trigger on `customers` (see functions).

`marketing-attribution-migration.sql` (customers part):

```sql
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS attribution_channel  TEXT,
  ADD COLUMN IF NOT EXISTS attribution_campaign TEXT,
  ADD COLUMN IF NOT EXISTS attribution          JSONB,
  ADD COLUMN IF NOT EXISTS anonymous_id         TEXT;
CREATE INDEX IF NOT EXISTS idx_customers_attribution_channel
  ON customers (attribution_channel, created_at DESC)
  WHERE attribution_channel IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_anonymous
  ON customers (anonymous_id) WHERE anonymous_id IS NOT NULL;
```

---

#### 15. `visitor_attribution` + `customer_activity` — attribution captured around checkout (`marketing-attribution-migration.sql`)

```sql
CREATE TABLE IF NOT EXISTS visitor_attribution (
  anonymous_id      TEXT PRIMARY KEY,
  first_channel     TEXT,
  first_source      TEXT,
  first_medium      TEXT,
  first_campaign    TEXT,
  first_term        TEXT,
  first_content     TEXT,
  first_click_id    TEXT,
  first_click_param TEXT,          -- 'gclid' | 'fbclid' | 'msclkid' | …
  first_referrer    TEXT,          -- referring host only, no path
  first_landing     TEXT,          -- landing path, no query string
  first_ref_code    TEXT,          -- affiliate ?ref= riding on the same URL
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_channel      TEXT,
  last_source       TEXT,
  last_medium       TEXT,
  last_campaign     TEXT,
  last_click_id     TEXT,
  last_click_param  TEXT,
  last_referrer     TEXT,
  last_landing      TEXT,
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_email    TEXT,
  signed_up_at      TIMESTAMPTZ,
  checkout_at       TIMESTAMPTZ,   -- reached a checkout, paid or not
  purchased_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_visitor_attr_customer
  ON visitor_attribution (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_visitor_attr_email
  ON visitor_attribution (lower(customer_email)) WHERE customer_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_visitor_attr_first_seen
  ON visitor_attribution (first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_attr_channel
  ON visitor_attribution (first_channel, first_seen_at DESC);
ALTER TABLE visitor_attribution ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "visitor_attribution_service_only" ON visitor_attribution;
CREATE POLICY "visitor_attribution_service_only" ON visitor_attribution
  FOR ALL TO public USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS customer_activity (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID REFERENCES customers(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  search_query  TEXT,
  product_id    UUID,
  product_name  TEXT,
  quantity      INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE customer_activity
  ADD COLUMN IF NOT EXISTS page_path    TEXT,
  ADD COLUMN IF NOT EXISTS page_title   TEXT,
  ADD COLUMN IF NOT EXISTS referrer     TEXT,
  ADD COLUMN IF NOT EXISTS anonymous_id TEXT,
  ADD COLUMN IF NOT EXISTS session_id   TEXT,
  ADD COLUMN IF NOT EXISTS metadata     JSONB;
-- customer_id DROP NOT NULL (guarded DO block)
ALTER TABLE customer_activity DROP CONSTRAINT IF EXISTS customer_activity_actor_chk;
ALTER TABLE customer_activity
  ADD CONSTRAINT customer_activity_actor_chk
  CHECK (customer_id IS NOT NULL OR anonymous_id IS NOT NULL);
ALTER TABLE customer_activity DROP CONSTRAINT IF EXISTS customer_activity_activity_type_check;
ALTER TABLE customer_activity DROP CONSTRAINT IF EXISTS customer_activity_type_chk;
ALTER TABLE customer_activity
  ADD CONSTRAINT customer_activity_type_chk
  CHECK (activity_type IN (
    'search', 'view', 'cart', 'page', 'click', 'lab_result',
    'checkout_start', 'signup', 'purchase'
  ));
CREATE INDEX IF NOT EXISTS idx_customer_activity_customer
  ON customer_activity (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_activity_type
  ON customer_activity (customer_id, activity_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_activity_anonymous
  ON customer_activity (anonymous_id, created_at DESC) WHERE anonymous_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_activity_created
  ON customer_activity (created_at DESC);
ALTER TABLE customer_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer_activity_service_only" ON customer_activity;
CREATE POLICY "customer_activity_service_only" ON customer_activity
  FOR ALL TO public USING (false) WITH CHECK (false);
```

Checkout touchpoints:

* After a hand-off, `linkVisitorIdentity` sets `visitor_attribution.customer_email` (lower-cased) and `customer_id`.
* `stampVisitorMilestone(..., 'checkout_at')` stamps the checkout time.
* On payment, `attributeEmailPurchase` stamps `purchased_at` for rows matched by email, and `attributeHostedPurchase` copies the channel and campaign onto `puramass_orders` if it has none.
* The checkout page posts `customer_activity` with `activity_type 'checkout_start'` and `metadata {kind:'puramass', items, value}`.
* Visitor writes are gated by `site_settings.tracking_consent_required` together with the consent cookie.

---

#### 16. Price overrides read while pricing the cart (`customer-pricing-migration.sql`; `pricelist-migration.sql`)

```sql
CREATE TABLE IF NOT EXISTS customer_price_overrides (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    uuid          NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id     uuid          NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  override_price numeric(10,2) NOT NULL DEFAULT 0 CHECK (override_price >= 0),
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (customer_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_cpo_customer ON customer_price_overrides(customer_id);
CREATE INDEX IF NOT EXISTS idx_cpo_product  ON customer_price_overrides(product_id);
CREATE INDEX IF NOT EXISTS idx_cpo_pair     ON customer_price_overrides(customer_id, product_id);
DROP TRIGGER IF EXISTS customer_price_overrides_updated_at ON customer_price_overrides;
CREATE TRIGGER customer_price_overrides_updated_at
  BEFORE UPDATE ON customer_price_overrides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE customer_price_overrides ENABLE ROW LEVEL SECURITY;
-- policies: see RLS section
```

Resolution chain (`lib/pricing/resolve.ts` → `resolvePriceMap`):

1. `customer_price_overrides (product_id, override_price)` for this customer.
2. The active pricelist: `pricelists.is_active = true` (a unique partial index keeps it to one), then `pricelist_items (product_id, price)`.
3. `products.price`.

When an override or pricelist price applies, the checkout restates the per-vial price as `price / vials_per_box` and **ignores `pack_options`**. The sibling already has `pricelists`, `pricelist_items` and `customer_price_overrides`. On the sibling the override has no `numeric(10,2)` precision and no CHECK is shown, which is unverified.

---

#### 17. `orders` / `order_items` / `sol_addresses` — legacy storefront orders (final shape)

`migration-orders.sql` (identical to `migration-orders-clean.sql`, which DROPs and recreates — **do not run the clean variant on a live DB**):

```sql
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  order_number TEXT UNIQUE NOT NULL,
  items JSONB NOT NULL,
  total NUMERIC NOT NULL,
  email TEXT,
  shipping_address JSONB,
  crypto TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_address TEXT,
  payment_amount_expected TEXT,
  payment_amount_received TEXT,
  payment_tx_hash TEXT,
  payment_derivation_index INTEGER,
  payment_confirmed_at TIMESTAMPTZ,
  payment_expires_at TIMESTAMPTZ,
  referral_code TEXT,
  tracking_number TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_orders_status_payment ON orders (status, payment_address) WHERE status = 'pending' AND payment_address IS NOT NULL;
CREATE INDEX idx_orders_customer ON orders (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_orders_order_number ON orders (order_number);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  product_id TEXT,
  quantity INTEGER NOT NULL,
  price_at_time NUMERIC NOT NULL,
  strength TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_order_items_order ON order_items (order_id);

CREATE TABLE IF NOT EXISTS sol_addresses (
  id SERIAL PRIMARY KEY,
  address TEXT UNIQUE NOT NULL,
  derivation_index INTEGER NOT NULL,
  used BOOLEAN DEFAULT false,
  order_id UUID REFERENCES orders(id)
);
CREATE INDEX idx_sol_unused ON sol_addresses (used) WHERE used = false;

CREATE OR REPLACE FUNCTION update_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_orders_updated_at();

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sol_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON sol_addresses FOR ALL USING (true) WITH CHECK (true);
```

`migration-confirmations.sql`. The file is one line with no trailing newline (`wc -l` reports 0):

```sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_confirmations INTEGER DEFAULT 0;
```

`ecommerce-backend-migration.sql` (Module 3):

```sql
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS billing_address     jsonb,
  ADD COLUMN IF NOT EXISTS shipping_method     text,
  ADD COLUMN IF NOT EXISTS shipping_carrier    text,
  ADD COLUMN IF NOT EXISTS shipping_cost       numeric(10,2),
  ADD COLUMN IF NOT EXISTS discount_total      numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_total           numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subtotal            numeric(10,2),
  ADD COLUMN IF NOT EXISTS staff_notes         text,
  ADD COLUMN IF NOT EXISTS easyship_shipment_id text,
  ADD COLUMN IF NOT EXISTS packed_at           timestamptz,
  ADD COLUMN IF NOT EXISTS shipped_at          timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at        timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_at         timestamptz;
```

`affiliate-discount-commission-migration.sql`:

```sql
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS discount_amount numeric(10,2) NOT NULL DEFAULT 0;
```

`orders-fulfillment-columns-migration.sql`, superseded by and identical in effect to `catch-up-schema-migration.sql` (orders part). The catch-up version also adds `payment_confirmations integer DEFAULT 0` and `easyship_courier_id text`:

```sql
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS subtotal numeric,
  ADD COLUMN IF NOT EXISTS shipping_cost numeric,
  ADD COLUMN IF NOT EXISTS shipping_method text,
  ADD COLUMN IF NOT EXISTS shipping_carrier text,
  ADD COLUMN IF NOT EXISTS discount_total numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_total numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'website',
  ADD COLUMN IF NOT EXISTS fulfillment_type text,
  ADD COLUMN IF NOT EXISTS billing_address jsonb,
  ADD COLUMN IF NOT EXISTS staff_notes text,
  ADD COLUMN IF NOT EXISTS stock_adjusted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS easyship_shipment_id text,
  ADD COLUMN IF NOT EXISTS tracking_status text,
  ADD COLUMN IF NOT EXISTS tracking_url text,
  ADD COLUMN IF NOT EXISTS carrier text,
  ADD COLUMN IF NOT EXISTS label_state text,
  ADD COLUMN IF NOT EXISTS label_url text,
  ADD COLUMN IF NOT EXISTS packed_at timestamptz,
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_shipment_status text,
  ADD COLUMN IF NOT EXISTS auto_shipment_stage text,
  ADD COLUMN IF NOT EXISTS auto_shipment_error text,
  ADD COLUMN IF NOT EXISTS auto_shipment_attempted_at timestamptz;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'crypto'
  ) THEN
    ALTER TABLE orders ALTER COLUMN crypto DROP NOT NULL;
  END IF;
END $$;

UPDATE orders SET fulfillment_type = 'shipment' WHERE fulfillment_type IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_fulfillment_type_chk'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_fulfillment_type_chk
      CHECK (fulfillment_type IN ('shipment', 'pickup'));
  END IF;
END $$;
```

Further `orders` columns:

```sql
-- stock-decrement-migration.sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_adjusted boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_orders_stock_adjusted ON orders(stock_adjusted);

-- fulfillment-ux-audit-migration.sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_key_uidx
  ON orders (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- easyship-courier-id-migration.sql (also in catch-up)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS easyship_courier_id TEXT;

-- order-confirmation-email-migration.sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmation_email_sent_at TIMESTAMPTZ;

-- marketing-attribution-migration.sql
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS attribution_channel  TEXT,
  ADD COLUMN IF NOT EXISTS attribution_campaign TEXT,
  ADD COLUMN IF NOT EXISTS attribution          JSONB;
CREATE INDEX IF NOT EXISTS idx_orders_attribution_channel
  ON orders (attribution_channel, created_at DESC)
  WHERE attribution_channel IS NOT NULL;
```

Purpose and current use. Nothing on the live checkout path writes `orders`. The table is still read by:

* `GET /api/orders` (public tracking lookup). It selects `order_number, email, status, items, total, subtotal, shipping_cost, discount_total, shipping_address, shipping_carrier, shipping_method, fulfillment_type, tracking_number, tracking_url, tracking_status, created_at, shipped_at, delivered_at` and requires the email to match.
* `GET /api/orders/my-orders` (`order_number, status, total, crypto, payment_tx_hash, tracking_number, created_at`).
* `firstOrderStatus` and the order confirmation (`select('*')`).
* `adjust/restore_stock_for_order`, which admin order-status changes and the legacy crypto cron still call.

---

#### 18. `backorders` / `backorder_items` (`backorders-migration.sql`) — NOT created by checkout

The hosted checkout writes `invoices.is_backorder = false` and never inserts into `backorders`. Backorders are created only by the admin invoice-split path (`lib/admin/backorder-sync.ts`). The sibling snapshot already has both tables. No port action is needed for checkout.

---

#### 19. `site_settings` — the singleton (`migration-site-settings.sql`)

```sql
CREATE TABLE IF NOT EXISTS site_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS checkout_type TEXT NOT NULL DEFAULT 'crypto',
  ADD COLUMN IF NOT EXISTS admin_emails JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'site_settings_checkout_type_chk'
  ) THEN
    ALTER TABLE site_settings
      ADD CONSTRAINT site_settings_checkout_type_chk
      CHECK (checkout_type IN ('email', 'crypto'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS site_settings_singleton ON site_settings ((true));

CREATE OR REPLACE FUNCTION update_site_settings_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS site_settings_updated_at ON site_settings;
CREATE TRIGGER site_settings_updated_at
  BEFORE UPDATE ON site_settings
  FOR EACH ROW EXECUTE FUNCTION update_site_settings_updated_at();

ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON site_settings;
CREATE POLICY "Service role full access" ON site_settings FOR ALL USING (true) WITH CHECK (true);

INSERT INTO site_settings (checkout_type, admin_emails)
VALUES ('email', '["codogmjo@gmail.com"]'::jsonb)
ON CONFLICT DO NOTHING;
```

Every reader uses `select('*').limit(1).maybeSingle()` and shapes the result defensively, so a missing column reads as "off" or as the default. The public storefront reaches settings through `GET /api/admin/settings` (called by `app/cart/page.tsx` and `app/checkout/page.tsx`), which runs `shape()` and redacts secrets. **Change the seed email** before running this on the sibling. The sibling already has a row.

---

### Schema — site_settings columns used by cart/checkout

| column | type | default | migration | purpose |
|---|---|---|---|---|
| id / created_at / updated_at | uuid / timestamptz | gen_random_uuid() / now() | migration-site-settings | singleton row |
| checkout_type | text NOT NULL, CHECK in ('email','crypto') | 'crypto' | migration-site-settings | legacy. Returned by the settings API; the hosted checkout ignores it |
| admin_emails | jsonb NOT NULL (string[]) | '[]' | migration-site-settings | recipients of the admin "new order paid" email |
| pickup_address | text | '' | migration-checkout-config | legacy pickup. Returned by the API; there is no pickup on the hosted checkout |
| guest_checkout_enabled | boolean | true | migration-checkout-config | checkout page: allow checkout without signing in |
| puramass_checkout_enabled | boolean NOT NULL | false | puramass-hosted-checkout | legacy toggle. The settings API always returns `true`; `/api/checkout/puramass` does not consult it |
| puramass_shipping_rates_enabled | boolean NOT NULL | false | puramass-hosted-shipping | on: the buyer picks a live Easyship rate and the address is required. Off: flat fee |
| puramass_flat_shipping | numeric NOT NULL | 35 | puramass-hosted-shipping | flat fee in CAD (also the fallback when no live quote) |
| puramass_free_shipping_enabled | boolean NOT NULL | false | puramass-hosted-shipping | free-shipping promo. Forced off unless rates are enabled and threshold > 0 |
| puramass_free_shipping_threshold | numeric NOT NULL | 0 | puramass-hosted-shipping | goods subtotal (CAD, **list price**, before discounts) that unlocks free shipping |
| shipping_handling_fee_type | text ('flat'\|'pct') | 'flat' | shipping-handling-fee / catch-up-schema | "processing fee" folded into every live rate |
| shipping_handling_fee_value | numeric | 0 | shipping-handling-fee / catch-up-schema | CAD amount, or percentage points |
| easyship_enabled | boolean | false | easyship-settings | live rate quoting on/off (`getShippingConfig`) |
| easyship_api_key | text | '' | easyship-settings | Easyship token (env `EASYSHIP_API_KEY` fallback). Never returned |
| shipping_origin | jsonb `{line_1, city, state, postal_code, country_alpha2, company, phone, email}` | '{}' | easyship-settings | rate origin |
| shipping_box | jsonb `{length, width, height}` (cm) | '{}' | easyship-settings | parcel |
| shipping_item_weight_kg | numeric | 0.05 | easyship-settings | per-vial weight (parcel weight = total vials × this) |
| shipping_flat_rate | numeric | 20 | easyship-settings | Easyship config fallback (separate from `puramass_flat_shipping`) |
| easyship_auto_create_shipment / easyship_auto_courier_preference / easyship_auto_buy_label | boolean / text / boolean | false / 'cheapest' / false | easyship-invoice-shipment (§0) / catch-up-schema (orig. doc-ports/migrations-ref/easyship-auto-shipment) | shipment booking after payment (paid hosted orders are always force-booked as a draft; label purchase follows `easyship_auto_buy_label`) |
| ad_discount_enabled | boolean NOT NULL | **true** | ad-discount-promo | paid-ads welcome discount on/off (code defaults to OFF when the column is absent) |
| ad_discount_percent | numeric NOT NULL | 25 | ad-discount-promo | percent off the goods subtotal. 0 forces it off. Clamped 0–100 |
| cart_offer_enabled | boolean NOT NULL | false | cart-upsells | limited-time cart offer |
| cart_offer_min_items | integer NOT NULL | 2 | cart-upsells | cart **units** (packs, not vials) needed. Clamped 1–99 |
| cart_offer_percent | numeric(5,2) NOT NULL | 10 | cart-upsells | percent off. Capped at `MAX_DISCOUNT_PERCENT` (99). Composes with other discounts |
| cart_offer_ends_at | timestamptz | NULL | cart-upsells | offer end time, enforced at hand-off. NULL = no countdown |
| cart_fbt_enabled | boolean NOT NULL | true | cart-upsells | "Frequently bought together" block |
| cart_similar_enabled | boolean NOT NULL | true | cart-upsells | "You may also like" block |
| checkout_addons_enabled | boolean NOT NULL | true | checkout-addons-toggle | the checkout's "Complete your order" box (add-on products with `is_checkout_addon`) |
| cart_trust_strip_enabled | boolean NOT NULL | true | storefront-section-toggles | three trust badges at the top of the cart |
| checkout_verify_notice_enabled | boolean NOT NULL | true | storefront-section-toggles | the "A few quick questions first" notice under the pay button |
| product_trust_badges_enabled / product_reviews_enabled | boolean NOT NULL | true | storefront-section-toggles | product page only (not cart or checkout) |
| abandoned_checkout_hours | integer NOT NULL | 1 | abandoned-checkout-recovery | hours unpaid before `/admin/puramass-orders` lists a hand-off as abandoned |
| tracking_consent_required | boolean NOT NULL | true | marketing-branding | gates `visitor_attribution` writes (consent cookie) |
| ga4_measurement_id / meta_pixel_id | text | NULL | marketing-branding | `begin_checkout` analytics |
| gtm_container_id | text | NULL | gtm-ga4-tracking | GTM (the migration **seeds Aminocan's** `GTM-M2J3D7SG` / `G-F44F1BB1QV`) |
| usd_exchange_rate | numeric NOT NULL | 1 | invoice-spec-integration | read by `lib/pricing.ts` for USD display. Not used by the CAD hand-off |
| klaviyo_enabled, klaviyo_private_api_key, klaviyo_public_key, klaviyo_list_id, klaviyo_onsite_enabled, klaviyo_server_events_enabled, klaviyo_sync_signups | bool/text | false/''/''/''/true/true/true | klaviyo-integration | "Started Checkout" / "Placed Order" events (best-effort) |

`gtm-ga4-tracking-migration.sql` (verbatim; it depends on `ga4_measurement_id` from marketing-branding):

```sql
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS gtm_container_id text;   -- GTM-XXXXXXX
COMMENT ON COLUMN site_settings.gtm_container_id IS
  'Google Tag Manager container id (GTM-XXXXXXX). Public client-side identifier.';
UPDATE site_settings
   SET gtm_container_id    = COALESCE(NULLIF(TRIM(gtm_container_id), ''), 'GTM-M2J3D7SG'),
       ga4_measurement_id  = COALESCE(NULLIF(TRIM(ga4_measurement_id), ''), 'G-F44F1BB1QV');
INSERT INTO site_settings (checkout_type, gtm_container_id, ga4_measurement_id)
SELECT 'crypto', 'GTM-M2J3D7SG', 'G-F44F1BB1QV'
WHERE NOT EXISTS (SELECT 1 FROM site_settings);
```

The remaining `site_settings` DDL is verbatim in the migrations named in the table. Each is a plain `ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS <col> <type> [NOT NULL] DEFAULT <d>` with the type and default shown, followed by `NOTIFY pgrst, 'reload schema'` in the newer files.

---

### Schema — functions / RPCs / triggers

#### Stock: invoice paid and cancelled (the hosted-checkout path). Final versions are from `stock-ledger-migration.sql`.

On a paid hosted sale, `materializeStealthHealthFulfillment` calls `takeStealthHealthStock`. That calls `adjustInvoiceStock` (`lib/admin/stock-ledger.ts`), which runs `rpc('adjust_stock_for_invoice', {p_invoice_id, p_actor_email:'stealth-health'})`. If the function is missing, it retries with only `{p_invoice_id}`. The pass runs on every webhook or poll for an invoice in `paid` status and is a no-op once `stock_adjusted = true`.

```sql
DROP FUNCTION IF EXISTS adjust_stock_for_invoice(uuid);
DROP FUNCTION IF EXISTS restore_stock_for_invoice(uuid);

CREATE OR REPLACE FUNCTION adjust_stock_for_invoice(
  p_invoice_id  uuid,
  p_actor_email text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_already boolean;
BEGIN
  SELECT stock_adjusted INTO v_already
  FROM invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF v_already IS DISTINCT FROM false THEN
    RETURN;  -- not found, or already adjusted
  END IF;

  WITH agg AS (
    SELECT product_id, SUM(qty * COALESCE(vials_per_unit, 1))::int AS qty
    FROM invoice_line_items
    WHERE invoice_id = p_invoice_id
      AND product_id IS NOT NULL
    GROUP BY product_id
  ),
  before AS (
    SELECT p.id, COALESCE(p.stock_quantity, 0) AS old_qty, agg.qty
    FROM products p
    JOIN agg ON p.id = agg.product_id
  ),
  upd AS (
    UPDATE products p
    SET stock_quantity = GREATEST(0, b.old_qty - b.qty)
    FROM before b
    WHERE p.id = b.id
    RETURNING p.id
  )
  INSERT INTO product_history (
    product_id, change_type, field, old_value, new_value,
    source, reference_type, reference_id, note, actor_email
  )
  SELECT
    b.id, 'stock', 'stock_quantity',
    b.old_qty::text,
    GREATEST(0, b.old_qty - b.qty)::text,
    'invoice_paid', 'invoice', p_invoice_id::text,
    'Stock decremented by ' || b.qty || ' when invoice was marked paid',
    p_actor_email
  FROM before b;

  UPDATE invoices SET stock_adjusted = true WHERE id = p_invoice_id;
END;
$$;

CREATE OR REPLACE FUNCTION restore_stock_for_invoice(
  p_invoice_id  uuid,
  p_actor_email text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_adjusted boolean;
BEGIN
  UPDATE invoices
     SET stock_adjusted = false
   WHERE id = p_invoice_id
     AND stock_adjusted = true
  RETURNING stock_adjusted INTO v_adjusted;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  WITH agg AS (
    SELECT product_id, SUM(qty * COALESCE(vials_per_unit, 1))::int AS qty
    FROM invoice_line_items
    WHERE invoice_id = p_invoice_id
      AND product_id IS NOT NULL
    GROUP BY product_id
  ),
  before AS (
    SELECT p.id, COALESCE(p.stock_quantity, 0) AS old_qty, agg.qty
    FROM products p
    JOIN agg ON p.id = agg.product_id
  ),
  upd AS (
    UPDATE products p
    SET stock_quantity = b.old_qty + b.qty
    FROM before b
    WHERE p.id = b.id
    RETURNING p.id
  )
  INSERT INTO product_history (
    product_id, change_type, field, old_value, new_value,
    source, reference_type, reference_id, note, actor_email
  )
  SELECT
    b.id, 'stock', 'stock_quantity',
    b.old_qty::text,
    (b.old_qty + b.qty)::text,
    'invoice_cancel', 'invoice', p_invoice_id::text,
    'Stock restored (+' || b.qty || ') when invoice was cancelled',
    p_actor_email
  FROM before b;
END;
$$;
```

Idempotency guards:

* adjust: `SELECT … FOR UPDATE` on the invoice, then return unless `stock_adjusted = false`. The flag is set true at the end.
* restore: claims the row with `UPDATE … WHERE stock_adjusted = true RETURNING`, so a second cancel finds nothing.

Called from `app/api/admin/invoices/[id]/route.ts` with `{p_invoice_id, p_actor_email}`.

#### Stock: lines paid without a product (repair), plus the safety-net trigger (`stock-ledger-migration.sql`)

```sql
CREATE OR REPLACE FUNCTION take_stock_for_invoice_lines(
  p_invoice_id  uuid,
  p_links       jsonb,
  p_actor_id    uuid DEFAULT NULL,
  p_actor_email text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_status   text;
  v_adjusted boolean;
  v_actor    uuid;
  v_count    integer := 0;
  elem       jsonb;
  v_line     uuid;
  v_prod     uuid;
  v_vpu      integer;
  v_qty      integer;
  v_take     integer;
  v_old      integer;
  v_new      integer;
BEGIN
  SELECT status, stock_adjusted INTO v_status, v_adjusted
    FROM invoices
   WHERE id = p_invoice_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id;
  END IF;
  IF v_status <> 'paid' THEN
    RAISE EXCEPTION 'Only a paid invoice takes stock (this one is %)', v_status;
  END IF;

  SELECT id INTO v_actor FROM customers WHERE id = p_actor_id;

  FOR elem IN SELECT * FROM jsonb_array_elements(COALESCE(p_links, '[]'::jsonb))
  LOOP
    v_line := (elem->>'line_id')::uuid;
    v_prod := (elem->>'product_id')::uuid;
    v_vpu  := GREATEST(1, COALESCE((elem->>'vials_per_unit')::integer, 1));

    SELECT qty INTO v_qty
      FROM invoice_line_items
     WHERE id = v_line
       AND invoice_id = p_invoice_id
       AND product_id IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;  -- already linked (or not this invoice's line)
    END IF;

    SELECT COALESCE(stock_quantity, 0) INTO v_old
      FROM products
     WHERE id = v_prod
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not found', v_prod;
    END IF;

    UPDATE invoice_line_items
       SET product_id = v_prod,
           vials_per_unit = v_vpu
     WHERE id = v_line;

    IF v_adjusted THEN
      v_take := COALESCE(v_qty, 0) * v_vpu;
      v_new  := GREATEST(0, v_old - v_take);

      UPDATE products SET stock_quantity = v_new WHERE id = v_prod;

      INSERT INTO product_history
        (product_id, change_type, field, old_value, new_value,
         source, reference_type, reference_id, note, actor_id, actor_email)
      VALUES
        (v_prod, 'stock', 'stock_quantity', v_old::text, v_new::text,
         'invoice_paid', 'invoice', p_invoice_id::text,
         'Stock decremented by ' || v_take ||
           ' for an invoice line linked to its product after payment',
         v_actor, p_actor_email);
    END IF;

    v_count := v_count + 1;
  END LOOP;

  IF NOT v_adjusted THEN
    PERFORM adjust_stock_for_invoice(p_invoice_id, p_actor_email);
  END IF;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION log_untracked_stock_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claims jsonb;
  v_actor  uuid;
  v_email  text;
  v_via    text;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM product_history h
     WHERE h.product_id = NEW.id
       AND h.field = 'stock_quantity'
       AND h.created_at = now()
       AND h.new_value IS NOT DISTINCT FROM NEW.stock_quantity::text
  ) THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    v_claims := NULL;
  END;

  v_email := NULLIF(v_claims->>'email', '');
  IF (v_claims->>'sub') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id, COALESCE(v_email, email) INTO v_actor, v_email
      FROM customers
     WHERE id = (v_claims->>'sub')::uuid;
  END IF;
  v_via := COALESCE(NULLIF(v_claims->>'role', ''), session_user::text);

  INSERT INTO product_history
    (product_id, change_type, field, old_value, new_value,
     source, note, actor_id, actor_email)
  VALUES
    (NEW.id, 'stock', 'stock_quantity', OLD.stock_quantity::text, NEW.stock_quantity::text,
     'untracked',
     'Changed outside the admin tools (' || v_via || ')',
     v_actor, COALESCE(v_email, 'database:' || v_via));

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS products_stock_ledger ON products;
CREATE CONSTRAINT TRIGGER products_stock_ledger
  AFTER UPDATE OF stock_quantity ON products
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.stock_quantity IS DISTINCT FROM NEW.stock_quantity)
  EXECUTE FUNCTION log_untracked_stock_change();
```

`stock-ledger-migration.sql` also defines `set_product_stock(p_product_id uuid, p_new_qty integer, p_actor_id uuid DEFAULT NULL, p_actor_email text DEFAULT NULL, p_source text DEFAULT 'admin_edit', p_note text DEFAULT NULL) RETURNS void`. It is used by admin manual edits, not by checkout. The full body is in the file, lines 208–252.

#### Stock: legacy `orders` (from the `orders.items` JSONB, vial-aware). Final versions are from `case-vial-stock-decrement-migration.sql`.

Called by `lib/order-stock.ts` → `rpc('adjust_stock_for_order', {p_order_id, p_actor_email})` and `rpc('restore_stock_for_order', {p_order_id, p_actor_email})`. Callers are the legacy crypto cron, `/api/orders/check-payment` and admin order status changes. The hosted checkout does not use these.

```sql
CREATE OR REPLACE FUNCTION adjust_stock_for_order(
  p_order_id    uuid,
  p_actor_email text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_already boolean;
  v_items   jsonb;
BEGIN
  SELECT stock_adjusted, items INTO v_already, v_items
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_already IS DISTINCT FROM false THEN
    RETURN;  -- not found, or already adjusted
  END IF;

  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' THEN
    UPDATE orders SET stock_adjusted = true WHERE id = p_order_id;
    RETURN;
  END IF;

  WITH agg AS (
    SELECT
      (elem->>'id')::uuid AS pid,
      SUM(
        GREATEST(0, COALESCE(NULLIF(elem->>'quantity', ''), '0')::numeric)
        * CASE
            WHEN elem->>'unit' = 'case'
              THEN GREATEST(1, COALESCE(NULLIF(elem->>'vials_per_box', ''), '1')::numeric)
            ELSE 1
          END
      )::int AS qty
    FROM jsonb_array_elements(v_items) AS elem
    WHERE elem->>'id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    GROUP BY elem->>'id'
  ),
  before AS (
    SELECT p.id, COALESCE(p.stock_quantity, 0) AS old_qty, agg.qty
    FROM products p
    JOIN agg ON p.id = agg.pid
    WHERE agg.qty > 0
  ),
  upd AS (
    UPDATE products p
    SET stock_quantity = GREATEST(0, b.old_qty - b.qty)
    FROM before b
    WHERE p.id = b.id
    RETURNING p.id
  )
  INSERT INTO product_history (
    product_id, change_type, field, old_value, new_value,
    source, reference_type, reference_id, note, actor_email
  )
  SELECT
    b.id, 'stock', 'stock_quantity',
    b.old_qty::text,
    GREATEST(0, b.old_qty - b.qty)::text,
    'order_confirmed', 'order', p_order_id::text,
    'Stock decremented by ' || b.qty || ' vials when order was confirmed',
    p_actor_email
  FROM before b;

  UPDATE orders SET stock_adjusted = true WHERE id = p_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION restore_stock_for_order(
  p_order_id    uuid,
  p_actor_email text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_adjusted boolean;
  v_items    jsonb;
BEGIN
  SELECT stock_adjusted, items INTO v_adjusted, v_items
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_adjusted IS DISTINCT FROM true THEN
    RETURN;  -- not found, or never decremented — nothing to give back
  END IF;

  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' THEN
    UPDATE orders SET stock_adjusted = false WHERE id = p_order_id;
    RETURN;
  END IF;

  WITH agg AS (
    SELECT
      (elem->>'id')::uuid AS pid,
      SUM(
        GREATEST(0, COALESCE(NULLIF(elem->>'quantity', ''), '0')::numeric)
        * CASE
            WHEN elem->>'unit' = 'case'
              THEN GREATEST(1, COALESCE(NULLIF(elem->>'vials_per_box', ''), '1')::numeric)
            ELSE 1
          END
      )::int AS qty
    FROM jsonb_array_elements(v_items) AS elem
    WHERE elem->>'id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    GROUP BY elem->>'id'
  ),
  before AS (
    SELECT p.id, COALESCE(p.stock_quantity, 0) AS old_qty, agg.qty
    FROM products p
    JOIN agg ON p.id = agg.pid
    WHERE agg.qty > 0
  ),
  upd AS (
    UPDATE products p
    SET stock_quantity = b.old_qty + b.qty
    FROM before b
    WHERE p.id = b.id
    RETURNING p.id
  )
  INSERT INTO product_history (
    product_id, change_type, field, old_value, new_value,
    source, reference_type, reference_id, note, actor_email
  )
  SELECT
    b.id, 'stock', 'stock_quantity',
    b.old_qty::text,
    (b.old_qty + b.qty)::text,
    'order_cancelled', 'order', p_order_id::text,
    'Stock restored (+' || b.qty || ' vials) when order was cancelled',
    p_actor_email
  FROM before b;

  UPDATE orders SET stock_adjusted = false WHERE id = p_order_id;
END;
$$;
```

Version history. Apply only the final version, after dropping the single-argument overloads:

1. `stock-decrement-migration.sql` creates `adjust_stock_for_invoice(uuid)` and `adjust_stock_for_order(uuid)`, which reads `order_items`.
2. `product-history-migration.sql` runs `DROP FUNCTION IF EXISTS adjust_stock_for_invoice(uuid); DROP FUNCTION IF EXISTS adjust_stock_for_order(uuid);` and recreates both as `(uuid, text DEFAULT NULL)`.
3. `order-stock-decrement-jsonb-migration.sql` switches the order version to read the JSONB.
4. `fulfillment-ux-audit-migration.sql` adds `restore_stock_for_order` (no vial math).
5. `case-vial-stock-decrement-migration.sql` replaces both order functions (shown above).
6. `stealth-health-pending-invoice-migration.sql` makes the invoice functions vial-aware.
7. `stock-ledger-migration.sql` re-ships them, dropping the `(uuid)` overloads first (shown above).

#### Affiliate earnings and code usage triggers on `commissions`

Original (`supabase-schema.sql`):

```sql
CREATE TRIGGER update_earnings_on_commission_paid
  AFTER UPDATE ON commissions
  FOR EACH ROW
  EXECUTE FUNCTION update_affiliate_earnings();

CREATE OR REPLACE FUNCTION increment_code_usage()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.referral_code_id IS NOT NULL THEN
    UPDATE referral_codes
    SET uses_count = uses_count + 1
    WHERE id = NEW.referral_code_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER increment_code_on_commission_created
  AFTER INSERT ON commissions
  FOR EACH ROW
  EXECUTE FUNCTION increment_code_usage();

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER update_affiliates_updated_at
  BEFORE UPDATE ON affiliates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

Final `update_affiliate_earnings()` (`affiliate-discount-codes-payouts-migration.sql` §5, which replaces the add-only original):

```sql
CREATE OR REPLACE FUNCTION update_affiliate_earnings()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS NULL OR OLD.status != 'paid') THEN
    UPDATE affiliates
    SET total_earnings = total_earnings + NEW.amount
    WHERE id = NEW.affiliate_id;
  ELSIF OLD.status = 'paid' AND NEW.status != 'paid' THEN
    UPDATE affiliates
    SET total_earnings = GREATEST(0, total_earnings - OLD.amount)
    WHERE id = OLD.affiliate_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

Note that `referral_codes.uses_count` only moves when a commission row has `referral_code_id`. Discount-code-credited commissions write `referral_code_id = null`, and discount-code usage is counted from `puramass_orders` instead.

#### `landing_page_bump` (`landing-page-counters-migration.sql`)

```sql
CREATE OR REPLACE FUNCTION landing_page_bump(
  p_slug TEXT,
  p_views INTEGER DEFAULT 0,
  p_arrivals INTEGER DEFAULT 0,
  p_visitors INTEGER DEFAULT 0
) RETURNS VOID
LANGUAGE sql
AS $$
  INSERT INTO landing_page_daily (slug, day, views, arrivals, visitors)
  SELECT
    p_slug,
    (now() AT TIME ZONE 'America/Toronto')::date,
    LEAST(GREATEST(COALESCE(p_views, 0), 0), 1),
    LEAST(GREATEST(COALESCE(p_arrivals, 0), 0), 1),
    LEAST(GREATEST(COALESCE(p_visitors, 0), 0), 1)
  WHERE EXISTS (SELECT 1 FROM landing_pages WHERE slug = p_slug)
  ON CONFLICT (slug, day) DO UPDATE SET
    views    = landing_page_daily.views    + EXCLUDED.views,
    arrivals = landing_page_daily.arrivals + EXCLUDED.arrivals,
    visitors = landing_page_daily.visitors + EXCLUDED.visitors;
$$;
```

Grants follow in the RLS section.

#### Numbering

* **Invoice number:** the column default `('VYTA-' || nextval('invoice_number_seq'))`, with sequence `invoice_number_seq START 1000` (`ecommerce-backend-migration.sql`; `invoice-number-vyta-prefix-migration.sql` sets the same default and renames `INV-` to `VYTA-`). The hosted checkout never sends `invoice_number`, so this default is **required**. The sibling should choose its own prefix.
* **Hosted order reference:** generated by the app as `partner_reference = 'amc_' + crypto.randomUUID()`. It is unique in `puramass_orders` and is the Puramass idempotency key.
* **Legacy `orders.order_number`:** generated by the app (`lib/customer/api.ts`: `NP-<base36 ts>-<4 rand>`; admin route has its own). There is no DB function for it.

#### Claim-then-send columns (idempotency of emails)

No functions are involved. These are conditional UPDATEs:

* Confirmation: `update {confirmation_email_sent_at: now} where id=? and confirmation_email_sent_at is null returning id`. If a row comes back, this caller won the claim and sends. A failed send sets the column back to NULL.
* Admin alert: the same pattern on `puramass_orders.admin_paid_alert_sent_at`.

The backfills shipped with these migrations:

```sql
-- order-confirmation-email-migration.sql
UPDATE orders SET confirmation_email_sent_at = now()
 WHERE confirmation_email_sent_at IS NULL
   AND status NOT IN ('pending', 'received');
UPDATE orders o SET confirmation_email_sent_at = now()
  FROM invoices i
 WHERE i.order_id = o.id
   AND i.status = 'paid'
   AND o.confirmation_email_sent_at IS NULL;
UPDATE puramass_orders SET confirmation_email_sent_at = now()
 WHERE confirmation_email_sent_at IS NULL
   AND status = 'paid';
UPDATE puramass_orders p SET confirmation_email_sent_at = now()
  FROM invoices i
 WHERE i.id = p.invoice_id
   AND i.status = 'paid'
   AND p.confirmation_email_sent_at IS NULL;

-- stealth-health-admin-paid-alert-migration.sql
UPDATE puramass_orders SET admin_paid_alert_sent_at = now()
 WHERE admin_paid_alert_sent_at IS NULL
   AND status = 'paid';
UPDATE puramass_orders p SET admin_paid_alert_sent_at = now()
  FROM invoices i
 WHERE i.id = p.invoice_id
   AND i.status = 'paid'
   AND p.admin_paid_alert_sent_at IS NULL;
```

#### Status-flip guards (app-side; these give exactly-once side effects)

* Poll flip: `update puramass_orders set … where id=? and status=<old status> returning id`. If no row comes back, another run won the race and side effects are skipped.
* Webhook: if `last_event_id = event_id`, it returns `deduped` without writing.
* The invoice paid flip is guarded on status (see §9). Stock, commission, shipment, confirmation and admin alert are retried on **every** paid pass and are idempotent on their own.

#### `updated_at` triggers (all present above)

* `update_puramass_orders_updated_at` / `puramass_orders_updated_at`
* `update_puramass_address_requests_updated_at`
* `update_site_settings_updated_at`
* `update_orders_updated_at`
* `update_product_recommendations_updated_at`
* `set_updated_at()` (from `ecommerce-backend-migration.sql`; used by `customer_price_overrides`, `invoices`):

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
```

#### `prevent_client_privilege_escalation` (`security-hardening-migration.sql`)

This is the only content of that file. It concerns `customers`, not order tables.

```sql
CREATE OR REPLACE FUNCTION prevent_client_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role
      OR NEW.is_admin IS DISTINCT FROM OLD.is_admin)
     AND current_user IN ('anon', 'authenticated')
  THEN
    RAISE EXCEPTION
      'Role/admin changes must go through the server (service role), not a client write.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_client_privilege_escalation ON customers;
CREATE TRIGGER trg_prevent_client_privilege_escalation
  BEFORE UPDATE ON customers
  FOR EACH ROW
  EXECUTE FUNCTION prevent_client_privilege_escalation();
```

---

### Schema — RLS policies & grants for these tables

| table | RLS | policies (verbatim) | effective access |
|---|---|---|---|
| puramass_orders | enabled | `"Service role full access" FOR ALL USING (true) WITH CHECK (true)` (no `TO` clause) | **No `TO` clause, so it applies to every role, including anon and authenticated** (see porting notes) |
| puramass_address_requests | enabled | same `"Service role full access"` USING(true) | same caveat |
| puramass_webhook_events | enabled | none | service role only |
| site_settings | enabled | `"Service role full access" FOR ALL USING (true) WITH CHECK (true)` | same caveat. Note that `easyship_api_key` and `klaviyo_private_api_key` live in this table |
| orders / order_items / sol_addresses | enabled | `"Service role full access" FOR ALL USING (true) WITH CHECK (true)` (and `database-schema-complete.sql` creates the same on orders) | same caveat |
| invoices / invoice_line_items | enabled | `service_role_all USING (true) WITH CHECK (true)` (`ecommerce-backend-migration.sql`) | same caveat |
| discount_codes | enabled | none | service role only |
| affiliate_payouts | enabled | none | service role only |
| referral_code_requests | enabled | none (deliberate; **never add an `affiliate_id = auth.uid()` policy**) | service role only |
| landing_pages / landing_page_daily | enabled | none | service role only |
| commissions | enabled | `"Commissions viewable by all" FOR SELECT USING (true)`; `"Commissions can be inserted" FOR INSERT WITH CHECK (true)` | public read and insert (legacy) |
| referral_codes | enabled | `"Referral codes are viewable by everyone" FOR SELECT USING (true)`; `"Affiliates can insert own codes" FOR INSERT WITH CHECK (true)` | public |
| affiliates | enabled | `"Affiliates can view own data" FOR SELECT USING (true)`; `"Affiliates can update own data" FOR UPDATE USING (true)`; `"Anyone can insert affiliates" FOR INSERT WITH CHECK (true)` | public (legacy) |
| affiliate_requests | enabled | `"Admins read affiliate_requests" FOR SELECT USING (EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role IN ('admin','assistant')))` | admin read |
| product_recommendations | enabled | `"Product recommendations are viewable by everyone" FOR SELECT USING (true)` | public read, service writes |
| product_history | enabled | `"product_history_service_only" FOR ALL TO public USING (false) WITH CHECK (false)` | service role only |
| visitor_attribution | enabled | `"visitor_attribution_service_only" FOR ALL TO public USING (false) WITH CHECK (false)` | service role only |
| customer_activity | enabled | `"customer_activity_service_only" FOR ALL TO public USING (false) WITH CHECK (false)` | service role only |
| fulfillment_email_log | enabled | `fulfillment_email_log_staff_read FOR SELECT TO authenticated USING (EXISTS (… role IN ('admin','assistant','warehouse')))` | staff read |
| customer_price_overrides | enabled | `cpo_admin_read FOR SELECT USING (EXISTS (SELECT 1 FROM customers WHERE customers.id = auth.uid() AND customers.role IN ('admin','assistant')))`; `cpo_admin_write FOR ALL USING (… role = 'admin') WITH CHECK (… role = 'admin')`; `cpo_owner_read FOR SELECT USING (auth.uid() = customer_id)` | admin plus owner |
| backorders / backorder_items | enabled | none | service role only |

Function grants:

```sql
-- stock-ledger-migration.sql
REVOKE EXECUTE ON FUNCTION set_product_stock(uuid, integer, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION take_stock_for_invoice_lines(uuid, jsonb, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_product_stock(uuid, integer, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION take_stock_for_invoice_lines(uuid, jsonb, uuid, text) TO service_role;

-- landing-page-counters-migration.sql
REVOKE ALL ON FUNCTION landing_page_bump(TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION landing_page_bump(TEXT, INTEGER, INTEGER, INTEGER) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION landing_page_bump(TEXT, INTEGER, INTEGER, INTEGER) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION landing_page_bump(TEXT, INTEGER, INTEGER, INTEGER) TO service_role;
  END IF;
END $$;
```

**No REVOKE exists** for `adjust_stock_for_invoice`, `restore_stock_for_invoice`, `adjust_stock_for_order` or `restore_stock_for_order`. Under Supabase defaults they are therefore executable by anon and authenticated through `/rpc`.

The `security-hardening-migration.sql` file contains only the `customers` role trigger. It adds **no** RLS to any order, checkout or settings table.

---

### Schema — cron jobs (pg_cron / Vercel) relevant

1. **`puramass-poll`** — Supabase pg_cron plus pg_net (`supabase-cron-puramass-poll.sql`):

   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_cron;
   CREATE EXTENSION IF NOT EXISTS pg_net;
   -- First time only:
   --   select vault.create_secret('https://aminocan.com', 'app_base_url');   -- no trailing slash
   --   select vault.create_secret('YOUR_CRON_SECRET_HERE', 'cron_secret');   -- = the app's CRON_SECRET
   DO $$
   BEGIN
     IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'puramass-poll') THEN
       PERFORM cron.unschedule('puramass-poll');
     END IF;
   END $$;

   select cron.schedule(
     'puramass-poll',
     '*/2 * * * *',  -- every 2 minutes
     $$
     select net.http_get(
       url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
              || '/api/cron/puramass-poll',
       headers := jsonb_build_object(
         'Authorization',
         'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
       )
     );
     $$
   );
   ```

   **Auth.** `GET /api/cron/puramass-poll` accepts `PURAMASS_CRON_SECRET`, falling back to `CRON_SECRET`. The secret can arrive as header `x-cron-key`, query `?key=`, or `Authorization: Bearer`, checked in that order.

   **What each run does:**
   1. Expiry sweep: `update puramass_orders set status='expired' where status='payment_pending' and created_at < now-7d-6h returning id, invoice_id`, then expire those invoices.
   2. `healStealthHealthPaidOrders` (14-day window, limit 50): re-materialises paid ledger rows whose invoice is still `pending_payment` or `expired`, and takes stock for paid `stealth_health` invoices that have `stock_adjusted=false`.
   3. Polls up to 200 `payment_pending` rows from the last 7 days plus 6 hours that have a `transaction_id`, 8 at a time, and stops on a 429.

   The vault URL in the migration comment is `https://aminocan.com`. The sibling's real values go into the vault.

2. **`abandoned-registrations`** — pg_cron, hourly (`supabase-cron-abandoned-registrations.sql`) → `/api/cron/abandoned-registrations`. This is about registrations, not checkout. It reads `site_settings` and `orders` only to skip customers who have ordered.

3. **Vercel cron** (`vercel.json`): only `{"path":"/api/cron/stock-report","schedule":"0 13 * * *"}` (stock report email). It is not part of the checkout.

4. **`/api/cron/check-payments`** (legacy crypto `orders` poller, `Authorization: Bearer CRON_SECRET`). It is **not scheduled anywhere in the repo** and only matters if legacy crypto orders exist.

Abandoned-checkout recovery has no cron. It is manual from `/admin/puramass-orders`, and "abandoned" means `status in ('payment_pending','expired','cancelled')` and older than `abandoned_checkout_hours`.

---

### Schema — jsonb shapes

**`puramass_orders.items`** — written at hand-off. Only `{sku, quantity, unit_price_cents}` is sent to Puramass; the rest is ledger-only.

```ts
Array<{
  sku: string;                    // products.puramass_sku_vial (pack 1) or products.puramass_sku (any pack > 1), trimmed
  quantity: number;               // UNITS of this pack (1..99, clamped), merged by `${sku}::${packSize}`
  unit_price_cents: number;       // charged per unit, AFTER discount split (integer > 0)
  list_unit_price_cents: number;  // per-unit list price before any discount
  product_id: string;             // products.id (uuid)
  pack_size: number;              // vials per unit (1 = single vial)
}>
```

Older rows may hold only `{sku, quantity}` or `{sku, quantity, unit_price_cents}`. The readers (`linesFromLedger`, recommendations, confirmation `listUnitPrices` keyed by `${product_id.lower}|${pack_size}`) treat every key except `sku` and `quantity` as optional.

**`puramass_orders.paid_items`** — Puramass's priced lines, filtered to entries that carry `unit_price_cents` or `name`:

```ts
Array<{ sku?: string; name?: string; quantity?: number; unit_price_cents?: number }>
```

**`puramass_orders.refunds`** — stored verbatim from Puramass (`unknown[]`). The shape is not defined by this repo.

**`puramass_orders.shipping_address`** (also `puramass_address_requests.submitted_address` minus the extras):

```ts
{ address: string|null; address2: string|null; city: string|null; state: string|null; zip: string|null; country: string|null }
```

* Written at checkout by `validateShippingAddress`: `country` is upper-cased, `address2` is null when blank, and the others are trimmed strings capped at 200/200/100/80/20/40 characters.
* Written from Puramass payloads by `normalizePuramassShipping`, which also accepts the aliases `address1/line1`, `line2`, `province/region` and `postal_code/postcode`.

**`puramass_address_requests.submitted_address`** = `{ ...address (above), full_name: string, phone: string|null }`.

**`puramass_orders.attribution` / `orders.attribution` / `customers.attribution`** (`toAttributionPayload` + `attributionColumns`):

```ts
{
  first: AttributionTouch | null;
  last:  AttributionTouch | null;
  anonymous_id?: string;          // present when a visitor cookie existed
  session_id?: string | null;
}
// AttributionTouch:
{ channel: 'google_ads'|'meta_ads'|'bing_ads'|'tiktok_ads'|'linkedin_ads'|'other_paid'|
           'google_organic'|'meta_organic'|'email'|'affiliate'|'referral'|'direct';
  source: string|null; medium: string|null; campaign: string|null; term: string|null; content: string|null;
  click_id: string|null; click_id_param: 'gclid'|'fbclid'|'msclkid'|…|null;
  referrer_host: string|null; landing_path: string|null; ref_code: string|null;
  landing_page: string|null; at: string /* ISO */ }
```

The whole object is `null` when there is no touch at all.

**`orders.items`** (legacy storefront line, read by `adjust/restore_stock_for_order` and the order confirmation):

```ts
Array<{
  id: string;                 // products.id uuid — lines whose id is not UUID-shaped are skipped by the stock RPC
  name: string;
  price: number;              // per-unit price
  quantity: number;
  strength?: string;
  unit?: 'vial' | 'case';     // 'case' multiplies stock demand by vials_per_box
  vials_per_box?: number;
  product_id?: string;        // confirmation accepts product_id ?? id
}>
```

**`orders.shipping_address` / `billing_address`** (legacy; keys accepted by the confirmation builder): `address|address1|line1`, `address2|line2`, `city`, `state|province`, `zip|postalCode|postal_code`, `country`, `firstName|first_name`, `lastName|last_name`, `name` and `phone`.

**`puramass_webhook_events.payload`** — the full Puramass body:

```
{ event_id, event_type ('store_order.payment_complete', …), referral_id, partner_reference,
  data: { status, occurred_at, transaction_id, order_id, payment_mode, currency,
          customer: {first_name,last_name,email,phone},
          shipping: {address,address2,city,state,zip,country} | null,
          items: [{sku,name,quantity,unit_price_cents}],
          (optionally nested under data.order, plus expires_at, refunded_total_cents, refunds) },
  metadata, created_at, patient_id, appointment_id }
```

`response_body` is the JSON returned, for example `{received:true, matched:true}`, `{received:true, deduped:true}` or `{error:'bad signature'}`.

**`discount_codes.excluded_product_ids`** — `UUID[]` (not jsonb), defaulting to `'{}'`.

**`customer_activity.metadata`** for `checkout_start`: `{ kind: 'puramass', items: number /* cart line count */, value: number /* CAD after ad_discount */ }`.

**`site_settings.admin_emails`** = `string[]`, `shipping_origin` = `{line_1, city, state, postal_code, country_alpha2, company, phone, email}`, `shipping_box` = `{length, width, height}`.

**`products.pack_options`** = `Array<{size:int 1..1000, label:string|null, price:number|null, compare_at:number|null, enabled:boolean}>` or NULL.

**`take_stock_for_invoice_lines.p_links`** = `Array<{line_id: uuid, product_id: uuid, vials_per_unit: int}>`.

---

### Schema — migration order to apply on the sibling

#### Diff: this repo vs `_live-schema-snapshot.sql` (Aminocan live, 2026-06-23)

The snapshot covers tables and columns only. It shows no indexes, triggers, policies, functions, CHECK constraints or FKs.

**Missing tables** (none of these are in the snapshot):

| table | needed for |
|---|---|
| `puramass_orders` | **everything** (hand-off ledger) |
| `puramass_webhook_events` | webhook log (the webhook still works without it; logging fails) |
| `puramass_address_requests` | missing-address flow |
| `discount_codes` | codes and landing offers (checkout fails closed without it) |
| `affiliate_payouts` | `commissions.payout_id` FK |
| `referral_code_requests` | vanity code flow (not checkout-critical) |
| `landing_pages`, `landing_page_daily` | landing offers |
| `visitor_attribution`, `customer_activity` | attribution, paid-ad welcome discount, funnel |
| `product_recommendations` | cart FBT block |
| `product_history` | **required**: every stock RPC inserts into it, so the stock decrement fails without it |
| `stealth_health_settings`, `stealth_health_invoices`, `stealth_health_payouts` (+ partner-settlement tables) | only if partner settlement is ported (`puramass_orders.settlement_invoice_id` FK) |

**Missing columns on existing tables:**

| table | missing columns |
|---|---|
| `site_settings` | `puramass_checkout_enabled`, `puramass_shipping_rates_enabled`, `puramass_flat_shipping`, `puramass_free_shipping_enabled`, `puramass_free_shipping_threshold`, `ad_discount_enabled`, `ad_discount_percent`, `cart_offer_enabled`, `cart_offer_min_items`, `cart_offer_percent`, `cart_offer_ends_at`, `cart_fbt_enabled`, `cart_similar_enabled`, `checkout_addons_enabled`, `cart_trust_strip_enabled`, `checkout_verify_notice_enabled`, `product_trust_badges_enabled`, `product_reviews_enabled`, `abandoned_checkout_hours`, `usd_exchange_rate`, `store_name`, `store_tagline`, `logo_url`, `favicon_url`, `ga4_measurement_id`, `meta_pixel_id`, `tracking_consent_required`, `gtm_container_id`, `klaviyo_*` (7) |
| `site_settings` (already present) | `checkout_type`, `admin_emails`, `pickup_address`, `guest_checkout_enabled`, `invoice_*`, `easyship_enabled`, `easyship_api_key`, `shipping_origin`, `shipping_box`, `shipping_item_weight_kg`, `shipping_flat_rate`, `shipping_handling_fee_type/value`, `easyship_auto_*`, `etransfer_*` |
| `products` | `puramass_sku`, `puramass_sku_vial`, `is_checkout_addon`, `vials_per_box`, `vial_price`, `price_usd`, `pack_sizes`, `pack_options`. **Without `vial_price` and `vials_per_box` both product selects in the checkout fail, and every checkout returns 500.** |
| `invoices` | `source`, `easyship_courier_id` (+ the other easyship/tracking/auto-shipment columns from `easyship-invoice-shipment-migration.sql`). Status CHECK must allow `pending_payment`/`expired` (current constraint unknown) |
| `invoice_line_items` | `price_type` (**critical**, see §9), `vials_per_unit` |
| `orders` | `idempotency_key`, `easyship_courier_id`, `confirmation_email_sent_at`, `attribution_channel`, `attribution_campaign`, `attribution` |
| `order_items` | `price_type` (invoice-spec §8; not checkout-critical) |
| `customers` | `attribution_channel`, `attribution_campaign`, `attribution`, `anonymous_id`, `attribution_landing_page` |
| `commissions` | `invoice_id`, `discount_code_id`, `payout_id`. `order_id` is `NOT NULL` in the snapshot and **must be dropped to nullable**. Add the `commissions_one_source` CHECK and the two unique partial indexes |
| `affiliate_requests` | `requested_code` |
| `referral_codes` | `code` must become `VARCHAR(32)` (the snapshot shows `varchar` with no length visible) |
| `fulfillment_email_log` | no column change. The snapshot comment says `kind ∈ {packed, shipped, etransfer_ack, etransfer_instructions, etransfer_admin_notice}`, so a CHECK probably exists and must be dropped |
| `affiliates` | none (`commission_rate` present) |

**Present in the sibling already, no action needed:** `orders.stock_adjusted`, `discount_amount`, `fulfillment_type`, `source`, `auto_shipment_*`, `payment_confirmations`, the nullable `crypto`, `invoices.stock_adjusted`, `currency`, `customer_phone`, `fulfillment_type/status`, `is_backorder`, `non_payable`, `customers.has_completed_first_order`, `affiliate_id`, `preferred_currency`, `backorders`/`backorder_items`, `pricelists`/`pricelist_items`/`customer_price_overrides`, `sales_*`.

#### Ordered list of files to run on the sibling

Every file below is idempotent. Run them in this order. Indented notes give dependencies and warnings.

1. `marketing-branding-migration.sql` — adds the tracking columns `ga4_measurement_id` and `tracking_consent_required`. Needed by step 2 and by the attribution consent gate.
2. `gtm-ga4-tracking-migration.sql` — **edit the seeded IDs** to the sibling's own, or note that this repo's seed *is* Aminocan's (`GTM-M2J3D7SG` / `G-F44F1BB1QV`).
3. `invoice-spec-integration-migration.sql` — adds `products.vials_per_box`, `vial_price`, `price_usd`, `site_settings.usd_exchange_rate`, `invoice_line_items.price_type` and `order_items.price_type`. It also adds invoice and customer items from the invoicing cluster (customer_deleted trigger, `uniq_invoices_order_id`, `customers.alternate_email` / `applied_pricelist_id`, `pricelists.description` / `created_by`, `customer_clients`). Review it, or run only §6–§8 if the invoicing cluster is not being ported.
4. `pack-options-content-migration.sql` (§1 `pack_sizes` only, if the rest of that file is not wanted), then `pack-option-pricing-migration.sql` (`pack_options`).
5. `puramass-hosted-checkout-migration.sql` — creates `puramass_orders`, the products SKU columns, `invoices.source` and `puramass_orders.invoice_id`.
6. `puramass-shipping-address-migration.sql`
7. `puramass-missing-address-migration.sql`
8. `puramass-order-details-migration.sql`
9. `shipping-handling-fee-migration.sql` — the sibling already has these columns, so this is a no-op.
10. `puramass-hosted-shipping-migration.sql`
11. `puramass-webhook-events-migration.sql`
12. `puramass-account-orders-migration.sql`
    > This also **backfills** `stealth_health` invoices to a $35 USD shipping fee and `currency='USD'`. On a fresh sibling there are no such rows, so it only links them and creates the index. Do not run it after real CAD hand-offs exist.
13. `easyship-invoice-shipment-migration.sql` — adds `invoices.easyship_courier_id` and related columns. It is part of the shipment cluster; review before running.
14. `easyship-courier-id-migration.sql` — `orders.easyship_courier_id`.
15. `product-history-migration.sql` — creates `product_history`. Its function bodies are superseded by steps 16–17.
16. `stock-ledger-migration.sql` — `product_history` again, the invoice status CHECK, `vials_per_unit`, the final invoice stock RPCs, `set_product_stock`, `take_stock_for_invoice_lines`, the `products_stock_ledger` trigger and the grants.
    > This **supersedes** `stealth-health-pending-invoice-migration.sql`, `restore-stock-for-invoice-migration.sql` and `stock-decrement-migration.sql`'s invoice function. **Do not** run `stock-decrement-migration.sql` afterwards: it would recreate `(uuid)` overloads of `adjust_stock_for_order` and `adjust_stock_for_invoice`.
17. `order-stock-decrement-jsonb-migration.sql`, then `fulfillment-ux-audit-migration.sql` (`orders.idempotency_key` and `restore_stock_for_order`), then `case-vial-stock-decrement-migration.sql` (final order RPCs). These are only needed if legacy `orders` remain in use.
18. `marketing-attribution-migration.sql` — needs `customers`, `orders` and `puramass_orders`. It creates `visitor_attribution` and `customer_activity`.
19. `ad-discount-promo-migration.sql` — needs `puramass_orders`.
20. `cart-upsells-migration.sql` — needs `puramass_orders` and `products`.
21. `checkout-addons-toggle-migration.sql`
22. `storefront-section-toggles-migration.sql`
23. `referral-code-requests-migration.sql` — needs `affiliates`, `referral_codes` and `affiliate_requests`.
24. `affiliate-discount-codes-payouts-migration.sql` — needs `affiliates`, `commissions` and `puramass_orders`. Creates `discount_codes` and `affiliate_payouts`, and replaces `update_affiliate_earnings()`.
25. `affiliate-commission-hosted-checkout-migration.sql` — needs `invoices` and `commissions`. Drops `order_id NOT NULL` and adds the unique indexes.
    > Before running, check for existing duplicate `order_id` rows. They would break `CREATE UNIQUE INDEX`. Rows with both columns NULL would violate `commissions_one_source`.
26. `landing-pages-migration.sql` — needs steps 18 and 24.
27. `landing-page-counters-migration.sql` — needs step 26.
28. `abandoned-checkout-recovery-migration.sql`
29. `order-confirmation-email-migration.sql` — needs `fulfillment_email_log`, `orders`, `puramass_orders` and `invoices`. Drops the `kind` CHECK.
30. `stealth-health-admin-paid-alert-migration.sql`
31. `supabase-cron-puramass-poll.sql` — needs pg_cron, pg_net and vault secrets `app_base_url` and `cron_secret`. Set the env var `PURAMASS_CRON_SECRET` or `CRON_SECRET` to match.
32. Optional:
    * `stealth-health-settlement-migration.sql` and `stealth-health-partner-settlement-migration.sql`, for partner settlement.
    * `security-hardening-migration.sql`. It concerns customers and is recommended if the sibling lacks it.
    * `catch-up-schema-migration.sql`. The sibling already has what it adds.
    * `migration-checkout-config.sql`, `migration-site-settings.sql`, `migration-confirmations.sql`, `orders-fulfillment-columns-migration.sql`, `affiliate-discount-commission-migration.sql` and `migration-affiliate-commission-rate.sql` are already satisfied on the sibling.
    > `migration-affiliate-commission-rate.sql`'s `ADD CONSTRAINT affiliates_commission_rate_check` is **not guarded** and errors if the constraint already exists. It also rejects rows that store a percentage (e.g. 10).
33. **Never run** on a live DB: `migration-orders-clean.sql` (it DROPs `orders`, `order_items` and `sol_addresses` CASCADE) or `migration-orders.sql` (its plain `CREATE INDEX` and `CREATE TRIGGER` without IF NOT EXISTS error on an existing DB).

---

### Schema — unverified / porting notes

**Unverified (not determinable from the repo):**

* The sibling's **constraints, FKs, indexes, triggers, policies and functions** are not in `_live-schema-snapshot.sql`. Specifically unknown:
  * the current `invoices_status_check`;
  * whether `commissions.order_id` has an FK to `orders`;
  * whether `fulfillment_email_log` has a `kind` CHECK;
  * whether `set_updated_at()`, `update_affiliate_earnings()` and `increment_code_usage()` exist on the sibling;
  * which `adjust_stock_for_invoice` overloads exist on the sibling.
* **`invoices.invoice_number` default on the sibling.** The snapshot lists `invoice_number text NOT NULL` with no default. The snapshot generator also drops serial defaults (`sol_addresses.id integer NOT NULL` shows none), so the omission proves nothing either way. The hosted checkout relies on the column default. Confirm `invoice_number_seq` and the default exist, or `createPendingStealthHealthInvoice` fails with a NOT NULL violation. The order is then only invoiced on payment, and that insert fails the same way.
* `referral_codes.code` length on the sibling: the snapshot shows only `varchar`.
* The shape of `puramass_orders.refunds` is whatever Puramass sends. It is undocumented here.
* Whether `lib/pricing.ts`'s `usd_exchange_rate` path is reached anywhere in the cart UI was not traced. The hand-off itself is always CAD.
* Whether the sibling's `customer_price_overrides.override_price` has the `CHECK (override_price >= 0)` constraint and `numeric(10,2)` precision: the snapshot shows plain `numeric`.
* `commissions.order_id`: `supabase-schema.sql` declares `VARCHAR(255) NOT NULL`, while `database-schema-complete.sql` and the live snapshot have `uuid`. The repo's live type is assumed to be uuid.
* (Verified, noted for the API section) `GET /api/admin/settings` has **no auth check**. It is the public path the cart and checkout use to read settings, and it returns `shape(data)`, which replaces `easyship_api_key` and the Klaviyo private key with booleans.

**Porting notes and gotchas:**

1. **RLS caveat, reproduced as written.** `"Service role full access" … FOR ALL USING (true) WITH CHECK (true)` has **no `TO service_role`**. It grants every role, including anon with the public anon key, full read and write on `puramass_orders` (emails, addresses, payment links), `puramass_address_requests`, `site_settings` (including `easyship_api_key` and `klaviyo_private_api_key`), `orders` and `invoices`. The app never uses the anon key on these tables. On the sibling, consider `CREATE POLICY … TO service_role`, or no policy at all (service role bypasses RLS). That is a deliberate deviation and should be recorded as one.
2. **`puramass_orders.invoice_id` has no FK.** The code tolerates a deleted invoice by recreating it for still-paid rows, and the heal sweep deliberately skips rows whose invoice is gone.
3. **Hosted sales never write `orders`.** "Has this customer ordered" must check `puramass_orders` (statuses `paid` and `payment_pending` consume the welcome discount; only `paid` counts for `first_order_only` codes), `customers.has_completed_first_order`, and legacy `orders`.
4. **Money units:**
   * `puramass_orders.*_cents` are integer cents of `currency` (CAD).
   * `invoices.*` are numeric CAD dollars.
   * `discount_codes.discount_value` is a percent or CAD.
   * `discount_codes.commission_rate` is a percent.
   * `affiliates.commission_rate` is a fraction (CHECK 0..1), but the code also accepts >1 as a percent.
   * `commissions.commission_rate` is stored as a percent (`round2(rate*100)`).
   * `cart_offer_percent` and `ad_discount_percent` are percents.
5. **Discount stacking is recorded on the ledger, not computed in SQL.**
   * `ad_discount_cents` is the **total** saving from the single composed split. `ad_discount_percent` is 0 when the ad discount was not the winner.
   * A discount code and the ad discount do not stack. Whichever takes more off wins, compared by effective percentage across eligible lines.
   * The cart offer composes with either one: `1-(1-a)(1-b)`.
   * If any line would price to ≤0 cents, the whole discount is dropped. `discount_code_*` is still recorded (with percent and cents 0) so that the code's usage and the affiliate credit still count.
6. **Stock is counted in vials.**
   * Hosted invoice lines carry `vials_per_unit = pack_size`.
   * Legacy `orders.items` lines use `unit='case'` together with `vials_per_box`.
   * Pre-ledger hand-offs whose lines have no `product_id` or `pack_size` take stock only for single-vial SKUs (`vials_per_unit=1`). Pack lines get `product_id=null` and show up under "Needs attention" for `take_stock_for_invoice_lines`.
7. **PostgREST schema cache.** Several migrations end with `NOTIFY pgrst, 'reload schema';`. Until it reloads, the app's missing-column fallbacks shed optional columns *silently*. Run the NOTIFY after the batch.
8. **`orders.discount_amount` is declared twice:** `numeric(10,2) NOT NULL DEFAULT 0` in `affiliate-discount-commission-migration.sql` and `numeric NOT NULL DEFAULT 0` in `orders-fulfillment-columns-migration.sql` and `catch-up-schema-migration.sql`. Whichever runs first wins the type. The sibling has `numeric`.
9. **`app/api/admin/orders` POST** inserts into `orders` without `items`, which is declared `JSONB NOT NULL` with no default. As written, that insert would violate the constraint. This is outside checkout scope and is noted only because it touches the same table.
10. **`migration-confirmations.sql`** is a single statement with no trailing newline (`wc -l` reports 0 lines). It is not empty.
11. **This repo's migrations already reference Aminocan.** The `aminocan_vid` and `aminocan_consent` cookies, the vault URL `https://aminocan.com`, the seeded Aminocan GTM and GA4 ids, the `amc_` prefix on `partner_reference`, and `tools/aminocan-mcp` in the snapshot header all point to code originally written for Aminocan. Before applying any seed or backfill `UPDATE`, check that it does not clobber Aminocan's own values.
12. **Partner reference prefix `amc_`.** The webhook matches orders by `transaction_id`, then by `partner_reference`. If the sibling shares a Puramass partner account with this site, both sites receive each other's webhooks. Unmatched ones are ACKed and logged as `unmatched`. Keep prefixes distinct per site so the logs are unambiguous.
13. **`site_settings` seed row.** `migration-site-settings.sql` inserts `admin_emails = ["codogmjo@gmail.com"]` if the table is empty. The sibling's row already exists, so `ON CONFLICT DO NOTHING` together with the singleton index makes it a no-op. Do not copy the email anyway.
14. **The `ad_discount_enabled` column defaults to `true`** (the code defaults it OFF when the column is absent). Running `ad-discount-promo-migration.sql` therefore switches the 25% paid-ads welcome discount **on** immediately. Set it to false right after if that is not wanted.
