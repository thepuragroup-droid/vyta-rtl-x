# 05 — Admin: configuring and operating cart, checkout, payments and orders

Source repo: `thepuragroup-droid/vyta-rtl-x` (Next.js 15 App Router + Supabase + Tailwind).

**Naming.** In code the hosted payment processor is "Puramass" (`puramass_*` columns, `/api/admin/puramass/*`, `lib/payments/puramass*.ts`). Every admin label calls it **"Stealth Health"**. A port should keep that split: internal identifiers use `puramass`, UI copy uses the partner's display name. Env vars: `PURAMASS_API_KEY`, `PURAMASS_PARTNER_ID`, `PURAMASS_API_BASE_URL`, `PURAMASS_WEBHOOK_SECRET`. `isPuramassConfigured()` returns true only when **both** `PURAMASS_API_KEY` and `PURAMASS_PARTNER_ID` are set.

All admin pages are client components (`'use client'`) under `app/(admin)/admin/…`. They read the effective role from `useUserRole()`, which the layout exports.

---

## Admin — navigation & permissions

### Roles (`lib/permissions.ts`)

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

### Admin layout (`app/(admin)/admin/layout.tsx`)

- **Auth check on mount.** It calls `supabase.auth.getSession()`, then `POST /api/auth/customer` with `{ accessToken }` to get `customer.role`. If `canAccessAdmin(role)` passes, the panel renders. Otherwise:
  - **No session:** an inline login form appears (card titled "VYTA" / "Admin Panel"; Email and Password inputs; "Sign In" button; empty fields give the error "Enter your email and password"). It signs in with `supabase.auth.signInWithPassword`.
  - **Signed in but not staff:** "Access Denied", with the text "Your account does not have admin privileges." and a "Go Home" button.
  - **Error:** the text "Something went wrong. Try refreshing."
  - **While checking:** "Loading admin panel...".
- **Effective role and view switch.** Admin and assistant users can switch the panel to "Viewing as: Admin | Analytics" using `lib/admin/admin-view.ts`, which stores the choice in localStorage key `admin-view-mode`. While previewing, a violet banner reads "Viewing as Analytics staff. … Your own access has not changed." with a "Back to my view" button. Pages see the *effective* role. A route guard redirects to `adminLandingPage(effectiveRole)` when `!canAccessAdminPage(effectiveRole, pathname)`.
- **Assistant banner** (amber, on every page): "You have read-only access. Contact an administrator to make changes." The sidebar role label shows "· Read Only".
- **Sidebar.** Dark (`bg-ink text-white`), `w-64`, collapsing to `76px` on desktop (persisted in localStorage `admin-sidebar-collapsed`). On mobile it is an off-canvas drawer with a hamburger. Nav items the effective role cannot reach are filtered out.

### Nav entries relevant to this feature

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

### Auth mechanism for admin API routes

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

## Admin — Settings controls

**Page:** `/admin/settings` (`app/(admin)/admin/settings/page.tsx`).

- **Header:** H1 "Site Settings", subtitle "Global configuration for checkout, notifications, and shipping."
- **Read-only flag:** `isReadOnly = role === 'assistant'`. Every control has `disabled={isReadOnly}`.
- **Load:** `GET /api/admin/settings` (unauthenticated). The response is `{ settings }`, shaped as described under the API section.
- **Save:** every control calls `saveSettings(partial)`, which sends `PUT /api/admin/settings` with a Bearer token. Success shows the toast "Settings saved". Failure shows a toast with the server's `error`, or "Save failed".
- **Toggle behaviour:** toggles and select-cards update local state optimistically, then save immediately. Text and number inputs have an explicit Save button, and Enter also saves.
- **Storage:** all values live on the singleton row of `site_settings`.

**Component styles.** Each card is `bg-white rounded-xl border border-line p-5`: a 16px teal-dark icon, an `h2 font-semibold`, and a subtitle in `text-xs text-ink-muted`. A SelectCard is a two-up `grid sm:grid-cols-2 gap-3` button: `p-4 rounded-lg border`. When selected it gets `border-teal bg-teal/5` and a teal check circle at top-right. Each SelectCard has an icon, a title and a desc. `ToggleSwitch` is `components/admin/ToggleSwitch.tsx`, with props `checked, disabled, onChange, icon, label, description`.

### 1. Change Password (personal; not gated by read-only)

