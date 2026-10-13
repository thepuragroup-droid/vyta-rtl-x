# 02 — Checkout UI (client side) + post-payment pages

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

## Checkout — components

### `app/checkout/page.tsx` — `CheckoutPage` (default export)
- **Client** (`"use client"`). Route: `/checkout`.
- Renders `<Suspense fallback={<CheckoutLoadingScreen/>}><CheckoutRouter/></Suspense>`.
- No `metadata` export. No route-level `layout.tsx` in `app/checkout/`. The global root layout applies, with these effects on this page:
  - The page shows **no** `Navigation` or `Footer`. It draws its own header.
  - Global siblings still render: `AnnouncementBar`, which is hidden only on `/admin`, `/warehouse` and `/affiliate`, so it **does** show here; `ChatBubble`; `AgeVerification`; `SiteTracking`; `CustomerJourneyTracker`.
  - `FreeShippingToast` is silenced on `/checkout` because `/checkout` is in its `SILENT_PATHS = ["/admin","/warehouse","/affiliate","/cart","/checkout"]`.
  - `AuthGuard` treats `/checkout` as public. Only paths under the `/account` prefix are private.

### `CheckoutLoadingScreen` (in `page.tsx`)
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

### `CheckoutRouter` (in `page.tsx`)
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

### `app/checkout/PuramassCheckoutContent.tsx` — `PuramassCheckoutContent` (default export)
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

### Local sub-components in `PuramassCheckoutContent.tsx`

#### `FieldError({ message?: string })`
- Returns `null` when there is no message.
- Otherwise `<p className="mt-1.5 text-[11px] text-amber-700">` (6px top margin, 11px text, `#B45309`).

#### `RateOption({ rate, selected, free?, onSelect })`
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

#### `AddonSkeleton()`
- `flex items-center gap-3 rounded-xl border border-line p-3`, containing:
  - a 48px `h-12 w-12 rounded-lg bg-line/40 animate-pulse`;
  - two bars `h-3 w-3/4` (bg-line/40) and `h-2.5 w-1/2` (bg-line/30), both `rounded animate-pulse`, in `min-w-0 flex-1 space-y-2`;
  - a 36px `h-9 w-9 rounded-lg bg-line/40 animate-pulse`.

#### `AddonRow({ p, featured?, onAdd })`
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

#### `discountCodePercent(code, subtotal)`
- `raw` is `discountValue` for percent codes. For fixed codes it is `(discountValue/subtotal)*100`, or 0 when `subtotal <= 0`.
- Returns `min(99, max(0, round(raw*100)/100))`.

#### `readReferralCode()`
See effect 1 above.

### `components/AddressAutocomplete.tsx` (default export)
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

### `components/FreeShippingProgress.tsx` (default export)
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

### `contexts/PromosContext.tsx` — `PromosProvider` / `usePromos()`
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

### Other close dependencies
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

## Checkout — form & validation

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

## Checkout — flow & state machine

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

## Checkout — totals as displayed

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

## Checkout — UI/UX

### Wireframe — desktop (≥1024px, `lg`), add-ons enabled

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

### Wireframe — mobile (<1024px)

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

### Page shell
- Root: `min-h-screen bg-white`.
- **Header** (shared by all three branches):
  - Outer `bg-white border-b border-line`, inner `max-w-6xl mx-auto px-5 sm:px-8 py-6`, row `flex items-center justify-between`.
  - Left: `<Link href="/" className="flex items-center gap-3">` containing:
    - `<img src="/images/vyta-mark.png" alt="" aria-hidden className="relative w-10 h-10 object-contain">` (40×40);
    - a column with "VYTA" (`text-lg font-bold text-ink tracking-tight leading-none`) and "Secure Checkout" (`text-[10px] text-teal-dark tracking-[0.15em] font-medium uppercase mt-0.5`).
  - Right pill: `flex items-center gap-2 px-4 py-2 bg-surface rounded-full border border-line` containing `Lock w-4 h-4 text-teal-dark` and "SSL Encrypted" (`text-sm font-medium text-ink-muted`).
- Body wrapper: `px-5 sm:px-8 py-8 md:py-12`, i.e. 20px/32px sides and 32px (48px at ≥768px) vertical.
- Main container: `motion.div variants=containerVariants initial="hidden" animate="show" className="max-w-6xl mx-auto"`. Children stagger by 0.08s after a 0.04s delay. Each item fades in from y=16px over 0.45s with ease `[0.16,1,0.3,1]`.

