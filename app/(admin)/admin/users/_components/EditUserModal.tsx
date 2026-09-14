'use client';

import React, { useState } from 'react';
import { X, RefreshCw, Copy, Check, Eye, EyeOff } from 'lucide-react';
import { updateUser } from '@/lib/admin/api';
import { generatePassword, copyToClipboard } from '@/lib/password';
import type { Customer } from '@/lib/supabase';

interface EditUserModalProps {
  user: Customer;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EditUserModal({ user, onClose, onSuccess }: EditUserModalProps) {
  const [formData, setFormData] = useState({
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    phone: user.phone || '',
    role: user.role,
    active: user.active,
    preferred_currency: (user.preferred_currency === 'USD' ? 'USD' : 'CAD') as 'CAD' | 'USD',
  });

  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const handleGeneratePassword = () => {
    const password = generatePassword(16);
    setNewPassword(password);
  };

  const handleCopyPassword = async () => {
    const success = await copyToClipboard(newPassword);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!formData.email || !formData.first_name || !formData.last_name) {
      setError('Please fill in all required fields');
      return;
    }

    setLoading(true);

    const updates: any = {
      email: formData.email,
      first_name: formData.first_name,
      last_name: formData.last_name,
      phone: formData.phone || null,
      role: formData.role,
      active: formData.active,
      preferred_currency: formData.preferred_currency,
    };

    // Include new password if set
    if (newPassword) {
      updates.new_password = newPassword;
    }

    const result = await updateUser(user.id, updates);

    if (result.success) {
      onSuccess();
    } else {
      setError(result.error || 'Failed to update user');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-line flex items-center justify-between sticky top-0 bg-white">
          <div>
            <h2 className="text-lg font-bold text-ink">Edit User</h2>
            <p className="text-xs text-ink-muted mt-0.5">{user.email}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-teal/40 text-sm text-ink"
              required
            />
          </div>

          {/* First Name */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              First Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.first_name}
              onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
              className="w-full px-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-teal/40 text-sm text-ink"
              required
            />
          </div>

          {/* Last Name */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Last Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.last_name}
              onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
              className="w-full px-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-teal/40 text-sm text-ink"
              required
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Phone (Optional)</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-teal/40 text-sm text-ink"
            />
          </div>

          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Role <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as typeof formData.role })}
              className="w-full px-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-teal/40 text-sm text-ink"
            >
              <option value="customer">Customer</option>
              <option value="analytics">Analytics</option>
              <option value="assistant">Assistant</option>
              <option value="admin">Administrator</option>
            </select>
          </div>

          {/* Billing currency */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Billing currency</label>
            <div className="grid grid-cols-2 gap-2">
              {(['CAD', 'USD'] as const).map((cur) => (
                <button
                  key={cur}
                  type="button"
                  onClick={() => setFormData({ ...formData, preferred_currency: cur })}
                  className={`px-4 py-2.5 rounded-lg text-sm font-semibold border transition-colors ${
                    formData.preferred_currency === cur
                      ? 'bg-teal-dark text-white border-teal'
                      : 'bg-surface text-ink-muted border-line hover:text-ink'
                  }`}
                >
                  {cur === 'CAD' ? '🇨🇦 CAD' : '🇺🇸 USD'}
                </button>
              ))}
            </div>
            <p className="text-xs text-ink-muted mt-1.5">New invoices for this customer default to this currency.</p>
          </div>

          {/* Reset Password */}
          <div className="border-t border-line pt-4">
            <label className="block text-sm font-medium text-ink mb-1.5">Reset Password (Optional)</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-2.5 pr-10 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-teal/40 text-sm text-ink font-mono"
                  placeholder="Leave empty to keep current password"
                />
                {newPassword && (
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={handleGeneratePassword}
                className="px-3 py-2.5 bg-teal/10 border border-teal/20 text-teal-dark rounded-lg hover:bg-teal/20 transition-colors flex items-center gap-2"
                title="Generate new password"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              {newPassword && (
                <button
                  type="button"
                  onClick={handleCopyPassword}
                  className="px-3 py-2.5 bg-teal/10 border border-teal/20 text-teal-dark rounded-lg hover:bg-teal/20 transition-colors flex items-center gap-2"
                  title="Copy password"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              )}
            </div>
            {newPassword && (
              <p className="text-xs text-amber-600 mt-1.5">
                Remember to share this password with the user securely
              </p>
            )}
          </div>

          {/* Active Status */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="active"
              checked={formData.active}
              onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
              className="w-4 h-4 rounded border-line text-teal-dark focus:ring-teal/40"
            />
            <label htmlFor="active" className="text-sm text-ink cursor-pointer">
              Active (user can log in)
            </label>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg text-sm font-medium hover:bg-line transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/90 transition-colors disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
