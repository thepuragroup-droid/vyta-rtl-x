'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, ArrowRight, AlertCircle, Beaker, Check } from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    setLoading(true);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setSent(true);
  };

  return (
    <main className="min-h-screen bg-white flex items-center justify-center px-4 sm:px-8 py-12">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-6">
          <Link href="/login" className="inline-flex flex-col items-center gap-2">
            <div className="w-12 h-12 bg-ink rounded-xl flex items-center justify-center">
              <Beaker className="w-6 h-6 text-white" />
            </div>
            <span className="text-lg font-bold text-ink tracking-tight">Aminocan</span>
          </Link>
        </div>

        <div className="bg-white rounded-xl p-6 sm:p-8 border border-line shadow-sm">
          <AnimatePresence mode="wait">
            {sent ? (
              <motion.div
                key="sent"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center"
              >
                <div className="w-12 sm:w-14 h-12 sm:h-14 bg-emerald-50 rounded-xl flex items-center justify-center mx-auto mb-4 border border-emerald-100">
                  <Check className="w-6 sm:w-7 h-6 sm:h-7 text-emerald-600" />
                </div>
                <h2 className="text-xl sm:text-2xl font-bold text-ink mb-2">Check Your Email</h2>
                <p className="text-ink-muted text-xs sm:text-sm leading-relaxed mb-6">
                  If an account exists for <span className="font-medium text-ink">{email}</span>, we&apos;ve sent a password reset link. Check your inbox and spam folder.
                </p>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 text-bronze hover:text-bronze-dark font-semibold text-sm"
                >
                  Back to Login
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </motion.div>
            ) : (
              <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <div className="text-center mb-5 sm:mb-6">
                  <h2 className="text-xl sm:text-2xl font-bold text-ink mb-1">Forgot Password</h2>
                  <p className="text-ink-muted text-xs sm:text-sm">Enter your email and we&apos;ll send a reset link</p>
                </div>

                {error && (
                  <div className="mb-4 p-2.5 sm:p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <span className="text-red-700 text-xs sm:text-sm">{error}</span>
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs sm:text-sm font-medium text-ink mb-1 sm:mb-1.5">Email Address</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 sm:py-3 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 focus:border-transparent text-sm text-ink placeholder-ink-muted"
                        placeholder="you@example.com"
                        autoComplete="email"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-ink hover:bg-ink/90 text-white font-semibold py-2.5 sm:py-3 rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 text-sm"
                  >
                    {loading ? (
                      <span>Sending...</span>
                    ) : (
                      <>
                        <span>Send Reset Link</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>

                <div className="mt-5 text-center">
                  <Link href="/login" className="text-bronze hover:text-bronze-dark text-xs sm:text-sm font-medium">
                    Back to Login
                  </Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </main>
  );
}
