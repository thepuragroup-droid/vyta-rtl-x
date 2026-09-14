'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { Affiliate } from '@/lib/supabase';
import { getAffiliateByEmail } from '@/lib/affiliate/api';

interface AffiliateContextType {
  affiliate: Affiliate | null;
  isLoading: boolean;
  updateAffiliateData: (affiliate: Affiliate) => void;
}

const AffiliateContext = createContext<AffiliateContextType | undefined>(undefined);

export function AffiliateProvider({ children }: { children: React.ReactNode }) {
  const [affiliate, setAffiliate] = useState<Affiliate | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadAffiliate = async () => {
    console.log('[Auth] loadAffiliate: start');
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 8000)
      );
      const { data: { session } } = await Promise.race([supabase.auth.getSession(), timeout]);
      console.log('[Auth] loadAffiliate: session', session ? 'exists' : 'null');

      if (session?.user?.email) {
        const aff = await getAffiliateByEmail(session.user.email);
        setAffiliate(aff);
        console.log('[Auth] loadAffiliate: affiliate', aff ? aff.id : 'null');
      } else {
        setAffiliate(null);
      }
    } catch (e) {
      console.error('[Auth] loadAffiliate: error', e);
      setAffiliate(null);
    } finally {
      setIsLoading(false);
      console.log('[Auth] loadAffiliate: done');
    }
  };

  useEffect(() => {
    loadAffiliate();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[Auth] AffiliateContext onAuthStateChange:', event);

      if (event === 'SIGNED_IN' && session?.user?.email) {
        setTimeout(() => {
          loadAffiliate();
        }, 0);
      }

      if (event === 'SIGNED_OUT') {
        setAffiliate(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const updateAffiliateData = (affiliateData: Affiliate) => {
    setAffiliate(affiliateData);
  };

  return (
    <AffiliateContext.Provider value={{ affiliate, isLoading, updateAffiliateData }}>
      {children}
    </AffiliateContext.Provider>
  );
}

export function useAffiliate() {
  const context = useContext(AffiliateContext);
  if (context === undefined) {
    throw new Error('useAffiliate must be used within AffiliateProvider');
  }
  return context;
}
