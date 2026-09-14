'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { DEFAULT_SITE_CONFIG, fetchSiteConfig, type SiteConfig } from '@/lib/site-config';

interface SiteConfigContextValue {
  config: SiteConfig;
  loading: boolean;
}

const SiteConfigContext = createContext<SiteConfigContextValue>({
  config: DEFAULT_SITE_CONFIG,
  loading: true,
});

/**
 * Provides the public branding/tracking config to the storefront. Starts from
 * DEFAULT_SITE_CONFIG so SSR and the first client render agree (no flash / no
 * hydration mismatch), then replaces it with the fetched values once.
 */
export function SiteConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<SiteConfig>(DEFAULT_SITE_CONFIG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchSiteConfig().then((cfg) => {
      if (!alive) return;
      setConfig(cfg);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <SiteConfigContext.Provider value={{ config, loading }}>
      {children}
    </SiteConfigContext.Provider>
  );
}

export function useSiteConfig(): SiteConfigContextValue {
  return useContext(SiteConfigContext);
}
