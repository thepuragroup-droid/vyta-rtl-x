# 01: Global shell and design system

Scope: design tokens and globals, the AnnouncementBar (with its DB, API and admin editor), Navigation, Footer, BrandLockup / MapleLeaf, Hero (with hero media), `robots.ts` / `sitemap.ts`, and the root layout additions (Inter opsz, Google verification, Klaviyo onsite, Whop pixel, SiteTracking, site traffic counters).

Conventions in this section:
- **VYTA** means the `vyta-rtl-x` repo, the source of the features. **AMC** means the `aminocan-cad` repo, the port target.
- Paths are repo-relative and are the same in both repos unless noted.
- Each class is written as `vyta-class` (hex/px) followed by **→ AMC token**. The AMC token is the semantic equivalent to use so that Aminocan keeps its own brand.
- 🏷 **brand content — replace** marks VYTA-specific copy, IDs, assets or names.

---

## 0. Design tokens

### 0.1 Colour tokens (`tailwind.config.ts` → `theme.extend.colors`)

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

### 0.2 Other `tailwind.config.ts` differences (VYTA only)

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

### 0.3 `app/globals.css` (full diff, VYTA vs AMC)

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

## 1. AnnouncementBar (sticky site-wide banner)

### What's new vs AMC
AMC has no announcement bar. VYTA adds:
- a DB table of banners;
- a public feed and admin CRUD;
- an admin page with a live preview;
- a fixed bar above the nav. The bar can be static or a seamless marquee. It supports rotation, scheduling and per-browser dismissal. It also publishes its height as a CSS var so the nav stacks under it.

### Files
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

### Database
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

### Shared lib: `lib/content/announcements.ts` (verbatim semantics)
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

### API routes
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

### Component: `AnnouncementBar` (client, no props)
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

### Admin controls: `/admin/announcements` (client page)
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

### Porting notes (order of steps)
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

### Open questions
- `datetime-local` values are sent to the server as `YYYY-MM-DDTHH:mm` with no offset. The server's `new Date(value).toISOString()` therefore interprets them in the **server's** timezone (UTC on Vercel), not the editor's. VYTA appears to have this bug; it has not been verified in production. Recommended fix: send `new Date(draft.starts_at).toISOString()` from the client.
- The PATCH route's `404 'Announcement not found'` branch is probably unreachable. `.single()` on zero rows returns an error, which becomes a 500. This has not been verified at runtime.
- The admin slider max (60s) differs from the API and renderer clamp (120s); it is unclear whether this is intentional.
- Should the bar be hidden on the AMC `/[code]` affiliate landing route? VYTA has no such route, so there is no precedent.

---

## 2. Navigation (`components/Navigation.tsx`, client)

### What's new vs AMC
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

### Full VYTA layout (for rebuilding)

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

### Porting notes
- Apply the `top` style change first; it is required for the announcement bar.
- Apply items 5 and 6 only once `/about` and `/articles` exist.
- Do not replace `BrandLogo`.

### Open questions
- Was removing "Lab Results" from the nav intentional for VYTA only? `/lab-results` is still in the VYTA sitemap. Recommendation: keep it in AMC.

---

## 3. Footer (`components/Footer.tsx`, client)

### What's new vs AMC
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

### Porting notes
Add the two links (once the routes exist) and the aria-label. Optionally replace `bg-ink` with an AMC `.surface-ink` (§0.3) for the bloom effect. Everything else stays AMC.

---

## 4. BrandLockup (`components/BrandLockup.tsx`) vs AMC `components/BrandLogo.tsx`; MapleLeaf icon

### Comparison
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

### MapleLeaf (`components/icons/MapleLeaf.tsx`; AMC has no `components/icons/`)
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

## 5. Hero (`components/Hero.tsx`, client) and hero media

### What's new vs AMC
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

### Database: `hero-media-migration.sql`
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

### Admin controls
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

### Assets 🏷 (all brand content; replace)
| file | size | content |
|---|---|---|
| `public/images/hero-desktop.webp` | 1600×900, 320KB | VYTA-branded vials and boxes on dark rock by a mountain lake at sunset; `DEFAULT_HERO_IMAGE` |
| `public/images/hero-mobile.webp` | 900×1600, 160KB | portrait version of the same scene; `MOBILE_HERO_IMAGE`, used at ≤1023px, not admin-editable |
| `public/images/hero-bg.{jpeg,jpg,png}` | — | present in both repos; the AMC hero still |
| `docs/hero-media-prompt.md` | — | generation brief: lifestyle direction, subject centre-right, left half calm, top and bottom 15% clear, ~16% vertical parallax headroom, video 8–12s H.264 under 2MB, still 2400×1600 under 400KB. It describes the older video plus navy-graded design and is partly stale relative to the current code |

### Component: full VYTA layout
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

### Porting notes
- **Minimum port** (recommended regardless of design): the `hero-media-migration.sql` columns, the `SiteConfig` fields, the admin marketing hero section and the API whitelist. Then in AMC's existing Hero:
  - `const heroStill = config.hero_image_url ?? '/images/hero-bg.jpeg'`;
  - `const heroVideo = config.hero_video_url ?? null`, replacing the hard-coded `HERO_VIDEO_URL`, and keep the video box in admin.