| Control | Type | Default | Column | Effect |
|---|---|---|---|---|
| `<ChangePasswordForm variant="admin" />` | form | — | Supabase auth | Changes the signed-in user's password. Not checkout-related |

### 2. Checkout Type — subtitle "How customers pay at checkout."

| Control label | Type | Default | Column | Storefront effect |
|---|---|---|---|---|
| "Email Invoice" — "Send an invoice; customer pays manually." / "Cryptocurrency" — "Accept BTC / ETH / SOL on-chain." | 2 SelectCards (`checkout_type: 'email' \| 'crypto'`) | `crypto` (any value other than `'email'` reads as `crypto`) | `site_settings.checkout_type` | **None found.** Nothing in `app/`, `components/`, `contexts/` or `lib/` reads `checkout_type`; the hosted Stealth Health checkout is the only checkout. Legacy/dead control. The footer info box still says "Checkout type changes take effect immediately on the storefront." Server validation error: "checkout_type must be email or crypto" |

### 3. Admin Email Notifications — subtitle "Recipients for operational alerts (orders, low stock)."

| Control | Type | Default | Column | Effect |
|---|---|---|---|---|
| email input (placeholder `admin@example.com`) + "Add" button (Enter also adds) | `type="email"` | `[]` | `site_settings.admin_emails` (text[]) | Recipients of operational alerts, including the admin "order paid" alert for Stealth Health invoices (`lib/admin/stealth-health-paid-alert`) and low-stock alerts. Fallback chain (`lib/admin/alert-recipients.ts`): `admin_emails` → env `ADMIN_ALERT_EMAILS` → `invoice_cc_emails` |
| Remove (Trash2 icon per row; hidden when read-only) | button | — | same | Removes the address and saves |

