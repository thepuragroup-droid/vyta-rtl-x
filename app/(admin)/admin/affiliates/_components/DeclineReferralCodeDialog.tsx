'use client';

import React, { useState } from 'react';
import { Loader2, X } from 'lucide-react';

/**
 * Shared by the review queue and Partner 360 so both ask the same way.
 *
 * The reason is OPTIONAL — declining a code is not declining an application.
 * Whatever is written stays on the admin side, next to the reviewer's name.
 */
export default function DeclineReferralCodeDialog({
  affiliateName,
  code,
  busy = false,
  onClose,
  onConfirm,
}: {
  affiliateName: string;
  code: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (notes: string) => void;
}) {
  const [notes, setNotes] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-bold text-ink">Decline code request</h3>
          <button onClick={onClose} aria-label="Close">
            <X className="h-4 w-4 text-ink-muted" />
          </button>
        </div>

        <p className="mb-4 text-sm text-ink-muted">
          {affiliateName} asked for <span className="font-mono text-ink">{code}</span>. They keep
          the code they have.
        </p>

        <label className="mb-1 block text-xs font-medium text-ink-muted">Reason (optional)</label>
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Kept for the desk — the affiliate is only told it was declined."
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
        />
        <p className="mt-1 text-[11px] text-ink-muted">
          Shown here with your name, never on the affiliate&apos;s screen.
        </p>

        <div className="mt-5 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg bg-surface px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-line"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(notes.trim())}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}
