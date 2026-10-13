# 03 — Checkout: SERVER side of placing an order

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

## Server — API routes

### Shared: rate limiter (`lib/rate-limit.ts`)

- It is an in-memory `Map<string,{count,resetAt}>`, held per server instance. It is **not** distributed.
- `checkRateLimit(key, {max, windowMs})`:
  - The first hit, or a hit after `resetAt`, sets `count = 1` and `resetAt = now + windowMs`, then returns `{allowed:true, retryAfter:0}`.
  - If `count >= max`, it returns `{allowed:false, retryAfter: ceil((resetAt-now)/1000)}`.
  - Otherwise it increments `count`.
- `RATE_LIMITS = { orders: {max:5, windowMs:60_000}, general: {max:60, windowMs:60_000} }`.
- `getClientIp(req)` returns, in order: the first entry of `x-forwarded-for`, trimmed; then `x-real-ip`; then `'127.0.0.1'`.

### Shared: bearer auth pattern

- `const token = req.headers.get('authorization')?.replace('Bearer ', '')`, followed by `db.auth.getUser(token)` on the service-role client.
- The storefront session is held in localStorage, so the browser sends `Authorization: Bearer <access_token>`. Cookies are not used for auth.

---

### `POST /api/checkout/puramass` — create the hosted order (THE order endpoint)

File: `app/api/checkout/puramass/route.ts`. It imports `after` from `next/server`.

**Auth:** optional bearer. A guest gets `customerId = null`. A bearer that fails to resolve is silently treated as a guest.

**Rate limit:** key `puramass:${ip}`, `RATE_LIMITS.orders` (5 per 60s per IP).

#### Request body (JSON)

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

#### Processing, in exact order (every early return is listed)

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

### `POST /api/checkout/puramass/rates` — courier options for the checkout screen

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

### `POST /api/checkout/discount-code` — preview a code (display only)

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

### `POST /api/checkout/referral-code` — does an affiliate code match anyone?

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

### `GET /api/promos/first-order` — is the signed-in buyer still on their first order (display only)

File: `app/api/promos/first-order/route.ts`. Uses `getSupabase()`.
- **Auth:** bearer is **required**.
  - Missing token → `401 {"firstOrder": false}`.
  - `getUser` returns no user → `401 {"firstOrder": false}`.
- **Processing:** `isCustomerFirstOrder(db, user.id)`.
- **Response:** `200 {"firstOrder": boolean}` with header `Cache-Control: no-store`.

It decides no money. The hand-off calls `isCustomerFirstOrder` again for itself.

---

### `GET /api/promos/landing` — the landing-page offer this visitor holds (display only)

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

### `POST /api/shipping/rates` — legacy storefront Easyship quote (not used by the hosted checkout)

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

### `GET /api/shipping/address-autocomplete?q=` — Canada-only address suggestions

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

### `POST /api/orders` → 410; `GET /api/orders?orderNumber=&email=` — public order lookup (legacy `orders` table)

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

### `GET /api/orders/my-orders` — signed-in customer's legacy orders

File: `app/api/orders/my-orders/route.ts`. Uses `getSupabase()`.

- **Auth:** bearer is required.
  - Missing token → `401 {"error":"Not authenticated"}`.
  - No user → `401 {"error":"Not authenticated"}`.
- **Query:** `orders.select('order_number, status, total, crypto, payment_tx_hash, tracking_number, created_at').eq('customer_id', user.id).order('created_at', {ascending:false})`.
- **Errors:** a DB error → `500 {"error":"Failed to fetch orders"}`.
- **Response:** the array (an empty array when there are no rows).
- **Note:** only legacy `orders` rows are returned. I found no client caller in app/components; it is only mentioned in a comment. Hosted orders show in the account through `invoices` (source `stealth_health`), via `lib/customer/api.ts`, which is outside this section.

---

### `GET /api/site-config` — public branding/tracking config

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

### (Post-payment, for completeness) `POST /api/webhooks/stealth-health` and `GET /api/cron/puramass-poll`

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

## Server — pricing engine

All money is **CAD**. The hand-off currency is `PURAMASS_CURRENCY = 'cad'`, lower-case. The partner order is denominated in CAD so the hosted page charges our CAD prices; it does not convert to the partner's USD listings. USD helpers exist in `lib/pricing.ts` (`usdFromCad`, `DEFAULT_USD_RATE = 0.73`, `products.price_usd`), but **checkout does not use them**.

### 1. Line price, per pack (`priceCartLines` in the route)

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

### 2. Subtotals

- `listSubtotalCents = Σ(unitPriceCents × quantity)` over the merged SKU lines, **after** each quantity is clamped to 1–99.
- `goodsSubtotal` (CAD) is the same figure divided by 100. Free shipping is measured against it, at **list** price before any discount.
- `cartUnits` (used by the cart offer) is counted from the raw lines **before** merging and clamping: `Σ max(1, round(vials/round(packSize)))`.

### 3. Automatic promo A — paid-ads welcome discount (`lib/promos/ad-discount.ts`)

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