- **Client validation:** "Enter a valid email" (regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`), "Already added".
- **Server:** trims, de-duplicates and drops empty entries. Error: `Invalid email: <x>`.
- **Empty list text:** "No addresses added yet."

### 4. Registration Alerts — subtitle "Email the admin recipients above when a customer registers, and again if they never check out."

| Control | Type | Default | Column | Effect |
|---|---|---|---|---|
| "On new registration": Enabled ("Send an alert the moment a customer signs up.") / Disabled ("Don't send a registration alert.") | SelectCards | `true` | `registration_alert_enabled` | Admin email on signup |
| "Abandoned registration (no checkout)": Enabled ("Follow up if a customer doesn't check out in time.") / Disabled ("No follow-up alert.") | SelectCards | `true` | `abandoned_registration_enabled` | Admin follow-up email |
| "Send follow-up after (hours)" + Save; hint "Default 12 hours" | `number`, min 1, step 1; disabled when abandoned registration is off | `12` | `abandoned_registration_hours` | Delay before the follow-up. Client error: "Enter a whole number of hours (at least 1)". Server error: "abandoned_registration_hours must be a whole number of hours (>= 1)" |
| **"Abandoned checkout (started, never paid)"** "Treat as abandoned after (hours)" + Save; hint "Default 1 hour" | `number`, min 1, max 720, step 1 | `1` | `abandoned_checkout_hours` | Sets the window behind the **Abandoned** tab on Stealth Health → Orders (unpaid hand-offs older than N hours). Nothing is sent automatically. Client error: "Enter a whole number of hours between 1 and 720". Server error: "abandoned_checkout_hours must be a whole number of hours between 1 and 720". `loadAbandonedHours()` caps the value at 720 and falls back to 1 |

Help text under the abandoned-checkout field, verbatim: "How long a hosted checkout sits unpaid before the Abandoned tab on **Stealth Health Orders** lists it as a cart worth chasing. Nothing is sent automatically — the tab is where an admin picks a cart and emails the payment link back, optionally with a promo code."

### 5. Invoice Emails — subtitle "BCC recipients and the editable invoice email templates."

| Control | Type | Default | Column | Effect |
|---|---|---|---|---|
| email input (placeholder `bcc@example.com`) + Add, plus per-row remove | email list | `[]` | `invoice_cc_emails` | BCC on invoice emails (`app/api/admin/invoices/[id]/email`); also the last fallback for alerts |
| "Edit invoice email templates" (link, ChevronRight) | link | — | — | Goes to `/admin/settings/email-templates` |

That sub-page has H1 "Invoice Email Templates" and subtitle "Edit the customer and admin invoice emails."

- **Tabs:** customer and admin, each with Subject and Body fields.
- **Merge-variable buttons** insert `{{token}}`. There is a "Live preview" and a reset-to-default button.
- **Saving** sends `PUT /api/admin/settings` with `invoice_customer_email_subject`, `invoice_customer_email_body`, `invoice_admin_email_subject` and `invoice_admin_email_body` (plain strings). Defaults come from `lib/invoice-email-templates.ts`.
- **Scope:** these templates are for manual invoices, not the checkout confirmation.

### 5b. Error Tracking

- **Subtitle:** "Fallback log for background failures. Order emails now send after checkout completes, so this is where a failed send shows up."
- **Link:** "View error log (failed emails)" → `/admin/settings/error-log`. That page uses `app/api/admin/error-log`; it was not inspected in depth.

### 6. Pickup Address — subtitle "Shown to customers who choose local pickup."

| Control | Type | Default | Column | Effect |
|---|---|---|---|---|
| text input (placeholder `123 Main St, City, Province`) + Save; "Current: …" line below | text | `''` | `pickup_address` | **No storefront consumer found** by grep. Treat as legacy |

### 7. Guest Checkout — subtitle "Allow customers to check out without an account."

| Control | Type | Default | Column | Storefront effect |
|---|---|---|---|---|
| Enabled ("Guests can place orders.") / Disabled ("Account required to check out.") | SelectCards | `true` | `guest_checkout_enabled` | `app/checkout/page.tsx` reads `s.guest_checkout_enabled ?? true` and passes `guestCheckoutEnabled` to the checkout form. When false, an account is required |

### 7a. Storefront Sections — subtitle "Show or hide the optional sections on the product, cart and checkout pages."

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

### 7b. Stealth Health Checkout (the hosted payment processor)

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

### 8. Shipping (Easyship) — subtitle "Live-rate or flat-rate shipping via Easyship."

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

### 9. Klaviyo — subtitle "Email & SMS marketing: sync customers, orders and onsite activity to Klaviyo for flows, campaigns and signup forms."

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

### 10. Info box (blue), verbatim

"Checkout type changes take effect immediately on the storefront." / "Admin emails receive order and low-stock notifications." / "Email checkout requires SMTP/Resend configuration; crypto checkout requires wallet setup."

### Not on this page (checked)

- **Currency / USD rate.** The column `site_settings.usd_exchange_rate` exists (`invoice-spec-integration-migration.sql`, `numeric NOT NULL DEFAULT 1`). `app/(admin)/admin/products/page.tsx` tries to read `settings.usd_exchange_rate` from `GET /api/admin/settings`, but `shape()` does **not** return it and PUT does not accept it. The products page therefore always uses `DEFAULT_USD_RATE = 0.73` (`lib/pricing.ts`). **No admin control edits the USD rate.**
- **Branding and tracking IDs** are on `/admin/marketing` (below).
- **Free shipping, ad discount, cart offer and FBT** are on `/admin/promos` (below).

### Branding & Tracking (`/admin/marketing`) — checkout attribution and tracking parts

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

## Admin — Cart upsells

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

## Admin — Discount codes (incl. affiliate codes)

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

### `DiscountCodeModal` (`components/admin/affiliates/DiscountCodeModal.tsx`)

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

### Affiliate-side controls that affect checkout (`/admin/affiliates/[id]`)

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

## Admin — Promotions (first-order, ad discount, cart offer, landing promos)

**Page:** `/admin/promos` (`app/(admin)/admin/promos/page.tsx`).

- **Header:** Sparkles tile, H1 "Promotions", subtitle "Customer-facing offers on the storefront and hosted checkout."
- **Read-only:** `isReadOnly = role === 'assistant'`.
- **Load:** `GET /api/admin/settings`. Load error toast: "Failed to load promotions".
- **Save:** `PUT /api/admin/settings`. Toast "Promotions saved" or the server error.
- **Loading state:** spinner with "Loading promotions…".
- **Cards:** same style as the Settings cards. Running/Off are SelectCard-style buttons with ToggleRight/ToggleLeft icons and a teal check when selected.

### Card 1 — "Free shipping over a spend" (Truck)

Description, verbatim: "Once a cart's subtotal reaches the threshold, shipping is free — whichever courier the buyer picks at checkout. Their cart shows a progress bar with how much more they need to add. The subtotal is re-checked against the catalog when the order is placed, so the offer can't be claimed from the browser."

**Lock:** `locked = isReadOnly || !puramass_shipping_rates_enabled`. When rates are off, an amber box reads: "Live courier rates are switched off, so every order pays the flat shipping fee and there is nothing for this promo to waive. Turn on **Stealth Health Checkout → Shipping → Live courier rates** first. [Open Site Settings →]".

| Control | Type | Default | Column | Behaviour |
|---|---|---|---|---|
| "Running" ("Carts over the threshold ship free.") / "Off" ("Everyone pays for shipping as quoted.") | buttons | off | `puramass_free_shipping_enabled` | Running requires threshold > 0, otherwise the toast "Set a spend threshold above zero first.". It sends `{ puramass_free_shipping_enabled: true, puramass_free_shipping_threshold: N }`. Off sends `{ …enabled: false }` |
| "Spend threshold (CAD)" + "Save threshold" | number min 0 step 0.01, placeholder "e.g. 300"; hint "Goods only — shipping and taxes don't count toward it." | `0` (the input shows blank when 0) | `puramass_free_shipping_threshold` | Client error "Enter a threshold of zero or more." |
| Live banner (emerald) | text: "Live: carts of **$X.XX** or more ship free." | — | — | Shown when enabled and threshold > 0 |

**Effective rule** (`shapeHostedShippingSettings`): `freeShippingEnabled = ratesEnabled && puramass_free_shipping_enabled && threshold > 0`. The API exposes `puramass_free_shipping_active`. `PromosContext` and `app/checkout/page.tsx` read it to draw the cart progress bar and the free rate. `/api/checkout/puramass` re-checks against the catalogue-priced subtotal.

### Card 2 — "Paid-ads welcome discount" (Megaphone)

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

### Card 3 — "Limited-time cart offer" (Gift)

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

### Card 4 — "Cart suggestions" (Sparkles)

Description: "The two blocks under the cart's line items. Neither discounts anything — they only decide what gets suggested."

| Control | Type | Default | Column |
|---|---|---|---|
| "Frequently bought together" — "Your own pairings, set per product in **Cart Upsells**." | toggle button (ToggleRight/ToggleLeft) | `true` | `cart_fbt_enabled` |
| "You may also like" — "Ranked automatically from what customers buy together — nothing to configure." | toggle button | `true` | `cart_similar_enabled` (same as Settings → Cart page → You May Also Like) |
| "Edit the pairings →" | link | — | `/admin/cart-upsells` |

### Landing promos (`/admin/landing-pages`, promo parts)

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

## Admin — Orders / Puramass operations

### A. Stealth Health page shell (`/admin/stealth-health`, `app/(admin)/admin/stealth-health/page.tsx`)

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

### B. Orders tab (`_components/orders/OrdersTab.tsx`) — the hosted-checkout ledger (`puramass_orders`)

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

### C. RecoverCheckoutDialog (single abandoned cart)

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

### D. BulkRecoverDialog ("Chase these carts")

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

### E. RequestAddressDialog ("Ask for the shipping address")

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

### F. DeletePuramassOrdersDialog (admin)

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

### G. SKU sync and cleanup

These run from Settings → Stealth Health Checkout (§7b). Matching (`matchProductToPuramass` in `lib/payments/puramass-catalog.ts`):
- Uses the live catalogue (`fetchPuramassCatalog`), falling back to `PURAMASS_CATALOG_SNAPSHOT`.
- Only SKUs prefixed `vyta-` are considered.
- `…-vial` SKUs map to `puramass_sku_vial`; all others to `puramass_sku`.
- Only `exact`/`matched` results are written. Existing values are skipped unless `overwrite`.

### H. Legacy storefront orders (`/admin/orders`, hidden from the nav)

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

### I. Dashboard widgets (`/admin`, `app/(admin)/admin/page.tsx`)

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

### J. `PuramassInvoiceBlocks` (`components/admin/PuramassInvoiceBlocks.tsx`)

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

## Admin — Confirmation email & other checkout-related admin tools

### `OrderConfirmationEmailCard` (`components/admin/OrderConfirmationEmailCard.tsx`)

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

### Admin paid-alert email (`components/admin/AdminPaidAlertEmailCard.tsx`, on `/admin/invoices/[id]`)

- **Card:** H3 "Admin notification email", showing "Not sent" or the sent state.
- **Button:** "Send admin notification" / "Resend admin notification". If already sent, asks "The admin notification has already gone out {times}. Send it again?".
- **Recipients:** the Admin Email Notifications list.
- **API:** `GET` and `POST /api/admin/paid-alert-email`.

### Other tools

These are all covered in earlier sections:
- Recovery and outreach emails (§C, §D)
- Address requests (§E)
- Shipping diagnostics and Klaviyo test (Settings §8 and §9)
- Error log (`/admin/settings/error-log`)

---

## Admin — API routes

Conventions:
- **Auth:** "Bearer" means the `Authorization: Bearer <supabase access token>` header, resolved to `customers.role`.
- **Errors:** responses are JSON `{ error }` unless noted.

### GET /api/admin/settings
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

### PUT /api/admin/settings
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

### GET /api/admin/marketing
- **Auth:** Bearer, with `canViewAnalytics` (admin, assistant, analytics).
- **Response:** `{ config: SiteConfig }`.

### PUT /api/admin/marketing
- **Auth:** `canManageMarketing` (admin, analytics).
- **Body:** store_name, store_tagline, logo_url, favicon_url, hero_video_url, hero_image_url (trimmed; empty → null); gtm_container_id; ga4_measurement_id; meta_pixel_id; tracking_consent_required.
- **Errors:** "GTM Container ID should look like GTM-XXXXXXX", "GA4 Measurement ID should look like G-XXXXXXXXXX", "No editable fields provided".
- **DB:** upserts `site_settings`. Audit action `marketing.update`.
- **Response:** `{ success, config }`.

### GET /api/admin/product-recommendations
- **Auth:** `canAccessAdminPage(role,'/admin/cart-upsells')` (admin, assistant).
- **Response:** `{ recommendations, products, warning? }`.

### PUT /api/admin/product-recommendations
- **Auth:** `canEdit` (admin).
- **Body:** `{ productId, items:[{ recommendedProductId (or recommended_product_id), badge? }] }`.
- **Cleaning:** drops self-references and duplicates, keeps at most 6, truncates badges to 24 characters.
- **Errors:** "productId is required" / "items must be an array" (400); "Unknown product" (404); "One of those products no longer exists — reload and try again." (409); the migration hint (409) or the DB message (500).
- **DB:** deletes all rows for the product, then inserts `{product_id, recommended_product_id, badge, sort_order: index, enabled: true}`. Audit action `product_recommendations.update`.
- **Response:** `{ recommendations }` for that product.

### DELETE /api/admin/product-recommendations?productId=
- **Auth:** admin.
- **Effect:** clears that product's list. Audit action `product_recommendations.clear`.
- **Response:** `{ success: true }`.

### GET /api/admin/discount-codes[?affiliate_id=]
- **Auth:** `resolveStaffCaller(allowAssistant)`.
- **Response:** `{ codes: AdminDiscountCode[] }`, or `{ codes: [], migrationNeeded: true }` when the table is missing (42P01). Other failures: 500 "Could not load discount codes".

### POST /api/admin/discount-codes
- **Auth:** admin (`resolveStaffCaller`).
- **Body:** `{ code, affiliate_id, discount_type, discount_value, commission_rate, min_subtotal, max_uses, starts_at, expires_at, active, notes, first_order_only?, excluded_product_ids? }`.
- **Validation:** see the Discount codes section. Also "Affiliate not found" (404).
- **Errors:** `{CODE} is already in use.` (409); `RESTRICTIONS_NEED_MIGRATION` (400); "Could not create the code" (500).
- **DB:** inserts into `discount_codes` with `created_by`. Audit action `discount_code.create`.
- **Response:** `201 { code }`.

### PATCH /api/admin/discount-codes/[id]
- **Auth:** admin.
- **Body:** either `{ active: bool }` alone, or a full payload validated like a create.
- **Errors:** "That code is already in use." (409); "Code not found" (404); "Could not update the code" (500).
- **DB:** updates the row and `updated_at`. Audit action `discount_code.update`.
- **Response:** `{ code }`.

### DELETE /api/admin/discount-codes/[id]
- **Auth:** admin.
- **Refusal:** if any `puramass_orders` or `commissions` reference the code: 409 "This code has been used, so its history is kept. Deactivate it instead."
- **Audit:** `discount_code.delete`.
- **Response:** `{ deleted: true }`.

### GET /api/admin/landing-pages[?days=]
- **Auth:** staff (admin or assistant).
- **Response:** `{ landingPages, countersMissing }`, or `{ landingPages: [], migrationNeeded: true }`.

### POST /api/admin/landing-pages
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

### PATCH /api/admin/landing-pages/[id]
- **Auth:** admin.
- **Body:** `{ active }` alone, or a full payload. A full payload edits or creates the code in place (forcing `discount_type='percent', active=true`). A null offer deactivates the existing code.
- **Errors:** "Landing page not found" (404).
- **Response:** `{ ok: true }`.

### DELETE /api/admin/landing-pages/[id]
- **Auth:** admin.
- **Refusal:** if any `puramass_orders.landing_page = slug`: 409 "Orders came through this landing page, so its history is kept. Switch it off instead."
- **Code handling:** the code is deleted when unused, otherwise deactivated.
- **Response:** `{ deleted: true }`.

### GET /api/admin/puramass/orders
- **Auth:** Bearer, admin or assistant. Error `403 Unauthorized`.
- **Query:** `page` (0-based), `pageSize` (1–100, default 25), `status` (comma list), `abandoned=1`, `q` (≤120 characters).
- **DB:** `puramass_orders` with `count: 'exact'`, ordered by `created_at desc`. The column ladder steps down when address or recovery columns are missing.
  - Core columns: `id, partner_reference, transaction_id, payment_link, status, subtotal_cents, customer_id, customer_email, items, referral_code, paid_at, currency, created_at, updated_at, invoice_id`.
  - Address columns: `customer_name, customer_phone, shipping_address, shipping_address_source, shipping_address_updated_at, address_requested_at`.
  - Recovery columns: `recovery_email_sent_at, recovery_email_count, recovery_promo_code, recovery_discount_type, recovery_discount_value`.
  - Joins `invoices` (id, invoice_number, customer_id, customer_email, status, fulfillment_status, fulfillment_type, due_date, packed_at, fulfilled_at, currency, subtotal, shipping_cost, total, created_at), confirmation summaries, and the referral-code → affiliate lookup.
- **Response:** `{ orders, total, page, pageSize, addressesAvailable, recoveryAvailable, abandonedHours, counts: { all, payment_pending, paid, expired, cancelled, abandoned } }`. The counts honour the search.
- **Error:** `500 "Could not load orders: <msg>"`.

### DELETE /api/admin/puramass/orders
- **Auth:** admin only.
- **Body:** `{ ids: string[], cascadeInvoice?: boolean }`.
- **Errors:** "Invalid JSON body" / "ids[] is required." (400); "No matching orders found." (404); "Could not load the orders to delete." / "Could not delete the orders." (500).
- **DB:** deletes the `puramass_orders` rows. When `cascadeInvoice` is set, also deletes the linked `invoices`; a failure there is returned as `warning: "Orders deleted, but linked invoice cleanup failed: …"`.
- **Audit:** `puramass.order_delete` or `puramass.order_delete_cascade`, per id.
- **Response:** `{ ok, deleted, linkedInvoices, invoicesDeleted, warning? }`.

### POST /api/admin/puramass/orders/refresh
- **Auth:** admin or assistant.
- **Errors:** "Stealth Health is not configured." (503); "transaction_id is required." (400); partner 4xx → the partner's detail with the same status; other failures → 502 "Could not reach Stealth Health."
- **Body:** `{ transaction_id }`.
- **Partner call:** `fetchPuramassOrderStatus`.
- **DB update:** status, currency, subtotal_cents, paid_at (when paid), the contact/address patch (never clears existing values), and expires_at, refunds and items (`buildPuramassOrderDetailPatch`). Falls back to fewer columns if they are missing. When paid, it calls `materializeStealthHealthFulfillment`, which creates the invoice (idempotent).
- **Errors after update:** 404 "No matching order found."; 500 "Could not update the order: …".
- **Response:** `{ success, status, order }`.

### POST /api/admin/puramass/orders/sync
- **Auth:** admin or assistant. Returns 503 if Puramass is not configured.
- **Body** (optional): `{ ids?, statuses?, limit? }`. Only rows with a transaction id are considered.
- **Limits:** at most 250 rows, 6 concurrent partner reads, and the run stops on a 429.
- **Processing:** each row goes through `applyPuramassStatus` (the same function the cron uses).
- **Response:** `{ total, polled, changed, paid, addresses, errors, rate_limited }`.

### GET /api/admin/puramass/orders/recover?id=
- **Auth:** admin or assistant.
- **Errors:** "id is required." (400); "No matching order found." (404).
- **Response:** `{ order: { id, reference, status, payment_link, customer_email, customer_name, created_at, recoverable }, firstName, cart, checkoutNote, senderName, recovery: { recovery_email_sent_at, recovery_email_count, recovery_promo_code, recovery_discount_type, recovery_discount_value } }`.

### POST /api/admin/puramass/orders/recover
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

### POST /api/admin/puramass/orders/request-address
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

### POST /api/admin/puramass/sync-skus
- **Auth:** admin only.
- **Body:** `{ overwrite?, dryRun? }`.
- **Response:** `{ source: 'live'|'snapshot', catalog_count, partner_catalog_count, dry_run, vial_column_available, counts: { updated, skipped_already_set, ambiguous, unmatched }, by_mapping: { box, vial }, updated[], skipped_already_set[], ambiguous[{id,name,mapping,candidates}], unmatched[] }`.
- **DB:** writes `products.puramass_sku` and `puramass_sku_vial` (active products only). Audit action `puramass.sync_skus`.
- **Error:** 500 "Could not load products."

### POST /api/admin/puramass/cleanup-skus
- **Auth:** admin only.
- **Body:** `{ dryRun? }`.
- **Effect:** nulls any mapping whose value does not start with `vyta-`.
- **Response:** `{ dry_run, vial_column_available, cleared_products, cleared_box, cleared_vial, cleared_values, products: names[] }`. Audit action `puramass.cleanup_skus`.

### GET /api/admin/confirmation-email?orderId|invoiceId|puramassOrderId=
- **Auth:** admin or assistant.
- **Error:** 400 "Pass orderId, invoiceId or puramassOrderId." (the id must be a UUID).
- **Response:** `{ applicable: false }` or `{ applicable: true, kind: 'storefront'|'stealth_health'|'manual', summary: { sendCount, lastSentAt, lastSentTo, lastSentBy, lastAttemptFailed, lastError }, history[], recipient, orderNumber, blockedReason }`.

### POST /api/admin/confirmation-email
- **Auth:** **admin only**. Assistants can read but not send.
- **Body:** `{ orderId } | { invoiceId } | { puramassOrderId }`.
- **Errors:** 404 "No order or invoice found for this." / "Invoice not found." / "Order not found."; 422 "Mark the invoice paid first…" / "This order isn’t paid yet — the confirmation goes out once it’s paid." / a no-email reason; 502 on mail failure.
- **DB:** logs to `fulfillment_email_log`. Audit action `order.confirmation_email_sent`.
- **Response:** `{ success, to, sent_at }`.

### GET /api/admin/paid-alert-email?invoiceId= / POST /api/admin/paid-alert-email
- **GET auth:** admin or assistant.
- **POST:** admin only; body `{ invoiceId }`; audit action `invoice.admin_paid_alert_sent`.
- **Errors:** "Pass invoiceId."

### GET /api/admin/customers/outreach and POST /api/admin/customers/outreach
- **Auth:** CRM actor (admin or assistant, per its comment).
- **GET:** `?ids=` (resolve), `?q=&abandoned=&exclude=` (search, ≤50 candidates), `?history=1`.
- **POST body:** `{ templateKey, subject, body, promoCode, promoDetails, promoExpires, cc, discountType, discountValue, attachCheckout, recipients: ids[], suppress? }`.
- **Errors:** "A subject is required." / "The message body is empty." / "Unknown template" / "Pick at least one recipient." / "One send can address at most 40 customers. Send this batch, then pick the rest." / `Not a valid CC address: …` / "Too many CC addresses (max 10)." / discount errors as in recover / 404 "None of those recipients could be found."
- **Response:** `{ ok, sent, failed, withCart, logged, unresolved, skipped, results, cc }`. Status is 200 if anything was sent, otherwise 502 with an error.

### GET /api/admin/shipping/diagnose
- **Auth:** admin or assistant.
- **Response:** `{ ok, base_url, db_read_ok, settings_row_present, easyship_columns_present, enabled, has_api_key, origin_complete, reachable, webhook_secret_set, errors[] }`.

### POST /api/admin/klaviyo/test and POST /api/admin/klaviyo/sync-customers
- **Auth:** admin only.
- **sync-customers errors:** "Save a Klaviyo private API key first." / "Choose a newsletter list first."

### GET /api/admin/orders and POST /api/admin/orders (legacy)
- **GET:** admin or assistant. Filters `status, search, date_from, date_to, customer_id`. Returns `{ orders }` with customer_name, customer_email and customer_phone.
- **POST:** admin only. Body `{ customer_id, billing_address, shipping_address, shipping_method, notes, staff_notes, items[{product_variant_id, sku_snapshot, name_snapshot, qty, unit_price, discount_pct}], tax_total, shipping_cost, discount_total }`.
  - Error: "At least one order item is required".
  - Creates `orders` (number `ORD-YYMM-#####`, status pending) and `order_items`, then a draft invoice and an Easyship shipment (forced).
  - Response: `201 { order }`.

### GET/PATCH/DELETE /api/admin/orders/[id] (legacy)
- **GET:** admin or assistant.
- **PATCH:** admin only.
  - Body: `{ status?, billing_address, shipping_address, notes, staff_notes, shipping_method, shipping_carrier, tracking_number }`.
  - Error 422 "Order can only be edited while pending or confirmed".
  - Status `confirmed`: runs an oversell guard (422 `Insufficient stock to confirm: "X" has N on hand but the order needs M. Restock or create a backorder first.`, code `insufficient_stock`), decrements stock, creates the invoice, sets `customers.has_completed_first_order=true`, and sends the confirmation email once.
  - `cancelled` / `refunded`: restores stock.
  - `packed` / `shipped` / `delivered` / `refunded`: set the matching timestamps.
  - Sends a Klaviyo status event.
- **DELETE:** admin only. Deletes linked invoices, commissions, crypto_transactions, shipment_auto_logs, sol_addresses and order_items, then the order. Audit action `order.delete`.

### Other legacy order routes
- **POST /api/admin/orders/[id]/refund:** admin. Body `{ full_refund, line_items[{order_item_id, qty, restock}], reason }`. Error 422 `Cannot refund order with status "x"`.
- **create-shipment / buy-label:** admin.
- **rates / label-readiness / report:** admin or assistant.
- **label:** admin, assistant or warehouse.
- **shipping-address PATCH:** admin or assistant.

### Price lists and overrides (they set the catalogue prices checkout charges)
- **`GET/POST /api/admin/pricelists`:** GET admin or assistant; POST admin. Error "Pricelist name is required"; a new list is seeded from products.
- **`GET/PATCH/DELETE /api/admin/pricelists/[id]`:** PATCH `{ name, is_active, items }`. Setting `is_active: true` deactivates every other list.
- **`POST /api/admin/pricelists/[id]/apply-to-customer`:** admin. Body `{ customer_id, mode: 'override'|'keep_existing' }`. Upserts into `customer_price_overrides` and stamps `customers.applied_pricelist_id`. Response `{ applied, skipped, mode, … }`.
- **`GET /api/admin/price-overrides`:** admin, assistant or affiliate. Filters `?customer_id` / `?product_id`.
- **`POST /api/admin/price-overrides`:** admin or affiliate (own customers only). Upserts `{ customer_id, product_id, override_price }`. Errors: "customer_id and product_id are required", "override_price must be a non-negative number", "You can only price your own customers".
- **`DELETE /api/admin/price-overrides?id=`** or by `(customer_id, product_id)`.
- **`/api/admin/price-overrides/import`:** GET returns the template; POST takes a multipart file plus `customer_id`.
- **Checkout effect:** `/api/checkout/puramass` prices each line with `resolvePriceMap` (`lib/pricing/resolve.ts`): `customer_price_overrides.override_price` → active `pricelist_items.price` → `products.price`. An override or pricelist price restates the per-vial price and drops the catalogue pack prices (`pack_options`). Promo discounts are then applied on top.
- **Pricing page:** `/admin/pricing`, H1 "Pricing", toggle between "Price Lists" and "Customer Pricing".

### Stealth Health settlement routes
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

## Admin — UI layout notes

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

## Admin — unverified / porting notes

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
