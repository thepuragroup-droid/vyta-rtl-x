# 01 — Cart surface (everything before /checkout)

Source repo: `thepuragroup-droid/vyta-rtl-x` (Next.js ^15.5.4 App Router, React ^19.2.0, Tailwind ^3.4.18, framer-motion ^12.23.24, lucide-react ^0.546.0, Supabase JS).
All cart code is **client-side**. There is **no cart drawer / mini-cart**: the cart is a full page at `/cart`, reached from the nav cart icon. The cart state lives in `localStorage` only (no DB cart table).

Resolved-value conventions used below: Tailwind v3 defaults unless the repo overrides them. Breakpoints `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px. Spacing unit 0.25rem = 4px. Repo overrides: `rounded-xl` = 0.875rem (14px), `rounded-2xl` = 1.125rem (18px), `rounded-3xl` = 1.5rem; stock `rounded-lg` = 0.5rem (8px), `rounded-full` = 9999px. Font family `sans` = `var(--font-inter), Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, sans-serif`. Type scale (size / line-height): `text-[9px]`, `text-[10px]`, `text-[11px]` (arbitrary, inherit line-height), `text-xs` 12/16px, `text-sm` 14/20px, `text-base` 16/24px, `text-lg` 18/28px, `text-xl` 20/28px, `text-2xl` 24/32px, `text-3xl` 30/36px, `text-4xl` 36/40px. Weights: medium 500, semibold 600, bold 700. `leading-tight` 1.25, `leading-snug` 1.375. `tracking-tight` -0.025em.

Color tokens (tailwind.config.ts): ink `#07203A`, ink-muted `#56707F`, ink-light `#6E8898`, surface `#F7FAFB`, surface-2 `#EDF3F5`, line `#DCE7EB`, teal `#438B9E`, teal-dark `#1B5D83`, teal-light `#6EB2B8`, teal-50 `#F1F8F9`. Opacity modifiers resolve to rgba of the base, e.g. `teal/5` = rgba(67,139,158,0.05), `teal/10` = 0.10, `teal/15` = 0.15, `teal/25` = 0.25, `teal/40` = 0.40, `teal/50` = 0.50, `teal/70` = 0.70, `teal/[0.04]` = 0.04; `ink/90` = rgba(7,32,58,0.9), `ink/15` = rgba(7,32,58,0.15), `ink/40` = rgba(7,32,58,0.4); `line/70` = rgba(220,231,235,0.7); `surface/40` = rgba(247,250,251,0.4). Stock Tailwind v3 colors used: red-50 `#FEF2F2`, red-100 `#FEE2E2`, red-200 `#FECACA`, red-500 `#EF4444`, red-600 `#DC2626` (`red-600/90` = rgba(220,38,38,0.9)), red-700 `#B91C1C`; amber-700 `#B45309`; emerald-50 `#ECFDF5`, emerald-200 `#A7F3D0`, emerald-500 `#10B981`, emerald-600 `#059669`, emerald-700 `#047857`, emerald-800 `#065F46`. Shadows: `shadow-sm` = `0 1px 2px 0 rgb(0 0 0 / 0.05)`; `shadow-lg` = `0 10px 15px -3px …, 0 4px 6px -4px …` (with `shadow-black/20` the color is rgb(0 0 0 / 0.2)); `shadow-xl` = `0 20px 25px -5px …, 0 8px 10px -6px …` (with `shadow-black/10` → rgb(0 0 0 / 0.1)). Custom shadows `card`/`card-hover`/`focus` exist in config but are **not used** on the cart surface.

Global body background (app/globals.css): `linear-gradient(180deg, #ffffff 0%, var(--color-cloud) 50%, #ffffff 100%)`; the cart `<main>` paints `bg-surface/40` over it.

---

## Cart — components

### Provider tree (app/layout.tsx, Server component rendering client providers)
Order (outer → inner), relevant parts only:
```
MaybeWeb3Provider > LanguageProvider > SiteConfigProvider > AffiliateProvider > CustomerProvider
  > CartProvider > PromosProvider > ToastProvider > PurchaseModalProvider > AuthGuard
      > AnnouncementBar, {children}, ChatBubble, FreeShippingToast, AgeVerification, SiteTracking, CustomerJourneyTracker
```
`PromosProvider` must be inside both `CustomerProvider` (signed-in state) and `CartProvider` (item count). `ToastProvider` is inside `PromosProvider`; the cart's suggestion blocks call `useToast()`.

---

### `CartProvider` / `useCart()` — `contexts/CartContext.tsx` (Client, `'use client'`)
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

### `lib/analytics/cart.ts` — `cartItemToAnalytics(item: CartItem): AnalyticsItem` (isomorphic helper)
```
packSize = Number(item.packSize) > 0 ? Number(item.packSize) : item.unit === 'case' ? (Number(item.vialsPerBox) || 10) : 1
→ { item_id: item.productId, item_name: item.name, item_variant: packSize > 1 ? `${packSize}-pack` : '1-pack',
    ...(item.strength ? { item_category: item.strength } : {}), price: item.price, quantity: item.quantity }
```

