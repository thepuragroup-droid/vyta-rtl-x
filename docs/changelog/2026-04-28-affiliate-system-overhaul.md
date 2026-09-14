# 2026-04-28 — Affiliate System Overhaul

## Summary
Three connected improvements to the affiliate program: (1) the signup page is now auth-aware — logged-in customers see their details pre-filled and locked, and are redirected to the dashboard if they are already affiliates; (2) referral codes are now captured in a cookie on landing so they survive navigation before checkout; (3) commission rates are now configurable per affiliate in the admin panel instead of being hardcoded at 10%.

---

## Database Migration

**Run in Supabase SQL Editor before deploying code changes.**

File: `migration-affiliate-commission-rate.sql`

```sql
-- Add per-affiliate commission rate (stored as decimal fraction: 0.10 = 10%)
ALTER TABLE public.affiliates
  ADD COLUMN IF NOT EXISTS commission_rate numeric(5, 4) NOT NULL DEFAULT 0.10;

-- Backfill existing rows to the previous implicit rate
UPDATE public.affiliates
  SET commission_rate = 0.10
  WHERE commission_rate IS NULL;

-- Guard against out-of-range values
ALTER TABLE public.affiliates
  ADD CONSTRAINT affiliates_commission_rate_check
    CHECK (commission_rate >= 0 AND commission_rate <= 1);
```

---

## Feature 1 — Auth-Aware Affiliate Signup Page

### What changed
`app/(affiliate)/affiliate/signup/page.tsx`

The signup page now reads both `useAffiliate()` (affiliate session via localStorage) and `useCustomer()` (Supabase customer session).

**Already an affiliate** → redirected immediately to `/affiliate/dashboard` while the affiliate session is loading, a spinner is shown.

**Logged-in customer, not yet an affiliate**
- Email, first name, and last name fields are pre-filled from `CustomerContext` and visually disabled (grey, `cursor-not-allowed`).
- A `ShieldCheck` info banner explains the pre-fill.
- The password label changes to "Affiliate Password" with a sub-note clarifying it is a separate login credential from the customer account.
- An agreement checkbox appears and must be checked before the form can be submitted.
- On submit, `customer.email / first_name / last_name` are used directly — form field values for those fields are ignored.

**Not logged in** → form behaves exactly as before with all fields editable.

### Auth flow
```
Page load
  ├─ affiliateLoading = true → show spinner
  ├─ affiliate exists → router.push('/affiliate/dashboard')
  └─ no affiliate
        ├─ customer exists → pre-fill + lock name/email, show checkbox
        └─ no customer → normal open registration form
```

---

## Feature 2 — Referral Cookie & Auto-Applied Code at Checkout

### Problem
The previous flow only applied a referral code if the user visited `/checkout?ref=CODE` directly. If they entered via `/?ref=CODE`, browsed the site, then checked out normally, the code was lost — there was no persistence mechanism.

### Solution: Middleware cookie capture

**New file:** `middleware.ts` (Next.js edge middleware, runs before every page render)

```
User visits /?ref=8YRSQGS2
  ├─ Middleware validates format: /^[A-Z0-9]{8}$/
  ├─ Strips ?ref= from the URL (clean address bar via redirect)
  ├─ Sets cookie: ref_code=8YRSQGS2
  │    maxAge: 30 days
  │    path: /
  │    sameSite: lax
  │    httpOnly: false  (must be readable by client JS at checkout)
  └─ First-referrer-wins: cookie not overwritten if already set
```

The middleware matcher excludes `_next/static`, `_next/image`, `favicon.ico`, and `/api/` routes so it only runs on navigable pages.

### Checkout reads the cookie

`app/checkout/page.tsx` — the `useEffect` that handles the referral code now:
1. Checks `?ref=` in the URL first (handles direct `/checkout?ref=` links).
2. If no URL param, reads `document.cookie` for `ref_code` and pre-populates the referral code field + triggers validation.

### Cookie cleared after order

`app/api/orders/route.ts` — the success response now sets `ref_code=; maxAge=0` to expire the cookie immediately after the order is registered. One referral code per checkout session.