### Empty-cart card
- `motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} transition={{duration:0.4, ease:[0.16,1,0.3,1]}}` with `max-w-lg mx-auto bg-surface rounded-2xl p-10 md:p-12 text-center border border-line` (max 512px; padding 40px, or 48px at ≥768px).
- Icon tile: `w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 border border-line` with `ShoppingCart w-8 h-8 text-ink-muted`.
- Heading: `h2 text-xl font-bold text-ink mb-2` "Your cart is empty".
- Body: `p text-ink-muted mb-6 text-sm` "Add some research compounds before checking out."
- CTA: `Link /products` with `inline-flex items-center gap-2 bg-ink hover:bg-ink/90 text-white px-6 py-3 rounded-xl font-semibold transition-all text-sm`, text "Browse Catalog", followed by `ArrowRight w-4 h-4`.
- The body wrapper here is `px-5 sm:px-8 py-12`.

### Account-required card
- Same motion as the empty-cart card. Classes: `max-w-lg mx-auto bg-white rounded-2xl p-8 md:p-10 text-center border border-line`.
- Icon tile: `w-16 h-16 bg-teal/10 rounded-2xl … mx-auto mb-4` with `Lock w-8 h-8 text-teal-dark`.
- Heading: "Account required" (`text-xl font-bold text-ink mb-2`).
- Body: "Please sign in to your account to continue to secure checkout." (`text-ink-muted mb-6 text-sm`).
- Buttons in `flex flex-col sm:flex-row gap-3 justify-center`:
  - "Continue Shopping" → `/products`: `px-6 py-2.5 border border-line rounded-xl text-sm font-medium text-ink hover:bg-surface transition-colors`.
  - "Sign in" → `/`: `px-6 py-2.5 bg-ink text-white rounded-xl text-sm font-medium hover:bg-ink/90 transition-colors`.

### Redirect explainer
- `motion.div variants=itemVariants`: `flex items-start gap-3 rounded-2xl border border-teal/30 bg-teal/5 p-4 mb-6`.
- Icon: `ShieldCheck w-5 h-5 text-teal-dark flex-shrink-0 mt-0.5`.
- Text block `text-sm text-ink`:
  - Bold line: "You'll finish on our secure checkout partner." (`font-semibold`).
  - Second line (`text-ink-muted mt-0.5`): "Your order is priced in Canadian dollars and payment is collected on the secure hosted checkout page. ", followed by one of:
    - when `shippingRatesEnabled`: "Tell us where it's going and pick a courier below — that shipping price is locked in before you pay."
    - otherwise: "Shipping and any applicable taxes are added there."

### Grid
- `grid grid-cols-1 gap-6` plus `lg:grid-cols-3` (add-ons on) or `lg:grid-cols-2`. Gap is 24px.
- Each column is a `motion.section variants=itemVariants`.

### Column 1 — Contact
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

### Column 2 — Complete your order (only if `addonsEnabled`)
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

### Column 3 — Your order (summary + CTA)
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

### Interaction and animation summary
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

## Post-payment pages

### `/order/success` — `app/order/success/page.tsx`
- **Client.** It is a legacy page. Its comment says it is no longer part of the checkout flow.
- `OrderSuccessRedirect` uses `useSearchParams()` to read `order` and `email`.
  - Effect: `router.replace('/order/track?order=…&email=…')`, copying only the parameters that are present, or `'/order/track'` when there are none.
  - Renders `min-h-screen flex items-center justify-center bg-white` containing `flex items-center gap-3 text-ink`, with `Loader2 w-5 h-5 animate-spin` and "Taking you to your order…" (`text-sm`).
- The Suspense fallback is the same centred layout with "Loading…" (`text-ink text-sm`).
- No data calls.

### `/order/track` — `app/order/track/page.tsx`
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

### `/shipping-address/[token]` — `app/shipping-address/[token]/page.tsx`
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

### `/account/orders` (skimmed; signed-in only)
- `AuthGuard` protects `/account/*`. Signed-out visitors are redirected to `/login?redirect=…`.
- `getCustomerOrders(customer.id)` merges two sources:
  - `orders` for this customer;
  - `invoices` with `source='stealth_health'` and status not in `(draft, pending_payment, expired)`.
- So a paid hosted order appears here as an invoice row, and its method label shows "Secure checkout".
- Detail page `/account/orders/[id]`: it can download an invoice (`/api/customer/orders/{id}/invoice?download=1`) and claim an order (`/api/customer/orders/{id}/claim`). Not detailed further: outside the checkout path.

---

## Checkout — config inputs read

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

## Checkout — unverified / porting notes

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