### `lib/analytics/ecommerce.ts` (Client) — event sink used by CartContext
- `track(name, params)`: always calls `forwardEcommerceToKlaviyo(name, params)` first; then if mode `'off'` drop; `'pending'` buffer (max 20); else `dispatch`.
- `dispatch`: mode `gtm`/`both` → `dataLayer.push({ecommerce:null})` then `dataLayer.push({event:name, ecommerce: params})`; mode `gtag`/`both` → `gtag('event', name, params)`. Mode set by `SiteTracking` via `setAnalyticsMode`.
- Currency constant `'CAD'`. `value` = Σ price×quantity rounded to cents.
- Cart-relevant: `trackAddToCart(item)` → `add_to_cart {currency, value, items:[item]}`; `trackRemoveFromCart(item)` → `remove_from_cart`; `trackViewCart(items)` → `view_cart` (skipped when empty).
- Klaviyo (`lib/analytics/klaviyo-onsite.ts`): `add_to_cart` → `_klOnsite.push(['track','Added to Cart',{ $value, AddedItemProductName, AddedItemProductID, AddedItemVariant, AddedItemCategories:[item_category]|[], AddedItemPrice, AddedItemQuantity, CheckoutURL: `${location.origin}/cart`, Currency }])`; `view_cart` → `'Viewed Cart' { $value, ItemNames, Items:[{ProductID,ProductName,Variant,Quantity,ItemPrice}], Currency }`. `remove_from_cart` is NOT forwarded to Klaviyo. Klaviyo has its own pending/on/off gate (`setKlaviyoOnsiteMode`, buffer 20).

### `lib/customer/activity.ts` — `trackActivity(event)` (Client)
Used by `addItem` with `{ type: 'cart', productId, productName, quantity: 1 }`. Gets Supabase session token (anon browser client `supabase` from `lib/supabase.ts`); `POST /api/customer/activity` with JSON body, `Authorization: Bearer <token>` if signed in, `credentials: 'same-origin'`, `keepalive: true`. Never throws. (The CartContext comment says "no-op when anonymous", but the code sends anonymous events too — the API keys them by the `aminocan_vid` cookie and decides by consent.)
Server (`app/api/customer/activity/route.ts`, service-role client): always HTTP 200; anonymous rate limit 120/min/IP; consent check (`isTrackingAllowed`); inserts into **`customer_activity`** `{ customer_id, anonymous_id, session_id, activity_type:'cart', search_query:null, product_id (UUID-validated else null), product_name (≤200 chars), quantity: max(1, floor(q)), page_path:null, page_title:null, referrer:null, metadata }`; fallback insert with legacy column set if new columns missing. No milestone for `cart`.

---

### `PromosProvider` / `usePromos()` — `contexts/PromosContext.tsx` (Client)
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

### `/api/admin/settings` GET (`app/api/admin/settings/route.ts`, Server route, service-role `createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`)
Unauthenticated. `site_settings.select('*').limit(1).maybeSingle()` → `{ settings: shape(row) }`. Cart-relevant shaped fields:
- `puramass_free_shipping_active` = `puramass_free_shipping_enabled` AND `puramass_shipping_rates_enabled` AND `threshold > 0` (via `shapeHostedShippingSettings`); `puramass_free_shipping_threshold` = number ≥ 0 (default 0).
- `ad_discount_enabled` = `ad_discount_active` = `!!ad_discount_enabled && percent>0`; `ad_discount_percent` = clamp 0–100 to 2 dp (default 25 when null).
- `cart_offer_enabled` = `cart_offer_active` = `!!cart_offer_enabled && percent>0`; `cart_offer_percent` = min(99, clamp) (default 10); `cart_offer_min_items` = clamp floor 1–99 (default 2); `cart_offer_ends_at` = ISO or null (unparseable → null).
- `cart_fbt_enabled ?? true`, `cart_similar_enabled ?? true`, `cart_trust_strip_enabled ?? true`.

### `SiteConfigProvider` / `useSiteConfig()` — `contexts/SiteConfigContext.tsx` (Client)
Cart uses only `config.store_name` (in "Why Customers Choose {store_name}"). Starts from `DEFAULT_SITE_CONFIG` (`store_name: 'VYTA'`), replaced after `fetchSiteConfig()` → `GET /api/site-config` (`no-store`) → `{ config }` read from `site_settings` (service-role `getSupabase()`). Failure → defaults.

---

### `CartPage` — `app/cart/page.tsx` (Client, `'use client'`, default export, route `/cart`)
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

### `useCartRecommendations()` + helpers — `components/cart/recommendations.ts` (Client module)
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

