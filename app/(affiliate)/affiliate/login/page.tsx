'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAffiliate } from '@/contexts/AffiliateContext';
import { useCustomer } from '@/contexts/CustomerContext';

/**
 * The affiliate login page no longer exists as a standalone form — affiliate
 * identity is now tied to Supabase customer auth. This page acts as a smart
 * redirect based on the current session state.
 */
export default function AffiliateLogin() {
  const router = useRouter();
  const { customer, isLoading: customerLoading } = useCustomer();
  const { affiliate, isLoading: affiliateLoading } = useAffiliate();

  useEffect(() => {
    if (customerLoading || affiliateLoading) return;

    if (!customer) {
      // Not logged in — send to customer login, then come back to dashboard
      router.replace('/login?redirect=/affiliate/dashboard');
      return;
    }

    if (affiliate) {
      router.replace('/affiliate/dashboard');
    } else {
      router.replace('/affiliate/signup');
    }
  }, [customerLoading, affiliateLoading, customer, affiliate, router]);

  return (
    <main className="min-h-screen bg-white flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-bronze border-t-transparent rounded-full animate-spin" />
    </main>
  );
}