### 4. Automatic promo B — limited-time cart offer (`lib/promos/cart-offer.ts`)

**Settings:** `shapeCartOfferSettings(row)`:
- `percent = min(99, clampDiscountPercent(row.cart_offer_percent ?? 10))`
- `enabled = !!row.cart_offer_enabled && percent > 0`
- `minItems = clampMinItems(row.cart_offer_min_items ?? 2)`, where the clamp is `floor(n)` within 1..99
- `endsAt` is the ISO string of `cart_offer_ends_at`, or null if it is unparseable

**`qualifiesForCartOffer(settings, cartUnits, now=Date.now())`:** enabled, percent > 0, not expired, and `floor(cartUnits) >= minItems`.
- `cartOfferExpired` is true only when `endsAt` is set, parses, and `end <= now`.
- An unparseable end date is treated as no end date.

The offer is open to guests. Its unlock is inclusive: minItems 2 unlocks at exactly 2 units.

### 5. Discount code (typed, or the landing-page default) (`lib/affiliate/discount-codes.ts`)

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

### 6. Landing-page offer (`lib/promos/landing.ts`, `landing-server.ts`)

- **Source:** the `vyta_lp` cookie, set by `middleware.ts` from `?lp=<slug>`. It has a 30-day max-age (`LANDING_COOKIE_MAX_AGE`).
- **`resolveLandingOffer(db, slug)`:**
  1. Reads `landing_pages(*)` by slug. It must exist and have `active = true`.
  2. Reads `discount_codes(*)` by `landing.discount_code_id`.
  3. Applies `landingOfferFrom`: the code must be active, `discount_type === 'percent'`, started, and not expired. `percent = min(99, round2(discount_value))` and must be > 0. Otherwise there is no offer.
- **How it is used:** only to **default** `codeToApply` when the buyer typed no code and did not send `declineLandingOffer:true`. It then goes through exactly the same `lookupDiscountCode`. A landing code that fails lookup is dropped silently (logged with `console.info`). A **typed** code that fails is a 400.
- **Not an independent discount.** The landing offer **is** the discount code. It can never stack with a typed code.

### 7. First-order promo

There is no separate "first-order promo" discount. "First order" is a **condition**:
- On the ad discount, through `isCustomerFirstOrder`, where pending counts.
- On `first_order_only` discount codes, through `firstOrderStatus`, where only paid counts.

`/api/promos/first-order` exposes the first of these to the UI.

### 8. How they stack (authoritative)

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

### 9. Splitting the discount onto line prices (`distributeLineDiscounts` → `distributeAdDiscount`)

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

### 10. Shipping (`resolveHostedShipping` in the route, plus `lib/payments/puramass-{settings,shipping,rates-server}.ts`)

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

### 11. Totals, tax, rounding

- **Tax:** none is computed. The partner handles tax, and the invoice is written with `tax_total: 0`.
- **Charged goods** = `Σ discountedUnitPriceCents × qty`.
- **Charged total** = goods + `shippingTotalCents`, as computed by the partner. The partner's own total is not read back; only `subtotal_cents` is stored.
- **Rounding:** cents are integers throughout. Discount splits floor first, then hand cents back. Rates are rounded to cents after the fee. The invoice uses `round2` (`+n.toFixed(2)` in the fulfillment module).

### 12. Worked example (verified by running the real lib functions)

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

## Server — Puramass payment integration

Files:
- `lib/payments/puramass.ts`: the client. Server-only; it imports `node:crypto`.
- `lib/payments/puramass-settlement.ts`: the settlement ledger, `GET /partner/settlement`, which is not used at checkout.

### Config (read at call time)

```ts
apiKey        = process.env.PURAMASS_API_KEY || ''
partnerId     = process.env.PURAMASS_PARTNER_ID || 'ptr_puramass'
baseUrl       = (process.env.PURAMASS_API_BASE_URL || 'https://api.stealth.health').replace(/\/+$/, '')
webhookSecret = process.env.PURAMASS_WEBHOOK_SECRET || ''
isPuramassConfigured()        = Boolean(apiKey && partnerId)
isPuramassWebhookConfigured() = Boolean(webhookSecret)
```

### Transport: `puramassFetch(path, init)`

- If there is no apiKey, it throws `PuramassApiError(503, 'Stealth Health is not configured')`.
- `fetch(baseUrl + path, {...init, cache:'no-store', signal, headers: {'X-Partner-ID': partnerId, 'X-Api-Key': apiKey, ...init.headers}})`.
- Timeout is 20 000 ms through an `AbortController`. An abort throws `PuramassApiError(504, 'Stealth Health request timed out')`. Any other fetch error throws `PuramassApiError(502, 'Could not reach Stealth Health')`.
- The body is read as text and parsed as JSON; an empty or invalid body becomes `{}`.
- A non-2xx response throws `PuramassApiError(res.status, sanitizeDetail(json))`. `sanitizeDetail` takes the first non-empty string among `error`, `message`, `detail` and `JSON.stringify(errors)`, trimmed and cut to 300 characters. Otherwise the detail is `Stealth Health API error <status>`.
- `class PuramassApiError extends Error { status: number; detail: string; name = 'PuramassApiError' }`.

