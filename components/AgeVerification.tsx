'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

const STORAGE_KEY = 'aminocan_age_verified';
const EXPIRY_DAYS = 30;

export default function AgeVerification() {
  const [showModal, setShowModal] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Check if user has already verified
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const { expiry } = JSON.parse(stored);
        if (new Date().getTime() < expiry) {
          // Still valid, don't show modal
          return;
        }
      } catch {
        // Corrupt value — fall through and re-prompt.
      }
    }
    // Show the gate immediately so the storefront never flashes behind it.
    setShowModal(true);
  }, []);

  // While the gate is open: lock body scroll, move focus into the modal, and
  // trap Tab focus so keyboard users can't escape into the content behind it.
  useEffect(() => {
    if (!showModal) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the primary action once the modal is mounted.
    const focusTimer = setTimeout(() => acceptRef.current?.focus(), 0);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const modal = modalRef.current;
      if (!modal) return;

      const focusable = modal.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (activeEl === first || !modal.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (activeEl === last || !modal.contains(activeEl)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [showModal]);

  const handleAccept = () => {
    // Store verification with expiry
    const expiry = new Date().getTime() + (EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ verified: true, expiry }));
    setShowModal(false);
  };

  const handleDecline = () => {
    // Redirect to Google or another page
    window.location.href = 'https://www.google.com';
  };

  return (
    <AnimatePresence>
      {showModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="age-verification-title"
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
        >
          <motion.div
            ref={modalRef}
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ duration: 0.2 }}
            className="bg-white rounded-2xl max-w-md w-full overflow-hidden shadow-2xl"
          >
            {/* Header */}
            <div className="bg-gray-900 px-6 py-8 text-center">
              <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <ShieldCheck className="w-8 h-8 text-white" />
              </div>
              <h2 id="age-verification-title" className="text-2xl font-bold text-white tracking-tight">
                Age Verification
              </h2>
              <p className="text-white/60 text-sm mt-1">
                You must be 19+ to enter this site
              </p>
            </div>

            {/* Content */}
            <div className="p-6">
              {/* Warning Notice */}
              <div className="flex items-start gap-3 bg-amber-50 border border-amber-200/60 rounded-xl p-4 mb-6">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800 leading-relaxed">
                  <strong>Research Purposes Only.</strong> Our products are not intended for human or animal consumption.
                </p>
              </div>

              <p className="text-gray-900 text-center mb-2 font-semibold">
                Are you 19 years of age or older?
              </p>

              <p className="text-gray-500 text-sm text-center mb-6 leading-relaxed">
                By selecting &ldquo;Yes&rdquo;, you confirm you are of legal age and agree to our{' '}
                <Link href="/terms" className="font-medium text-gray-900 underline hover:text-gray-700">
                  terms and conditions
                </Link>
                .
              </p>

              {/* Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleDecline}
                  className="flex-1 py-3.5 px-6 rounded-xl border border-stone-200 text-gray-700 font-medium hover:bg-stone-50 hover:border-stone-300 transition-colors"
                >
                  No, Exit
                </button>
                <button
                  ref={acceptRef}
                  onClick={handleAccept}
                  className="flex-1 py-3.5 px-6 rounded-xl bg-gray-900 hover:bg-gray-800 text-white font-medium transition-colors"
                >
                  Yes, I Agree
                </button>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 pb-6">
              <p className="text-xs text-gray-400 text-center leading-relaxed">
                This site is intended for adults 19 years of age or older in accordance with local laws.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
