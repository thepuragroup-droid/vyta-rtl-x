'use client';

import React, { useState } from 'react';
import { Lock, Check, AlertCircle, Eye, EyeOff, KeyRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Variant = 'customer' | 'admin';

/**
 * Self-service password change for any logged-in Supabase user. Used on both
 * the customer account dashboard and the admin settings panel (see `variant`).
 *
 * Supabase's `updateUser({ password })` does NOT ask for the current password,
 * so we re-authenticate with `signInWithPassword` first to prove the person at
 * the keyboard actually knows it before allowing the change.
 */
export default function ChangePasswordForm({ variant = 'customer' }: { variant?: Variant }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const reset = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (!currentPassword) {
      setError('Enter your current password');
      return;
    }
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    if (newPassword === currentPassword) {
      setError('New password must be different from your current password');
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const email = user?.email;
      if (!email) {
        setError('Your session has expired. Please sign in again.');
        return;
      }

      // 1. Verify the current password by re-authenticating.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (signInError) {
        setError('Your current password is incorrect');
        return;
      }

      // 2. Apply the new password.
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        setError(updateError.message);
        return;
      }

      setSuccess(true);
      reset();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const isAdmin = variant === 'admin';

  const inputClass = isAdmin
    ? 'w-full pl-10 pr-10 py-2.5 bg-surface rounded-lg border border-line text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-bronze/40 disabled:opacity-50'
    : 'w-full pl-10 pr-10 py-2 sm:py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent';

  const iconClass = isAdmin
    ? 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted'
    : 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400';

  const toggleClass = isAdmin
    ? 'absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink'
    : 'absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600';

  const buttonClass = isAdmin
    ? 'inline-flex items-center gap-1.5 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/90 disabled:opacity-50'
    : 'w-full bg-gradient-to-r from-cyan-500 to-blue-500 text-white py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-semibold hover:from-cyan-600 hover:to-blue-600 disabled:opacity-50 transition-all shadow-lg shadow-cyan-500/25 flex items-center justify-center gap-2';

  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    autoComplete: string,
  ) => (
    <div>
      <label className={isAdmin ? 'block text-sm font-medium text-ink mb-1.5' : 'block text-xs sm:text-sm font-medium text-slate-700 mb-1 sm:mb-1.5'}>
        {label}
      </label>
      <div className="relative">
        <Lock className={iconClass} />
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={loading}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className={toggleClass}
          tabIndex={-1}
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && (
        <div className="p-2.5 sm:p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span className="text-red-700 text-xs sm:text-sm">{error}</span>
        </div>
      )}
      {success && (
        <div className="p-2.5 sm:p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span className="text-emerald-700 text-xs sm:text-sm">Password updated successfully</span>
        </div>
      )}

      {field('Current Password', currentPassword, setCurrentPassword, 'Current password', 'current-password')}
      {field('New Password', newPassword, setNewPassword, 'Min. 6 characters', 'new-password')}
      {field('Confirm New Password', confirmPassword, setConfirmPassword, 'Re-enter new password', 'new-password')}

      <button type="submit" disabled={loading} className={buttonClass}>
        <KeyRound className="w-4 h-4" />
        {loading ? 'Updating…' : 'Update Password'}
      </button>
    </form>
  );
}