- **Full redesign port** (only if the product owner wants the light hero):
  - Rebuild with AMC tokens and AMC copy and imagery.
  - Remove the nav overlay logic.
  - Decide what happens to AMC's featured-product card, ticker and lab-results CTA, which VYTA dropped.
  - Supply AMC portrait and landscape images.
- In both cases, the nav now sits `--announcement-h` lower. The hero's top padding (`pt-24`/`pt-32`) is in-flow and is already pushed down by the bar spacer.

### Open questions
- Should AMC adopt the VYTA hero design (light frosted band, no product card, no ticker) or keep its dark video hero and gain only admin-editable media? The spec cannot decide this.
- AMC needs its own mobile portrait asset if it adopts the `<picture>` split.

---

## 6. Root layout additions (`app/layout.tsx`)

### 6.1 Inter with optical-size axis
```ts
const inter = Inter({ subsets: ['latin'], axes: ['opsz'], variable: '--font-inter', display: 'swap' });
// <body className={`${inter.variable} ${inter.className}`}>
```
AMC currently has `Inter({ subsets: ['latin'] })` and `<body className={inter.className}>`. It already renders Inter via the class, while its Tailwind `sans` stack lists system fonts but is overridden by the body class. What the VYTA change adds:
- the `--font-inter` CSS var, used by `fontFamily.sans/display` and `.font-display`;
- the `opsz` variable axis, which lets `font-variation-settings:'opsz' 32` produce the "Inter Display" cut for headings, `.font-display` and `BrandLockup`.

This is brand typography; adopt it only if AMC wants display-optical headings. If it does, port it together with the `@layer base` h1–h4 rule, `.font-display` and the `fontFamily` tokens. The change is low-risk. Note that `--font-inter` is defined on `<body>`, not on `:root`.

### 6.2 Google Search Console verification 🏷 (do not copy the token)
In `generateMetadata()`: `verification: { google: 'o9_eT_n204rgAFQoJuAGpgIlh3XcKjMDtHZ4oKfpb6w' }`. This renders `<meta name="google-site-verification">` on every page. AMC must use its own token, or omit the field; making it an env var such as `GOOGLE_SITE_VERIFICATION` is recommended. The VYTA metadata description was also changed to Canada-specific copy 🏷; keep AMC's.

### 6.3 Klaviyo onsite (`KLAVIYO_INIT_SNIPPET`, `lib/analytics/klaviyo-onsite.ts`, SiteTracking)

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

### 6.4 Whop pixel 🏷 (account-specific; do not copy verbatim)
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

### 6.5 Site traffic counters (anonymous daily visitor tally)

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

### 6.6 Account-specific IDs: summary of what must NOT be copied
| Item | VYTA value | Where |
|---|---|---|
| Google site verification | `o9_eT_n204rgAFQoJuAGpgIlh3XcKjMDtHZ4oKfpb6w` | `app/layout.tsx` metadata |
| Whop business | `biz_4uByt2hc4AZpRx` | `app/layout.tsx` `WHOP_PIXEL_SNIPPET` |
| Klaviyo Site ID fallback | `SY9j8v` | `lib/site-config.ts` `BUILTIN_KLAVIYO_SITE_ID` |
| localStorage keys | `vyta_dismissed_announcements`, `vyta_last_visit` | AnnouncementBar, site-visit |
| Contact info | `support@vytabio.com`, `wa.me/15147013824`, `instagram.com/vytabiosciences` | Footer |
| Brand assets | `/images/vyta-mark.png`, `vyta-logo.png`, `vyta-wordmark.png`, `hero-desktop.webp`, `hero-mobile.webp`, `favicon-maple.png` | `public/images` |

Observation: AMC's `lib/site-config.ts` already contains `BUILTIN_GTM_CONTAINER_ID = 'GTM-M2J3D7SG'` and `BUILTIN_GA4_MEASUREMENT_ID = 'G-F44F1BB1QV'`, the same values as VYTA. One of the two stores is therefore reporting into the other's GTM/GA4 property unless env vars override them. This is outside this section's scope but worth flagging to the owner.

### Open questions (§6)
- Which consent category should Klaviyo fall under in AMC: ads/marketing (recommended), analytics, or first-party?
- Does Aminocan have Whop, a Klaviyo account and a Search Console token? Without each one, omit the corresponding snippet.

---

## 7. `app/robots.ts` (new; AMC has none) and `app/sitemap.ts` (changed)

### robots.ts (VYTA, brand-neutral; port as is)
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

### sitemap.ts changes
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

## 8. Recommended port order for this section
1. Tokens: add the `boxShadow` tokens and the needed utilities (`.text-eyebrow`, `.surface-ink`, `.hero-image-grade` if needed) with AMC colours. Do not import VYTA colour names.
2. `robots.ts`, then the safe part of the sitemap (priorities).
3. Site traffic counters: migration, `/api/site/visit`, `site-visit.ts` plus its test, the `CustomerJourneyTracker` call and the analytics merge.
4. Announcements: migration, lib, permissions, API, CSS, bar, layout mount, nav `top` var, admin page and sidebar.
5. Hero media columns, site-config fields, admin hero section, and wiring into AMC's existing Hero (image and video).
6. Klaviyo onsite: after the Klaviyo settings migration from the Klaviyo section, merged into AMC's per-category consent.
7. Optional, owner decisions: Inter opsz typography, the VYTA light hero redesign, Proudly Canadian nav badge, About/Articles nav and footer links (after the content routes ship), Whop pixel, Search Console token.
