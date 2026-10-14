# 04 — Content & marketing surfaces (VYTA → Aminocan port)

Scope: features that exist in `vyta-rtl-x` and not in `aminocan-cad`. These are the CMS (block documents, articles, editable site pages), the `/partners` page, off-site promo landing pages, and the small storefront diffs (contact, lab results, terms, chat, journey tracker, ad notice).

Everything below was read from source. Anything I could not confirm is listed under **Open questions**.

---

## 0. Shared conventions for this section

### 0.1 Design token map (VYTA → Aminocan)

VYTA tokens come from `vyta-rtl-x/tailwind.config.ts` and `app/globals.css`. Aminocan tokens come from `aminocan-cad/tailwind.config.ts`.

| VYTA class | VYTA resolved | Aminocan equivalent (semantic) | Aminocan resolved |
|---|---|---|---|
| `text-ink` / `bg-ink` / `border-ink` | `#07203A` | `ink` | `#1A1A1A` |
| `text-ink-muted` | `#56707F` | `ink-muted` | `#6E6E6E` |
| `text-ink-light` | `#6E8898` | `ink-light` | `#8A8A8A` |
| `bg-surface` | `#F7FAFB` | `surface` | `#F7F7F7` |
| `bg-surface-2` | `#EDF3F5` | `surface-2` | `#F2F2F2` |
| `border-line` / `bg-line` | `#DCE7EB` | `line` | `#C9CCD1` |
| `text-teal` / `border-teal` / `marker:text-teal` | `#438B9E` | `bronze` | `#9C8B5A` |
| `text-teal-dark` | `#1B5D83` | `bronze-dark` | `#7D6F48` |
| `text-teal-light` | `#6EB2B8` | `bronze-light` | `#B8A876` |
| `bg-teal-50` | `#F1F8F9` | `bronze-50` | `#FAF8F3` |
| `bg-teal-100` | `#E1EFF1` | `bronze-100` | `#F2EEE3` |
| `border-teal-200` | `#C4DFE3` | `primary-200` | `#E5DCC7` |
| `bg-navy` (video frame) | `#07203A` | `ink` | `#1A1A1A` |
| `ring-teal/40`, `ring-teal/30` | `#438B9E` at 40% / 30% | `ring-bronze/40`, `ring-bronze/30` | — |
| `bg-brand-gradient` | `linear-gradient(135deg,#07203A 0%,#0E3F5F 45%,#438B9E 100%)` | Aminocan dark surfaces use `bg-ink` (Hero, Footer, contact CTA) | `#1A1A1A` |
| `bg-brand-gradient-soft` | `linear-gradient(135deg,#F1F8F9 0%,#E1EFF1 50%,#FFFFFF 100%)` | No token. Use `bg-gradient-to-br from-bronze-50 via-bronze-100 to-white`, or add a token | — |
| `bg-brand-rule` (1px hairline, `opacity-50` / `opacity-40`) | `linear-gradient(90deg,#07203A 0%,#1B5D83 50%,#6EB2B8 100%)` | No token. Use `bg-line`, or add `brand-rule: linear-gradient(90deg,#1A1A1A,#7D6F48,#B8A876)` | — |
| `shadow-card` | `0 1px 2px rgba(7,32,58,.04), 0 8px 24px -12px rgba(7,32,58,.10)` | No token. Add `card`/`card-hover` to `boxShadow` (neutral rgba(26,26,26,…)) or use `shadow-sm` | — |
| `shadow-card-hover` | `0 2px 4px rgba(7,32,58,.05), 0 16px 40px -16px rgba(7,32,58,.16)` | same as above / `shadow-md` | — |
| `.font-display` | Inter, `font-variation-settings:'opsz' 32`, `letter-spacing:-0.02em` | No equivalent. Aminocan `sans` is the system stack (SF Pro). Add `.font-display { letter-spacing:-0.02em }` utility in `globals.css`, or drop the class | — |
| `rounded-xl` | **14px** (0.875rem, overridden) | `rounded-xl` | 12px (Tailwind default) |
| `rounded-2xl` | **18px** (1.125rem, overridden) | `rounded-2xl` | 16px (default) |
| `rounded-3xl` | 24px | `rounded-3xl` | 24px |

Tailwind defaults used verbatim (same in both repos):

| Class | Hex |
|---|---|
| `emerald-50` | `#ECFDF5` |
| `emerald-100` | `#D1FAE5` |
| `emerald-200` | `#A7F3D0` |
| `emerald-500` | `#10B981` |
| `emerald-600` | `#059669` |
| `emerald-700` | `#047857` |
| `amber-50` | `#FFFBEB` |
| `amber-100` | `#FEF3C7` |
| `amber-200` | `#FDE68A` |
| `amber-300` | `#FCD34D` |
| `amber-400` | `#FBBF24` |
| `amber-500` | `#F59E0B` |
| `amber-600` | `#D97706` |
| `amber-700` | `#B45309` |
| `amber-800` | `#92400E` |
| `violet-50` | `#F5F3FF` |
| `violet-200` | `#DDD6FE` |
| `violet-600` | `#7C3AED` |
| `red-50` | `#FEF2F2` |
| `red-200` | `#FECACA` |
| `red-600` | `#DC2626` |
| `red-700` | `#B91C1C` |
| `gray-100` | `#F3F4F6` |

The SERP preview title uses the literal `text-[#1a0dab]`.

### 0.2 Helper prerequisites in aminocan-cad (all verified)

- **Already present and usable unchanged:**
  - `getSupabase()` (service role) and `supabase` (anon) in `lib/supabase.ts`.
  - `logAuditServer(db, {actor_id, actor_email}, {action, entity_type, entity_id})` in `lib/admin/audit.ts`. Its signature is identical in both repos.
  - `checkRateLimit` / `getClientIp` in `lib/rate-limit.ts`.
  - `sendMail` in `lib/smtp.ts`.
  - `escapeHtml` in `lib/email.ts`.
  - `SITE_URL` in `lib/config.ts` (`https://www.aminocan.com`).
  - `resolveStaffCaller(db, req, {allowAssistant})` in `lib/affiliate/route-auth.ts`.
  - `useUserRole` exported from `app/(admin)/admin/layout.tsx`.
  - `after` from `next/server` (Next 15.5.4 in both repos).
- **Needs a change in aminocan-cad:**
  - **`lib/api-fetch.ts` must stop forcing `Content-Type: application/json` on `FormData` bodies.** The content image upload depends on it. VYTA added `browserSetsContentType(body)`, which returns true for FormData, Blob and URLSearchParams, and then omits the default header. Without it, `request.formData()` throws on the server.
  - **`canManageContent(role)` is missing from `lib/permissions.ts` and `lib/hooks/usePermissions.ts`.** VYTA defines it as `role === 'admin' || role === 'analytics'`. Add the four content hrefs (`/admin/announcements`, `/admin/testimonials`, `/admin/pages`, `/admin/articles`) to `ANALYTICS_PAGES` so the analytics role sees them.
  - **The email shell is named differently.** VYTA's `vytaShell(inner)` maps to aminocan's `aminocanShell(inner)` in `lib/email.ts`.
  - **There is no `components/admin/affiliates/*` in aminocan.** VYTA's `adminFetch` and `CodeRestrictionsFields` do not exist there. Aminocan's restriction UI (first-order-only plus excluded products with the bac-water shortcut) is inline in `app/(admin)/admin/discount-codes/_components/DiscountCodeModal.tsx`.
  - **The discount-code library lives elsewhere.** VYTA's `lib/affiliate/discount-codes.ts` maps to aminocan's `lib/promos/discount-codes.ts` (`shapeDiscountCodeRow`, `lookupDiscountCode`, `firstOrderRejection`, `REJECTION_MESSAGES`) plus `lib/promos/discount-codes-admin.ts`. Note that `shapeDiscountCodeInput(body, partial)` has a different signature from VYTA's `shapeDiscountCodeInput(body)`. Also, aminocan's code row has `description` where VYTA has `notes`.

---

## 1. CMS: content-block documents, articles, editable site pages

### What's new vs aminocan-cad

Aminocan has none of the following:
- `/about`, `/articles`, `/articles/[slug]` and `/p/[slug]`.
- The `site_pages` and `articles` tables.
- The block editor and the content image upload.

Its `Navigation` "Company" dropdown shows **About Us — Coming Soon** and **Certifications — Coming Soon** as disabled rows. VYTA replaces them with live **About Us** ("Who we are") and **Articles** ("Research & guides") links. Aminocan's Footer has no Articles or About links.

Aminocan does have `components/content/RichText.tsx`, used for product copy; the diff is in §1.6.

### Files (VYTA)

| Area | Files |
|---|---|
| Storefront | `app/about/page.tsx`, `app/articles/page.tsx`, `app/articles/[slug]/page.tsx`, `app/p/[slug]/page.tsx`, `app/sitemap.ts` |
| Components | `components/content/BlockRenderer.tsx`, `RichText.tsx`, `ArticleCard.tsx`, `ArticleIndex.tsx`, `SitePageView.tsx` |
| Lib | `lib/content/blocks.ts`, `articles.ts`, `articles-server.ts`, `pages.ts`, `pages-server.ts`, `lib/admin/content-auth.ts` |
| Public API | `app/api/articles/route.ts`, `app/api/site-pages/[slug]/route.ts` |
| Admin API | `app/api/admin/articles/route.ts`, `app/api/admin/articles/[id]/route.ts`, `app/api/admin/site-pages/route.ts`, `app/api/admin/site-pages/[slug]/route.ts`, `app/api/admin/content/upload/route.ts` |
| Admin UI | `app/(admin)/admin/articles/page.tsx`, `app/(admin)/admin/articles/[id]/page.tsx`, `app/(admin)/admin/pages/page.tsx`, `app/(admin)/admin/pages/[slug]/page.tsx`, `components/admin/content/BlockEditor.tsx`, `ContentPreview.tsx`, `ImageField.tsx`, `RichTextField.tsx` |
| SQL | `pack-options-content-migration.sql`, sections 3 (`site_pages`) and 4 (`articles`). Section 1 (`products.pack_sizes`) and section 2 (`announcements`) belong to other features. |

### Database (verbatim from `pack-options-content-migration.sql`)

