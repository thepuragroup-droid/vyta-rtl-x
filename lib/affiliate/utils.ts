/**
 * Affiliate System Utility Functions
 * Aminocan Peptides - 10% Commission Program
 *
 * THIS FILE IS THE SINGLE SOURCE OF TRUTH FOR WHAT A REFERRAL CODE LOOKS LIKE.
 * Middleware, the checkout field, the affiliate request form, the admin editor
 * and every server route measure against the exports below. A stale `{8}` left
 * behind in any one of them fails a referral link silently — nothing errors,
 * the cookie is simply never set and the affiliate is never credited.
 */

/** Shortest code a human may choose. */
export const REFERRAL_CODE_MIN_LENGTH = 4;
/** Longest code a human may choose (the DB column has headroom past this). */
export const REFERRAL_CODE_MAX_LENGTH = 20;
/** The one format definition. Import it; never re-declare it. */
export const REFERRAL_CODE_REGEX = /^[A-Z0-9]{4,20}$/;

/**
 * House prefix for a suggested vanity code. Aminocan's is `AMC` — the sibling
 * site this was ported from uses its own. Change it here and every suggestion
 * across the product follows.
 */
const SUGGESTION_PREFIX = 'AMC';
/** The customer discount figure the code carries (10%). */
const SUGGESTION_SUFFIX = '10';

/** How much of the name a suggestion has room for. */
const SUGGESTION_NAME_BUDGET =
  REFERRAL_CODE_MAX_LENGTH - SUGGESTION_PREFIX.length - SUGGESTION_SUFFIX.length;

/**
 * Uppercase and strip everything that is not [A-Z0-9].
 *
 * Run EVERY user-supplied code through this before validating, comparing or
 * storing it. Codes are compared with `=`, so "amc smith-10" and "AMCSMITH10"
 * must not be allowed to become two different things.
 */
export function normalizeReferralCode(raw: string | null | undefined): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Generate a random 8-character alphanumeric referral code.
 * Still used — as the last-resort fallback in `proposeReferralCode` and behind
 * the "Random code" button in the picker.
 */
export function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude similar chars (I,1,O,0)
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * The vanity suggestion: `AMC` + surname + `10` (AMCSMITH10).
 * Falls back to the first name when there is no surname; returns null when
 * neither yields any letters or digits (the caller then rolls a random code).
 */
export function suggestReferralCode(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string | null {
  const surname = normalizeReferralCode(lastName);
  const given = normalizeReferralCode(firstName);
  const base = surname || given;
  if (!base) return null;
  return `${SUGGESTION_PREFIX}${base.slice(0, SUGGESTION_NAME_BUDGET)}${SUGGESTION_SUFFIX}`;
}

/**
 * The collision ladder, in the order it should be walked:
 *
 *   1. the primary suggestion            AMCSMITH10
 *   2. initial + surname                 AMCJSMITH10
 *   3. the primary with a digit appended AMCSMITH102 … AMCSMITH109
 *
 * De-duplicated, and empty when there is no name to work from.
 */
export function suggestReferralCodeVariants(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string[] {
  const primary = suggestReferralCode(firstName, lastName);
  if (!primary) return [];

  const variants: string[] = [primary];

  const surname = normalizeReferralCode(lastName);
  const initial = normalizeReferralCode(firstName).slice(0, 1);
  if (surname && initial) {
    const budget = SUGGESTION_NAME_BUDGET - initial.length;
    variants.push(
      `${SUGGESTION_PREFIX}${initial}${surname.slice(0, budget)}${SUGGESTION_SUFFIX}`,
    );
  }

  for (let n = 2; n <= 9; n++) {
    variants.push(`${primary.slice(0, REFERRAL_CODE_MAX_LENGTH - 1)}${n}`);
  }

  return Array.from(new Set(variants)).filter(isValidReferralCodeFormat);
}

/**
 * Validate referral code format.
 * Expects an already-normalized code — see `normalizeReferralCode`.
 */
export function isValidReferralCodeFormat(code: string): boolean {
  return REFERRAL_CODE_REGEX.test(code);
}

/**
 * Why a code is unusable, phrased for whoever typed it — or null when it is
 * fine. Normalizes first, so punctuation and case are never the complaint.
 */
export function referralCodeFormatError(code: string | null | undefined): string | null {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return 'Enter a code using letters and numbers.';
  if (normalized.length < REFERRAL_CODE_MIN_LENGTH) {
    return `Codes must be at least ${REFERRAL_CODE_MIN_LENGTH} characters.`;
  }
  if (normalized.length > REFERRAL_CODE_MAX_LENGTH) {
    return `Codes can be at most ${REFERRAL_CODE_MAX_LENGTH} characters.`;
  }
  if (!isValidReferralCodeFormat(normalized)) return 'Use letters and numbers only.';
  return null;
}

/**
 * Calculate commission amount based on order total
 * @param orderTotal - The total amount of the order
 * @param commissionRate - The commission rate (default 10%)
 * @returns The commission amount
 */
export function calculateCommission(orderTotal: number, commissionRate: number = 10): number {
  return Number((orderTotal * (commissionRate / 100)).toFixed(2));
}

/**
 * Hash password using Web Crypto API (browser-compatible)
 * For production, consider using bcrypt on the server side
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Format currency for display
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

/**
 * Format wallet address for display (truncated)
 */
export function formatWalletAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate Ethereum wallet address format
 */
export function isValidWalletAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}
