'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, Clock, Copy, Loader2, Tag } from 'lucide-react';
import ReferralCodeField, { type AvailabilityState } from './ReferralCodeField';
import {
  checkReferralCode,
  getMyReferralCode,
  requestReferralCode,
  withdrawReferralCodeRequest,
  type MyCodeRequest,
  type ReferralCodeState,
} from '@/lib/affiliate/referral-codes';

const STATUS_BADGE: Record<MyCodeRequest['status'], { label: string; className: string }> = {
  approved: { label: 'Approved', className: 'bg-emerald-500/10 text-emerald-600' },
  rejected: { label: 'Declined', className: 'bg-red-500/10 text-red-600' },
  withdrawn: { label: 'Withdrawn', className: 'bg-gray-500/10 text-gray-500' },
  pending: { label: 'Pending', className: 'bg-amber-500/10 text-amber-600' },
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '';

/**
 * The affiliate's referral code, on their settings page.
 *
 * WHAT AN AFFILIATE IS TOLD ABOUT A DECLINE: THAT IT WAS DECLINED. The admin's
 * reason and name are not in the payload and must not be added here later "for
 * transparency" — that decision was made on purpose.
 */
export default function ReferralCodePanel() {
  const [state, setState] = useState<ReferralCodeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [value, setValue] = useState('');
  const [availability, setAvailability] = useState<AvailabilityState>({ kind: 'idle' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setState(await getMyReferralCode());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const check = useCallback((code: string) => checkReferralCode(code), []);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    const result = await requestReferralCode(value);
    setSubmitting(false);

    if (!result.success) {
      setError(result.error ?? 'Could not send the request.');
      return;
    }

    setSuccess(
      result.granted
        ? `${result.current?.code ?? value} is yours — start sharing it.`
        : 'Saved. An admin will review it shortly.',
    );
    setValue('');
    setAvailability({ kind: 'idle' });
    await load();
  };

  const withdraw = async () => {
    setSubmitting(true);
    setError(null);
    const result = await withdrawReferralCodeRequest();
    setSubmitting(false);
    if (!result.success) {
      setError(result.error ?? 'Could not withdraw the request.');
      return;
    }
    setSuccess(null);
    await load();
  };

  const copy = async () => {
    if (!state?.current) return;
    try {
      await navigator.clipboard.writeText(state.current.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — nothing useful to say */
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line bg-white p-6 text-sm text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your referral code…
      </div>
    );
  }

  if (!state) return null;

  const current = state.current;
  const pending = state.pending_request;

  return (
    <div className="rounded-xl border border-line bg-white p-5 shadow-sm sm:p-6 md:p-8">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-ink sm:text-base">
        <Tag className="h-4 w-4 text-teal-dark" />
        Referral Code
      </h2>

      {current ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className="font-mono text-2xl font-bold tracking-wider text-ink">
              {current.code}
            </span>
            <span className="text-xs text-ink-muted">
              {current.uses} use{current.uses === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-ink-muted transition-colors hover:border-teal/40 hover:text-ink"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-emerald-600" /> Copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" /> Copy
                </>
              )}
            </button>
          </div>
          <p className="mb-5 text-xs leading-relaxed text-ink-muted">
            This is the code your customers enter at checkout. Changing it needs an admin&apos;s
            approval, and the old code stops working once the new one is live.
          </p>
        </>
      ) : (
        <p className="mb-5 text-xs leading-relaxed text-ink-muted">
          Pick the code your customers will enter at checkout.
        </p>
      )}

      {pending ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <Clock className="h-4 w-4" />
            You asked for <span className="font-mono">{pending.requested_code}</span>.
          </p>
          <p className="mt-1 text-xs text-amber-700">
            {current
              ? 'An admin is reviewing it — your current code keeps working until then.'
              : 'It will be issued to you once an admin approves it.'}
          </p>
          <button
            type="button"
            onClick={withdraw}
            disabled={submitting}
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
            Withdraw request
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <ReferralCodeField
            value={value}
            onChange={setValue}
            onAvailabilityChange={setAvailability}
            suggestion={state.suggestion}
            check={check}
            label={current ? 'Ask for a different code' : 'Choose your code'}
            disabled={submitting}
          />
          <button
            type="button"
            onClick={submit}
            disabled={submitting || availability.kind !== 'free'}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-ink/90 disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {current ? 'Request this code' : 'Use this code'}
          </button>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5">
          <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-500" />
          <span className="text-xs text-red-700">{error}</span>
        </div>
      )}
      {success && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5">
          <Check className="h-4 w-4 flex-shrink-0 text-emerald-600" />
          <span className="text-xs text-emerald-700">{success}</span>
        </div>
      )}

      {state.history.length > 0 && (
        <div className="mt-6 border-t border-line pt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            Past requests
          </p>
          <ul className="divide-y divide-line/60">
            {state.history.map((r) => {
              const badge = STATUS_BADGE[r.status];
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                  <span className="font-mono font-medium text-ink">{r.requested_code}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}>
                    {badge.label}
                  </span>
                  {r.source === 'admin' && (
                    <span className="text-[10px] text-ink-muted">set by an admin</span>
                  )}
                  <span className="ml-auto text-[10px] text-ink-muted">
                    {fmtDate(r.decided_at ?? r.created_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
