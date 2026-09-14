'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { X, Check, Mail, AlertTriangle, Loader2 } from 'lucide-react';
import { createAffiliate, sendCustomerMagicLink } from '@/lib/admin/api';
import { isValidWalletAddress, suggestReferralCode } from '@/lib/affiliate/utils';
import ReferralCodeField, { type AvailabilityState } from '@/components/affiliate/ReferralCodeField';
import { checkReferralCodeForAffiliate } from '@/lib/admin/referral-codes';

export default function CreateAffiliateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    wallet_address: '',
    active: true,
  });
  const [code, setCode] = useState('');
  const [codeAvailability, setCodeAvailability] = useState<AvailabilityState>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { emailed: boolean; code: string | null }>(null);

  const suggestion = suggestReferralCode(form.first_name, form.last_name);

  // No affiliate exists yet, so nobody's ownership of the code is forgiven.
  const checkCode = useCallback((value: string) => checkReferralCodeForAffiliate(value, null), []);

  // The suggestion follows the name while the admin is still typing it, but
  // only while they have not touched the code field themselves.
  const [codeTouched, setCodeTouched] = useState(false);
  useEffect(() => {
    if (codeTouched) return;
    setCode(suggestion ?? '');
  }, [suggestion, codeTouched]);

  const handleCreate = async () => {
    setError(null);
    if (!form.first_name || !form.last_name || !form.email) {
      setError('First name, last name and email are required');
      return;
    }
    if (form.wallet_address && !isValidWalletAddress(form.wallet_address)) {
      setError('Wallet address must be a valid 0x… address');
      return;
    }

    setSaving(true);
    const result = await createAffiliate({
      first_name: form.first_name,
      last_name: form.last_name,
      email: form.email,
      wallet_address: form.wallet_address || null,
      active: form.active,
      referral_code: code || undefined,
    });

    if (!result.success || !result.affiliate_id) {
      setSaving(false);
      setError(result.error || 'Failed to create affiliate');
      return;
    }

    // Send the set-password link so the new affiliate can sign in.
    const link = await sendCustomerMagicLink(result.affiliate_id, '/reset-password');
    setSaving(false);
    setDone({ emailed: link.success, code: result.referral_code ?? code ?? null });
    onCreated();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-ink">Add Affiliate</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-ink-muted" /></button>
        </div>

        {done ? (
          <div className="text-center py-4">
            {done.emailed ? (
              <>
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-3">
                  <Check className="w-6 h-6 text-emerald-500" />
                </div>
                <p className="font-semibold text-ink mb-1">Affiliate created</p>
                <p className="text-sm text-ink-muted flex items-center justify-center gap-1.5">
                  <Mail className="w-4 h-4" /> A set-password link was emailed to them.
                </p>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-3">
                  <AlertTriangle className="w-6 h-6 text-amber-500" />
                </div>
                <p className="font-semibold text-ink mb-1">Affiliate created</p>
                <p className="text-sm text-ink-muted">
                  We couldn&apos;t email the set-password link. Send them a password reset manually.
                </p>
              </>
            )}
            {done.code && (
              <p className="mt-3 text-sm text-ink-muted">
                Referral code:{' '}
                <span className="font-mono font-semibold text-ink">{done.code}</span>
              </p>
            )}
            <button
              onClick={onClose}
              className="mt-5 w-full px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/90 transition-colors"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {error && (
              <p className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</p>
            )}
            <div className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink-muted mb-1">First name *</label>
                  <input
                    type="text"
                    value={form.first_name}
                    onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                    className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bronze/40"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-muted mb-1">Last name *</label>
                  <input
                    type="text"
                    value={form.last_name}
                    onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                    className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bronze/40"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">Email *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bronze/40"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">Wallet Address</label>
                <input
                  type="text"
                  placeholder="0x…"
                  value={form.wallet_address}
                  onChange={(e) => setForm({ ...form, wallet_address: e.target.value })}
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-bronze/40"
                />
                <p className="text-[11px] text-ink-muted mt-1">Where commission payouts will be sent. Optional.</p>
              </div>
              <ReferralCodeField
                value={code}
                onChange={(v) => {
                  setCodeTouched(true);
                  setCode(v);
                }}
                onAvailabilityChange={setCodeAvailability}
                suggestion={suggestion}
                check={checkCode}
                disabled={saving}
              />
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  className="accent-bronze"
                />
                Active
              </label>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg text-sm font-medium hover:bg-line transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={saving || (code !== '' && codeAvailability.kind !== 'free')}
                className="flex-1 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? 'Creating & sending…' : 'Create Affiliate'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
