# Whitelabel Guide: Aminocan → Your Brand

This project is a production-ready Next.js 15 e-commerce platform for selling research peptides with crypto-only payments (BTC, ETH, SOL), an affiliate program, admin dashboard, and transactional email. This guide covers everything needed to launch a new branded store in 3–7 days.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v3, Framer Motion |
| Database | Supabase (PostgreSQL + Auth + RLS) |
| Payments | Bitcoin (BIP32 HD wallet), Ethereum (HD wallet via Alchemy), Solana (pre-generated addresses via Alchemy) |
| Email | Resend |
| Icons | Lucide React |
| Web3 | Wagmi v2, RainbowKit, Ethers.js, Solana Web3.js |
| Deployment | Vercel |

---

## Third-Party Accounts to Create

| Service | Purpose | Cost | Est. Setup Time |
|---------|---------|------|----------------|
| [Supabase](https://supabase.com) | Database, Auth, RLS | Free tier available | 20 min |
| [Vercel](https://vercel.com) | Hosting & deployment | Free tier available | 10 min |
| [Resend](https://resend.com) | Transactional email | Free up to 3k/mo | 15 min |
| [Alchemy](https://alchemy.com) | ETH + SOL blockchain RPC | Free tier | 10 min |
| Bitcoin HD Wallet | BTC payments | Free (self-generated) | 30 min |
| Ethereum HD Wallet | ETH payments | Free (self-generated) | 20 min |
| [WalletConnect](https://cloud.walletconnect.com) | Web3 wallet UI | Free | 5 min |
| Custom Domain | Your store URL | ~$10–15/yr | 10 min |

---

## Estimated Timeline

| Day | Task |
|-----|------|
| Day 1 | Create all accounts, generate crypto wallets, configure `.env.local` |
| Day 2 | Branding swap across 10 files (colors, text, logos, emails) |
| Day 3 | Import products, update copy, optional customizations |
| Day 4 | Deploy to Vercel, configure DNS, set up cron job |
| Day 5 | End-to-end testing, fix issues |
| Day 6–7 | Buffer: QA, content polish, soft launch |

---

## Day 1 — Infrastructure Setup

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Note your **Project URL**, **anon key**, and **service_role key**
3. In SQL Editor, run `sql-migrations/database-schema-complete.sql`
4. Verify these 7 tables exist: `customers`, `orders`, `order_items`, `sol_addresses`, `affiliates`, `referral_codes`, `commissions`

### 2. Create Resend Account

1. Sign up at [resend.com](https://resend.com)
2. Add your domain → verify DNS records (SPF/DKIM)
3. Create API key → note it

### 3. Create Alchemy Account

1. Sign up at [alchemy.com](https://alchemy.com)
2. Create two apps:
   - **Ethereum Mainnet** → copy API key (`ALCHEMY_ETH_API_KEY`)
   - **Solana Mainnet** → copy API key (`ALCHEMY_SOL_API_KEY`)

### 4. Generate Crypto Wallets (HD Wallets)

> **CRITICAL:** Only export the xpub (extended public key) — never commit private keys to git.

**Bitcoin xpub:**
- Use [Electrum](https://electrum.org) or a hardware wallet
- Wallet > Master Public Key → copy the `xpub...` string
- This becomes `BTC_XPUB`

**Ethereum xpub:**
- Use [iancoleman.io/bip39](https://iancoleman.io/bip39/) **offline** with your seed phrase
- Derive at path `m/44'/60'/0'` → copy the xpub
- This becomes `ETH_XPUB`

**Solana addresses:**
- Pre-generate ~1000 SOL addresses using the derivation logic in `lib/crypto-wallets.ts`
- Insert into the `sol_addresses` table with `derivation_index` and `used = false`

### 5. Configure `.env.local`

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Crypto wallets (xpub only — never private keys)
BTC_XPUB=xpub...
ETH_XPUB=xpub...

# Blockchain APIs
ALCHEMY_ETH_API_KEY=your_key
ALCHEMY_SOL_API_KEY=your_key

# Security
CRON_SECRET=generate_with: openssl rand -hex 32

# App
# NOTE: there is no base-URL env var. Your public origin is hard-coded as
# SITE_URL in lib/config.ts — see "File 11" in the Branding Swap section.
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id

# Email
RESEND_API_KEY=re_...
EMAIL_FROM=YourBrand <orders@yourdomain.com>
```

---

## Day 2 — Branding Swap

All brand-specific content is isolated to these 11 files. Work through them top to bottom.

### File 1: `app/layout.tsx` — SEO Metadata

Lines 16–20:
```typescript
title: 'YOUR BRAND - Premium Research Peptides'
description: 'Your custom meta description here'
keywords: 'peptides, research peptides, ...'
```

Also replace `/favicon.png` reference with your favicon filename.

### File 2: `lib/i18n.ts` — All UI Text + Copyright

Replace at lines 69, 94, 117, 146, 165, 194:
- `'Aminocan'` → `'Your Brand'`
- `'Aminocan Peptides'` → `'Your Brand'`
- `'© 2025 Aminocan Peptides'` → `'© 2025 Your Brand'`

This covers all three supported languages (EN, ES, VI).

### File 3: `components/Navigation.tsx` — Nav Brand

- Line 80: `Aminocan` → your brand name
- Line 83: `Peptide Research` → your tagline

### File 4: `components/Footer.tsx` — Footer Brand

- Line 26: `Aminocan` → your brand name
- Line 27: `Research Peptides` → your tagline
- Line 54: Instagram URL/handle → your social
- Lines 106 & 113: `support@aminocan.com` → `support@yourdomain.com`
- Line 123: `Shipping to Canada Only` → your shipping region

### File 5: `components/Hero.tsx` — Homepage Hero

- Lines 50–60: Update headline, subheadline, and badge text
- Line 119: Replace hardcoded image URL with your own (or put file at `public/images/hero-bg.jpg`)

### File 6: `components/Features.tsx` — Stats & Categories

Lines 84–225 — update:
- Section titles and subtitles
- Stats: purity %, compound count, delivery time
- Location: `Canada-wide delivery` → your region
- Disclaimer text at bottom

### File 7: `lib/email.ts` — All 5 Email Templates

This file has the most replacements. Go through each template:

| What to Replace | Old Value | Lines |
|----------------|-----------|-------|
| Email header brand name | `AMINOCAN` | 60, 149, 215, 272, 341 |
| Email header tagline | `Canadian Peptides` | 61, 150, 216, 273, 342 |
| Email footer | `Aminocan Peptides • Canada` | 108, 176, 231, 301, 360 |
| Welcome subject | `Welcome to Aminocan!` | 242 |
| Affiliate welcome subject | `Welcome to the Aminocan Affiliate Program!` | 312 |
| Admin notification email | `info@aminocan.com` | 460 |
| Link origin | now the shared `SITE_URL` constant — change it once in `lib/config.ts` (File 11), not here | — |
| Accent color in HTML | `#9C8B5A` (bronze) | throughout |

### File 8: `tailwind.config.ts` — Brand Color Palette

Replace the `bronze` color object with your primary accent color:

```typescript
bronze: {
  DEFAULT: '#YOUR_HEX',
  light: '#LIGHTER_SHADE',
  dark: '#DARKER_SHADE',
  50: '#...',
  // ... 100 through 900
}
```

> Tip: Use [uicolors.app](https://uicolors.app) to generate a full Tailwind shade palette from a single hex.

### File 9: `app/globals.css` — CSS Variables

```css
:root {
  --color-bronze: #YOUR_HEX;
  --color-bronze-light: #LIGHTER_SHADE;
}
```

Also update the selection and focus ring rgba values (search for `rgba(156, 139, 90`).

### File 10: `public/images/` — Brand Assets

| File | Replace With |
|------|-------------|
| `favicon.png` / `favicon.ico` | Your favicon (32×32 and 16×16) |
| `images/aminocan-logo.png` | Your logo |
| `images/hero-bg.jpg` | Your hero background image |
| `images/lab-certified.jpeg` | Your certification badge (or remove reference) |
| `images/products/` | Your product images |
| `images/video1.mp4` | Your hero video (or remove the video section) |

### File 11: `lib/config.ts` — Site Origin

```typescript
export const SITE_URL = "https://www.yourdomain.com";
```

This single constant builds every link that leaves the app: the buttons in all
outbound email, the admin "View customer" insights link, and the `redirectTo`
origin for customer and affiliate magic links. It is deliberately hard-coded
rather than read from an env var — a base-URL env var set to `http://localhost:3000`
in a deployed environment silently shipped dead links in email, because the
`process.env.X || 'https://fallback'` pattern takes the (wrong) env value whenever
the var is set at all.

Two things to get right:

- **Include the exact subdomain you serve on.** `www.yourdomain.com` and
  `yourdomain.com` are different origins to Supabase.
- **Match it in Supabase → Authentication → URL Configuration.** The redirect
  allowlist must contain this same origin, or magic-link sign-ins are rejected.

---

## Day 3 — Content & Products

### Import Your Product Catalog

1. Prepare an Excel or CSV file with these columns:
   `slug, name, strength, price, description_short`
2. Log in as admin → go to `/admin/products`
3. Click **Import** → upload your file
4. Add product images and COA PDFs per product via the admin UI

### Update Static Copy

- `components/Features.tsx` — product category names, certifications text
- Replace any peptide-specific vocabulary with your product terminology

### Optional: Change Order Number Prefix

Search for `AMC-` in `app/api/orders/` and replace with your brand abbreviation (e.g., `XYZ-`).

### Optional: Change Default Commission Rate

Default is 10%. To change for all new affiliates:

```sql
ALTER TABLE affiliates ALTER COLUMN commission_rate SET DEFAULT 15.00;
```

To update all existing affiliates:

```sql
UPDATE affiliates SET commission_rate = 15.00;
```

---

## Day 4–5 — Deployment

### Deploy to Vercel

1. Push your code to a new GitHub repo
2. Go to [vercel.com](https://vercel.com) → Import Project → select your repo
3. Add all environment variables from `.env.local` to Vercel's dashboard under **Settings → Environment Variables**
4. Assign your custom domain under **Settings → Domains**
5. Deploy

### Set Up Payment Verification Cron Job

Add or update `vercel.json` in the project root:

```json
{
  "crons": [
    {
      "path": "/api/cron/check-payments",
      "schedule": "*/2 * * * *"
    }
  ]
}
```

This polls blockchain confirmations every 2 minutes. Requires `CRON_SECRET` to be set.

### Configure Supabase for Production

In Supabase → **Authentication → URL Configuration**:
- Site URL: `https://yourdomain.com`
- Redirect URLs: `https://yourdomain.com/**`

### DNS Configuration

- Point your domain to Vercel (A record or nameservers)
- Add email DNS records for Resend: SPF, DKIM, DMARC

---

## Day 6–7 — Testing & Launch

### Create Your First Admin User

After signing up on your site, run this in Supabase SQL Editor:

```sql
UPDATE customers
SET role = 'admin', is_admin = true
WHERE email = 'your@email.com';
```

### End-to-End Test Checklist

- [ ] Homepage loads with new branding, colors, and logo
- [ ] Products page shows your catalog
- [ ] Add to cart → checkout flow works
- [ ] BTC payment address generates correctly
- [ ] ETH payment address generates correctly
- [ ] SOL payment address allocates from pool
- [ ] Order confirmation email arrives (check spam folder)
- [ ] Affiliate signup at `/affiliate/signup` works
- [ ] Referral code validates at checkout
- [ ] Admin dashboard at `/admin` is accessible
- [ ] Admin can manage orders, products, and users
- [ ] Password reset email flow works
- [ ] Site is mobile responsive

---

## Complete Environment Variable Reference

| Variable | Source | Required |
|----------|--------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase dashboard | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard | Yes |
| `BTC_XPUB` | Your Bitcoin HD wallet | If using BTC |
| `ETH_XPUB` | Your Ethereum HD wallet | If using ETH |
| `ALCHEMY_ETH_API_KEY` | Alchemy dashboard | If using ETH |
| `ALCHEMY_SOL_API_KEY` | Alchemy dashboard | If using SOL |
| `CRON_SECRET` | `openssl rand -hex 32` | Yes |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect cloud | Yes |
| `RESEND_API_KEY` | Resend dashboard | Yes |
| `EMAIL_FROM` | `Brand <orders@yourdomain.com>` | Yes |

> Your public domain is **not** in this table: it is the hard-coded `SITE_URL`
> constant in `lib/config.ts` (File 11), not an environment variable.

---

## Database Tables Reference

| Table | Purpose |
|-------|---------|
| `customers` | User accounts with roles: customer / assistant / admin |
| `orders` | All orders including crypto payment details and status |
| `order_items` | Line items snapshot per order |
| `sol_addresses` | Pre-generated Solana addresses for payments |
| `affiliates` | Affiliate partner accounts |
| `referral_codes` | 8-character codes linked to affiliates |
| `commissions` | Commission records: pending / paid / cancelled |
| `products` | Full product catalog |

---

## Key Files Reference

| File | What It Controls |
|------|----------------|
| `app/layout.tsx` | SEO meta title, description, favicon |
| `lib/i18n.ts` | All UI text across EN / ES / VI + copyright |
| `components/Navigation.tsx` | Brand name and tagline in nav bar |
| `components/Footer.tsx` | Brand name, social links, support email |
| `components/Hero.tsx` | Hero headline, badges, background image |
| `components/Features.tsx` | Stats, product categories, certifications, disclaimers |
| `lib/email.ts` | All 5 transactional email templates |
| `tailwind.config.ts` | Brand color palette (Tailwind theme) |
| `app/globals.css` | CSS variables for colors |
| `public/images/` | Logo, favicon, hero image, product images |
| `.env.local` | All secrets and API keys (never commit) |
| `sql-migrations/database-schema-complete.sql` | Full DB schema — run once in Supabase SQL Editor |

---

## Optional: Disable Specific Crypto Chains

To offer only certain payment chains, remove the unwanted options from the chain selector in `app/checkout/` (search for where BTC / ETH / SOL options are rendered). The corresponding API logic can stay — it just won't be called.

---

## Paying Out Affiliates

Query pending commissions:

```sql
SELECT a.email, a.wallet_address, SUM(c.amount) AS total_due
FROM commissions c
JOIN affiliates a ON a.id = c.affiliate_id
WHERE c.status = 'pending'
GROUP BY a.id, a.email, a.wallet_address;
```

After sending payment, mark as paid:

```sql
UPDATE commissions
SET status = 'paid', paid_at = NOW()
WHERE affiliate_id = '<affiliate_uuid>' AND status = 'pending';
```
