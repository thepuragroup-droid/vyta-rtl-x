# Storefront design spec: VYTA features to port into aminocan-cad

> A build spec for the storefront features that `vyta-rtl-x` (VYTA) has and its base, `aminocan-cad` (Aminocan), lacks. The reader is a person or an AI porting those features into Aminocan **without** access to the VYTA code. Every value in this spec was read from source: Tailwind class plus resolved hex/px, real props, routes, columns and SQL. Anything that could not be confirmed appears under that feature's **Open questions**.
>
> Stack in both repos: Next.js 15.5 (App Router), Supabase, Tailwind 3.4, framer-motion 12, lucide-react. The spec compares VYTA `main` @ `6397ef9` with Aminocan `main` @ `216990e` (2026-10-14).

## How to read this

| File | Covers |
|---|---|
| [01-shell.md](01-shell.md) | Design tokens and globals, **AnnouncementBar** (the scrolling message bar), Navigation, Footer, brand lockup, Hero and hero media, root layout additions (Inter opsz, Klaviyo onsite, Whop pixel, site traffic counters), `robots.ts` / `sitemap.ts` |
| [02-home.md](02-home.md) | The redesigned home page: BestSellers, WhyChooseVyta, CollectionBanner, **Testimonials**, ServicePromises, plus the hidden ShowOurWork and WellnessFocus |
| [03-shop-product-cart.md](03-shop-product-cart.md) | Catalog, product page, cart, hosted checkout, guest-order claim, account orders |
| [04-content-marketing.md](04-content-marketing.md) | CMS (articles, About, `/p/[slug]` pages), `/partners`, promo landing pages (`?lp=`), small storefront diffs |

Each feature in those files follows the same outline: what's new compared with Aminocan, files, database (migration SQL), API routes, components, UI/UX (classes → hex/px, typography, responsive behaviour, states, animation), admin controls, porting notes, and open questions.

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
