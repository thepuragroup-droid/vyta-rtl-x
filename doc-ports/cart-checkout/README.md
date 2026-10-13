# Cart + Checkout + Payments + Admin — Port Guide

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

## How to use this guide

| File | Covers | Read it when you build |
|---|---|---|
| **README.md** (this file) | Architecture, pitfalls, port order, security fixes, decisions to make, QA plan, file inventory | Before anything else |
| [`01-cart.md`](./01-cart.md) | `CartContext`, `/cart` page, upsell blocks (Frequently Bought Together, You May Also Like), limited-time offer, free-shipping bar and toast, ad-discount notice, nav cart icon, promos context, recommendation ranking | The cart |
| [`02-checkout-ui.md`](./02-checkout-ui.md) | `/checkout` client (form, validation, address autocomplete, rates picker, discount/referral fields, add-ons, summary, submit and redirect), `/order/success`, `/order/track`, `/shipping-address/[token]` | The checkout screen and the customer pages after payment |
| [`03-checkout-server.md`](./03-checkout-server.md) | `POST /api/checkout/puramass` and every supporting route, the pricing engine (with a worked example run through the real functions), the partner API client, the ledger/invoice rows written, env vars | The order API and pricing |
| [`04-payment-lifecycle.md`](./04-payment-lifecycle.md) | Status state machine, webhook / poll cron / admin sync / refresh paths, stock decrement, confirmation and admin emails, Klaviyo, affiliate commission, Easyship hand-off, settlement, abandoned-checkout recovery, missing-address flow | Everything after the buyer pays |
| [`05-admin.md`](./05-admin.md) | Every admin screen and control: Settings, Promotions, Cart Upsells, Discount Codes, Landing Pages (offer parts), Stealth Health → Orders (plus dialogs), SKU sync/cleanup, confirmation/paid-alert email cards, dashboard widgets, roles, admin API routes | The admin side |
| [`06-schema.md`](./06-schema.md) | Every table, column, function, trigger, policy and cron involved; jsonb shapes; **migration order and the gap against the sibling's live schema** | The database (do this first) |

Each section has the same structure: components/routes → rules → UI/UX (Tailwind classes plus resolved
hex/px values) → config inputs → unverified/porting notes. Design tokens match those in
`doc-ports/product-detail-page.spec.md` §4.1 (ink `#07203A`, ink-muted `#56707F`, surface `#F7FAFB`,
line `#DCE7EB`, teal `#438B9E`, teal-dark `#1B5D83`, `rounded-xl` = 14px, `rounded-2xl` = 18px).

---

## 1. Architecture at a glance

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

## 2. Pitfalls up front (read before you write code)

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

## 3. Security issues: fix these, don't copy them

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

## 4. Decisions to make before porting

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

## 5. Brand-specific hard-codes to replace

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

## 6. Port order (phased checklist)

Each phase can be shipped and tested on its own. Section refs in brackets.

**Phase 0: prerequisites**
- [ ] Products + pricing already ported (`product-catalog-inventory-cluster.spec.md`,
      `pricing-cluster.spec.md`, `product-detail-page.spec.md`); `customers`, `affiliates`,
      `invoices`, `invoice_line_items` exist.
- [ ] Partner account for the sibling: partner id, API key, webhook secret; webhook URL registered;
      return URL decided (D2).

**Phase 1: database** [06]
- [ ] Apply the migrations in the order given in `06-schema.md` "migration order", which closes the
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

## 7. QA plan (run on the sibling before go-live)

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

## 8. Source inventory (files to read while porting)

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
