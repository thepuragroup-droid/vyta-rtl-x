/**
 * Google Consent Mode v2.
 *
 * The GTM container itself loads unconditionally (see app/layout.tsx) so it is
 * detectable by Tag Assistant / GTM Preview and behaves like any standard
 * install. What the tags inside it are allowed to do is governed by the consent
 * signals below rather than by whether the container loaded at all.
 *
 * Ordering is the whole trick: the `default` call MUST run before gtm.js, or
 * tags fire once in an unknown state before the first signal arrives. That is
 * why the snippet is emitted as a raw inline <script> above the container
 * snippet in <head>, rather than through next/script.
 */

/** localStorage key holding the visitor's banner decision. */
export const CONSENT_KEY = 'aminocan.trackingConsent';

/** The four signals the banner toggles. Storage/security stay granted. */
const GATED_SIGNALS = [
  'ad_storage',
  'ad_user_data',
  'ad_personalization',
  'analytics_storage',
] as const;

function signalBlock(value: 'granted' | 'denied'): string {
  return GATED_SIGNALS.map((s) => `${s}:'${value}'`).join(',');
}

/**
 * Inline script setting the default consent state, to be rendered in <head>
 * immediately before the container snippet.
 *
 * When consent is required the default is denied and a previously stored
 * "granted" is re-applied synchronously, so a returning visitor is not
 * downgraded for the first few hundred milliseconds of their session.
 * `wait_for_update` holds tags briefly so that update can land first.
 *
 * When consent is NOT required (the toggle in Admin → Branding & Tracking)
 * everything defaults to granted and the banner never shows.
 */
export function consentDefaultSnippet(consentRequired: boolean): string {
  if (!consentRequired) {
    return `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
window.gtag=window.gtag||gtag;gtag('consent','default',{${signalBlock('granted')},functionality_storage:'granted',security_storage:'granted'});`;
  }
  return `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
window.gtag=window.gtag||gtag;gtag('consent','default',{${signalBlock('denied')},functionality_storage:'granted',security_storage:'granted',wait_for_update:500});
try{if(localStorage.getItem('${CONSENT_KEY}')==='granted'){gtag('consent','update',{${signalBlock('granted')}});}}catch(e){}`;
}

/**
 * Cookie mirroring the banner decision.
 *
 * The decision itself lives in localStorage, which never leaves the browser —
 * but the activity API has to know whether it may store an anonymous visitor's
 * page views before it writes the row, and that decision is made server-side.
 * So the same value is written as a first-party cookie, readable by the API.
 *
 * Kept in step with `CONSENT_COOKIE` in ./attribution, which is where the
 * server reads it from.
 */
const CONSENT_COOKIE_NAME = 'aminocan_consent';
const CONSENT_COOKIE_MAX_AGE = 60 * 60 * 24 * 400; // ~13 months

export function writeConsentCookie(decision: 'granted' | 'denied'): void {
  if (typeof document === 'undefined') return;
  document.cookie =
    `${CONSENT_COOKIE_NAME}=${decision}; path=/; max-age=${CONSENT_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/** The decision the server can currently see, or null when there is none. */
export function readConsentCookie(): 'granted' | 'denied' | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE_NAME}=([^;]*)`));
  const value = match ? decodeURIComponent(match[1]) : null;
  return value === 'granted' || value === 'denied' ? value : null;
}

/**
 * Push the visitor's banner decision to the container. Declining is pushed
 * explicitly rather than left to the default so `wait_for_update` resolves
 * immediately instead of stalling tags for its full window.
 */
export function updateConsent(granted: boolean): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  const value = granted ? 'granted' : 'denied';
  window.gtag('consent', 'update', {
    ad_storage: value,
    ad_user_data: value,
    ad_personalization: value,
    analytics_storage: value,
  });
}
