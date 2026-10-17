# Storefront design spec: VYTA features to port into aminocan-cad

> A build spec for the storefront features that `vyta-rtl-x` (VYTA) has and its base, `aminocan-cad` (Aminocan), lacks. The reader is a person or an AI porting those features into Aminocan **without** access to the VYTA code. Every value in this spec was read from source: Tailwind class plus resolved hex/px, real props, routes, columns and SQL. Anything that could not be confirmed appears under that feature's **Open questions**.
>
> Stack in both repos: Next.js 15.5 (App Router), Supabase, Tailwind 3.4, framer-motion 12, lucide-react. The spec compares VYTA `main` @ `6397ef9` with Aminocan `main` @ `216990e` (2026-10-14).

## How to read this

| Part | Covers |
|---|---|
| [Part 01](#part-01-global-shell-and-design-system) | Design tokens and globals, **AnnouncementBar** (the scrolling message bar), Navigation, Footer, brand lockup, Hero and hero media, root layout additions (Inter opsz, Klaviyo onsite, Whop pixel, site traffic counters), `robots.ts` / `sitemap.ts` |
| [Part 02](#part-02-home-page-redesign) | The redesigned home page: BestSellers, WhyChooseVyta, CollectionBanner, **Testimonials**, ServicePromises, plus the hidden ShowOurWork and WellnessFocus |
| [Part 03](#part-03-shop-product-page-cart-checkout-and-post-purchase) | Catalog, product page, cart, hosted checkout, guest-order claim, account orders |
| [Part 04](#part-04-content-and-marketing-surfaces) | CMS (articles, About, `/p/[slug]` pages), `/partners`, promo landing pages (`?lp=`), small storefront diffs |

Each feature in those parts follows the same outline: what's new compared with Aminocan, files, database (migration SQL), API routes, components, UI/UX (classes → hex/px, typography, responsive behaviour, states, animation), admin controls, porting notes, and open questions.

Markers used throughout:
- 🏷 **brand content — replace**: VYTA copy, IDs, images or storage keys. Never copy these verbatim.
- **AMC** means aminocan-cad.
- Each style is written as `vyta-class (hex) → AMC token`, so Aminocan keeps its own ink/bronze palette.

## The two repos have diverged in both directions

VYTA was forked from Aminocan, and **both** have moved on since. Aminocan has newer work of its own that VYTA lacks, including:
- ad-visitor pricing (`AdPrice`, `AdDiscountBadge`);
- `lib/promos/discount-codes.ts` and `checkout-discounts.ts`;
- the Canada-only checkout gate;
- `lib/storefront-settings.ts` with `/api/storefront-settings`;
- `toPublicProduct`;
- per-category cookie consent;
- referral QR modals.

**Port features, not files.** Copying a VYTA file over its Aminocan counterpart will usually regress Aminocan.

## Feature inventory

| Feature | Verdict | Where |
|---|---|---|
| **Announcement bar**: fixed, scrolling marquee or static; rotation every 7s; scheduling; dismissible; themes; admin editor with live preview | **PORT** | 01 §1 |
| Site traffic counter (anonymous daily visitor tally, no cookie wait) | **PORT** | 01 §6.5 |
| `robots.ts`; sitemap priorities and new routes | **PORT** | 01 §7 |
| Admin-editable hero image/video (`hero_image_url`, `hero_video_url`) | **PORT** into Aminocan's existing Hero | 01 §5 |
| Klaviyo onsite (`klaviyo.js` after consent, identify, events) | **PORT**, merged into Aminocan's per-category consent | 01 §6.3 |
| **Testimonials**: table, public feed, admin CRUD with preview, home carousel | **PORT** | 02 |
| BestSellers home grid with star ratings | **PORT** (keep `AdPrice`; fetch `url_slug`) | 02 |
| WhyChooseVyta / CollectionBanner / ServicePromises / ShowOurWork / WellnessFocus | **OPTIONAL redesign**: hard-coded brand copy and imagery | 02 |
| Server-rendered `/products` with metadata and ItemList JSON-LD | **PORT** (through `toPublicProduct`) | 03 §A |
| `?category=` deep link preselects the catalog filter | **PORT** | 03 §B |
| Star ratings on catalog cards (`useReviewStats`, `RatingSummary`) | **PORT** | 03 §C |
| Benefits editor (one point per row) and the `**bold**` parsing fix | **PORT** | 03 §D |
| "View Order Details": guest order claim via sign-in/sign-up | **PORT** (needs signed order links and an email button) | 03 §E |
| Correct "Pack of N" on the account order page | **PORT** | 03 §F |
| Checkout: required names, phone always required, "Free" flat-shipping copy | **OWNER DECISION**: conflicts with Aminocan's 2026-09-17 phone rule | 03 §G |
| **CMS**: block documents, `/articles`, `/about`, `/p/[slug]`, image upload, admin editors | **PORT** | 04 §1 |
| `/partners` application page (email only, rate-limited, honeypot) | **PORT** (rewrite program copy) | 04 §2 |
| **Promo landing pages**: `?lp=` → cookie → auto-applied code, visitor counts, admin | **PORT** (graft onto Aminocan's promo stack) | 04 §3 |
| Journey tracker landing and visit events; ad notice shows the landing offer | **PORT** with landing pages | 04 §4 |
| VYTA rebrand (navy/teal palette, Inter Display, light hero, maple-leaf badge, `BrandLockup`) | **DO NOT PORT** as brand; reuse only the structure | 01 §0, §4, §5 |
| Categories, pack badges, product/cart/checkout section toggles, cart upsells, limited-time offer, reviews API, PDP JSON-LD | **ALREADY IN AMINOCAN** (equal or newer) | 03 §Z, 02 "Section toggles" |
| VYTA checkout page, country picker, `lib/phone.ts`, storefront reads of `/api/admin/settings` | **DO NOT PORT**: regressions | 03 §Z |

## Recommended port order

Each step can ship on its own.

1. **Prerequisites** (04 §0.2):
   - `lib/api-fetch.ts` must not force a JSON content type on `FormData`.
   - Add `canManageContent` to `lib/permissions.ts` and `usePermissions`.
   - Add the admin sidebar group "Content".
   - Add the shared `lib/admin/content-auth.ts`.
2. **Announcement bar** (01 §1). This includes the Navigation change from `top-0` to `top: var(--announcement-h, 0px)`; without it, the nav hides behind the bar.
3. **Testimonials** (02), then **BestSellers** with ratings (02, 03 §C).
4. **Catalog**: SSR, `?category=`, card ratings (03 §A–C). Then the benefits editor (03 §D).
5. **Site traffic counter** and `robots.ts` / sitemap (01 §6.5, §7).
6. **CMS**: articles, About, pages (04 §1). Then switch on the nav and footer links to `/about` and `/articles` (01 §2–3).
7. **Landing pages** (04 §3) with the cart/checkout half (03 §H) and the journey-tracker and notice diffs (04 §4).
8. **Guest order claim** (03 §E–F). This needs an `ORDER_LINK_SECRET` and an email button.
9. **Optional, owner's call**:
   - hero media (01 §5);
   - Klaviyo onsite (01 §6.3);
   - home redesign sections (02);
   - `/partners` (04 §2);
   - checkout field rules (03 §G).

## Cross-cutting pitfalls

- **Colour tokens.** Aminocan has no custom `teal`, `navy`, `ocean`, `vital`, `aqua`, `mist` or `cloud` tokens. A copied `teal-50` silently compiles to Tailwind's *stock* teal, and `bg-teal` / `text-teal-dark` produce **no CSS at all**. Map every class through the token tables (01 §0.1, 03 §0, 04 §0.1).
- **Radius.** VYTA overrides `rounded-xl` to 14px and `rounded-2xl` to 18px. Aminocan uses Tailwind's defaults (12 / 16).
- **Never send whole product rows to the browser.** VYTA's catalog does; in Aminocan that would leak cost and supplier columns. Use `toPublicProduct`.
- **Storefront settings come from `/api/storefront-settings`**, never the admin settings route.
- **Account-specific values must not be copied:**
  - the Google site-verification token;
  - the Whop business ID;
  - the Klaviyo site ID;
  - the `vyta_*` localStorage and cookie keys;
  - WhatsApp and contact details;
  - Supabase storage image URLs.

  See 01 §6.6.
- **Shared analytics IDs.** Aminocan's built-in GTM and GA4 IDs are the same as VYTA's. Check that the env vars override them, or the two stores report into one property (01 §6).
- **Public read policies.** The RLS on the new tables (`announcements`, `testimonials`, `articles`, `site_pages`) lets anyone with the anon key read disabled or draft rows directly. The APIs filter them, but consider tightening the policies on port.
- **Ported migrations.** Rename them for Aminocan, and fix any error message that names the VYTA migration file.

## Known VYTA bugs to fix rather than copy

- Announcement start and end times are entered as `datetime-local` and parsed in the server's time zone (UTC). The admin speed slider stops at 60s while the API allows 120s. (01 §1)
- BestSellers doesn't select `url_slug`, so its product links go through a redirect. (02)
- Card star ratings stop after 50 products, because `/api/reviews?ids=` caps at 50 ids. (03 §C)
- `/articles?tag=` links are ignored by the index page. Article scheduling exists in the API but has no UI. (04 §1)
- The cart `ReferralCodeField` is rendered nowhere. The checkout has leftover debug logging. (03 §I, §G)


---

## Part 01: Global shell and design system

Scope: design tokens and globals, the AnnouncementBar (with its DB, API and admin editor), Navigation, Footer, BrandLockup / MapleLeaf, Hero (with hero media), `robots.ts` / `sitemap.ts`, and the root layout additions (Inter opsz, Google verification, Klaviyo onsite, Whop pixel, SiteTracking, site traffic counters).

Conventions in this section:
- **VYTA** means the `vyta-rtl-x` repo, the source of the features. **AMC** means the `aminocan-cad` repo, the port target.
- Paths are repo-relative and are the same in both repos unless noted.
- Each class is written as `vyta-class` (hex/px) followed by **→ AMC token**. The AMC token is the semantic equivalent to use so that Aminocan keeps its own brand.
- 🏷 **brand content — replace** marks VYTA-specific copy, IDs, assets or names.

---

### 0. Design tokens

#### 0.1 Colour tokens (`tailwind.config.ts` → `theme.extend.colors`)

Both repos have `ink`, `surface`, `line`, `primary`, `accent`. AMC also has `bronze`. VYTA replaces `bronze` with `navy`, `ocean`, `vital`, `aqua`, `mist`, `cloud` and `teal`.

| VYTA token | VYTA hex | Role in VYTA | AMC semantic equivalent (hex) |
|---|---|---|---|
| `navy` / `navy-900` | `#07203A` | Midnight Navy, the anchor / darkest surface | `ink` `#1A1A1A` |
| `navy-light` / `navy-800` | `#0A2F4D` | lighter navy | `ink/90` (no token) |
| `ocean` | `#0E3F5F` | Deep Ocean; hover for ink buttons (`hover:bg-ocean`) | `ink/90` (AMC convention `hover:bg-ink/90`) or `primary-800` `#3F3824` |
| `vital` | `#1B5D83` | Vital Blue | `bronze-dark` `#7D6F48` |
| `teal` (DEFAULT) / `teal-500` | `#438B9E` | Bio Teal, the interactive accent (toggles, focus, accents) | `bronze` `#9C8B5A` |
| `teal-dark` / `teal-600` | `#1B5D83` | AA-legible accent text/icons (`text-teal-dark`) | `bronze-dark` `#7D6F48` |
| `teal-light` / `teal-400` | `#6EB2B8` | accent on dark grounds (footer icons) | `bronze-light` `#B8A876` |
| `teal-50` | `#F1F8F9` | icon tile / hover tint | `bronze-50` `#FAF8F3` |
| `teal-100` | `#E1EFF1` | tint | `bronze-100` `#F2EEE3` |
| `teal-200` | `#C4DFE3` | tint | `primary-200` `#E5DCC7` |
| `teal-300` | `#9CCBD1` | tint | `primary-300` `#D4C9A8` |
| `teal-700` | `#0E3F5F` | — | `primary-700` `#5E5336` |
| `teal-800` | `#07203A` | — | `primary-800` `#3F3824` |
| `teal-900` | `#05182B` | — | `primary-900` `#1A1A1A` |
| `aqua` | `#6EB2B8` | Aqua | `bronze-light` `#B8A876` |
| `mist` | `#BBD6D6` | Mist; tagline text on dark (`text-mist`) | `bronze-light` `#B8A876` (on dark) / `bronze-100` `#F2EEE3` (as a fill) |
| `cloud` | `#F7FAFB` | page ground | `surface` `#F7F7F7` |
| `ink` | `#07203A` | text | `ink` `#1A1A1A` |
| `ink-muted` | `#56707F` | secondary text | `ink-muted` `#6E6E6E` |
| `ink-light` | `#6E8898` | tertiary text | `ink-light` `#8A8A8A` |
| `surface` | `#F7FAFB` | | `surface` `#F7F7F7` |
| `surface-2` | `#EDF3F5` | | `surface-2` `#F2F2F2` |
| `line` | `#DCE7EB` | borders | `line` `#C9CCD1` |
| `primary-*` / `accent-*` | `50 #F1F8F9 · 100 #E1EFF1 · 200 #C4DFE3 · 300 #9CCBD1 · 400 #6EB2B8 · 500 #438B9E · 600 #1B5D83 · 700 #0E3F5F · 800 #07203A · 900 #05182B` | legacy aliases | AMC's existing `primary-*`/`accent-*` bronze ramp; leave unchanged |

**Porting trap: Tailwind's default `teal` palette.** In AMC, `teal` is not overridden, so it resolves to Tailwind's stock palette:
- `bg-teal-50`, `text-teal-600` and similar classes compile silently to the wrong colours (`#f0fdfa`, `#0d9488`).
- `bg-teal`, `text-teal-dark` and `text-teal-light` do not exist, so they produce no CSS.

Every `teal*`, `navy*`, `ocean`, `vital`, `aqua`, `mist` and `cloud` class that is ported must be rewritten to the AMC token in the table above. The same applies to `bg-teal/10` and `border-teal/20` (use `bg-bronze/10` and `border-bronze/20`).

#### 0.2 Other `tailwind.config.ts` differences (VYTA only)

```ts
fontFamily: {
  sans:    ['var(--font-inter)', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
  display: ['var(--font-inter)', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
},
backgroundImage: {
  'brand-gradient':      'linear-gradient(135deg, #07203A 0%, #0E3F5F 45%, #438B9E 100%)',
  'brand-gradient-soft': 'linear-gradient(135deg, #F1F8F9 0%, #E1EFF1 50%, #FFFFFF 100%)',
  'brand-rule':          'linear-gradient(90deg, #07203A 0%, #1B5D83 50%, #6EB2B8 100%)',
},
boxShadow: {
  card:         '0 1px 2px rgba(7, 32, 58, 0.04), 0 8px 24px -12px rgba(7, 32, 58, 0.10)',
  'card-hover': '0 2px 4px rgba(7, 32, 58, 0.05), 0 16px 40px -16px rgba(7, 32, 58, 0.16)',
  focus:        '0 0 0 3px rgba(67, 139, 158, 0.28)',
},
borderRadius: { xl: '0.875rem' /*14px; stock is 12px*/, '2xl': '1.125rem' /*18px; stock 16px*/, '3xl': '1.5rem' /*24px = stock*/ },
```

AMC's `fontFamily.sans` is `['-apple-system','BlinkMacSystemFont','SF Pro Display','Segoe UI','Roboto','Helvetica Neue','sans-serif']`. AMC has no `display`, `backgroundImage`, `boxShadow` or `borderRadius` overrides. The `animation` and `keyframes` (`fade-in`, `slide-up`, `float`) and `backdropBlur.xs` are identical in both.

**Porting recommendation:**
- Add the `boxShadow` tokens with the rgb part swapped to AMC ink `rgba(26,26,26,…)`. `shadow-card` is used by ported components (for example, the Hero CTA).
- Port `fontFamily.display` only if the Inter font change is adopted (see §6.1).
- Make the `borderRadius` overrides optional. Leaving them out makes `rounded-xl` and `rounded-2xl` 2px tighter than in VYTA, which is acceptable.
- For `backgroundImage`, build AMC equivalents if needed: `brand-gradient` → `linear-gradient(135deg,#1A1A1A 0%,#3F3824 45%,#9C8B5A 100%)`.

#### 0.3 `app/globals.css` (full diff, VYTA vs AMC)

1. **`:root` variables.**
   - VYTA replaces AMC's `--color-bronze*` with `--color-navy #07203a`, `--color-ocean #0e3f5f`, `--color-vital #1b5d83`, `--color-teal #438b9e`, `--color-aqua #6eb2b8`, `--color-mist #bbd6d6` and `--color-cloud #f7fafb`.
   - It adds `--color-ink-light #6e8898`.
   - Semantic and legacy vars move to the VYTA values: `--foreground/--primary #07203a`, `--primary-dark #05182b`, `--secondary #56707f`, `--accent #438b9e`, `--border #dce7eb`, `--success #12876f` (AMC `#22c55e`).
   - **AMC: keep its own values.** Add only a `--color-teal`-equivalent if `.text-eyebrow` is ported (point it at `--color-bronze`).
2. **New `@layer base` heading rule** (VYTA only):
   ```css
   @layer base { h1,h2,h3,h4 { font-optical-sizing:auto; font-variation-settings:'opsz' 32; letter-spacing:-0.02em; } }
   ```
   This tightens every heading site-wide by -0.02em; Tailwind `tracking-*` classes still win. Port it only together with the Inter opsz font.
3. **Body background**: `linear-gradient(180deg,#ffffff 0%, var(--color-cloud) 50%, #ffffff 100%)`. AMC has `#f8f9fa` in the middle, which is equivalent, so keep AMC's.
4. **New utilities, inside `@layer utilities`** so that responsive variants work:
   ```css
   .font-display { font-family: var(--font-inter), Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                   font-optical-sizing:auto; font-variation-settings:'opsz' 32; letter-spacing:-0.02em; }
   .text-eyebrow { font-size:0.6875rem /*11px*/; font-weight:600; letter-spacing:0.14em; text-transform:uppercase; color: var(--color-teal); }
   .brand-rule   { height:3px; border-radius:999px; background: linear-gradient(90deg,#07203a 0%,#1b5d83 50%,#6eb2b8 100%); }
   .surface-navy { background-color: var(--color-navy);
                   background-image: radial-gradient(60rem 30rem at 15% -10%, rgba(67,139,158,0.35) 0%, transparent 60%),
                                     radial-gradient(45rem 25rem at 95% 110%, rgba(110,178,184,0.22) 0%, transparent 60%); }
   .surface-cloud { background-image: linear-gradient(180deg,#ffffff 0%, var(--color-cloud) 100%); }
   .molecular-grid { background-image: radial-gradient(circle, rgba(110,178,184,0.35) 1px, transparent 1px); background-size:28px 28px; }
   .hero-image-grade { filter: brightness(0.86) contrast(1.04) saturate(0.95); }   /* replaces AMC .hero-still-grade */
   ```
   AMC equivalents, swapping the RGB values:
   - `.surface-navy` → a new `.surface-ink`: `#1A1A1A` with blooms `rgba(156,139,90,0.35)` and `rgba(184,168,118,0.22)`.
   - `.brand-rule` → `linear-gradient(90deg,#1A1A1A,#7D6F48,#B8A876)`.
   - `.molecular-grid` → `rgba(184,168,118,0.35)`.
   - `.text-eyebrow` colour → `#9C8B5A`.
   - AMC's `.hero-still-grade` (`filter: saturate(0.4) sepia(0.45) hue-rotate(-10deg) brightness(0.62) contrast(1.08)`) is used by AMC's current Hero. Keep it if AMC's hero is kept.
5. **Changed utilities:**
   - `.glass` border: `rgba(7,32,58,0.06)` (AMC `rgba(0,0,0,0.05)`).
   - `.card-hover:hover`: box-shadow `0 2px 4px rgba(7,32,58,.05), 0 16px 40px -16px rgba(7,32,58,.16)` plus `border-color: rgba(67,139,158,.35)` (AMC: `0 2px 8px rgba(0,0,0,.06)`, no border change). This is a brand nuance and optional to port.
   - `::selection`: `rgba(67,139,158,0.22)` (AMC `rgba(156,139,90,0.2)`). Keep AMC's.
   - The focus `ring-color` follows the same pattern. Keep AMC's.
6. **Shared and unchanged** (already in AMC): `.text-balance`, `.tabular-nums`, `.scrollbar-hide`, `@keyframes ticker` + `.animate-ticker` (12s, or 30s at ≥768px, paused on hover), `@keyframes chromatogram-draw` + `.animate-chromatogram`, and the reduced-motion block.
7. **New: announcement marquee CSS**, appended at the end of the file outside any `@layer`. It is quoted verbatim in §1.

---

### 1. AnnouncementBar (sticky site-wide banner)

#### What's new vs AMC
AMC has no announcement bar. VYTA adds:
- a DB table of banners;
- a public feed and admin CRUD;
- an admin page with a live preview;
- a fixed bar above the nav. The bar can be static or a seamless marquee. It supports rotation, scheduling and per-browser dismissal. It also publishes its height as a CSS var so the nav stacks under it.

#### Files
| VYTA path | Kind | AMC counterpart |
|---|---|---|
| `components/AnnouncementBar.tsx` | client component | new |
| `lib/content/announcements.ts` | shared types/helpers (client and server safe) | new (AMC has no `lib/content/`) |
| `lib/content/blocks.ts` → `safeUrl()` only | helper | new. Copy just `safeUrl` (quoted below) if the content-blocks feature is not ported |
| `app/api/announcements/route.ts` | public GET | new |
| `app/api/admin/announcements/route.ts` | admin GET/POST | new |
| `app/api/admin/announcements/[id]/route.ts` | admin PATCH/DELETE | new |
| `lib/admin/content-auth.ts` | `resolveContentActor`, `requireContentEditor`, `contentErrorMessage` | new |
| `app/(admin)/admin/announcements/page.tsx` | admin editor (client) | new |
| `lib/permissions.ts` | `canManageContent`, `ANALYTICS_PAGES += '/admin/announcements'` | extend AMC `lib/permissions.ts` |
| `lib/hooks/usePermissions.ts` | exposes `canManageContent` | extend AMC hook |
| `app/(admin)/admin/layout.tsx` | sidebar group "Content" → `{ href: '/admin/announcements', label: 'Announcements', icon: Radio }` | extend AMC admin layout |
| `app/layout.tsx` | mounts `<AnnouncementBar />` | extend |
| `components/Navigation.tsx` | `style={{ top: 'var(--announcement-h, 0px)' }}` | extend |
| `app/globals.css` | `.vyta-marquee*` classes and keyframes | extend |
| `pack-options-content-migration.sql` §2 | table | new migration |

#### Database
Source: `pack-options-content-migration.sql`, section 2. That file also creates `products.pack_sizes`, `site_pages` and `articles`; extract only section 2 for this feature. The SQL below is verbatim:

```sql
CREATE TABLE IF NOT EXISTS announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message     text NOT NULL,
  -- Optional call to action rendered as a link at the end of the message.
  link_url    text,
  link_label  text,
  -- Presentation. `theme` picks one of the app's preset colour pairs
  -- (lib/content/announcements.ts); 'custom' uses bg_color / text_color.
  theme       text NOT NULL DEFAULT 'brand',
  bg_color    text,
  text_color  text,
  scrolling   boolean NOT NULL DEFAULT false,
  -- Marquee speed in seconds for one full pass (only read when scrolling).
  speed_seconds integer NOT NULL DEFAULT 24,
  dismissible boolean NOT NULL DEFAULT false,
  enabled     boolean NOT NULL DEFAULT false,   -- the storefront toggle
  sort_order  integer NOT NULL DEFAULT 0,
  starts_at   timestamptz,
  ends_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_announcements_enabled ON announcements (enabled);
CREATE INDEX IF NOT EXISTS idx_announcements_sort    ON announcements (sort_order);
CREATE OR REPLACE FUNCTION update_announcements_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS announcements_updated_at ON announcements;
CREATE TRIGGER announcements_updated_at BEFORE UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION update_announcements_updated_at();
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Announcements are viewable by everyone" ON announcements;
CREATE POLICY "Announcements are viewable by everyone" ON announcements FOR SELECT USING (true);
```

- All writes go through service-role API routes, which bypass RLS. Note that the public SELECT policy exposes disabled and draft rows to anyone holding the anon key who queries the table directly. The API itself filters them out.
- Readers: `GET /api/announcements` (`enabled=true`, then a JS schedule filter) and `GET /api/admin/announcements` (all rows).
- Writers: the admin POST, PATCH and DELETE routes. The `updated_at` trigger maintains `updated_at`.
- Admin audit entries go to the existing `audit_logs` table via `logAuditServer`, which already exists in AMC with the same signature.

#### Shared lib: `lib/content/announcements.ts` (verbatim semantics)
```ts
export type AnnouncementTheme = 'brand' | 'navy' | 'teal' | 'amber' | 'emerald' | 'custom';
export interface Announcement { id; message; link_url: string|null; link_label: string|null; theme: AnnouncementTheme;
  bg_color: string|null; text_color: string|null; scrolling: boolean; speed_seconds: number; dismissible: boolean;
  enabled: boolean; sort_order: number; starts_at: string|null; ends_at: string|null; created_at: string; updated_at: string; }

export const ANNOUNCEMENT_THEMES = [
  { key: 'brand',   label: 'Brand gradient', background: 'linear-gradient(90deg, #07203A 0%, #1B5D83 55%, #438B9E 100%)', color: '#FFFFFF' },
  { key: 'navy',    label: 'Midnight navy',  background: '#07203A', color: '#FFFFFF' },
  { key: 'teal',    label: 'Bio teal',       background: '#438B9E', color: '#FFFFFF' },
  { key: 'amber',   label: 'Amber',          background: '#B45309', color: '#FFFFFF' },
  { key: 'emerald', label: 'Emerald',        background: '#047857', color: '#FFFFFF' },
  { key: 'custom',  label: 'Custom colours', background: '#07203A', color: '#FFFFFF' },
];
```
🏷 The theme keys, labels and hexes are brand content. Suggested AMC set:
- `brand`: `linear-gradient(90deg,#1A1A1A 0%,#5E5336 55%,#9C8B5A 100%)`, text `#FFFFFF`
- `ink`: `#1A1A1A` / `#FFFFFF`
- `bronze`: `#9C8B5A` / `#FFFFFF`. White on `#9C8B5A` is about 3.3:1, which passes AA for large text only. Consider `#7D6F48`, about 5:1.
- keep `amber` and `emerald` as they are
- `custom` defaults to `#1A1A1A` / `#FFFFFF`

If keys are renamed, also update the `THEME_KEYS` coercion and the DB default `'brand'`.

Helper functions:
- `announcementStyle(a)`:
  - for `custom`, returns `{ background: a.bg_color || '#07203A', color: a.text_color || '#FFFFFF' }`;
  - otherwise returns the preset (unknown keys fall back to `ANNOUNCEMENT_THEMES[0]`).
  - The result is applied as inline `style` (`background`, not `backgroundColor`, so gradients work).
- `shapeAnnouncement(row)` normalises a raw row:
  - unknown theme → `'brand'`;
  - `speed_seconds` is clamped with `Math.min(120, Math.max(6, Math.round(n)))`, with default 24;
  - booleans are `=== true`;
  - empty strings become `null`.
- `isAnnouncementLive(a, now)` returns `enabled && !(starts_at > now) && !(ends_at < now)`.
- `liveAnnouncements(rows, now)` filters to a non-empty trimmed message and live rows, then sorts by `sort_order` ascending, then `created_at` ascending (string compare).
- `announcementPatch(body)` coerces input for create and update. It includes only keys present in the body:
  - `message` is trimmed;
  - `link_url`, `link_label`, `bg_color`, `text_color` are trimmed, with empty → `null`;
  - `theme` is trimmed, with empty → `'brand'`. It is **not** validated against the list;
  - `scrolling`, `dismissible`, `enabled` are converted with `Boolean()`;
  - `speed_seconds` uses the same clamp, with NaN → 24;
  - `sort_order` is rounded, with NaN → 0;
  - `starts_at` and `ends_at` are trimmed, then `new Date(v).toISOString()`, with empty → `null`.
- `safeUrl(raw)` (from `lib/content/blocks.ts`) returns the URL unchanged if it starts with `/` or `#`, matches `^https?://`, `^mailto:` or `^tel:`; otherwise it returns `''`.

#### API routes
| Method | Path | Auth | Request | Response | Notes |
|---|---|---|---|---|---|
| GET | `/api/announcements` | public | — | `200 { announcements: Announcement[] }` (live, sorted, shaped) | `.from('announcements').select('*').eq('enabled', true).order('sort_order')`, then `liveAnnouncements`. **Never errors.** A DB error or missing table returns `{ announcements: [] }`. There is no `revalidate` or `dynamic` export and no Cache-Control header; Next 15 route handlers are uncached by default. Uses `getSupabase()`, which is the service-role key if present, else anon. |
| GET | `/api/admin/announcements` | `Authorization: Bearer <supabase access token>`; role must be `admin` or `analytics` | — | `{ announcements }`, all rows | Ordered by `sort_order` ascending, then `created_at` **descending**. 403 `{error:'Unauthorized'}`; 500 `{error: contentErrorMessage(...)}` |
| POST | `/api/admin/announcements` | same | JSON with any `Announcement` field | `201 { announcement }` | 400 `Invalid JSON`; 400 `A banner needs a message` if `message` is empty or missing. Inserts `{ enabled: false, ...patch }`, so a banner is created disabled unless the body sends `enabled`. Audit: `announcement.create` |
| PATCH | `/api/admin/announcements/:id` | same | partial JSON | `{ announcement }` | 400 `Nothing to update` (empty patch); 400 if `message` is present but empty. Audit: `announcement.enable` or `announcement.disable` when `enabled` is in the patch, otherwise `announcement.update` |
| DELETE | `/api/admin/announcements/:id` | same | — | `{ success: true }` | Audit: `announcement.delete` |

`params` is a `Promise<{ id: string }>` (Next 15 style).

`contentErrorMessage(msg, table)` maps `/does not exist|schema cache|could not find the/i` to "The announcements table is missing — run pack-options-content-migration.sql." **Change the filename** to the AMC migration name.

`requireContentEditor(db, req)`:
1. Reads the `authorization` header and calls `db.auth.getUser(token)`.
2. Reads `customers.select('id, email, role').eq('id', user.id).single()`.
3. Returns `{role, actor_id, actor_email}` if `canManageContent(role)` (`admin || analytics`), else `null`.

#### Component: `AnnouncementBar` (client, no props)
Mounted in the root layout inside `<AuthGuard>`, immediately after `<ChunkErrorRecovery />` and **before `{children}`**.

**State and refs:** `announcements: Announcement[]`, `dismissed: string[]`, `index: number`, `height: number`, `copies: number` (initial 2), `barRef`, `marqueeRef`, `measureRef`.

**Hidden routes:** `HIDDEN_PREFIXES = ['/admin', '/warehouse', '/affiliate']`. A route is hidden when `pathname === prefix || pathname.startsWith(prefix + '/')`, and the component then renders `null`. Note that this also hides the bar on the public `/affiliate/signup` and `/affiliate/apply` pages.

**Data flow:**
1. On mount, if the route is not hidden, the component calls `fetch('/api/announcements', { cache: 'no-store' })` once per mount (dependency `[hidden]`). It maps rows through `shapeAnnouncement`. Any failure is silent and shows no banner.
2. `visible = liveAnnouncements(announcements).filter(a => !dismissed.includes(a.id))`. The schedule is re-checked on the client, so a tab left open past `ends_at` drops the banner on the next render.
3. `current = visible[index % visible.length]`.
4. **Rotation:** if `visible.length >= 2`, `setInterval(() => setIndex(i => i + 1), 7000)`. The swap is a hard cut with no transition, and only one banner shows at a time.

**Dismissal:**
- localStorage key `vyta_dismissed_announcements` 🏷 holds a JSON array of ids. Rename it, for example to `amc_dismissed_announcements`.
- It is read once on mount. Writes keep only the last 50 ids (`ids.slice(-50)`).
- Every storage access is wrapped in try/catch.
- Dismissal applies per banner id and is permanent for that browser.
- The dismiss button renders only when `current.dismissible`.

**Height publishing and spacer:**
- A `ResizeObserver` on `barRef`, plus `window.resize`, sets `height` and `document.documentElement.style.setProperty('--announcement-h', `${h}px`)`.
- It sets `'0px'` when there is no current banner and when the route becomes hidden.
- The component renders `<div style={{ height }} aria-hidden="true" />` as an **in-flow spacer** before the fixed bar. This pushes every page down by the bar's height, so each page's existing top padding for the fixed nav still works.
- Navigation reads the var (§2).

**Marquee fill:**
- Effect dependencies: `[current?.id, current?.message, current?.link_label]`.
- It measures the bar width (`marqueeRef`) and one natural-width copy (`measureRef`, an off-screen ruler), then sets `copies = Math.max(2, Math.ceil(barWidth / itemWidth) + 1)`.
- If either width is 0 it keeps the old value.
- A `ResizeObserver` watches both elements.

**Render (verbatim structure):**
```tsx
<>
  <div style={{ height }} aria-hidden="true" />
  <div ref={barRef} className="fixed inset-x-0 top-0 z-[60] text-xs sm:text-sm" style={style}
       role="region" aria-label="Site announcement">
    <div className="relative flex items-center">
      {current.scrolling ? (
        <div ref={marqueeRef} className="vyta-marquee flex-1 overflow-hidden py-2">
          <div className="vyta-marquee-track"
               style={{ animationDuration: `${current.speed_seconds * copies}s` }}>
            {Array.from({ length: copies * 2 }, (_, i) => (
              <span key={i} className="vyta-marquee-item" aria-hidden={i === 0 ? undefined : true}>
                {content}
              </span>
            ))}
          </div>
          <span ref={measureRef} className="vyta-marquee-measure" aria-hidden="true">{content}</span>
        </div>
      ) : (
        <div className="flex flex-1 flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-10 py-2 text-center">
          {content}
        </div>
      )}
      {current.dismissible && (
        <button onClick={dismiss} aria-label="Dismiss announcement"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 opacity-70 transition-opacity hover:opacity-100"
          style={{ color: style.color }}>
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  </div>
</>
```

`content` is `<><span>{message}</span>{cta}</>`. `cta` exists only when `safeUrl(link_url)` is non-empty:
- Internal links (`/`, `#`) use `next/link`.
- Other links use `<a target="_blank" rel="noopener noreferrer">`.
- Both have className `inline-flex items-center gap-1 font-semibold underline underline-offset-2`, label `link_label || 'Learn more'` and a lucide `ArrowRight` at `h-3.5 w-3.5` (14px).
- There are no per-message icons other than this arrow.

**Marquee CSS** (verbatim from `app/globals.css`, appended outside any layer):
```css
.vyta-marquee { position: relative; }
.vyta-marquee-measure {
  position: absolute; top: 0; left: 0; visibility: hidden; pointer-events: none;
  display: inline-flex; align-items: center; gap: 0.5rem; padding-inline: 2rem; white-space: nowrap;
}
.vyta-marquee-track { display: flex; width: max-content; animation: vyta-marquee-scroll linear infinite; }
.vyta-marquee-item  { display: inline-flex; align-items: center; gap: 0.5rem; padding-inline: 2rem; white-space: nowrap; }
@keyframes vyta-marquee-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@media (prefers-reduced-motion: reduce) {
  .vyta-marquee-track { animation: none; width: 100%; justify-content: center; }
  .vyta-marquee-item + .vyta-marquee-item { display: none; }
  .vyta-marquee-measure { display: none; }
}
```

**Mechanics summary:**
- The track holds 2 identical groups of `copies` items each. It translates by −50%, which is exactly one group, and loops linearly forever.
- Duration is `speed_seconds × copies`, so one message copy (its own width plus 64px of padding) passes in `speed_seconds` seconds. The velocity is independent of bar width.
- Spacing between copies is 64px: 32px `padding-inline` on each side. Message and CTA are 8px apart.
- **There is no pause on hover.** (The shared `.animate-ticker` has one; this marquee does not.)
- Reduced motion stops the animation and shows one centred copy.
- Rename the classes `vyta-marquee*` to a neutral prefix, for example `site-marquee*`, in the CSS, the bar and the admin preview.

**UI metrics:**
- Bar: `text-xs` (12px / 16px line height) on mobile, `sm:text-sm` (14px / 20px) from 640px. `py-2` (8px top and bottom), so the bar is about 32px tall on mobile and 36px from `sm` on a single line.
- A static (non-scrolling) message wraps (`flex-wrap`, `gap-y-0.5` = 2px) and the measured height grows. `px-10` (40px) on both sides leaves room for the dismiss X.
- Dismiss button: 8px from the right, 4px padding, 14px icon, 70% opacity going to 100% on hover. In marquee mode the text scrolls underneath it with no backing.
- `z-[60]` is above the nav (`z-50`).
- Colours come from inline style only, not Tailwind classes.

**Known behaviours:**
- The first render is `null` because the data is fetched on the client. The bar and its spacer therefore appear after hydration and push the page down, which causes CLS.
- No SSR.
- `index` is not reset when the visible set changes; it relies on the modulo.

#### Admin controls: `/admin/announcements` (client page)
**Gating:** `usePermissions().canManageContent`. Without it, the page shows a card: `rounded-xl border border-line bg-white p-8 text-center` with an `AlertCircle` icon and the text "Your role can’t manage storefront announcements."

**Header:**
- `h1.text-2xl.font-bold.text-ink` with a `Megaphone` icon in `h-6 w-6 text-teal-dark` → `text-bronze-dark`, followed by the text "Announcements".
- Subtext (`text-sm text-ink-muted`): "The sticky bar at the top of every storefront page. {N banner(s) is/are showing right now. | Nothing is showing right now.} Several live banners rotate every few seconds."
- Right-side button: `rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink/90` with a `Plus` icon (or a spinner) and the label "New banner".

**New banner action:** POSTs `{ message: 'Free shipping on orders over $300 — worldwide.', theme: 'brand', sort_order: rows.length }` 🏷 (the message is brand content; use AMC's real threshold). It prepends the new row. Toast: "Banner created — it is off until you switch it on."

**Alerts:**
- Error: `rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700` (`#fecaca` / `#fef2f2` / `#b91c1c`).
- Success: the same layout in emerald (`#a7f3d0` / `#ecfdf5` / `#047857`). It auto-clears after 3500ms.

**Loading and empty states:**
- Loading: a spinner card with "Loading banners…".
- Empty: a dashed card with a `Radio` icon, "No banners yet", and "Create one for a sale, a shipping notice or a compliance reminder. It stays off until you switch it on, so you can write and preview it first."

**One card per row** (`overflow-hidden rounded-xl border border-line bg-white`), with these parts:

1. **Live preview.** It uses the *draft* values and is styled with `announcementStyle({...row, ...draft})`, `text-xs sm:text-sm`. When `scrolling` is set, it renders the marquee with exactly 2 copies and `animationDuration: ${speed_seconds}s`. Otherwise it renders the static layout. The placeholder text is "Your announcement…". The CTA renders as a non-link span.
2. **Status strip** (`flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2.5`):
   - A pill (`rounded-full px-2.5 py-0.5 text-[11px] font-semibold`) with a 6px dot:
     - live: `bg-emerald-100 text-emerald-700`, dot `bg-emerald-500`, "Showing now";
     - enabled but outside its dates: `bg-amber-100 text-amber-700`, dot `bg-amber-500`, "On, outside its dates";
     - off: `bg-surface-2 text-ink-muted`, dot `bg-ink-muted/50`, "Off".
   - Schedule text (`text-[11px]`): "from {toLocaleString} · until {…}".
   - "Unsaved changes" chip (`bg-amber-100 text-amber-800`) when the draft differs from the row.
   - On the right:
     - **Toggle switch**: `role="switch"`, `relative h-6 w-11 rounded-full`; `bg-teal` (→ `bg-bronze`) when on, `bg-line` when off. Knob: `h-5 w-5 bg-white shadow`, `translate-x-[22px]` when on, `translate-x-0.5` when off. It **saves immediately** with `PATCH {enabled: !row.enabled}`. Toast: "Banner is now showing on the storefront" or "Banner hidden from the storefront".
     - Label "Show on storefront" (hidden below `sm`).
     - A delete icon button (`hover:bg-red-50 hover:text-red-600`).
3. **Editor grid** (`grid gap-4 p-4 lg:grid-cols-2`). Field class: `w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:ring-2 focus:ring-teal/40`. Label class: `block text-xs font-medium text-ink-muted mb-1`. Fields:
   - Message: textarea, 2 rows, full width.
   - Link URL (placeholder "/products or https://…") and Link label (placeholder "Shop now").
   - Colour: theme chips (`rounded-lg border px-3 py-1.5 text-xs`). Selected: `border-teal bg-teal/10 text-teal-dark`. Each chip has a 16px swatch. For `custom`, two `<input type="color">` controls (`h-8 w-12`) appear for Background and Text.
   - Checkbox "Scroll the message (marquee)" (`accent-teal`). When checked, a range input appears with **min 6, max 60** and the label "One full pass takes {n}s — lower is faster". The API allows up to 120.
   - Checkbox "Visitors can dismiss it".
   - Starts and Ends: `datetime-local` inputs.
   - "Order (lower shows first)": number input.
4. **Save bar** (`border-t bg-surface px-4 py-3`):
   - Hint: "Scheduling is optional — leave both dates empty to run until you switch it off."
   - "Revert" button (only when dirty).
   - "Save" button: `bg-ink text-white`, disabled unless dirty. It PATCHes the whole draft.

**Delete modal:** `fixed inset-0 z-[70] bg-black/50`, card `max-w-md rounded-2xl bg-white p-6`.
- Title: "Delete this banner?"
- Body: quotes the first 90 characters of the message, followed by "will be removed for good. If you only want it off the storefront, switch it off instead."
- Buttons: Cancel (`bg-surface`) and Delete (`bg-red-600`).

Requests use `apiFetch` from `lib/api-fetch.ts`, which exists in AMC with the same `apiFetch<T>(url, options)` signature and adds the bearer token.

#### Porting notes (order of steps)
1. Create `announcements-migration.sql` from §2 of the VYTA migration and run it.
2. Add `lib/content/announcements.ts` with AMC theme presets. Add `safeUrl`, either in `lib/content/blocks.ts` or inline.
3. Add `canManageContent` to `lib/permissions.ts` and `usePermissions`. Add `'/admin/announcements'` to AMC's `ANALYTICS_PAGES`; AMC currently lists only analytics, products, categories and marketing.
4. Add `lib/admin/content-auth.ts` and the 3 API route files.
5. Append the marquee CSS to `globals.css`, renamed.
6. Add `components/AnnouncementBar.tsx`:
   - rename the localStorage key;
   - consider adding `/[code]` affiliate short-link pages to the hidden list if they must not show the bar (AMC has `app/[code]/page.tsx`);
   - **add hover pause** only if desired; it is not in VYTA.
7. Mount it in `app/layout.tsx` before `{children}`.
8. **Navigation:** AMC uses `className="fixed top-0 w-full z-50"`. Remove `top-0` and add `style={{ top: 'var(--announcement-h, 0px)' }}`. With `top-0` left in place the nav would sit behind the bar. AMC's homepage transparent-overlay nav keeps working, because the spacer shifts the hero down.
9. Add the admin page and the sidebar entry. AMC's admin layout has no "Content" group yet; add one, or place the entry under "Marketing".
10. No other AMC storefront element uses `sticky top-*` or `fixed top-*` (verified by grep), so nothing else needs the var.

#### Open questions
- `datetime-local` values are sent to the server as `YYYY-MM-DDTHH:mm` with no offset. The server's `new Date(value).toISOString()` therefore interprets them in the **server's** timezone (UTC on Vercel), not the editor's. VYTA appears to have this bug; it has not been verified in production. Recommended fix: send `new Date(draft.starts_at).toISOString()` from the client.
- The PATCH route's `404 'Announcement not found'` branch is probably unreachable. `.single()` on zero rows returns an error, which becomes a 500. This has not been verified at runtime.
- The admin slider max (60s) differs from the API and renderer clamp (120s); it is unclear whether this is intentional.
- Should the bar be hidden on the AMC `/[code]` affiliate landing route? VYTA has no such route, so there is no precedent.

---

### 2. Navigation (`components/Navigation.tsx`, client)

#### What's new vs AMC
The diff is VYTA relative to AMC:
1. **Offset under the announcement bar:** `<nav className="fixed w-full z-50" style={{ top: 'var(--announcement-h, 0px)' }}>`. This replaces `fixed top-0`.
2. **Homepage transparent overlay removed.** AMC tracks `scrolled` (`window.scrollY > 24`) and an `overlay` state, and swaps every class to a white/transparent variant on `/`. VYTA is solid white on every route because its hero is light. **If AMC keeps its dark video hero, keep AMC's overlay logic.** If it adopts the VYTA light hero (§5), remove the logic.
3. **Logo:** AMC uses `<BrandLogo tone={overlay?'light':'dark'} className="h-9 sm:h-10 …" priority />`. VYTA uses `<BrandLockup name={config.store_name} tagline={config.store_tagline} logoUrl={config.logo_url} tone="light" size="md" className="transition-opacity duration-300 group-hover:opacity-90" />` inside `<Link href="/" className="group flex items-center" aria-label={config.store_name}>`, and pulls `config` from `useSiteConfig()`. **AMC: keep `BrandLogo`** (see §4).
4. **"Lab Results" link removed** from the desktop links and the mobile menu (it was between Products and Company). This is a product decision, not a requirement; see Open questions.
5. **Company dropdown now has live links** where AMC had disabled "About Us – Coming Soon" and "Certifications – Coming Soon" entries:
   - `/about`: `Users` icon, "About Us", subtitle "Who we are".
   - `/articles`: `BookOpen` icon, "Articles", subtitle "Research & guides".
   - Item class: `flex items-center gap-3 px-3 py-3 rounded-xl transition-colors hover:bg-surface`, with `onClick={() => setActiveDropdown(null)}`.
   - Icon tile: `w-10 h-10 rounded-xl bg-teal-50` (`#F1F8F9` → `bg-bronze-50`), icon `w-5 h-5 text-teal-dark` (`#1B5D83` → `text-bronze-dark`).
   - Title: `text-sm font-semibold text-ink`. Subtitle: `text-xs text-ink-muted`.
   - The mobile menu has the same two links: `flex items-center gap-3 px-4 py-3 text-ink-muted hover:text-ink hover:bg-surface rounded-xl` with a `w-4 h-4 text-teal-dark` icon.
   - **These depend on the `/about` and `/articles` routes, which AMC lacks** and which are owned by the content-pages and articles section of this spec. Do not add the links until those routes exist.
6. **"Proudly Canadian" badge** 🏷 (origin claim; AMC is also Canadian, so the porter decides whether to keep it):
   - Desktop, `xl` (≥1280px) and up only, at the far right after Login/Account: `<div className="hidden xl:flex items-center gap-3 ml-1"><div className="w-px h-6 bg-line" />` plus `<img src="/images/canada-flag.png" alt="Flag of Canada" className="w-6 h-4 object-cover rounded-[2px] border border-line" />` and `<span className="text-[10px] font-semibold leading-[1.15] text-ink">Proudly<br/>Canadian</span>`.
   - Mobile menu, below the auth buttons: `flex items-center justify-center gap-2 pt-3`, the same flag, and `text-[11px] font-semibold text-ink` "Proudly Canadian".
   - `public/images/canada-flag.png` (320×160) already exists in AMC.
7. **Colour swaps:** `bronze*` → `teal*`.
   - Affiliate link: `text-teal-dark hover:bg-teal-50` (AMC `text-bronze hover:text-bronze-dark hover:bg-bronze-50`). Keep AMC's.
   - Staff and warehouse menu items: `hover:bg-teal-50 text-teal-dark` (AMC bronze).
   - Mobile Admin and Warehouse buttons: `bg-teal-dark` (AMC `bg-bronze`).
   - Disclaimer beaker: `text-teal-dark` (AMC `text-bronze`).
8. `<AdDiscountNotice />` is called with no props in VYTA; AMC passes `overlay={overlay}`. Match whichever `AdDiscountNotice` signature AMC ends up with.

#### Full VYTA layout (for rebuilding)

**Bar:** `bg-white border-b border-line` > `max-w-7xl mx-auto px-5 sm:px-8 lg:px-12` (max 1280px; 20/32/48px gutters) > `flex justify-between items-center h-[72px]`.

**Desktop links** (`hidden lg:flex items-center gap-1`, from 1024px): Home, Products, Company▾, Contact, Affiliates.
- Link class: `px-4 py-2 rounded-lg text-sm font-medium text-ink-muted hover:text-ink hover:bg-surface`.
- The Affiliates link shows only when `siteConfig.ecommerceEnabled`. It goes to `/affiliate/dashboard` with label "My Affiliate" if the user is an affiliate, else `/affiliate/signup` with label "Affiliates".

**Dropdowns:**
- Open on hover; close after a 150ms delay.
- framer-motion: initial `{opacity:0,y:8,scale:0.96}` → `{1,0,1}`, `duration 0.15 easeOut`.
- Panel: `absolute left-0 top-full pt-2 w-64 z-[100]` > `bg-white rounded-2xl shadow-2xl shadow-black/20 border border-slate-200 p-2`.

**Right cluster** (`hidden lg:flex items-center gap-2`):
- Cart icon button (`w-10 h-10 rounded-lg`, 20px icon). Bump animation `scale [1,1.3,1]` over 0.35s, keyed by `bumpKey`. Badge: `absolute -top-0.5 -right-0.5 text-[10px] min-w-[18px] h-[18px] rounded-full bg-ink text-white font-bold`, showing "99+" above 99.
- `w-px h-6 bg-line` divider.
- Signed in: an account button (`px-4 py-2.5 rounded-lg text-sm font-medium bg-ink text-white`, or `bg-surface text-ink` when open) with a `w-52` dropdown containing Admin Dashboard (staff), Warehouse (warehouse role), My Orders (`/account/dashboard`) and Sign Out.
- Signed out: Login (`px-5 py-2.5 text-sm font-semibold rounded-lg bg-ink hover:bg-ink/90 text-white`).
- The Canada badge at `xl`.

**Mobile** (`lg:hidden`): cart plus a `Menu`/`X` toggle (24px icons). The menu animates `height 0 → auto` over 0.2s and is styled `bg-white border-b border-line`, `px-5 py-4 space-y-1`. It contains Home, Products, a "Company" eyebrow (`text-[10px] uppercase tracking-[0.15em]`) with About and Articles, Contact, the Affiliate link, and an auth block with full-width `rounded-xl py-3` buttons.

**Disclaimer row** (inside the nav, under the bar):
- Row: `text-center py-2 sm:py-1.5 bg-surface border-t border-line`.
- Text: `text-[10px] sm:text-[11px] tracking-wide inline-flex items-center gap-1.5 sm:gap-2 px-4 text-ink-muted`.
- Content: `Beaker w-3 h-3`, "Research Only", "•", "Shipping to Canada Only" (from `sm`), "• Canada Only" (mobile, hidden when `adOffer.show`), and `<AdDiscountNotice/>`. This content is unchanged from AMC.

Total nav height is about 72 + 31 = **≈103px** on mobile and about 72 + 29 = **≈101px** from `sm`. This is estimated, not measured. Pages compensate with their own top padding (for example, Hero `pt-24`/`sm:pt-32`).

#### Porting notes
- Apply the `top` style change first; it is required for the announcement bar.
- Apply items 5 and 6 only once `/about` and `/articles` exist.
- Do not replace `BrandLogo`.

#### Open questions
- Was removing "Lab Results" from the nav intentional for VYTA only? `/lab-results` is still in the VYTA sitemap. Recommendation: keep it in AMC.

---

### 3. Footer (`components/Footer.tsx`, client)

#### What's new vs AMC
Mostly a brand swap. Functional changes:
- **Two new Quick Links**, inserted after Products and before Contact: `/articles` "Articles" and `/about` "About Us". Both use `text-white/60 hover:text-white transition-colors text-sm`. They depend on those routes existing.
- The Instagram link gains `aria-label` and `aria-hidden` on the icon. This is an a11y improvement; port the pattern with an AMC label.

Brand swaps 🏷 — keep AMC's values:

| | AMC | VYTA |
|---|---|---|
| Footer ground | `bg-ink` (`#1A1A1A`) | `surface-navy` (`#07203A` + teal blooms) |
| Logo | `<BrandLogo tone="light" className="h-11" />` in `mb-5` | `<BrandLockup … tone="dark" size="md" />` in `mb-4` |
| Instagram URL | `https://instagram.com/Aminocan_` | `https://www.instagram.com/vytabiosciences/` |
| Support email | `support@aminocan.com` | `support@vytabio.com` |
| WhatsApp | `https://chat.whatsapp.com/DPYUObtP3XkGly20Bku9Lk` | `https://wa.me/15147013824` |
| Accent icons | `text-bronze` | `text-teal-light` |
| Affiliate link | `text-bronze hover:text-bronze-light` | `text-teal-light hover:text-white` |
| Disclaimer pill | `bg-bronze/10 border-bronze/20`, text `text-bronze/80` | `bg-teal/10 border-teal/20`, text `text-teal-light/90` |

**Layout** (identical in both, for reference):
- `max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 py-12 md:py-16` > `grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12 mb-10`.
- Brand column (`col-span-2`): logo, `t.footer.description`, three cert chips, and the Instagram square (`w-10 h-10 bg-white rounded-xl text-ink`).
  - Cert chips: `px-2.5 sm:px-3 py-1.5 bg-white/5 rounded-lg border border-white/10`, text `text-[10px] sm:text-xs text-white/60`. Labels: "GMP Certified", "HPLC Tested", "COA Included".
- Quick Links column. Heading class: `text-sm font-semibold text-white mb-4 uppercase tracking-wider`.
- Support column: email, WhatsApp ("Contact us on WhatsApp") and the "Shipping to Canada Only" line, each with an icon tile `w-8 h-8 bg-white/5 rounded-lg border border-white/10`.
- Bottom bar: `border-t border-white/10 pt-6 sm:pt-8`, with the copyright (`text-white/40 text-[10px] sm:text-xs`) and the "Research only. Not for human consumption." pill.

`LanguageContext` translations are identical in both repos.

#### Porting notes
Add the two links (once the routes exist) and the aria-label. Optionally replace `bg-ink` with an AMC `.surface-ink` (§0.3) for the bloom effect. Everything else stays AMC.

---

### 4. BrandLockup (`components/BrandLockup.tsx`) vs AMC `components/BrandLogo.tsx`; MapleLeaf icon

#### Comparison
- **AMC `BrandLogo`** (client) is the more mature of the two.
  - Props: `tone 'dark'|'light'`, `variant 'full'|'wordmark'`, `className` (height), `priority`.
  - It renders `config.logo_url ||` one of the PNG lockups from `lib/brand.ts` `BRAND_ASSETS` (`/brand/aminocan-logo*.png`, `-light` variants).
  - Alt text: `config.store_name` when a custom logo is set, else `BRAND_FULL_NAME`.
  - It is used in about 18 places (navigation, footer, auth pages, checkout, admin, warehouse layouts, PeptideLoader, LoginModal).
- **VYTA `BrandLockup`** (server-compatible, no hooks) is assembled from a mark image plus live text.

`BrandLockup` props (`BrandLockupProps`):

| prop | type | default |
|---|---|---|
| `name` | string | `'VYTA'` 🏷 |
| `tagline` | string \| null | `'Biosciences'` 🏷 |
| `logoUrl` | string \| null | — (replaces the mark image) |
| `tone` | `'light' \| 'dark'` | `'light'` |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` |
| `markOnly` | boolean | false |
| `className` | string | `''` |

`SIZES`:
- `sm`: mark `w-8 h-8` (32px), name `text-base` (16px), tagline `text-[9px]`
- `md`: `w-10 h-10` (40px), `text-lg` (18px), `text-[10px]`
- `lg`: `w-12 h-12` (48px), `text-xl` (20px), `text-[11px]`

Render:
- Outer: `inline-flex items-center gap-2.5`.
- `BrandMark`: `relative inline-flex shrink-0 items-center justify-center rounded-xl {mark}`. With `tone==='dark'` it adds `bg-white/95 p-1.5`, a light tile so the navy mark keeps its contrast. It contains `<img src={logoUrl || '/images/vyta-mark.png'} alt="" aria-hidden className="h-full w-full object-contain">` 🏷 (asset 512×473).
- Name: `font-display font-semibold leading-none tracking-[0.18em] {name}`, `text-white` on dark, `text-ink` on light.
- Tagline: `mt-1 font-medium uppercase leading-none tracking-[0.22em] {tagline}`, `text-mist` (`#BBD6D6`) on dark, `text-teal-dark` (`#1B5D83`) on light.
- Exports: `BrandMark` (named) and `BrandLockup` (default); type `BrandTone`.

**Porting recommendation:** **do not port `BrandLockup`.** It exists to render the VYTA mark and wordmark text and is brand-specific. Wherever a ported VYTA component uses `<BrandLockup … tone="dark">`, use `<BrandLogo tone="light" className="h-11" />`. Where it uses `tone="light"`, use `<BrandLogo tone="dark" className="h-9 sm:h-10" />`. The tone semantics are inverted between the two components: BrandLockup's `tone` describes the ground, BrandLogo's describes the ink. VYTA's `lib/brand.ts` is a different module (PDF branding, `BRAND = {name:'VYTA Biosciences', accent:'#1B5D83', payoutPrefix:'VY', …}`); do not copy it over AMC's `lib/brand.ts`.

#### MapleLeaf (`components/icons/MapleLeaf.tsx`; AMC has no `components/icons/`)
A lucide-compatible filled SVG. It takes `React.SVGProps<SVGSVGElement>`, accepts `strokeWidth` and ignores it. The code is verbatim:
```tsx
export default function MapleLeaf(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="none">
      <path d="M12 2l1.4 3.6 2.6-1-.8 3.6 3.4-.8-.8 2.6 3.8.6-2.2 2 1.6 1.8-4.8.8.4 2.2-3.7-.8V22h-1.8v-5.4l-3.7.8.4-2.2-4.8-.8 1.6-1.8-2.2-2 3.8-.6-.8-2.6 3.4.8-.8-3.6 2.6 1L12 2z" />
    </svg>
  );
}
export const MAPLE_RED = '#D52B1E';
```
It is used by the Hero trust badges and `components/home/WhyChooseVyta.tsx`. 🏷 It is brand or origin content, but AMC is also Canadian ("Canadian supplier — ships from Canada" is in AMC's own Hero ticker), so it can be ported as is.

---

### 5. Hero (`components/Hero.tsx`, client) and hero media

#### What's new vs AMC
This is a **complete redesign**, not an incremental change.

| | AMC Hero (441 lines) | VYTA Hero (≈240 lines) |
|---|---|---|
| Ground | dark (`bg-ink`, white text) | light frosted band, navy text |
| Media | hard-coded `HERO_VIDEO_URL` (Supabase storage MP4) over the still `/images/hero-bg.jpeg` with `.hero-still-grade`. Video only at ≥768px and when motion is allowed, with a pause/play button | still image only; **no video**. Desktop image is admin-editable (`site_settings.hero_image_url`); a portrait image ships for <1024px |
| Featured product | product card fetched from Supabase with an "Add" button that opens the purchase modal | none |
| Ticker | `TICKER_CLAIMS` marquee (`animate-ticker`) along the base | none |
| CTAs | "Shop" plus a secondary `/lab-results` | one: "Shop Peptides" |
| Trust | 3 chips (GMP / HPLC / 99%+) | 5-badge strip on frosted white along the base |
| Nav interplay | nav is transparent over the hero on `/` | nav is solid white |

The **reusable new capability** is the admin-editable hero image (DB column, admin UI, site-config field). Whether to replace AMC's hero visual design is a product decision (see Open questions).

#### Database: `hero-media-migration.sql`
```sql
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS hero_video_url text,
  ADD COLUMN IF NOT EXISTS hero_image_url text;
COMMENT ON COLUMN site_settings.hero_video_url IS
  'Home-page hero background clip (muted, looping MP4/WebM). NULL = still image only.';
COMMENT ON COLUMN site_settings.hero_image_url IS
  'Home-page hero still, and the mobile / reduced-motion / slow-connection fallback. NULL = the shipped image.';
```
- `hero_video_url` is **retired** in VYTA. No code renders it and the admin UI no longer edits it, although `PUT /api/admin/marketing` still accepts it and `SiteConfig` still carries it for round-tripping.
- Since AMC's hero *does* use video, AMC could make real use of `hero_video_url`: replace its hard-coded `HERO_VIDEO_URL` constant with `config.hero_video_url`, and expose a URL text field next to the image field.
- `hero_image_url` is read by `lib/site-config.ts` `shapeSiteConfig` (`cleanString(d.hero_image_url)`). `SITE_CONFIG_COLUMNS='*'` in both repos, so no select change is needed. It is served by `GET /api/site-config` and read on the client via `useSiteConfig().config.hero_image_url`.

#### Admin controls
- `app/api/admin/marketing/route.ts` (PUT, gated by `canManageMarketing`, admin and analytics) adds `'hero_video_url', 'hero_image_url'` to the trimmed-text loop (empty → `null`).
  - AMC's loop is currently `['store_name','store_tagline','logo_url','favicon_url']`; extend it.
- `app/(admin)/admin/marketing/page.tsx` adds a section after the branding section:
  ```tsx
  <section className="bg-white rounded-xl border border-line p-5 sm:p-6">
    <div className="flex items-center gap-2 mb-1"><Monitor className="w-5 h-5 text-teal-dark" />
      <h2 className="text-base font-bold text-ink">Home-page hero</h2></div>
    <p className="text-xs text-ink-muted mb-4">The background of the first screen visitors see, behind the frosted band the headline sits on, on laptops and desktops — a wide, landscape render works best. Phones and tablets use a portrait still shipped with the site. Leave this empty to use the shipped desktop image.</p>
    <div className="space-y-4"><ImageField label="Hero image" value={form.hero_image_url} disabled={!canManage}
      onChange={(url) => set('hero_image_url', url)} getToken={getToken} onError={setError} /></div>
  </section>
  ```
  - `hero_image_url: form.hero_image_url` is added to the PUT body.
  - `ImageField` already exists in AMC's marketing page and uploads via `POST /api/admin/products/upload`, which returns `{url}`.
  - Add `hero_image_url` (and optionally `hero_video_url`) to AMC's `SiteConfig` type, `DEFAULT_SITE_CONFIG` (`null`) and `shapeSiteConfig`.

#### Assets 🏷 (all brand content; replace)
| file | size | content |
|---|---|---|
| `public/images/hero-desktop.webp` | 1600×900, 320KB | VYTA-branded vials and boxes on dark rock by a mountain lake at sunset; `DEFAULT_HERO_IMAGE` |
| `public/images/hero-mobile.webp` | 900×1600, 160KB | portrait version of the same scene; `MOBILE_HERO_IMAGE`, used at ≤1023px, not admin-editable |
| `public/images/hero-bg.{jpeg,jpg,png}` | — | present in both repos; the AMC hero still |
| `docs/hero-media-prompt.md` | — | generation brief: lifestyle direction, subject centre-right, left half calm, top and bottom 15% clear, ~16% vertical parallax headroom, video 8–12s H.264 under 2MB, still 2400×1600 under 400KB. It describes the older video plus navy-graded design and is partly stale relative to the current code |

#### Component: full VYTA layout
Constants:
- `DEFAULT_HERO_IMAGE='/images/hero-desktop.webp'`
- `MOBILE_HERO_IMAGE='/images/hero-mobile.webp'`
- `GRAIN_TEXTURE` is an inline SVG `feTurbulence` data URI (fractalNoise, baseFrequency 0.9, numOctaves 2, desaturated, 160×160). It is identical to AMC's.
- Frosted-band gradients (verbatim):
  ```ts
  BAND_TINT_X = 'linear-gradient(90deg, rgba(255,255,255,0.88) 0%, rgba(255,255,255,0.84) 40%, rgba(255,255,255,0.7) 56%, rgba(255,255,255,0.46) 72%, rgba(255,255,255,0.22) 86%, rgba(255,255,255,0) 100%)'
  BAND_MASK_X = 'linear-gradient(90deg, #000 0%, #000 40%, rgba(0,0,0,0.85) 56%, rgba(0,0,0,0.6) 72%, rgba(0,0,0,0.28) 86%, transparent 100%)'
  BAND_TINT_Y = 'linear-gradient(180deg, rgba(255,255,255,0.56) 0%, rgba(255,255,255,0.5) 51%, rgba(255,255,255,0.18) 57%, rgba(255,255,255,0) 63%)'
  BAND_MASK_Y = 'linear-gradient(180deg, #000 0%, #000 51%, rgba(0,0,0,0.4) 57%, transparent 63%)'
  ```
- `TRUST_BADGES` 🏷 (icon, label with `\n` line breaks):
  - `ShieldCheck` "99%+\nPurity Guaranteed"
  - `FlaskConical` "Third-Party\nTested"
  - `FileText` "COAs\nAvailable"
  - `MapleLeaf` "Proudly\nCanadian" (accent, so drawn in `MAPLE_RED` `#D52B1E`)
  - `Truck` "Free, Fast &\nDiscreet Shipping"

Motion (framer-motion):
- `useScroll({target: sectionRef, offset:['start start','end start']})`
- `mediaY` 0% → 10%; `contentY` 0 → 60px; `contentOpacity` 1 → 0 over the first 60% of scroll progress.
- All three are disabled when `useReducedMotion()` is true.

Structure:
1. `<section className="relative lg:min-h-svh flex flex-col overflow-hidden bg-ink">`
2. The frame `div.relative.lg:static.flex-1.flex.flex-col.min-h-[90svh].lg:min-h-0` holds:
   - **Media:** `motion.div aria-hidden className="absolute inset-x-0 -inset-y-[8%]" style={{y: mediaY}}`. It contains `<picture><source media="(max-width: 1023px)" srcSet={MOBILE_HERO_IMAGE} /><img src={heroImageUrl} alt="" className="absolute inset-0 w-full h-full object-cover object-[center_75%] lg:object-center lg:hero-image-grade" /></picture>`, where `heroImageUrl = config.hero_image_url ?? DEFAULT_HERO_IMAGE`.
   - **Grain:** `absolute inset-0 opacity-[0.07] mix-blend-soft-light`, background `GRAIN_TEXTURE`.
   - **Scrims (lg only):**
     - `bg-gradient-to-r from-ink/30 via-ink/20 to-ink/10` = rgba(7,32,58,.30 → .20 → .10)
     - `bg-gradient-to-b from-ink/45 via-transparent to-ink/55`
     - These map to AMC ink rgba(26,26,26,…).
   - **Frosted band, mobile** (`absolute inset-0 lg:hidden backdrop-blur-2xl` = 40px blur): `backgroundImage: BAND_TINT_Y`, `maskImage` and `WebkitMaskImage: BAND_MASK_Y`, opacity bound to `contentOpacity`.
   - **Frosted band, desktop** (`absolute inset-y-0 left-0 hidden lg:block w-[78%] xl:w-[74%] backdrop-blur-2xl`): `BAND_TINT_X` and `BAND_MASK_X`, same opacity binding.
   - **Content:** `div.relative.flex-1.flex.items-center.w-full` > `motion.div` (style y and opacity) `w-full max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 pt-24 sm:pt-32 pb-[26svh] lg:pb-16`. Padding is 96px top on mobile, 128px from `sm`, bottom 26svh on mobile and 64px at lg. Inside it is `grid lg:grid-cols-12` > `motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} transition={{duration:0.5}} className="lg:col-span-7 xl:col-span-6"` containing:
     - Eyebrow: `<p className="text-eyebrow !text-teal-dark mb-3 sm:mb-4">Premium Peptides</p>` (11px, 600 weight, 0.14em, uppercase, `#1B5D83`; → `!text-bronze-dark`) 🏷
     - Heading: `<h1 className="font-display text-4xl sm:text-5xl lg:text-[3.2rem] font-bold text-ink leading-[1.06] mb-4 sm:mb-5">A Higher<br/>Standard for<br/>Your Wellness Journey</h1>`. Sizes are 36px, 48px from `sm` and 51.2px from `lg`, with line height 1.06. 🏷
     - Body: `<p className="text-base sm:text-lg text-ink/80 leading-relaxed max-w-md mb-7 sm:mb-8">Pure compounds. Verified quality. Trusted by a growing community across Canada.</p>` (16px, 18px from `sm`; max width 448px) 🏷
     - CTA: `<Link href="/products" className="w-full sm:w-auto"><button className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 bg-ink hover:bg-ocean text-white px-7 py-3.5 font-semibold text-sm rounded-full shadow-card transition-colors">Shop Peptides <ArrowRight className="w-4 h-4"/></button></Link>`. AMC: `hover:bg-ink/90`, and add the `shadow-card` token.
3. **Trust strip** (sibling after the frame):
   - Wrapper: `motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{duration:0.5, delay:0.3}} className="relative border-t border-white/40 bg-white lg:bg-white/75 backdrop-blur-md"`. Solid white on mobile, below the image; 75% white with a 12px blur overlaying the image base from `lg`, because the frame is `lg:static`.
   - List: `<ul className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 py-4 sm:py-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-5 sm:gap-y-6">`.
   - Each `li`: `flex flex-col items-center text-center gap-1.5 sm:gap-2`. The last one also gets `col-span-2 sm:col-span-1`.
   - Icon: `w-5 h-5 sm:w-7 sm:h-7 text-ink`, `strokeWidth={1.5}`, with style color `MAPLE_RED` when `accent`.
   - Label: `text-[10px] sm:text-xs font-medium text-ink leading-snug whitespace-pre-line`.

`.hero-image-grade` is a custom class inside `@layer utilities`, so the `lg:` variant works. It must be defined in globals.css (§0.3).

#### Porting notes
- **Minimum port** (recommended regardless of design): the `hero-media-migration.sql` columns, the `SiteConfig` fields, the admin marketing hero section and the API whitelist. Then in AMC's existing Hero:
  - `const heroStill = config.hero_image_url ?? '/images/hero-bg.jpeg'`;
  - `const heroVideo = config.hero_video_url ?? null`, replacing the hard-coded `HERO_VIDEO_URL`, and keep the video box in admin.
- **Full redesign port** (only if the product owner wants the light hero):
  - Rebuild with AMC tokens and AMC copy and imagery.
  - Remove the nav overlay logic.
  - Decide what happens to AMC's featured-product card, ticker and lab-results CTA, which VYTA dropped.
  - Supply AMC portrait and landscape images.
- In both cases, the nav now sits `--announcement-h` lower. The hero's top padding (`pt-24`/`pt-32`) is in-flow and is already pushed down by the bar spacer.

#### Open questions
- Should AMC adopt the VYTA hero design (light frosted band, no product card, no ticker) or keep its dark video hero and gain only admin-editable media? The spec cannot decide this.
- AMC needs its own mobile portrait asset if it adopts the `<picture>` split.

---

### 6. Root layout additions (`app/layout.tsx`)

#### 6.1 Inter with optical-size axis
```ts
const inter = Inter({ subsets: ['latin'], axes: ['opsz'], variable: '--font-inter', display: 'swap' });
// <body className={`${inter.variable} ${inter.className}`}>
```
AMC currently has `Inter({ subsets: ['latin'] })` and `<body className={inter.className}>`. It already renders Inter via the class, while its Tailwind `sans` stack lists system fonts but is overridden by the body class. What the VYTA change adds:
- the `--font-inter` CSS var, used by `fontFamily.sans/display` and `.font-display`;
- the `opsz` variable axis, which lets `font-variation-settings:'opsz' 32` produce the "Inter Display" cut for headings, `.font-display` and `BrandLockup`.

This is brand typography; adopt it only if AMC wants display-optical headings. If it does, port it together with the `@layer base` h1–h4 rule, `.font-display` and the `fontFamily` tokens. The change is low-risk. Note that `--font-inter` is defined on `<body>`, not on `:root`.

#### 6.2 Google Search Console verification 🏷 (do not copy the token)
In `generateMetadata()`: `verification: { google: 'o9_eT_n204rgAFQoJuAGpgIlh3XcKjMDtHZ4oKfpb6w' }`. This renders `<meta name="google-site-verification">` on every page. AMC must use its own token, or omit the field; making it an env var such as `GOOGLE_SITE_VERIFICATION` is recommended. The VYTA metadata description was also changed to Canada-specific copy 🏷; keep AMC's.

#### 6.3 Klaviyo onsite (`KLAVIYO_INIT_SNIPPET`, `lib/analytics/klaviyo-onsite.ts`, SiteTracking)

**In `<head>`**, rendered only when `klaviyo_public_key` is truthy and placed between gtag and GTM:
```tsx
{klaviyoId && <script dangerouslySetInnerHTML={{ __html: KLAVIYO_INIT_SNIPPET }} />}
```
`KLAVIYO_INIT_SNIPPET` is Klaviyo's **generic** object-initializer. It contains no account ID and is copied verbatim from `app/layout.tsx` line 62. It defines `window.klaviyo` as a Proxy that queues onto `window._klOnsite`; it makes no network calls and sets no cookies.

**`klaviyo.js` loader**, in `components/SiteTracking.tsx`:
```tsx
{shouldLoad && klaviyo && (
  <Script id="klaviyo-onsite" strategy="afterInteractive"
    src={`https://static.klaviyo.com/onsite/js/${encodeURIComponent(klaviyo)}/klaviyo.js?company_id=${encodeURIComponent(klaviyo)}`} />
)}
```

**Other SiteTracking diffs** (VYTA relative to AMC):
- `hasTracking = !!(gtm || ga4 || pixel || klaviyo)`.
- A mode effect:
  ```ts
  if (!klaviyo) setKlaviyoOnsiteMode('off');
  else if (shouldLoad) setKlaviyoOnsiteMode('on');
  else if (consent === 'denied') setKlaviyoOnsiteMode('off');
  else setKlaviyoOnsiteMode('pending');
  ```
- An identify effect: when `klaviyo && shouldLoad && customer?.email`, it calls `klaviyoIdentify({ email, first_name, last_name })` using `useCustomer()`.

**`lib/analytics/klaviyo-onsite.ts`** (client):
- Module state is `mode: 'pending'|'on'|'off'` (initially `pending`) plus a buffer capped at `MAX_BUFFERED = 20`.
- `setKlaviyoOnsiteMode(next)` flushes the buffer into `window._klOnsite` on `on` and drops it on `off`.
- `klaviyoTrack(metric, props)` pushes `['track', metric, props]`.
- `klaviyoIdentify({email, first_name?, last_name?})` lowercases and trims the email, then pushes `['identify', {...}]`.
- `forwardEcommerceToKlaviyo(name, params)` maps GA4 events as follows. `begin_checkout` and `purchase` are deliberately not forwarded because they are sent from the server.
  - `view_item` → `'Viewed Product'` with `{ProductName, ProductID, Variant, Categories[], Price, URL, Currency (default 'CAD')}`, plus `['trackViewedItem', {Title, ItemId, Categories, Url, Metadata:{Price}}]`.
  - `add_to_cart` → `'Added to Cart'` with `{$value, AddedItemProductName, AddedItemProductID, AddedItemVariant, AddedItemCategories, AddedItemPrice, AddedItemQuantity, CheckoutURL: origin+'/cart', Currency}`.
  - `view_cart` → `'Viewed Cart'` with `{$value, ItemNames[], Items[{ProductID, ProductName, Variant, Quantity, ItemPrice}], Currency}`.
- **`lib/analytics/ecommerce.ts`** change: `track()` now calls `forwardEcommerceToKlaviyo(name, params)` *before* the `mode === 'off'` early return, so Klaviyo has its own gate.

**Dependencies outside this section** (owned by the Klaviyo integration section):
- `klaviyo-integration-migration.sql` adds `site_settings.klaviyo_enabled, klaviyo_private_api_key, klaviyo_public_key, klaviyo_list_id, klaviyo_onsite_enabled, klaviyo_server_events_enabled, klaviyo_sync_signups`.
- `lib/klaviyo/settings.ts` provides `klaviyoOnsiteKey(row, fallback)`: it returns `fallback` if there is no public key, and returns the key only when `enabled && onsiteEnabled`. It also provides `KLAVIYO_PUBLIC_KEY_RE = /^[A-Za-z0-9]{4,12}$/`.
- `lib/site-config.ts` gets the `klaviyo_public_key` field.
- 🏷 Do **not** copy `BUILTIN_KLAVIYO_SITE_ID = 'SY9j8v'` from VYTA's `lib/site-config.ts`; that is VYTA's Klaviyo account. Use `NEXT_PUBLIC_KLAVIYO_SITE_ID` or `null`.

**Consent conflict (important).**
- AMC is *ahead* of VYTA here. AMC has per-category consent (`consent-categories-migration.sql`; `consent_first_party_required`, `consent_analytics_required`, `consent_ads_required`; `consentDefaultSnippet(categories)`). VYTA has a single `tracking_consent_required`.
- **Do not port VYTA's layout or SiteTracking consent code.** Port only the Klaviyo additions into AMC's per-category structure.
- Gate Klaviyo like the Meta Pixel, by the ads/marketing category: `const klaviyoAllowed = hydrated && !!klaviyo && (!adsNeedsConsent || consent === 'granted')`. Use that for the `<Script>`, the mode effect and identify.
- Add `klaviyo` to AMC's `hasTracking`.
- In AMC's layout, destructure `klaviyo_public_key` alongside the consent fields.

#### 6.4 Whop pixel 🏷 (account-specific; do not copy verbatim)
```tsx
// in <head>, after GTM, UNCONDITIONAL (not consent-gated, not config-driven)
<script dangerouslySetInnerHTML={{ __html: WHOP_PIXEL_SNIPPET }} />
```
- The snippet loads `https://t.whop.tw/s.js` and ends with `whop.setScope("biz_4uByt2hc4AZpRx");whop.track("page");`.
- `biz_4uByt2hc4AZpRx` is VYTA's Whop business ID.
- AMC should port this only if Aminocan has a Whop business. If it does:
  - put the ID in config (env `NEXT_PUBLIC_WHOP_BIZ_ID` or a `site_settings` column);
  - render the snippet only when the ID is set;
  - consider gating it behind ads consent, which VYTA does not do.
- The full snippet is in VYTA `app/layout.tsx` line 66.

#### 6.5 Site traffic counters (anonymous daily visitor tally)

**Purpose:** Admin → Analytics "Visitors" previously counted only `customer_activity` rows, and anonymous rows exist only after the visitor accepts the consent banner. This feature adds an identifier-free per-day tally that counts every browser once per UTC day.

**Database** (`site-traffic-counters-migration.sql`, verbatim-ish):
```sql
CREATE TABLE IF NOT EXISTS site_traffic_daily (
  day       DATE PRIMARY KEY,
  visitors  INTEGER NOT NULL DEFAULT 0
);
COMMENT ON TABLE site_traffic_daily IS 'Anonymous daily tally of storefront visitors. No identifiers.';
ALTER TABLE site_traffic_daily ENABLE ROW LEVEL SECURITY;   -- no policies: service role only

CREATE OR REPLACE FUNCTION site_traffic_bump() RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO site_traffic_daily (day, visitors)
  VALUES ((now() AT TIME ZONE 'UTC')::date, 1)
  ON CONFLICT (day) DO UPDATE SET visitors = site_traffic_daily.visitors + 1;
$$;
REVOKE ALL ON FUNCTION site_traffic_bump() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON FUNCTION site_traffic_bump() FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON FUNCTION site_traffic_bump() FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT EXECUTE ON FUNCTION site_traffic_bump() TO service_role; END IF;
END $$;
```
- Writer: `site_traffic_bump()` RPC, called from `POST /api/site/visit`.
- Reader: `app/api/admin/analytics/store/route.ts` `readSiteTraffic(fromDay, toDay)`, which runs `.from('site_traffic_daily').select('day, visitors').gte('day', fromDay).lte('day', toDay)`. On error it returns `null`, and the caller falls back to the existing logic.

**API: `POST /api/site/visit`** (`app/api/site/visit/route.ts`):
- Public with no body. It **always returns `204`** with `Cache-Control: no-store`.
- It uses a service-role client: `createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`.
- Bot filter: if the User-Agent matches `/bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|monitor/i`, it returns 204 without counting.
- Rate limit: `checkRateLimit(`site-visit:${getClientIp(req)}`, { max: 20, windowMs: 60_000 })` from `lib/rate-limit.ts`, which exists in AMC; when the limit is exceeded it returns 204 without counting.
- It then calls `db.rpc('site_traffic_bump')`. Errors matching `/site_traffic_bump|function|schema cache/i` (migration not run) are silent; other errors go to `console.error('[site-visit] counter bump failed:', …)`.

**Client: `lib/analytics/site-visit.ts`** (no `'use client'`; pure plus a browser guard):
- `SITE_VISIT_KEY = 'vyta_last_visit'` 🏷. Rename it, for example to `amc_last_visit`. It stores a `'YYYY-MM-DD'` UTC date.
- `STAFF_PREFIXES = ['/admin', '/warehouse']`. These are not counted, but `/affiliate` is.
- `shouldCountSiteVisit(pathname, local, today)` returns false for staff paths and false if the stored date equals today. Otherwise it stores today and returns true. If storage throws, the visit is still counted.
- `reportSiteVisit(pathname)`:
  - an in-memory `reported` flag guards against React dev double-effects;
  - `today = new Date().toISOString().slice(0,10)`;
  - it sends `fetch('/api/site/visit', { method: 'POST', credentials: 'omit', keepalive: true })` fire-and-forget.
- `lib/analytics/site-visit.test.ts` exists in VYTA; port it as well.

**Call site:** `components/CustomerJourneyTracker.tsx`, which exists in AMC. Inside its pathname effect, on the entry page only (`isEntry = lastPath.current === null`), it calls `reportSiteVisit(pathname)` **before** the consent-gated `trackActivity` call. VYTA also calls `reportLandingArrival()` there; that belongs to the landing-pages section.

**Analytics merge** (in VYTA `collectTraffic`; AMC has the same function at about line 926 without the tally):
```ts
const tally = paidOnly ? null : await readSiteTraffic(fromDay, toDay);
if (tally && tally.size > 0) {
  for (const [day, n] of tally) visitorsPerDay.set(day, Math.max(n, visitorsPerDay.get(day) ?? 0));
  let visitors = 0; for (const n of visitorsPerDay.values()) visitors += n;
  return { visitors, new_customers: registrationsRes.count ?? 0, perDay: visitorsPerDay };
}
```
- Paid-ads-scoped readers (the `analytics` role) keep the activity count, because a tally cannot be attributed to an ad.
- Range total = the sum of the daily figures, so returning visitors count once per day.
- In AMC, compute `visitorsPerDay` into a variable first; AMC currently builds the Map inline in the return.

#### 6.6 Account-specific IDs: summary of what must NOT be copied
| Item | VYTA value | Where |
|---|---|---|
| Google site verification | `o9_eT_n204rgAFQoJuAGpgIlh3XcKjMDtHZ4oKfpb6w` | `app/layout.tsx` metadata |
| Whop business | `biz_4uByt2hc4AZpRx` | `app/layout.tsx` `WHOP_PIXEL_SNIPPET` |
| Klaviyo Site ID fallback | `SY9j8v` | `lib/site-config.ts` `BUILTIN_KLAVIYO_SITE_ID` |
| localStorage keys | `vyta_dismissed_announcements`, `vyta_last_visit` | AnnouncementBar, site-visit |
| Contact info | `support@vytabio.com`, `wa.me/15147013824`, `instagram.com/vytabiosciences` | Footer |
| Brand assets | `/images/vyta-mark.png`, `vyta-logo.png`, `vyta-wordmark.png`, `hero-desktop.webp`, `hero-mobile.webp`, `favicon-maple.png` | `public/images` |

Observation: AMC's `lib/site-config.ts` already contains `BUILTIN_GTM_CONTAINER_ID = 'GTM-M2J3D7SG'` and `BUILTIN_GA4_MEASUREMENT_ID = 'G-F44F1BB1QV'`, the same values as VYTA. One of the two stores is therefore reporting into the other's GTM/GA4 property unless env vars override them. This is outside this section's scope but worth flagging to the owner.

#### Open questions (§6)
- Which consent category should Klaviyo fall under in AMC: ads/marketing (recommended), analytics, or first-party?
- Does Aminocan have Whop, a Klaviyo account and a Search Console token? Without each one, omit the corresponding snippet.

---

### 7. `app/robots.ts` (new; AMC has none) and `app/sitemap.ts` (changed)

#### robots.ts (VYTA, brand-neutral; port as is)
```ts
import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/config';
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: '*', allow: '/',
      disallow: ['/api/', '/admin', '/warehouse', '/account',
        '/affiliate/dashboard', '/affiliate/settings', '/affiliate/code', '/affiliate/login',
        '/login', '/signup', '/forgot-password', '/reset-password',
        '/cart', '/checkout', '/order', '/shipping-address', '/*?*ref='],
    }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
```
- `/affiliate/apply` and `/affiliate/signup` stay crawlable.
- `'/order'` also blocks `/order/track`.
- All the disallowed routes exist in AMC.
- AMC also has a root `app/[code]/page.tsx` (affiliate short code). Decide whether to disallow it; robots syntax cannot express a single-segment wildcard cleanly.
- AMC's `middleware.ts` matcher (`/((?!_next/static|_next/image|favicon.ico|api/).*)`) runs on `/robots.txt` and `/sitemap.xml`. Verify that AMC middleware does not redirect them; VYTA has the same matcher.

#### sitemap.ts changes
AMC already has `revalidate = 3600`, `getProductsForSitemap()` and `productPath()`. VYTA adds:
- a `STATIC_ROUTES` list with `priority` and `changeFrequency`:
  - `''` 1.0 daily
  - `/products` 0.9 daily
  - `/articles` 0.7 weekly
  - `/lab-results` 0.7 weekly
  - `/about` 0.5 monthly
  - `/contact` 0.5 monthly
  - `/partners` 0.5 monthly
  - `/terms` 0.3 yearly
  
  AMC has `['', '/products', '/lab-results', '/contact', '/terms']` with no priority or frequency.
- `lastModified(stamp)`, which returns a parsed Date, or `now` if the stamp is missing or invalid. Products: `lastModified(product.updated_at)`, `'daily'`, `0.8`.
- **Articles**: `getPublishedArticles()` (`lib/content/articles-server.ts`; `articles` table, `status='published'`, limit 200, live-filtered) → `/articles/${slug}`, lastModified `updated_at || published_at`, `'monthly'`, 0.6.
- **Site pages**: `getPublishedPageSlugs()` (`lib/content/pages-server.ts`; `site_pages` with `published=true`, limit 500, excluding system pages such as `about`) → `/p/${slug}`, `'monthly'`, 0.4.
- Both helpers are wrapped in React `cache()` and never throw; on error they return `[]`.

**Porting notes:** add `/articles`, `/about`, `/partners` and the article and page entries **only after** those routes and tables exist; they belong to the content and partners sections. `/partners` does not exist in AMC. Adding priority and changeFrequency to AMC's existing entries is safe right away.

---

### 8. Recommended port order for this section
1. Tokens: add the `boxShadow` tokens and the needed utilities (`.text-eyebrow`, `.surface-ink`, `.hero-image-grade` if needed) with AMC colours. Do not import VYTA colour names.
2. `robots.ts`, then the safe part of the sitemap (priorities).
3. Site traffic counters: migration, `/api/site/visit`, `site-visit.ts` plus its test, the `CustomerJourneyTracker` call and the analytics merge.
4. Announcements: migration, lib, permissions, API, CSS, bar, layout mount, nav `top` var, admin page and sidebar.
5. Hero media columns, site-config fields, admin hero section, and wiring into AMC's existing Hero (image and video).
6. Klaviyo onsite: after the Klaviyo settings migration from the Klaviyo section, merged into AMC's per-category consent.
7. Optional, owner decisions: Inter opsz typography, the VYTA light hero redesign, Proudly Canadian nav badge, About/Articles nav and footer links (after the content routes ship), Whop pixel, Search Console token.


---

## Part 02: Home page redesign

Scope: `components/home/*` in vyta-rtl-x (BestSellers, WhyChooseVyta, CollectionBanner, Testimonials, ServicePromises, plus the hidden ShowOurWork and WellnessFocus), what feeds them, how admins control them, and how the old home components (`ProductTicker`, `Products`, `Features`, `LabResultsShowcase`) compare across the two repos. Navigation, Hero and Footer are covered in another section.

Stack is the same in both repos: Next 15.5, Tailwind 3.4.18 (default breakpoints `sm` 640px, `md` 768px, `lg` 1024px), framer-motion ^12.23.24, lucide-react ^0.546.0.

---

### 0. Page composition and shared conventions

#### Page order

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

#### Shared section shell (all new sections except Testimonials and ServicePromises)

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

#### Token map: vyta class → hex → aminocan-cad semantic equivalent

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

#### BestSellers

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

#### WhyChooseVyta

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

#### CollectionBanner

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

#### Testimonials

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

#### ServicePromises

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

#### ShowOurWork (hidden in vyta)

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

#### WellnessFocus (hidden in vyta)

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

### Legacy home components: diff vyta vs aminocan-cad

| File | Rendered in vyta? | Rendered in aminocan? | Diff summary |
|---|---|---|---|
| `components/ProductTicker.tsx` | No | No (dead in both) | aminocan imports `AdPrice` and renders `<AdPrice amount={product.price} strikeClassName="text-white/30"/>`; vyta renders a plain `${product.price.toFixed(2)}`. **aminocan is ahead.** |
| `components/Products.tsx` | No | Yes | aminocan has `AdPrice`/`AdDiscountBadge` (ad-visitor welcome discount; badge `absolute top-2 sm:top-3 right-2 sm:right-3`) and none of the following. vyta adds `pack_sizes, pack_options` to the select and shows the largest pack's `compareAt` struck through (`<span class="ml-1 line-through">`) beside "Pack of N · $X", without `tabular-nums`. Otherwise only `bronze`→`teal-dark`/`teal-50` recolours. **No new storefront behaviour for aminocan beyond the pack compare-at strikethrough**, which depends on vyta's `largestPackFor` returning `compareAt` (see the pricing/pack spec section). |
| `components/Features.tsx` | No | Yes | Colour-only: `bronze`→`teal-dark` on light surfaces, `bronze`→`teal-light` on dark, `hover:text-bronze-light`→`hover:text-teal-light`. No behaviour change. |
| `components/LabResultsShowcase.tsx` | No | Yes | Colour-only: `bronze`→`teal`/`teal-light`, SVG strokes `#B8A876`→`#6EB2B8` and `#9C8B5A`→`#438B9E`, CTA `bg-bronze hover:bg-bronze-light`→`bg-teal-light hover:bg-mist`. The video URL filename changed (`…glowing_bronze-gold_line…mp4` → `…glowing_teal-gold_line…mp4`, both on aminocan's `swpcvpkcfxihxmjpjqow` bucket); it is **brand content**. No behaviour change. |

Net: vyta brought **no new behaviour** into these four files that aminocan lacks, apart from the pack compare-at strikethrough in `Products`. aminocan's `AdPrice`/`AdDiscountBadge` must be kept, and should be carried into `BestSellers`.

---

### Section toggles: vyta vs aminocan-cad `lib/storefront-settings.ts`

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

### Open questions (consolidated)

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


---

## Part 03: Shop, product page, cart, checkout and post-purchase

Scope: what `vyta-rtl-x` (VYTA) has in the catalog, product page, cart, hosted checkout and customer order pages that `aminocan-cad` (Aminocan) does **not**. Every claim below was checked against both repos by `diff`. Anything not verified is listed under **Open questions**.

**Main finding: most of this area is already in Aminocan, and often in a newer form.** Aminocan already has its own copies of the cart upsells, the limited-time offer, the pack-option badges, the product-section toggles, the PDP server shell and JSON-LD, the reviews API (including `?ids=` rollups), the price refresh in `CartContext`, and the Canada-only checkout. It also has `AdPrice`, which VYTA lacks. Only a short list of features is actually new in VYTA (§A–§H). §Z lists what must **not** be ported, and why.

---

### 0. Conventions used in this section

#### Token map (VYTA class → hex → Aminocan class → hex)

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

#### Status legend
- **PORT**: new in VYTA. Build it in Aminocan.
- **ALREADY**: Aminocan already has it, equal or newer. Do nothing.
- **DO NOT PORT**: VYTA-only, but a regression or VYTA-specific.

#### Summary

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

#### A. Server-rendered catalog page (SSR + ItemList JSON-LD + metadata)

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

#### B. `?category=` deep-link preselects the catalog filter

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

#### C. Star ratings on catalog cards

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

#### D. Benefits list editor + benefits parsing fix

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

#### E. "View Order Details" → sign in / sign up → claim the guest order

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

#### F. Account order page: correct pack label (and auth wait)

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

#### G. Hosted checkout: required names, phone always required, free-flat copy

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

#### H. Landing-page offer on the cart and checkout (storefront half only)

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

#### I. Cart "Add a referral code" field (orphan in VYTA)

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

#### J. PDP cosmetic deltas (optional)

VYTA `ProductDetailClient.tsx` vs Aminocan. The two are otherwise structurally the same: same sections, same pack picker, same toggles. Aminocan's is **newer**: it has `AdPrice` in the headline, the line total and bac-water; an Escape key that closes the COA modal; `purityLabel` from `product.purity`; the `BAC_WATER_SLUG` constant; and `PublicProduct` typing.
- **Eyebrow above the H1** (VYTA only): `<p className="font-mono text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.18em] text-teal-dark mb-1.5 sm:mb-2">Research Grade Peptide Blend</p>`. That is monospace, 10px (11px from `sm`), letter-spacing 0.18em, `#1B5D83`. Brand content — replace; it is also inaccurate for single compounds.
- The buy block wrapper is `mt-auto pt-4 sm:pt-6 border-t border-line`, so it bottom-aligns in the right column (Aminocan has no `mt-auto`).
- The `LabResultsButton` beside Add to Cart is hidden in VYTA. Aminocan keeps it; keep Aminocan's.
- Assurance copy differs (VYTA "99% Purity" is hard-coded; Ships from Canada / "Fast & Discreet"). Brand content — keep Aminocan's.
- `ProductInfoTabs.tsx` and `ProductReviews.tsx` differ only in copy and tokens (VYTA's testing and shipping copy, e.g. "Mass-spectrometry identity confirmation on every lot", "same business day… daily cut-off"). Brand content — do not port.

---

#### Z. In scope but ALREADY in Aminocan, or DO NOT PORT

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

### Open questions (consolidated)

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


---

## Part 04: Content and marketing surfaces

Scope: features that exist in `vyta-rtl-x` and not in `aminocan-cad`. These are the CMS (block documents, articles, editable site pages), the `/partners` page, off-site promo landing pages, and the small storefront diffs (contact, lab results, terms, chat, journey tracker, ad notice).

Everything below was read from source. Anything I could not confirm is listed under **Open questions**.

---

### 0. Shared conventions for this section

#### 0.1 Design token map (VYTA → Aminocan)

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

#### 0.2 Helper prerequisites in aminocan-cad (all verified)

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

### 1. CMS: content-block documents, articles, editable site pages

#### What's new vs aminocan-cad

Aminocan has none of the following:
- `/about`, `/articles`, `/articles/[slug]` and `/p/[slug]`.
- The `site_pages` and `articles` tables.
- The block editor and the content image upload.

Its `Navigation` "Company" dropdown shows **About Us — Coming Soon** and **Certifications — Coming Soon** as disabled rows. VYTA replaces them with live **About Us** ("Who we are") and **Articles** ("Research & guides") links. Aminocan's Footer has no Articles or About links.

Aminocan does have `components/content/RichText.tsx`, used for product copy; the diff is in §1.6.

#### Files (VYTA)

| Area | Files |
|---|---|
| Storefront | `app/about/page.tsx`, `app/articles/page.tsx`, `app/articles/[slug]/page.tsx`, `app/p/[slug]/page.tsx`, `app/sitemap.ts` |
| Components | `components/content/BlockRenderer.tsx`, `RichText.tsx`, `ArticleCard.tsx`, `ArticleIndex.tsx`, `SitePageView.tsx` |
| Lib | `lib/content/blocks.ts`, `articles.ts`, `articles-server.ts`, `pages.ts`, `pages-server.ts`, `lib/admin/content-auth.ts` |
| Public API | `app/api/articles/route.ts`, `app/api/site-pages/[slug]/route.ts` |
| Admin API | `app/api/admin/articles/route.ts`, `app/api/admin/articles/[id]/route.ts`, `app/api/admin/site-pages/route.ts`, `app/api/admin/site-pages/[slug]/route.ts`, `app/api/admin/content/upload/route.ts` |
| Admin UI | `app/(admin)/admin/articles/page.tsx`, `app/(admin)/admin/articles/[id]/page.tsx`, `app/(admin)/admin/pages/page.tsx`, `app/(admin)/admin/pages/[slug]/page.tsx`, `components/admin/content/BlockEditor.tsx`, `ContentPreview.tsx`, `ImageField.tsx`, `RichTextField.tsx` |
| SQL | `pack-options-content-migration.sql`, sections 3 (`site_pages`) and 4 (`articles`). Section 1 (`products.pack_sizes`) and section 2 (`announcements`) belong to other features. |

#### Database (verbatim from `pack-options-content-migration.sql`)

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

#### 1.1 Block document model (`lib/content/blocks.ts`)

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

#### 1.2 BlockRenderer (`components/content/BlockRenderer.tsx`, `'use client'`)

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

#### 1.3 Storefront pages

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

#### API routes

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

#### Components — admin

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

#### Admin controls (screens)

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

#### Porting notes

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

#### Open questions

- **`/articles?tag=X` deep links are ignored.** `ArticleIndex` initialises `tag` to `''` and never reads `useSearchParams`, so tag links from the article page land on an unfiltered index. Port as-is or fix?
- **RLS exposes drafts.** The policy `FOR SELECT USING (true)` on `articles` and `site_pages` lets the anon key read drafts and scheduled posts directly through PostgREST. The API filters them, but the table does not. Tighten to `USING (status='published')` / `USING (published)` for aminocan?
- **No scheduling UI.** The article builder has no `published_at` control, although the API supports backdating and scheduling. Confirm none is wanted.
- **Announcements and testimonials are not specified here.** `lib/content/announcements.ts` and `testimonials.ts` and their admin screens are under `lib/content/**` but are homepage features. They are assumed to be specified in another section.
- **`getSupabase()` differs.** Aminocan's version throws when `SUPABASE_SERVICE_ROLE_KEY` is missing outside the build phase. The content readers catch that and fall back. Confirm acceptable.

---

### 2. Partner program page (`/partners`)

#### What's new vs aminocan-cad

A public marketing landing page for the affiliate/partner program, with an application form that **emails** the team. It does not create an affiliate account and **does not write to the database**. There is **no admin view**.

Aminocan's closest existing surfaces are its Footer link to `/affiliate/signup` (`text-bronze`) and `/api/affiliate-requests`. VYTA does not link to `/partners` from Navigation or Footer; only the sitemap lists it.

#### Files

- `app/partners/page.tsx` (server component, static)
- `app/partners/PartnerApplicationForm.tsx` (`'use client'`)
- `app/api/partner-applications/route.ts`

#### Database

None.

#### API

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

#### Components / UI (all on `<main class="min-h-screen bg-white">` with Navigation and Footer)

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

#### Admin controls

None. Applications arrive only by email.

#### Porting notes

- Reuse `sendMail`, swap `vytaShell` for `aminocanShell`, and add the `PARTNER_APPLICATION_EMAIL` env var with an Aminocan default.
- All headline, step and program copy is **brand content — replace**, including the commission, discount and sprint values, "Ships across Canada", and "e-Transfer". Confirm the Aminocan program terms with the owner.
- On aminocan, `bg-brand-gradient` maps to `bg-ink`. Teal accents map to bronze.

#### Open questions

- Should aminocan's version store applications (for example in its existing `referral_code_requests` / affiliate-requests flow) or deep-link to `/affiliate/signup`, instead of email-only?
- Should `/partners` be linked from Footer or Navigation? VYTA does neither; aminocan's Footer currently links `/affiliate/signup`.

---

### 3. Promo landing pages (off-site page → `?lp=` → auto-applied discount code)

#### What's new vs aminocan-cad

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

#### Files (VYTA)

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

#### Database

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

#### Cookie, storage and slug behavior

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

#### API routes

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

#### Storefront behavior: how the discount is applied

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

#### Admin UI

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

#### Off-site reference page (`landing-page/index.html`)

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

#### Porting notes (aminocan-specific)

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

#### Open questions

- **Precedence vs aminocan's `promo_code` cookie.** Which wins when a visitor holds both an `?lp=` offer and a `?promo=` cookie? VYTA has no promo cookie.
- **`discount_given` undercounts.** VYTA sums only `puramass_orders.ad_discount_cents`. In VYTA's route, `ad_discount_cents` is "the whole saving" (line 833 comment), but in aminocan it is the ad discount only. Confirm the intended metric for the port.
- **Stale fine print.** `/api/landing/[slug]` does not set `ends_at` in the no-offer branch, and the landing HTML caches the fine print. Is there a requirement that the page hide "Ends …" after expiry? It is currently handled by `active:false`.
- **Daily tally time zone.** `landing_page_daily` uses `America/Toronto`. Confirm the same business time zone for Aminocan.
- **Admin permissions.** Should the analytics role see Landing Pages? VYTA leaves it admin/assistant only: GET allows assistant, writes are admin.

---

### 4. Smaller storefront diffs

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

#### `components/CustomerJourneyTracker.tsx` (behavioral diff)

- On the visit's entry page (`isEntry`, the first pathname seen by the component) it now also calls:
  - `reportLandingArrival()` (§3), and
  - `reportSiteVisit(pathname)` from `lib/analytics/site-visit.ts`. That posts `POST /api/site/visit` once per UTC day per browser (localStorage key `vyta_last_visit`), skips `/admin` and `/warehouse`, and is backed by `site-traffic-counters-migration.sql`.
- Both run before the existing consent-gated `trackActivity`.
- **Porting:** add the landing call with §3. `reportSiteVisit` belongs to the analytics section; port it only if that section is ported, otherwise leave the import out.

#### `components/AdDiscountNotice.tsx` (behavioral diff)

- **New behavior:** a landing-offer override (§3, Storefront step 3) and the `firstOrder` wording flag.
- **Already handled in aminocan:** VYTA removed the `overlay` prop and aminocan's `adOfferVisible` gating. Aminocan's version is the newer one, so keep it and graft on only the landing branch and `firstOrder`.

#### `app/contact`, `app/lab-results`, `app/terms`, `components/LabResultsButton.tsx`, `components/ChatBubble.tsx`, `components/AgeVerification.tsx`

No storefront-visible new behavior beyond the copy and colour swaps listed above.

#### Open questions

- Should Aminocan adopt the "Canada only" shipping wording? Is the payment-methods FAQ still accurate for Aminocan (e-Transfer/crypto vs card)? This is business confirmation, not code.
