'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, Shuffle, Sparkles, X } from 'lucide-react';
import {
  REFERRAL_CODE_MAX_LENGTH,
  generateReferralCode,
  normalizeReferralCode,
  referralCodeFormatError,
} from '@/lib/affiliate/utils';

export type AvailabilityState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'free' }
  | { kind: 'taken'; reason: string };

/**
 * The shared code picker, used by ALL FOUR forms that pick a referral code:
 * the portal panel, the affiliate application, the admin create modal and the
 * admin edit modal. It exists so all four answer "is AMCSMITH10 free?" the
 * same way, instead of each discovering a collision at submit time with a
 * different error string.
 *
 * The parent owns the value; this owns the checking.
 */
export default function ReferralCodeField({
  value,
  onChange,
  onAvailabilityChange,
  suggestion,
  check,
  label = 'Referral code',
  disabled = false,
  autoFocus = false,
}: {
  value: string;
  /** The parent stores the NORMALIZED value. */
  onChange: (code: string) => void;
  /** Gates the parent's Submit. */
  onAvailabilityChange?: (state: AvailabilityState) => void;
  suggestion?: string | null;
  /** Omitted -> format-only checking, no network call. */
  check?: (code: string) => Promise<{ available: boolean; reason: string | null }>;
  label?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const [availability, setAvailability] = useState<AvailabilityState>({ kind: 'idle' });

  // Every lookup is stamped with a ticket. A slow reply for an older code is
  // dropped rather than allowed to overwrite the verdict for what is in the
  // box now — the difference between a correct field and one that flickers
  // "taken" at people who already fixed their typo.
  const latest = useRef(0);

  const report = useCallback(
    (state: AvailabilityState) => {
      setAvailability(state);
      onAvailabilityChange?.(state);
    },
    [onAvailabilityChange],
  );

  useEffect(() => {
    const code = normalizeReferralCode(value);
    const ticket = ++latest.current;

    if (!code) {
      report({ kind: 'idle' });
      return;
    }

    const formatError = referralCodeFormatError(code);
    if (formatError) {
      report({ kind: 'taken', reason: formatError });
      return;
    }

    if (!check) {
      report({ kind: 'free' });
      return;
    }

    report({ kind: 'checking' });
    const timer = setTimeout(async () => {
      const result = await check(code);
      if (latest.current !== ticket) return;
      report(
        result.available
          ? { kind: 'free' }
          : { kind: 'taken', reason: result.reason ?? 'That code is not available.' },
      );
    }, 400);

    return () => clearTimeout(timer);
    // `check` is expected to be stable (useCallback in the parent).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, check, report]);

  const showSuggestion = !!suggestion && normalizeReferralCode(value) !== suggestion;

  return (
    <div>
      <label className="block text-xs font-medium text-ink-muted mb-1">{label}</label>
      <div className="relative">
        <input
          type="text"
          value={value}
          autoFocus={autoFocus}
          disabled={disabled}
          maxLength={REFERRAL_CODE_MAX_LENGTH}
          placeholder="AMCSMITH10"
          onChange={(e) => onChange(normalizeReferralCode(e.target.value))}
          className="w-full px-3 py-2.5 pr-10 bg-surface border border-line rounded-lg text-sm font-mono uppercase tracking-wider text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40 disabled:opacity-50"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          {availability.kind === 'checking' && (
            <Loader2 className="w-4 h-4 text-ink-muted animate-spin" />
          )}
          {availability.kind === 'free' && <Check className="w-4 h-4 text-emerald-600" />}
          {availability.kind === 'taken' && <X className="w-4 h-4 text-red-500" />}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {showSuggestion && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(normalizeReferralCode(suggestion!))}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-1 text-[11px] font-medium text-ink-muted transition-colors hover:border-bronze/40 hover:text-ink disabled:opacity-50"
          >
            <Sparkles className="w-3 h-3 text-bronze" />
            Use {suggestion}
          </button>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(generateReferralCode())}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-1 text-[11px] font-medium text-ink-muted transition-colors hover:border-bronze/40 hover:text-ink disabled:opacity-50"
        >
          <Shuffle className="w-3 h-3 text-bronze" />
          Random code
        </button>
      </div>

      <p
        className={`mt-1.5 text-[11px] ${
          availability.kind === 'taken'
            ? 'text-red-600'
            : availability.kind === 'free'
              ? 'text-emerald-600'
              : 'text-ink-muted'
        }`}
      >
        {availability.kind === 'taken'
          ? availability.reason
          : availability.kind === 'free'
            ? `${normalizeReferralCode(value)} is available.`
            : `Letters and numbers, ${REFERRAL_CODE_MAX_LENGTH} characters or fewer.`}
      </p>
    </div>
  );
}
