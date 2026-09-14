'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LogIn, Mail, Lock, Eye, EyeOff, ArrowRight, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import PeptideLoader from '@/components/PeptideLoader';

export default function LoginModal() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAnimation, setShowAnimation] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Please enter email and password');
      return;
    }

    setLoading(true);

    try {
      console.log('1 - submit started'); 
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
console.log('2 - auth finished');
console.log('Auth response:', { data, authError });
console.log('3 - before redirect');
      if (authError) {
        setError(authError.message);
      } else if (data.session) {
        await supabase.from('customers').update({ website_accessed: 'aminocan' }).eq('id', data.session.user.id);
        setShowAnimation(true);
        setTimeout(() => {
          window.location.href = '/';
        }, 2500);
        return;
      }
    } catch {
      setError('An unexpected error occurred');
    }

    setLoading(false);
  };

  return (
    <>
      <AnimatePresence>
        {showAnimation && <PeptideLoader message="Signing you in..." type="login" />}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      >
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.05, duration: 0.3, ease: 'easeOut' }}
          className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* Header section */}
          <div className="bg-ink px-6 sm:px-8 pt-7 pb-6">
            {/* Logo */}
            <div className="text-center mb-5">
              <Link href="/login" className="inline-flex flex-col items-center gap-2">
                {/* Dark masthead: the mark sits on a light tile rather than
                    being recoloured — the ground the guidelines prefer. */}
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/95 p-1.5">
                  <img
                    src="/images/vyta-mark.png"
                    alt=""
                    aria-hidden="true"
                    className="h-full w-full object-contain"
                  />
                </span>
                <span className="font-display text-lg font-semibold tracking-[0.18em] text-white">VYTA</span>
              </Link>
            </div>
          </div>

          {/* Form section */}
          <div className="px-6 sm:px-8 py-6">
            <div className="text-center mb-5">
              <h2 className="text-xl sm:text-2xl font-bold text-ink mb-1">Welcome Back</h2>
              <p className="text-ink-muted text-xs sm:text-sm">Sign in to your account</p>
            </div>

            {error && (
              <div className="mb-4 p-2.5 sm:p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                <span className="text-red-700 text-xs sm:text-sm">{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
              <div>
                <label className="block text-xs sm:text-sm font-medium text-ink mb-1 sm:mb-1.5">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 sm:py-3 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-transparent text-sm text-ink placeholder-ink-muted"
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-medium text-ink mb-1 sm:mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-10 py-2.5 sm:py-3 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-transparent text-sm text-ink placeholder-ink-muted"
                    placeholder="Enter your password"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-ink hover:bg-ink/90 text-white font-semibold py-2.5 sm:py-3 rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 text-sm"
              >
                {loading ? (
                  <span>Signing in...</span>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    <span>Sign In</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-4 text-center">
              <Link href="/forgot-password" className="text-[10px] sm:text-xs text-ink-muted hover:text-teal-dark transition-colors">
                Forgot your password?
              </Link>
            </div>

            <div className="mt-4 text-center">
              <p className="text-ink-muted text-xs sm:text-sm">
                Don&apos;t have an account?{' '}
                <Link href="/signup" className="text-teal-dark hover:text-teal-dark font-medium">
                  Create one
                </Link>
              </p>
            </div>

            <div className="mt-3 pt-3 border-t border-line text-center">
              <p className="text-[10px] sm:text-xs text-ink-muted">
                Looking for affiliate login?{' '}
                <Link href="/affiliate/login" className="text-teal-dark">
                  Click here
                </Link>
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </>
  );
}
