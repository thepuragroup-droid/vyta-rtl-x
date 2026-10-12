# "Choose your pack": build spec

> The full spec for the pack picker on `/products/:slug`: where the data lives, how
> admins configure it, how it is priced, how it looks on the storefront, and
> how a chosen pack travels through the cart, the checkout and the order record.
>
> **Stack:** Next.js 15 (App Router) + Supabase (`@supabase/supabase-js`) + Tailwind
> CSS + framer-motion + lucide-react.
>
> **Files examined:**
> `lib/pricing.ts` · `app/products/[slug]/page.tsx` ·
> `app/products/[slug]/ProductDetailClient.tsx` ·
> `components/admin/PackPricingEditor.tsx` · `components/admin/PackOptionsDialog.tsx` ·
> `app/(admin)/admin/products/page.tsx` · `app/(admin)/admin/products/CellEditGrid.tsx` ·
> `app/api/admin/products/route.ts` · `app/api/admin/products/[id]/route.ts` ·
> `app/api/admin/products/pack-sizes/route.ts` · `contexts/CartContext.tsx` ·
> `contexts/PurchaseModalContext.tsx` · `app/cart/page.tsx` ·
> `app/checkout/PuramassCheckoutContent.tsx` · `app/api/checkout/puramass/route.ts` ·
> `lib/pricing/resolve.ts` · `lib/products/products-server.ts` · `lib/permissions.ts` ·
> `lib/admin/product-history.ts` · `app/products/ProductsClient.tsx` · `components/Products.tsx` ·
> `app/(customer)/account/orders/[id]/page.tsx` · `lib/order-confirmation-data.ts` ·
> `lib/order-confirmation-email.ts` · `lib/fulfillment-email.ts` ·
> `lib/payments/puramass-fulfillment.ts` · `tailwind.config.ts` ·
> migrations `pack-options-content-migration.sql`, `pack-option-pricing-migration.sql`,
> `pack-option-badge-migration.sql`, `case-price-remove-pack-discount-migration.sql`.
>
> The schema below comes from those migration files. No schema was supplied with
> this request, so the migrations are the source of truth here.

---

## Contents