### Full referral flow
```
/?ref=8YRSQGS2
  → Middleware sets cookie, redirects to /
  → User browses (cookie persists up to 30 days)
  → User goes to /checkout
  → Checkout reads cookie → auto-populates + validates code (green indicator)
  → User submits order
  → POST /api/orders → creates commission row → response expires cookie
  → Commission visible in /admin/commissions
```

---

## Feature 3 — Configurable Per-Affiliate Commission Rate

### Problem
The commission rate was hardcoded as `0.10` (10%) in two places:
- `app/api/orders/route.ts` line 126: `amount: total * 0.10`
- `app/api/orders/route.ts` line 128: `commission_rate: 0.10`

There was no way to set a different rate for a specific affiliate.

### Solution

**Database** — new `commission_rate` column on the `affiliates` table (see migration above). Defaults to `0.10`.

**Orders API** (`app/api/orders/route.ts`) — when a valid referral code is found, the API now fetches the affiliate's `commission_rate` before inserting the commission:

```ts
const { data: affiliateRow } = await db
  .from('affiliates')
  .select('commission_rate')
  .eq('id', refCode.affiliate_id)
  .single();

const rate = affiliateRow?.commission_rate ?? 0.10;

await db.from('commissions').insert({
  ...
  amount: total * rate,
  commission_rate: rate,
});
```

The `commissions` table already had a `commission_rate` column — it now stores the actual rate used at the time of the order rather than always recording `0.10`.

**Admin affiliates page** (`app/(admin)/admin/affiliates/page.tsx`) — the table now has a "Commission Rate" column. Each row shows the current rate as a percentage. Clicking the pencil icon opens an inline editor:
- Number input (0–100) with `%` suffix
- Confirm with Enter key or the green check button
- Cancel with Escape or the red × button
- Saves via `updateAffiliateCommissionRate()` in `lib/admin/api.ts`
- Optimistically updates the local row on success

**Admin API** (`lib/admin/api.ts`) — new function:

```ts
updateAffiliateCommissionRate(affiliateId: string, rate: number)
// rate is a fraction (0.0–1.0), validated before DB write
```

---

## Navigation Changes

`components/Navigation.tsx`

- Imports `useAffiliate()`.
- Desktop "Affiliates" link: points to `/affiliate/dashboard` and shows "My Affiliate" when an affiliate session exists; otherwise `/affiliate/signup` / "Affiliates".
- Mobile "Affiliate Program" link: same conditional behaviour.

`app/(affiliate)/affiliate/login/page.tsx` and `app/(affiliate)/affiliate/signup/page.tsx` — both pages now show a "← Back to main site" link (pointing to `/`) above the logo, since there was previously no way to return to the storefront from these pages.

---

## Files Changed

| File | Change |
|------|--------|
| `middleware.ts` | **New** — captures `?ref=` param into a 30-day cookie, strips param from URL |
| `migration-affiliate-commission-rate.sql` | **New** — Supabase migration adding `commission_rate` to `affiliates` |
| `lib/supabase.ts` | Added `commission_rate: number` to `Affiliate` interface |
| `lib/admin/api.ts` | Added `updateAffiliateCommissionRate()` |
| `app/api/orders/route.ts` | Reads per-affiliate rate from DB; expires `ref_code` cookie in response |
| `app/checkout/page.tsx` | Falls back to `ref_code` cookie when no `?ref=` URL param present |
| `app/(affiliate)/affiliate/signup/page.tsx` | Auth-aware form: redirect if affiliate, pre-fill if customer, agreement checkbox |
| `app/(affiliate)/affiliate/login/page.tsx` | Added "Back to main site" link |
| `app/(admin)/admin/affiliates/page.tsx` | Inline-editable commission rate column |
| `components/Navigation.tsx` | Affiliate link adapts based on affiliate session state |

---

## Security Notes

- The middleware validates the referral code format (`/^[A-Z0-9]{8}$/`) before setting the cookie. Arbitrary strings in `?ref=` are silently ignored.
- The cookie is `httpOnly: false` by design — the checkout page must read it client-side via `document.cookie`. It contains no sensitive data (only a public referral code).
- Commission rate changes take effect on the next order only. Existing commission rows retain the rate that was active at order creation time (`commission_rate` is stored on each commission row).
- The commission rate DB constraint (`CHECK commission_rate >= 0 AND <= 1`) prevents out-of-range values even if the API validation is bypassed.