```sql
CREATE TABLE IF NOT EXISTS site_pages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  title           text NOT NULL,
  subtitle        text,
  hero_image_url  text,
  blocks          jsonb NOT NULL DEFAULT '[]'::jsonb,
  seo_title       text,
  seo_description text,
  published       boolean NOT NULL DEFAULT false,  -- the storefront toggle
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_site_pages_published ON site_pages (published);
CREATE OR REPLACE FUNCTION update_site_pages_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS site_pages_updated_at ON site_pages;
CREATE TRIGGER site_pages_updated_at BEFORE UPDATE ON site_pages
  FOR EACH ROW EXECUTE FUNCTION update_site_pages_updated_at();
ALTER TABLE site_pages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Site pages are viewable by everyone" ON site_pages;
CREATE POLICY "Site pages are viewable by everyone" ON site_pages FOR SELECT USING (true);
-- Seed (ON CONFLICT (slug) DO NOTHING): slug 'about', published true, 6 blocks
-- (heading "Who we are", paragraph, heading "What we stand for", bullet list x4,
-- info callout "Research use only", cta "Contact us" -> /contact). Brand content — replace.

CREATE TABLE IF NOT EXISTS articles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE,
  title            text NOT NULL,
  excerpt          text,
  cover_image_url  text,
  author           text,
  category         text,
  tags             text[] NOT NULL DEFAULT '{}',
  blocks           jsonb NOT NULL DEFAULT '[]'::jsonb,
  status           text NOT NULL DEFAULT 'draft',   -- 'draft' | 'published'
  featured         boolean NOT NULL DEFAULT false,
  reading_minutes  integer NOT NULL DEFAULT 1,
  seo_title        text,
  seo_description  text,
  published_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- CHECK constraint articles_status_chk: status IN ('draft','published') (added in a DO $$ guard)
CREATE INDEX IF NOT EXISTS idx_articles_status    ON articles (status);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_featured  ON articles (featured);
-- update_articles_updated_at() trigger, same shape as site_pages
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Articles are viewable by everyone" ON articles FOR SELECT USING (true);
```

How the columns are used:
- **Storefront reads** go through the service-role `getSupabase()`. They filter `published = true` on `site_pages`, and `status = 'published'` plus `published_at <= now` (in JS) on `articles`.
- **Writes** go only through admin API routes using the service role.
- **Images** are stored in the existing **`products` storage bucket** under the `content/` prefix. No new bucket is needed. Aminocan uses the `products` bucket for product images too (`app/api/admin/products/upload/route.ts`).
- **`ARTICLE_SUMMARY_COLUMNS`** is every column except `blocks`: `id, slug, title, excerpt, cover_image_url, author, category, tags, status, featured, reading_minutes, seo_title, seo_description, published_at, created_at, updated_at`.

### 1.1 Block document model (`lib/content/blocks.ts`)

A document is an ordered JSON array. Every block has `{id: string, type}`. Text fields are plain strings that use the inline syntax `**bold**`, `*italic*`, `` `code` `` and `[label](url)`. They are rendered by parsing to React nodes and are never injected as HTML.

| type | fields (defaults from `createBlock`) | prune-on-save rule (dropped when…) |
|---|---|---|
| `heading` | `level: 2\|3` (2), `text` | text blank |
| `paragraph` | `text`, `lead?: boolean` | text blank |
| `image` | `url`, `alt`, `caption`, `width: 'full'\|'wide'\|'inline'` (`'wide'`) | url empty |
| `gallery` | `images: {url,alt,caption}[]` (1 empty), `columns: 2\|3` (3) | no image has a url |
| `quote` | `text`, `attribution` | text blank |
| `list` | `style: 'bullet'\|'number'` (bullet), `items: string[]` (`['']`) | no non-blank item |
| `callout` | `tone: 'info'\|'success'\|'warning'\|'tip'` (info), `title`, `text` | title and text both blank |
| `cta` | `text`, `button_label`, `button_url` | text and label both blank |
| `stats` | `items: {value,label}[]` (2 empty) | no item has a value |
| `video` | `url` (YouTube/Vimeo share URL), `caption` | url empty |
| `divider` | — | never dropped |

Functions to port verbatim:
- **`newBlockId()`** returns `` `b${Date.now().toString(36)}${random5}` ``.
- **`normalizeBlocks(raw)`** drops unknown types and defaults every field. It coerces `level` to 3 only when it is exactly 3, `width` to `'wide'` unless it is `full` or `inline`, `columns` to 2 only when it is exactly 2, and `tone` to `'info'` unless it is a known tone. It trims url fields, filters blank list items, and re-keys duplicate ids. It is applied on every read.
- **`pruneEmptyBlocks`** is applied on every save.
- **`stripInline`**, **`blocksPlainText`** and **`excerptFromBlocks(blocks, max=180)`**: the excerpt cuts on a word boundary when the last space is past 60% of `max`, then appends `…`.
- **`readingMinutes`** is words ÷ 200, rounded, with a minimum of 1. **`wordCount`** counts words.
- **`safeUrl(raw)`** allows `/…`, `#…`, `http(s)://`, `mailto:` and `tel:`. Anything else returns `''`.
- **`videoEmbedUrl(raw)`** converts:
  - `youtu.be/ID` → `https://www.youtube.com/embed/ID`
  - `youtube.com` or `m.youtube.com` `?v=ID` (or `/embed/…` kept as-is) → `https://www.youtube.com/embed/ID`
  - `vimeo.com/<digits>` → `https://player.vimeo.com/video/<id>`
  - `player.vimeo.com` → passed through
  - anything else → `''`
- **`slugify(input)`** lowercases, NFKD-normalizes, strips diacritics, collapses `[^a-z0-9]+` to `-`, trims dashes, and caps at 80 characters.
- **`BLOCK_LIBRARY`** is the palette order with label, hint and Lucide icon:
  - Heading / "Section title" / `Heading2`
  - Text / "A paragraph of copy" / `Type`
  - Image / "Upload or paste an image URL" / `Image`
  - Gallery / "A row of images" / `Images`
  - List / "Bulleted or numbered points" / `List`
  - Quote / "A pull quote with attribution" / `Quote`
  - Callout / "A highlighted note or warning" / `Info`
  - Stats / "Big numbers with labels" / `BarChart3`
  - Call to action / "A line of copy and a button" / `MousePointerClick`
  - Video / "Embed a YouTube or Vimeo clip" / `Video`
  - Divider / "A horizontal rule" / `Minus`

### 1.2 BlockRenderer (`components/content/BlockRenderer.tsx`, `'use client'`)

Props: `{ blocks: ContentBlock[]; className?: string }`. It returns `null` when empty. Otherwise it renders `<div className={className}>` and maps each block with `key=block.id` to `<BlockView block/>`, which is also exported. The same renderer runs the storefront and the admin preview.