### Endpoints used

| Method/path | Used by | Request | Response handling |
|---|---|---|---|
| `POST /partner/store/orders` | checkout (`createPuramassOrder`) | JSON body below, header `Content-Type: application/json` | `order = json.order ?? json`; `payment_link = order.payment_link ?? order.paymentLink`; `transaction_id = order.transaction_id ?? order.transactionId`. If either is missing, throws `PuramassApiError(502,'Stealth Health did not return a payment link')`. Returns `{status: String(order.status ?? 'payment_pending'), transaction_id, payment_link, currency: lower-cased string or null, subtotal_cents: Number(order.subtotal_cents ?? 0) \|\| 0, items: array or []}` |
| `GET /partner/store/orders/{encodeURIComponent(transaction_id)}` | poller and admin refresh (`fetchPuramassOrderStatus`) | — | `{transaction_id, status, partner_reference, currency, subtotal_cents, payment_link, created_at, paid_at, expires_at, items, refunded_total_cents, refunds, shipping: normalizePuramassShipping(order.shipping ?? order.shipping_address), customer: normalizePuramassContact(order.customer)}` |
| `GET /partner/store/products` | admin SKU sync only (`fetchPuramassCatalog`) | — | Accepts a bare array, `{products:[]}` or `{data:[]}`. Price is read as `price_cents`, or `price`×100. Normalised to `{sku, name, price_cents, image}`; entries without a sku are dropped |
| Webhook in: `store_order.payment_complete` | `/api/webhooks/stealth-health` | `X-Stealth-Signature: sha256=<hex HMAC-SHA256(rawBody, PURAMASS_WEBHOOK_SECRET)>` | see the routes section |

### Create-order body: `buildPuramassOrderBody(args)` (exact)

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

### SKU / catalog mapping

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

### Hosted checkout session details

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

## Server — order record

The hosted checkout writes **no `orders` row and no `order_items` rows**. The order record is:
1. `puramass_orders`: the hand-off ledger, one row per hand-off.
2. `invoices`, with `source='stealth_health'` and `status='pending_payment'`, plus `invoice_line_items`. This is the fulfillment record.

### 1. `puramass_orders` row written at checkout

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

### 2. `invoices` row (pending) — `createPendingStealthHealthInvoice` in `lib/payments/puramass-fulfillment.ts`

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

### Stock handling timing

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

### Affiliate/referral fields

- At checkout: `puramass_orders.referral_code` (raw string) and `discount_code_id` / `discount_code` are recorded.
- **No commission is written at checkout.** Commission is booked on payment; see side-effects.

---

## Server — side-effects

### At hand-off (`POST /api/checkout/puramass`)

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

### At payment (webhook / poll / admin refresh → `materializeStealthHealthFulfillment`)

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

## Server — env vars & secrets

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

## Server — unverified / porting notes

### Unverified

1. **Partner response contract.** What `order.status` actually returns on create (the code defaults to `'payment_pending'`). Whether `subtotal_cents` is pre- or post-discount, and whether it includes shipping. The commission base trusts `subtotal_cents`; I assume it is the goods total of our discounted `unit_price_cents × quantity`, but nothing in the repo confirms it.
2. **Partner idempotency.** Whether the partner really dedupes on `partner_reference`. The client doc comment claims it, but our route never reuses a reference.
3. **Return/cancel URL after payment.** No URL is sent in the body. Where the buyer lands afterwards (for example an order-confirmation page) must be configured in the partner portal, or is not configurable. The repo does not show it.
4. **Webhook event types and payload.** Only `store_order.payment_complete` is named in comments. The handler reacts to `data.status` values `paid`, `expired` and `cancelled`, and stores any other status string verbatim.
5. **Middleware.** How `middleware.ts` writes `aminocan_attr`, `aminocan_attr_last`, `aminocan_vid`, `ref_code` and `vyta_lp`: their exact encoding and expiry, other than `vyta_lp`'s 30-day max-age and the touch encoding in `lib/analytics/attribution.ts` (`encodeTouch`/`decodeTouch` use compact keys, URI-encoded JSON). That file is outside this section.
6. **Settings reach the storefront by another route.** Which public route serves the hosted shipping and promo settings (free-shipping threshold, cart offer, ad discount) to the storefront. It is not `/api/site-config`; probably an admin or public settings route, outside this scope.
7. **Ad-discount percentage cap.** The comment says the admin settings route caps `ad_discount_percent` at 99. The shaper itself clamps only to 100, and the zero-price guard catches 100%. I did not verify this.
8. **`lib/customer/api.ts`.** How the account page lists hosted orders (invoices with source `stealth_health`). Not read.
9. **Email templates.** The content of the confirmation, admin-alert and affiliate emails is not documented here.

### Porting notes (behaviours that are easy to miss)

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
