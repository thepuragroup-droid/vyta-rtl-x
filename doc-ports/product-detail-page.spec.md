# Product Detail Page (`/products/[slug]`) — Build Spec

> Definitive spec for rebuilding the storefront product detail page (PDP) on the sibling site.
> Generated from: `app/products/[slug]/page.tsx`, `app/products/[slug]/ProductDetailClient.tsx`,
> `components/product/ProductInfoTabs.tsx`, `components/product/ProductReviews.tsx`,
> `components/reviews/StarRating.tsx`, `components/content/RichText.tsx`,
> `lib/products/{products-server,structured-data,url,benefits}.ts`, `lib/pricing.ts` (pack helpers),
> `lib/reviews.ts`, `app/api/reviews/route.ts`, `contexts/CartContext.tsx` (`addItem`, `flyToCart`),
> `lib/site-config-server.ts`, `lib/config.ts`, `tailwind.config.ts`, `app/globals.css`, `app/layout.tsx`.
> Schema from: `reviews-testimonials-migration.sql`, `product-url-slug-migration.sql`,
> `product-remove-all-dashes-migration.sql`, `pack-option-pricing-migration.sql`,
> `pack-option-badge-migration.sql`, `pack-options-content-migration.sql`,
> `invoice-spec-integration-migration.sql`, `catch-up-schema-migration.sql`,
> `storefront-section-toggles-migration.sql`, `product-section-toggles-migration.sql`,
> `product-cta-badges-toggle-migration.sql`, `products-schema.sql`.
>
> Stack: **Next.js 15 App Router** (React 19, server component shell + client component) +
> **Supabase** (`@supabase/supabase-js` v2; service-role server client, anon browser client) +
> **Tailwind CSS 3.4** + **framer-motion 12** + **lucide-react**.
>
> No DB schema or intricacies were supplied with the request, so §2 is reproduced from the
> migrations in this repo, and every behavioural rule in §5 is taken from the code itself.
> Brand-specific copy (VYTA, "Ships from Canada", "PPB Analytical", CAD) is called out in §7 —
> decide per sibling brand before building.

---

## 0. The traps, up front

1. **Two slugs.** `products.slug` is the internal SKU id (never changes; used by imports, admin and
   JSON-LD `sku`). `products.url_slug` is the public URL. The route looks up `url_slug` first, then
   falls back to `slug`, and **308-redirects** a legacy `slug` hit to `/products/{url_slug}`. Always
   build links through `productPath()` (§3.10) — never interpolate a slug.
2. **`price` is the CASE price, not the vial price.** The single-vial price is `vial_price` when
   `> 0`, otherwise `price / vials_per_box` (default 10). A stored `vial_price = 0` counts as unset.
3. **`price === 0` means "not for sale"**: headline shows `N/A`, CTA shows *Currently Unavailable*.
   The check is against `price`, not the resolved vial price.
4. **`stock_quantity` is counted in VIALS.** A pack of N is buyable only while
   `floor(stock_quantity / N) >= 1`. Each pack has its own cap.
5. **Packs come from three places**, in this order: `pack_options` (jsonb, enabled rows only) →
   `pack_sizes` (int[]) → the legacy pair `[1, vials_per_box]`.
6. **The picker opens on the 3-pack** when the product is sold in a 3-pack and it is in stock;
   otherwise the first in-stock pack; otherwise the first pack.
7. **The page is ISR (revalidate 300s)**, so the client re-reads `stock_quantity, price,
   vial_price, pack_options, active` from the browser on mount and merges them over the server
   props (`useLiveProduct`). A failed refresh is silently ignored.
8. **`coa_url` is a `text[]`** despite the singular name (the June live snapshot still shows `text`
   — confirm on the sibling DB, §7).
9. **Inactive products still render** (bookmarks keep working) but get `robots: noindex, follow` and
   `OutOfStock` availability in JSON-LD. They are excluded from `generateStaticParams`, the
   sitemap and the Related row.
10. **Reviews can only be written by verified buyers.** The browser never decides this — `/api/reviews`
    checks `orders.items` (jsonb) **and** `order_items` with the service role. `product_reviews`
    has **no insert policy**.

---

## 1. Overview

The PDP is the single screen at `/products/{url_slug}`. A **server component** (`page.tsx`) resolves
the product, the related products, the bacteriostatic-water companion product, the review rollup and
the site-settings toggles; emits SEO metadata, a canonical URL, and two JSON-LD blocks (`Product`,
`BreadcrumbList`); and hands everything to a **client component** (`ProductDetailClient`).

The client component renders, top to bottom:

1. Global `Navigation` (fixed).
2. **Hero header strip** — back link + category chip + purity chip over a faint dotted pattern.
3. **Two-column product block** (stacks on mobile):
   - **Left:** square hero image (swaps to the case photo when a multi-vial pack is selected),
     *Out of Stock* overlay, and a 4-up **trust-badge strip** (toggle).
   - **Right:** eyebrow, H1 name, **Purity/Strength/Form tiles** (toggle), **Certificate of
     Analysis button** (if any COAs), **pack picker**, headline price, quantity stepper,
     **Add to Cart**, **CTA badge row** (toggle), **Key Research Benefits** list (toggle).
4. **Info tabs** (`ProductInfoTabs`) — Overview / Research Applications / Quality & Testing /
   Shipping / FAQs, with a narrow assurance rail on desktop.
