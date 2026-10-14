# 02 — Home page redesign (sections between Hero and Footer)

Scope: `components/home/*` in vyta-rtl-x (BestSellers, WhyChooseVyta, CollectionBanner, Testimonials, ServicePromises, plus the hidden ShowOurWork and WellnessFocus), what feeds them, how admins control them, and how the old home components (`ProductTicker`, `Products`, `Features`, `LabResultsShowcase`) compare across the two repos. Navigation, Hero and Footer are covered in another section.

Stack is the same in both repos: Next 15.5, Tailwind 3.4.18 (default breakpoints `sm` 640px, `md` 768px, `lg` 1024px), framer-motion ^12.23.24, lucide-react ^0.546.0.

---

## 0. Page composition and shared conventions

### Page order

| | vyta `app/page.tsx` | aminocan-cad `app/page.tsx` |
|---|---|---|
| 1 | `Navigation` | `Navigation` |
| 2 | `Hero` | `Hero` |
| 3 | `BestSellers` (new) | `Products` |
| 4 | `WhyChooseVyta` (new) | `LabResultsShowcase` |
| 5 | `CollectionBanner` (new) | `Features` (category grid, certifications and the research disclaimer band) |
| 6 | `Testimonials` (new; renders `null` when there are none) | `Footer` |
| 7 | `ServicePromises` (new) | |
| 8 | `Footer` | |

- vyta's page is a server component: `<main className="min-h-screen">` holding the sections. Every section in `components/home/*` is `'use client'`.
- **Hidden in vyta, but the files remain:**
  - `ShowOurWork`. Its mount point was after `<BestSellers />` (see the comment in `app/page.tsx`).
  - `WellnessFocus`. Its mount point was directly after `<Hero />` (see `docs/wellness-focus-restore.md`, commit "Hide Shop by Wellness Focus from the home page", `3c64055`).
- vyta does not render `Products`, `Features`, `LabResultsShowcase` or `ProductTicker` anywhere; they are dead code there. `ProductTicker` is not rendered in aminocan-cad either.
- **No section reads `SiteConfigContext`, and no `site_settings` column switches a home section on or off.** Visibility is decided in three ways only:
  1. The section's mount point in `app/page.tsx` (code).
  2. The data itself: BestSellers hides with no featured in-stock products; Testimonials hides with no enabled rows.
  3. Per-row flags: `products.featured`, `testimonials.enabled`, `store_categories.featured`.

### Shared section shell (all new sections except Testimonials and ServicePromises)

- `section` → `py-14 sm:py-20` (56px, then 80px from 640px).
- Inner wrapper: `max-w-7xl mx-auto px-5 sm:px-8 lg:px-12`.
  - `max-w-7xl` is 1280px.
  - Side padding is 20px, then 32px from 640px, then 48px from 1024px.
  - aminocan-cad uses the same wrapper.
- **Section header, left-aligned variant** (BestSellers, WellnessFocus):
  - `flex items-end justify-between gap-4 mb-8` (gap 16px, margin-bottom 32px).
  - `h2.font-display text-2xl sm:text-3xl font-bold text-ink` (24px/32px, then 30px/36px), followed by `p.text-sm text-ink-muted mt-1.5` (14px/20px, margin-top 6px).
  - The right-aligned link is desktop-only: `hidden sm:inline-flex items-center gap-1.5 text-sm font-medium text-ink hover:text-ink-muted whitespace-nowrap` plus lucide `ArrowRight` `w-4 h-4` (16px).
  - The same link repeats below the grid on mobile: `sm:hidden mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-ink`.
- **Scroll-reveal pattern** (framer-motion): `initial={{ opacity: 0, y: N }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}`, with a per-item stagger `delay: index * 0.05` (or `0.06`). No `AnimatePresence` is used anywhere in these sections.

### Token map: vyta class → hex → aminocan-cad semantic equivalent

Tailwind defaults apply wherever neither config overrides a value.

The aminocan-cad column is grounded in the existing cross-repo diffs of `Products`, `Features` and `LabResultsShowcase`. In those files, vyta mechanically replaced:

| aminocan-cad (bronze) | became in vyta (teal) |
|---|---|
| `bronze` (on light surfaces) | `teal-dark` |
| `bronze` (on dark surfaces) | `teal-light` |
| `bronze-50` | `teal-50` |
| `bg-bronze hover:bg-bronze-light` | `bg-teal-light hover:bg-mist` |

