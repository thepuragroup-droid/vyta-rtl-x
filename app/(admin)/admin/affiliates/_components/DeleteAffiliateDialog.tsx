'use client';

import React, { useState } from 'react';
import { X, PowerOff, Trash2, Loader2 } from 'lucide-react';
import { deleteAffiliate, toggleAffiliateActive } from '@/lib/admin/api';

type AffiliateRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
};

export default function DeleteAffiliateDialog({
  affiliate,
  onClose,
  onDone,
}: {
  affiliate: AffiliateRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<'soft' | 'hard' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (mode: 'soft' | 'hard') => {
    setBusy(mode);
    setError(null);
    const result = mode === 'hard'
      ? await deleteAffiliate(affiliate.id)
      : await toggleAffiliateActive(affiliate.id, false);
    setBusy(null);
    if (!result.success) {
      setError(result.error || 'Action failed');
      return;
    }
    onDone();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-sm p-6 shadow-xl">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-ink">Remove Affiliate</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-ink-muted" /></button>
        </div>
        <p className="text-sm text-ink-muted mb-4">
          {affiliate.first_name} {affiliate.last_name}
          <span className="block text-xs">{affiliate.email}</span>
        </p>

        {error && (
          <p className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</p>
        )}

        <div className="space-y-3">
          <div className="border border-line rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <PowerOff className="w-4 h-4 text-amber-500" />
              <span className="font-medium text-ink text-sm">Deactivate</span>
            </div>
            <p className="text-xs text-ink-muted mb-3">
              Bans sign-in and hides them from active lists. Keeps all data and commissions.
            </p>
            <button
              onClick={() => run('soft')}
              disabled={busy !== null}
              className="w-full px-4 py-2 bg-amber-500/10 border border-amber-500/20 text-amber-600 rounded-lg text-sm font-medium hover:bg-amber-500/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy === 'soft' && <Loader2 className="w-4 h-4 animate-spin" />}
              Deactivate
            </button>
          </div>

          <div className="border border-red-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <Trash2 className="w-4 h-4 text-red-500" />
              <span className="font-medium text-ink text-sm">Delete Permanently</span>
            </div>
            <p className="text-xs text-ink-muted mb-3">
              Removes the affiliate, referral codes, commissions and login. This cannot be undone.
            </p>
            <button
              onClick={() => run('hard')}
              disabled={busy !== null}
              className="w-full px-4 py-2 bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg text-sm font-medium hover:bg-red-500/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy === 'hard' && <Loader2 className="w-4 h-4 animate-spin" />}
              Delete Permanently
            </button>
          </div>
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full px-4 py-2 bg-surface border border-line rounded-lg text-sm text-ink-muted hover:text-ink transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