5. **Customer Reviews** (`ProductReviews`, toggle) — rollup + histogram, list, write/edit form.
6. **"You'll also need" bacteriostatic-water upsell** (hidden on the water's own page).
7. **Quality Certifications** navy panel (toggle).
8. **Related Products** — up to 4 active products in the same category.
9. Global `Footer`.
10. **COA modal** (portal-less fixed overlay) — iframe PDF viewer on ≥640px, an "open PDF" button on
    mobile, tabs when there are several certificates.

Adding to cart writes to the `CartContext` (localStorage-backed), plays a "fly to cart" animation
from the hero image to the nav cart icon, and flips the CTA to a green *Added to cart* state for
1.8s.

---

## 2. Database schema

### 2.1 `products` — columns this page reads

Base table from `products-schema.sql` + the column migrations listed in the header. Only the columns
the PDP touches are shown; the full table (cost, dimensions, supplier, low-stock fields…) is in
`doc-ports/product-catalog-inventory-cluster.spec.md`.

| Column | Type | Null | Default | Added by | Used for |
|---|---|---|---|---|---|
| `id` | `uuid` | NO | `uuid_generate_v4()` | base | key; cart `productId`; reviews FK |
| `name` | `varchar` | NO | — | base | H1, alt text, meta title, JSON-LD |
| `slug` | `varchar` | yes | — | base | internal SKU id; legacy URL fallback; JSON-LD `sku`; bat-water lookup (`'bacteriostatic-water-30ml'`) |
| `url_slug` | `text` | yes | trigger-derived | `product-url-slug-migration.sql` | public URL; **unique partial index** `WHERE url_slug IS NOT NULL` |
| `category` | `varchar` | yes | — | base | category chip; related-products filter; meta title fallback |
| `description` | `text` | yes | — | base | Overview tab (RichText); meta description fallback |
| `description_short` | `text` | yes | — | base | meta description (preferred) |
| `benefits` | `text` | yes | — | base | Key Research Benefits list (one point per line; legacy comma list) |
| `mechanism` | `text` | yes | — | base | Research Applications tab |
| `price` | `numeric` | NO | — | base | **case price**; `0` ⇒ not for sale |
| `vial_price` | `numeric` | yes | — | `invoice-spec-integration-migration.sql` | explicit single-vial price (`> 0` to count) |
| `vials_per_box` | `integer` | NO | `10` | `invoice-spec-integration-migration.sql` | case size; legacy pack pair |
| `pack_sizes` | `integer[]` | yes | — | `pack-options-content-migration.sql` | quantities-only pack list |
| `pack_options` | `jsonb` | yes | — | `pack-option-pricing-migration.sql` | rich pack config (see 2.2) |
| `strength` | `varchar` | yes | — | base | spec tile; meta title; FAQ copy |
| `purity` | `varchar` | yes | — | base | purity chip + tile; Quality tab (fallback `'99%'`) |
| `form` | `varchar` | yes | — | base | spec tile; FAQ copy (fallback `'powder'`) |
| `stock_quantity` | `integer` | NO | `0` | base | vials on hand; pack caps; OOS state |
| `active` | `boolean` | yes | `true` | base | noindex + JSON-LD availability; related filter |
| `image_url` | `text` | yes | — | base | hero (single vial), related cards, OG image |
| `box_image_url` | `text` | yes | — | `catch-up-schema-migration.sql` | hero when a pack size > 1 is selected |
| `coa_url` | `text[]` | yes | — | `catch-up-schema-migration.sql` | COA button + modal tabs |
| `updated_at` | `timestamptz` | yes | `now()` | base | sitemap only |

RLS: `CREATE POLICY "Products are viewable by everyone" ON products FOR SELECT USING (true);`
— required, because `useLiveProduct` reads with the **anon** browser client.

`url_slug` is maintained by trigger `trg_products_set_url_slug` (`BEFORE INSERT OR UPDATE OF slug,
url_slug`): when `url_slug` is null/blank it is set to `public.product_url_slug(slug)`. Current
function body (`product-remove-all-dashes-migration.sql`, supersedes the earlier one):

```sql
create or replace function public.product_url_slug(slug text)
returns text language sql immutable as $$
  select replace(
           regexp_replace(
             regexp_replace(lower($1), 'ipamorelin', 'ipam', 'g'),
             '(?<=-)ipa(?=-|$)', 'ipam', 'g'),
           '-', '')
$$;
```

Mirrored in TS by `toUrlSlug()` (`lib/products/url.ts`). e.g. `bpc-157-10mg → bpc15710mg`.

### 2.2 `products.pack_options` jsonb shape

```jsonc
[
  { "size": 1,  "label": null,   "badge": null,          "price": null,  "compare_at": null, "enabled": true },
  { "size": 3,  "label": null,   "badge": "Most Popular", "price": 129.0, "compare_at": null, "enabled": true },
  { "size": 10, "label": "Case", "badge": "Best Value",   "price": 399.0, "compare_at": null, "enabled": true }
]
```

DB check `products_pack_options_shape_chk`: array of objects; `size` an integer 1–1000; `price` /
`compare_at`, when numbers, `>= 0`. App-side normalisation (`normalizePackOptions`): dedupe by size
(later wins), sort ascending, max **8** packs, `label` trimmed to 60 chars, `badge` trimmed to
**24** chars, negative/blank money → `null`, `enabled !== false` ⇒ enabled. Also accepts a bare
number array (`[1,3,5,10]`).

### 2.3 `product_reviews` + `product_review_stats`

```sql
CREATE TABLE IF NOT EXISTS product_reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_id  uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id     uuid REFERENCES orders(id) ON DELETE SET NULL,
  rating       integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title        text,
  body         text,
  author_name  text NOT NULL DEFAULT 'Verified Customer',
  verified     boolean NOT NULL DEFAULT true,
  status       text NOT NULL DEFAULT 'published',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_reviews_one_per_customer UNIQUE (product_id, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_product_reviews_product  ON product_reviews (product_id, status);
CREATE INDEX IF NOT EXISTS idx_product_reviews_customer ON product_reviews (customer_id);
-- trigger product_reviews_updated_at: BEFORE UPDATE → NEW.updated_at = now()

ALTER TABLE product_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Published reviews are viewable by everyone" ON product_reviews
  FOR SELECT USING (status = 'published');
-- NO insert/update policy: rows are written only by /api/reviews with the service role.

CREATE VIEW product_review_stats WITH (security_invoker = true) AS
  SELECT product_id,
         COUNT(*)::integer              AS review_count,
         ROUND(AVG(rating)::numeric, 2) AS average_rating
  FROM product_reviews
  WHERE status = 'published'
  GROUP BY product_id;
GRANT SELECT ON product_review_stats TO anon, authenticated;
```

### 2.4 `site_settings` — PDP section toggles (singleton row)

| Column | Type | Default | Prop | Controls |
|---|---|---|---|---|
| `store_name` | text | `'VYTA'` (app default) | — | meta title suffix; JSON-LD brand/seller |
| `product_trust_badges_enabled` | `boolean NOT NULL` | `true` | `showTrustBadges` | 4-up strip under hero image |
| `product_reviews_enabled` | `boolean NOT NULL` | `true` | `showReviews` | Customer Reviews section |
| `product_specs_enabled` | `boolean NOT NULL` | `true` | `showSpecs` | Purity/Strength/Form tiles |
| `product_benefits_enabled` | `boolean NOT NULL` | `true` | `showBenefits` | Key Research Benefits list |
| `product_certifications_enabled` | `boolean NOT NULL` | `true` | `showCertifications` | Quality Certifications panel |
| `product_cta_badges_enabled` | `boolean NOT NULL` | `true` | `showCtaBadges` | badge row under Add to Cart |

`readSiteConfigRow` treats anything but an explicit `false` as `true`; a failed read falls back to
`DEFAULT_SITE_CONFIG` (all on).

### 2.5 Tables read only by `/api/reviews` (purchase check)

- `customers (id, first_name, last_name)` — author display name.
- `orders (id, customer_id, status, items jsonb, created_at)` — storefront orders keep lines in
  `items`; a line matches when `item.id` or `item.product_id` equals the product UUID.
- `order_items (order_id, product_id TEXT)` — admin-raised orders. `product_id` is **text**.

### 2.6 Schema usage map

| Table / view | Columns | Reader / writer | Mechanism | Client |
|---|---|---|---|---|
| `products` | `*` by `url_slug`, then by `slug` | `getPublicProduct` | server component, `React.cache` | service role (`getSupabase()`) |
| `products` | `*` where `category = X AND id <> Y AND active` limit 4 | `getRelatedProducts` | server | service role |
| `products` | `*` where `slug = 'bacteriostatic-water-30ml'` | `getBacteriostaticWater` | server | service role |
| `products` | `slug, url_slug, updated_at` where `active` limit 2000 | `getProductsForSitemap` → `generateStaticParams` | build/ISR | service role |
| `products` | `stock_quantity, price, vial_price, pack_options, active` by `id` | `useLiveProduct` | client `useEffect` | anon browser (`supabase`) |
| `product_review_stats` | `review_count, average_rating` by `product_id` | `getProductReviewStats` (JSON-LD only) | server | service role |
| `product_reviews` | read published (limit 100); insert/update own | `/api/reviews` GET/POST | route handler | service role |
| `customers`, `orders`, `order_items` | see 2.5 | `/api/reviews` | route handler | service role |
| `site_settings` | see 2.4 | `getServerSiteConfig` | server | service role |

---

## 3. Components

### 3.1 `ProductPage` — `app/products/[slug]/page.tsx`

- **Type:** Server component (async). `export const revalidate = 300`.
- **Purpose:** resolve data, 404/redirect, SEO metadata + JSON-LD, render the client component.
- **Params:** `{ params: Promise<{ slug: string }> }` (Next 15 async params).
- **`generateStaticParams()`:** `getProductsForSitemap()` → `{ slug: url_slug || slug }[]`.
  `dynamicParams` left at default `true`, so unknown slugs render on demand. DB failure ⇒ `[]`.
- **`generateMetadata()`:**
  - Not found ⇒ `{ title: 'Product not found | VYTA' }` (hard-coded brand — replace).
  - `title`: `` `${name} — ${strength || category} | ${store_name}` `` (em dash).
  - `description`: `productMetaDescription(product)` — `description_short || description`,
    whitespace-collapsed, ≤160 chars, cut on a word boundary + `…`.
  - `alternates.canonical`: `${SITE_URL}${productPath(product)}`.
  - `robots: { index: false, follow: true }` **only** when `!product.active`.
  - `openGraph`: `{ title: name, description, type: 'website', url: canonical, images: [image_url || box_image_url] }` (images omitted when none).
  - `twitter`: `{ card: 'summary_large_image', title, description, images }`.
- **Body:**
  1. `getPublicProduct(slug)` → `notFound()` if null (Next default 404; there is no
     `app/not-found.tsx`).
  2. If `product.url_slug && product.url_slug !== slug` ⇒ `permanentRedirect('/products/' + url_slug)` (308).
  3. `Promise.all([getRelatedProducts(category, id), getBacteriostaticWater(), getProductReviewStats(id), getServerSiteConfig()])`.
  4. Emits two `<script type="application/ld+json">` with `JSON.stringify(...).replace(/</g, '\\u003c')`.
  5. Renders `<ProductDetailClient product relatedProducts batWater show*={cfg.product_*_enabled} />`.
- **Data access:** all via `lib/products/products-server.ts` (service-role client, every function
  wrapped in try/catch → `null`/`[]`, wrapped in `React.cache` so metadata + body share one query).

### 3.2 `ProductDetailClient` — `app/products/[slug]/ProductDetailClient.tsx`

- **Type:** Client component (`'use client'`).
- **Purpose:** the whole interactive page.
- **Props (`ProductDetailClientProps`):**
  - `product: Product` — never null (route 404s first). No loading/error state in this component.
  - `relatedProducts: Product[]`
  - `batWater: Product | null`
  - `showTrustBadges?`, `showReviews?`, `showSpecs?`, `showBenefits?`, `showCertifications?`, `showCtaBadges?` — all `boolean`, default `true`.
- **`Product` interface:** `id, name, slug, url_slug?, category, description, description_short,
  benefits, mechanism, price, vial_price, vials_per_box, pack_sizes?, pack_options?: unknown,
  strength, purity, form, stock_quantity, active, image_url, box_image_url, coa_url: string[] | null`.
- **State / hooks:**
  - `product = useLiveProduct(serverProduct)` (§3.3).
  - `showCoaModal: boolean`, `activeCoa: string | null`.
  - `packSize: number | null` (null until the opening-pack effect runs), `qty: number` (1), `added: boolean`.
  - `heroImageRef: RefObject<HTMLDivElement>` — fly-to-cart origin.
  - `useCart()` → `addItem`, `flyToCart`; `useToast()` → `toast.error`.
  - Effect keyed on `product.id`: `trackActivity({type:'view', productId, productName})` +
    GA4 `trackViewItem({item_id, item_name, item_variant:'Vial', item_category, price: vialPriceFor(product), quantity:1})`.
  - Effect keyed on `product.id`: pick opening pack (trap 6), reset `qty=1`, `added=false`.
- **Derived values:**
  - `packs = packOptionsFor(product)`; `capFor(size) = floor(stock_quantity / size)`.
  - `selectedPack = packs.find(size === packSize) ?? packs[0] ?? null`.
  - `heroImage = (selectedPack.size > 1 ? box_image_url : null) ?? image_url ?? null`.
  - `vialUnitPrice = vialPriceFor(product)`; `headlinePrice = selectedPack?.price ?? vialUnitPrice`;
    `headlineCompareAt = selectedPack?.compareAt ?? null`; `selectedCap = capFor(selectedPack.size)`;
    `lineTotal = round2(headlinePrice * qty)`; `benefitPoints = parseBenefits(benefits)`.
- **Data access:** none directly beyond `useLiveProduct`; cart is local.
- **Renders:** `Navigation`, `ProductInfoTabs`, `ProductReviews` (if `showReviews`), `Footer`,
  inline COA modal. **Rendered by:** `ProductPage`.

### 3.3 `useLiveProduct(initial)` — same file

```ts
supabase.from('products')
  .select('stock_quantity, price, vial_price, pack_options, active')
  .eq('id', initial.id).maybeSingle()
  .then(({ data, error }) => { if (!cancelled && !error && data) setLive(cur => ({ ...cur, ...data })) })
```
Resets to `initial` whenever `initial` changes (related-product navigation does not unmount).
Cancels on unmount. Errors are swallowed — checkout re-checks stock server-side.

### 3.4 `ProductInfoTabs` — `components/product/ProductInfoTabs.tsx`

- **Type:** Client component.
- **Props:** `product: { name, description, mechanism, purity, strength, form, category }` (all
  nullable strings except name), `coaCount: number`, `onViewCoa: () => void`.
- **State:** `tab: 'overview' | 'applications' | 'quality' | 'shipping' | 'faqs'` (default
  `'overview'`), `openFaq: number | null` (default `0` — first FAQ open).
- **Data access:** none. All copy is static templates around product fields (§4.3.7).
- **Renders:** `RichText`. **Rendered by:** `ProductDetailClient` (always, not toggleable).
- **A11y:** `role="tablist"` + `aria-label="Product information"`; each tab `role="tab"`,
  `id="product-tab-{id}"`, `aria-selected`, `aria-controls="product-panel-{id}"`; panel
  `role="tabpanel"`, `aria-labelledby`. FAQ buttons carry `aria-expanded`. No arrow-key handling.

### 3.5 `ProductReviews` — `components/product/ProductReviews.tsx`

- **Type:** Client component.
- **Props:** `productId: string`, `productName: string`.
- **State:** `data: ProductReviewsResponse | null`, `loading` (true), `writing`, `saving`,
  `error: string | null`, form fields `rating` (5), `title` (''), `body` ('') — pre-filled from
  `viewer.review` when the reader already reviewed.
- **Data access:** `apiFetch('/api/reviews?product_id=…')` (GET) and `apiFetch('/api/reviews', {method:'POST', body:{product_id, rating, title, body}})`.
  `apiFetch` attaches `Authorization: Bearer <supabase access token>` when a session exists,
  10s timeout, throws `Error(json.error)` on non-2xx.
- **Renders:** `StarRating`, `StarInput`, `next/link` to `/login`. **Rendered by:** `ProductDetailClient`.

### 3.6 `/api/reviews` — `app/api/reviews/route.ts`

- **GET `?product_id=`** → `{ reviews, stats, viewer }`:
  - `reviews`: published rows for the product, `created_at desc`, **limit 100**, shaped by
    `shapeReview` (rating clamped 1–5, blank title/body → null, author default
    `'Verified Customer'`); `mine: true` on the caller's own row.
  - `stats`: computed **from the fetched rows** (count, average rounded to 2dp) — not from the view.
  - `viewer`: `{ signedIn, canReview: signedIn && (hasOwnReview || boughtIt), review: mine | null }`.
  - DB error ⇒ 500 (`MIGRATION_HINT` when the table is missing). Missing `product_id` ⇒ 400.
- **GET `?ids=a,b,…`** (≤50) → `{ stats: [...] }` from `product_review_stats` (used by catalog cards, not the PDP).
- **POST** `{ product_id, rating, title?, body? }`:
  - 401 `'Sign in to write a review'` without a valid bearer token.
  - 400 for bad JSON / missing `product_id` / rating not an integer 1–5 (`'Give the product a rating from 1 to 5'`).
  - 403 `'Only customers who have ordered this product can review it'` unless a purchase is found
    **or** the customer already has a review (edits survive deleted orders).
  - Upsert-by-hand: update existing `(product_id, customer_id)` row, else insert. `title` ≤120,
    `body` ≤2000 chars (trimmed), `author_name = "First L."`, `verified: true`, `order_id` = found
    order or existing.
- **Purchase check (`findPurchase`)**: latest 200 orders of the customer with status in
  `['received','confirmed','processing','shipped','delivered','completed','paid']`; match in
  `orders.items[].id|product_id`; else any `order_items` row with `product_id = <uuid string>` in
  those orders.

### 3.7 `StarRating` / `StarInput` — `components/reviews/StarRating.tsx`

- **`StarRating({ value, size='sm', className, label })`** — read-only, supports fractional fill:
  each star is a `Star` in `text-line` (#DCE7EB) with an absolutely positioned, overflow-hidden copy
  in `text-amber-400 fill-amber-400` (#FBBF24) clipped to `width: fill*100%`. `strokeWidth={1.5}`,
  gap `0.5` (2px). `role="img"`, `aria-label="4.6 out of 5"`.
- **`StarInput({ value, onChange, size='xl', disabled })`** — 5 buttons, hover preview, `p-0.5
  rounded`, `hover:scale-110`, `focus-visible:ring-2 ring-teal/40`, gap `1` (4px).
- Sizes: `xs` 12px · `sm` 14px · `md` 16px · `lg` 20px · `xl` 24px.

### 3.8 `RichText` / `renderInline` — `components/content/RichText.tsx`

Inline syntax parsed to React nodes, **never HTML**: `**bold**` → `<strong class="font-semibold text-ink">`,
`*italic*` → `<em>`, `` `code` `` → `<code class="px-1.5 py-0.5 rounded bg-surface-2 text-[0.9em] font-mono text-ink">`,
`[label](url)` → link `text-teal-dark underline underline-offset-2 decoration-teal/40 hover:decoration-teal-dark`
(internal `/`/`#` via `next/link`; external `target=_blank rel="noopener noreferrer"`; unsafe URLs
render as plain text via `safeUrl`). `RichText` splits on blank lines into `<p>`s (`mt-4` after the
first); single newlines → `<br/>`.

### 3.9 `parseBenefits` — `lib/products/benefits.ts`

1. Pasted HTML → lines (`<br>`, `</li>`, `</p>`, `</div>`, `</h1-6>`, `</tr>`, `<li>` become `\n`;
   other tags dropped; `&nbsp; &amp; &lt; &gt; &quot; &#39;` decoded).
2. If the text contains **any** newline → split on newlines; otherwise split on commas (legacy).
3. Strip leading bullets/numbering (`- – — • * · ‣ ▪` or `1.` / `1)`), trim, drop empties.

### 3.10 URL helpers — `lib/products/url.ts`

`productPath(p) = p.url_slug || p.slug ? '/products/' + (url_slug || slug) : '/products'`.
`toUrlSlug(slug)` = lowercase → `ipamorelin→ipam` → `-ipa-→-ipam-` → strip all `-`.

### 3.11 Pricing helpers used — `lib/pricing.ts`

| Function | Rule |
|---|---|
| `round2(n)` | `Math.round(n*100)/100` |
| `vialsPerBoxOf(v)` | `v > 0 ? v : 10` |
| `vialPriceFor(p)` | `vial_price > 0 ? round2(vial_price) : round2(price / vialsPerBoxOf(vials_per_box))` |
| `packSizesFor(p)` | enabled `pack_options` sizes → `pack_sizes` → `vialsPerBox > 1 ? [1, vialsPerBox] : [1]` |
| `packsInStock(stock, size)` | `floor(max(0, stock) / size)` |
| `packLabel(size)` | `1 → 'Single vial'`, else `` `Pack of ${n}` `` |
| `packOptionsFor(p)` | see below |

`packOptionsFor` — for each **enabled** stored pack:
```
undiscounted  = round2(vialPrice * size)
price         = option.price ?? undiscounted
rawCompare    = option.compare_at ?? (price < undiscounted ? undiscounted : null)
compareAt     = rawCompare > price ? rawCompare : null
savings       = compareAt ? round2(compareAt - price) : 0
savingsPercent= compareAt > 0 ? Math.round(savings / compareAt * 100) : 0
perVialPrice  = round2(price / size)
label         = option.label ?? packLabel(size)
badge         = option.badge (≤24 chars) | null
```

### 3.12 JSON-LD builders — `lib/products/structured-data.ts`

- **Product:** `@type Product`, `name`, `description` (meta description, max 5000), `image`
  [absolute `image_url`, `box_image_url`], `sku: slug`, `category`, `brand {Brand, store_name}`,
  `additionalProperty` [Purity, Strength, Form as `PropertyValue`, blanks dropped], `offers`
  `{ Offer, url: canonical, priceCurrency: 'CAD', price: vialPriceFor(product).toFixed(2),
  itemCondition: NewCondition, availability: active && stock > 0 ? InStock : OutOfStock,
  seller {Organization, store_name} }`, and `aggregateRating {ratingValue, reviewCount,
  bestRating 5, worstRating 1}` **only** when the view reports `review_count ≥ 1` and average `> 0`.
- **BreadcrumbList:** Home (`origin`) › Products (`origin/products`) › product name (canonical).

### 3.13 Cart integration — `contexts/CartContext.tsx`

- `addItem(item): boolean` adds **one** unit to line id `` `${productId}::p${packSize}` ``; returns
  `false` if the line is already at `item.stock_quantity`. On success: bumps `bumpKey` (nav badge
  animation), fires GA4 `add_to_cart` for one unit, and `trackActivity({type:'cart', …})`.
- The PDP calls `addItem` **`qty` times in a loop** with:
  `{ productId, unit: size > 1 ? 'case' : 'vial', packSize: size, vialsPerBox: vialsPerBoxOf(vials_per_box), name, price: selectedPack.price, strength: strength ?? '', image_url: image_url || undefined, stock_quantity: capFor(size) }`.
- `flyToCart(heroImageRef.current, { image_url: heroImage })` — a 36×36px white tile (`rounded-lg
  border border-line bg-white shadow-lg shadow-black/20`, image `object-contain p-1`, fallback
  `Beaker` 16px `text-teal-dark`) portalled into `fixed inset-0 z-[300]`, animated over **0.8s
  easeInOut** along `x:[start, mid, end]`, `y:[start, min(startY,endY)-90, end]`,
  `scale:[1, .85, .3]`, `opacity:[1, 1, .2]`, `times:[0, .55, 1]`, ending on the first visible
  `[data-cart-target]` element (fallback: `innerWidth-44, 28`).
- Cart persists to `localStorage` key `northern_peptides_cart`.

---

## 4. UI/UX design overview

### 4.1 Design tokens (resolved)

**Colors** (`tailwind.config.ts` + `:root` in `globals.css`):

| Token / class | Hex | Role on PDP |
|---|---|---|
| `ink` / `navy` | `#07203A` | primary text, dark buttons, dark panels |
| `ink-muted` | `#56707F` | secondary text |
| `ink-light` | `#6E8898` | review dates, empty-state icon |
| `surface` | `#F7FAFB` | tiles, image well, inactive pack buttons |
| `surface-2` | `#EDF3F5` | histogram track, "Yours" chip, inline code |
| `line` | `#DCE7EB` | all hairlines/borders; placeholder icons; empty stars |
| `teal` | `#438B9E` | button hover tint, focus rings, shadows |
| `teal-dark` (Vital Blue) | `#1B5D83` | eyebrow, purity values, COA button, icons, badge chips |
| `teal-light` (Aqua) | `#6EB2B8` | "You'll also need" kicker, certifications beaker |
| `teal-50` | `#F1F8F9` | purity chip / verified-purchase chip bg |
| `ocean` | `#0E3F5F` | review button hover |
| `white` | `#FFFFFF` | page bg (`main.bg-white`) |
| `emerald-50` / `-500` / `-600` / `-700` | `#ECFDF5` / `#10B981` / `#059669` / `#047857` | savings chip bg / "Added" CTA / headline savings / savings chip text |
| `red-200` / `-500` / `-600` | `#FECACA` / `#EF4444` / `#DC2626` | OOS CTA border / "Sold out" / OOS CTA text + form error |
| `amber-400` | `#FBBF24` | stars, histogram bars |

Opacity variants used (Tailwind `/NN` → rgba): `ink/90` `rgba(7,32,58,.9)`, `ink/40`, `ink/20`,
`ink/5`; `teal/10` `rgba(67,139,158,.1)`, `teal/20`, `teal/25`, `teal/30`, `teal/40`, `teal/90`;
`teal-dark/40` `rgba(27,93,131,.4)`; `white/5, /10, /20, /30, /50, /60, /70, /75`; `black/60`,
`black/65`, `black/70`.

**Typography:** Inter (variable, `next/font/google`, `axes: ['opsz']`, `--font-inter`,
`display: swap`). `h1–h4` globally get `font-variation-settings: 'opsz' 32; letter-spacing: -0.02em`
(utility `tracking-*` overrides). `font-mono` = Tailwind default mono stack. Scale used (Tailwind
defaults, size/line-height): `text-[9px]`, `text-[10px]`, `text-[11px]`, `text-[13px]`, `xs`
12/16, `sm` 14/20, `base` 16/24, `lg` 18/28, `xl` 20/28, `2xl` 24/32, `3xl` 30/36, `4xl` 36/40.
Prices use `tabular-nums`.

**Radii (customised):** `rounded` 4px · `rounded-lg` 8px · **`rounded-xl` 14px (0.875rem)** ·
**`rounded-2xl` 18px (1.125rem)** · `rounded-full`.

**Shadows:** Tailwind defaults (`shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-2xl`) with coloured
variants `shadow-teal/30`, `shadow-ink/5`, `shadow-black/20`.

**Breakpoints:** `sm` 640 · `md` 768 · `lg` 1024 · `xl` 1280. **Container:** `max-w-7xl` (1280px),
`mx-auto px-4 sm:px-8 lg:px-12` (16 → 32 → 48px).

**Page ground:** `main` is `min-h-screen bg-white` (covers the body's white→cloud→white gradient).

### 4.2 Page wireframe

```
┌──────────────────────── Navigation (fixed, z-50) ────────────────────────┐
├─ Hero header (white, dotted pattern @2%, border-b line) ──────────────────┤
│  ← Back to Products                                                       │
│  [Category]  [99% Purity]                                                 │
├───────────────────────────────────────────────────────────────────────────┤
│  ┌──────────── md:col 1 ────────────┐  ┌──────────── md:col 2 ──────────┐ │
│  │  ┌──────────────────────────┐    │  │ RESEARCH GRADE PEPTIDE BLEND   │ │
│  │  │                          │    │  │ Product Name (H1)              │ │
│  │  │    square hero image     │    │  │ [Purity][Strength][Form]       │ │
│  │  │   (OOS pill overlay)     │    │  │ ┌ Certificate of Analysis  View›┐│ │
│  │  └──────────────────────────┘    │  │ ─────────────────────────────  │ │
│  │  (✓)    (🏅)    (📄)    (🚚)      │  │ CHOOSE YOUR PACK   $x / vial   │ │
│  │  99%    GMP     COA     Ships     │  │ [1][3 ✓][5][10]                │ │
│  └──────────────────────────────────┘  │ $129.00 $150.00 CAD Save $21   │ │
│                                        │ $43.00 per vial · 3 vials       │ │
│                                        │ QUANTITY [− 1 +]  $258.00 total │ │
│                                        │ [🛒 Add to Cart · Pack of 3 - $] │ │
│                                        │ ─────────────────────────────  │ │
│                                        │ ✓99% Purity ⚗Tested 📄COA 🚚Ships│ │
│                                        │ ─────────────────────────────  │ │
│                                        │ Key Research Benefits  ✓ …     │ │
│                                        └────────────────────────────────┘ │
│  ─────────────────────────────────────────────────────────────────────── │
│  Overview  Research Applications  Quality & Testing  Shipping  FAQs  │ ⚗ │
│  ═══════                                                             │ 🛡 │
│  panel content (8/10)                                                │ 🔬 │
│                                                                      │ 📍 │
│  ┌ Customer Reviews ───────────────────────────── [✎ Write a review] ┐   │
│  │ 4.8 ★★★★★  5 ▬▬▬▬▬▬ 12 …                                          │   │
│  │ review list                                                       │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│  ┌ navy: [img] You'll also need · Bacteriostatic Water    $X [View] ┐    │
│  ┌ navy: Quality Certifications  [99%+][GMP][ISO][COA]  RUO note    ┐    │
│  Related Products  [card][card][card][card]                               │
├──────────────────────────────── Footer ───────────────────────────────────┤
```

### 4.3 Per-section layout & styles

#### 4.3.1 Hero header strip
- `<section class="relative bg-white border-b border-line overflow-hidden">`.
- Background: absolutely positioned (`absolute inset-0 opacity-[0.02]`) full-size SVG with a 60×60
  `userSpaceOnUse` pattern: a `r=1.5` dot at (30,30) and `r=1` dots at the four corners, all
  `#07203A`.
- Inner: `relative max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 pt-28 pb-6 sm:pb-8` — `pt-28` (112px)
  clears the fixed nav.
- Wrapped in `motion.div initial {opacity:0, y:10} animate {opacity:1, y:0}` (default transition).
- Back link: `inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink transition-colors mb-3 sm:mb-4`, `ArrowLeft` 16px, text "Back to Products", `href="/products"`.
- Chip row `flex flex-wrap items-center gap-2 sm:gap-3`:
  - Category: `text-[10px] sm:text-xs font-medium text-ink bg-surface px-2 sm:px-3 py-1 rounded-full border border-line`.
  - Purity: `text-[10px] sm:text-xs font-semibold text-teal-dark bg-teal-50 px-2 sm:px-3 py-1 rounded-full border border-teal/20`, text `"{purity} Purity"`.

#### 4.3.2 Product block wrapper
- `<section class="py-6 sm:py-10 md:py-16">` → container → `grid md:grid-cols-2 gap-6 sm:gap-8 md:gap-12 mb-10 sm:mb-16`.
- Left column `motion.div` `{opacity:0,y:20}→{1,0}`, `duration .4`. Right column same with `delay .1`, class `flex flex-col`.

#### 4.3.3 Hero image + trust strip (left)
- Image well: `bg-surface rounded-xl sm:rounded-2xl overflow-hidden border border-line relative`,
  attribute `data-product-hero-image`, `ref=heroImageRef`.
  - Inner `aspect-square flex items-center justify-center p-4 sm:p-8`.
  - `<img key={heroImage} class="h-full w-full object-contain">` + `opacity-40` when `stock_quantity === 0`. `key` forces a remount on image swap.
  - Alt: `"{name} — {label lowercased}"` for packs > 1, else `name`.
  - No image ⇒ `Beaker` `w-16 h-16 sm:w-24 sm:h-24 text-line`.
  - OOS overlay: `absolute inset-0 flex items-center justify-center pointer-events-none` with pill
    `bg-black/65 text-white text-xs sm:text-sm font-semibold px-4 py-1.5 rounded-full tracking-wide` "Out of Stock".
- Trust strip (`showTrustBadges`): `mt-4 sm:mt-6 grid grid-cols-4 gap-2 sm:gap-3` (4 columns at
  every width). Each item `flex flex-col items-center text-center`:
  - Ring: `flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-full border border-teal-dark/40 text-teal-dark`; icon `h-4 w-4 sm:h-5 sm:w-5`.
  - Title `mt-2 text-[11px] sm:text-xs font-semibold leading-tight text-ink`.
  - Subtitle `mt-0.5 text-[10px] sm:text-[11px] font-light leading-tight text-ink-muted`.
  - Items: `BadgeCheck` 99% Purity / Third party tested · `Award` GMP Certified / Good Manufacturing ·
    `FileText` COA Available / Certificate of Analysis · `Truck` Ships from Canada / Fast & Discreet.

#### 4.3.4 Info column (right)
- Eyebrow: `font-mono text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.18em] text-teal-dark mb-1.5 sm:mb-2` — static text **"Research Grade Peptide Blend"**.
- H1: `text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold text-ink mb-3 sm:mb-4 tracking-tight`.
- **Spec tiles** (`showSpecs`): `grid grid-cols-3 gap-2 sm:gap-3 mb-4 sm:mb-6`; tile
  `bg-surface rounded-lg sm:rounded-xl p-3 sm:p-4 text-center border border-line`; label
  `text-[9px] sm:text-[10px] text-ink-muted uppercase tracking-wider mb-1`; value
  `font-bold text-sm sm:text-base` — Purity in `text-teal-dark`, Strength/Form in `text-ink`.
- **COA button** (when `coa_url.length > 0`): full-width
  `w-full mb-4 sm:mb-6 flex items-center justify-between gap-3 px-4 sm:px-5 py-3 sm:py-4 rounded-xl bg-teal-dark text-white font-semibold hover:bg-teal/90 active:scale-[0.98] transition-all shadow-md shadow-teal/30 group`.
  - Left: icon box `flex-shrink-0 bg-white/20 rounded-lg p-1.5` with `FileText w-4 h-4 sm:w-5 sm:h-5`;
    text block `text-left` → line 1 `text-xs sm:text-sm font-bold uppercase tracking-wide leading-tight` "Certificate of Analysis";
    line 2 `text-[10px] sm:text-xs text-white/75 font-normal` "Third-party lab verified · PPB Analytical".
  - Right pill: `flex items-center gap-1.5 text-xs font-semibold bg-white/20 rounded-lg px-2.5 py-1 group-hover:bg-white/30 transition-colors` → "View" + `" (N)"` when N > 1 + `ChevronRight w-3.5 h-3.5`.
  - Click ⇒ `activeCoa = coa_url[0]`, open modal.
- **Buy box** wrapper: `mt-auto pt-4 sm:pt-6 border-t border-line` (pins to the column bottom when the left column is taller).

#### 4.3.5 Buy box contents
**If `price === 0`:** only `mb-4 text-2xl sm:text-3xl md:text-4xl font-bold text-ink-muted` "N/A" (no picker, no stepper).

**Pack picker** (only when `packs.length > 1`), `mb-4 sm:mb-5`:
- Header `mb-2 flex items-baseline justify-between gap-2`: left `text-[11px] font-semibold uppercase tracking-wider text-ink-muted` "Choose your pack"; right `text-[11px] text-ink-muted tabular-nums` "`$X.XX / vial at list price`" (vialUnitPrice).
- Grid `grid grid-cols-2 gap-2 pt-2 sm:grid-cols-4` (`pt-2` makes room for the badge that sits above the button).
- Button base `relative rounded-xl border p-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50`, `aria-pressed={active}`, `disabled={soldOut}`.
  - Active: `border-ink bg-ink text-white shadow-sm`.
  - Inactive: `border-line bg-surface text-ink hover:border-ink/40 hover:bg-white`.
  - Badge (when `badge && !soldOut`): `absolute -top-2 left-2 right-2 truncate rounded-full bg-teal-dark px-1.5 py-0.5 text-center text-[9px] font-bold uppercase tracking-wide text-white shadow-sm`.
  - Active check: `absolute right-1.5 top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white` containing `Check h-2.5 w-2.5 text-ink`.
  - Label `block pr-4 text-[13px] font-semibold leading-tight`.
  - Sold out: `block text-[10px]` "Not enough stock" (`text-white/70` active, else `text-ink-muted`).
  - Otherwise:
    - Price `mt-0.5 block text-[13px] font-bold tabular-nums` "$X.XX" + optional compare-at `ml-1 text-[10px] font-normal line-through` (`text-white/60` active / `text-ink-muted`).
    - Per-vial `block text-[10px] tabular-nums` "$X.XX / vial" (`text-white/70` / `text-ink-muted`).
    - Savings chip (when `savings > 0`) `mt-1 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-semibold` — active `bg-white/20 text-white`, inactive `bg-emerald-50 text-emerald-700` — "Save $X.XX" + " (N%)" when percent > 0.

**Headline price** `mb-4 sm:mb-5`:
- Row `flex flex-wrap items-baseline gap-x-2.5 gap-y-1`:
  - Price `text-2xl sm:text-3xl md:text-4xl font-bold text-ink tabular-nums`.
  - Compare-at `text-base sm:text-lg font-medium text-ink-muted line-through tabular-nums`.
  - Currency `text-sm sm:text-base font-medium text-ink-muted` "CAD" (hard-coded).
  - Savings `text-sm sm:text-base font-semibold text-emerald-600 tabular-nums` "Save $X.XX (N%)".
- Sub-line `mt-1 text-xs sm:text-sm text-ink-muted tabular-nums`: "`$X.XX per vial`" + "` · N vials`" when size > 1.

**Quantity stepper** (only when `siteConfig.ecommerceEnabled && selectedCap >= 1`), `mb-3 flex items-center gap-3`:
- Label `text-[11px] font-semibold uppercase tracking-wider text-ink-muted` "Quantity".
- Control `flex items-center overflow-hidden rounded-xl border border-line bg-surface`; buttons `px-3.5 py-2 font-medium text-ink transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40` with glyphs `−` (U+2212) and `+`, `aria-label` "Decrease quantity"/"Increase quantity"; value `min-w-[2.5rem] text-center font-semibold tabular-nums`.
- Bounds: `1 … selectedCap`. When `qty > 1`: `text-sm font-semibold text-ink tabular-nums` "$X.XX total".

**CTA row** `flex items-stretch gap-3` (only when `siteConfig.ecommerceEnabled`), one `flex-1` button:
| State | Classes | Content |
|---|---|---|
| `stock_quantity === 0` | `flex-1 font-semibold py-3 sm:py-4 rounded-xl bg-surface text-red-600 cursor-not-allowed flex items-center justify-center gap-2 text-sm border border-red-200`, `disabled` | "Out of Stock" |
| `price === 0` | same but `text-ink-muted border border-line` | "Currently Unavailable" |
| default | `flex-1 font-semibold py-3 sm:py-4 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 bg-ink hover:bg-ink/90 text-white`, `disabled={selectedCap < 1}` | `ShoppingCart w-5 h-5` + "Add to Cart · {pack label} - $X.XX" (lineTotal) |
| added (1.8s) | `bg-emerald-500 text-white` | `Check w-5 h-5` + "Added to cart" |

**CTA badge row** (`showCtaBadges`): `mt-4 sm:mt-5 pt-4 sm:pt-5 border-t border-line` → `grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-4`; item `flex items-center gap-1.5`, icon `h-4 w-4 flex-shrink-0 text-teal-dark`, label `text-[11px] sm:text-xs font-medium leading-tight text-ink`. Items: `BadgeCheck` 99% Purity · `FlaskConical` Third-Party Tested · `FileText` COA Available · `Truck` Ships from Canada.

**Key Research Benefits** (`showBenefits && points.length > 0`): `mt-4 sm:mt-5 pt-4 sm:pt-5 border-t border-line`; heading `h3.font-semibold text-ink mb-2 sm:mb-3 text-sm`; `ul.space-y-1.5 sm:space-y-2`; `li.flex items-start gap-2` with `Check w-4 h-4 text-teal-dark flex-shrink-0 mt-0.5` + `span.text-ink-muted text-xs sm:text-sm` containing `renderInline(point)`.

#### 4.3.6 Info tabs (`ProductInfoTabs`)
- `section.mb-10 sm:mb-16 border-t border-line pt-8 sm:pt-10` → `grid gap-8 lg:grid-cols-10 lg:gap-10`.
- Tabs column `lg:col-span-8`:
  - Nav `flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line`.
  - Tab `relative -mb-px pb-3 text-sm font-semibold transition-colors border-b-[3px]`: active `text-ink border-ink`; inactive `text-ink-muted border-transparent hover:text-ink`.
  - Panel `pt-5 sm:pt-6`. Body text class `text-ink-muted leading-relaxed text-sm sm:text-base`.
- Rail `lg:col-span-2 border-t border-line pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6 xl:pl-8` → `grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-1`; item `flex items-start gap-2.5`, icon `mt-0.5 h-4 w-4 flex-shrink-0 text-teal-dark`, title `text-[13px] font-semibold leading-snug text-ink`, subtitle `mt-0.5 text-[11px] font-light leading-snug text-ink-muted`. Items: `FlaskConical` Research Use Only / Not for human consumption · `ShieldCheck` High Purity Standard / 99% verified · `Microscope` Analytical Testing / COA for every batch · `MapPin` Proudly Canadian / Based and shipping in Canada.

#### 4.3.7 Tab contents (verbatim copy)
- **Overview:** `RichText(description)`; fallback "`{name}` is supplied as a research-grade reference material for laboratory use."
- **Research Applications** (`space-y-4`): if `mechanism` → `h3.text-sm font-semibold text-ink` "Mechanism of action" + `p` mechanism (plain text, not RichText); else "`{name}` is studied in controlled in-vitro and preclinical settings. Published mechanism notes for this compound are added here as they are reviewed." Then always: "Investigators typically work with this material in assay development, receptor and pathway characterisation, stability and purity method validation, and as a comparator in analytical reference work. Applications are determined entirely by the receiving laboratory — we supply the material and its analytical data, never a protocol." Footer `text-xs text-ink-muted` "For research use only. Not for human or veterinary consumption."
- **Quality & Testing** (`space-y-4`; `purity = purity?.trim() || '99%'`): "Every batch of `{name}` is released against an independent third-party analysis. Identity is confirmed by mass spectrometry and purity by HPLC, with a specification of `{purity}` or better." List (`ul.space-y-2`, `li.flex items-start gap-2`, `ShieldCheck mt-0.5 h-4 w-4 text-teal-dark`, `span.text-sm text-ink-muted`): "HPLC purity verified to `{purity}` or higher" · "Mass-spectrometry identity confirmation on every lot" · "Independent third-party laboratory — no in-house self-certification" · "Lot-traceable certificate of analysis published per batch". When `coaCount > 0`: button `inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-white` with `FileText h-4 w-4 text-teal-dark` "View certificate of analysis" + " (N)" → opens modal on COA 1.
- **Shipping:** "Orders are packed and dispatched from our Canadian facility. In-stock orders placed before the daily cut-off ship the same business day; anything after it goes out the next." List (same style): "Ships from Canada — domestic orders typically arrive in 2–5 business days" · "Plain, unbranded outer packaging with no product detail on the label" · "Tracking is emailed as soon as the parcel is scanned by the carrier" · "Vials are packed with protective insulation to survive transit". Footer `text-xs` "We ship within Canada only."
- **FAQs:** accordion `divide-y divide-line rounded-xl border border-line`; header button `flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left`, question `text-sm font-semibold text-ink`, `ChevronDown h-4 w-4 text-ink-muted transition-transform` + `rotate-180` open; answer `px-4 pb-4 text-sm leading-relaxed text-ink-muted`. Single-open; first open by default; clicking open one closes it. Q&A:
  1. "What is `{name}` supplied as?" — "Each vial contains `{strength || 'the stated quantity'}` of lyophilized `{form?.toLowerCase() || 'powder'}`, sealed under vacuum. Vials are shipped at ambient temperature and should be stored refrigerated on arrival, protected from light."
  2. "Is this material intended for human use?" — "No. Everything in our catalog is sold strictly as a laboratory reference material for in-vitro research and analytical work. It is not a drug, supplement or medical device, and it is not intended to diagnose, treat, cure or prevent any condition."
  3. "Do you provide a certificate of analysis?" — "Yes. Every batch is analysed by an independent third-party laboratory and the certificate is published against the product before the batch is released for sale."
  4. "How is reconstitution handled?" — "Bacteriostatic water is the usual diluent and is sold separately in the catalog. Reconstitution volumes are determined by the receiving laboratory — we do not supply dosing or protocol guidance of any kind."
  5. "How quickly do orders ship?" — "In-stock orders placed before the daily cut-off are packed and dispatched the same business day from our Canadian facility, in discreet, unbranded outer packaging."

#### 4.3.8 Customer Reviews (`ProductReviews`)
- Loading: `mb-8 sm:mb-10 flex items-center gap-2 text-sm text-ink-muted` + `Loader2 w-4 h-4 animate-spin` "Loading reviews…".
- Fetch failure ⇒ section renders **nothing**.
- Wrapper `motion.section initial {opacity:0,y:20} whileInView {opacity:1,y:0} viewport {once:true}` `mb-8 sm:mb-10`, `aria-labelledby="product-reviews-heading"` → card `bg-white border border-line rounded-xl sm:rounded-2xl overflow-hidden` → `p-5 sm:p-7`.
- Header `flex flex-wrap items-start justify-between gap-4 mb-6`: `h2.text-lg sm:text-xl font-bold text-ink` "Customer Reviews"; sub `text-xs sm:text-sm text-ink-muted mt-0.5` "From customers who ordered `{productName}`." Button (when `canReview && !writing`): `inline-flex items-center gap-2 px-4 py-2.5 bg-ink hover:bg-ocean text-white text-sm font-semibold rounded-lg transition-colors` + `PenLine w-4 h-4` — "Edit your review" if they have one, else "Write a review".
- Rollup (count > 0): `grid sm:grid-cols-[auto,1fr] gap-6 sm:gap-10 items-center pb-6 border-b border-line`:
  - Left `text-center sm:text-left`: average `text-4xl font-bold text-ink tabular-nums leading-none` (1 dp), `StarRating size md mt-2`, count `text-xs text-ink-muted mt-1.5` "N review(s)".
  - Histogram `ul.space-y-1.5 max-w-sm w-full`; rows 5→1 `flex items-center gap-2.5 text-xs text-ink-muted`: star number `w-3 text-right tabular-nums`, track `flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden` with fill `block h-full rounded-full bg-amber-400` width = count/total %, count `w-6 tabular-nums`.
- Empty (count 0): `flex items-center gap-3 pb-6 border-b border-line text-sm text-ink-muted` + `MessageSquare w-4 h-4 text-ink-light` "No reviews yet — the first one comes from whoever orders it next."
- Form (`writing`): `form.py-6 border-b border-line space-y-4`:
  - "Your rating" `block text-sm font-medium text-ink mb-2` + `StarInput` (xl).
  - "Headline (optional)" input, `maxLength 120`, placeholder "Arrived quickly, COA matched".
  - "Your review (optional)" textarea `rows 4`, `maxLength 2000`, placeholder "What you ordered, how it arrived, what the lab results showed."; helper `text-[11px] text-ink-muted mt-1` "Posted publicly as your first name and last initial."
  - Inputs: `w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40`; labels `block text-sm font-medium text-ink mb-1.5`, "(optional)" `font-normal text-ink-muted`.
  - Error `text-sm text-red-600`.
  - Submit `inline-flex items-center gap-2 px-5 py-2.5 bg-ink hover:bg-ocean disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors` (+ spinner while saving) "Update review"/"Post review"; Cancel `px-4 py-2.5 text-sm font-medium text-ink-muted hover:text-ink`.
- Gate note (`!writing && !canReview`): `py-5 text-sm text-ink-muted border-b border-line` — signed in: "Reviews are open to customers who have ordered this product."; anonymous: link "Sign in" (`font-semibold text-teal-dark hover:underline`, `/login`) + " to review a product you have ordered."
- List `ul.divide-y divide-line`, `li.py-5`:
  - Meta row `flex flex-wrap items-center gap-x-3 gap-y-1 mb-1.5`: `StarRating sm`, author `text-sm font-semibold text-ink`, verified chip `inline-flex items-center gap-1 text-[10px] font-semibold text-teal-dark bg-teal-50 border border-teal/20 px-2 py-0.5 rounded-full` + `BadgeCheck w-3 h-3` "Verified purchase", own chip `text-[10px] font-semibold text-ink-muted bg-surface-2 px-2 py-0.5 rounded-full` "Yours", date `text-xs text-ink-light ml-auto` (`toLocaleDateString(undefined, {year:'numeric', month:'short', day:'numeric'})`).
  - Title `text-sm font-semibold text-ink mb-1`; body `text-sm text-ink-muted leading-relaxed whitespace-pre-line`.

#### 4.3.9 Bacteriostatic-water upsell
Shown when `batWater && product.slug !== 'bacteriostatic-water-30ml'`. `motion.div` (`y:20`, `delay .25`) `mb-8 sm:mb-10` → `bg-ink rounded-xl sm:rounded-2xl p-4 sm:p-6 text-white` → `flex flex-col sm:flex-row items-center gap-4 sm:gap-6`:
- Thumb `w-16 sm:w-20 h-16 sm:h-20 bg-white rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden`, img `w-full h-full object-contain p-1.5 sm:p-2` (fallback src `/images/products/Bacteriostatic Water 30ML.png`).
- Text `flex-1 text-center sm:text-left`: kicker `text-[10px] sm:text-xs font-medium text-teal-light mb-0.5 sm:mb-1` "You'll also need"; name `text-base sm:text-lg font-bold mb-0.5 sm:mb-1`; copy `text-white/60 text-xs sm:text-sm` "Essential for reconstituting lyophilized peptides."
- Price/CTA `flex flex-col items-center gap-2 sm:gap-3 flex-shrink-0`: `text-xl sm:text-2xl font-bold tabular-nums` `$batWater.price` (**raw `price`, not vial price**); link `bg-white hover:bg-white/90 text-ink font-semibold px-4 sm:px-6 py-2 sm:py-2.5 rounded-lg transition-all text-xs sm:text-sm` "View Product" → `productPath(batWater)`.

#### 4.3.10 Quality Certifications (`showCertifications`)
`motion.div` (`delay .3`) `mb-10 sm:mb-16` → `bg-ink rounded-xl sm:rounded-2xl p-4 sm:p-6 md:p-8`:
- `h2.text-base sm:text-lg md:text-xl font-bold text-white mb-4 sm:mb-6 text-center` "Quality Certifications".
- `grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4`; card `flex flex-col items-center text-center p-3 sm:p-4 bg-white/5 rounded-lg sm:rounded-xl border border-white/10`; icon box `w-10 sm:w-12 h-10 sm:h-12 rounded-lg sm:rounded-xl flex items-center justify-center mb-2 sm:mb-3`; icon `w-5 sm:w-6 h-5 sm:h-6`; title `font-semibold text-white mb-0.5 sm:mb-1 text-xs sm:text-sm`; sub `text-[10px] sm:text-xs text-white/50`.
  1. box `bg-teal/20`, `Beaker text-teal-light` — "99%+ Purity" / "Third-party verified"
  2. box `bg-white/10`, `Award text-white` — "GMP Certified" / "Good Manufacturing"
  3. box `bg-white/10`, `BadgeCheck text-white` — "ISO Compliant" / "Intl standards"
  4. box `bg-white/10`, `Shield text-white` — "COA Available" / "Certificate of Analysis"
- Footer `mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-white/10 text-center` → `text-xs sm:text-sm text-white/50`: `<span class="font-medium text-white/70">For Research Purposes Only</span> - Not for human consumption.`

#### 4.3.11 Related Products (when non-empty)
`motion.div` (`delay .35`) → `h2.text-lg sm:text-xl md:text-2xl font-bold text-ink mb-4 sm:mb-6` "Related Products" → `grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 md:gap-5`. Each card is a `Link` to `productPath(rel)`:
- Card `group bg-white rounded-lg sm:rounded-xl overflow-hidden border border-line hover:shadow-lg hover:shadow-ink/5 hover:border-ink/20 transition-all`.
- Image `relative bg-surface aspect-square flex items-center justify-center p-2 sm:p-4`; img `h-full w-full object-contain group-hover:scale-105 transition-transform duration-300` (+`opacity-50` OOS); fallback `Beaker w-8 h-8 sm:w-12 sm:h-12 text-line`; OOS pill `bg-black/60 text-white text-[9px] sm:text-[10px] font-semibold px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-full tracking-wide`.
- Body `p-2.5 sm:p-4`: strength `text-[9px] sm:text-[10px] text-ink-muted uppercase tracking-wider mb-0.5 sm:mb-1`; name `h3.font-semibold text-ink group-hover:text-ink-muted transition-colors mb-1.5 sm:mb-2 line-clamp-1 text-xs sm:text-sm`; row `flex justify-between items-center gap-2`: price `text-ink font-bold tabular-nums text-sm sm:text-base` "$vialPrice" + `text-[9px] font-medium text-ink-muted` "/ vial" (or `text-ink-muted font-bold text-sm` "N/A" when `price === 0`); OOS `text-[10px] text-red-500 font-medium` "Sold out".

#### 4.3.12 COA modal
- Backdrop `fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4`, click closes. Panel `bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl` (click stops propagation). No Esc handler, no focus trap, no `role="dialog"`.
- Header `flex items-center justify-between px-5 py-4 border-b border-line flex-shrink-0`: icon `w-8 h-8 bg-teal/10 rounded-lg` + `FileText w-4 h-4 text-teal-dark`; kicker `text-[10px] text-ink-muted uppercase tracking-wider font-medium` "Certificate of Analysis"; name `text-sm font-semibold text-ink leading-tight`. Right: "Open in new tab" `text-xs text-teal-dark hover:underline font-medium` (`target=_blank rel="noopener noreferrer"`), close `p-2 hover:bg-surface rounded-lg transition-colors text-ink-muted hover:text-ink` + `X w-5 h-5`.
- Tabs (only when > 1 COA) `flex gap-1 px-5 pt-3 pb-0 flex-shrink-0 overflow-x-auto`; tab `flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors` — active `bg-teal/10 text-teal-dark border border-teal/25`, inactive `text-ink-muted hover:text-ink hover:bg-surface` — "COA 1", "COA 2", …
- Viewer `flex-1 overflow-hidden rounded-b-2xl min-h-0 mt-3`:
  - ≥640px: `<iframe key={activeCoa} src="{url}#toolbar=0&navpanes=0" class="w-full h-full hidden sm:block" style="min-height:60vh" title="Certificate of Analysis — {name}">`.
  - <640px (`sm:hidden flex flex-col items-center justify-center text-center gap-4 px-6 py-10`): icon tile `w-14 h-14 bg-teal/10 rounded-2xl` + `FileText w-7 h-7 text-teal-dark`; copy `text-sm text-ink-muted leading-relaxed` "Third-party lab certificate for `{name}`."; full-width link styled like the COA button (`inline-flex items-center justify-center gap-2 w-full px-5 py-3.5 rounded-xl bg-teal-dark text-white font-semibold hover:bg-teal/90 active:scale-[0.98] transition-all shadow-md shadow-teal/30`) "Open Certificate of Analysis (PDF)".

### 4.4 Responsive summary

| Element | < 640 | ≥ 640 (`sm`) | ≥ 768 (`md`) | ≥ 1024 (`lg`) |
|---|---|---|---|---|
| Product block | 1 column | 1 column | **2 columns**, gap 48px | same |
| H1 | 20px | 24px | 30px | 36px |
| Pack picker | 2 cols | 4 cols | 4 cols | 4 cols |
| CTA badges | 2 cols | 4 cols | | |
| Trust strip | 4 cols (40px rings) | 4 cols (48px rings) | | |
| Info tabs | tabs + rail stacked, rail 2×2 below a hairline | | | 8/2 split, rail 1 col with left hairline |
| Certifications | 2 cols | | 4 cols | |
| Related | 2 cols | | | 4 cols |
| COA modal | "Open PDF" button | inline iframe | | |

### 4.5 Motion
All framer-motion fade-up entrances (`opacity 0→1`, `y 10|20→0`): header (default), left col
(`.4s`), right col (`.4s`, delay `.1`), bat-water (delay `.25`), certifications (delay `.3`),
related (delay `.35`), reviews (on scroll into view, once). Plus the 0.8s fly-to-cart arc and the
1.8s "Added to cart" state.

---

## 5. Data flow & behaviour

### 5.1 Request lifecycle
1. Request `/products/{slug}` → ISR cache (≤300s old) or on-demand render.
2. `getPublicProduct(slug)`: `url_slug = slug` → else `slug = slug` → else 404.
3. Legacy hit (`url_slug` set and ≠ requested slug) → 308 to canonical.
4. Parallel fetch: related (same category, active, ≠ self, limit 4, **no ordering**), bat water,
   review stats, site config.
5. HTML ships with name/copy/price/specs/JSON-LD (SEO-complete without JS).
6. Hydration → `useLiveProduct` refreshes volatile fields; view tracking fires (once per product id;
   `trackActivity` de-dupes views itself).

### 5.2 Pack / quantity / cart state machine
```
mount or product.id change
  └─ packSize := 3 if (sold in 3 && floor(stock/3) ≥ 1)
                 else first pack with floor(stock/size) ≥ 1
                 else packs[0];  qty := 1;  added := false
select pack (enabled only)  → packSize := size; qty := 1; added := false
−/+                         → qty ∈ [1, floor(stock/packSize)]
Add to Cart
  ├─ cap < 1 → toast.error(size > 1 ? "Not enough stock for a {label lowercased}." : "Out of stock.")
  ├─ loop qty × addItem(...)   (each add capped at cap per cart line)
  ├─ none added → toast.error("Only {cap} in stock — that's all we have.")
  └─ some added → flyToCart(hero, heroImage); added := true; after 1800ms added := false
```
- The hero image follows the selected pack (case photo for size > 1 when `box_image_url` exists).
- Headline price, compare-at, savings, per-vial line and CTA total all follow the selected pack.
- When `packs.length <= 1` the picker is hidden; `selectedPack` is still `packs[0]` so the CTA label
  and price still use it.

### 5.3 Visibility rules (all must be reproduced)
| Section | Shown when |
|---|---|
| Trust strip | `showTrustBadges` |
| Spec tiles | `showSpecs` |
| COA button / modal / Quality-tab COA button | `coa_url?.length > 0` |
| Pack picker | `price !== 0 && packs.length > 1` |
| Headline price | `price !== 0` (else "N/A") |
| Quantity stepper | `price !== 0 && siteConfig.ecommerceEnabled && selectedCap >= 1` |
| CTA | `siteConfig.ecommerceEnabled` (compile-time flag, currently `true`) |
| CTA badges | `showCtaBadges` |
| Benefits | `showBenefits && parseBenefits(benefits).length > 0` |
| Reviews | `showReviews` and the GET succeeded |
| Bat-water upsell | `batWater` exists and current `slug !== 'bacteriostatic-water-30ml'` |
| Certifications | `showCertifications` |
| Related | `relatedProducts.length > 0` |

### 5.4 Pricing rules (summary)
- Vial price: `vial_price > 0` else `price / (vials_per_box || 10)`, rounded to cents.
- Pack price: configured `pack_options[].price` else `vial × size`.
- Strike-through: explicit `compare_at` if > price; otherwise `vial × size` when pack price is
  lower; otherwise none.
- Currency label is the literal string "CAD"; amounts formatted `$` + `toFixed(2)` (no
  `Intl.NumberFormat`, no thousands separator).
- JSON-LD offer price is always the **single-vial** price, while the visible headline defaults to
  the 3-pack. (Matches the code comment's intent that vial price is the "smallest amount".)

### 5.5 Reviews flow
GET on mount (bearer token if signed in) → render one of: loading / hidden-on-error / rollup+list.
`viewer.canReview` decides **Write/Edit** button vs. the gate note. POST → on success close form
and re-GET; on failure show the API's error message inline. One review per customer per product
(DB unique constraint + API upsert).

### 5.6 SEO
Canonical always the `url_slug` URL; inactive ⇒ noindex; `<` escaped in JSON-LD; OG/Twitter
image = `image_url || box_image_url`; `generateStaticParams` pre-renders all active slugs.

---

## 6. Edge cases & states

| Case | Behaviour |
|---|---|
| Unknown slug / DB down | `notFound()` → Next default 404 (no custom page). |
| Legacy SKU slug | 308 to `/products/{url_slug}`. |
| Inactive product | Renders normally, **still purchasable** from the UI if in stock; `noindex,follow`; JSON-LD `OutOfStock`. |
| `stock_quantity === 0` | Hero image at 40% opacity + "Out of Stock" pill; CTA red disabled "Out of Stock"; stepper hidden; all packs show "Not enough stock" and are disabled. |
| Stock > 0 but < smallest pack | No OOS overlay; packs disabled; stepper hidden; CTA enabled-looking but `disabled` (opacity 50%). |
| `price === 0` | "N/A" headline, no picker/stepper; CTA "Currently Unavailable" (if stock > 0). Related card shows "N/A". |
| No `image_url` | `Beaker` placeholder (hero, related). No `box_image_url` ⇒ vial photo used for packs. |
| No COAs | COA button, modal and Quality-tab button all absent. |
| Empty `description` / `mechanism` | Static fallback copy (§4.3.7). |
| Empty benefits | Section hidden. |
| Live refresh fails | Server-rendered values kept; no UI. |
| Reviews API error | Section not rendered. |
| Reviews: anonymous | Gate note with Sign-in link. Signed-in non-buyer: "Reviews are open to customers who have ordered this product." |
| Review POST 401/403/400/500 | Inline red error with the API message; form stays open. |
| No bat-water SKU | Upsell hidden. |
| Related navigation | Same component instance: `useLiveProduct` resets, opening-pack effect + view tracking re-run on new `product.id`. |
| Mobile COA | No iframe; "Open … (PDF)" button. |

---

## 7. Open questions & unverified items

**Porting decisions for the sibling site (brand-specific hard-codes):**
1. Copy that names VYTA's business must be rewritten per brand: "Ships from Canada", "Proudly
   Canadian / Based and shipping in Canada", "We ship within Canada only.", "Third-party lab
   verified · PPB Analytical", the Shipping tab, FAQ #5, "GMP Certified", "ISO Compliant", and the
   "Research Grade Peptide Blend" eyebrow (shown on **every** product, including single peptides).
   Decide whether these become `site_settings` fields or stay hard-coded.
2. `'Product not found | VYTA'` metadata title and `SITE_URL = "https://www.vytabio.com"` are
   hard-coded; the sibling needs its own origin or canonicals will point at VYTA.
3. Currency label "CAD" and JSON-LD `priceCurrency` (`DEFAULT_CURRENCY = 'CAD'`) — confirm the
   sibling's currency. `products.price_usd` exists but the PDP never uses it.
4. Bat-water companion is found by the literal slug `bacteriostatic-water-30ml`, with a fallback
   image path `/images/products/Bacteriostatic Water 30ML.png`. Confirm the sibling SKU/asset.
5. The color tokens in §4.1 are VYTA's brand palette. If the sibling has its own palette, map
   `ink / ink-muted / ink-light / surface / surface-2 / line / teal / teal-dark / teal-light /
   teal-50 / ocean` 1:1 to its tokens rather than copying hex values.
6. The cart localStorage key is `northern_peptides_cart` — reuse the sibling's existing cart key.

**Schema to confirm on the sibling DB:** `_live-schema-snapshot.sql` (Aminocan, refreshed
2026-06-23) shows `products` **without** `url_slug`, `vial_price`, `vials_per_box`, `pack_sizes`,
`pack_options`, and with `coa_url` as `text` (not `text[]`). It also has no `product_reviews` or
the six `site_settings.product_*_enabled` columns. Either that snapshot is stale or the sibling DB
needs these migrations run before the page can be built: `product-url-slug-migration.sql` +
`product-remove-all-dashes-migration.sql`, `invoice-spec-integration-migration.sql` (vial columns),
`pack-options-content-migration.sql`, `pack-option-pricing-migration.sql`,
`pack-option-badge-migration.sql`, `catch-up-schema-migration.sql` (`coa_url text[]`,
`box_image_url`), `reviews-testimonials-migration.sql`, and the three toggle migrations.

**Behaviours that look unintended (reproduce as-is, or fix deliberately):**
7. Inactive products can be added to cart from their page; whether checkout rejects them was not
   verified (outside this cluster).
8. Each pack line in the cart is capped independently (`floor(stock/size)`), so a customer can hold
   a 1-pack line and a 10-pack line whose combined vials exceed stock. The PDP comment says
   checkout re-checks stock; not verified here.
9. Review `stats` on the page are computed from at most 100 fetched rows, while JSON-LD
   `aggregateRating` uses the full `product_review_stats` view — they diverge past 100 reviews.
10. The OOS overlay/CTA test `stock_quantity === 0`; a negative stock value would show neither.
11. Related products have no `order` clause, so which 4 appear is DB-order dependent.
12. The bat-water upsell shows `batWater.price` (the case price per trap 2) rather than its vial or
    pack price — correct only if that SKU's `price` is per bottle.
13. The COA modal has no Escape-to-close, focus trap or `role="dialog"`; the tablist has no
    arrow-key navigation.

**Outside the examined files:** `Navigation` and `Footer` (global; only `data-cart-target` and the
fixed-nav offset `pt-28` matter here), `ToastContext` visuals, `trackViewItem` / GA4 transport,
`/api/customer/activity`, `safeUrl` rules, and `readSiteConfigRow` internals were not documented.