| vyta class | vyta hex / value | aminocan-cad equivalent (hex) |
|---|---|---|
| `text-ink` / `bg-ink` | `#07203A` (Midnight Navy) | `ink` `#1A1A1A` |
| `text-ink-muted` | `#56707F` | `ink-muted` `#6E6E6E` |
| `text-ink-light` | `#6E8898` | `ink-light` `#8A8A8A` |
| `bg-surface` | `#F7FAFB` | `surface` `#F7F7F7` |
| `bg-surface-2` | `#EDF3F5` | `surface-2` `#F2F2F2` |
| `border-line` / `text-line` | `#DCE7EB` | `line` `#C9CCD1` |
| `text-teal-dark` | `#1B5D83` (Vital Blue) | `bronze` `#9C8B5A` (text on light) |
| `teal` (e.g. `border-teal/20`) | `#438B9E` | `bronze` `#9C8B5A` (`border-bronze/20`) |
| `teal-50` | `#F1F8F9` | `bronze-50` `#FAF8F3` |
| `bg-aqua` / `teal-light` | `#6EB2B8` | `bronze` `#9C8B5A` (CTA fill on dark) |
| `hover:bg-mist` | `#BBD6D6` | `hover:bg-bronze-light` `#B8A876` |
| `hover:bg-ocean` (ink-button hover) | `#0E3F5F` | `hover:bg-ink/90` (aminocan's 31× convention for ink buttons) |
| `shadow-card` | `0 1px 2px rgba(7,32,58,.04), 0 8px 24px -12px rgba(7,32,58,.10)` | none in aminocan; use `shadow-sm`, or add the token with ink-tinted rgba (26,26,26) |
| `shadow-card-hover` | `0 2px 4px rgba(7,32,58,.05), 0 16px 40px -16px rgba(7,32,58,.16)` | aminocan card convention is `hover:shadow-lg hover:shadow-ink/5` |
| `bg-brand-gradient` | `linear-gradient(135deg,#07203A 0%,#0E3F5F 45%,#438B9E 100%)` | none; suggest `bg-gradient-to-br from-ink to-bronze-dark` (`#1A1A1A` → `#7D6F48`) |
| `bg-brand-gradient-soft` | `linear-gradient(135deg,#F1F8F9 0%,#E1EFF1 50%,#FFFFFF 100%)` | none; suggest `bg-gradient-to-br from-bronze-50 via-bronze-100 to-white` |
| `rounded-xl` | **0.875rem = 14px** (vyta override) | stock 0.75rem = 12px |
| `rounded-2xl` | **1.125rem = 18px** (vyta override) | stock 1rem = 16px |
| `rounded-3xl` | 1.5rem = 24px | 24px |
| `font-display` | `.font-display` utility in `app/globals.css`: Inter variable at `font-variation-settings:'opsz' 32; font-optical-sizing:auto; letter-spacing:-0.02em` | **does not exist** in aminocan. Drop the class, or add a utility that is only `letter-spacing:-0.02em` on aminocan's SF/system stack. |
| `text-eyebrow` | 0.6875rem (11px), weight 600, `letter-spacing:.14em`, uppercase, `color: var(--color-teal)` (`#438B9E`) | not in aminocan; recreate with color `bronze` |
| `molecular-grid` | `background-image: radial-gradient(circle, rgba(110,178,184,.35) 1px, transparent 1px); background-size: 28px 28px` | not in aminocan; recreate with bronze rgba(156,139,90,.35) |
| `text-balance`, `tabular-nums` | `text-wrap: balance` / `font-variant-numeric: tabular-nums` | both already exist in aminocan's `globals.css` |
| `text-amber-400 fill-amber-400` (stars) | `#FBBF24` | same; brand-neutral |
| `MAPLE_RED` | `#D52B1E` | same; flag colour, not brand |

vyta base layer: `h1–h4` get `opsz 32` and `letter-spacing:-0.02em` globally. aminocan-cad has no such rule.

---

### BestSellers

**What's new vs aminocan-cad**

This replaces aminocan's `Products` section ("Popular Research Peptides"). The differences:

| | vyta BestSellers | aminocan Products |
|---|---|---|
| Card count | 4 | 8 |
| Sort | By `price` descending | Client-side by `name`, natural sort |
| Star rating per card | Yes | No |
| Card action | Full-width "View Product" button | Inline Add-to-cart |
| Skeleton loading | Yes | No |
| Section when there are 0 products | Hides itself | — |
| Purity pill eyebrow | No | Yes |
| `AdPrice` / `AdDiscountBadge` | **Absent** (vyta never got them) | Present |
| Out-of-stock overlay | N/A, because only in-stock rows are fetched | Present |

"Best seller" is not computed from sales. It means `featured = true AND active = true AND stock_quantity > 0`, ordered by `price` descending, limited to 4.

**Files**

- `components/home/BestSellers.tsx` (client)
- `lib/hooks/useReviewStats.ts` (new in vyta; **missing in aminocan**)
- `components/reviews/StarRating.tsx`:
  - `RatingSummary` is **missing in aminocan**.
  - aminocan has `StarRating`/`StarInput` with px sizes `{xs:12, sm:14, md:16, lg:20, xl:24}`. These are identical to vyta's `w-3`…`w-6`.
- `lib/pricing.ts` `vialPriceFor` (identical in both repos)
- `lib/products/url.ts` `productPath` (identical in both repos)
- `app/api/reviews/route.ts` (the `?ids=` mode already exists in aminocan)

**Database**

- `products` columns selected:
  - `id, name, slug, price, vial_price, purity, strength, image_url, stock_quantity, vials_per_box, pack_sizes, pack_options`
  - `pack_sizes`/`pack_options` are selected but never used by the component.
  - **`url_slug` is NOT selected**, even though the TS `Product` interface declares it. As a result, `productPath()` falls back to the SKU `slug`, and `app/products/[slug]/page.tsx` then issues a `permanentRedirect` to `url_slug`. Include `url_slug` when porting.
- Filters: `.eq('active', true).eq('featured', true).gt('stock_quantity', 0).order('price', { ascending: false }).limit(4)`.
- Admin flag: `products.featured` ("Featured Product" checkbox in Admin → Products; admin-only in both repos).
- Ratings come from the view `product_review_stats` (`product_id`, `review_count integer`, `average_rating numeric(…,2)`) over `product_reviews WHERE status='published'`.
  - vyta creates it in `reviews-testimonials-migration.sql`.
  - aminocan **already has** the same table and view in `product-reviews-migration.sql`. Its `order_id` has no FK (vyta's has `REFERENCES orders(id) ON DELETE SET NULL`). The view is the same `security_invoker = true` view with `GRANT SELECT … TO anon, authenticated`.
  - **No review migration is needed for aminocan.**

**API routes**

- Products are read **directly from the browser** with the anon client `supabase` from `@/lib/supabase`, not through `/api/products/featured`.
  - This means no customer- or pricelist-specific pricing is applied. `/api/products/featured` applies `applyResolvedPrices` but is unused here.
  - An `AbortController` aborts after 8000 ms.
- `GET /api/reviews?ids=<uuid,uuid,…>` (public, no auth). It is called once by `useReviewStats` with `cache:'no-store'`.

  | | vyta | aminocan |
  |---|---|---|
  | ids handling | Splits, trims, caps at 50 | Same, and also filters ids through `UUID_RE` |
  | Query | `product_review_stats.select('product_id, review_count, average_rating').in('product_id', ids)` | Same |
  | Response | `{ stats: ReviewStats[] }`; each row normalised through `shapeStats` (`Number()` coercion, defaults 0) | Raw rows |
  | Missing table / error | `{ stats: [] }` | `{ stats: [] }` for a missing table; other errors return 500 |

  Products with no reviews are absent from `stats`.

**Components**

`BestSellers()` takes no props.
- **State:**
  - `products: Product[]`
  - `loading: boolean` (initially `true`)
  - `stats = useReviewStats(products.map(p => p.id))`
- **Render rules:**
  - `!loading && products.length === 0` → `return null`. The whole section disappears, including after a fetch error or timeout.
  - While loading, it renders 4 skeleton cards.

`useReviewStats(productIds: string[]): Record<string, ReviewStats>`
- The effect is keyed on `productIds.join(',')`, not on array identity, and is skipped when the key is empty.
- It fetches `/api/reviews?ids=${encodeURIComponent(key)}` and builds `Object.fromEntries(rows.map(r => [r.product_id, r]))`.
- An `alive` flag guards unmounts. It never throws; on failure it returns `{}`.
- `ReviewStats` is `{ product_id: string; review_count: number; average_rating: number }`.

`RatingSummary({ average, count, size='xs', className })`
- Returns `null` when `count === 0`.
- Otherwise renders `<span class="inline-flex items-center gap-1.5 {className}">` containing `<StarRating value={average} size={size}/>` and `<span class="text-[10px] sm:text-xs text-ink-muted tabular-nums">({count})</span>`.

`StarRating({ value, size='sm', className, label })` (vyta version; aminocan's is functionally the same)
- Clamps `value` to 0..5.
- Outer element: `<span class="inline-flex items-center gap-0.5" role="img" aria-label="4.6 out of 5">`.
- Each of the 5 stars is an outline lucide `Star` (`text-line`, `strokeWidth 1.5`) with an absolutely positioned overlay clipped to `width: fill*100%` holding a `Star` with `text-amber-400 fill-amber-400`. This gives fractional stars.

**UI/UX**

- **Section:** `py-14 sm:py-20 bg-surface` (`#F7FAFB` → aminocan `surface` `#F7F7F7`).
- **Header:**
  - Title "Best Sellers".
  - Subtitle "Our most trusted and frequently purchased peptides." (brand copy; keep or adapt).
  - Desktop link "View All Products" → `/products`.
- **Grid:** `grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5`. That is 2 columns until 1024px, then 4; gap 12px, then 20px from 640px.
- **Card:**
  - Wrapper is a `motion.div` with `group bg-white rounded-xl border border-line overflow-hidden hover:shadow-card-hover hover:border-ink/20 transition-all flex flex-col`.
    - Radius 14px.
    - Border `#DCE7EB`, which turns `rgba(7,32,58,.2)` on hover.
  - Animation: `initial {opacity:0,y:20}` → `whileInView {opacity:1,y:0}`, `transition {duration:0.3, delay:index*0.05}`, `viewport {once:true}`.
  - **Image block:**
    - `Link href={productPath(p)} className="block"` wraps `div.relative bg-surface aspect-square p-3 sm:p-5` (padding 12px, then 20px).
    - Image: `<img src=image_url alt=name class="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300">`. The scale is 1.05 over 300ms on card hover.
    - With no image, it shows a centred lucide `Beaker` `w-10 h-10` (40px) in `text-line`.
  - **Purity pill** (only if `purity` is set):
    - `absolute top-2.5 left-2.5` (10px).
    - Classes: `text-[9px] sm:text-[10px] font-semibold text-teal-dark bg-white/90 backdrop-blur-sm px-2 py-1 rounded-full border border-teal/20`.
    - aminocan equivalent: `text-bronze bg-white/90 border-bronze/20`. Alternatively match aminocan Products' `text-bronze bg-bronze-50 border-bronze/20`.
  - **Body:** `p-3 sm:p-4 flex flex-col flex-1`.
    1. Name: a `Link` around `h3.font-semibold text-ink text-sm sm:text-base leading-snug line-clamp-2 group-hover:text-ink-muted transition-colors`.
    2. Strength (if set): `p.text-[11px] sm:text-xs text-ink-muted mt-0.5`.
    3. Price: `p.text-sm sm:text-base font-bold text-ink tabular-nums mt-2`.
       - When `price > 0`: `<span class="text-[11px] font-medium text-ink-muted">From </span>$` followed by `vialPriceFor(p).toFixed(2)`.
       - Otherwise: `<span class="text-ink-muted">N/A</span>`.
    4. Rating (only when the product has a rollup): `<RatingSummary average count className="mt-1.5"/>`.
    5. CTA: `Link className="mt-3 sm:mt-4 block"` around `span.w-full inline-flex items-center justify-center px-4 py-2.5 bg-ink hover:bg-ocean text-white text-xs sm:text-sm font-semibold rounded-lg transition-colors` reading "View Product".
       - Padding is 16px × 10px, radius 8px.
       - Hover is `#0E3F5F`; in aminocan use `hover:bg-ink/90`.
  - Equal heights: the card is `flex flex-col` and the body is `flex-1`. The CTA is **not** pinned to the bottom (there is no `mt-auto`), so cards with 1-line and 2-line names have CTAs at different heights.
- **Skeleton** (×4): `bg-white rounded-xl border border-line overflow-hidden animate-pulse` containing:
  - `div.aspect-square bg-surface-2`
  - `div.p-3 sm:p-4 space-y-2` with bars `h-4 w-3/4`, `h-3 w-1/3`, and `h-9 rounded-lg w-full mt-3`, all `bg-surface-2 rounded`.
- **Mobile footer link:** "View All Products" (see the shared shell).

**Admin controls**

- Admin → Products → "Featured Product" checkbox (`products.featured`). Which cards appear also depends on stock and price.
- Ratings are customer-written reviews. They are not editable in admin except through moderation via `status`, which is covered by the product-page section.

**Porting notes**

- Aminocan already has `product_reviews`, the stats view and `/api/reviews?ids`. Port only:
  - `lib/hooks/useReviewStats.ts`
  - `RatingSummary`, added to aminocan's `components/reviews/StarRating.tsx`
  - the component itself
- Coerce `review_count`/`average_rating` with `Number()` in the hook, because aminocan's route returns raw rows.
- **Keep aminocan's ad-discount behaviour.** Render the price as `<AdPrice amount={vialPriceFor(product)} />` (from `@/components/AdPrice`, which needs `PromosContext`). Add `<AdDiscountBadge />` at `absolute top-2.5 right-2.5` in the image block, matching aminocan Products' placement.
- Add `url_slug` to the select.
- Decide whether BestSellers replaces aminocan `Products` (see Open questions).

**Open questions**

- Should aminocan keep "4 by price desc", or show 8 / sort by name like its current `Products`? vyta chose 4 by price desc, with no stated rationale beyond the comment.
- Should the cards keep an Add-to-cart action? aminocan `Products` gates it on `siteConfig.ecommerceEnabled`, and vyta dropped it.

---

### WhyChooseVyta

**What's new vs aminocan-cad**

A new 4-up value-prop row with large thin-stroke icons. It is static, with no data. It partly overlaps the "Quality & Certifications" half of aminocan's `Features`.

**Files**

- `components/home/WhyChooseVyta.tsx` (client)
- `components/icons/MapleLeaf.tsx` (new in vyta and shared with Hero; **missing in aminocan**)

**Database / API**

None.

**Components**

- `WhyChooseVyta()` takes no props and has no state.
- `VALUES: { icon, title, detail, accent? }[]`:

  | Icon | Title | Detail | Accent |
  |---|---|---|---|
  | lucide `Gem` | Verified Purity | 99%+ pure compounds | |
  | lucide `FlaskConical` | Third-Party Tested | Independent lab testing | |
  | `MapleLeaf` | Proudly Canadian | Based and shipping in Canada | `accent: true` |
  | lucide `Truck` | Free & Discreet Shipping | Secure and reliable | |

- `MapleLeaf(props: SVGProps<SVGSVGElement>)`:
  - `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden>` with a single path: `M12 2l1.4 3.6 2.6-1-.8 3.6 3.4-.8-.8 2.6 3.8.6-2.2 2 1.6 1.8-4.8.8.4 2.2-3.7-.8V22h-1.8v-5.4l-3.7.8.4-2.2-4.8-.8 1.6-1.8-2.2-2 3.8-.6-.8-2.6 3.4.8-.8-3.6 2.6 1L12 2z`.
  - It also exports `MAPLE_RED = '#D52B1E'`.
  - It accepts `strokeWidth` and ignores it.

**UI/UX**

- **Section:** `py-14 sm:py-20 bg-white`, with the standard inner wrapper.
- **Header:** centred, `text-center mb-10 sm:mb-12` (40px, then 48px).
  - h2: `font-display text-2xl sm:text-3xl font-bold text-ink` reading "Why Choose VYTA?" (**brand content — replace**, e.g. "Why Choose Aminocan?").
  - Subtitle: `p.text-sm text-ink-muted mt-1.5` reading "Premium quality. A better experience."
- **List:** `ul.grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10` (24px / 40px).
- **Item:** `motion.li.flex flex-col items-center text-center gap-3` (12px).
  - Animation: `initial {opacity:0,y:16}`, `whileInView {opacity:1,y:0}`, `transition {duration:0.35, delay:index*0.06}`, `once`.
  - Icon: `w-8 h-8 sm:w-9 sm:h-9 text-ink` (32px, then 36px), `strokeWidth={1.25}`. The accent item instead gets `style={{color:'#D52B1E'}}`.
  - Text: `span.block text-sm font-semibold text-ink` followed by `span.block text-xs text-ink-muted mt-1`.
- No hover states.

**Admin controls**

None; the copy is hard-coded.

**Porting notes**

- Rename the component (e.g. `WhyChooseUs`).
- The claims are **brand content — verify for Aminocan before shipping**:
  - "Free & Discreet Shipping": aminocan's storefront has `shipping_flat_rate` (default $20) and a conditional free-shipping promo.
  - "99%+": a product-quality claim.
  - "Proudly Canadian": confirm Aminocan is Canadian (the repo name ends in `-cad`).
- If Hero is ported too, `MapleLeaf` comes over with it, so do not duplicate it.

**Open questions**

- Aminocan's equivalent four claims, and whether Aminocan's Hero has a matching badge strip. The vyta comment says the four claims deliberately repeat the hero's badge strip.

---

### CollectionBanner

**What's new vs aminocan-cad**

A new full-bleed photographic CTA band. aminocan has no equivalent.

**Files**

`components/home/CollectionBanner.tsx` (client)

**Database / API**

None. The image is a hard-coded public Storage URL:

`BANNER_IMAGE = 'https://xbpdqpmdecsoshzttthl.supabase.co/storage/v1/object/public/assets/Explore%20The%20Vyta%20Collection.png'`

This is the vyta Supabase project's `assets` bucket (**brand content — replace**). aminocan's project is `swpcvpkcfxihxmjpjqow`.

**Components**

`CollectionBanner()` takes no props and has no state.

**UI/UX**

- **Section:** `relative overflow-hidden bg-ink`. The `#07203A` fill is the fallback while the image loads; in aminocan it is `#1A1A1A`.
- **Image:** `<img alt="" aria-hidden loading="lazy" class="absolute inset-0 w-full h-full object-cover">`.
- **Scrim** (load-bearing for contrast; do not lighten without re-checking): `span.absolute inset-0 bg-gradient-to-r from-ink/90 via-ink/60 to-ink/25`. That is `rgba(7,32,58,.9)` → `.6` → `.25`, left to right.
- **Content:** a `motion.div` with `initial {opacity:0,y:20}`, `whileInView {opacity:1,y:0}`, `transition {duration:0.5}`, `once`.
  - Classes: `relative max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 py-16 sm:py-24` (64px, then 96px vertical).
  - h2: `font-display text-3xl sm:text-4xl lg:text-5xl font-bold text-white leading-[1.1] mb-4 max-w-lg` (30, then 36, then 48px; line-height 1.1; max-width 512px). The text is "Explore the`<br/>`VYTA Collection" (**brand content**).
  - Body: `p.text-sm sm:text-base text-white/75 mb-7 max-w-md` (margin-bottom 28px, max-width 448px) reading "Premium peptides for your wellness journey."
  - CTA: `Link href="/products"` wrapping `span.inline-flex items-center gap-2 px-7 py-3.5 bg-aqua hover:bg-mist text-ink text-sm font-semibold rounded-full transition-colors` reading "Shop All Products" plus `ArrowRight w-4 h-4`.
    - Padding is 28px × 14px.
    - Colours: `#6EB2B8`, `#BBD6D6` on hover, text `#07203A`.
    - aminocan: `bg-bronze hover:bg-bronze-light text-ink` (`#9C8B5A` / `#B8A876` / `#1A1A1A`). This is the exact mapping aminocan's `LabResultsShowcase` CTA already uses.
- Left-aligned at all widths; there is no layout breakpoint change beyond type size and padding.

**Admin controls**

None; the image URL and copy are hard-coded.

**Porting notes**

- Upload an Aminocan banner image to aminocan's `assets` bucket (or `public/`) and replace the URL constant.
- If the new art is lighter, re-check white-text contrast.

**Open questions**

- Aminocan banner artwork and copy.

---

### Testimonials

**What's new vs aminocan-cad**

All of it is new: the `testimonials` table, the public and admin APIs, the Admin → Testimonials page, and the home carousel. aminocan has none of these. Nothing matches "testimonial" in aminocan's code.

**Files**

| Role | Path |
|---|---|
| Home carousel (client) | `components/home/Testimonials.tsx` |
| Types and shapers | `lib/content/testimonials.ts` |
| Public feed | `app/api/testimonials/route.ts` |
| Admin list + create | `app/api/admin/testimonials/route.ts` |
| Admin update + delete | `app/api/admin/testimonials/[id]/route.ts` |
| Admin page (client) | `app/(admin)/admin/testimonials/page.tsx` |
| Auth helper (**missing in aminocan**) | `lib/admin/content-auth.ts` (`resolveContentActor`, `requireContentEditor`, `contentErrorMessage`) |
| Permissions | `lib/permissions.ts`: `canManageContent(role) = role==='admin' \|\| role==='analytics'`, and `'/admin/testimonials'` in `ANALYTICS_PAGES` |
| Admin nav | `app/(admin)/admin/layout.tsx`: a "Content" group item `{ href:'/admin/testimonials', label:'Testimonials', icon: MessageSquareQuote }` |
| Also used | `components/reviews/StarRating.tsx` (`StarRating`, `StarInput`), `lib/admin/audit.ts` `logAuditServer` (same signature in aminocan), `lib/api-fetch.ts` `apiFetch`, `lib/hooks/usePermissions` |

**Database**

Section 2 of `reviews-testimonials-migration.sql`. For aminocan, run only this part; `product_reviews` already exists there.

```sql
CREATE TABLE IF NOT EXISTS testimonials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote         text NOT NULL,
  author_name   text NOT NULL DEFAULT 'Verified Customer',
  author_label  text,                 -- line after the name: "Verified Customer", "Clinic Partner", a city
  rating        integer NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  enabled       boolean NOT NULL DEFAULT true,   -- the storefront toggle
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_testimonials_enabled ON testimonials (enabled, sort_order);
CREATE OR REPLACE FUNCTION update_testimonials_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS testimonials_updated_at ON testimonials;
CREATE TRIGGER testimonials_updated_at BEFORE UPDATE ON testimonials
  FOR EACH ROW EXECUTE FUNCTION update_testimonials_updated_at();
ALTER TABLE testimonials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Testimonials are viewable by everyone" ON testimonials;
CREATE POLICY "Testimonials are viewable by everyone" ON testimonials FOR SELECT USING (true);
```

- There are no insert, update or delete policies. All writes go through the service-role admin routes.
- The `SELECT USING (true)` policy lets anon read **disabled** rows directly through PostgREST. Consider `USING (enabled)` on aminocan; the admin routes use the service role, so they are unaffected.
- The table default is `enabled = true`, but the admin POST forces `enabled:false` (see below).

**`lib/content/testimonials.ts`**

- `interface Testimonial { id; quote; author_name; author_label: string|null; rating: number; enabled: boolean; sort_order: number; created_at; updated_at }`.
- `shapeTestimonial(row)` normalises a row:
  - Strings are trimmed.
  - `author_name` falls back to `'Verified Customer'`; an empty `author_label` becomes `null`.
  - `rating` is rounded and clamped to 1..5, defaulting to 5.
  - `enabled` is `row.enabled !== false`.
  - `sort_order` is finite or 0.
- `testimonialPatch(body)` copies only the keys present in the body: `quote` (trimmed), `author_name`, `author_label`, `rating`, `enabled` (Boolean), `sort_order` (rounded).
- `TESTIMONIAL_QUOTE_MAX = 600`. This is enforced only by the textarea's `maxLength`, not server-side.

**API routes**

| Method / path | Auth | Behaviour | Response |
|---|---|---|---|
| `GET /api/testimonials` | public | Service-role client. `testimonials.select('*').eq('enabled',true).order('sort_order',asc).order('created_at',desc).limit(30)` | `{ testimonials: Testimonial[] }`. Any error or a missing table gives `{ testimonials: [] }` with status 200. No Cache-Control header is set; Next 15 GET handlers are dynamic by default, and the client fetches with `cache:'no-store'`. |
| `GET /api/admin/testimonials` | Bearer token → `customers.role`, must be admin or analytics, else 403 `{error:'Unauthorized'}` | Every row including disabled ones, same order | `{ testimonials }`, or 500 `{error}` |
| `POST /api/admin/testimonials` | same | Body → `testimonialPatch`. An empty quote gives 400 "A testimonial needs a quote". Inserts `{ enabled:false, ...patch }`, so a new quote is hidden unless the body says otherwise. Audit: `testimonial.create`. | 201 `{ testimonial }` |
| `PATCH /api/admin/testimonials/[id]` | same | Patch only the named keys. An empty patch gives 400 "Nothing to update"; an empty quote gives 400. Audit: `testimonial.enable` or `testimonial.disable` when `enabled` is in the patch, else `testimonial.update`. | `{ testimonial }`; 404 if there is no row |
| `DELETE /api/admin/testimonials/[id]` | same | Hard delete. Audit: `testimonial.delete`. | `{ success: true }` |

- `params` is a `Promise<{id}>` (Next 15).
- The audit entry is `{ action, entity_type:'testimonial', entity_id }`.
- `contentErrorMessage(msg, 'testimonials')` turns "does not exist / schema cache / could not find the" into a missing-table hint. **vyta bug:** the hint names `pack-options-content-migration.sql`, which is the wrong file. On aminocan, point it at the testimonials migration.

**Components: `Testimonials()`** (no props)

- **State:** `quotes: Testimonial[]` (initially `[]`) and `index: number` (initially 0).
- **Data:** `fetch('/api/testimonials', {cache:'no-store'})` on mount, with an `alive` guard and every error swallowed.
- `quotes.length === 0` → `return null`. This covers loading as well: no skeleton and no layout shift placeholder.
- `current = quotes[index] ?? quotes[0]`.
- `step(d)` sets the index to `(i + d + n) % n`, so it wraps.
- **No autoplay, by design.** There is also no swipe or keyboard-arrow handling; navigation is by buttons and dots only.

**UI/UX**

- **Section:** `py-14 sm:py-20 bg-white`, `aria-labelledby="testimonials-heading"`.
- **Wrapper:** `max-w-3xl mx-auto px-5 sm:px-8 text-center` (max-width 768px).
- **Heading:** `h2#testimonials-heading.font-display text-2xl sm:text-3xl font-bold text-ink mb-4` reading "What Our Customers Say".
- **Stars:** `<StarRating value={current.rating} size="lg" className="justify-center mb-5"/>`. The stars are 20px, gap 2px, margin-bottom 20px; colours `#FBBF24` filled and `#DCE7EB` empty.
- **Row:** `flex items-center gap-3 sm:gap-6` (12px, then 24px).
  - Prev and next buttons render only when there are 2 or more quotes.
  - Button classes: `flex-shrink-0 w-9 h-9 rounded-full border border-line text-ink-muted hover:text-ink hover:border-ink/30 flex items-center justify-center transition-colors` (36px circle).
  - Icons are lucide `ChevronLeft`/`ChevronRight` `w-4 h-4`. `aria-label` is "Previous testimonial" / "Next testimonial".
  - Quote: a `motion.blockquote` with `key={current.id}`, so it remounts on change. `initial {opacity:0,y:8}`, `animate {opacity:1,y:0}`, `transition {duration:0.3}`, `className="flex-1 min-w-0"`. There is no exit animation.
    - Text: `p.text-base sm:text-lg text-ink leading-relaxed text-balance` reading `“{quote}”` with curly quotes.
    - Attribution: `footer.text-xs sm:text-sm text-ink-muted mt-3` reading `— {author_name}`, plus (if there is a label) `<span class="text-ink-light">, {author_label}</span>`.
- **Dots** (2 or more quotes):
  - Container: `flex items-center justify-center gap-1.5 mt-6` (gap 6px, margin-top 24px).
  - Each dot is a button with `aria-label="Testimonial {i+1} of {n}"`, `aria-current={i===index}`, and `h-1.5 rounded-full transition-all`.
  - Active: `w-5 bg-ink` (20 × 6px pill, `#07203A`).
  - Inactive: `w-1.5 bg-line hover:bg-ink-light` (6 × 6px, `#DCE7EB`, then `#6E8898` on hover).

**Admin controls: Admin → Testimonials (`/admin/testimonials`)**

- **Access:** `usePermissions().canManageContent`. Without it the page renders a `rounded-xl border border-line bg-white p-8` notice: "Your role can't manage testimonials."
- **Header:**
  - h1 with `MessageSquareQuote` (`text-teal-dark`) reading "Testimonials".
  - A help line with a live count: "N is/are showing right now." or "Nothing is showing right now — the section hides itself." It adds that product star ratings are separate.
  - Button "New testimonial" (`Plus` icon; `Loader2 animate-spin` while busy): `rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink/90`.
  - The button POSTs `{ quote:'Exceptional quality and fast shipping.', author_name:'Verified Customer', author_label:'Verified Customer', rating:5, sort_order: rows.length }`, so new quotes are appended. It arrives disabled, with the flash "Testimonial created — switch it on when the wording is right."
- **Flash messages:**
  - Error: red-50 box with `AlertCircle`.
  - Success: emerald-50 box with `Check`, auto-cleared after 2500 ms.
- **States:**
  - Loading: `Loader2` plus "Loading testimonials…".
  - Empty: a dashed `border-dashed border-line` card reading "No testimonials yet. The home page simply leaves the section out until there is one."
- **One card per row** (`rounded-xl border border-line bg-white p-4 sm:p-5`):
  - **Top bar:**
    - Checkbox "Show on storefront". It PATCHes `{enabled}` immediately, with the flash "Showing on the home page." or "Hidden from the home page.".
    - Status pill: "Live" (`emerald-50/200/700`) or "Hidden" (`bg-surface border-line text-ink-muted`). Pill classes are `rounded-full px-2 py-0.5 text-[11px] font-semibold`.
    - "Delete" button (`Trash2`), right-aligned, hover red.
  - **Body:** `grid gap-4 lg:grid-cols-[1fr,260px]`.
    - Left column: the editors.
      - Quote textarea: `rows=3 maxLength=600`.
      - Name and Label "(optional)" (placeholder "Verified Customer") in a `sm:grid-cols-2` row.
      - Rating `StarInput size="lg"` and Order number input `w-24` "(low first)" in another `sm:grid-cols-2` row.
      - Input style: `rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:ring-2 focus:ring-teal/40`.
    - "Save changes" (`Save` icon) is disabled unless the draft differs from the row. It PATCHes `{quote, author_name, author_label, rating, sort_order}`.
    - Right column: a **live preview** card (`rounded-xl border border-line bg-surface p-5 text-center`).
      - Eyebrow "Home page": `text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-light`.
      - `StarRating size="md"`, then the quote in curly quotes (or "Your quote appears here."), then `— name, label`.
- **Delete confirmation modal:**
  - Overlay: `fixed inset-0 z-50 bg-ink/50`. Card: `max-w-sm rounded-2xl bg-white p-6 shadow-2xl`.
  - Title "Delete this testimonial?". Body copy suggests switching "Show on storefront" off instead.
  - Buttons: Cancel (`X`) and Delete (`bg-red-600 hover:bg-red-700`).
- **Local state:** `rows`, `drafts: Record<id, {quote, author_name, author_label, rating, sort_order}>`, `loading`, `creating`, `savingId`, `deleteTarget`, `deleting`, `error`, `success`.

**Porting notes**

- **Migration:** run section 2 of `reviews-testimonials-migration.sql` (SQL above).
- **New files for aminocan:**
  - `lib/content/testimonials.ts`
  - `lib/admin/content-auth.ts`, or reuse aminocan's existing role check: `canManageMarketing` (admin + analytics) is semantically identical to vyta's `canManageContent`.
  - `app/api/testimonials/route.ts`
  - `app/api/admin/testimonials/route.ts` and `app/api/admin/testimonials/[id]/route.ts`
  - `app/(admin)/admin/testimonials/page.tsx`
  - `components/home/Testimonials.tsx`
- **Permissions:** aminocan has no `canManageContent` and no `usePermissions().canManageContent`. Either add both, or gate on `canManageMarketing`.
- **Nav and access:**
  - Add `'/admin/testimonials'` to aminocan's `ANALYTICS_PAGES` if the analytics role should reach it.
  - Add the nav item. Aminocan has no "Content" nav group; add the item under "Marketing", or create the group (another spec section may add Announcements/Pages/Articles).
- `getSupabase()` in aminocan throws if `SUPABASE_SERVICE_ROLE_KEY` is unset (outside build). That is fine for these routes.
- aminocan `apiFetch` sets `Content-Type: application/json` unconditionally. That is fine here, because the bodies are JSON.
- Colour swaps in the admin page: `text-teal-dark` → `text-bronze`, `focus:ring-teal/40` → `focus:ring-bronze/40`.

**Open questions**

- Should the storefront section have a site-level toggle in addition to per-row `enabled`? vyta has none.
- Should aminocan seed starter testimonials? vyta ships none.

---

### ServicePromises

**What's new vs aminocan-cad**

A new hairline-bordered row of 4 service promises directly above the footer. It is static.

**Files**

`components/home/ServicePromises.tsx` (client; no hooks are actually used)

**Database / API**

None.

**Components**

- `PROMISES`:

  | Icon (lucide) | Title | Detail |
  |---|---|---|
  | `PackageCheck` | Discreet Packaging | Your privacy matters |
  | `CreditCard` | Multiple Payment Options | Secure checkout |
  | `Headphones` | Dedicated Support | We're here to help |
  | `RotateCcw` | Easy Returns | Hassle-free process |

**UI/UX**

- **Section:** `border-y border-line bg-white`. These are 1px top and bottom borders (`#DCE7EB`); there is no section padding.
- **List:** `ul.max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 py-8 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-8`. Vertical padding is 32px; gaps are 24px horizontal and 32px vertical.
- **Item:** `li.flex items-center gap-3`, left-aligned with the icon beside the text.
  - Icon: `w-6 h-6 text-ink flex-shrink-0`, `strokeWidth={1.25}` (24px).
  - Text: `span.min-w-0` containing `span.block text-xs sm:text-sm font-semibold text-ink leading-tight` and `span.block text-[11px] sm:text-xs text-ink-muted mt-0.5`.
- No animation and no hover.

**Admin controls**

None.

**Porting notes**

These are policy claims; verify each for Aminocan (**brand content**):
- "Easy Returns": is there a returns policy?
- "Multiple Payment Options": aminocan's checkout is PuraMass-hosted plus e-Transfer.

**Open questions**

- Aminocan's returns and payment wording.

---

### ShowOurWork (hidden in vyta)

**What's new vs aminocan-cad**

A redesigned, image-backed "transparency" band that links to `/lab-results`. It occupies the slot aminocan fills with `LabResultsShowcase`. It is hidden in vyta; re-enable it by mounting `<ShowOurWork />` after `<BestSellers />`.

**Files**

`components/home/ShowOurWork.tsx` (client)

**Database / API**

None. The image is hard-coded:

`PANEL_IMAGE = 'https://xbpdqpmdecsoshzttthl.supabase.co/storage/v1/object/public/assets/we%20show%20our%20work.png'`

This is **brand content — replace**.

**UI/UX**

- **Section:** `py-14 sm:py-20 bg-white`, with the standard wrapper.
- **Panel:** a `motion.div` with `initial {opacity:0,y:24}`, `whileInView {opacity:1,y:0}`, `transition {duration:0.5}`, `once`.
  - Classes: `relative grid lg:grid-cols-2 rounded-2xl sm:rounded-3xl overflow-hidden bg-brand-gradient-soft border border-line`. The radius is 18px, then 24px from 640px.
  - It is stacked into one column below 1024px.
- **Left (copy):** `p-7 sm:p-10 lg:p-12` (28, then 40, then 48px).
  - Eyebrow: `p.text-eyebrow !text-teal-dark mb-3` reading "Transparency you can trust" (`#1B5D83`; in aminocan, `bronze`).
  - h2: `font-display text-2xl sm:text-3xl lg:text-4xl font-bold text-ink mb-3` reading "We Show Our Work".
  - Body: `p.text-sm sm:text-base text-ink/80 leading-relaxed max-w-md mb-6` reading "Every batch is independently tested by a third-party lab, so you can verify exactly what you’re purchasing."
  - List: `ul.space-y-2.5 mb-7` of `li.flex items-center gap-2.5 text-sm text-ink`, each with a lucide `CheckCircle2 w-4 h-4 text-teal-dark` check. The items are "View certificates of analysis", "Confirm purity results" and "Access detailed testing data".
  - CTA: `Link href="/lab-results"` wrapping `span.inline-flex items-center gap-2 px-6 py-3 bg-ink hover:bg-ocean text-white text-sm font-semibold rounded-full shadow-card transition-colors` reading "View Lab Results" plus `ArrowRight w-4 h-4`.
- **Right (image):** `div.relative min-h-[260px] lg:min-h-full bg-brand-gradient`.
  - Image: `<img alt="" aria-hidden loading="lazy" class="absolute inset-0 w-full h-full object-cover">`.
  - Scrim: `bg-gradient-to-br from-ink/45 via-ink/25 to-ink/45`.
  - Centred card wrapper: `relative h-full flex items-center justify-center p-7 sm:p-10`.
  - Card: `w-full max-w-xs rounded-2xl bg-ink/70 backdrop-blur-md border border-white/15 p-5 sm:p-6 text-white` (max-width 320px, backdrop blur 12px).
    - "Purity verified": `text-[11px] uppercase tracking-[0.14em] text-white/60 mb-1.5`.
    - "99%+": `font-display text-4xl font-bold leading-none mb-3`.
    - "Third-Party Tested" and "COA Available": each `text-xs text-white/70`.

**Admin controls**

None.

**Porting notes**

This is an alternative to aminocan's `LabResultsShowcase` (see the diff below). Choose one; showing both duplicates the message.

**Open questions**

- Port it hidden (matching vyta) or visible? The vyta source gives no reason for hiding it.

---

### WellnessFocus (hidden in vyta)

**What's new vs aminocan-cad**

A redesign of the category grid that aminocan renders in the first half of `Features` ("Browse by Application"). The changes:
- 6 large 16:9 photo tiles instead of small icon cards.
- 3 columns instead of 6.
- Positional photography, with navy→teal gradient backdrops behind each photo.
- Capped at 6 tiles, where aminocan has no cap.

It uses the **same** data path as aminocan's `Features`: `getStoreCategories({ featuredOnly:true })` and `getCategoryIcon`. `lib/categories.ts`, `app/api/categories/route.ts` and `store-categories-migration.sql` are **byte-identical** in both repos, so no DB or API work is needed.

To re-enable it in vyta, mount `<WellnessFocus />` directly after `<Hero />` (`docs/wellness-focus-restore.md`).

**Files**

- `components/home/WellnessFocus.tsx` (client)
- `lib/categories.ts` (shared)
- `app/api/categories/route.ts` (shared)

**Database**

`store_categories` (`id uuid`, `slug text UNIQUE`, `name text`, `description text`, `icon text DEFAULT 'Beaker'`, `sort_order int`, `active bool`, `featured bool DEFAULT false`, `created_at`, `updated_at`). The columns used are `name`, `slug`, `description` and `icon`. `slug` equals `products.category`.

**API routes**

`GET /api/categories?featured=1` (public): `.eq('active',true).eq('featured',true).order('sort_order').order('name')`, returning `{ categories: StoreCategory[] }`. Errors return `{ categories: [] }`.

The component comment says "featured ones first", but the API returns **only** featured rows.

**Components**

- **`WellnessFocus()`:**
  - `tiles` state is seeded with `FALLBACK_TILES`, so the grid renders immediately.
  - It is replaced with `rows.slice(0,6)` once the fetch returns a non-empty list. Each row maps to `{ name, slug, description ?? '', icon: getCategoryIcon(row.icon) }`.
- **`FALLBACK_TILES`** (name / slug / icon):

  | Name | Slug | Icon |
  |---|---|---|
  | Metabolic Support | `Weight Loss / Metabolic` | `TestTube` |
  | Recovery & Performance | `Bodybuilding / Fitness` | `Dna` |
  | Healthy Aging & Longevity | `Anti-Aging / Beauty` | `Sparkles` |
  | Cognitive Wellness | `Cognitive / Focus` | `Brain` |
  | Joint & Tissue Support | `Healing / Recovery` | `Heart` |
  | General Wellness | `General Health` | `Leaf` |

  The slugs match aminocan's `Features` fallbacks, and so do the icons except `Leaf` vs `Pill`. The `description` field exists but is **not rendered** by the tile.
- **`FocusCard({ tile, index })`:**
  - Local `loaded` state drives a photo cross-fade.
  - `slot = index % 6`.
  - `TILE_IMAGES[slot]` is `${ASSET_BASE}/tile%20{1..6}.png`, with `ASSET_BASE = https://xbpdqpmdecsoshzttthl.supabase.co/storage/v1/object/public/assets` (**brand content — replace**).
  - `TILE_BACKDROPS[slot]`, all at 135deg:
    1. `#07203A 0%, #0E3F5F 55%, #1B5D83 100%`
    2. `#0E3F5F 0%, #1B5D83 55%, #438B9E 100%`
    3. `#1B5D83 0%, #438B9E 60%, #6EB2B8 100%`
    4. `#05182B 0%, #07203A 50%, #0E3F5F 100%`
    5. `#0E3F5F 0%, #438B9E 100%`
    6. `#07203A 0%, #1B5D83 40%, #6EB2B8 100%`

    For aminocan, rebuild these from `ink` `#1A1A1A`, `bronze-dark` `#7D6F48`, `bronze` `#9C8B5A` and `bronze-light` `#B8A876`. Each must still hold white text at AA.

**UI/UX**

- **Section:** `py-14 sm:py-20 bg-white`. Header (left variant): "Shop by Wellness Focus" / "Explore our most popular categories."; the link reads "View All Compounds" → `/products`.
- **Grid:** `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5`. That is 1, then 2, then 3 columns; gap 16px, then 20px.
- **Each wrapper:** `motion.div` with `initial {opacity:0,y:20}`, `whileInView {opacity:1,y:0}`, `transition {duration:0.35, delay:index*0.05}`, `once`.
- **Tile:**
  - `Link href="/products?category=${encodeURIComponent(slug)}"` with classes `group relative block aspect-[16/9] rounded-2xl overflow-hidden shadow-card hover:shadow-card-hover transition-shadow`.
  - **Zoom layer:** `span.absolute inset-0 transition-transform duration-500 group-hover:scale-105`, containing:
    1. Backdrop span with inline `backgroundImage`.
    2. `span.absolute inset-0 molecular-grid opacity-40`.
    3. `<img loading="lazy" decoding="async" onLoad→loaded class="absolute inset-0 w-full h-full object-cover transition-opacity duration-500 {loaded?'opacity-100':'opacity-0'}">`. A 404 leaves the gradient visible.
  - **Scrim:** `bg-gradient-to-t from-ink/85 via-ink/35 to-ink/5`.
  - **Content:** `span.absolute inset-0 p-5 flex items-end gap-3.5` (padding 20px, gap 14px).
    - Icon chip: `w-11 h-11 rounded-full border border-white/40 bg-white/10 backdrop-blur-sm` (44px), with the icon `w-5 h-5 text-white strokeWidth 1.5`.
    - Name: `span.block font-semibold text-white leading-tight text-balance` (16px).
    - "Explore" line: `span.mt-0.5 inline-flex items-center gap-1 text-xs text-white/75 group-hover:text-white`, plus `ArrowRight w-3 h-3 transition-transform group-hover:translate-x-0.5` (shifts 2px on hover).

**Admin controls**

- Admin → Categories (exists in both repos) controls name, icon, `sort_order`, `active` and `featured`.
- The tile art is positional: the first featured category gets `tile 1.png`. Reordering categories reorders the art with them.

**Porting notes**

- If ported, WellnessFocus replaces the first half of aminocan `Features`. Keep or relocate the rest of `Features`, which is the Quality & Certifications panel and the **"For Research Purposes Only" disclaimer band**.
- Port `molecular-grid` and the `shadow-card`/`shadow-card-hover` tokens, or substitute aminocan conventions.

**Open questions**

- Will Aminocan supply six tile photos?
- Show it (aminocan currently shows a category grid) or hide it like vyta?

---

## Legacy home components: diff vyta vs aminocan-cad

| File | Rendered in vyta? | Rendered in aminocan? | Diff summary |
|---|---|---|---|
| `components/ProductTicker.tsx` | No | No (dead in both) | aminocan imports `AdPrice` and renders `<AdPrice amount={product.price} strikeClassName="text-white/30"/>`; vyta renders a plain `${product.price.toFixed(2)}`. **aminocan is ahead.** |
| `components/Products.tsx` | No | Yes | aminocan has `AdPrice`/`AdDiscountBadge` (ad-visitor welcome discount; badge `absolute top-2 sm:top-3 right-2 sm:right-3`) and none of the following. vyta adds `pack_sizes, pack_options` to the select and shows the largest pack's `compareAt` struck through (`<span class="ml-1 line-through">`) beside "Pack of N · $X", without `tabular-nums`. Otherwise only `bronze`→`teal-dark`/`teal-50` recolours. **No new storefront behaviour for aminocan beyond the pack compare-at strikethrough**, which depends on vyta's `largestPackFor` returning `compareAt` (see the pricing/pack spec section). |
| `components/Features.tsx` | No | Yes | Colour-only: `bronze`→`teal-dark` on light surfaces, `bronze`→`teal-light` on dark, `hover:text-bronze-light`→`hover:text-teal-light`. No behaviour change. |
| `components/LabResultsShowcase.tsx` | No | Yes | Colour-only: `bronze`→`teal`/`teal-light`, SVG strokes `#B8A876`→`#6EB2B8` and `#9C8B5A`→`#438B9E`, CTA `bg-bronze hover:bg-bronze-light`→`bg-teal-light hover:bg-mist`. The video URL filename changed (`…glowing_bronze-gold_line…mp4` → `…glowing_teal-gold_line…mp4`, both on aminocan's `swpcvpkcfxihxmjpjqow` bucket); it is **brand content**. No behaviour change. |

Net: vyta brought **no new behaviour** into these four files that aminocan lacks, apart from the pack compare-at strikethrough in `Products`. aminocan's `AdPrice`/`AdDiscountBadge` must be kept, and should be carried into `BestSellers`.

---

## Section toggles: vyta vs aminocan-cad `lib/storefront-settings.ts`

- **No home-page section toggles exist in vyta.**
- `storefront-section-toggles-migration.sql` adds four `site_settings` booleans, all `NOT NULL DEFAULT true`:
  - `product_trust_badges_enabled`
  - `product_reviews_enabled`
  - `cart_trust_strip_enabled`
  - `checkout_verify_notice_enabled`
- `product-section-toggles-migration.sql` adds three more, also `DEFAULT true`:
  - `product_specs_enabled`
  - `product_benefits_enabled`
  - `product_certifications_enabled`
- In vyta these are edited in Admin → Settings → "Storefront Sections" card (`handleSectionToggle`). They are read as follows:
  - Product page: through `lib/site-config.ts` `SiteConfig` → `/api/site-config` → `SiteConfigContext` (`cfg.product_*_enabled` in `app/products/[slug]/page.tsx`).
  - Cart: `app/cart/page.tsx` reads `cart_trust_strip_enabled` from **`GET /api/admin/settings`**. In vyta this GET is unauthenticated (`export async function GET()` takes no request) and returns admin config.
- **aminocan already has every one of these columns**, with identical names and defaults:
  - `product-page-sections-migration.sql` adds all six `product_*_enabled` columns, including `product_cta_badges_enabled`.
  - `cart-offer-checkout-toggles-migration.sql` adds `checkout_verify_notice_enabled` and `cart_trust_strip_enabled`.
  - `lib/site-config.ts` carries the `product_*` flags.
  - `lib/storefront-settings.ts` `shapeStorefrontSettings()` exposes `cart_trust_strip_enabled` and `checkout_verify_notice_enabled` through the public, no-store `GET /api/storefront-settings`.
  - The admin UI lives in `app/(admin)/admin/promos/_components/StorefrontSectionsCard.tsx` and Admin → Marketing.
- **Do not port vyta's toggle migrations or its cart read path.** They would be no-ops on columns, and the cart read would regress aminocan's security fix, which moved the storefront off the public `/api/admin/settings`.
- **If home-section toggles are wanted in aminocan** (vyta has no precedent):
  1. Add `site_settings` booleans (`NOT NULL DEFAULT true`).
  2. Expose them through `shapeStorefrontSettings` (`/api/storefront-settings`) or `shapeSiteConfig` (`/api/site-config`).
  3. Add switches to `StorefrontSectionsCard`.

  This is new design, not a port.

---

## Open questions (consolidated)

1. **Final aminocan home order.** Options:
   - Adopt vyta's order wholesale: Hero, BestSellers, WhyChoose, CollectionBanner, Testimonials, ServicePromises.
   - Keep `LabResultsShowcase` or `ShowOurWork`.
   - Keep the `Features` category grid or `WellnessFocus`.

   Dropping aminocan's `Features` also drops its **"For Research Purposes Only" disclaimer band** on the home page. vyta's Footer does not contain that text; it appears in vyta only on `AgeVerification`, signup, contact, terms and the product detail page. Confirm compliance is acceptable.
2. Should BestSellers keep 4 items sorted by price descending, or follow aminocan's 8 sorted by name? Keep add-to-cart?
3. Aminocan brand copy and imagery for:
   - WhyChoose claims (the free-shipping claim vs the $20 flat rate)
   - ServicePromises (returns, payments)
   - CollectionBanner image and headline
   - ShowOurWork panel image
   - WellnessFocus tile photos 1–6
4. Testimonials RLS: keep vyta's `SELECT USING (true)` or tighten it to `USING (enabled)`?
5. Gate the Testimonials admin with a new `canManageContent`, or reuse aminocan's `canManageMarketing` (same roles)?
6. Should ShowOurWork and WellnessFocus be ported as hidden files (vyta parity) or skipped?