1. [Overview](#1-overview)
2. [Database schema](#2-database-schema)
3. [Components & modules](#3-components--modules)
4. [UI/UX design overview](#4-uiux-design-overview)
5. [Data flow & behavior](#5-data-flow--behavior)
6. [Edge cases & states](#6-edge-cases--states)
7. [Open questions, gotchas & unverified items](#7-open-questions-gotchas--unverified-items)

Quick links: [Turning a pack on/off](#36a-turning-a-pack-on-or-off) ·
[Tags: Most Popular, Best Value](#36b-pack-tags-most-popular-best-value) ·
[Emails](#312-emails-price-and-amount-per-pack)

---

## 1. Overview

A product is sold in **packs of N vials** (for example 1, 3, 5 or 10). On the
product detail page (PDP), in the buy column under the specs and COA button,
the **"Choose your pack"** grid shows one button per pack. Each button shows the
pack's label, its price, an optional struck-through "was" price, the price per
vial, an optional green **Save $X (Y%)** pill and an optional merchandising
**tag** pinned to its top edge ("Most Popular", "Best Value"). An admin can
switch any pack **off** to stop selling it without losing its settings.
Choosing a pack does five things:

- updates the large headline price,
- switches the hero image to the box photo (for packs larger than 1),
- resets the quantity stepper (each pack has its own stock limit),
- changes the label and total on **Add to Cart**,
- sets what goes into the cart.

**Configuration** happens in three admin places, all on `/admin/products`:

| Surface | What it edits | Scope |
|---|---|---|
| **Product form → "Pack options & pricing"** (`PackPricingEditor`) | Sizes **plus** per-pack on/off, label, tag, price and compare-at | One product |
| **"Pack options" toolbar button → dialog** (`PackOptionsDialog`) | Sizes only | Many products in one request |
| **Cells view → "Pack options" column / "Set pack options" menu** (`CellEditGrid`) | Sizes only | Many rows, staged then saved |

**Pricing** is derived by default (`vial price × pack size`). An admin can type a
fixed price per pack. When that price is lower than the undiscounted figure, the
storefront works out the strike-through and the saving on its own.

**Downstream**, the chosen pack becomes a cart line keyed by
`productId::p{packSize}`. It is shown as "Pack of N" or "Single vial" in the
cart and checkout, at the catalog's **current** pack price (the cart re-prices
itself when it loads and when checkout opens). The server **re-prices** it again
when the order is placed (`POST /api/checkout/puramass`), refuses a pack the
product no longer offers, and sends it to the fulfilment partner (Stealth
Health / PuraMass) as one case-SKU unit per pack, at that pack's own price.
The invoice written at that point is what the **confirmation and shipped
emails** are built from, so they show each pack at the price and amount charged.

---

## 2. Database schema

Everything lives on the **`products`** table. There is no separate packs table.

### 2.1 Pack columns

```sql
-- pack-options-content-migration.sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS pack_sizes integer[];
-- CHECK products_pack_sizes_positive_chk:
--   pack_sizes IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(pack_sizes) s WHERE s < 1)

-- pack-option-pricing-migration.sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS pack_options jsonb;
-- CHECK products_pack_options_shape_chk:
--   pack_options IS NULL OR (
--     jsonb_typeof(pack_options) = 'array'
--     AND every element is an object
--     AND element.size is a number, whole, 1..1000
--     AND element.price      (if a number) >= 0
--     AND element.compare_at (if a number) >= 0 )

-- pack-option-badge-migration.sql: no DDL. Adds a `badge` key to each element
-- and updates the column comment.
```

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `pack_sizes` | `integer[]` | yes | `NULL` | The older column, **quantities only**, e.g. `{1,3,5,10}`. `NULL` or `{}` means "not opted in". |
| `pack_options` | `jsonb` | yes | `NULL` | The newer column, a **full per-pack configuration** (see shape below). `NULL` means fall back to `pack_sizes`. |

**`pack_options` element shape** (as normalised by `lib/pricing.ts → normalizePackOptions`):

```jsonc
[
  { "size": 1,  "label": null, "badge": null,           "price": null, "compare_at": null, "enabled": true },
  { "size": 3,  "label": null, "badge": "Most Popular", "price": 249,  "compare_at": 267,  "enabled": true },
  { "size": 10, "label": null, "badge": "Best Value",   "price": 749,  "compare_at": null, "enabled": true }
]
```

| Key | Type | Rule | Blank / `null` means |
|---|---|---|---|
| `size` | int | Required. Whole number, 1–1000, unique per product. Rows are sorted ascending and capped at **8** (`MAX_PACK_OPTIONS`). | Row is dropped |
| `label` | string \| null | Trimmed, max **60** chars | `packLabel(size)` → `"Single vial"` / `"Pack of N"` |
| `badge` | string \| null | Trimmed, max **24** chars (`MAX_PACK_BADGE_LENGTH`). Free text. Presets: `"Most Popular"`, `"Best Value"` | No tag chip |
| `price` | number \| null | ≥ 0, rounded to 2 dp. Negative or non-numeric values count as unset | `vial price × size` |
| `compare_at` | number \| null | ≥ 0, rounded to 2 dp. Also accepts the `compareAt` spelling on input | Undiscounted `vial price × size` **if** `price` is below it, otherwise none |
| `enabled` | boolean | Anything other than literal `false` is `true`. Set by the **On** switch in the product form. A document where every row is `false` is refused by the admin API | `true` |

### 2.2 Related `products` columns the feature reads

| Column | Type | Role in this feature |
|---|---|---|
| `price` | `numeric NOT NULL` | Case (box) price, CAD. Rule: `price = vial_price × vials_per_box` (no pack discount; see `case-price-remove-pack-discount-migration.sql`). When `price = 0` the picker is hidden and the PDP shows "N/A". |
| `vial_price` | `numeric` (nullable) | Explicit single-vial price. `NULL`, or `0` while `price > 0`, means derived: `price ÷ vials_per_box`. |
| `vials_per_box` | `integer NOT NULL DEFAULT 10` | Size of a full case. Used for the **default pack pair** and for vial-price derivation. Invalid values fall back to 10. |
| `stock_quantity` | `integer NOT NULL DEFAULT 0` | **Counted in vials.** The number of packs you can buy is `floor(stock ÷ size)`. |
| `image_url` / `box_image_url` | `text` | The hero shows `box_image_url` when the selected pack size is > 1. |
| `puramass_sku` | `varchar(80)` | Fulfilment **case** SKU. Every pack > 1 maps here. |
| `puramass_sku_vial` | `varchar(80)` | Fulfilment **single-vial** SKU. Pack size 1 maps here. |

### 2.3 Precedence (which column wins)

```
pack_options (enabled rows)  →  pack_sizes  →  default pair [1, vials_per_box]
                                               (just [1] when vials_per_box ≤ 1)
```

Nothing is backfilled, so a product nobody has touched still sells as "single vial + one full case".

A configured `pack_options` decides on its own **even if every row in it is
switched off**: it never falls back to `pack_sizes`, which would put the
switched-off packs back on sale at vial × size. (The admin UI and API both stop
the last pack being switched off, so this only matters for hand-edited data.)

### 2.4 Schema usage map

| Reader / writer | Columns | How |
|---|---|---|
| `app/products/[slug]/page.tsx` → `getPublicProduct` | `select('*')` | Server component, anon Supabase client (`lib/products/products-server.ts`), ISR `revalidate = 300` |
| `ProductDetailClient → useLiveProduct` | **reads** `stock_quantity, price, vial_price, pack_options, active` | Browser Supabase client (`@/lib/supabase`), once on mount |
| `POST /api/admin/products` | **writes** `pack_sizes`, `pack_options` | Route handler, service-role client |
| `PATCH /api/admin/products/[id]` | **writes** `pack_sizes`, `pack_options` (reconciles when only sizes are sent) | Route handler, service-role client |
| `PATCH /api/admin/products/pack-sizes` | **reads** `id, name, pack_sizes, pack_options`; **writes** `pack_sizes`, `pack_options`, `updated_at` | Route handler, service-role client, bulk |
| `POST /api/checkout/puramass` | **reads** `id, name, price, vial_price, vials_per_box, pack_options, puramass_sku, puramass_sku_vial` | Route handler, server client. Re-prices every line |
| Catalog grid (`ProductsClient.tsx`, `components/Products.tsx`, `BestSellers.tsx`) | reads `pack_sizes, pack_options` | `largestPackFor()` → "Pack of 10 · $X" line |
| History (`lib/admin/product-history.ts`) | logs `pack_sizes` as "Pack options" and `pack_options` as "Pack pricing" | Field labels |

---

## 3. Components & modules

### 3.1 Pricing engine: `lib/pricing.ts`

- **Type:** shared TS module, imported by client and server code.
- **Purpose:** the **single source of truth** for which packs exist and what each costs. The PDP, the purchase modal, the admin previews and the checkout route all call these functions, so the price a customer sees and the price the server charges come from the same code.

| Export | Signature | Behavior |
|---|---|---|
| `PACK_SIZE_OPTIONS` | `[1, 3, 5, 10]` | One-click sizes in the admin UIs |
| `MAX_PACK_OPTIONS` | `8` | Maximum packs per product |
| `PACK_BADGE_PRESETS` | `['Most Popular', 'Best Value']` | Tag quick-picks |
| `MAX_PACK_BADGE_LENGTH` | `24` | Maximum tag length |
| `vialsPerBoxOf(n)` | `→ number` | `n > 0 ? n : 10` |
| `vialPriceFor(p)` | `→ number` | `vial_price` if > 0, otherwise `round2(price ÷ vialsPerBox)` |
| `normalizePackSizes(raw)` | `→ number[]` | Whole numbers 1–1000, deduplicated, ascending, max 8 |
| `normalizePackOptions(raw)` | `→ StoredPackOption[]` | Cleans the jsonb rows. Also accepts a bare number array. A later duplicate size wins |
| `storedPackOptions(p)` | `→ StoredPackOption[]` | `pack_options`, or else `pack_sizes` mapped to blank rows. **Includes** disabled rows |
| `packOptionsFor(p)` | `→ ResolvedPackOption[]` | **What the storefront renders.** Filters to `enabled` and fills every blank (algorithm below) |
| `packOptionFor(p, size)` | `→ ResolvedPackOption \| null` | One resolved pack |
| `packSizesFor(p)` | `→ number[]` | Enabled sizes using the precedence rule in §2.3 |
| `isPackOffered(p, size)` | `→ boolean` | `packSizesFor(p).includes(size)`. **Used by checkout** to refuse a pack that was switched off or removed |
| `hasEnabledPack(raw)` | `→ boolean` | At least one row of a `pack_options` document is on. Used by the admin API to refuse an all-off write |
| `packPriceFor(p, size)` | `→ number` | Fixed `pack_options[].price` for that size, otherwise `round2(vialPrice × size)`. **Used by checkout to charge** |
| `packsInStock(stockVials, size)` | `→ number` | `floor(max(0, stock) ÷ size)` |
| `packLabel(size)` | `→ string` | `"Single vial"` / `"Pack of N"` |
| `packShortLabel(size)` | `→ string` | `"1 vial"` / `"N-pack"` |
| `reconcilePackOptions(stored, sizes)` | `→ StoredPackOption[] \| null` | After a sizes-only edit: sizes that remain **keep** their price, label, tag, compare-at and on/off. New sizes come in blank (and on), removed sizes are dropped. If no surviving pack is on, all of them are switched back on. Returns `null` if the product had no `pack_options` |
| `largestPackFor(p)` | `→ {size, price, compareAt} \| null` | Largest enabled pack > 1, used on catalog cards |
| `parsePackSizesInput(text)` / `formatPackSizes(sizes)` | | Grid text format: accepts `1, 3, 5, 10`, `1/3/5/10`, `1 3 5 10` or `1\|3\|5\|10` |
| `samePackSizes(a, b)` | `→ boolean` | `NULL` and `[]` count as equal |

**`ResolvedPackOption`** (what the PDP renders):

```ts
{ size: number; label: string; badge: string | null; price: number;
  compareAt: number | null; savings: number; savingsPercent: number; perVialPrice: number }
```

**`packOptionsFor` resolution algorithm** (per enabled stored row):

```
vialPrice     = vialPriceFor(product)
undiscounted  = round2(vialPrice × size)
price         = row.price ?? undiscounted
rawCompare    = row.compare_at ?? (price < undiscounted ? undiscounted : null)
compareAt     = rawCompare > price ? rawCompare : null      // a compare-at that isn't higher is dropped
savings       = compareAt ? round2(compareAt − price) : 0
savingsPercent= compareAt > 0 ? Math.round(savings / compareAt × 100) : 0
perVialPrice  = round2(price ÷ max(1, size))
label         = row.label ?? packLabel(size)
```

**Worked example:** vial price $25.00, 3-pack with `price: 66` and no compare-at
→ undiscounted $75.00 → compare-at $75.00 → savings $9.00 (12%) → $22.00 / vial.

### 3.2 PDP server shell: `app/products/[slug]/page.tsx`

- **Type:** Server Component. `revalidate = 300` (5-minute ISR). `generateStaticParams` pre-renders every active product.
- **Purpose:** resolves the product by `url_slug`, falling back to the legacy `slug`. Redirects a legacy slug to the canonical URL with a 308 (`permanentRedirect`). Calls `notFound()` if the product doesn't exist. Also fetches related products, bacteriostatic water, review stats and site config, then renders `<ProductDetailClient>`.
- **Props passed:** `product`, `relatedProducts`, `batWater`, and six section toggles from Admin → Settings: `showTrustBadges`, `showReviews`, `showSpecs`, `showBenefits`, `showCertifications` and `showCtaBadges`. **None of these toggles affect the pack picker.**

### 3.3 PDP client: `app/products/[slug]/ProductDetailClient.tsx`

- **Type:** Client Component (`'use client'`).
- **Purpose:** renders the page and owns the pack picker, the headline price, the quantity stepper and Add to Cart.
- **Props:** `product: Product` (never null), `relatedProducts: Product[]`, `batWater: Product | null`, and the boolean section toggles (all default `true`).
- **State / hooks:**
  - `product = useLiveProduct(serverProduct)`. The page is cached for up to 5 minutes, so on mount this hook re-reads `stock_quantity, price, vial_price, pack_options, active` with the browser Supabase client and merges them in. If the refresh fails, the page keeps the server values without showing an error.
  - `packSize: number | null`: the selected pack, `null` until the opening effect runs.
  - `qty: number` (default 1) and `added: boolean` (the 1.8 s "Added to cart" flash).
  - `useCart()` → `addItem`, `flyToCart`. `useToast()` → `toast.error`.
- **Constants:** `DEFAULT_PACK_SIZE = 3`.
- **Derived values:**
  - `packs = packOptionsFor(product)`
  - `capFor(size) = packsInStock(product.stock_quantity, size)`
  - `selectedPack = packs.find(size === packSize) ?? packs[0] ?? null`
  - `heroImage = (selectedPack.size > 1 ? box_image_url : null) ?? image_url ?? null`
  - `headlinePrice = selectedPack?.price ?? vialPriceFor(product)`, `headlineCompareAt = selectedPack?.compareAt ?? null`
  - `selectedCap = capFor(selectedPack.size)`, `lineTotal = round2(headlinePrice × qty)`
- **Opening selection** (effect keyed on `product.id`): pick the **3-pack if it exists and is buyable** (`capFor ≥ 1`). Otherwise pick the first buyable pack, otherwise `packs[0]`. Also resets `qty = 1` and `added = false`.
- **`selectPack(size)`:** sets the size, resets `qty` to 1 and clears `added`.
- **`handleAddToCart()`:**
  1. If `cap < 1`, show a toast and stop. The message is `"Not enough stock for a {label lowercased}."` for packs > 1, otherwise `"Out of stock."`.
  2. Call `addItem({...})` **`qty` times**. Each call adds one unit:
     ```ts
     { productId, unit: size > 1 ? 'case' : 'vial', packSize: size,
       vialsPerBox: vialsPerBoxOf(product.vials_per_box), name, price: selectedPack.price,
       strength, image_url, stock_quantity: cap /* in PACKS */ }
     ```
  3. If none of the calls added anything, show the toast `"Only {cap} in stock — that's all we have."`.
  4. Otherwise run `flyToCart(heroImageRef, { image_url: heroImage })`, then `added = true` for 1800 ms.
- **Analytics:** on mount it fires `trackActivity({type:'view'})` and GA4 `view_item` with `item_variant: 'Vial'` and `price: vialPriceFor(product)`. These track the **vial**, not the selected pack.
- **Data access:** read-only. Server props, plus the one browser-side `products` select above.
- **Renders:** `Navigation`, `ProductInfoTabs`, `ProductReviews`, `Footer`. **Rendered by:** `page.tsx`.

### 3.4 Admin per-product editor: `components/admin/PackPricingEditor.tsx`

- **Type:** Client Component. A controlled editor with no state of its own.
- **Purpose:** for one product, choose which packs exist and set each pack's **On** switch, **Button label**, **Tag**, **Price** and **Compare at**, with a live "Customer sees" preview.
- **Props:**
  - `sizes: number[]`: selected sizes. Empty means the default pair.
  - `rows: PackOptionDraft[]`: `{ size, label, badge, price, compare_at, enabled }`. The four text fields are strings; `enabled` is a boolean.
  - `vialPrice: number`: the product's vial price, computed live from the form's `price`, `vial_price` and `vials_per_box`.
  - `vialsPerBox: number`: used for the empty-state explainer.
  - `disabled?: boolean`.
  - `onChange({ sizes, rows })`.
- **Exports:**
  - `emptyPackRow(size)`.
  - `rowsForSizes(sizes, existing)`: re-uses typed rows, so turning a size off and back on keeps what was typed.
  - **`packOptionsPayload(sizes, rows)`**: builds the `pack_options` body, carrying each row's `enabled`. It returns **`null` when nothing is overridden** (every label, tag, price and compare-at is blank **and** every pack is on), so an untouched editor stores `NULL` rather than a document that only repeats the defaults. A pack switched off counts as an override, because only `pack_options` can record it.
- **Money parsing:** strips `$`, `,` and whitespace. Blank, negative or non-numeric input means "not set".
- **Behavior:**
  - Size toggles show the union of `[1, 3, 5, 10]` and any custom sizes the product already has.
  - A size that is off is disabled once 8 sizes are selected.
  - **"Use default"** (only shown when sizes are selected) clears both sizes and rows.
  - Tag presets toggle: clicking the active preset clears it. The text input also offers the presets through `<datalist id="pack-badge-presets">` and has `maxLength=24`.
  - Input placeholders:
    - Label: `packLabel(size)`.
    - Tag: `"No tag"`.
    - Price: the undiscounted figure.
    - Compare at: the undiscounted figure when a saving is implied and no compare-at is set, otherwise `"—"`.
- **Rendered by:** `app/(admin)/admin/products/page.tsx` in the product create/edit modal, **only when `canEdit` (role = `admin`)**.

### 3.5 Admin bulk dialog: `components/admin/PackOptionsDialog.tsx`

- **Type:** Client Component, a modal.
- **Purpose:** apply one **set of sizes** to many products in a single request. It does **not** edit prices, labels or tags.
- **Props:**
  - `products: Product[]`.
  - `initialSelection?: string[]`: the admin page pre-ticks **everything the current table filter is showing**.
  - `onClose()`.
  - `onSaved(updated, message)`.
- **State:**
  - `query`, `category`, and `status` (`'all' | 'custom' | 'default'`).
  - `selected: Set<string>`.
  - `sizes`: starts at `[1, 3, 5, 10]`.
  - `customSize`, `saving`, `error`.
- **Behavior:**
  - Searches by name, SKU or category. Filters by category and by "Has custom options" / "On the default pack" (either pack column counts as custom).
  - "Select all N" / "Clear these" act on the visible rows. "Deselect all (n)" clears the whole selection.
  - "Other size…" input plus **Add** (Enter also works). It is validated as a whole number ≥ 1 within the 8-size cap.
  - **Preview** of the first selected product: one row per size priced with `packPriceFor`, and a footer reading `${vialPrice} per vial × pack size`.
  - **Apply to N products** sends `PATCH /api/admin/products/pack-sizes` with `{ product_ids, pack_sizes }`.
  - **Reset selection to the default pack** sends the same request with `pack_sizes: null`.
  - Escape closes the dialog unless it is saving.
- **Success message:**
  - `Set 1, 3, 5, 10 on N products`, or
  - `Reset N products to the default pack`.
- **Rendered by:** the admin products page when the **"Pack options"** toolbar button (lucide `Boxes`, admin-only) is clicked.

### 3.6 Admin cell grid: `app/(admin)/admin/products/CellEditGrid.tsx`

- **Type:** Client Component, a spreadsheet view (`viewMode === 'cells'`).
- **Pack column:** `{ key: 'pack_options', label: 'Pack options', sub: 'vials per pack', width: 190 }`.
  - The cell shows `formatPackSizes(packSizesFor(...))`. It shows in ink text when the size list was set explicitly and in muted text with a "default" hint when it wasn't.
  - Editing a cell parses the text with `parsePackSizesInput`. An empty cell or **Delete** resets it to the default.
  - Edits are staged locally (amber corners, Ctrl+Z, Discard) and sent with **Save** as `PATCH /api/admin/products/[id]` with `{ pack_sizes }` only.
- **"Set pack options" toolbar menu** (`PackOptionsMenu`):
  - A popover, `w-72`, with toggles for `[1, 3, 5, 10]` only. The initial pick is `[1, 10]`.
  - **Apply** stages those sizes on every selected row. **Reset to default** stages `null`.
  - It closes on an outside click or Escape.

### 3.6a Turning a pack on or off

The **On** column in the product form's "Pack options & pricing" table.

| Aspect | Behavior |
|---|---|
| Where | Admin → Products → edit a product → "Pack options & pricing" → first column of each pack row. Admin role only. |
| Off means | The pack keeps everything typed into its row (label, tag, price, compare-at) and stays in `pack_options` with `enabled: false`. It disappears from the product page picker, the purchase modal, checkout add-ons and the catalog card's "Pack of N" line, because all of them read `packOptionsFor`, which drops off rows. |
| Back on | Flip the switch again: the pack returns with its saved settings. |
| Last pack | The last pack that is on cannot be switched off. Its switch is disabled with the tooltip "At least one pack has to stay on". Removing the last "on" size with the size toggles above the table switches the remaining packs back on. The API also refuses an all-off document (400 "At least one pack has to stay on sale"). |
| Remove vs off | The size toggles above the table (`1 vial`, `3-pack`, …) **remove** a pack and its settings. The **On** switch only hides it. |
| Bulk tools | The bulk dialog and the cell grid edit sizes only. A pack that survives their edit keeps its on/off setting (`reconcilePackOptions`). |
| Admin table | The product row's pack chip lists the sizes on sale, then `· N off` when some are switched off. Its tooltip names them. |
| Already in a cart | A shopper who added the pack before it was switched off is stopped at checkout with a 409: "Some items in your cart are no longer sold in that pack size. Remove them and add the pack you want from the product page.", listing e.g. "BPC-157 10mg (pack of 3)". Nothing is charged. |

**Switch styling:** `role="switch"`, `aria-checked`, `h-5 w-9 rounded-full`. On: `bg-teal-dark` (#1B5D83). Off: `bg-line` (#DCE7EB). White `h-4 w-4` knob with `shadow-sm`, moved with `translate-x-[18px]` (on) or `translate-x-0.5` (off). An off row gets a `bg-surface/60` background, a muted size label, and its "Customer sees" cell is dimmed (`opacity-60`) under an `EyeOff` "Hidden from storefront" line.

### 3.6b Pack tags: Most Popular, Best Value

| Aspect | Behavior |
|---|---|
| Stored as | `pack_options[].badge`: free text, trimmed, at most **24** characters. Blank or whitespace means no tag. |
| Set in | Product form → "Pack options & pricing" → **Tag** column. A text box (`maxLength=24`, placeholder "No tag", `<datalist>` suggestions) plus two one-click preset pills: **Most Popular** and **Best Value** (`PACK_BADGE_PRESETS`). Clicking the active preset clears it. Any other wording is allowed, e.g. "Limited", "Starter kit". |
| Bulk | Not editable in bulk. The bulk dialog and the grid keep the tags of the packs that survive their edit. |
| Product page | A chip pinned across the top edge of the pack button: `absolute -top-2 left-2 right-2 truncate rounded-full bg-teal-dark px-1.5 py-0.5 text-center text-[9px] font-bold uppercase tracking-wide text-white shadow-sm`. The grid has `pt-2` so the chip has room. |
| Purchase modal | The same chip on its pack cards (quick-add from the catalog, and checkout add-ons). The modal's grid also has `pt-2`. |
| Admin preview | The "Customer sees" column shows the same Vital Blue chip (`bg-teal-dark`). |
| Hidden when | The pack is sold out ("Not enough stock") or switched off. |
| Not shown | Cart, checkout summary, invoices and emails. These describe what was bought ("Pack of 3"), not the merchandising. |
| Does not affect | Price, or which pack the page opens on. The product page always opens on the 3-pack if it can be bought (`DEFAULT_PACK_SIZE = 3`), whichever pack is tagged. |

### 3.7 Admin products page: `app/(admin)/admin/products/page.tsx`

- **Form state:** `pack_sizes: number[]` and `pack_options: PackOptionDraft[]`.
- **`openEditModal`:** if `pack_options` has rows, the selected sizes come from it (including switched-off ones). Otherwise they come from `pack_sizes`. The draft rows are seeded from stored values, including `enabled`, so the boxes show the real prices and switches instead of blanks.
- **Save payload (full admin):**
  ```ts
  pack_sizes:   formData.pack_sizes.length > 0 ? formData.pack_sizes : null,
  pack_options: packOptionsPayload(formData.pack_sizes, formData.pack_options),
  ```
  The **descriptor-only payload** (role `analytics`) leaves out both pack fields.
- **Table row chip:** under each product name there is a pill showing `formatPackSizes(packSizesFor(product))` (the sizes on sale), followed by `· N off` when packs are switched off. It is teal (`bg-teal/10 text-teal-dark`) when either pack column is set (`hasCustomPackSizes`) and muted (`bg-surface-2 text-ink-muted`) otherwise.

### 3.8 Admin API routes

| Route | Auth | Pack handling |
|---|---|---|
| `POST /api/admin/products` | `canEdit` (admin) | `normalizePackSizes` / `normalizePackOptions`. An empty result is stored as `NULL`. A `pack_options` with every pack off → 400 `"At least one pack has to stay on sale"`. |
| `PATCH /api/admin/products/[id]` | `canEditProductDescriptors` (admin or analytics). **Non-admins have every non-descriptor key stripped**, so analytics users cannot change packs. | `pack_sizes` must be an array or null, otherwise 400 `"Pack options must be a list of numbers"`. `pack_options` must be an array or null, otherwise 400 `"Pack pricing must be a list of pack rows"`; every pack off → 400 `"At least one pack has to stay on sale"`. **If only `pack_sizes` is sent** (the grid), `pack_options = reconcilePackOptions(existing, sizes)`. |
| `PATCH /api/admin/products/pack-sizes` | `canEdit` (admin) | Body `{ product_ids: string[] (≤ 500), pack_sizes: number[] \| null }`. Reads the current rows, reconciles `pack_options` per product, then groups products by identical result so the common case is one `UPDATE … IN (…)`. Records product history only for rows that changed, with `source: 'bulk_pack_options'`. Writes one audit row with `action: 'product.pack_options_bulk'` and `entity_id: "N product(s) → 1, 3, 5, 10"`. A missing column produces a friendly hint telling you which migration to run. Response: `{ success, updated, products }`. |

### 3.9 Cart: `contexts/CartContext.tsx`

- **`CartItem`:**
  ```ts
  { id: `${productId}::p${packSize}`, productId, unit: 'vial' | 'case', packSize, vialsPerBox,
    name, price /* per pack */, quantity /* packs */, strength, image_url?, stock_quantity /* packs */ }
  ```
- Line identity is **product + pack size**, so a 1-pack, a 3-pack and a 10-pack of one product are separate lines.
- `addItem` adds one unit and refuses when `quantity + 1 > stock_quantity` (returns `false`).
- The cart persists in `localStorage['northern_peptides_cart']`, syncs across tabs, and migrates legacy lines through `normalizeCartItem`. A legacy case line without `packSize` gets `vialsPerBox` as its pack size, and `unit` is always re-derived from `packSize`.
- `totalPrice = Σ price × quantity`.
- **`refreshPrices()`** keeps line prices current. A cart can sit in `localStorage` for days, so whenever the cart loads or its set of products changes (and again when the checkout page opens), it reads `id, price, vial_price, vials_per_box, pack_sizes, pack_options` for the products in the cart (browser Supabase client) and sets each line's price to `packPriceFor(product, packSize)`. This is the same function the checkout server charges with, so the cart, the checkout summary, the invoice and the emails all show one figure. A failed read keeps the stored prices. Stock limits are not touched.

### 3.10 Checkout client: `app/checkout/PuramassCheckoutContent.tsx`

- **"Your order" summary:** one row per cart line.
  - Left: name, then a small grey line `"{strength} · "` followed by a pill (`Pack of N` / `Single vial`) and `× {qty}`.
  - Right: `${price × qty}`.
- `totalVials = Σ quantity × packSize` feeds the shipping-weight quote and the bacteriostatic-water nudge.
- **On arrival** it calls `refreshPrices()`, so the summary quotes current catalog pack prices.
- **Submit payload:** `items: [{ id: productId, packSize, quantity: quantity × packSize /* TOTAL VIALS */ }]`. The client sends **no prices**.
- **409 handling:** `unavailable` (a pack switched off or removed) and `unmapped` (no fulfilment SKU) both list the affected lines under the error, above the pay button.
- **Checkout add-ons ("You'll also need" / "Also recommended"):**
  - Each add-on row shows `from $X`, where X is the cheapest of `packOptionsFor(p)`, filtered to the forms the fulfilment partner has a SKU for. A product with no pack on sale that has a SKU behind it is not offered as an add-on.
  - The **+** button opens the shared **purchase modal** (`PurchaseModalContext`) with the product's `pack_sizes` and `pack_options`, `allowedUnits`, and `ignoreStock: true`.

### 3.11 Checkout server: `app/api/checkout/puramass/route.ts`

1. **Parse lines:** `{ id, packSize, quantity }`. `quantity` is total vials. Invalid lines are skipped, and an empty result returns 400 `"Your cart is empty."`.
2. **Load products:** `id, name, price, vial_price, vials_per_box, pack_sizes, pack_options, puramass_sku, puramass_sku_vial`. If that select errors, the route retries without the pack columns and the vial SKU.
   Then **check each pack is on sale:** `isPackOffered(product, packSize)`. Any line for a pack that was switched off or removed (or a size the product was never sold in) → 409 `{ error: 'Some items in your cart are no longer sold in that pack size. …', unavailable: ['Name (pack of N)' | 'Name (single vial)'] }`. Skipped on the fallback read, which has no pack columns.
3. **Map to SKUs:**
   - `packSize > 1` → `box` mapping → `puramass_sku`, `units = clamp(round(vials ÷ packSize), 1..99)`.
   - `packSize = 1` → `vial` mapping → `puramass_sku_vial`, `units = clamp(vials, 1..99)`.
4. **Price each line** (`priceCartLines`):
   - `resolvePriceMap` applies, in order: customer override → active pricelist → base `products.price`.
   - If the source is `base`: `unit = packPriceFor({ price, vial_price, vials_per_box, pack_options }, packSize)`. **Admin-set pack prices are honoured.**
   - If the source is an **override or pricelist**: `vialPrice = round2(resolved.price ÷ vialsPerBox)` and `pack_options` is ignored (`null`), so `unit = vialPrice × packSize`. **Out of scope:** pack pricing is not used together with price lists or per-customer overrides, so this path is not part of this feature.
5. **Merge lines** by `sku::packSize`. A 5-pack and a 10-pack share the case SKU but stay separate lines at different prices.
6. **Missing SKU:** return 409 `{ error: 'Some items are not available for hosted checkout.', unmapped: ['Name (pack of N)' | 'Name (single vial)'] }`.
7. **Discounts** (code, first-order ad discount, cart offer) are spread over `unit_price_cents`. The free-shipping threshold is measured at **list** price.
8. **What gets written:**
   - The fulfilment partner gets `{ sku, quantity, unit_price_cents }`.
   - The ledger gets those lines plus `list_unit_price_cents`, `product_id` and **`pack_size`**.
   - The pending invoice gets lines with `description: "{name} — Pack of N" | "{name} — Single vial"`, `price_type: 'box' | 'vial'` and `vials_per_unit: packSize`.
   - Klaviyo "Started Checkout" items are named `"{name} (pack of N)"` or `"{name} (single vial)"`.

### 3.12 Emails: price and amount per pack

Every customer email about a hosted-checkout order is built from the **invoice
lines written at hand-off**, which already carry the pack, the quantity and the
price actually charged. No email recomputes a price.

**Where the figures come from**

| Field on the invoice line | Value written at hand-off (`/api/checkout/puramass`) |
|---|---|
| `description` | `"{product} — Pack of N"` or `"{product} — Single vial"` |
| `qty` | Number of packs (one case-SKU unit per pack) |
| `unit_price` | The pack's price **after** any discount, in CAD |
| `price_type` / `vials_per_unit` | `'box'` / N for a pack, `'vial'` / 1 for a single vial |

The ledger row (`puramass_orders.items`) keeps each line's `list_unit_price_cents`
(the pack price before discount), `product_id` and `pack_size`. If the invoice
could not be written at hand-off, the payment handler builds it from the ledger
(`linesFromLedger` in `lib/payments/puramass-fulfillment.ts`) with the same
description, quantity and price.

**How the emails show them** (`stealthHealthOrderSummary` in `lib/order-confirmation-data.ts`):

- Each line's name and pack are split back out of the description, so the email reads `BPC-157 10mg (Pack of 3)`.
- If every line's list price is on the ledger (matched by product and pack size), lines are shown at **list price** and the difference becomes a **Discount** row labelled with the code or offer (e.g. "VYTA10"). Otherwise lines are shown at the price charged with no discount row.
- Either way: the line amounts (`price × qty`) add up to the **Subtotal**, and **Subtotal − Discount + Shipping + Tax = Total**, which equals the invoice total the customer paid.

| Email | File | Line format |
|---|---|---|
| Order confirmation (customer, on payment) | `lib/order-confirmation-email.ts` | Name, `Pack of N · strength`, Qty, unit price, line amount. Then the Subtotal / Discount / Shipping / Tax / Total summary |
| Admin "order paid" alert | same template, via `lib/admin/stealth-health-paid-alert.ts` | Same lines and totals |
| "Your order has shipped" (customer, sent by staff) | `lib/fulfillment-email.ts` | Name, `strength · Pack of N`, Qty, line amount |

**Worked example** (covered by the test "every pack ordered shows in the email at
the price and amount charged" in `lib/order-confirmation-email.test.ts`): $25
vial; 3-pack fixed at $66; 10-pack fixed at $200; second product's 5-pack at
vial × 5 = $200; code VYTA10 (10%); shipping $15.

```
BPC-157 10mg (Pack of 3) × 2 — $132.00
BPC-157 10mg (Single vial) × 1 — $25.00
BPC-157 10mg (Pack of 10) × 1 — $200.00
TB-500 5mg (Pack of 5) × 1 — $200.00
Subtotal: $557.00
Discount (VYTA10): -$55.70
Shipping: $15.00
Total: $516.30 CAD      ← what was charged
```

Because the cart re-prices itself (§3.9), the checkout summary shows the same
$557.00 subtotal the email does, even if a pack price changed after the item was
added.

### 3.13 Other surfaces that show packs

| Surface | File | What it shows |
|---|---|---|
| Catalog cards | `app/products/ProductsClient.tsx`, `components/Products.tsx` | `$vial / vial` headline. Below it, `largestPackFor()` → `Pack of {size} · ${price} ~~${compareAt}~~ CAD` |
| Purchase modal | `contexts/PurchaseModalContext.tsx` | Same `packOptionsFor` data (switched-off packs hidden). Title is "Pack size", or "Sold as" when only one pack is offered. 2-column `PackCard`s with the **tag chip** on top (§3.6b) and a savings pill. Opens on the **smallest buyable** pack (not 3). |
| Cart page | `app/cart/page.tsx` | `{strength} \| Pack of N` / `Single vial` |
| Customer order detail | `app/(customer)/account/orders/[id]/page.tsx` | Pill `Pack of N` / `Single vial` from `pack_size`. Falls back to `unit` + `vialsPerBox` for older orders. |
| Confirmation email / invoice | `lib/order-confirmation-*.ts`, `lib/invoice-html.ts` | Parses `"— Pack of N"` / `"— Single vial"` out of the invoice description. Older `"— Case of N"` text is rewritten to `"— Pack of N"`. |

---

## 4. UI/UX design overview

### 4.1 Design tokens (from `tailwind.config.ts`)

| Token | Value | Used for |
|---|---|---|
| `ink` | `#07203A` (Midnight Navy) | Text; **active pack fill**; Add to Cart |
| `ink-muted` | `#56707F` | Secondary text |
| `surface` | `#F7FAFB` (Cloud) | Inactive pack fill |
| `surface-2` | `#EDF3F5` | Admin "default" chip |
| `line` | `#DCE7EB` | Borders and dividers |
| `teal` | `#438B9E` (Bio Teal) | Admin toggle borders, focus rings (`teal/40`) |
| `teal-dark` | `#1B5D83` (Vital Blue) | **Pack tag chip fill**; icons |
| `teal-50` | `#F1F8F9` | Purity pill background |
| `emerald-50` / `emerald-700` | `#ECFDF5` / `#047857` | Savings pill (inactive pack) |
| `emerald-600` | `#059669` | Headline "Save $X" text |
| `emerald-500` | `#10B981` | Add to Cart "Added" state |
| `red-600` / `red-200` | `#DC2626` / `#FECACA` | Out-of-stock button |
| Font | `var(--font-inter)`, Inter | Everything |
| `rounded-xl` | **`0.875rem` (14 px)**, overridden from Tailwind's 12 px | Pack buttons, stepper, CTA |
| `rounded-lg` | `0.5rem` (8 px) | Admin inputs |
| `shadow-sm` | `0 1px 2px 0 rgb(0 0 0 / 0.05)` | Active pack, tag chip |

Prices are always formatted as `$` + `toFixed(2)` with `tabular-nums`. The headline carries a literal `CAD` suffix.

### 4.2 PDP: placement

```
┌──────────── md:grid-cols-2, gap-6 / sm:gap-8 / md:gap-12 ────────────┐
│  Hero image (aspect-square)         │  RESEARCH GRADE PEPTIDE BLEND   │
│  · swaps to box_image_url when      │  Product name (h1)              │
│    selected pack > 1                │  [Purity] [Strength] [Form]     │
│  Trust strip (4 icons)              │  [ Certificate of Analysis  → ] │
│                                     │  ───────── border-t ──────────  │
│                                     │  CHOOSE YOUR PACK  $25.00 / vial at list price
│                                     │  ┌MOST POPULAR┐                 │
│                                     │  ┌────────┐┌────────┐┌───┐┌───┐ │
│                                     │  │Single  ││Pack of3✓││...││...│ │
│                                     │  │$25.00  ││$66.00 $75│   │   │ │
│                                     │  │$25/vial││$22/vial ││   │   │ │
│                                     │  │        ││Save $9 (12%)  │   │ │
│                                     │  └────────┘└────────┘└───┘└───┘ │
│                                     │  $66.00 $75.00 CAD Save $9.00 (12%)
│                                     │  $22.00 per vial · 3 vials      │
│                                     │  QUANTITY [−] 1 [+]             │
│                                     │  [🛒 Add to Cart · Pack of 3 - $66.00]
│                                     │  ── CTA badges / Key Benefits ──│
└─────────────────────────────────────┴─────────────────────────────────┘
```

The buy block wrapper is `mt-auto pt-4 sm:pt-6 border-t border-line`, so it sits at the bottom of the right-hand column.

### 4.3 "Choose your pack" block (exact classes)

Only rendered when **`product.price !== 0` and `packs.length > 1`**.

| Element | Classes | Resolved |
|---|---|---|
| Block wrapper | `mb-4 sm:mb-5` | 16 px → 20 px bottom margin |
| Header row | `mb-2 flex items-baseline justify-between gap-2` | |
| Title "Choose your pack" | `text-[11px] font-semibold uppercase tracking-wider text-ink-muted` | 11 px / 600 / 0.05em / `#56707F` |
| Right hint `$X.XX / vial at list price` | `text-[11px] text-ink-muted tabular-nums` | Uses `vialPriceFor(product)` |
| Grid | `grid grid-cols-2 gap-2 pt-2 sm:grid-cols-4` | **2 columns on mobile, 4 from `sm` (640 px)**; 8 px gap; 8 px top padding leaves room for the tag |
| **Pack button (base)** | `relative rounded-xl border p-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50` | 14 px radius, 10 px padding |
| ↳ inactive | `border-line bg-surface text-ink hover:border-ink/40 hover:bg-white` | border `#DCE7EB`, bg `#F7FAFB`; hover: border `rgba(7,32,58,.4)`, bg `#FFF` |
| ↳ active | `border-ink bg-ink text-white shadow-sm` | `#07203A` fill, white text |
| ↳ a11y | `type="button"`, `aria-pressed={active}`, `disabled={soldOut}` | |
| **Tag chip** (`badge && !soldOut`) | `absolute -top-2 left-2 right-2 truncate rounded-full bg-teal-dark px-1.5 py-0.5 text-center text-[9px] font-bold uppercase tracking-wide text-white shadow-sm` | Sticks 8 px above the top edge and spans the width with 8 px insets; `#1B5D83`; 9 px / 700 / uppercase; long text is truncated with an ellipsis |
| **Active check** (`active`) | wrapper `absolute right-1.5 top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white`; icon `Check h-2.5 w-2.5 text-ink` | 14 px white circle, 10 px navy check |
| Label | `block pr-4 text-[13px] font-semibold leading-tight` | 13 px / 600; `pr-4` keeps it clear of the check |
| Sold-out line (replaces the price lines) | `block text-[10px]`, plus `text-white/70` when active or `text-ink-muted` otherwise | Text: **"Not enough stock"** |
| Price | `mt-0.5 block text-[13px] font-bold tabular-nums` | 13 px / 700 |
| ↳ compare-at (if any) | `ml-1 text-[10px] font-normal line-through`, plus `text-white/60` when active or `text-ink-muted` otherwise | |
| Per-vial | `block text-[10px] tabular-nums`, plus `text-white/70` when active or `text-ink-muted` otherwise | `$X.XX / vial` |
| Savings pill (`savings > 0`) | `mt-1 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-semibold`, plus `bg-white/20 text-white` when active or `bg-emerald-50 text-emerald-700` otherwise | `Save $X.XX (Y%)`; the `(Y%)` part only appears when Y > 0 |

### 4.4 Headline, quantity and CTA

| Element | Classes / behavior |
|---|---|
| Headline wrapper | `mb-4 sm:mb-5`; row `flex flex-wrap items-baseline gap-x-2.5 gap-y-1` |
| Price | `text-2xl sm:text-3xl md:text-4xl font-bold text-ink tabular-nums` (24 → 30 → 36 px) |
| Compare-at | `text-base sm:text-lg font-medium text-ink-muted line-through tabular-nums` |
| `CAD` | `text-sm sm:text-base font-medium text-ink-muted` |
| Save | `text-sm sm:text-base font-semibold text-emerald-600 tabular-nums`, text `Save $X.XX (Y%)` |
| Sub-line | `mt-1 text-xs sm:text-sm text-ink-muted tabular-nums`, text `$X.XX per vial` + ` · N vials` when the size is > 1 |
| Quantity row | Only rendered when `siteConfig.ecommerceEnabled && selectedCap ≥ 1`. Layout: `mb-3 flex items-center gap-3`. Label "QUANTITY" uses the same style as the title. Stepper: `rounded-xl border border-line bg-surface overflow-hidden`. Buttons `px-3.5 py-2 … hover:bg-white disabled:opacity-40` with `−` and `+` (aria-labels "Decrease quantity" / "Increase quantity"). Value: `min-w-[2.5rem] text-center font-semibold`. **`+` is limited to `selectedCap`** (packs in stock). When qty > 1 a `$total total` label appears (`text-sm font-semibold text-ink`). |
| Add to Cart | `flex-1 font-semibold py-3 sm:py-4 rounded-xl text-sm flex items-center justify-center gap-2 disabled:opacity-50`. Normal: `bg-ink hover:bg-ink/90 text-white`, `ShoppingCart` icon, text **`Add to Cart · {pack label} - ${lineTotal}`**. Added: `bg-emerald-500`, `Check` icon, "Added to cart". Disabled when `selectedCap < 1`. |
| Out of stock (`stock_quantity === 0`) | `bg-surface text-red-600 border border-red-200 cursor-not-allowed`, text "Out of Stock" |
| Price 0 | The picker and headline are replaced by a large `N/A` (`text-2xl sm:text-3xl md:text-4xl font-bold text-ink-muted`). The button reads "Currently Unavailable" (`text-ink-muted border-line`). |

**Hero image coupling:** `<img key={heroImage}>` remounts when the image changes. The alt text is `"{name} — {label lowercased}"` for packs > 1. When `stock_quantity === 0` the image gets `opacity-40` and a centred "Out of Stock" pill is overlaid.

**Motion:** the info column fades in (framer-motion `opacity 0 → 1`, `y 20 → 0`, 0.4 s, 0.1 s delay). Pack buttons use the CSS `transition-all` only, with no motion variants.

### 4.5 Admin: "Pack options & pricing" (product modal)

- Heading: `block text-sm font-medium text-ink mb-2`, text "Pack options & pricing".
- **Size toggles:** `flex flex-wrap gap-2`. Each toggle is `px-4 py-2 rounded-lg border text-sm font-semibold`.
  - On: `border-teal bg-teal/10 text-teal-dark`.
  - Off: `border-line bg-surface text-ink-muted hover:border-teal/40 hover:text-ink`.
  - Labels: `1 vial`, `N-pack`.
  - **Use default**: `px-3 py-2 rounded-lg border border-line bg-white text-xs font-medium text-ink-muted`.
- **Empty state:** an `11px` muted note: *"No options set — the storefront offers the default pair: a single vial plus one full case of {vialsPerBox}, each priced at the vial price × its size."*
- **Table:** wrapper `mt-3 overflow-hidden rounded-xl border border-line`. Header row `bg-surface text-[11px] uppercase tracking-wider text-ink-muted`. Columns: **On · Pack · Button label · Tag (w-40) · Price (w-28) · Compare at (w-28) · Customer sees**. Body rows are `align-top` with `divide-y divide-line/60`: `bg-white` when on, `bg-surface/60` when off (switch styling in §3.6a).
- **Inputs:** `w-full px-2.5 py-1.5 bg-white border border-line rounded-lg text-ink text-sm tabular-nums focus:ring-2 focus:ring-teal/40`. Price inputs use `inputMode="decimal"`.
- **Tag presets** under the input: `rounded-full border px-2 py-0.5 text-[10px] font-semibold`. On: teal. Off: `border-line bg-surface text-ink-muted`.
- **"Customer sees" preview** (11 px, muted):
  - "Hidden from storefront" with an `EyeOff` icon when the pack is off,
  - the tag as a Vital Blue chip (`bg-teal-dark text-white text-[10px] uppercase rounded-full`), the same colour as the storefront chip.
  - the bold price plus a struck compare-at,
  - `$X / vial`,
  - a savings pill `bg-emerald-50 text-emerald-700` with the lucide `Tag` icon.
- **Footer help text** explains switching a pack off, Tag, a blank Price ("follows the product price automatically") and how Compare at falls back.

### 4.6 Admin: bulk dialog

- Overlay: `fixed inset-0 z-[70] bg-black/50 p-4`. Panel: `max-w-4xl max-h-[90vh] rounded-2xl bg-white shadow-xl`.
- Header: a teal `Boxes` icon tile (`h-9 w-9 rounded-lg bg-teal/10`), the title "Pack options" and a subtitle.
- Body: `md:grid-cols-[1fr_300px]`.
  - **Left:** search, the category select, the status select and select-all, above a scrollable checkbox list. Each row shows the name, `SKU · N vials / case` and a size pill (teal when custom, `surface-2` when default).
  - **Right:** a "PACK SIZES" 4-column toggle grid (with a check icon when on), the "Other size…" input plus **Add**, a preview card, help text, a red error box, and the buttons **Apply to N products** (`bg-ink text-white`, spinner while saving) and **Reset selection to the default pack**.
- **Mobile:** the columns stack, with a bottom border between them instead of a side border.

---

## 5. Data flow & behavior

### 5.1 End-to-end

```
Admin form ──PATCH /api/admin/products/[id]──┐
Bulk dialog ──PATCH /api/admin/products/pack-sizes──┤──► products.pack_sizes / pack_options
Cell grid ──PATCH /api/admin/products/[id] {pack_sizes}─┘     (sizes-only edits reconcile pack_options)
                                                     │
                     ISR (≤ 5 min) + useLiveProduct refresh of pack_options
                                                     ▼
PDP: packOptionsFor(product) → picker → selectedPack → addItem × qty
                                                     ▼
Cart (localStorage): line id productId::pN, price = packPriceFor(...) (re-read on load / at checkout)
                                                     ▼
Checkout UI: "Pack of N × q  $price×q" ── POST {id, packSize, quantity: q×N} (no prices)
                                                     ▼
Server: isPackOffered? (409 if switched off) → packPriceFor(...) → SKU map (vial / case) → discounts
     → Stealth Health order + ledger (pack_size, list price) + pending invoice ("— Pack of N", charged price)
                                                     ▼
Emails (confirmation, admin alert, shipped): built from the invoice lines + ledger list prices
```

### 5.2 Rules (all verified in code)

1. **Precedence:** `pack_options` (enabled rows) → `pack_sizes` → `[1, vials_per_box]`.
2. **Price:** a fixed pack price wins. Otherwise the price is `vial price × size`. The vial price is the explicit `vial_price` if it's > 0, otherwise `price ÷ vials_per_box`.
3. **Automatic strike-through:** a pack priced below `vial × size` with no compare-at shows `vial × size` as compare-at. A compare-at that is ≤ the price is never shown.
4. **Empty means default.** In both columns, `NULL` and empty mean "not opted in". The product form stores `pack_options = NULL` when no override is typed.
5. **Sizes-only edits keep pricing.** The grid and the bulk dialog call `reconcilePackOptions`: surviving sizes keep their price, label, tag, compare-at and on/off; added sizes come in blank; removed sizes are dropped; if none left is on, all are switched back on. This prevents the storefront, which reads `pack_options` first, from selling a size that was removed.
6. **Stock is counted in vials.** You can buy `floor(stock ÷ size)` packs of a given size. A pack with 0 available is disabled, shows "Not enough stock" and **hides its tag**.
7. **Opening pack:** the 3-pack if it is buyable, otherwise the first buyable pack, otherwise the first pack. The PDP is the only place that prefers the 3-pack; the purchase modal opens on the smallest buyable pack.
8. **Quantity** means the number of the selected pack. It resets to 1 whenever the pack or the product changes.
9. **The picker is hidden** when there is only one pack. The headline still shows that pack's price, and Add to Cart still uses it.
10. **Cart lines** are unique per product and pack size. `unit` is `'case'` for any pack > 1, and `stock_quantity` on the line is in packs.
11. **The server never trusts client prices.** Checkout re-prices with `packPriceFor`, and the cart quotes the same figure (`refreshPrices`). (Price lists and per-customer overrides are not used with pack pricing; out of scope.)
12. **Fulfilment mapping:** size 1 → `puramass_sku_vial`, any size > 1 → `puramass_sku`. One unit per pack, at most 99 per line. A missing SKU returns a 409 that lists the affected lines.
13. **Permissions:** only `admin` can change packs. `analytics` can edit product copy, but the server strips pack fields from its requests and the form hides the editor. Every change is written to product history ("Pack options" / "Pack pricing"). Bulk edits are also audit-logged.
14. **Limits:** 8 packs per product, sizes 1–1000, labels up to 60 characters, tags up to 24 characters, 500 products per bulk request.
15. **Only packs on sale can be bought.** Checkout refuses a line whose pack is switched off, removed, or was never offered (`isPackOffered`), with a 409 listing it.
16. **On/off:** off packs keep their settings and are hidden everywhere the storefront sells. At least one pack stays on (UI and API).
17. **Tags** are display-only, shown on the product page and the purchase modal, hidden when the pack is sold out or off.
18. **Emails** show each pack at the price and quantity on the invoice written at hand-off, and their totals reconcile to the amount charged.

---

## 6. Edge cases & states

| State | PDP behavior |
|---|---|
| Product not found | `notFound()` → 404, before the client component renders |
| Legacy SKU slug | 308 redirect to `/products/{url_slug}` |
| Inactive product | Renders, with `robots: noindex, follow` |
| `price === 0` | Picker and headline hidden; "N/A"; button "Currently Unavailable" |
| `stock_quantity === 0` | Every pack disabled with "Not enough stock"; hero faded with an "Out of Stock" overlay; button "Out of Stock" |
| Stock covers small packs only | Large packs disabled; opening selection skips to a buyable pack |
| Exactly one pack | No picker; the headline uses that pack |
| No `box_image_url` | Hero keeps `image_url` for every pack |
| `ecommerceEnabled = false` | No quantity stepper and no Add to Cart; picker and prices still show |
| Live refresh fails | Server-rendered values are used without an error message; checkout re-checks |
| Cart line already at its limit | `addItem` returns false → toast "Only {cap} in stock — that's all we have." |
| Checkout: SKU missing for a pack form | 409, with `unmapped` labels such as "BPC-157 (pack of 3)" |
| Checkout: pack switched off / removed after it was added to the cart | 409, with `unavailable` labels such as "BPC-157 10mg (pack of 3)"; nothing is charged |
| Pack price changed after it was added to the cart | Cart and checkout re-price to the new figure on load; the charge and the emails use the same figure |
| Admin tries to switch off the last pack on sale | Switch disabled ("At least one pack has to stay on"); API returns 400 if forced |
| Admin: a pack-options column is missing from the DB | Bulk route returns "Pack options column is missing — run pack-options-content-migration.sql." or the `pack-option-pricing` equivalent |
| Admin: bulk save with no products or no sizes | Inline errors: "Select at least one product." / "Pick at least one pack size, or reset the selection to the default." |
| Admin: custom size invalid or over the cap | "A custom pack size has to be a whole number of vials." / "A product can offer at most 8 pack options." |

---

## 7. Open questions, gotchas & unverified items

**Decided:**

- **Price lists and per-customer overrides are out of scope.** Pack pricing is not used together with them. The checkout's override path (§3.11 step 4) is unchanged and is not part of this feature.

**Fixed in this change:**

- The cart and checkout no longer show a stale price: lines are re-priced from the catalog on load and when checkout opens, with the same function the server charges with.
- A pack can be switched off and back on without losing its settings (§3.6a). Checkout refuses a switched-off or removed pack instead of charging for it at vial × size.
- Tags now also show in the purchase modal, and the admin preview chip uses the storefront colour (§3.6b).
- The admin table chip and the bulk dialog's "custom" filter count either pack column, not just `pack_sizes`.
- A regression test checks that a mixed-pack, discounted order's email lines and totals match what was charged (§3.12).

**Still true (by design or not yet changed):**

1. **Custom button labels stop at the product page.** The cart, checkout, invoice, emails and order history always say `Pack of N` / `Single vial`. Tags are not shown there either (§3.6b).
2. **Compare-at and per-pack savings are not shown in the cart or checkout**, only `price × qty`. A pack's fixed price is its list price, so a pack discount does not appear as a Discount row in the email; only codes and offers do.
3. **The cell grid's pack column reads `pack_sizes` only.** It lists every configured size, including switched-off ones. On/off is only visible and editable in the product form.
4. **`useLiveProduct` only refreshes some fields.** It re-reads `pack_options` (so on/off, prices and tags update on the next page view) but not `pack_sizes` or `vials_per_box`, which take up to 5 minutes (ISR).
5. **The grid's "Set pack options" menu offers only 1/3/5/10.** Custom sizes need the dialog, the product form, or typing them into a cell.
6. **The default pack is hard-coded** (`DEFAULT_PACK_SIZE = 3`). Tagging a pack does not make it the default.
7. **GA4 tracks the vial, not the pack.** `view_item` is always sent with `item_variant: 'Vial'` at the vial price.
8. **The `CAD` suffix is hard-coded** on the product page headline. USD prices are not used in the pack picker.
9. **A switched-off pack already in a cart is only caught at checkout.** The cart page still lists it (at its saved price) until the shopper tries to pay.

**Not verified / outside the examined files:**

- How PuraMass / Stealth Health shows multi-pack lines on its hosted payment page. Only the `{ sku, quantity, unit_price_cents }` sent to it was examined.
- Server-side stock enforcement at checkout. The product page limits by stock, but that checkout code path was not traced.
- Emails for orders that did not go through the hosted checkout (manual invoices, legacy storefront orders) build their lines from what the admin typed on the invoice, not from pack settings.
