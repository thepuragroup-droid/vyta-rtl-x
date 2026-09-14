"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAffiliate } from "@/contexts/AffiliateContext";
import { useCustomer } from "@/contexts/CustomerContext";
import { createAffiliate, getReferralCodes } from "@/lib/affiliate/api";
import { apiFetch } from "@/lib/api-fetch";
import { isValidWalletAddress, suggestReferralCode } from "@/lib/affiliate/utils";
import ReferralCodeField, { type AvailabilityState } from "@/components/affiliate/ReferralCodeField";
import { checkReferralCode } from "@/lib/affiliate/referral-codes";
import {
  Wallet,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

export default function AffiliateSignup() {
  const router = useRouter();
  const { affiliate, isLoading: affiliateLoading, updateAffiliateData } = useAffiliate();
  const { customer, isLoading: customerLoading } = useCustomer();

  const [walletAddress, setWalletAddress] = useState("");
  const [codeChoice, setCodeChoice] = useState("");
  const [codeAvailability, setCodeAvailability] = useState<AvailabilityState>({ kind: "idle" });
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isLoading = affiliateLoading || customerLoading;

  const suggestion = customer
    ? suggestReferralCode(customer.first_name, customer.last_name)
    : null;

  // Seeded ONCE, when the customer resolves — guarded by a ref rather than by
  // "is the field empty". Clearing the box is a deliberate act, and the
  // suggestion reappearing under the cursor is not help.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !suggestion) return;
    seeded.current = true;
    setCodeChoice(suggestion);
  }, [suggestion]);

  const checkCode = useCallback((code: string) => checkReferralCode(code), []);

  // Once loading is done, redirect based on state
  useEffect(() => {
    if (isLoading) return;
    if (affiliate) {
      router.replace("/affiliate/dashboard");
      return;
    }
    if (!customer) {
      router.replace("/login?redirect=/affiliate/signup");
    }
  }, [isLoading, affiliate, customer, router]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (walletAddress && !isValidWalletAddress(walletAddress)) {
      newErrors.walletAddress = "Invalid Ethereum wallet address";
    }
    if (!agreedToTerms) {
      newErrors.agreedToTerms = "You must agree to the affiliate program terms";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer) return;
    if (!validateForm()) return;

    setIsSubmitting(true);

    const result = await createAffiliate({
      email: customer.email,
      firstName: customer.first_name,
      lastName: customer.last_name,
      walletAddress: walletAddress || undefined,
      referralCode: codeChoice || undefined,
    });

    setIsSubmitting(false);

    if (result.success && result.affiliate) {
      updateAffiliateData(result.affiliate);

      // Send welcome email with referral code (non-blocking)
      getReferralCodes(result.affiliate.id).then((codes) => {
        const activeCode = codes.find((c) => c.active);
        if (activeCode) {
          apiFetch("/api/email", {
            method: "POST",
            body: JSON.stringify({
              type: "affiliate_welcome",
              to: customer.email,
              affiliateName: customer.first_name,
              referralCode: activeCode.code,
            }),
          }).catch((err) => console.error("Failed to send affiliate welcome email:", err));
        }
      });

      router.push("/affiliate/dashboard");
    } else {
      setErrors({ submit: result.error || "Failed to create affiliate account" });
    }
  };

  // Show spinner while auth state resolves
  if (isLoading || (!customer && !affiliate)) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-teal border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  // Already an affiliate — redirect handled by useEffect, show nothing
  if (affiliate) return null;

  return (
    <main className="min-h-screen bg-white flex items-center justify-center px-4 sm:px-8 py-12">
      <div className="w-full max-w-md">
        {/* Back to main */}
        <div className="mb-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-ink-muted hover:text-ink transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to main site
          </Link>
        </div>

        {/* Logo */}
        <div className="text-center mb-6">
          <Link href="/" className="inline-flex flex-col items-center gap-2">
            <img src="/images/vyta-mark.png" alt="" aria-hidden="true" className="w-12 h-12 object-contain" />
            <span className="text-lg font-bold text-ink tracking-tight">VYTA</span>
          </Link>
        </div>

        {/* Header */}
        <div className="text-center mb-5 sm:mb-6">
          <span className="text-[10px] sm:text-xs font-semibold text-teal-dark uppercase tracking-[0.2em] mb-2 block">
            Commission Program
          </span>
          <h2 className="text-xl sm:text-2xl font-bold text-ink mb-1">
            Join Our Affiliate Program
          </h2>
          <p className="text-ink-muted text-xs sm:text-sm">
            Earn commission on every sale you refer
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-white rounded-xl p-5 sm:p-6 md:p-8 border border-line shadow-sm">
          {/* Account info banner */}
          <div className="mb-5 p-3 bg-teal/5 border border-teal/20 rounded-lg flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-teal-dark flex-shrink-0 mt-0.5" />
            <div className="text-xs text-ink-muted">
              Joining as <span className="font-semibold text-ink">{customer!.first_name} {customer!.last_name}</span>
              {" "}·{" "}
              <span className="font-mono">{customer!.email}</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Referral code */}
            <ReferralCodeField
              value={codeChoice}
              onChange={setCodeChoice}
              onAvailabilityChange={setCodeAvailability}
              suggestion={suggestion}
              check={checkCode}
              label="Your referral code"
              disabled={isSubmitting}
            />

            {/* Wallet Address */}
            <div>
              <label className="block text-xs sm:text-sm font-medium text-ink mb-1 sm:mb-1.5">
                Wallet Address{" "}
                <span className="text-ink-muted font-normal">(Optional)</span>
              </label>
              <div className="relative">
                <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                <input
                  type="text"
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 sm:py-3 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-transparent text-sm text-ink placeholder-ink-muted font-mono"
                  placeholder="0x..."
                />
              </div>
              {errors.walletAddress && (
                <p className="mt-1 text-[10px] sm:text-xs text-red-600">{errors.walletAddress}</p>
              )}
              <p className="mt-1 text-[10px] sm:text-xs text-ink-muted">
                For crypto commission payouts. Can be added later in settings.
              </p>
            </div>

            {/* Agreement */}
            <div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-line accent-teal cursor-pointer flex-shrink-0"
                />
                <span className="text-xs sm:text-sm text-ink-muted leading-snug">
                  I agree to become an VYTA affiliate and abide by the{" "}
                  <Link
                    href="/terms"
                    className="text-teal-dark hover:text-teal-dark underline"
                    target="_blank"
                  >
                    affiliate program terms
                  </Link>
                  .
                </span>
              </label>
              {errors.agreedToTerms && (
                <p className="mt-1 text-[10px] sm:text-xs text-red-600">{errors.agreedToTerms}</p>
              )}
            </div>

            {errors.submit && (
              <div className="p-2.5 sm:p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                <span className="text-red-700 text-xs sm:text-sm">{errors.submit}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={
                isSubmitting || (codeChoice !== "" && codeAvailability.kind !== "free")
              }
              className="w-full bg-ink hover:bg-ink/90 text-white font-semibold py-2.5 sm:py-3 rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 text-sm"
            >
              {isSubmitting ? (
                <span>Joining...</span>
              ) : (
                <>
                  <span>Join Affiliate Program</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>

        <div className="mt-5 sm:mt-6 text-center">
          <p className="text-[10px] sm:text-xs text-ink-muted">
            Already an affiliate?{" "}
            <Link href="/affiliate/dashboard" className="text-teal-dark hover:text-teal-dark">
              Go to dashboard
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
