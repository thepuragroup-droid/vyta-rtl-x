# 03 — Shop, product page, cart, checkout and post-purchase (storefront)

Scope: what `vyta-rtl-x` (VYTA) has in the catalog, product page, cart, hosted checkout and customer order pages that `aminocan-cad` (Aminocan) does **not**. Every claim below was checked against both repos by `diff`. Anything not verified is listed under **Open questions**.

**Main finding: most of this area is already in Aminocan, and often in a newer form.** Aminocan already has its own copies of the cart upsells, the limited-time offer, the pack-option badges, the product-section toggles, the PDP server shell and JSON-LD, the reviews API (including `?ids=` rollups), the price refresh in `CartContext`, and the Canada-only checkout. It also has `AdPrice`, which VYTA lacks. Only a short list of features is actually new in VYTA (§A–§H). §Z lists what must **not** be ported, and why.

---

## 0. Conventions used in this section

### Token map (VYTA class → hex → Aminocan class → hex)

| Role | VYTA class | VYTA hex | Aminocan equivalent | Aminocan hex |
|---|---|---|---|---|
| Primary text / dark surface | `ink` | `#07203A` | `ink` | `#1A1A1A` |
| Secondary text | `ink-muted` | `#56707F` | `ink-muted` | `#6E6E6E` |
| Tertiary text | `ink-light` | `#6E8898` | `ink-light` | `#8A8A8A` |
| Page ground / input bg | `surface` | `#F7FAFB` | `surface` | `#F7F7F7` |
| Hairlines / empty star | `line` | `#DCE7EB` | `line` | `#C9CCD1` |
| Accent (UI chrome, rings) | `teal` | `#438B9E` | `bronze` | `#9C8B5A` |
| Accent text (AA body) | `teal-dark` | `#1B5D83` | `bronze-dark` (or `bronze`, per the surrounding Aminocan code) | `#7D6F48` / `#9C8B5A` |
| Accent on dark | `teal-light` | `#6EB2B8` | `bronze-light` (Aminocan often uses `bronze` here) | `#B8A876` |
| Accent tint bg | `teal-50` | `#F1F8F9` | `bronze-50` | `#FAF8F3` |
| Hover on dark button | `ocean` | `#0E3F5F` | `ink/85` (as in Aminocan's ProductReviews) | — |
| Focus ring | `ring-teal/40` | `#438B9E` @40% | `ring-bronze/40` | `#9C8B5A` @40% |

Neutral/semantic classes are the same in both repos and resolve to stock Tailwind: `amber-400` `#FBBF24`, `emerald-50` `#ECFDF5`, `emerald-500` `#10B981`, `emerald-600` `#059669`, `emerald-700` `#047857`, `emerald-800` `#065F46`, `red-500` `#EF4444`, `red-600` `#DC2626`, `amber-300` `#FCD34D`, `amber-600` `#D97706`, `amber-700` `#B45309`.

**Radius differs between the repos.** VYTA overrides `rounded-xl` = 14px, `rounded-2xl` = 18px and `rounded-3xl` = 24px. Aminocan keeps the Tailwind defaults (12 / 16 / 24px). `rounded-lg` is 8px in both. When porting, use the class name and accept Aminocan's radius.

Type scale (both repos): `text-[9px]` 9px · `text-[10px]` 10px · `text-[11px]` 11px · `text-xs` 12/16 · `text-sm` 14/20 · `text-base` 16/24 · `text-lg` 18/28 · `text-xl` 20/28 · `text-2xl` 24/32 · `text-3xl` 30/36 · `text-4xl` 36/40. Breakpoints are the Tailwind defaults (`sm` 640, `md` 768, `lg` 1024, `xl` 1280).

### Status legend
- **PORT**: new in VYTA. Build it in Aminocan.
- **ALREADY**: Aminocan already has it, equal or newer. Do nothing.
- **DO NOT PORT**: VYTA-only, but a regression or VYTA-specific.

### Summary

| # | Feature | Status |
|---|---|---|
| A | Server-rendered catalog (`/products` server shell + ItemList JSON-LD + metadata + live stock re-read) | PORT |
| B | `?category=` deep-link preselects the catalog filter | PORT |
| C | Star ratings on catalog cards (`useReviewStats` + `RatingSummary`) | PORT |
| D | Benefits list editor (admin) + `formatBenefits` + the bullet-stripping fix in `parseBenefits` | PORT |
| E | "View Order Details" guest-order claim flow (claim token, claim API, order page claim, login/signup redirect + email prefill + banner, post-auth resume) | PORT (needs the email side, see the open questions) |
| F | Account order page: correct pack label for storefront orders, and wait for auth before redirecting | PORT |
| G | Hosted checkout: required first/last name; phone always collected and required (contact section); "Free" flat-shipping copy | PORT with care (see conflicts) |
| H | Landing-page offer on the cart and checkout (auto-applied code) | PORT only together with the Landing Pages feature (separate section) |
| I | Cart `ReferralCodeField` (collapsible "Add a referral code") | OPTIONAL: dead code in VYTA (rendered nowhere) |
| J | PDP cosmetic deltas (eyebrow line, hidden Lab Results button, `mt-auto`) | OPTIONAL / brand |
| Z | Everything else in scope | ALREADY or DO NOT PORT |

---

### A. Server-rendered catalog page (SSR + ItemList JSON-LD + metadata)

**What's new vs Aminocan.** Aminocan's `app/products/page.tsx` is one 556-line `'use client'` component. It fetches `products` from the browser, shows an 8-card pulse skeleton while loading, and exports no metadata, so `/products` inherits the root layout title. VYTA splits it in two:
- `app/products/page.tsx` is an async **server** component. It has `export const revalidate = 300` (ISR, 5 min), a `generateMetadata()` with title, description, canonical and Open Graph, and an inline `ItemList` JSON-LD `<script>`. It renders `<ProductsClient initialProducts={products} />`.
- `app/products/ProductsClient.tsx` is the old client page, moved almost verbatim. It takes `initialProducts`, so the grid is in the first HTML. It has no `loading` state and no skeleton. On mount it re-reads stock and price once.

**Files (VYTA).** `app/products/page.tsx` (69 lines), `app/products/ProductsClient.tsx` (559 lines), `lib/products/products-server.ts` → `getCatalogProducts`.

**Database.** No migration. Reads `products` with `select('*')` and `.eq('active', true)`. The client re-read selects `stock_quantity, price, vial_price, id`.

**API routes.** None. The server uses a service-role read through `getSupabase()`; the client uses the anon `supabase` client.

**Components.**
- `ProductsPage` (server, default export):
  ```ts
  export const revalidate = 300;
  export async function generateMetadata(): Promise<Metadata> {
    const cfg = await getServerSiteConfig();
    const description =
      'Browse our full catalog of research peptides — third-party tested, ' +
      '99% purity, COA available for every batch. Ships from Canada.';      // brand content — replace
    return {
      title: `Research Peptides Catalog | ${cfg.store_name}`,
      description,
      alternates: { canonical: `${SITE_URL}/products` },   // ?category= is NOT a distinct page
      openGraph: { title: `Research Peptides Catalog | ${cfg.store_name}`, description,
                   type: 'website', url: `${SITE_URL}/products` },
    };
  }
  ```
  JSON-LD, emitted before `<ProductsClient>`, with `<` escaped as `<`:
  ```ts
  { '@context': 'https://schema.org', '@type': 'ItemList', name: 'Research Peptides Catalog',
    numberOfItems: products.length,
    itemListElement: products.map((p, i) => ({ '@type': 'ListItem', position: i + 1,
      name: p.name, url: `${SITE_URL}${productPath(p)}` })) }
  ```
  Output: `<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} />`.
- `getCatalogProducts` (server, React `cache`d, never throws): `from('products').select('*').eq('active', true).limit(2000)`. It returns `[]` on any error. It sorts in-stock first (`(stock_quantity ?? 0) === 0` goes last), then by `name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })`. The sort happens on the server so the HTML is already in final order.
- `ProductsClient` (client). Props: `{ initialProducts: Product[] }`. `Product` has `id, name, slug, url_slug?, category, description, description_short, price, vial_price, strength, purity, form, active, image_url, box_image_url, stock_quantity, vials_per_box, coa_url`.
  - State: `products` and `filteredProducts` (both start as `initialProducts`), `selectedCategory = 'All'`, `searchQuery`, `sortBy: 'name'|'price-asc'|'price-desc'`, `categories` (starts as `FALLBACK_CATEGORIES`), `scrollRestoredRef`. There is no `loading`.
  - Live refresh, once on mount: `supabase.from('products').select('stock_quantity, price, vial_price, id').eq('active', true)`. It merges each row over the matching product by id and re-sorts with the in-stock-first + name rule. On error it keeps the server list.
  - Scroll restore no longer waits for loading. It runs once on mount from `sessionStorage['products_scroll']` and removes the key. Saving on `pagehide` and on card click is unchanged.
  - Everything else (search scoring, sort select, category chips behind `SHOW_CATEGORY_BAR=false`, hero behind `SHOW_CATALOG_HERO=false`, trust bar, empty state, `openPurchaseModal` on Add, `trackActivity` search debounce of 900 ms) is identical to Aminocan.

**UI/UX.** The layout, grid and card are pixel-identical to Aminocan's current catalog: `grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5`, card `bg-white rounded-xl border border-line overflow-hidden hover:shadow-lg hover:shadow-ink/5 hover:border-ink/20`. There are two exceptions:
1. Stars sit under the name (see §C).
2. There is no loading skeleton (none is needed).

VYTA's card has **no** `AdPrice` / `AdDiscountBadge`. Keep Aminocan's.

**Admin controls.** None.

**Porting notes.**
- **Security, do not clobber:** Aminocan's `lib/products/products-server.ts` narrows every row through `toPublicProduct()` (`lib/products/public-product.ts`) so cost, supplier and notes columns never get serialised into HTML. VYTA's `getCatalogProducts` returns raw `select('*')` rows to a client component. In Aminocan, write it as:
  ```ts
  export const getCatalogProducts = cache(async (): Promise<PublicProduct[]> => {
    try {
      const { data } = await getSupabase().from('products').select('*').eq('active', true).limit(2000);
      return (data ?? []).map(toPublicProduct).sort(/* in-stock first, then name (numeric, base) */);
    } catch { return []; }
  });
  ```
  `PublicProduct` already carries every field the card and `largestPackFor` need (`pack_sizes`, `pack_options`, `price`, `vial_price`, `vials_per_box`).
- Keep Aminocan's `AdPrice` usage in the card: `<AdPrice amount={vialPriceFor(product)} />`, the pack line `<AdPrice amount={pack.price} />`, `!adOfferShown && pack.compareAt` and the `<AdDiscountBadge />` at `absolute top-3 right-3`. VYTA prints raw `$x.toFixed(2)`. Do not copy that.
- Aminocan's `ProductsClient` will need `useAdPrice()` exactly as the current page does. That is client-only and fine.
- Delete the `loading` state, the skeleton branch and the initial client fetch. Replace them with the mount-time re-read. Consider adding `pack_options` to the re-read select (VYTA does not) so pack prices are fresh too. The PDP's `useLiveProduct` already re-reads `pack_options`.
- Keep the store name from `getServerSiteConfig().store_name`.

**Open questions.**
- Should the ItemList include out-of-stock products? VYTA includes every active product.

---

### B. `?category=` deep-link preselects the catalog filter

**What's new.** `ProductsClient` reads `?category=` once on mount and sets `selectedCategory`. VYTA's home "wellness tiles" link to `/products?category=<slug>`; the home page is outside this section. Aminocan ignores the param.

**Files.** `app/products/ProductsClient.tsx` (lines 126–133).

**Database.** No change. The value matches `products.category`, which equals `store_categories.slug` (`store-categories-migration.sql` and `products-category-fk-migration.sql` are **byte-identical in both repos**, and `lib/categories.ts` is identical too).

**Components.**
```ts
useEffect(() => {
  const wanted = new URLSearchParams(window.location.search).get('category');
  if (wanted) setSelectedCategory(wanted);
}, []);
```
It reads `window.location` deliberately rather than `useSearchParams`, so no Suspense boundary is needed. After mount the chips own the selection, and the URL is not updated when the user changes the filter.

**UI/UX.** When `selectedCategory !== 'All'`, the existing "Clear filter" button (`flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink`, `X` icon at 16px) and the "N compounds in {name}" text appear. Both already exist in Aminocan. The category chip bar is still hidden (`SHOW_CATEGORY_BAR = false`), so a deep-linked filter can only be cleared with that button or the empty-state "View all compounds" button.

**Porting notes.** This is a 4-line add. Canonical stays `/products` (see §A metadata).

**Open questions.** VYTA does not validate the value against the category list. An unknown slug produces an empty grid with the "No compounds found" state. Keep that behaviour?

---

### C. Star ratings on catalog cards

**What's new.** Every card shows `★★★★☆ (12)` under the product name when the product has published reviews. The grid fetches all rollups in one request. Aminocan's backend already supports this (`GET /api/reviews?ids=` and the `product_review_stats` view), but no storefront component calls it, and Aminocan has no `RatingSummary` and no `useReviewStats`.

**Files (VYTA).** `lib/hooks/useReviewStats.ts` (new, 48 lines), `components/reviews/StarRating.tsx` (adds `RatingSummary`), `app/products/ProductsClient.tsx` (lines 15–16, 85, 461–472). `components/product/ProductReviews.tsx` re-exports `RatingSummary`. VYTA also uses it on the home BestSellers and Testimonials components, which are out of scope.

**Database.** Already in Aminocan (`product-reviews-migration.sql`):
```sql
CREATE OR REPLACE VIEW product_review_stats WITH (security_invoker = true) AS
  SELECT product_id, COUNT(*)::integer AS review_count, ROUND(AVG(rating)::numeric, 2) AS average_rating
  FROM product_reviews WHERE status = 'published' GROUP BY product_id;
GRANT SELECT ON product_review_stats TO anon, authenticated;
```
VYTA's `reviews-testimonials-migration.sql` defines the identical view. No migration is needed.

**API routes.** `GET /api/reviews?ids=<uuid,uuid,…>` already exists in Aminocan (`app/api/reviews/route.ts`, lines ~122–140). It filters to UUIDs and caps at **50 ids**. It returns `{ stats: Array<{ product_id, review_count, average_rating }> }`, or `{ stats: [] }` when the table is missing. Do not change the route.

**Components.**
- `useReviewStats(productIds: string[]): Record<string, Rollup>` (client hook). Port verbatim, but give it a local row type, because Aminocan's `ReviewStats` in `lib/reviews.ts` is a different shape (`{count, average, distribution}`):
  ```ts
  type Rollup = { product_id: string; review_count: number; average_rating: number };
  export function useReviewStats(productIds: string[]): Record<string, Rollup> {
    const [stats, setStats] = useState<Record<string, Rollup>>({});
    const key = productIds.join(',');               // effect keys off the joined string
    useEffect(() => {
      if (!key) return;
      let alive = true;
      (async () => {
        try {
          const res = await fetch(`/api/reviews?ids=${encodeURIComponent(key)}`, { cache: 'no-store' });
          if (!res.ok) return;
          const data = await res.json().catch(() => null);
          const rows: Rollup[] = Array.isArray(data?.stats) ? data.stats : [];
          if (!alive) return;
          setStats(Object.fromEntries(rows.map((r) => [r.product_id,
            { ...r, review_count: Number(r.review_count) || 0, average_rating: Number(r.average_rating) || 0 }])));
        } catch { /* no stars this render */ }
      })();
      return () => { alive = false; };
    }, [key]);
    return stats;
  }
  ```
  The `Number(...)` coercion is a safety addition and is not in VYTA. Put the hook at `lib/hooks/useReviewStats.ts`.
- `RatingSummary` (add to Aminocan's `components/reviews/StarRating.tsx`, which already exports `StarRating` with sizes `xs` 12px, `sm` 14, `md` 16, `lg` 20, `xl` 24 and fractional fill):
  ```tsx
  export function RatingSummary({ average, count, size = 'xs', className = '' }:
    { average: number; count: number; size?: StarSize; className?: string }) {
    if (count === 0) return null;
    return (
      <span className={`inline-flex items-center gap-1.5 ${className}`}>
        <StarRating value={average} size={size} />
        <span className="text-[10px] sm:text-xs text-ink-muted tabular-nums">({count})</span>
      </span>
    );
  }
  ```
  You will need to export `StarSize` from Aminocan's StarRating; it is currently a non-exported `type`.
- Card integration in `ProductsClient`:
  ```tsx
  const reviewStats = useReviewStats(filteredProducts.map((p) => p.id));
  …
  <h3 className="font-semibold text-ink group-hover:text-ink-muted transition-colors line-clamp-1 mb-1 text-sm sm:text-base">{product.name}</h3>   {/* mb-3 → mb-1 */}
  <RatingSummary average={reviewStats[product.id]?.average_rating ?? 0}
                 count={reviewStats[product.id]?.review_count ?? 0} className="mb-2" />
  ```

**UI/UX.**
- Star row: 5 lucide `Star` icons, 12px (`xs`), `strokeWidth 1.5`, 2px apart (`gap-0.5`).
- Empty star colour is `text-line`: VYTA `#DCE7EB`, Aminocan `#C9CCD1`.
- Filled star is `text-amber-400 fill-amber-400` `#FBBF24`, clipped to the earned fraction.
- Count: `(N)`, 10px (12px from `sm`), `ink-muted` (`#56707F` VYTA / `#6E6E6E` Aminocan), tabular numerals, 6px from the stars.
- Spacing: name `mb-1` (4px), summary `mb-2` (8px), then the price row.
- `aria-label` on the star row is `"{x.x} out of 5"`; Aminocan's StarRating already does this.
- Products with zero reviews render nothing.

**Admin controls.** None. Reviews are moderated wherever Aminocan already moderates `product_reviews`.

**Porting notes.**
- **50-id cap:** the API slices to 50 ids, and VYTA passes every filtered product. A catalog with more than 50 active products gets no stars past the 50th. In Aminocan, chunk the ids into groups of 50 and merge the maps, or raise the cap. Do not copy VYTA's single call blindly.
- **Layout shift:** VYTA's comment says the unrated card "keeps the space", but the name margin drops from `mb-3` (12px) to `mb-1` (4px), so unrated cards end up 8px tighter than before. To keep Aminocan's rhythm, either keep `mb-3` and give `RatingSummary` `-mt-2 mb-2`, or wrap it in a `min-h-[16px] mb-2` slot. **Decide.**
- The ids are re-keyed whenever the filter or search changes, which triggers a new fetch. That is acceptable but could be keyed on all `products` instead.
- Do not touch Aminocan's `ProductReviews.tsx` / `lib/reviews.ts`. Its stats shape (`count/average/distribution`) is Aminocan's own design and is newer.

**Open questions.**
- Should card stars respect `site_settings.product_reviews_enabled`? VYTA shows them regardless; the toggle only hides the PDP section. Aminocan's PDP JSON-LD does gate on it.

---

### D. Benefits list editor + benefits parsing fix

**What's new.**
1. **Admin:** VYTA replaces the 2-row "Benefits" `<textarea>` in Admin → Products (create/edit modal) with `BenefitsEditor`, a row-per-point list editor with reorder, delete, Enter-to-add and "Paste a list".
2. **Library:** `lib/products/benefits.ts` adds `formatBenefits(points)`, which is the editor's serialiser, plus unit tests.
3. **Bug fix:** VYTA's bullet-stripping regex requires whitespace after the bullet. Aminocan's regex `LEADING_MARKER = /^(?:[-–—•*·‣▪]+|\d+[.)])\s*/` strips any run of `*` even without a space, so a point starting with `**Bold** text` loses its bold markup on the PDP.

**Files.** VYTA: `components/admin/BenefitsEditor.tsx` (203 lines, new), `lib/products/benefits.ts` (81 lines), `lib/products/benefits.test.ts` (new), `app/(admin)/admin/products/page.tsx` (~line 2254). Aminocan: `lib/products/benefits.ts` (43 lines), and the textarea in `app/(admin)/admin/products/page.tsx` lines ~2240–2247.

**Database.** No change. It still writes `products.benefits` (text), one point per line. Legacy comma-separated rows still parse as before.

**API routes.** None new. The admin product save already posts `benefits: formData.benefits || null`.

**Components.**
- `parseBenefits(raw)` (VYTA final, port this):
  ```ts
  const LEADING_BULLET = /^\s*(?:[-–—•*·‣▪]|\d{1,3}[.)])\s+/;   // bullet MUST be followed by whitespace
  function htmlToLines(raw: string): string {
    return raw.replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\s*\/\s*(?:li|p|div|h[1-6]|tr)\s*>/gi, '\n')
      .replace(/<\s*li[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'");
  }
  export function parseBenefits(raw: string | null | undefined): string[] {
    const text = htmlToLines(raw ?? '');
    if (text.trim().length === 0) return [];
    const parts = /\r?\n/.test(text) ? text.split(/\r?\n/) : text.split(',');
    return parts.map((p) => p.replace(LEADING_BULLET, '').trim()).filter((p) => p.length > 0);
  }
  export function formatBenefits(points: string[]): string {
    const cleaned = points.map((p) => p.trim()).filter(Boolean);
    const text = cleaned.join('\n');
    return cleaned.length === 1 && text.includes(',') ? `${text}\n` : text;   // trailing \n keeps a lone comma-point whole
  }
  ```
  Test cases to port (`node --test --experimental-strip-types lib/products/benefits.test.ts`):
  - `'**Fast** repair\n[Read the study](/articles/x)'` parses to exactly those two strings.
  - `'- One\n• Two\n* Three\n1. Four\n2) Five'` parses to `One…Five`.
  - `'Anti-inflammatory\nGut-brain axis'` is unchanged.
  - `<ul><li>` input, `<br>` input and `&amp;` are handled.
  - Empty values parse to `[]`.
  - `parseBenefits(formatBenefits(points))` round-trips, including `['Supports repair, recovery and sleep']`.
  - `formatBenefits(['One','  ','','Two']) === 'One\nTwo'`.
- `BenefitsEditor` (client). Props: `{ value: string; onChange: (value: string) => void; disabled?: boolean }`.
  - State: `points: string[]` (initialised from `parseBenefits(value)`), `bulkOpen`, `bulkText`, and a ref `ownWrite` holding the last text it emitted. The ref lets an outside `value` change (for example opening another product) re-seed the rows without the editor's own echo wiping a just-added empty row.
  - `emit(next)` calls `setPoints(next)`, sets `ownWrite = formatBenefits(next)` and calls `onChange(text)`.
  - Behaviours: edit a row; **Enter** inserts an empty row after the current one (`preventDefault`); ↑ / ↓ move (disabled at the ends); a bin removes; "Add point" appends `''`; "Paste a list" opens a textarea and "Add N point(s)" appends `parseBenefits(bulkText)`. That button is disabled when the paste parses to 0 points, and the label reads `Add {n} point` or `points`.
  - Usage: `<BenefitsEditor value={formData.benefits} onChange={(benefits) => setFormData({ ...formData, benefits })} />`, replacing the `<div><label>Benefits</label><textarea…/></div>` block.

**UI/UX (admin).**
- Header row: `mb-2 flex flex-wrap items-center gap-2`.
  - Label "Benefits" is `text-sm font-medium text-ink`.
  - Hint "One point per row — these are the ticks under the product description." is `text-[11px] text-ink-muted`.
  - Right-aligned toggle `ml-auto text-[11px] font-medium text-teal-dark underline-offset-2 hover:underline` → Aminocan `text-bronze-dark`. It reads "Paste a list" or "Cancel paste".
- Paste panel: `mb-3 rounded-lg border border-teal/40 bg-teal-50/60 p-3` → Aminocan `border-bronze/40 bg-bronze-50/60`.
  - Textarea: `rows=4 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:ring-2 focus:ring-teal/40`. Placeholder: "Paste one point per line. Bullets, numbering and pasted\n<li> markup are all understood and cleaned up."
  - Button: `rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink/90 disabled:opacity-40`.
  - Caption: "Appended to the list below." `text-[11px] text-ink-muted`.
- Empty state: `rounded-lg border border-dashed border-line bg-surface px-3 py-4 text-center text-xs text-ink-muted` reading "No benefits yet. Add the first point below."
- Rows: `space-y-2`. Each row is `flex items-center gap-2` with:
  - index `w-5 text-center text-xs font-medium text-ink-muted tabular-nums`;
  - input `w-full px-3 py-2 bg-surface border border-line rounded-lg text-ink text-sm focus:ring-2 focus:ring-teal/40 disabled:opacity-60`, placeholder `Benefit {i+1}`;
  - icon buttons `rounded p-1.5 text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-30`. The delete button uses `hover:bg-red-50 hover:text-red-600`. Icons are ChevronUp, ChevronDown and Trash2 at 16px.
- "Add point": `mt-2 inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface` with a `Plus` icon at 14px.
- Footer help, `mt-2 text-[11px] leading-relaxed text-ink-muted`: "A point can carry **bold** (`<strong>**bold**</strong>`), *italic* and `[a link](/products)` (font-mono). HTML tags are not rendered — paste them if it is easier and they will be converted into points."

**Storefront.** Aminocan's PDP already renders `parseBenefits(product.benefits)` through `renderInline(point, \`b${idx}\`)` under "Key Research Benefits". No storefront change beyond the regex fix.

**Porting notes.** Port `formatBenefits` and the stricter `LEADING_BULLET` into Aminocan's `lib/products/benefits.ts`. Keep Aminocan's function signature (`parseBenefits(raw)`), which is unchanged. Check Aminocan's `lib/products/product-page.test.ts` still passes, since it may assert the old regex.

**Open questions.** None.

---

### E. "View Order Details" → sign in / sign up → claim the guest order

**What's new.** Hosted-checkout buyers often check out as guests, so their invoice has `customer_id = NULL` and never appears under My Account. VYTA adds an end-to-end flow:
1. The confirmation email's **View Order Details** button goes to `/login?redirect=<order page>&email=<addr>`, or to `/signup?...` when that email has no `customers` row.
2. The order page URL carries `?claim=<HMAC token>`.
3. Once signed in, the order page POSTs the token to a new API. That API links the invoice, the `puramass_orders` row or the storefront `orders` row to the account, **only if the token was minted for this order and this account's email**.
4. A signup that requires email confirmation remembers the destination in `localStorage`, and `CustomerContext` resumes it on the first `SIGNED_IN`.

Aminocan has none of this. Its order page redirects to a bare `/login` and drops the destination, and its confirmation email has no order link at all (`ConfirmationEmailData` has no `accountOrderId` or `viewOrderUrl`).

**Files (VYTA).**
- `lib/customer/order-link.ts` (new, server-only)
- `app/api/customer/orders/[id]/claim/route.ts` (new)
- `lib/customer/post-auth-redirect.ts` (new, client-safe) + `post-auth-redirect.test.ts`
- `app/(customer)/account/orders/[id]/page.tsx`
- `app/(customer)/login/page.tsx`, `app/(customer)/signup/page.tsx`
- `contexts/CustomerContext.tsx`
- Email side (another section): `lib/order-confirmation.ts` `enrichForEmail`, `lib/order-confirmation-data.ts` (`accountOrderId`), `lib/order-confirmation-email.ts` and `lib/fulfillment-email.ts` (button).

**Database.** No migration. Columns used: `invoices.id, invoices.customer_id, invoices.source` (filtered on `'stealth_health'`, which Aminocan also uses; see `lib/customer/api.ts`), `puramass_orders.invoice_id, puramass_orders.customer_id`, `orders.id, orders.customer_id`, `customers.id, customers.email`.

**Environment.** `ORDER_LINK_SECRET` (HMAC key). It falls back to `SUPABASE_SERVICE_ROLE_KEY` and throws if both are unset.

**API route — `POST /api/customer/orders/[id]/claim`.** Body `{ token: string }`; header `Authorization: Bearer <supabase access token>`. Uses a service-role client.

| Check | Failure response |
|---|---|
| No bearer, or user has no email | 401 `{error:'Unauthorized'}` |
| `id` not a UUID, or `verifyOrderClaim(id, user.email, token)` false | 403 `{error:'This order link was sent to a different email address than the one you are signed in with.'}` |
| No `customers` row with `id = user.id` | 409 `{error:'Finish setting up your account, then try again.'}` |
| `invoices` row (`id`, `source='stealth_health'`) owned by someone else | 409 `{error:'This order belongs to another account.'}` |
| — invoice unowned | `UPDATE invoices SET customer_id=user.id WHERE id=? AND customer_id IS NULL`, then `UPDATE puramass_orders SET customer_id=user.id WHERE invoice_id=? AND customer_id IS NULL`; return `{linked:true}` |
| Otherwise an `orders` row: same owner check and conditional update | `{linked:true}` |
| Neither found | 404 `{error:'Order not found'}` |
| Exception | 500 `{error:'Could not link this order. Please try again.'}` |

It is idempotent: already-own returns `{linked:true}`.

**`lib/customer/order-link.ts`.**
```ts
signOrderClaim(orderId, email) = HMAC-SHA256(secret, `order-claim:v1:${orderId}:${email.trim().toLowerCase()}`).digest('base64url')
verifyOrderClaim(orderId, email, token)   // length check + crypto.timingSafeEqual
orderPagePath(orderId, email) = `/account/orders/${encodeURIComponent(orderId)}?claim=${signOrderClaim(...)}`
buildViewOrderUrl(db, siteUrl, orderId, email): Promise<string>
  // customers.ilike('email', normalized).limit(1); on lookup error assume hasAccount = true
  // → `${siteUrl}/${hasAccount ? 'login' : 'signup'}?redirect=<orderPagePath>&email=<normalized>`
```

**`lib/customer/post-auth-redirect.ts`** (client-safe; every storage call is in try/catch):
- `KEY = 'vyta_post_auth_redirect'`. Rename it to `aminocan_post_auth_redirect` (brand content).
- `TTL_MS = 24h`.
- `safeRedirect(raw)`: returns the trimmed path only if it starts with `/` and not with `//` or `/\`; otherwise `null`.
- `isOrderRedirect(path)`: `/^\/account\/orders\/[^/?#]+/`.
- `authHref(base: '/login'|'/signup', redirect, email?)`: builds a query with `redirect` (omitted when it is `/`) and `email`.
- `rememberPostAuthRedirect(path)`: stores `{path, at: Date.now()}`.
- `clearPostAuthRedirect()`.
- `takePostAuthRedirect()`: reads and removes the entry; returns `null` if it is stale or unsafe.

**Component changes.**
- **Order detail page** (`app/(customer)/account/orders/[id]/page.tsx`, client):
  - Reads `{ customer, isLoading: authLoading } = useCustomer()` and adds state `claimError: string|null`.
  - The effect returns early while `authLoading`. Aminocan does not wait, and bounces signed-in users to `/login` on first paint.
  - Signed out: `router.replace('/login?redirect=' + encodeURIComponent(location.pathname + location.search))`. This keeps the claim token.
  - Signed in: `claimFromEmail()` runs first. If `?claim` is present it POSTs to the claim API with the session token. On a non-OK response it sets `claimError` to the server message, or the fallback "We couldn’t link this order to your account." (network failure: "…Please try again."). It **always** removes `claim` from the URL with `history.replaceState`.
  - Then `getOrderWithItems(id)`. If `order.customer_id !== customer.id` and the claim failed, it stops loading and shows the not-found card with `claimError` as the message (normally "This order doesn't exist or you don't have access to it."). Without a failed claim it redirects to `/account/dashboard` as before.
- **Login page:**
  - Email state is initialised from `?email`.
  - `redirect = safeRedirect(searchParams.get('redirect')) || '/'`. This also fixes an open-redirect in Aminocan, which uses the raw param.
  - On an already-signed-in visit and on a successful sign-in, call `clearPostAuthRedirect()` before `router.push` / `router.replace(redirect)`.
  - Order banner when `isOrderRedirect(redirect)`, above the form: `mb-4 sm:mb-5 p-3 bg-surface border border-line rounded-lg text-xs sm:text-sm text-ink` containing `<span class="font-semibold">Sign in to view your order.</span> <span class="text-ink-muted">Use the email address your order confirmation was sent to.</span>`.
  - The "Sign up" link becomes `authHref('/signup', redirect, email)`.
- **Signup page:**
  - `formData.email` is initialised from `?email`, and `safeRedirect` is applied as on login.
  - After a successful `signUpCustomer(...)`, call `rememberPostAuthRedirect(redirect)` before `setSuccess(true)`.
  - Banner when `isOrderRedirect(redirect)` (same classes as login): **"Create an account to view your order."** followed by the muted text "Use the email address your order confirmation was sent to — you'll go straight to your order once you're signed in."
  - All three "Sign in" links become `authHref('/login', redirect, formData.email)`.
- **CustomerContext** (`onAuthStateChange`):
  ```ts
  if (event === 'PASSWORD_RECOVERY' && window.location.pathname !== '/reset-password') {
    window.location.assign('/reset-password'); return;          // also new in VYTA
  }
  if (event === 'SIGNED_IN') {
    …existing loadCustomer / identifyVisitor…
    const path = window.location.pathname;
    if (path !== '/login' && path !== '/signup' && path !== '/reset-password') {
      const pending = takePostAuthRedirect();
      if (pending && pending !== `${path}${window.location.search}`) window.location.assign(pending);
    }
  }
  ```

**Porting notes.**
- Aminocan's signup calls `/api/customer/register-attribution` inside `signUpCustomer` (`lib/customer/api.ts`), which VYTA lacks. Keep it, and only add the `rememberPostAuthRedirect` call in the page.
- Keep Aminocan's `BrandLogo` on the login and signup pages. VYTA's `vyta-mark.png` + "VYTA" is brand content.
- Aminocan's login writes `website_accessed: 'aminocan'`. VYTA does too (a leftover); keep Aminocan's.
- The flow only becomes reachable once the confirmation email renders the button. Add `accountOrderId?: string` to Aminocan's `ConfirmationEmailData`, set it to the order's or invoice's id in `storefrontConfirmationData` and the hosted builder, and call `buildViewOrderUrl` while enriching. This belongs to the email section; coordinate with it.
- `/account/orders/[id]` must remain reachable when signed out so the redirect can happen. Check that Aminocan's middleware does not strip `?claim`.

**Open questions.**
- Is `ORDER_LINK_SECRET` set in Aminocan's Vercel env? It falls back to the service-role key.
- Does Aminocan's `getOrderWithItems` treat an invoice whose `customer_id` was just set as the caller's? VYTA's identical check suggests yes; verify after porting.

---

### F. Account order page: correct pack label (and auth wait)

**What's new.** Aminocan's order detail line pill reads `item.unit === 'case' ? \`Pack of ${item.vialsPerBox}\` : 'Single vial'`. For a storefront order whose `orders.items` line has `packSize: 3`, that shows "Pack of 10" (the case size). VYTA reads the pack size instead.

**Files.** `app/(customer)/account/orders/[id]/page.tsx`.

**Database.** Reads `order_items.pack_size` (optional; may not exist) and `orders.items[].packSize | pack_size` (JSONB). Aminocan's storefront checkout already writes `packSize` into `orders.items` (`app/checkout/page.tsx` line ~979).

**Change.**
```ts
// order_items branch
packSize: Number((it as any).pack_size) > 0 ? Number((it as any).pack_size) : 0,
// orders.items JSONB branch
packSize: Number(it.packSize ?? it.pack_size) > 0 ? Number(it.packSize ?? it.pack_size) : 0,
…
{(item.packSize > 0 || item.unit) && ( <pill>{
  (() => { const size = item.packSize > 0 ? item.packSize : item.unit === 'case' ? item.vialsPerBox : 1;
           return size > 1 ? `Pack of ${size}` : 'Single vial'; })()
}</pill> )}
```
In Aminocan prefer `packLabel(size)` from `lib/pricing.ts`, which returns the same strings. The pill markup is unchanged.

**Porting notes.** Aminocan's `lib/customer/api.ts` already sets `vials_per_box = packSize` on hosted-invoice lines (parsed from "Name — Pack of N"), so that branch is already right; this fix is for the storefront `orders.items` branch. The `authLoading` wait is covered in §E.

---

### G. Hosted checkout: required names, phone always required, free-flat copy

**What's new vs Aminocan's `PuramassCheckoutContent.tsx`.**
1. **First and last name are required.** Each label gets `<span className="text-teal-dark">*</span>` (Aminocan: `text-bronze`). Placeholders change from "Optional" to "First name" / "Last name", inputs get `required` and `autoComplete="given-name"` / `"family-name"`, and the CTA gate gains `namesValid = firstName.trim() !== '' && lastName.trim() !== ''`. The blocker message, checked first, is **"Enter your first and last name to continue."**
2. **Phone is always collected, in the contact card** (after the name grid), not only inside the live-rates address block. It is required whether or not `shippingRatesEnabled`.
   - Label: `Phone <span class="text-teal-dark">*</span>`.
   - Input: `type="tel"`, `inputMode="tel"`, `autoComplete="tel"`, placeholder `(416) 555-0199`, `required`, `className={INPUT_CLASS}`. Validated on blur (`phoneTouched` state).
   - Error: `<FieldError message={phoneTouched && !phoneValid ? 'Enter a valid phone number (at least 10 digits).' : addressErrors.phone} />`.
   - Helper: `mt-1.5 text-[11px] leading-snug text-ink-muted` reading "Used only if we or the courier need to reach you about your order."
   - Prefill: `setShipping(f => f.phone ? f : { ...f, phone: customer.phone || '' })` alongside the existing customer prefill.
   - `phoneValid = isValidPhone(shipping.phone)`, unconditional.
   - CTA blocker: "Enter a valid phone number to continue."
   - Payload: `customer.phone: shipping.phone.trim()` (top-level customer block) in addition to `shipping.phone`.
3. **Flat shipping of $0 shows "Free".**
   - Delivery card copy: when `flatShipping > 0` it stays "Flat **$X** tracked shipping on every order."; otherwise `<span className="font-semibold text-emerald-700">Free</span> tracked shipping on every order.`, followed by " You'll give the courier your delivery address on the secure checkout page."
   - Summary row: `freeShipping || shippingCost === 0` renders `<span className="font-semibold text-emerald-700">Free</span>`.

**Server (VYTA `app/api/checkout/puramass/route.ts`).**
- Rejects missing names with 400 `{error:'Enter your first and last name.'}`.
- Reads `phone = body.customer.phone ?? body.shipping.phone` and, if `!isValidPhone(phone)`, returns 400 `{error:'Enter a valid phone number.', fields:{phone:…}}`.
- Passes `phone` into `createPuramassOrder({ customer: { email, first_name, last_name, phone } })` and into the invoice (`customerPhone`).

**`lib/phone.ts` (VYTA):** `/^\+?[\d\s().-]+$/` and 10–15 digits.

**Porting notes — conflicts with Aminocan's newer code (do not clobber):**
- Aminocan already has `lib/shipping/phone.ts` (`isValidPhone`: 7–20 digits, any characters, plus `PHONE_REQUIRED_MESSAGE` and `PHONE_MAX_LENGTH = 40`) and a deliberate policy (changelog `2026-09-17-checkout-phone-required-courier-gate.md`) that the phone is required **only where the address is collected** (live rates). **Do not add VYTA's `lib/phone.ts`.** If the business wants phone-always, reuse Aminocan's validator and change only *where* the field renders and *when* it is required. Aminocan's validator does not reject letters, so VYTA's "at least 10 digits" error copy would be wrong; use `PHONE_REQUIRED_MESSAGE`.
- Aminocan's server route builds `customer: { email, first_name, last_name }` without a phone, and validates phone via `validateShippingAddress(..., { requirePhone: true })` only when rates are on. Making phone always required means touching the route too. See the open questions about the partner API accepting `phone`.
- Keep all of Aminocan's newer checkout logic intact. VYTA's file is **older** in these places:
  - Canada-only country lock (`lib/shipping/canada-only.ts`) and the red "We ship to Canada only" banner. VYTA has a country `<select>`.
  - `quoteKeyFor` / `ratesPending` / `RATES_TIMEOUT_MS = 15000` / `ratesFailed` degrade-to-flat, and `shippingSelectionReady` (`lib/shipping/checkout-gate.ts`).
  - `refreshPrices()` on mount and the 409 `unavailable` pack handling.
  - The discount-code field in the contact card with `normalizeReferralCode`, `excludedProductIds` lower-casing and `adDiscountAmount`.
  - `quoteReferralCode` with `own_code` / `invalid` statuses.
  - `readLinkedDiscountCode()` (`?discount=` / `?code=` / `PROMO_COOKIE`).
  - `BrandLogo` and `/api/storefront-settings`.
- Do **not** port VYTA's `TEMP DEBUG` `console.error` calls in the rates effect.
- VYTA moved the Discount code and Affiliate code fields from the contact card into the Order Summary card (`mt-4 pt-4 border-t border-line`, labels `text-xs font-medium text-ink` with a `Ticket` or `UserCheck` icon at 14px). That is a layout preference with older logic behind it; **not recommended** to port.

**Open questions.**
- Does Aminocan's partner (`createPuramassOrder` in `lib/payments/puramass*.ts`) accept `customer.phone`? It is unverified for Aminocan.
- Does the business want the phone required with flat-fee shipping in Aminocan? That contradicts Aminocan's 2026-09-17 decision.
- Names required: Aminocan currently allows anonymous names ("Optional"). Confirm with the business.

---

### H. Landing-page offer on the cart and checkout (storefront half only)

**What's new.** A visitor who arrives through a VYTA landing page carries a cookie (`LANDING_COOKIE` from `lib/promos/landing.ts`). `PromosContext` then fetches `GET /api/promos/landing`, with a Bearer token when signed in, and exposes:
```ts
landingOffer: { active, slug, code, percent, firstOrderOnly, excludedProductIds: string[],
                exclusions: string|null, reason: string|null, amountOn(lines: {productId, amount}[]): number }
```
The fetch is skipped when the cookie is absent and re-run when `customerId` changes. `amountOn` returns `round(eligibleSubtotal(lines, excludedProductIds) * percent) / 100` from `lib/affiliate/discount-codes.ts`.

**Cart (`app/cart/page.tsx`).** The first discount is whichever of the landing code and the ad welcome discount saves more; they never stack. `landingWins = landingSaving > 0 && landingSaving >= welcomeSaving`, and the cart offer then composes on what is left. When `landingWins`, the summary shows a row before the ad row:
- Wrapper: `text-xs sm:text-sm`.
- Line: `flex justify-between` with, on the left, `inline-flex items-center gap-1.5 text-emerald-700` + `BadgePercent` at 14px + `{percent}% first-order offer` (or `welcome offer`), and on the right `font-semibold text-emerald-700 tabular-nums` reading `-$X.XX`.
- Note below: `mt-0.5 text-[10px] text-ink-muted sm:text-xs` reading "Code {code} is applied automatically at checkout · excludes {exclusions}."

**Checkout.**
- After the link-code attempt, an effect auto-applies `landingOffer.code` via `applyDiscountCode(code, { fromLanding: true })`. It never overrides a typed or applied code, and retries when `totalPrice` changes (`landingTriedFor`).
- Removing it sets `landingDeclined`; the hand-off then receives `declineLandingOffer: true`. A "Re-apply your {p}% welcome offer ({code})" link (`mt-1.5 text-xs font-medium text-teal-dark hover:underline`) restores it.
- Applied-code note: "Applied automatically from your welcome offer · first order only."
- A server rejection of the landing code shows "…You can continue without it."
- The summary label is "Welcome offer {code}".

**Porting notes.** This depends entirely on the Landing Pages feature (tables, `/api/promos/landing`, `lib/promos/landing.ts`, hand-off step "8c"), which is specified elsewhere. When porting:
- Merge into Aminocan's **newer** `PromosContext` (it has `adOfferVisible` / `adPriceOf`) and its cart (which has `inviteToClaim` and the "Sign up to apply" link).
- Use Aminocan's own `lib/promos/discount-codes.ts` / `checkout-discounts.ts` rather than VYTA's `lib/affiliate/discount-codes.ts`.
- Keep `/api/storefront-settings`; VYTA's context reads `/api/admin/settings`.

**Open questions.** Does Aminocan's discount-code engine support `excluded_product_ids` and `first_order_only` with the same semantics? Its checkout already reads `excluded_product_ids`.

---

### I. Cart "Add a referral code" field (orphan in VYTA)

**Status.** `components/cart/ReferralCodeField.tsx` exists in VYTA (158 lines), but **nothing imports it**; `app/cart/page.tsx` does not render it. Port it only if the business wants it.

**Behaviour.** A collapsible row. When a `ref_code` cookie already exists it opens and shows "Referral code {CODE} applied" with a green check. Apply:
- normalises with `normalizeReferralCode`;
- requires `REFERRAL_CODE_MIN_LENGTH` characters ("Codes are at least {n} characters.");
- calls `validateReferralCode(code)` from `lib/affiliate/api`; a miss shows "That code isn't valid." and a network error shows "We couldn't check that code — try again at checkout.";
- writes the cookie `ref_code=<code>; path=/; expires=+30d; SameSite=Lax`.

It never changes totals. Helper text: "Credits whoever referred you. It does not change your total.", or once applied, "We'll carry it through to checkout for you."

**UI.**
- Container: `rounded-xl border border-line bg-surface`.
- Header button: `flex w-full items-center gap-2.5 px-4 py-3`, with a `Tag` icon at 16px in `ink-muted`, the label `flex-1 text-sm font-medium text-ink`, and a rotating `ChevronDown` or an `emerald-600` `Check`.
- Body: framer `height 0 → auto`, 0.2 s, `px-4 pb-4`.
  - Input: `min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm uppercase focus:ring-2 focus:ring-teal/40`.
  - Apply button: `rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium hover:border-teal/40 disabled:opacity-40`, with a `Loader2` spinner while checking.

**Porting notes.** Aminocan's `lib/affiliate/api.ts` (`validateReferralCode`) and `lib/affiliate/utils.ts` (`normalizeReferralCode`, `REFERRAL_CODE_MIN_LENGTH = 4`) exist, and Aminocan's checkout reads `ref_code`. However, Aminocan now quotes codes with `quoteReferralCode` and distinguishes `own_code`; prefer that over `validateReferralCode` if ported.

---

### J. PDP cosmetic deltas (optional)

VYTA `ProductDetailClient.tsx` vs Aminocan. The two are otherwise structurally the same: same sections, same pack picker, same toggles. Aminocan's is **newer**: it has `AdPrice` in the headline, the line total and bac-water; an Escape key that closes the COA modal; `purityLabel` from `product.purity`; the `BAC_WATER_SLUG` constant; and `PublicProduct` typing.
- **Eyebrow above the H1** (VYTA only): `<p className="font-mono text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.18em] text-teal-dark mb-1.5 sm:mb-2">Research Grade Peptide Blend</p>`. That is monospace, 10px (11px from `sm`), letter-spacing 0.18em, `#1B5D83`. Brand content — replace; it is also inaccurate for single compounds.
- The buy block wrapper is `mt-auto pt-4 sm:pt-6 border-t border-line`, so it bottom-aligns in the right column (Aminocan has no `mt-auto`).
- The `LabResultsButton` beside Add to Cart is hidden in VYTA. Aminocan keeps it; keep Aminocan's.
- Assurance copy differs (VYTA "99% Purity" is hard-coded; Ships from Canada / "Fast & Discreet"). Brand content — keep Aminocan's.
- `ProductInfoTabs.tsx` and `ProductReviews.tsx` differ only in copy and tokens (VYTA's testing and shipping copy, e.g. "Mass-spectrometry identity confirmation on every lot", "same business day… daily cut-off"). Brand content — do not port.

---

### Z. In scope but ALREADY in Aminocan, or DO NOT PORT

| Item | Verdict | Evidence |
|---|---|---|
| Store categories (`store-categories-migration.sql`, `products-category-fk-migration.sql`, `lib/categories.ts`) | ALREADY | byte-identical |
| Pack option badge (`pack-option-badge-migration.sql`) and pack picker tag UI | ALREADY | Aminocan `pack-options-migration.sql` already documents `badge`; PDP renders `pack.badge` (`absolute -top-2 left-2 right-2 … bg-bronze text-[9px] font-bold uppercase`); `PACK_BADGE_PRESETS`, `MAX_PACK_BADGE_LENGTH=24` exist in Aminocan `lib/pricing.ts` |
| Product section toggles (`product-section-toggles-migration.sql`, `product-cta-badges-toggle-migration.sql`) | ALREADY | Aminocan `product-page-sections-migration.sql` adds all six `product_*_enabled` columns; edited in Admin → Marketing → Product page; the PDP already takes `showTrustBadges/showReviews/showSpecs/showBenefits/showCertifications/showCtaBadges` |
| `checkout-addons-toggle-migration.sql` | ALREADY | Aminocan `cart-offer-checkout-toggles-migration.sql` adds `checkout_addons_enabled`, `checkout_verify_notice_enabled`, `cart_trust_strip_enabled` (Admin → Promotions → StorefrontSectionsCard) |
| `cart-upsells-migration.sql` (offer columns, `cart_fbt_enabled`, `cart_similar_enabled`, `product_recommendations`) | ALREADY | Aminocan's split is cart-upsells + cart-offer-checkout-toggles (and Aminocan also records `puramass_orders.cart_offer_cents`) |
| `FrequentlyBoughtTogether`, `LimitedTimeOffer`, `YouMayAlsoLike`, `components/cart/recommendations.ts`, `FreeShippingProgress`, `FreeShippingToast` | ALREADY (Aminocan newer) | VYTA diffs are colour tokens only; Aminocan adds `AdPrice`, `packShortLabel`, `productPath`, `PublicProduct` typing |
| `contexts/CartContext.tsx` | ALREADY (Aminocan newer) | Aminocan adds `refreshPrices`, `trackCartViewed`, a ref-based `addItem`, and derives `unit`. **Note:** VYTA callers pass `unit` to `addItem`; Aminocan's `addItem` type is `Omit<CartItem,'quantity'|'id'|'unit'>`, so drop `unit` from any copied call |
| `app/api/products/recommendations` | ALREADY (Aminocan newer) | Aminocan narrows to `toPublicProduct` and sets `dynamic = 'force-dynamic'` |
| PDP server shell, `generateStaticParams`, metadata, 308 legacy-slug redirect, Product + BreadcrumbList JSON-LD | ALREADY | Aminocan `app/products/[slug]/page.tsx` + `lib/products/structured-data.ts` (Aminocan also strips RichText markup from meta descriptions and gates `aggregateRating` on `product_reviews_enabled`) |
| `getPublicProduct` / `getRelatedProducts` / `getBacteriostaticWater` | ALREADY (Aminocan safer) | Aminocan returns `toPublicProduct` rows and filters bac-water on `active` |
| Reviews API (`/api/reviews` GET/POST, `?ids=`) | ALREADY (Aminocan newer) | Aminocan adds a rate limit, UUID checks and invoice-based purchase proof |
| `StarRating` / `StarInput` | ALREADY | add only `RatingSummary` (§C) |
| `app/order/success`, `app/order/track` | no functional delta | copy, logo, email only |
| Cart page | ALREADY except §H | VYTA lacks Aminocan's `view_cart` tracking, `inviteToClaim`, `packLabel` and the low-stock `left > 0` guard; VYTA copy "Free, Fast & Discreet Shipping", "Ships in 24 Hours", "In Stock – Ships in 24h" is brand content and not to be ported |
| `app/checkout/page.tsx` (VYTA 142 lines) | DO NOT PORT | VYTA deleted the on-site e-Transfer checkout and always renders the hosted one; Aminocan keeps a `puramass` / `default` / `closed` router driven by `puramass_checkout_enabled` |
| Reading settings from `GET /api/admin/settings` on the storefront (VYTA cart, checkout, PromosContext) | DO NOT PORT | Aminocan uses the public `/api/storefront-settings` |
| VYTA checkout country `<select>` (`SHIPPING_COUNTRIES`) | DO NOT PORT | Aminocan is Canada-only by design (`lib/shipping/canada-only.ts`) |
| VYTA `lib/phone.ts` | DO NOT PORT | use Aminocan's `lib/shipping/phone.ts` (§G) |
| WhatsApp link `https://wa.me/15147013824` in "Complete your order" | DO NOT PORT | brand content; Aminocan uses its own group link |

---

## Open questions (consolidated)

1. **Card stars vs the reviews toggle (§C):** should `product_reviews_enabled = false` also hide stars on catalog cards?
2. **Stars >50 products (§C):** confirm the expected catalog size. Chunk the requests or raise the API cap?
3. **Card spacing without reviews (§C):** keep VYTA's tighter 4px name margin, or reserve the star row's height?
4. **Unknown `?category=` value (§B):** keep the empty grid, or fall back to All?
5. **Email side of the order-claim flow (§E):** the button builder lives in the confirmation-email section. Aminocan's `ConfirmationEmailData` needs `accountOrderId` and `viewOrderUrl`. Confirm that section ports them.
6. **`ORDER_LINK_SECRET` (§E):** set a dedicated secret in Aminocan, or rely on the service-role-key fallback?
7. **Phone always required (§G):** this contradicts Aminocan's 2026-09-17 "phone only with the address" decision. Business call. Also unverified: whether Aminocan's `createPuramassOrder` passes `customer.phone` to the partner.
8. **Names required (§G):** Aminocan currently marks first and last name "Optional". Confirm.
9. **Landing offer (§H):** it is ported only with the Landing Pages feature. Confirm that Aminocan's discount-code engine supports `first_order_only` and `excluded_product_ids` identically.
10. **Cart referral field (§I):** VYTA never renders it. Do we want it at all?