### `GET /api/products/recommendations` — `app/api/products/recommendations/route.ts` (Server route)
Client: service-role `createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`. Public.
- Query `ids` = comma list; each trimmed, must match `/^[0-9a-f-]{36}$/i`; deduped; max 50.
- Optional `Authorization: Bearer` → `auth.getUser` → customerId for pricing.
- Toggles: `site_settings.select('*')` → `fbt = cart_fbt_enabled ?? true`, `similar = cart_similar_enabled ?? true` (errors → both true).
- Catalog: `products.select('*').eq('active', true)`; error → `{ frequentlyBoughtTogether: [], youMayAlsoLike: [] }`.
- FBT (if fbt): `product_recommendations.select('recommended_product_id, sort_order, badge, enabled').in('product_id', cartIds).eq('enabled', true).order('sort_order', asc)`; first occurrence of each recommended id kept (with its `badge`); filter: exists in active catalog, not in cart, `stock_quantity > 0`; **limit 3**.
- You may also like (if similar): history = `order_items.select('order_id, product_id, quantity').order('created_at', desc).limit(4000)` + `puramass_orders.select('id, items, status').order('created_at', desc).limit(4000)` with `status === 'paid'` only, `items[].sku` mapped (lower-case) to products via `puramass_sku` / `puramass_sku_vial`. Ranked by `rankRecommendations` excluding cart + FBT ids, **limit 8**.
- Pricing: `applyResolvedPrices(db, customerId, [...fbt, ...similar])` — chain customer override (`customer_price_overrides`) > active pricelist (`pricelists.is_active`, `pricelist_items`) > catalog. When overridden: `price` replaced, `vial_price = round2(price / vialsPerBox)`, `pack_options = null`, plus `base_price`, `price_source`.
- Response 200: `{ frequentlyBoughtTogether: (productRow & { recommendation_badge: string|null })[], youMayAlsoLike: (productRow & { recommendation_reason })[] }` (full `products.*` rows).

### `rankRecommendations` — `lib/products/recommendations.ts` (pure)
Score per candidate (skip if in cart/excluded or `stockQuantity <= 0`):
`min(coPurchases, 6) * 10` + (`sameCategory` ? 6 : 0) + `min(unitsSold/25, 1) * 5` + (`featured` ? 2 : 0), rounded to 2 dp.
- coPurchases = number of distinct baskets (orderId) containing both this product and any cart product.
- sameCategory = trimmed lower-case `category` equals a cart product's category.
- unitsSold = Σ quantity (invalid → 1) over all history lines.
- `reason` = `'bought-together'` if coPurchases>0, else `'same-category'` if sameCategory, else `'popular'`.
Sort: score desc → unitsSold desc → name `localeCompare` asc. Slice to limit (8). `reason` is returned but not displayed.

---

### `FrequentlyBoughtTogether` — `components/cart/FrequentlyBoughtTogether.tsx` (Client, default export)
Props: `products: RecommendedProduct[]`; `pairedWith?: string` (cart passes `items[0]?.name`); `className?: string = ''`.
State: `selected: string[]`; `gridRef`. Hooks: `useToast()`, `useAddSuggestion()`.
- `buyable = products.filter(p => defaultPackFor(p) !== null)` (memo).
- Effect on `idKey` (buyable ids joined): `setSelected(all buyable ids)` — every card starts ticked and re-ticks whenever the list changes.
- Returns `null` if `buyable.length === 0`.
- `bestSaving` = max `defaultPackFor(p).savingsPercent` among selected buyable.
- `toggle(id)` add/remove.
- `addSelected()`: picked = selected buyable; none → return. For each: `addSuggestion(product, gridRef.current)`; collect names that returned false. All blocked → `toast.error(picked.length === 1 ? `${picked[0].name} is out of stock.` : "We couldn't add those — they're out of stock.")` and return. Some blocked → `toast.error(`${blocked.join(', ')} couldn't be added — out of stock.`)`. Then `toast.success(`Added ${addedCount} item${addedCount === 1 ? '' : 's'} to your cart.`)`.
Rendered by: CartPage (left column, after line-items card).

### `YouMayAlsoLike` — `components/cart/YouMayAlsoLike.tsx` (Client, default export)
Props: `products: RecommendedProduct[]`; `className?: string = ''`.
State: `atStart` (true), `atEnd` (false); `railRef`. `syncArrows()`: `atStart = scrollLeft <= 4`; `atEnd = scrollLeft + clientWidth >= scrollWidth - 4`. Effect on `[syncArrows, products.length]`: sync, add passive `scroll` listener on rail + `resize` on window.
`scrollBy(dir)`: `rail.scrollBy({ left: dir * max(200, clientWidth*0.8), behavior: 'smooth' })`.
`buyable` filter as FBT; `null` if empty. `add(product, source=button)`: success → `toast.success(`${product.name} added to your cart.`)`; else `toast.error(`${product.name} is out of stock.`)`.
Rendered by: CartPage (left column, after FBT).

### `LimitedTimeOffer` — `components/cart/LimitedTimeOffer.tsx` (Client, default export)
Props: `className?: string = ''`. Reads `usePromos().cartOffer`.
`useCountdown(endsAt)`: state `remaining: number|null`; effect on `[endsAt]`: none/invalid → null; else `tick = setRemaining(max(0, end - now))`, run now and every 1000 ms (`setInterval`). Returns null if remaining null or ≤ 0, else `HH:MM:SS` with hours unbounded (days folded into hours, zero-padded to ≥2 digits).
Render guards: `!enabled || percent <= 0` → null; `endsAt && !clock && !earned && itemsAway === 0` → null (expired).
Rendered by: CartPage, top of the sticky right column.

