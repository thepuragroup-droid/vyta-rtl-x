'use client';

import React, { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { updateAffiliate } from '@/lib/admin/api';
import { isValidWalletAddress } from '@/lib/affiliate/utils';

type AffiliateRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  wallet_address: string | null;
  active: boolean;
};

export default function EditAffiliateModal({
  affiliate,
  onClose,
  onSaved,
}: {
  affiliate: AffiliateRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    first_name: affiliate.first_name,
    last_name: affiliate.last_name,
    email: affiliate.email,
    wallet_address: affiliate.wallet_address || '',
    password: '',
    active: affiliate.active,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
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
    const result = await updateAffiliate(affiliate.id, {
      first_name: form.first_name,
      last_name: form.last_name,
      email: form.email,
      wallet_address: form.wallet_address || null,
      active: form.active,
      ...(form.password ? { password: form.password } : {}),
    });
    setSaving(false);

    if (!result.success) {
      setError(result.error || 'Failed to save changes');
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-ink">Edit Affiliate</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-ink-muted" /></button>
        </div>

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
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">Last name *</label>
              <input
                type="text"
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">Email *</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">Wallet Address</label>
            <input
              type="text"
              placeholder="0x…"
              value={form.wallet_address}
              onChange={(e) => setForm({ ...form, wallet_address: e.target.value })}
              className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal/40"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">New Password (leave blank to keep current)</label>
            <input
              type="text"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal/40"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
              className="accent-teal"
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
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
