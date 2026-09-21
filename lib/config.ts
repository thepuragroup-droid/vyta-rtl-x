/**
 * Site feature flags
 */
export const siteConfig = {
  /** Show cart icon, checkout, and affiliate links */
  ecommerceEnabled: true,
  /** Show customer login/signup buttons in nav */
  authEnabled: true,
  /** Enable crypto/wallet payments — when false, Web3Provider and all wallet API calls are skipped */
  cryptoPaymentsEnabled: false,
};

/**
 * Canonical public origin for the site.
 *
 * Hard-coded rather than read from NEXT_PUBLIC_BASE_URL: the env var is set to
 * a localhost origin in the deployed environment, which produced dead
 * `http://localhost:3000/...` buttons in emails (e.g. the "View customer" link
 * in the new-registration alert sent to admins). Every link that leaves the
 * app in an email must be built from this constant.
 *
 * This is also the origin every canonical tag and sitemap entry is built from
 * (app/sitemap.ts, app/robots.ts, the product and catalog routes), so it must
 * match the domain the store is actually served on. Pointing it at a different
 * host tells Google the real pages are duplicates of somewhere else.
 *
 * Note for whitelabel deployments: changing this also changes the `redirectTo`
 * of admin-issued magic links (app/api/admin/{customers,affiliates}/[id]/
 * magic-link) and password resets, so the new origin has to be on the Supabase
 * Auth redirect allowlist or those links will be rejected.
 */
export const SITE_URL = "https://www.vytabio.com";
