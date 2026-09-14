/**
 * First-touch referral capture (client-side).
 *
 * Reads a `?ref=` code from the URL and stores it — but only if nothing is
 * stored yet, so the first affiliate to refer a visitor keeps the credit.
 * Persisted in both a long-lived cookie and localStorage for resilience.
 */

import { isValidReferralCodeFormat, normalizeReferralCode } from './utils';

const STORAGE_KEY = 'aminocan_ref';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 10; // ~10 years

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * Capture a `?ref=` code from the current URL (first-touch only).
 * Returns the stored code (existing or newly captured), or null.
 */
export function captureReferralFromUrl(): string | null {
  if (typeof window === 'undefined') return null;

  // Never overwrite an existing first-touch referral.
  const existing = getStoredReferral();
  if (existing) return existing;

  const params = new URLSearchParams(window.location.search);
  const raw = normalizeReferralCode(params.get('ref'));
  if (!isValidReferralCodeFormat(raw)) return existing;

  try {
    localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // ignore storage failures
  }
  writeCookie(STORAGE_KEY, raw);
  return raw;
}

/** Read the stored first-touch referral code (localStorage, then cookie). */
export function getStoredReferral(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const fromStorage = localStorage.getItem(STORAGE_KEY);
    if (fromStorage && isValidReferralCodeFormat(fromStorage)) return fromStorage;
  } catch {
    // ignore
  }
  const fromCookie = readCookie(STORAGE_KEY);
  return fromCookie && isValidReferralCodeFormat(fromCookie) ? fromCookie : null;
}

/** Clear the stored referral (e.g. after the order has been attributed). */
export function clearStoredReferral(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  if (typeof document !== 'undefined') {
    document.cookie = `${STORAGE_KEY}=; path=/; max-age=0; SameSite=Lax`;
  }
}
