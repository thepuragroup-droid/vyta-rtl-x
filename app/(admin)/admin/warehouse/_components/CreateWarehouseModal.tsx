'use client';

import React, { useState } from 'react';
import { X, Eye, EyeOff, RefreshCw, Copy, Check, Mail } from 'lucide-react';
import { createUser } from '@/lib/admin/api';
import { generatePassword, validatePassword, copyToClipboard } from '@/lib/password';

interface CreateWarehouseModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateWarehouseModal({ onClose, onSuccess }: CreateWarehouseModalProps) {
  const [formData, setFormData] = useState({
    email: '',
    first_name: '',
    last_name: '',
    phone: '',
    active: true,
    can_send_fulfillment_emails: false,
  });

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const handleGeneratePassword = () => {
    setPassword(generatePassword(16));
  };

  const handleCopyPassword = async () => {
    const success = await copyToClipboard(password);
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

    if (!password) {
      setError('Please generate or enter a password');
      return;
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      setError(passwordValidation.message);
      return;
    }

    setLoading(true);

    const result = await createUser({
      email: formData.email,
      first_name: formData.first_name,
      last_name: formData.last_name,
      phone: formData.phone,
      active: formData.active,
      can_send_fulfillment_emails: formData.can_send_fulfillment_emails,
      role: 'warehouse',
      password_hash: password,
    });

    if (result.success) {
      onSuccess();
    } else {
      setError(result.error || 'Failed to create warehouse account');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-line flex items-center justify-between sticky top-0 bg-white">
          <div>
            <h2 className="text-lg font-bold text-ink">Create Warehouse Account</h2>
            <p className="text-xs text-ink-muted mt-0.5">
              Creates a staff account with the warehouse role.
            </p>
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
              className="w-full px-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink"
              placeholder="staff@example.com"
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
              className="w-full px-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink"
              placeholder="John"
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
              className="w-full px-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink"
              placeholder="Doe"
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
              className="w-full px-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink"
              placeholder="+1 (555) 123-4567"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">
              Password <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 pr-10 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink font-mono"
                  placeholder="Enter or generate password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button
                type="button"
                onClick={handleGeneratePassword}
                className="px-3 py-2.5 bg-bronze/10 border border-bronze/20 text-bronze rounded-lg hover:bg-bronze/20 transition-colors flex items-center gap-2"
                title="Generate password"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              {password && (
                <button
                  type="button"
                  onClick={handleCopyPassword}
                  className="px-3 py-2.5 bg-bronze/10 border border-bronze/20 text-bronze rounded-lg hover:bg-bronze/20 transition-colors flex items-center gap-2"
                  title="Copy password"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              )}
            </div>
            <p className="text-xs text-ink-muted mt-1.5">
              Password must be at least 8 characters with uppercase, lowercase, number, and special character
            </p>
          </div>

          {/* Fulfillment email permission */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="can_send_fulfillment_emails"
              checked={formData.can_send_fulfillment_emails}
              onChange={(e) =>
                setFormData({ ...formData, can_send_fulfillment_emails: e.target.checked })
              }
              className="w-4 h-4 rounded border-line text-bronze focus:ring-bronze/40"
            />
            <label
              htmlFor="can_send_fulfillment_emails"
              className="text-sm text-ink cursor-pointer inline-flex items-center gap-1.5"
            >
              <Mail className="w-4 h-4 text-ink-muted" /> Can send fulfillment emails
            </label>
          </div>

          {/* Active Status */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="active"
              checked={formData.active}
              onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
              className="w-4 h-4 rounded border-line text-bronze focus:ring-bronze/40"
            />
            <label htmlFor="active" className="text-sm text-ink cursor-pointer">
              Active (staff can log in)
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
              {loading ? 'Creating...' : 'Create Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