### `FreeShippingProgress` — `components/FreeShippingProgress.tsx` (Client, default export)
Props: `subtotal: number` (CAD goods), `threshold: number`, `active: boolean`, `variant?: 'card' | 'bar'` (default `'card'`), `className?: string`.
`progress = active ? freeShippingProgress(subtotal, threshold) : null`; null → render nothing. Cart uses `variant="bar"` with `subtotal={totalPrice}`, `threshold={freeShipping.threshold}`, `active={freeShipping.active}`, `className="mt-1"`. (`card` variant is the checkout's.)
`freeShippingProgress` (`lib/payments/puramass-shipping.ts`): `target ≤ 0`/NaN → null; `spent = max(0, subtotal)`; `remaining = max(0, ceil((target - spent) * 100) / 100)`; `pct = clamp(spent/target*100, 0, 100)`; `unlocked = remaining <= 0`.

### `FreeShippingToast` — `components/FreeShippingToast.tsx` (Client; mounted globally in layout)
Not shown on the cart: `SILENT_PATHS = ['/admin','/warehouse','/affiliate','/cart','/checkout']` (exact or prefix + `/`). Elsewhere: same progress math on `useCart().totalPrice`; appears after 1200 ms; dismissal stored in `sessionStorage['aminocan.freeShippingToast']` as the dismissed state (`'progress'` | `'unlocked'`), so crossing the threshold re-shows it. Copy: progress "You're $X.XX away from free shipping" / "Spend $T.TT or more and we'll cover the shipping. Keep shopping" (link `/products`); unlocked "You've got free shipping" / "Shipping is on us on orders over $T.TT — pick any courier at checkout and it's free." Dismiss button aria-label "Dismiss free shipping notice". Position `fixed bottom-4 left-4 right-[5.5rem] z-40 sm:right-auto sm:w-[340px]`; card `rounded-2xl border shadow-xl shadow-black/10 backdrop-blur` with `border-emerald-200 bg-emerald-50/95` (unlocked) or `border-line bg-white/95`; motion `initial {opacity:0,y:16,scale:0.97}` → `{1,0,1}`, exit same as initial, `duration 0.25, ease [0.16,1,0.3,1]`.

### `AdDiscountNotice` + `useAdOfferNotice()` — `components/AdDiscountNotice.tsx` (Client)
Not on the cart body; rendered inside Navigation's disclaimer row on every page including `/cart`. `useAdOfferNotice()`: landing offer active → `{show:true, eligible:true, off: `${+percent.toFixed(2)}%`, firstOrder: firstOrderOnly}`; else `show = adDiscount.active && isAdVisitor && (customer ? adDiscountEligible : true)`, `{eligible: adDiscountEligible, off: `${adDiscount.percent}%`, firstOrder: true}`.
Render (fragment siblings): `<span class="text-line">•</span>` then
- eligible: `<span class="inline-flex items-center gap-1.5 whitespace-nowrap text-emerald-700">` Check `h-3 w-3` + **"{off} off"** (semibold) + `sm+`: "{ your first order if firstOrder} — applied at checkout" / `<sm`: " applied".
- not eligible: `<Link href="/signup" class="group inline-flex items-center gap-1.5 whitespace-nowrap transition-colors hover:text-ink">` BadgePercent `h-3 w-3 text-teal-dark` + "{off} off" (`font-semibold text-ink`) + `sm+` " your first order — sign up" / `<sm` " first order" + ArrowRight `hidden h-3 w-3 sm:inline`, `group-hover:translate-x-0.5`, `duration-200`.
When `adOffer.show`, Navigation hides the mobile "• Canada Only" span.

### `Navigation` cart icon — `components/Navigation.tsx` (Client)
Uses `{ totalItems, bumpKey } = useCart()`. Two cart links, both only when `siteConfig.ecommerceEnabled`:
- Desktop (inside `hidden lg:flex items-center gap-2`): `<Link href="/cart" data-cart-target aria-label=…  class="relative flex items-center justify-center w-10 h-10 rounded-lg transition-all text-ink-muted hover:text-ink hover:bg-surface">` (40×40px, radius 8px, #56707F → hover #07203A on #F7FAFB).
- Mobile (inside `lg:hidden flex items-center gap-2`, before the hamburger): same but `class="relative flex items-center justify-center w-10 h-10 transition-colors text-ink-muted hover:text-ink"` (no radius/hover bg).
- aria-label: `Cart` or `Cart, {n} item` / `Cart, {n} items`.
- Icon: `<motion.span key={bumpKey} animate={bumpKey > 0 ? { scale: [1, 1.3, 1] } : { scale: 1 }} transition={{ duration: 0.35, ease: 'easeOut' }} class="flex items-center justify-center">` wrapping lucide `ShoppingCart` `w-5 h-5` (20px). Changing `key` remounts the span so each add replays the 1→1.3→1 bump.
- Badge (when `totalItems > 0`): `<span class="absolute -top-0.5 -right-0.5 text-[10px] rounded-full min-w-[18px] h-[18px] flex items-center justify-center font-bold px-1 bg-ink text-white">` text `totalItems > 99 ? "99+" : totalItems` (offset -2px top/right; 18px tall pill; 10px bold white on #07203A; 4px horizontal padding). Badge counts units (`totalItems`), not lines.
- `data-cart-target` is the fly-to-cart destination; the hidden variant reports zero width so the visible one is picked.
- Nav is `fixed w-full z-50` at `top: var(--announcement-h, 0px)`; bar `bg-white border-b border-line`, inner `h-[72px]`, plus disclaimer row `py-2 sm:py-1.5 bg-surface border-t border-line`. The mobile menu has no cart entry.

### `ReferralCodeField` — `components/cart/ReferralCodeField.tsx` (Client) — **NOT MOUNTED**
Present in the cart folder but imported nowhere (git: "drop cart referral box"). Collapsible "Add a referral code" row that validates against `referral_codes` (anon client, `code` eq normalised, `active` true) and writes cookie `ref_code` (30 days, `path=/; SameSite=Lax`). Copy if ever revived: "Add a referral code" / "Referral code {CODE} applied"; placeholder "Enter code"; button "Apply"; errors "Codes are at least 4 characters.", "That code isn't valid.", "We couldn't check that code — try again at checkout."; helper "Credits whoever referred you. It does not change your total." / "We'll carry it through to checkout for you." Do not port unless wanted.

### `ToastContext` (context used by suggestion blocks) — `contexts/ToastContext.tsx`
`useToast()` → `{ success, error, info }(message, duration = 6000)`. Container `fixed bottom-4 left-1/2 -translate-x-1/2 sm:left-auto sm:right-4 sm:translate-x-0 z-[200] flex flex-col gap-2 w-[min(92vw,360px)]`, `role="status" aria-live="polite"`. Card `flex items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg` + success `border-emerald-200 bg-emerald-50 text-emerald-800` (Check `w-4 h-4 text-emerald-600`), error `border-red-200 bg-red-50 text-red-700` (AlertCircle `text-red-600`). Motion `initial {opacity:0,y:16,scale:0.96}` → `{1,0,1}`, exit `{opacity:0,y:12,scale:0.96}`, `duration 0.2 easeOut`, `layout`. Hover pauses auto-dismiss. Close X `w-3.5 h-3.5`, aria-label "Dismiss".

---

## Cart — business rules

### Line identity & caps
- One line per (productId, packSize): `id = "<productId>::p<packSize>"`. A 1-pack, 3-pack and 10-pack of the same product are separate lines.
- `price` on a line = price of one pack (already pack-level, may be a discounted fixed pack price). Line total = `price × quantity`.
- `stock_quantity` on a line = cap in packs = `floor(stockVials / packSize)` computed by the caller at add time. `addItem` refuses when `existing.quantity + 1 > cap` or (new line) `cap < 1`. `updateQuantity` clamps to `item.stock_quantity`; `< 1` removes the line. The "+" button is disabled at `quantity >= stock_quantity`. `stock_quantity` unknown ⇒ `Infinity` (no cap).
- Add-to-cart entry points (outside this section): PDP (`ProductDetailClient`) and the purchase modal call `addItem` once per unit in a loop of `qty`, with `stock_quantity = cap` for the selected pack, then `flyToCart(heroImage)`. Their toasts: `Not enough stock for a {label lower-cased}.` / `Not enough stock for a pack of {N}.` / `Out of stock.` / `Only {cap} in stock — that's all we have.`
- Suggestion cards add **one unit** of the default pack (3-pack if offered and ≥1 in stock, else first in-stock pack).

### Totals math (cart page)
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

### Free shipping
- Source: `site_settings.puramass_free_shipping_enabled` + `puramass_free_shipping_threshold` + `puramass_shipping_rates_enabled` → `puramass_free_shipping_active = rates_enabled && free_enabled && threshold > 0`.
- Measured against the **pre-discount** `totalPrice` (goods subtotal) on the cart.
- `remaining = max(0, ceil((threshold − subtotal)×100)/100)`, `pct = clamp(subtotal/threshold×100, 0, 100)`, unlocked when `remaining <= 0` (i.e. subtotal ≥ threshold).
- Bar hidden when not active or threshold ≤ 0.

### Limited-time cart offer (`lib/promos/cart-offer.ts`, rules pinned by `cart-offer.test.ts`)
- Settings: `cart_offer_enabled`, `cart_offer_min_items`, `cart_offer_percent`, `cart_offer_ends_at`. Defaults (code) `DEFAULT_CART_OFFER = { enabled:false, minItems:2, percent:10, endsAt:null }`; `MAX_DISCOUNT_PERCENT = 99`.
- `shapeCartOfferSettings`: percent = `min(99, clampDiscountPercent(v ?? 10))` (clamp: non-finite/≤0 → 0; else min(100, round to 2dp)); `enabled = !!cart_offer_enabled && percent > 0` (0% forces off); `minItems = clampMinItems(v ?? 2)` (floor; <1/NaN → 1; max 99); `endsAt` ISO or null (unparseable → null, i.e. "never expires", not "expired").
- `cartOfferExpired`: `endsAt` set and `end <= now`.
- `qualifiesForCartOffer(settings, itemCount)`: enabled, percent>0, not expired, `floor(itemCount) >= minItems`. Unlocks AT the minimum (min 2: 1→false, 2→true).
- `itemsToUnlockCartOffer`: 0 if off/expired, else `max(0, minItems − floor(itemCount))`.
- Item count = cart **units** (`totalItems`, Σ quantity) — a line of 3 × 5-pack counts 3.
- `cartOfferAmount(subtotal, percent)` = `round(subtotal × pct)/100`; 0 if pct ≤ 0 or subtotal ≤ 0. Test values: 190@10% → 19; 199.99@10% → 20.
- `combineDiscountPercents(...p)` = `1 − Π(1 − p/100)` → rounded to 2dp, capped 99. Tests: (25,10)→32.5; (50,50)→75; (99,99)→99.
- Countdown shown only when `endsAt` is set; the PromosProvider re-evaluates once at expiry (+250 ms) so the strip and the summary line disappear together.

### Paid-ads welcome discount (as the cart displays it)
- Eligible only if: `ad_discount_active` and percent > 0 AND signed in AND `isFirstOrder` (API) AND first- or last-touch channel ∈ {`google_ads`,`meta_ads`,`bing_ads`,`tiktok_ads`,`linkedin_ads`,`other_paid`}.
- Cart line shown only when `adDiscountEligible && adSaving > 0` (so hidden when the landing code wins). Guests never see it on the cart (they see the nav invitation instead).

### Landing-page offer (as the cart displays it)
- Requires cookie `vyta_lp` (set by middleware from `?lp=<slug>`, 30 days). Offer = landing page's percent discount code; `active = eligible !== false` (false only for a signed-in customer who has ordered before on a first-order-only code). Excluded products contribute 0 to `landingSaving`.
- Cart line shown only when `landingWins`. Label `{+percent.toFixed(2)}% ` + (`firstOrderOnly` ? "first-order offer" : "welcome offer"); fine print "Code {code} is applied automatically at checkout" + (exclusions ? " · excludes {exclusions}" : "") + ".".

### Upsell selection rules
- FBT: operator pairings from `product_recommendations` where `product_id ∈ cart products` and `enabled`, ordered by `sort_order` asc (first occurrence wins across cart products), excluding in-cart and `stock_quantity ≤ 0` products, max 3; then client filters to those with a buyable default pack. Badge = pairing's `badge`. Hidden when `cart_fbt_enabled = false` (server returns `[]`).
- You may also like: computed (score formula above), excluding cart + FBT products and out-of-stock, max 8; client filters to buyable. Hidden when `cart_similar_enabled = false`.
- Prices on suggestion cards are customer-resolved (override > pricelist > catalog). When a pricelist/override applies, pack_options are dropped → pack prices revert to `vial_price × size` and no compare-at saving shows.
- FBT "Save up to N%" = max `savingsPercent` of the **selected** cards' default packs (compare-at derived from `pack_options`), hidden when 0.

### Stock messaging
- Per line: `low = isFinite(stock_quantity) && stock_quantity <= 5` → amber "Only {stock_quantity} left — order soon"; else emerald "In Stock – Ships in 24h".
- Summary scarcity box: `lowestStock` = min finite `stock_quantity` across lines; shown when `0 < lowestStock <= 5`: "Only {lowestStock} left in stock" / "Order now to avoid missing out."
- Note: `stock_quantity` is the cap captured at add time (not live stock).

### What persists where
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

### Analytics fired from the cart surface
| user action | GA4 event (gtag/dataLayer per mode) | Klaviyo onsite | customer_activity |
|---|---|---|---|
| add via FBT/YMAL (or PDP/modal) — each successful unit | `add_to_cart` {currency:'CAD', value: price×1, items:[{item_id, item_name, item_variant 'N-pack'/'1-pack', item_category=strength, price, quantity:1}]} | "Added to Cart" | `type:'cart', quantity:1` |
| trash icon, or "−" at quantity 1 | `remove_from_cart` (full line quantity) | — | — |
| "+" / "−" (qty stays ≥1) | none | none | none |
| Clear cart | none | none | none |
| page view of /cart | none (`view_cart` only fires on `isOpen`, which is never set) | none | (global page tracker, out of scope) |
| Proceed to Secure Checkout | none on cart (checkout page fires `begin_checkout`) | — | — |

### Toast / error / UI strings (verbatim)
- FBT: `{name} is out of stock.` · `We couldn't add those — they're out of stock.` · `{name1, name2} couldn't be added — out of stock.` · `Added {n} item to your cart.` / `Added {n} items to your cart.`
- YMAL: `{name} added to your cart.` · `{name} is out of stock.`
- No error UI for failed settings/recommendations/promos fetches (silently hidden). `console.error('Error loading cart:', error)` on corrupt localStorage.

---

## Cart — UI/UX

### Wireframe — desktop (≥ lg, 1024px+)
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

### Page shell
- `<main className="min-h-screen bg-surface/40">` → bg rgba(247,250,251,0.4).
- Wrapper `pt-32 sm:pt-36 md:pt-44 pb-16 sm:pb-20 md:pb-28` → top 128 / 144 / 176px; bottom 64 / 80 / 112px (clears the fixed nav).
- Container `max-w-7xl mx-auto px-4 sm:px-8 lg:px-12` → max 1280px; gutters 16 / 32 / 48px.
- `<Navigation />` first, `<Footer />` last (Footer out of scope).

### Header
- Wrapper `motion.div` `initial {opacity:0, y:20}` → `animate {opacity:1, y:0}` (framer default transition), `className="mb-6 sm:mb-8"` (24 / 32px).
- Back link `inline-flex items-center gap-2 text-ink-muted hover:text-ink transition-colors mb-4 text-sm` → 14px #56707F → hover #07203A, gap 8px, mb 16px; `ArrowLeft w-4 h-4` (16px) + "Continue Shopping"; href `/products`.
- Row `flex flex-wrap items-end justify-between gap-4 sm:gap-6` (16 / 24px).
- H1 `text-2xl sm:text-3xl md:text-4xl font-bold text-ink tracking-tight` → 24/30/36px, 700, #07203A, -0.025em. Text: `Your Cart` + (`items.length > 0` ? ` (${items.length})` : '') — counts **lines**.
- Subtitle (only with items) `mt-1 text-sm text-ink-muted` (4px, 14px): "You're one step closer to a better you."
- Trust strip (only with items AND `trustStripEnabled === true`; hidden while null): `flex flex-wrap items-center gap-4 sm:gap-6`; each `flex items-center gap-2`: icon `h-5 w-5 flex-shrink-0 text-ink-muted` (20px) + `div.leading-tight` with title `text-[11px] font-semibold text-ink` and note `text-[10px] text-ink-muted`. Items: Truck "Free, Fast & Discreet Shipping"/"Canada-wide"; ShieldCheck "Secure Checkout"/"SSL encrypted"; Package "Carefully Packaged"/"Your privacy matters".

### Empty state
- `motion.div` `initial {opacity:0,y:20}` → `{1,0}`; `text-center py-12 sm:py-16 md:py-20` (48/64/80px vertical).
- Tile `w-16 sm:w-20 h-16 sm:h-20 bg-white rounded-2xl flex items-center justify-center mx-auto mb-5 sm:mb-6 border border-line` (64→80px square, radius 18px, mb 20/24px); `ShoppingBag w-8 sm:w-10 h-8 sm:h-10 text-ink-muted` (32→40px).
- H2 `text-lg sm:text-xl md:text-2xl font-bold text-ink mb-2 sm:mb-3` (18/20/24px; mb 8/12px): "Your cart is empty".
- P `text-ink-muted mb-6 sm:mb-8 text-sm`: "Looks like you haven't added any products yet."
- CTA `<Link href="/products">` `inline-flex items-center gap-2 bg-ink hover:bg-ink/90 text-white font-semibold px-5 sm:px-6 py-3 rounded-xl transition-all text-sm` (bg #07203A → rgba(7,32,58,.9), padding 12px × 20/24px, radius 14px); `ShoppingCart w-4 h-4` + "Browse Products".
- The FBT/YMAL/summary are not rendered when empty; recommendations hook skips the fetch.

### Two-column grid
- `grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8` → gaps 16/24/32px; at lg: fluid left + fixed 352px right.
- Left `motion.div` `initial {opacity:0, x:-20}` → `{1, 0}`, `min-w-0 space-y-6 sm:space-y-8` (24/32px between blocks).
- Right `motion.div` `initial {opacity:0, x:20}` → `{1,0}`, `min-w-0`; inner `space-y-3 lg:sticky lg:top-36` (12px stack; sticky at 144px from top at lg+).

### Line-items card
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

### Free-shipping bar (`FreeShippingProgress variant="bar"`)
- Container `flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3.5 py-3 transition-colors duration-300 mt-1` (gaps 12px/8px, padding 12px × 14px, radius 14px, colour transition 300ms). Locked: `border-teal/25 bg-teal/5`; unlocked: `border-emerald-200 bg-emerald-50`.
- Icon tile `flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg` (28px, r 8px): locked `bg-teal/15 text-teal-dark`; unlocked `bg-emerald-500 text-white`; `Truck h-3.5 w-3.5`.
- Message `p.text-xs font-semibold` locked `text-ink`: "Add ${remaining} for FREE shipping"; unlocked `text-emerald-800`: "You're eligible for FREE shipping!".
- Track group `flex min-w-[8rem] flex-1 items-center gap-2` (min 128px, wraps to its own line on narrow screens): track `h-1.5 flex-1 overflow-hidden rounded-full bg-line/70` (6px tall) `role="progressbar" aria-valuemin=0 aria-valuemax=100 aria-valuenow=round(pct) aria-label="Progress toward free shipping"`; fill `motion.div h-full rounded-full` locked `bg-gradient-to-r from-teal/70 to-teal`, unlocked `bg-emerald-500`; `initial={false}`, `animate {width: pct%}`, `transition {type:'spring', stiffness:180, damping:26}`.
- Trailing: unlocked `span.flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium text-emerald-700` with `CheckCircle2 h-3.5 w-3.5` + "Free shipping unlocked"; locked `span.whitespace-nowrap text-[11px] tabular-nums text-ink-muted` "${subtotal} / ${threshold}".

### Frequently Bought Together
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

### You May Also Like
- `<section aria-labelledby="similar-heading">`. Header `flex items-center justify-between gap-3`: H2 `#similar-heading text-lg font-bold text-ink sm:text-xl` "You May Also Like"; link `/products` `inline-flex flex-shrink-0 items-center gap-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink sm:text-sm` "View All Products" + `ArrowRight h-3.5 w-3.5`.
- Wrapper `relative mt-4`.
- Arrow buttons (hidden < sm): `absolute -left-2 | -right-2 top-1/2 z-[1] hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-white text-ink shadow-sm transition-opacity hover:bg-surface disabled:opacity-30 sm:flex` (32px circle overhanging 8px; disabled 30% opacity at ends); `ChevronLeft/ChevronRight h-4 w-4`; aria-labels "Scroll suggestions left" / "Scroll suggestions right".
- Rail `flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden` (12px gap, 4px bottom padding, hidden scrollbar).
- Card `flex w-[13rem] flex-shrink-0 snap-start items-center gap-3 rounded-xl border border-line bg-white p-3 transition-colors hover:border-teal/40` (208px wide, 12px padding, radius 14px).
  - Link `group flex min-w-0 flex-1 items-center gap-3`: image box `flex h-12 w-10 flex-shrink-0 items-center justify-center` (40×48px) with `img.h-full w-full object-contain transition-transform duration-200 group-hover:scale-105` or `Beaker h-6 w-6 text-line`; text `min-w-0`: name `p.truncate text-xs font-semibold text-ink group-hover:text-teal-dark`; strength (if) `p.truncate text-[11px] text-ink-muted`; price `p.mt-0.5 text-xs font-bold text-ink tabular-nums` (default pack price).
  - Add button `flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-ink transition-all hover:border-teal/50 hover:text-teal-dark active:scale-90` (32px, r 8px), `aria-label="Add {name} to cart"`, `ShoppingCart h-3.5 w-3.5`. Fly origin = this button.

### Limited Time Offer strip (top of right column)
- `motion.div` `initial {opacity:0, y:-6}` → `{1,0}`; `rounded-xl border px-4 py-3` (radius 14px, 12px × 16px) + earned `border-emerald-200 bg-emerald-50` / not `border-teal/25 bg-teal/5`.
- Inner `flex items-start gap-3`; icon tile `flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg` (32px, r 8px) earned `bg-emerald-500 text-white` / not `bg-teal/15 text-teal-dark`; `Gift h-4 w-4`.
- Text `min-w-0 flex-1`: head row `flex flex-wrap items-center justify-between gap-2`: title `p.text-sm font-semibold` earned `text-emerald-800` "{percent}% OFF applied" / not `text-ink` "Limited Time Offer"; clock (if) `span.font-mono text-xs tabular-nums` earned `text-emerald-700` / not `text-ink-muted`, `aria-hidden="true"`, "HH:MM:SS".
- Body `p.mt-0.5 text-xs leading-snug` earned `text-emerald-700`: "Your **{percent}% discount** is in the total below." (bold span `font-semibold`); not earned `text-ink-muted`: "Add **{itemsAway} more item(s)** and get **{percent}% OFF** your order!" (bold spans `font-semibold text-ink`; "item" singular when itemsAway === 1).
- SR-only (when clock): "This offer ends {new Date(endsAt).toLocaleString()}."

### Order Summary card
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

### Interaction / state summary
- Loading: no skeletons anywhere. Cart lines render synchronously from localStorage (lazy init) — on SSR the page renders the empty state then hydrates (the page is a client component; see Unverified). Trust strip waits for its settings fetch (null = hidden). Promo rows/strip/bar appear once `/api/admin/settings` resolves. Suggestions appear when the recommendations fetch resolves (no placeholder).
- Errors: every fetch failure degrades to "block hidden"; no error copy.
- Disabled: "+" at cap (40% opacity, not-allowed cursor); FBT add button when nothing selected (40%); YMAL arrows at rail ends (30%).
- Focus: no custom focus styles on any cart control (browser default outlines). 
- Hover: listed per element above (`hover:text-red-500` on trash/Clear cart; `hover:bg-surface` on steppers; `hover:bg-ink/90` on CTAs; image `scale-105` 200ms on suggestion cards; teal borders on suggestion cards/buttons).
- Animations: page entrance (header y:20→0, left x:-20→0, right x:20→0, all opacity 0→1 with framer default timing); line rows staggered 50ms; FBT cards staggered 50ms (y:8→0); offer strip y:-6→0; progress fill spring (stiffness 180, damping 26); nav icon bump scale [1,1.3,1] 0.35s easeOut; flyer 0.8s easeInOut arc; toasts 0.2s. No exit animations when removing a line (no AnimatePresence around lines — the row just disappears).
- Clock re-renders LimitedTimeOffer every 1s.

---

## Cart — admin/config inputs it reads

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

## Cart — unverified / porting notes

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
