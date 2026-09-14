'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import ReferralCodeField, { type AvailabilityState } from '@/components/affiliate/ReferralCodeField';
import {
  checkReferralCodeForAffiliate,
  setAffiliateReferralCode,
  suggestAffiliateReferralCode,
} from '@/lib/admin/referral-codes';
import { normalizeReferralCode } from '@/lib/affiliate/utils';

/**
 * An admin setting a partner's code outright. No queue — this IS the decision.
 */
export default function EditReferralCodeModal({
  affiliateId,
  affiliateName,
  currentCode,
  onClose,
  onSaved,
}: {
  affiliateId: string;
  affiliateName: string;
  currentCode: string | null;
  onClose: () => void;
  onSaved: (result: { code: string; notified: boolean; notifyError?: string | null }) => void;
}) {
  const [value, setValue] = useState(currentCode ?? '');
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [availability, setAvailability] = useState<AvailabilityState>({ kind: 'idle' });
  const [notify, setNotify] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    suggestAffiliateReferralCode(affiliateId).then(setSuggestion);
  }, [affiliateId]);

  const check = useCallback(
    (code: string) => checkReferralCodeForAffiliate(code, affiliateId),
    [affiliateId],
  );

  const unchanged = normalizeReferralCode(value) === normalizeReferralCode(currentCode);

  const save = async () => {
    setSaving(true);
    setError(null);
    const result = await setAffiliateReferralCode(affiliateId, value, notify);
    setSaving(false);

    if (!result.success) {
      setError(result.error ?? 'Could not save the referral code.');
      return;
    }
    onSaved({
      code: result.code ?? normalizeReferralCode(value),
      notified: !!result.notified,
      notifyError: result.notifyError,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-bold text-ink">{currentCode ? 'Change referral code' : 'Set referral code'}</h3>
          <button onClick={onClose} aria-label="Close">
            <X className="h-4 w-4 text-ink-muted" />
          </button>
        </div>

        {currentCode && (
          <div className="mb-4 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-500" />
            <p className="text-xs leading-relaxed text-amber-800">
              Saving retires <strong className="font-mono">{currentCode}</strong> immediately —
              links and cards carrying it stop working. Uses and commissions already recorded stay
              with this partner.
            </p>
          </div>
        )}

        {error && (
          <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}

        <ReferralCodeField
          value={value}
          onChange={setValue}
          onAvailabilityChange={setAvailability}
          suggestion={suggestion}
          check={check}
          disabled={saving}
          autoFocus
        />

        <label className="mt-4 flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
            className="mt-0.5 accent-bronze"
          />
          <span>
            Email {affiliateName} their new code
            <span className="mt-0.5 block text-[11px] text-ink-muted">
              Sent only if the change saves. Untick if you are telling them another way.
            </span>
          </span>
        </label>

        <div className="mt-5 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg bg-surface px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-line"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || unchanged || availability.kind !== 'free'}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-ink/90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save code
          </button>
        </div>
      </div>
    </div>
  );
}
