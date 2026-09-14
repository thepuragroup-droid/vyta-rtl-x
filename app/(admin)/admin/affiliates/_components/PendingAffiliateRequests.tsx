'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { UserPlus, Check, X, Wallet, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type AffiliateRequest = {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  wallet_address: string | null;
  message: string | null;
  created_at: string;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  return headers;
}

export default function PendingAffiliateRequests({
  canReview,
  onApproved,
}: {
  canReview: boolean;
  onApproved?: () => void;
}) {
  const [requests, setRequests] = useState<AffiliateRequest[]>([]);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/affiliate-requests?status=pending', {
        headers: await authHeaders(),
      });
      if (!res.ok) return;
      const { requests } = await res.json();
      setRequests(requests || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const review = async (id: string, action: 'approve' | 'deny') => {
    setReviewing(id);
    try {
      const res = await fetch(`/api/admin/affiliate-requests/${id}`, {
        method: 'PATCH',
        headers: await authHeaders(),
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        setRequests((prev) => prev.filter((r) => r.id !== id));
        if (action === 'approve') onApproved?.();
      }
    } finally {
      setReviewing(null);
    }
  };

  // Hidden entirely when there are no pending requests.
  if (requests.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-teal/30 overflow-hidden mb-6">
      <div className="p-5 border-b border-line flex items-center gap-2">
        <UserPlus className="w-4 h-4 text-teal-dark" />
        <h2 className="text-lg font-bold text-ink">Affiliate Requests</h2>
        <span className="ml-1 text-xs font-semibold bg-teal/10 text-teal-dark px-2 py-0.5 rounded-full">
          {requests.length}
        </span>
      </div>
      <div className="divide-y divide-line/50">
        {requests.map((r) => (
          <div key={r.id} className="p-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="min-w-0">
              <div className="font-medium text-ink text-sm">{r.customer_name || '—'}</div>
              <div className="text-xs text-ink-muted">{r.customer_email}</div>
              {r.wallet_address && (
                <div className="flex items-center gap-1.5 mt-2 text-xs text-ink-muted font-mono">
                  <Wallet className="w-3.5 h-3.5" />
                  {r.wallet_address}
                </div>
              )}
              {r.message && (
                <p className="mt-2 text-xs text-ink bg-surface border border-line rounded-lg px-3 py-2">
                  {r.message}
                </p>
              )}
              <div className="text-[11px] text-ink-light mt-2">
                Requested {new Date(r.created_at).toLocaleDateString()}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {canReview ? (
                <>
                  <button
                    onClick={() => review(r.id, 'approve')}
                    disabled={reviewing === r.id}
                    className="inline-flex items-center gap-1.5 bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50"
                  >
                    {reviewing === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Approve
                  </button>
                  <button
                    onClick={() => review(r.id, 'deny')}
                    disabled={reviewing === r.id}
                    className="inline-flex items-center gap-1.5 bg-white border border-line text-ink-muted px-3 py-1.5 rounded-lg text-xs font-medium hover:border-red-300 hover:text-red-500 transition-colors disabled:opacity-50"
                  >
                    <X className="w-3.5 h-3.5" />
                    Deny
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
  );
}
