'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Check, Loader2, Tag, X } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import {
  decideReferralCodeRequest,
  getReferralCodeRequests,
  type AdminReferralCodeRequest,
} from '@/lib/admin/referral-codes';
import DeclineReferralCodeDialog from './DeclineReferralCodeDialog';

/**
 * The referral code review queue, above the affiliates list.
 *
 * Returns null when there is nothing pending — for the same reason the
 * affiliate-application queue beside it does: a box that is empty on every
 * page load teaches people to stop reading it.
 */
export default function PendingReferralCodeRequests({
  canReview,
  onDecided,
}: {
  canReview: boolean;
  onDecided?: () => void;
}) {
  const toast = useToast();
  const [requests, setRequests] = useState<AdminReferralCodeRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);
  const [declining, setDeclining] = useState<AdminReferralCodeRequest | null>(null);

  const load = useCallback(async () => {
    setRequests(await getReferralCodeRequests({ status: 'pending' }));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (r: AdminReferralCodeRequest, action: 'approve' | 'reject', notes?: string) => {
    setBusy(r.id);
    const result = await decideReferralCodeRequest(r.id, action, notes, notify);
    setBusy(null);
    setDeclining(null);

    if (!result.success) {
      toast.error(result.error ?? 'Could not record the decision.');
      return;
    }

    setRequests((prev) => prev.filter((x) => x.id !== r.id));
    onDecided?.();

    if (action === 'reject') {
      toast.success(`${r.requested_code} declined.`);
      return;
    }
    // The code is live either way, so a failed send is a warning, never a failure.
    if (notify && !result.notified) {
      toast.error(`${r.requested_code} is live, but the email did not go out: ${result.notifyError}`);
    } else if (notify) {
      toast.success(`${r.requested_code} is now live — affiliate emailed`);
    } else {
      toast.success(`${r.requested_code} is now live`);
    }
  };

  if (requests.length === 0) return null;

  return (
    <>
      <div className="mb-6 overflow-hidden rounded-xl border border-teal/30 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-5">
          <Tag className="h-4 w-4 text-teal-dark" />
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink">
            Referral code requests
          </h2>
          <span className="ml-1 rounded-full bg-teal/10 px-2 py-0.5 text-xs font-semibold text-teal-dark">
            {requests.length}
          </span>
          {canReview && (
            <label className="ml-auto flex items-center gap-2 text-xs text-ink-muted">
              <input
                type="checkbox"
                checked={notify}
                onChange={(e) => setNotify(e.target.checked)}
                className="accent-teal"
              />
              Email the affiliate on approve
            </label>
          )}
        </div>

        <div className="divide-y divide-line/50">
          {requests.map((r) => (
            <div
              key={r.id}
              className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink">{r.affiliate_name || '—'}</div>
                <div className="text-xs text-ink-muted">{r.affiliate_email}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  {r.previous_code ? (
                    <>
                      <span className="font-mono text-ink-muted line-through">{r.previous_code}</span>
                      <ArrowRight className="h-3 w-3 text-ink-muted" />
                    </>
                  ) : (
                    <span className="text-ink-muted">First code ·</span>
                  )}
                  <span className="rounded bg-surface px-2 py-0.5 font-mono font-semibold text-ink">
                    {r.requested_code}
                  </span>
                </div>
                <div className="mt-2 text-[11px] text-ink-light">
                  Asked {new Date(r.created_at).toLocaleDateString()}
                </div>
              </div>

              <div className="flex flex-shrink-0 items-center gap-2">
                {canReview ? (
                  <>
                    <button
                      onClick={() => decide(r, 'approve')}
                      disabled={busy === r.id}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-600 disabled:opacity-50"
                    >
                      {busy === r.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      Approve
                    </button>
                    <button
                      onClick={() => setDeclining(r)}
                      disabled={busy === r.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-red-300 hover:text-red-500 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      Decline
                    </button>
                  </>
                ) : (
                  <span className="text-xs text-ink-muted">Admin approval required</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {declining && (
        <DeclineReferralCodeDialog
          affiliateName={declining.affiliate_name || 'This affiliate'}
          code={declining.requested_code}
          busy={busy === declining.id}
          onClose={() => setDeclining(null)}
          onConfirm={(notes) => decide(declining, 'reject', notes)}
        />
      )}
    </>
  );
}
