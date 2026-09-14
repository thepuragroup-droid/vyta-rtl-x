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
 */
export const SITE_URL = "https://www.aminocan.com";