| Block | Exact markup / classes (VYTA) |
|---|---|
| heading level 2 | `<h2 class="font-display text-2xl sm:text-3xl font-bold text-ink mt-12 mb-4 scroll-mt-32">` → 24px/30px, mt 48px, mb 16px |
| heading level 3 | `<h3 class="font-display text-lg sm:text-xl font-semibold text-ink mt-8 mb-3">` → 18px/20px |
| paragraph | `<RichText className="my-5">` with paragraphClassName `text-[15px] sm:text-base text-ink/90 leading-[1.75]`. Lead variant: `text-lg sm:text-xl text-ink-muted leading-relaxed` |
| image | `<figure class="my-8 {width}">` where full=`lg:-mx-24 xl:-mx-32`, wide=`lg:-mx-10`, inline=`max-w-md mx-auto`. Inner `<div class="overflow-hidden rounded-xl border border-line bg-surface">` holding `<img class="w-full h-auto block" loading="lazy">`. Caption: `<figcaption class="mt-2.5 text-xs text-ink-muted text-center">` |
| gallery | `<div class="my-8 grid gap-4 sm:grid-cols-2|sm:grid-cols-3">`. Each item is `<figure>` with `<div class="aspect-[4/3] overflow-hidden rounded-xl border border-line bg-surface">` holding `<img class="w-full h-full object-cover">`. Caption `mt-2 text-xs text-ink-muted`. Images without a url are filtered out |
| quote | `<figure class="my-9 border-l-[3px] border-teal pl-5 sm:pl-6">` (3px #438B9E). `<blockquote class="font-display text-xl sm:text-2xl leading-snug text-ink">`. Attribution: `<figcaption class="mt-3 text-sm text-ink-muted">— {attribution}` |
| list | `<ul>` or `<ol>` with `class="my-6 space-y-2.5 text-[15px] sm:text-base text-ink/90 leading-relaxed list-disc|list-decimal pl-5 marker:text-teal"`; each `<li class="pl-1">` |
| callout | `<aside class="my-8 flex gap-3.5 rounded-xl border p-4 sm:p-5 {tone}">` plus icon `w-5 h-5 flex-shrink-0 mt-0.5`. Title `<p class="font-semibold text-ink text-sm mb-1">`; body RichText `text-sm text-ink/80 leading-relaxed`. Tones: info=`bg-teal-50 border-teal-200` + `Info` in `text-teal-dark`; success=`bg-emerald-50 border-emerald-200` + `CheckCircle2` in `text-emerald-600`; warning=`bg-amber-50 border-amber-200` + `AlertTriangle` in `text-amber-600`; tip=`bg-violet-50 border-violet-200` + `Lightbulb` in `text-violet-600` |
| cta | `<div class="my-10 rounded-2xl border border-line bg-surface p-6 sm:p-8 text-center">`; copy RichText `mb-5` with `text-base sm:text-lg text-ink leading-relaxed`. Button `inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-ink text-white text-sm font-semibold hover:bg-ink/90 transition-colors` plus `ArrowRight w-4 h-4`. Relative or `#` URLs use `next/link`; external URLs use `<a target=_blank rel="noopener noreferrer">`; an unsafe URL renders a `<span>` with `opacity-50` |
| stats | `<div class="my-9 grid gap-4 …">`: ≥4 items `grid-cols-2 lg:grid-cols-4`, 3 items `grid-cols-1 sm:grid-cols-3`, else `grid-cols-1 sm:grid-cols-2`. Tile `rounded-xl border border-line bg-white p-5 text-center`; value `font-display text-3xl font-bold text-ink tabular-nums`; label `mt-1 text-xs uppercase tracking-wider text-ink-muted` |
| video | `<figure class="my-8 lg:-mx-10">` → `<div class="aspect-video overflow-hidden rounded-xl border border-line bg-navy">` → `<iframe class="w-full h-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen title={caption||'Embedded video'}>`. Unrecognised URL: `<div class="my-8 rounded-xl border border-dashed border-line bg-surface p-5 text-sm text-ink-muted text-center">Video URL isn’t a recognised YouTube or Vimeo link.</div>` |
| divider | `<hr class="my-10 border-0 h-px bg-brand-rule opacity-40">` |

### 1.3 Storefront pages

All four routes are server components with `export const revalidate = 60` (ISR). They use the react `cache()`-wrapped readers, so `generateMetadata` and the page body share one query. Readers never throw: a missing table resolves to `[]` or `null`.

**`/about` (`app/about/page.tsx`)**
- Reads `getPublishedPage('about') ?? FALLBACK_ABOUT_PAGE`, so it **never 404s**. The fallback is a hard-coded `SitePage` in `lib/content/pages.ts` with a lead paragraph, a bullet list and an info callout (brand content — replace).
- Metadata title: `${seo_title||title} | VYTA`.
- Metadata description: `seo_description || subtitle || excerptFromBlocks(blocks,160)`.
- OG: `type:'website'`, plus `images:[hero_image_url]` when set.
- Renders `<SitePageView page/>`.

**`/p/[slug]` (`app/p/[slug]/page.tsx`)** uses the same metadata. It calls `notFound()` when the page is missing or unpublished.

**`SitePageView` (`'use client'`, props `{page: SitePage}`)**
- Wrapper: `<main class="min-h-screen bg-white">` containing `<Navigation/>`, `<article class="pt-32 pb-16 sm:pt-36 sm:pb-20 md:pt-44 md:pb-28">` and `<Footer/>`.
- Top padding is 128 / 144 / 176px and clears the fixed nav. Bottom padding is 64 / 80 / 112px.
- Column: `mx-auto max-w-3xl px-5 sm:px-8 lg:px-12` (768px max; 20 / 32 / 48px gutters).
- Header `mb-10`:
  - h1 `font-display text-3xl font-bold leading-tight text-ink sm:text-4xl md:text-5xl` (30 / 36 / 48px).
  - Subtitle `mt-4 text-lg leading-relaxed text-ink-muted sm:text-xl`.
  - Rule `mt-7 h-px bg-brand-rule opacity-50`.
- Hero image: `mb-10 overflow-hidden rounded-2xl border border-line bg-surface lg:-mx-10` holding `<img class="block h-auto w-full" alt="">`.
- Then `<BlockRenderer/>`.

**`/articles` (`app/articles/page.tsx`)**
- Static metadata (brand content — replace):
  - title `Articles | VYTA Biosciences`
  - description "Research notes, handling guides and analysis from VYTA Biosciences — written for the people actually running the experiments."
  - OG to match
- Layout:
  - Same `main` wrapper; inner `pt-32 pb-16 sm:pt-36 sm:pb-20 md:pt-44 md:pb-28`; column `mx-auto max-w-6xl px-5 sm:px-8 lg:px-12` (1152px).
  - Header `mb-10`:
    - Eyebrow `mb-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-teal-dark` reading "VYTA Biosciences".
    - h1 "Articles", same scale as SitePageView.
    - Lede `mt-4 max-w-2xl text-base leading-relaxed text-ink-muted sm:text-lg`.
    - Rule `mt-7 h-px bg-brand-rule opacity-50`.
  - Then `<ArticleIndex articles/>`.
- Data: `getPublishedArticles()` selects `ARTICLE_SUMMARY_COLUMNS` where `status='published'`, `limit 200`. It filters with `isArticleLive` (status published AND (`published_at` null OR ≤ now)) and sorts with `sortArticles` (featured first, then `published_at||created_at` descending).

**`ArticleIndex` (`'use client'`, `{articles: ArticleSummary[]}`)**
- State: `query`, `tag`. Filtering is client-side only.
- Search matches `title`, `excerpt`, `category` and `tags`, case-insensitively.
- Tag chips are built from tag counts, sorted by count descending then name.
- **Empty library:** `rounded-2xl border border-dashed border-line bg-surface p-12 text-center` with `Newspaper h-7 w-7`, "No articles yet" and "Check back soon — we’re writing."
- **Search box:** wrapper `mb-8 flex flex-col gap-3 sm:flex-row sm:items-center`. Input `w-full rounded-xl border border-line bg-surface py-3 pl-11 pr-4 text-sm text-ink placeholder-ink-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-teal/40` with a `Search` icon `absolute left-4 h-4 w-4`. Placeholder "Search articles…".
- **Chips:** row `mb-8 flex flex-wrap gap-2`. Each chip is `rounded-full border px-3 py-1.5 text-xs font-medium`. Active: `border-ink bg-ink text-white`. Idle: `border-line bg-white text-ink-muted hover:border-teal/40 hover:text-ink`. The count renders as `<span class="ml-1.5 opacity-60">`. "All" clears the filter; clicking the active chip toggles it off.
- **Lead card:** shown only when there is no query, no tag, `filtered.length > 2` and `filtered[0].featured`. It renders `<ArticleCard featured/>` in `mb-6`.
- **Grid:** `grid gap-6 sm:grid-cols-2 lg:grid-cols-3`.
- **No match:** dashed box with "Nothing matches that. Try a different search or clear the filters."

**`ArticleCard` (`'use client'`, `{article: ArticleSummary; featured?: boolean}`)**
- Links to `/articles/{slug}`.
- **Meta row:** `flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-muted`. It contains a category pill (`rounded-full bg-teal-50 px-2 py-0.5 font-semibold uppercase tracking-wider text-teal-dark`), the date (`toLocaleDateString('en-CA',{year:'numeric',month:'long',day:'numeric'})`), `·`, and `Clock h-3 w-3` with "N min read".
- **Cover:** `<img loading=lazy class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]">`. Without a cover it shows a placeholder `bg-brand-gradient-soft` with `<span class="font-display text-2xl font-bold text-teal-dark/30">VYTA</span>` (brand content — replace).
- **Standard card:**
  - Container `group flex flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-card transition-shadow hover:shadow-card-hover`.
  - Cover box `aspect-[16/10]`; body `p-5`.
  - h3 `mt-2.5 font-display text-base font-bold leading-snug text-ink group-hover:text-teal-dark`.
  - Excerpt `mt-2 line-clamp-3 text-sm leading-relaxed text-ink-muted`. It shows only an explicit `excerpt`; no derived excerpt on cards.
- **Featured card:**
  - Container `group grid … sm:grid-cols-2`.
  - Cover `aspect-[16/10] sm:aspect-auto sm:h-full`; body `flex flex-col justify-center p-6 sm:p-8`.
  - h2 `mt-3 font-display text-xl font-bold … sm:text-2xl`.

**`/articles/[slug]` (`app/articles/[slug]/page.tsx`)**
- **Metadata:**
  - title `${seo_title||title} | VYTA`
  - description `seo_description || articleExcerpt(article,160)`
  - `authors`, `alternates.canonical:/articles/{slug}`
  - OG `type:'article'` with `publishedTime`, `modifiedTime`, `tags` and images when a cover exists
  - Twitter `summary_large_image` when a cover exists, else `summary`
  - Not found: `{title:'Article not found | VYTA'}`
- **JSON-LD** `<script type="application/ld+json">`: `@type: Article`, `headline`, `description`, `image[]`, `author[{@type:Person,name}]`, `publisher{@type:Organization,name:'VYTA Biosciences'}` (brand content — replace), `datePublished`, `dateModified`, `keywords` (tags joined with ", ").
- **Layout:**
  - `<article class="pt-32 pb-16 sm:pt-36 sm:pb-20 md:pt-44 md:pb-24">` with column `max-w-3xl`.
  - Back link `mb-7 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink` with `ArrowLeft h-4 w-4` and "All articles".
  - Meta row `gap-x-2.5 text-[11px]` with category pill (`px-2.5`), date, clock + "N min read", and "· author".
  - h1 `mt-4` at the same scale.
  - Excerpt `mt-4 text-lg leading-relaxed text-ink-muted`.
  - Rule `mt-7 h-px bg-brand-rule opacity-50`.
  - Cover `mt-8 overflow-hidden rounded-2xl border border-line bg-surface lg:-mx-10`.
  - `<BlockRenderer className="mt-2"/>`.
  - Tags block `mt-12 flex flex-wrap gap-2 border-t border-line pt-6`. Each tag links to `/articles?tag=…` with `rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-muted hover:border-teal/40 hover:text-ink`.
  - "Read next" aside `mt-16 border-t border-line bg-surface/60 py-12` with a `max-w-6xl` inner column, h2 `mb-6 font-display text-xl font-bold`, and grid `gap-6 sm:grid-cols-2 lg:grid-cols-3` of up to three cards.
- **Related articles** (`getRelatedArticles(article, 3)`): same category or any shared tag first, then the newest, excluding self.

**`app/sitemap.ts` (diff vs aminocan)**
- `revalidate = 3600`.
- `STATIC_ROUTES` with priority and changeFrequency:
  - `''` 1.0 daily
  - `/products` 0.9 daily
  - `/articles` 0.7 weekly
  - `/lab-results` 0.7 weekly
  - `/about` 0.5 monthly
  - `/contact` 0.5 monthly
  - `/partners` 0.5 monthly
  - `/terms` 0.3 yearly
- Products at 0.8 daily; articles at 0.6 monthly (`lastModified = updated_at||published_at`); pages from `getPublishedPageSlugs()` (which excludes system slug `about`) at `/p/{slug}`, 0.4 monthly.
- Aminocan's sitemap lists only `'', /products, /lab-results, /contact, /terms` plus products, with no priorities.

### API routes

| Method · Path | Auth | Request | Response | Cache / notes |
|---|---|---|---|---|
| GET `/api/articles` | public | `?tag=&category=&limit=` (default 50, max 100) | `{articles: ArticleSummary[]}`. Errors return `{articles:[]}` with 200 | No explicit cache header. `tags @> [tag]` via `.contains` |
| GET `/api/site-pages/[slug]` | public | — | `{page: SitePage}` or 404 `{error:'Page not found'}` | published only |
| GET `/api/admin/articles` | `requireContentEditor` → 403 `{error:'Unauthorized'}` | — | `{articles: ArticleSummary[]}`, `created_at` descending, drafts included | — |
| POST `/api/admin/articles` | content editor | `{title, slug?, author?}` | 201 `{article}`. Always `status:'draft'`, `blocks:[]`; `author` defaults to the actor's email. Slug is `slugify(slug||title)` with `-2`, `-3`… dedupe via `like 'base%'` | 400 "An article needs a title" / "That title has no letters or numbers to build a URL from". Audit `article.create` |
| GET `/api/admin/articles/[id]` | content editor | — | `{article}` (full, with blocks) | 404 "Article not found" |
| PATCH `/api/admin/articles/[id]` | content editor | Any subset of `title, slug, excerpt, cover_image_url, author, category, seo_title, seo_description` (blank → null), `tags` (array or CSV → `normalizeTags`: trim, case-insensitive dedupe, max 12), `featured`, `blocks` (normalize + prune; also recomputes `reading_minutes` server-side), `status`, `published_at` | `{article}` | Slug clash → 409 "Another article already uses /{slug}". First publish stamps `published_at=now` only if it is null. An explicit `published_at` wins (backdate or schedule). Audit `article.publish` / `article.unpublish` / `article.update` |
| DELETE `/api/admin/articles/[id]` | content editor | — | `{success:true}` | Audit `article.delete` |
| GET `/api/admin/site-pages` | content editor | — | `{pages: SitePage[]}`, ordered by slug | — |
| POST `/api/admin/site-pages` | content editor | `{title, slug?, subtitle?, blocks?}` | 201 `{page}` with `published:false` | 409 "A page already uses /{slug}". Audit `site_page.create` |
| GET `/api/admin/site-pages/[slug]` | content editor | — | `{page}`. A missing system page returns `{page: FALLBACK_ABOUT_PAGE, missing:true}` | — |
| PUT `/api/admin/site-pages/[slug]` | content editor | Whole page: `{title, subtitle, hero_image_url, blocks, seo_title, seo_description, published}` | `{page}` | **Upsert on slug.** Audit `site_page.publish` / `site_page.save_draft` |
| DELETE `/api/admin/site-pages/[slug]` | content editor | — | `{success:true}` | System slug (`about`) → 400 "/about is a built-in page — switch it off instead of deleting it." Audit `site_page.delete` |
| POST `/api/admin/content/upload` | content editor | multipart `file` | `{url, path}` | Allowed MIME: jpeg, png, webp, gif, avif. Max 20MB. Path `content/{Date.now()}-{rand7}.{ext}`, `cacheControl:'31536000'`, `upsert:false`. Audit `content.image_upload` |
| DELETE `/api/admin/content/upload?path=` | content editor | — | `{success:true}` | Refuses any path not starting with `content/`. Audit `content.image_delete` |

**`lib/admin/content-auth.ts`**
- `resolveContentActor(db, req)` reads the `Authorization: Bearer` token, calls `db.auth.getUser`, then reads `customers.{id,email,role}`. On any failure it returns role `customer`.
- `requireContentEditor` returns the actor when `canManageContent(role)` holds, else `null`.
- `contentErrorMessage(msg, table)` maps "does not exist / schema cache / could not find the" to "The {table} table is missing — run pack-options-content-migration.sql."

### Components — admin

**`BlockEditor` (`'use client'`, `{blocks, onChange}`)**
- State: `openPalette: number|null` (the insertion index) and `dragIndex`.
- Each block card:
  - Container `rounded-xl border bg-white`. While dragging: `border-teal opacity-60`.
  - Chrome bar `flex items-center gap-2 border-b border-line bg-surface px-3 py-2` with `GripVertical` (cursor-grab), an uppercase label `text-xs font-semibold uppercase tracking-wider text-ink-muted`, and icon buttons (Move up, Move down, Duplicate, Delete) styled `rounded p-1.5`, with delete hover `hover:bg-red-50 hover:text-red-600`.
  - Body `p-3`.
- Uses native HTML5 drag-and-drop (`draggable`, drop calls `move(from, to)`). Duplicate re-keys with `newBlockId()`.
- **"Add block" row** between blocks: hairlines `h-px flex-1 bg-line group-hover:bg-teal/40` around a pill `rounded-full border px-2.5 py-1 text-[11px]` with `Plus h-3 w-3`. Open state: `border-teal bg-teal/10 text-teal-dark`.
- **Palette:** `rounded-xl border border-teal/40 bg-teal-50/60 p-3` with grid `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2`. Tiles `rounded-lg border border-line bg-white p-2.5 hover:border-teal hover:bg-teal/5` with icon `text-teal-dark`, label `text-xs font-semibold`, hint `text-[10px]`, and a "Cancel" link.
- **Empty state:** "This page is empty / Add your first block below."
- **Per-type fields:**
  - heading: `<select w-28>` with Section (2) / Sub-section (3), plus a RichTextField with `allowCode={false}`.
  - paragraph: multiline RichTextField, `rows=4`, a hint about the syntax, and a "Lead paragraph (larger opening copy)" checkbox.
  - image: `ImageField` alongside alt / caption / width select. Width options are "Inline — narrower than the text", "Wide — a little past the text" and "Full — the widest the layout allows".
  - gallery: columns select (2 or 3), a `sm:grid-cols-3` grid of `ImageField aspect=square compact` with alt and caption inputs and Remove, plus "Add image".
  - quote: RichTextField with `rows=2`, plus attribution input.
  - list: Bulleted / Numbered toggle buttons. Each item is a RichTextField where `onEnter` inserts the next item. Includes "Add point".
  - callout: tone toggle buttons (capitalized), title input, body RichTextField.
  - cta: RichTextField with `allowCode={false}`, label input, URL input (placeholder "/products or https://…").
  - stats: rows of value input `w-24` (placeholder "99.4%") and label input ("Average purity"), plus "Add stat".
  - video: URL and caption inputs.
  - divider: "A horizontal rule. Nothing to configure."
- Shared input class: `w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40`.

**`RichTextField` (`'use client'`)**
- Props: `{value, onChange, multiline?, rows=4, placeholder?, className?, allowCode=true, hint?, ariaLabel?, onEnter?}`.
- Toolbar `rounded-t-lg border border-line bg-surface-2 px-1.5 py-1` with Bold, Italic, Link2 and (optionally) Code buttons (`onMouseDown preventDefault` keeps the selection), and a right-aligned note "Select text, then format" at `text-[10px]`.
- Field `rounded-b-lg border border-t-0 …`.
- `toggleWrap(marker)` wraps or unwraps the selection, or inserts the pair and places the caret between them.
- Shortcuts: Ctrl/⌘+B bolds, Ctrl/⌘+I italicizes, Ctrl/⌘+K inserts a link.
- Link insertion uses `window.prompt` for the URL (default `https://`) and validates it against the same allowlist as `safeUrl`. On failure it shows the red message "That link was not added. Use a full https:// address, a path starting with /, a #anchor, mailto: or tel:".

**`ImageField` (`'use client'`)**
- Props: `{value, onChange, label='Image', aspect='video'|'square'|'auto', compact?}`.
- **With a value:** the image renders in the chosen aspect with a hover `X` button (`bg-black/60`).
- **Empty:** a dropzone `border-2 border-dashed`, `py-8` (or `py-5` when compact). Dragging over shows `border-teal bg-teal/5`. Copy reads "Drop an image or **browse**" and "JPEG, PNG, WebP, GIF · max 20MB".
- **Upload:** `apiFetch('/api/admin/content/upload', {method:'POST', body: FormData, timeoutMs: 60_000})`.
- Below the field there is always a "…or paste an image URL" text input.

**`ContentPreview` (`'use client'`)**
- Props: `{title, subtitle?, heroImageUrl?, blocks, eyebrow?, emptyHint?}`.
- Header reads "Preview · exactly how it will publish", with a Desktop / Phone segmented toggle (`Monitor` / `Smartphone`; active `bg-ink text-white`).
- Body container is `max-w-[390px]` on phone and `max-w-2xl` on desktop, holding the hero, eyebrow, h1 (`font-display text-3xl sm:text-4xl`), subtitle, `brand-rule`, and the `BlockRenderer`.

### Admin controls (screens)

**`/admin/articles` (list)**
- Header with `Newspaper` icon, "N articles · M live at /articles", and a "New article" button (`rounded-xl bg-ink px-4 py-2.5`).
- Search ("Search by title, URL, category or tag…") and a segmented status filter: all / published / draft.
- Rows show:
  - Cover thumbnail `h-12 w-16`.
  - Title link, a featured `Star` (`fill-amber-400 text-amber-500`), and a status pill (Published `bg-emerald-100 text-emerald-700`, Draft `bg-amber-100 text-amber-700`).
  - Subline `/articles/{slug} · category · date · N min`.
  - Actions: star toggle (PATCH `featured`), external View (published only), Publish/Unpublish (PATCH `status`), Edit, and Delete (confirm modal explaining the URL will 404).
- "New article" modal: a title input, then POST, then router.push to `/admin/articles/{id}`.
- Success toasts auto-clear after 3.5s.

**`/admin/articles/[id]` (builder)**
- Two columns at `xl:grid-cols-2`. Below xl, a Preview/Edit toggle switches between them.
- Header buttons: View, Featured toggle (`border-amber-300 bg-amber-50 text-amber-700` when on), "Show on storefront" checkbox (this is `status`; publishing is part of save), and Save (disabled unless dirty; label reads "Save" or "Saved").
- Fields:
  - Title.
  - URL: `/articles/` prefix plus a slugified input. When the article is live and the slug changes, an amber warning appears.
  - Excerpt textarea; its placeholder is the derived excerpt.
  - Cover `ImageField`.
  - Author (placeholder "VYTA Biosciences" — brand content) and Category.
  - Tags as CSV with removable chips.
  - Content header "N blocks · N words · N min read", then BlockEditor.
- "Search engines" card:
  - SEO title with an "(n/60)" counter that turns amber above 60.
  - Meta description with "(n/160)".
  - SERP preview: title in `#1a0dab`, URL line `vyta.com/articles/{slug}` in emerald-700 (brand content — use `SITE_URL` host), description in line-clamp-2.
  - "First published {date}" note.
- A `beforeunload` guard is active while dirty.
- Preview column: `xl:sticky xl:top-6 xl:h-[calc(100vh-7rem)]`.

**`/admin/pages` (list) and `/admin/pages/[slug]` (editor)**
- List:
  - Injects an `about` placeholder row when the database has none.
  - A "built-in" pill marks system pages.
  - Public URL is `/{slug}` for system pages and `/p/{slug}` otherwise.
  - "New page" modal: Title (placeholder "Shipping & Returns") and URL `/p/` prefix (placeholder "shipping-returns").
  - Delete is hidden for system pages.
- Editor: same chrome as the article builder, with fields Title, Subtitle, Hero image, BlockEditor and SEO. The "Show on storefront" checkbox maps to `published` and is saved with the whole page (PUT).

**Admin nav (VYTA `app/(admin)/admin/layout.tsx`)**
- New group **Content**:
  - `/admin/announcements` "Announcements" (`Radio`)
  - `/admin/testimonials` "Testimonials" (`MessageSquareQuote`)
  - `/admin/pages` "Pages" (`FileEdit`)
  - `/admin/articles` "Articles" (`Newspaper`)
- Every content admin page shows "Your role can’t manage articles / edit storefront pages." when `!canManageContent`. The assistant role can see the nav items via `canAccessAdminPage` but is refused by the API.

### Porting notes

1. Run the `site_pages` and `articles` sections of the migration. Replace the seeded About copy and `FALLBACK_ABOUT_PAGE` (brand content).
2. **Do not overwrite aminocan's `RichText.tsx`.** Aminocan's version is functionally richer: nested inline parsing and stricter `safeUrl` (rejects `//`). It is also used by `ProductInfoTabs` and `ProductDetailClient`. Instead:
   - Add a `paragraphClassName` prop: VYTA applies it to every `<p>` alongside `mt-4` for i>0. Aminocan currently only has `className` on the wrapper.
   - Return `null` for empty text.
   - Mark the file `'use client'`, because BlockRenderer is a client component.
   - Accept `tel:` links, which VYTA's `safeUrl` allows.
   - Swap the link colour from `text-bronze-dark … decoration-bronze/40` to whatever is wanted. It is already aminocan-branded.
   - Keep the `renderInline(text, keyPrefix?)` export name.
3. Fix `lib/api-fetch.ts` for FormData (§0.2) before porting `ImageField`.
4. Add `canManageContent` to permissions and the hook; add the Content nav group and the `ANALYTICS_PAGES` entries.
5. Replace the "Coming Soon" About row in aminocan `Navigation` with the live About and Articles links (desktop dropdown and mobile "Company" group), and add Articles and About Us to the Footer quick links.
6. Map tokens per §0.1. The cover placeholder text "VYTA" becomes the Aminocan wordmark.
7. Every `| VYTA` title suffix and the `publisher.name` become Aminocan. Article metadata strings are brand content.

### Open questions

- **`/articles?tag=X` deep links are ignored.** `ArticleIndex` initialises `tag` to `''` and never reads `useSearchParams`, so tag links from the article page land on an unfiltered index. Port as-is or fix?
- **RLS exposes drafts.** The policy `FOR SELECT USING (true)` on `articles` and `site_pages` lets the anon key read drafts and scheduled posts directly through PostgREST. The API filters them, but the table does not. Tighten to `USING (status='published')` / `USING (published)` for aminocan?
- **No scheduling UI.** The article builder has no `published_at` control, although the API supports backdating and scheduling. Confirm none is wanted.
- **Announcements and testimonials are not specified here.** `lib/content/announcements.ts` and `testimonials.ts` and their admin screens are under `lib/content/**` but are homepage features. They are assumed to be specified in another section.
- **`getSupabase()` differs.** Aminocan's version throws when `SUPABASE_SERVICE_ROLE_KEY` is missing outside the build phase. The content readers catch that and fall back. Confirm acceptable.

---

## 2. Partner program page (`/partners`)

### What's new vs aminocan-cad

A public marketing landing page for the affiliate/partner program, with an application form that **emails** the team. It does not create an affiliate account and **does not write to the database**. There is **no admin view**.

Aminocan's closest existing surfaces are its Footer link to `/affiliate/signup` (`text-bronze`) and `/api/affiliate-requests`. VYTA does not link to `/partners` from Navigation or Footer; only the sitemap lists it.

### Files

- `app/partners/page.tsx` (server component, static)
- `app/partners/PartnerApplicationForm.tsx` (`'use client'`)
- `app/api/partner-applications/route.ts`

### Database

None.

### API

**POST `/api/partner-applications`**
- **Auth:** public. **Rate limit:** `partner-app:{ip}`, max 3 per 10 minutes, then 429 with `Retry-After` and "Too many submissions. Please try again in a few minutes."
- **Body:** `{name, email, paymentEmail, phone, website, audience, promotion, company, agreedToTerms}`.
- **Honeypot:** a non-empty `company` returns `{ok:true}` without sending.
- **Field rules** (trimmed; `label`, `max`, required):

| Field | Label | Max | Required |
|---|---|---|---|
| `name` | Name | 120 | yes |
| `email` | Email | 200 | yes |
| `paymentEmail` | Payment email | 200 | no |
| `phone` | Phone | 40 | no |
| `website` | Website / social | 300 | no |
| `audience` | Audience size | 60 | no |
| `promotion` | How they will promote VYTA | 3000 | yes |

- **Errors** (all 400):
  - "{Label} is required", "{Label} is too long".
  - Email regex `^[^\s@]+@[^\s@]+\.[^\s@]+$`: "Enter a valid email address" / "Enter a valid payment email address".
  - `agreedToTerms !== true`: "You must agree to the terms".
- **Email** via `sendMail({to, replyTo: email, subject: "Partner application — {name}", html, text})`:
  - `to` is `process.env.PARTNER_APPLICATION_EMAIL || 'Vytabiosciences@gmail.com'` (brand content — replace).
  - Newlines in the subject are stripped.
  - HTML is `vytaShell(...)`: an eyebrow "PARTNER PROGRAM" (11px, 600, letter-spacing .2em, `#2E8A92`), h1 "New partner application" (22px, `#07203A`), then a table row per field (label 12px `#56707F`, 170px column; value 14px `#07203A`, pre-wrap; bottom border 1px `#DCE7EB`; blanks shown as "—"), then the footer "Reply to this email to respond to {name} directly."
  - Text body is `Label: value` lines.
- **Failure:** send failure returns 502 "We could not send your application. Please try again or email us directly." **Success:** `{ok:true}`.

### Components / UI (all on `<main class="min-h-screen bg-white">` with Navigation and Footer)

Program constants at the top of the page file are brand content: `COMMISSION='20%'`, `AUDIENCE_DISCOUNT='10%'`, `SPRINT_BONUS='$500'`.

- **Metadata:** title "Partner Program | VYTA", plus a description.

**Hero**
- `<section class="relative bg-brand-gradient overflow-hidden">` with inner `max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 pt-40 sm:pt-44 pb-20 sm:pb-24 text-center`.
- Eyebrow `text-[10px] sm:text-xs font-semibold text-teal-light uppercase tracking-[0.25em] mb-5`.
- h1 `text-3xl sm:text-5xl lg:text-6xl font-bold text-white tracking-tight leading-[1.1] max-w-3xl mx-auto`.
- Lede `mt-6 text-base sm:text-lg text-white/70 max-w-2xl mx-auto`.
- Highlight chips `mt-8 flex flex-wrap justify-center gap-2 sm:gap-3`. Each is `inline-flex items-center gap-2 px-3.5 py-2 bg-white/10 border border-white/15 rounded-full text-xs sm:text-sm text-white` with an icon `w-4 h-4 text-teal-light`. Chips: Zap "Fast payouts", MapPin "Ships across Canada", LineChart "Custom affiliate dashboard", Package "Wholesale pricing".
- CTA `<a href="#apply">` "Apply now" with `mt-10 inline-flex px-8 py-4 bg-white hover:bg-white/90 text-ink font-semibold rounded-xl w-full sm:w-auto`.

**Advantages**
- Section `py-16 sm:py-24` with heading block `text-center max-w-2xl mx-auto mb-12`: eyebrow `text-teal-dark tracking-[0.2em]`, h2 `text-2xl sm:text-4xl font-bold text-ink tracking-tight`, sub `mt-3 text-ink-muted`.
- Grid `grid md:grid-cols-3 gap-6`. Card `bg-surface rounded-2xl border border-line p-8 text-center` with icon tile `w-14 h-14 bg-white border border-line rounded-2xl` and icon `w-7 h-7 text-teal-dark`, h3 `text-lg font-bold text-ink mb-2`, body `text-sm text-ink-muted leading-relaxed`.
- Cards: BadgePercent / Gift / Rocket.

**Monthly sprint**
- Section `pb-16 sm:pb-24`. Panel `bg-ink rounded-3xl p-8 sm:p-12 grid lg:grid-cols-2 gap-8 items-center`.
- Inner card `bg-white/5 border border-white/10 rounded-2xl p-6 sm:p-8 flex gap-5` with Trophy tile `w-14 h-14 bg-teal/20 rounded-2xl` and icon `text-teal-light`.

**Steps**
- Section `py-16 sm:py-24 bg-surface border-y border-line`.
- `<ol class="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">`. Each card is `bg-white rounded-2xl border border-line p-6` with a number badge `w-8 h-8 rounded-full bg-ink text-white text-sm font-bold` and an icon `w-5 h-5 text-teal-dark`.
- Steps: Apply / Get Approved / Get Your Toolkit / Promote & Conquer.

**Apply** (`<section id="apply" class="py-16 sm:py-24 scroll-mt-24">`)
- Grid `max-w-6xl … grid lg:grid-cols-5 gap-10`.
- Left column `lg:col-span-2`: eyebrow "Partner Portal", h2, copy, and a contact box `mt-8 p-5 bg-surface border border-line rounded-2xl` with Mail icon and a `mailto:Vytabiosciences@gmail.com` link (brand content).
- Right column `lg:col-span-3`: the form.

**`PartnerApplicationForm`**
- State: `form` (8 strings including the honeypot), `agreedToTerms`, `error`, `isSubmitting`, `submitted`.
- Form card `bg-white rounded-2xl border border-line p-6 sm:p-8 space-y-5` with header "Apply to the Partner Program" and "All fields marked * are required."
- Grid `sm:grid-cols-2 gap-4` of fields:
  - Your name * (`autoComplete=name`)
  - Email * (`type=email`)
  - Payment email (e-Transfer), placeholder "If different from above"
  - Phone (`tel`)
  - Website or social handle, placeholder "@yourhandle or https://…"
  - Audience size select: "Select…", "Under 1,000", "1,000 – 10,000", "10,000 – 50,000", "50,000 – 250,000", "250,000+"
- Full-width textarea "How will you promote VYTA? *" with `rows=5`, max 3000.
- Hidden honeypot `company` in a `div.hidden aria-hidden` with `tabIndex=-1`.
- Terms checkbox linking `/terms` (new tab): "…and understand VYTA products are for research use only."
- Input class: `w-full px-4 py-3 bg-white border border-line rounded-xl text-sm text-ink placeholder:text-ink-muted/60 focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal`. Label class `block text-xs font-semibold text-ink mb-1.5`.
- Error box `p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700` with AlertCircle.
- Submit `w-full inline-flex … px-6 py-3.5 bg-ink hover:bg-ink/90 disabled:opacity-60 text-white font-semibold rounded-xl`. It shows a spinner (`border-2 border-white border-t-transparent rounded-full animate-spin`) with "Sending…", otherwise `Send` with "Submit Application".
- Client checks terms first ("Please agree to the Terms & Conditions to continue."). A network failure shows "Network error. Please check your connection and try again."
- **Success state:** card `p-8 sm:p-10 text-center` with an emerald `CheckCircle2` tile (`bg-emerald-50`, icon `text-emerald-500`), "Application received", and "Thanks, {firstName}! … email you at {email} within 24 hours."

### Admin controls

None. Applications arrive only by email.

### Porting notes

- Reuse `sendMail`, swap `vytaShell` for `aminocanShell`, and add the `PARTNER_APPLICATION_EMAIL` env var with an Aminocan default.
- All headline, step and program copy is **brand content — replace**, including the commission, discount and sprint values, "Ships across Canada", and "e-Transfer". Confirm the Aminocan program terms with the owner.
- On aminocan, `bg-brand-gradient` maps to `bg-ink`. Teal accents map to bronze.

### Open questions

- Should aminocan's version store applications (for example in its existing `referral_code_requests` / affiliate-requests flow) or deep-link to `/affiliate/signup`, instead of email-only?
- Should `/partners` be linked from Footer or Navigation? VYTA does neither; aminocan's Footer currently links `/affiliate/signup`.

---

## 3. Promo landing pages (off-site page → `?lp=` → auto-applied discount code)

### What's new vs aminocan-cad

A landing page hosted on another domain sends visitors to the store with `?lp=<slug>`. The store then does three things:
1. It remembers the offer in a cookie.
2. It shows the offer in the nav, the cart and the checkout.
3. It **auto-fills and server-side-applies** the landing page's discount code.

It also counts views, click-throughs and unique visitors with consent-free anonymous tallies, and reports a funnel per page in **Admin → Marketing → Landing Pages**. A static reference landing page lives in `landing-page/`.

Aminocan already has some of the building blocks:
- `discount_codes.first_order_only` and `excluded_product_ids` (from `discount-codes-affiliate-migration.sql`), with checkout support.
- A **`?promo=<CODE>` → `promo_code` cookie** mechanism (`lib/promos/discount-code-tracking.ts`, consumed by checkout to prefill the code).
- `lookupDiscountCode`.

It has **no** `landing_pages` table, no `?lp=` handling, no `/api/landing/*` routes, and no `landingOffer` in `PromosContext`.

### Files (VYTA)

| Area | Files |
|---|---|
| Pure lib | `lib/promos/landing.ts` (constants, slug, CTA URL, offer shaping, admin input), `lib/promos/landing.test.ts` (14 tests; `node --test --import tsx`) |
| Server lib | `lib/promos/landing-server.ts` (`loadLandingPage`, `resolveLandingOffer`, `productNames`, `exclusionsPhrase`, `landingFinePrint`, `bumpLandingCounters`) |
| Browser lib | `lib/promos/landing-client.ts` (`landingArrival`, `reportLandingArrival`) |
| Middleware / attribution | `middleware.ts` (sets the cookie), `lib/analytics/attribution.ts` (`landing_page` on the touch, cookie key `lp`), `lib/analytics/attribution-server.ts` (`VisitorContext.landingPage`, `landingPageOf`, `first_/last_landing_page` columns with retry-without) |
| Public APIs | `app/api/landing/[slug]/route.ts`, `app/api/landing/[slug]/arrive/route.ts`, `app/api/promos/landing/route.ts` |
| Storefront | `contexts/PromosContext.tsx` (`landingOffer`), `components/AdDiscountNotice.tsx`, `app/cart/page.tsx`, `app/checkout/PuramassCheckoutContent.tsx`, `components/CustomerJourneyTracker.tsx` |
| Server hand-off | `app/api/checkout/puramass/route.ts` (fallback apply plus stamping `landing_page`), `app/api/customer/activity/identify/route.ts` (stamps `customers.attribution_landing_page`) |
| Admin | `app/(admin)/admin/landing-pages/page.tsx`, `components/admin/LandingPageModal.tsx`, `components/admin/affiliates/CodeRestrictionsFields.tsx`, `app/api/admin/landing-pages/{route.ts,[id]/route.ts,shared.ts}`, plus a "Landing: slug" tag in `app/api/admin/discount-codes/route.ts`, `app/(admin)/admin/discount-codes/page.tsx` and `components/admin/affiliates/DiscountCodeModal.tsx` |
| SQL | `landing-pages-migration.sql`, `landing-page-counters-migration.sql` |
| Off-site | `landing-page/index.html`, `landing-page/assets/{vyta-logo-320.webp,vyta-logo-320.png,vyta-mark-192.png}` |
| Docs | `LANDING_PAGES.md`, `docs/changelog/2026-09-28-landing-pages.md`, `2026-09-28-landing-page-visitor-counts.md`, `2026-10-02-landing-page-vyta20.md`, `docs/landing-page-update-vyta20.md` |

### Database

`landing-pages-migration.sql` (idempotent). It requires the discount-codes and marketing-attribution migrations to have run.

```sql
ALTER TABLE discount_codes
  ADD COLUMN IF NOT EXISTS first_order_only BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS excluded_product_ids UUID[] NOT NULL DEFAULT '{}';
  -- aminocan ALREADY HAS both (discount-codes-affiliate-migration.sql) — skip.

CREATE TABLE IF NOT EXISTS landing_pages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              VARCHAR(40) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
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
ALTER TABLE landing_pages ENABLE ROW LEVEL SECURITY;   -- no policies: service role only

ALTER TABLE visitor_attribution
  ADD COLUMN IF NOT EXISTS first_landing_page TEXT,
  ADD COLUMN IF NOT EXISTS last_landing_page  TEXT;
CREATE INDEX IF NOT EXISTS idx_visitor_attr_first_lp ON visitor_attribution (first_landing_page) WHERE first_landing_page IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_visitor_attr_last_lp  ON visitor_attribution (last_landing_page)  WHERE last_landing_page  IS NOT NULL;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS attribution_landing_page TEXT;
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS landing_page TEXT;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_landing_page
  ON puramass_orders (landing_page, created_at DESC) WHERE landing_page IS NOT NULL;
```

`landing-page-counters-migration.sql`:

```sql
CREATE TABLE IF NOT EXISTS landing_page_daily (
  slug TEXT NOT NULL, day DATE NOT NULL,
  views INTEGER NOT NULL DEFAULT 0, arrivals INTEGER NOT NULL DEFAULT 0, visitors INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, day)
);
ALTER TABLE landing_page_daily ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION landing_page_bump(p_slug TEXT, p_views INTEGER DEFAULT 0,
  p_arrivals INTEGER DEFAULT 0, p_visitors INTEGER DEFAULT 0) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO landing_page_daily (slug, day, views, arrivals, visitors)
  SELECT p_slug, (now() AT TIME ZONE 'America/Toronto')::date,
    LEAST(GREATEST(COALESCE(p_views,0),0),1), LEAST(GREATEST(COALESCE(p_arrivals,0),0),1),
    LEAST(GREATEST(COALESCE(p_visitors,0),0),1)
  WHERE EXISTS (SELECT 1 FROM landing_pages WHERE slug = p_slug)
  ON CONFLICT (slug, day) DO UPDATE SET
    views = landing_page_daily.views + EXCLUDED.views,
    arrivals = landing_page_daily.arrivals + EXCLUDED.arrivals,
    visitors = landing_page_daily.visitors + EXCLUDED.visitors;
$$;
-- REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role (guarded DO $$ block)
CREATE INDEX IF NOT EXISTS idx_customers_attribution_landing_page
  ON customers (attribution_landing_page, created_at DESC) WHERE attribution_landing_page IS NOT NULL;
```

Where each column is written and read:

| Column | Written | Read |
|---|---|---|
| `landing_pages.*` | Admin API | Offer resolution, admin report |
| `discount_codes` row per page | Admin API (the offer *is* a code) | Offer resolution; checkout `lookupDiscountCode` |
| `landing_page_daily` | `landing_page_bump` RPC from the two public routes | Admin report (views, clicks = `arrivals`, visitors) |
| `visitor_attribution.first_/last_landing_page` | Consent-gated attribution writes (`touch.landing_page`) | Customer journey / analytics |
| `customers.attribution_landing_page` | `/api/customer/activity/identify`: set once (`.is(null)`) when `registeredDuringThisVisit` (account `created_at` ≥ visitor `first_seen`), value `landingPageOf(ctx)` | Admin report sign-ups |
| `puramass_orders.landing_page` | Hand-off: `landingPageOf(visitor)` | Admin report funnel; delete guard |

### Cookie, storage and slug behavior

| Item | Value |
|---|---|
| Query param | `lp` (`LANDING_PARAM`) |
| Slug regex | `^[a-z0-9][a-z0-9-]{1,39}$`. `normalizeLandingSlug` only trims and lowercases; anything else is null (no underscore rewriting) |
| Offer cookie | **`vyta_lp`** (brand: rename for aminocan, e.g. `aminocan_lp`). Set in `middleware.ts` on any request with a valid `?lp=`, using `COOKIE_BASE = {path:'/', sameSite:'lax', httpOnly:false}` and `maxAge = 60*60*24*30` (30 days). **Latest wins** and is re-set on every landing arrival. `?lp=` is **not** stripped from the URL (no redirect). Middleware matcher excludes `api/` |
| Touch | `landing_page` is added to `AttributionTouch` (cookie-encoded key `lp`). It makes a touch "meaningful" (`isMeaningfulTouch`). It is stored on the first- and last-touch cookies (`aminocan_attr` / `aminocan_attr_last`, names unchanged in VYTA) |
| Credit rule | `landingPageOf(ctx) = ctx.landingPage (cookie) ?? first.landing_page ?? last.landing_page` |
| localStorage | `vyta_lp_seen` = `{[slug]: 'YYYY-MM-DD'}`. Marks a browser as already counted as a visitor |
| sessionStorage | `vyta_lp_arrived:{slug}` = `'1'`. One arrival per tab |
| Client trigger | `CustomerJourneyTracker` calls `reportLandingArrival()` on the first pathname of a visit (`isEntry`). It is also deduped in memory (a module `Set`) |

### API routes

**GET `/api/landing/[slug]`** (also `OPTIONS` → 204)
- Public. CORS headers: `Access-Control-Allow-Origin: *`, `Methods: GET, OPTIONS`, `Allow-Headers: Content-Type`, `Max-Age: 86400`, `Cache-Control: no-store, max-age=0`.
- Rate limit `landing:{ip}`, 240 per 60s; over the limit returns 429 `{ok:false,error:'Too many requests'}` with `Retry-After`.
- Responses:
  - Invalid slug, missing page or inactive page: **404** `{ok:false, active:false, percent:0}`.
  - Page exists but has no live offer: **200** `{ok:true, slug, active:false, percent:0, cta_url}`.
  - Live offer: **200** `{ok:true, slug, active:true, percent, percent_label, first_order_only, exclusions, fine_print, ends_at, cta_url}`.
- **The code itself is never returned.**
- `cta_url` is `landingCtaUrl(SITE_URL, destination_path, slug)`, i.e. `new URL(path, origin)` with `lp` set.
- `percent_label` is `formatPercent` (`+n.toFixed(2)+'%'`).
- A views tally is bumped via `after()` whenever the page exists and is active.
- Uses a service-role `createClient`.

**POST `/api/landing/[slug]/arrive`**
- Body `{first:boolean}`. Always returns 204 with `Cache-Control: no-store`.
- Rate limit `landing-arrive:{ip}`, 20 per 60s; over the limit it silently returns 204.
- Bumps `{arrivals:true, visitors: first===true}`.

**GET `/api/promos/landing`**
- Reads the `vyta_lp` cookie.
- Responses:
  - No valid cookie: `{offer:null}`.
  - No live offer: `{offer:null, slug}`.
  - Otherwise: `{offer:{slug, code, percent, first_order_only, excluded_product_ids, exclusions, ends_at}, eligible, reason}`.
- `eligible=false` only when the offer is first-order-only AND a Bearer token is sent AND `firstOrderRejection(firstOrderStatus(db,{customerId,email}))` rejects. `reason` is then the matching `REJECTION_MESSAGES` entry.
- Header: `Cache-Control: no-store`.

**Offer resolution (`resolveLandingOffer` → `landingOfferFrom`)**
- Returns null when:
  - the slug is invalid or the row is missing,
  - `active=false`,
  - there is no code,
  - the code is inactive, not `percent`, not started (`starts_at > now`), or ended (`expires_at <= now`),
  - or the percent is ≤ 0.
- The percent is rounded to 2 decimals and capped at 99.
- Usage limit, minimum subtotal and first order are **not** checked here; checkout does that.
- Every failure fails closed (no offer).

**Fine print**
- `landingFinePrint(offer, exclusions)` builds `*First order only. Excludes {x}. Ends {Month D, YYYY (America/Toronto)}.`, including only the parts that apply, and returns null when there are none.
- `exclusionsPhrase(names)` collapses any name matching `/bacteriostatic|bac[\s-]?water/i` to "bacteriostatic water". It lists up to three names ("a, b and c") and then "and N more".

**Admin API** (service role; `resolveStaffCaller`; GET allows the assistant role, every write is admin-only)

| Method · Path | Body | Behavior |
|---|---|---|
| GET `/api/admin/landing-pages?days=N` | — | `{landingPages, countersMissing}` or `{landingPages:[], migrationNeeded:true}` (error 42P01 or the message mentions `landing_pages`). Each row is `presentLanding`: the row plus `code{id,code,discount_type,percent,first_order_only,excluded_product_ids,starts_at,expires_at,max_uses,active}\|null`, `live_percent` (0 unless active and the offer is live), `cta_url`, `api_url` (`${SITE_URL}/api/landing/{slug}`), and `stats` |
| POST `/api/admin/landing-pages` | `{name, slug, domain, destination_path, active, notes, offer:{code, percent, first_order_only, excluded_product_ids, starts_at, expires_at, max_uses}\|null}` | `shapeLandingPageInput` validates. Then it probes the table, creates the discount code via `offerToCode` (percent type, `notes: Offer for the "{slug}" landing page.`, `active:true`, `affiliate_id:null`), then inserts the page. If the page insert fails it **rolls back the code**. Slug 23505 → 409 `The slug "{slug}" is already in use.`; code 23505 → 409 `{CODE} is already used by another discount code.` Returns 201 `{landingPage}`. Audit `landing_page.create` |
| PATCH `/api/admin/landing-pages/[id]` | `{active}` alone, or the full body | `{active}` alone is the quick toggle. Full body: updates the linked code **in place**, touching only `code, discount_type:'percent', discount_value, max_uses, starts_at, expires_at, active:true, first_order_only, excluded_product_ids, updated_at`. It creates a code if none exists or the old one was deleted. `offer:null` switches the existing code `active=false` and unlinks it. Audit `landing_page.update` |
| DELETE `/api/admin/landing-pages/[id]` | — | 409 "Orders came through this landing page, so its history is kept. Switch it off instead." if any `puramass_orders.landing_page=slug`. Otherwise deletes the page, then deletes its code if no `puramass_orders.discount_code_id` uses it, else deactivates it. Returns `{deleted:true}`. Audit `landing_page.delete` |

`writeCode` retries without the restriction columns on a missing-column error, unless a restriction was actually set, in which case it returns 400 `RESTRICTIONS_NEED_MIGRATION`.

**`shapeLandingPageInput` validation messages**
- Slug: 'The slug is 2–40 lower-case letters, numbers or dashes, e.g. "standards".'
- Name (≤120 characters): "Give the landing page a name."
- Domain (`normalizeLandingDomain` strips scheme, path and port, then hostname-regex): 'That domain does not look right, e.g. "getvyta.ca".'
- Destination must be an absolute path, not `//`, with no whitespace or backslash, ≤200 characters, and must normalise to itself: 'The destination is a path on this site, e.g. "/products".'
- Percent must be > 0: "Enter the percentage the landing page offers."
- An empty code becomes `suggestLandingCode(slug, percent)`: the uppercased slug stripped to A–Z0–9 (max 24, else `WELCOME`) plus the rounded percent, capped at 32. Example: `STANDARDS35`.
- `first_order_only` defaults to **true** unless explicitly `false`.

**Stats (`landingStats`, all consent-free)**
- Views, clicks and visitors are summed from `landing_page_daily` (`day >= since` date). They are `null` when the table is missing (`countersMissing`).
- Sign-ups count `customers.attribution_landing_page = slug` (with `created_at >= since`).
- From `puramass_orders` where `landing_page` is in the slugs (limit 20000):
  - checkouts = distinct lowercased `customer_email` (or `order:{id}`) over any status;
  - purchasers = the same over `status='paid'`;
  - orders = the paid count;
  - revenue = sum of `subtotal_cents/100` per `currency`;
  - discount_given = sum of `ad_discount_cents/100`.

### Storefront behavior: how the discount is applied

1. **Arrival.** Middleware sets the cookie and records `landing_page` on the touch. `CustomerJourneyTracker` posts `/arrive` once per tab.
2. **`PromosContext.landingOffer`.**
   - When `document.cookie` contains the landing cookie, the provider fetches `/api/promos/landing` (`cache:'no-store'`, with a Bearer token if signed in). It re-fetches when `customerId` changes.
   - Value: `{active: eligible!==false, slug, code, percent, firstOrderOnly, excludedProductIds, exclusions, reason, amountOn(lines: {productId, amount}[])}`.
   - `amountOn` returns `round(eligibleSubtotal(lines, excludedIds) * percent) / 100`.
   - With no cookie, or a failed fetch, the value is `NO_LANDING_OFFER` (inactive).
3. **Nav (`AdDiscountNotice` → `useAdOfferNotice`).** If `landingOffer.active`, it returns `{show:true, eligible:true, off:'{p}%', firstOrder: firstOrderOnly}`. The landing offer **replaces** the ad-offer wording.
   - Eligible markup: `•` then `Check h-3 w-3` in `text-emerald-700`, "**{p}% off**", then " your first order — applied at checkout" (the "your first order" part only if `firstOrder`; hidden below `sm`), and " applied" on mobile.
   - No sign-up CTA is ever shown for landing visitors.
4. **Cart (`app/cart/page.tsx`).**
   - `landingSaving = landingOffer.amountOn(lines)` and `welcomeSaving = adDiscountOn(subtotal)`.
   - `landingWins = landingSaving > 0 && landingSaving >= welcomeSaving`. The two **never stack**: whichever is larger applies.
   - The cart offer then comes off what is left: `estimated = (subtotal − first) − cartOffer.amountOn(subtotal − first)`.
   - Line markup: `BadgePercent h-3.5 w-3.5` in emerald-700, "{p}% first-order offer" (or "welcome offer"), and `-$X` in `font-semibold text-emerald-700 tabular-nums`.
   - Sub-note `mt-0.5 text-[10px] sm:text-xs text-ink-muted`: "Code {CODE} is applied automatically at checkout · excludes {exclusions}."
5. **Checkout (`PuramassCheckoutContent`).**
   - State: `landingTriedFor: number|null` and `landingDeclined: boolean`.
   - **Auto-apply effect** runs `applyDiscountCode(code, {fromLanding:true})` → POST `/api/checkout/discount-code` `{code, subtotal, items:[{productId, amount}]}` only when all of these hold:
     - the `?discount=`/`?code=` link code has already been tried;
     - `totalPrice > 0` and no check is in flight;
     - the offer is active with a code and was not declined;
     - no code is applied and the input is empty;
     - `landingTriedFor !== totalPrice` (so it retries when the cart changes).
   - **Applied chip** (`border-emerald-200 bg-emerald-50`) adds "Applied automatically from your welcome offer · first order only." and "Not discounted by this code: {names}."
   - **Removing the chip** on a landing code sets `landingDeclined=true`. Removing any other code resets `landingTriedFor` so the landing code comes back.
   - **Declined state** shows the link button "Re-apply your {p}% welcome offer ({CODE})" (`text-xs font-medium text-teal-dark hover:underline`).
   - The summary line label is "Welcome offer {CODE}" instead of "Code {CODE}".
   - **Pay payload** includes `declineLandingOffer: true` only when the buyer declined and no code is applied.
   - **If the hand-off returns `discount_code_error` for a landing code**, the code is dropped, `landingDeclined` is set, and the buyer sees "{msg} You can continue without it."
6. **Hand-off (`/api/checkout/puramass`), the authoritative step.**
   - If the buyer sent no code, did not decline, and `visitor.landingPage` is set, the server resolves the offer and applies its code.
   - A landing code that fails `lookupDiscountCode` (for example "already ordered") is **logged and skipped**; checkout is **not** blocked. A typed code that fails still returns 400 `discount_code_error`.
   - The order row is stamped `landing_page = landingPageOf(visitor)`.
   - Code vs welcome discount is compared by effective percent: `code% × eligibleCents / listSubtotalCents`.

### Admin UI

**`/admin/landing-pages`** (nav: Marketing → "Landing Pages", `Globe` icon)
- Uses `useToast` and `adminFetch` with a Bearer token.
- `editable = canEdit(role)`, which is admin only.
- **Header:** h1 `text-2xl font-bold text-ink`, a description, a range select (All time / 90 / 30 / 7 days), and "New landing page" (`rounded-lg bg-ink px-4 py-2.5`). The button is hidden when the migration is needed.
- **Banners** (`rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800`):
  - migration needed: "Run landing-pages-migration.sql…";
  - counters missing: "Run landing-page-counters-migration.sql…".
- **Empty state:** `Globe h-8 w-8 text-line`, "No landing pages yet.", and "The setup guide is LANDING_PAGES.md in the repository."
- **Card per page:** `rounded-xl border border-line bg-white p-5`.
  - Name, plus a status pill (`rounded-full px-2 py-0.5 text-[11px] font-medium`):
    - Off: `bg-gray-100 text-ink-muted`
    - "Live · {p}% off": `bg-emerald-100 text-emerald-700`
    - "Offer not live": `bg-amber-100 text-amber-700`
    - "No offer": `bg-surface text-ink-muted`
  - Subline: `slug · domain · code X · first order only · excl. N products`.
  - An amber explanation when the code is set but not live.
  - Icon buttons:
    - open button link;
    - Edit, Power toggle (`text-emerald-600` when on) and Delete (shown only when `orders === 0`), all admin only.
  - Two `CopyRow`s ("Button link", "Offer API"): `rounded-lg border border-line px-3 py-2` with a mono value and a Copy button.
  - Stat tiles (`rounded-lg bg-surface px-3 py-2`; label `text-[10px] font-semibold uppercase tracking-wider text-ink-muted`; value `text-sm font-bold text-ink tabular-nums`; "—" when null):
    - grid `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`: Page views, Clicked through ("x% of views"), Visitors ("unique browsers"), Sign-ups, Checkouts, Purchasers (each "% of visitors");
    - grid `sm:grid-cols-3`: Paid orders, Revenue (per currency), Discounts given.
- **Footnote** `text-[11px]` explains the tallies.

**`LandingPageModal`**
- Overlay `fixed inset-0 z-50 bg-black/50 p-4`; panel `max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl`.
- Fields:
  - Name (placeholder "Meta — first order 35%", hint "Internal only.").
  - Slug (mono; filtered to `[a-z0-9-]`, max 40; hint "Rides on the button link as ?lp=…") and Landing domain (placeholder "getvyta.ca" — brand content), side by side.
  - Slug-change amber warning.
  - "Button goes to" (mono, default `/products`; hint "A path on vytabio.com" — brand content).
  - Offer box `rounded-xl border border-line p-4` with the checkbox "This landing page offers a discount" (default on for a new page). When on:
    - Percent off (number, min 1, max 99, step 0.5, default `'35'`) and Discount code (mono uppercase A–Z0–9, max 32). The code auto-follows `suggestLandingCode` until touched.
    - `CodeRestrictionsFields` with `suggestBacWater`:
      - First order only checkbox with explanation.
      - Excluded products shown as chips, plus a product search (from `/api/products`, cached).
      - "+ Exclude all bacteriostatic water (N)".
    - Starts / Ends (`datetime-local`, converted to and from local time) and Usage limit (placeholder "Unlimited").
  - Internal notes.
  - "Active — switch off to stop the offer everywhere at once" checkbox.
- Buttons: Cancel and Create/Save. Save is disabled unless there is a name and the slug has at least 2 characters.
- Input class: `w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-teal focus:outline-none disabled:bg-surface`.

**Discount Codes cross-link**
- The codes list adds a pill linking `/admin/landing-pages`, reading "Landing: {slug}" (`ml-2 rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-dark`).
- The code modal shows a `border-teal-200 bg-teal-50 text-teal-dark` note: "This code is the offer for the {slug} landing page… Changing it here changes what that page shows."

### Off-site reference page (`landing-page/index.html`)

A single static file with no build step. The full design scheme is in `LANDING_PAGES.md` §8; all of it is brand content (VYTA logo, palette, copy "Claim 20% Off Your First Order*", "Use Code: VYTA20", "CLICK TO SHOP NOW ›", and the strip "Free Shipping · Lab Tested · Discreet Packaging"). The contract a replacement page must keep:
1. **Config in `<head>`:** `window.VYTA_OFFER = {slug, api:'https://www.vytabio.com/api/landing/', fallbackUrl, holdMs:900, timeoutMs:6000}`. The page starts the fetch immediately, adds `offer-pending` to `<html>` (which makes `[data-offer-hold]` `opacity:0`), and reveals after the response or after `holdMs`. The fade is 160ms.
2. **Applying the response:**
   - `active && percent>0`: set every `[data-offer-percent]` to `percent_label`; set `[data-offer-scope]` to "Your First Order" or "Your Order"; set `#fine-print` to `fine_print` (hidden if null); update `document.title`.
   - Otherwise: add `.no-offer`, which hides `[data-offer]` and shows `[data-no-offer]` (headline "Research Compounds, Tested").
   - If the figure changes after reveal, it logs `console.warn`.
3. **The CTA** is `cta_url` (or `fallbackUrl`) with **every incoming query param forwarded** (fbclid, gclid, utm_*…) except `lp`, which is always forced to the page's own slug.
4. **Indexing:** `<meta name="robots" content="noindex, follow">`, and `lang="en-CA"`.
5. **Key CSS:**
   - `.wrap` max-width 34rem, padding `clamp(1.5rem,6vh,4rem) 1rem 2rem`.
   - `.pane` white, 1px `#DCE7EB` border, 18px radius, card shadow, a 4px brand-rule `::before`, padding `2.25rem 1.5rem 1.75rem` (`3rem 3rem 2.25rem` at ≥640px).
   - h1 `clamp(2rem,8.5vw,3.25rem)`, weight 750, line-height 1.06, letter-spacing −0.03em.
   - `.hl` percent: `#1B5D83` text over a Mist `#BBD6D6` highlighter band from 64% to 92%.
   - `.code` chip: 1.5px dashed `#438B9E`, background `#F1F8F9`, 12px radius.
   - `.cta` pill: min-height 3.5rem, `#07203A` background, hover `#0E3F5F`, uppercase, 700 weight, 0.06em tracking, shadow `0 10px 24px -10px rgba(7,32,58,.45)`.
   - `.strip`: three columns, `#F1F8F9` background with `#E1EFF1` border.
   - `prefers-reduced-motion` disables transitions.

### Porting notes (aminocan-specific)

- **Skip `ALTER TABLE discount_codes`.** Aminocan already has both columns. Run the rest of both migrations.
- **Rename brand storage keys.** Change `vyta_lp`, `vyta_lp_seen` and `vyta_lp_arrived:`. Keep `?lp=`.
- **Adapt to aminocan's discount-code library.** Point imports at `lib/promos/discount-codes.ts` (`shapeDiscountCodeRow`, `lookupDiscountCode`, `firstOrderRejection`, `REJECTION_MESSAGES`, `eligibleSubtotal`). VYTA's `hasRestrictions`, `withoutRestrictions`, `RESTRICTIONS_NEED_MIGRATION` and `DISCOUNT_CODE_RESTRICTION_COLUMNS` do not exist in aminocan; `writeCode`'s retry can be dropped because the columns exist. `offerToCode` must target aminocan's `shapeDiscountCodeInput(body, partial=false)` and use `description` instead of `notes`. Verify field names against `lib/promos/discount-codes-admin.ts`.
- **Middleware.** Aminocan's middleware has diverged: it takes `(req, event)`, records affiliate link visits, has `?promo=` capture with a redirect, and uses first-referrer-wins for `ref`. **Add only** the `?lp=` block (cookie set, no redirect) after the attribution-cookie block. Do not adopt VYTA's ref-cookie changes.
- **Attribution.** Port the `landing_page` touch field and the `lp` cookie key into aminocan's `lib/analytics/attribution.ts`. In `attribution-server.ts`, port `VisitorContext.landingPage`, `landingPageOf`, and the retry-without-landing-columns write.
- **PromosContext and the nav.** Aminocan's `PromosContext` has `adOfferVisible` and `adPriceOf`, and `AdDiscountNotice` takes an `overlay` prop with white/emerald-300 variants. Add `landingOffer` to the context. In `useAdOfferNotice`, short-circuit to the landing offer first and add a `firstOrder` flag to the returned shape. **Keep aminocan's overlay styling.**
- **Checkout.** Aminocan's checkout already prefills from the `promo_code` cookie and has `decideCheckoutDiscounts` (`lib/promos/checkout-discounts.ts`). Integrate the landing auto-apply as an additional source, after the link code and the promo cookie (precedence is an open question), and the server fallback in `puramass/route.ts` before `lookupDiscountCode`. Aminocan's route currently returns 400 for any failing code, so add the `codeFromLanding` soft-fail branch.
- **Admin report revenue.** Aminocan stores the code share in `discount_code_cents` separately from `ad_discount_cents`, so `discount_given` should sum `ad_discount_cents + discount_code_cents` (and perhaps the cart-offer cents). VYTA sums only `ad_discount_cents` (see open questions).
- **Admin screen dependencies.** Port `adminFetch` and `fmtMoney` (from VYTA `components/admin/affiliates/api.ts`), or use aminocan `apiFetch`. Extract the inline restrictions UI from aminocan's `DiscountCodeModal` into a reusable `CodeRestrictionsFields`. Add the nav item to aminocan's Marketing group. Note that the aminocan nav already lists Discount Codes under Marketing.
- **Off-site page.** The `landing-page/` reference must be fully rebranded (logo assets, palette, copy, `api` host `https://www.aminocan.com/api/landing/`, "Ships from Canada" claims). It is optional for the port.
- **Tests.** Port `lib/promos/landing.test.ts` (14 tests).

### Open questions

- **Precedence vs aminocan's `promo_code` cookie.** Which wins when a visitor holds both an `?lp=` offer and a `?promo=` cookie? VYTA has no promo cookie.
- **`discount_given` undercounts.** VYTA sums only `puramass_orders.ad_discount_cents`. In VYTA's route, `ad_discount_cents` is "the whole saving" (line 833 comment), but in aminocan it is the ad discount only. Confirm the intended metric for the port.
- **Stale fine print.** `/api/landing/[slug]` does not set `ends_at` in the no-offer branch, and the landing HTML caches the fine print. Is there a requirement that the page hide "Ends …" after expiry? It is currently handled by `active:false`.
- **Daily tally time zone.** `landing_page_daily` uses `America/Toronto`. Confirm the same business time zone for Aminocan.
- **Admin permissions.** Should the analytics role see Landing Pages? VYTA leaves it admin/assistant only: GET allows assistant, writes are admin.

---

## 4. Smaller storefront diffs

Brand-copy-only swaps, to be listed and not ported:
- **AgeVerification:** identical in both repos.
- **LabResultsButton:** `text-bronze` → `text-teal-dark` only.
- **ChatBubble:** WhatsApp `+16473029495` → `+15147013824`, and `support@aminocan.com` → `support@vytabio.com`.
- **lab-results page:** bronze → teal classes only.
- **terms page:**
  - "Aminocan/aminocan.com" → "VYTA/vytabio.com" throughout.
  - The contact email `admin@aminocan.com` → `support@vytabio.com`.
  - The shipping-delay sentence drops "customs delays".
  - The "international site" paragraph is replaced by "VYTA ships to addresses within Canada only. We do not ship to any other country."
- **contact page:**
  - Phone and WhatsApp change to +1 (514) 701-3824.
  - Email changes.
  - The pattern dot fill `#1A1A1A` → `#07203A`.
  - Bronze classes become teal, with the CTA ShieldCheck in `text-teal-light`.
  - FAQ copy: shipping now says "We ship within Canada only — standard shipping takes 2-5 business days."
  - FAQ payment answer changes from "Interac e-Transfer and cryptocurrency…" to "We accept major credit and debit cards through our secure checkout partner — no card data ever touches our servers."

These are business-policy copy changes. Do not port them unless Aminocan's policy matches.

### `components/CustomerJourneyTracker.tsx` (behavioral diff)

- On the visit's entry page (`isEntry`, the first pathname seen by the component) it now also calls:
  - `reportLandingArrival()` (§3), and
  - `reportSiteVisit(pathname)` from `lib/analytics/site-visit.ts`. That posts `POST /api/site/visit` once per UTC day per browser (localStorage key `vyta_last_visit`), skips `/admin` and `/warehouse`, and is backed by `site-traffic-counters-migration.sql`.
- Both run before the existing consent-gated `trackActivity`.
- **Porting:** add the landing call with §3. `reportSiteVisit` belongs to the analytics section; port it only if that section is ported, otherwise leave the import out.

### `components/AdDiscountNotice.tsx` (behavioral diff)

- **New behavior:** a landing-offer override (§3, Storefront step 3) and the `firstOrder` wording flag.
- **Already handled in aminocan:** VYTA removed the `overlay` prop and aminocan's `adOfferVisible` gating. Aminocan's version is the newer one, so keep it and graft on only the landing branch and `firstOrder`.

### `app/contact`, `app/lab-results`, `app/terms`, `components/LabResultsButton.tsx`, `components/ChatBubble.tsx`, `components/AgeVerification.tsx`

No storefront-visible new behavior beyond the copy and colour swaps listed above.

### Open questions

- Should Aminocan adopt the "Canada only" shipping wording? Is the payment-methods FAQ still accurate for Aminocan (e-Transfer/crypto vs card)? This is business confirmation, not code.
