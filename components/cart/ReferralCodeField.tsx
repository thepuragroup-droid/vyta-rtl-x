'use client';

/**
 * "Add a referral code" — the collapsible row under the cart's checkout button.
 *
 * The code itself is applied at checkout, not here: both checkout screens
 * already read the `ref_code` cookie that the referral links set, so a code
 * entered here is validated and written to that same cookie and the checkout
 * picks it up with its field pre-filled. That is deliberately all it does —
 * nothing about the cart's totals changes, because a referral code credits the
 * affiliate rather than discounting the order.
 *
 * Collapsed by default. A visible empty code box invites a hunt for a code
 * that most shoppers do not have, and that hunt is where carts get abandoned.
 */
import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Loader2, Tag } from 'lucide-react';
import { validateReferralCode } from '@/lib/affiliate/api';
import {
  normalizeReferralCode,
  REFERRAL_CODE_MIN_LENGTH,
} from '@/lib/affiliate/utils';

/** The cookie both checkouts read. 30 days, matching the referral link's own. */
const COOKIE_DAYS = 30;

function readCookieCode(): string {
  if (typeof document === 'undefined') return '';
  const row = document.cookie.split('; ').find((r) => r.startsWith('ref_code='));
  if (!row) return '';
  const raw = row.slice(row.indexOf('=') + 1);
  try {
    return normalizeReferralCode(decodeURIComponent(raw));
  } catch {
    return normalizeReferralCode(raw);
  }
}

function writeCookieCode(code: string) {
  const expires = new Date(Date.now() + COOKIE_DAYS * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `ref_code=${encodeURIComponent(code)}; path=/; expires=${expires}; SameSite=Lax`;
}

export default function ReferralCodeField({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [applied, setApplied] = useState('');
  const [error, setError] = useState('');

  // A code the visitor arrived with is shown as already applied rather than
  // asked for again — and opens the row, so they can see it is in hand.
  useEffect(() => {
    const existing = readCookieCode();
    if (existing) {
      setApplied(existing);
      setCode(existing);
      setOpen(true);
    }
  }, []);

  const apply = async () => {
    const normalised = normalizeReferralCode(code);
    if (normalised.length < REFERRAL_CODE_MIN_LENGTH) {
      setError(`Codes are at least ${REFERRAL_CODE_MIN_LENGTH} characters.`);
      return;
    }
    setChecking(true);
    setError('');
    try {
      const found = await validateReferralCode(normalised);
      if (!found) {
        setApplied('');
        setError("That code isn't valid.");
        return;
      }
      writeCookieCode(normalised);
      setApplied(normalised);
    } catch {
      setError("We couldn't check that code — try again at checkout.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className={`rounded-xl border border-line bg-surface ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
      >
        <Tag className="h-4 w-4 flex-shrink-0 text-ink-muted" />
        <span className="flex-1 text-sm font-medium text-ink">
          {applied ? `Referral code ${applied} applied` : 'Add a referral code'}
        </span>
        {applied ? (
          <Check className="h-4 w-4 flex-shrink-0 text-emerald-600" />
        ) : (
          <ChevronDown
            className={`h-4 w-4 flex-shrink-0 text-ink-muted transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          />
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={code}
                  onChange={(e) => {
                    setCode(normalizeReferralCode(e.target.value));
                    setError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') apply();
                  }}
                  placeholder="Enter code"
                  aria-label="Referral code"
                  className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm uppercase text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-teal/40"
                />
                <button
                  type="button"
                  onClick={apply}
                  disabled={checking || !code}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-teal/40 disabled:opacity-40"
                >
                  {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
                </button>
              </div>
              {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
              {!error && (
                <p className="mt-2 text-[11px] leading-snug text-ink-muted">
                  {applied
                    ? "We'll carry it through to checkout for you."
                    : 'Credits whoever referred you. It does not change your total.'}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
