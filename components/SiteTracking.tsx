'use client';

import React, { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useSiteConfig } from '@/contexts/SiteConfigContext';
import { setAnalyticsMode } from '@/lib/analytics/ecommerce';
import {
  CONSENT_KEY,
  updateConsent,
  writeConsentCookie,
  readConsentCookie,
} from '@/lib/analytics/consent';

type Consent = 'unknown' | 'granted' | 'denied';

// Loose globals injected by gtm.js / gtag.js / the Meta Pixel snippet.
declare global {
  interface Window {
    dataLayer?: any[];
    gtag?: (...args: any[]) => void;
    fbq?: (...args: any[]) => void;
  }
}

/**
 * Injects Google Tag Manager (or GA4 directly) + the Meta Pixel behind a GDPR
 * consent banner.
 *
 * - Renders nothing when no tracking ID is configured.
 * - The Meta Pixel does not mount until the visitor accepts, since it has no
 *   consent signal of its own. GA4 and GTM load regardless and are gated by
 *   Consent Mode instead — see below.
 * - On client-side route changes, fires a page_view and a Pixel PageView.
 *
 * Neither GA4 nor the GTM container is loaded here — app/layout.tsx renders
 * both server-side in <head>, unconditionally, so each is detected as installed
 * by Tag Assistant on its own. This component owns what happens after that:
 * relaying the banner decision to Consent Mode, publishing SPA route changes,
 * and loading the Meta Pixel, which has no consent signal of its own and so
 * stays behind the banner.
 *
 * GA4 runs directly via gtag, NOT as a tag inside GTM — the container is left
 * for Ads/remarketing tags. Adding a GA4 configuration tag to the container as
 * well would double every hit.
 */
export default function SiteTracking() {
  const { config } = useSiteConfig();
  const {
    gtm_container_id: gtm,
    ga4_measurement_id: ga4,
    meta_pixel_id: pixel,
    tracking_consent_required: consentRequired,
  } = config;

  const [consent, setConsent] = useState<Consent>('unknown');
  const [hydrated, setHydrated] = useState(false);
  const pathname = usePathname();
  const lastPath = useRef<string | null>(null);

  // Read any stored decision once, client-side, to avoid an SSR mismatch.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CONSENT_KEY);
      if (stored === 'granted' || stored === 'denied') {
        setConsent(stored);
        // Backfill the server-readable mirror. Visitors who accepted before
        // the cookie existed, and anyone whose cookie has since expired, would
        // otherwise look like they never answered the banner.
        if (readConsentCookie() !== stored) writeConsentCookie(stored);
      }
    } catch {
      /* localStorage unavailable — treat as unknown */
    }
    setHydrated(true);
  }, []);

  const hasTracking = !!(gtm || ga4 || pixel);
  const shouldLoad = hydrated && hasTracking && (!consentRequired || consent === 'granted');
  const showBanner = hydrated && hasTracking && consentRequired && consent === 'unknown';
  // Both load independently in <head>; neither excludes the other.
  const useGtm = !!gtm;
  const useGtag = !!ga4;

  // Tell the e-commerce helpers where to send events. Anything they buffered
  // while this was still 'pending' flushes here — or is dropped, if the
  // visitor declined or nothing is configured.
  useEffect(() => {
    if (!hydrated) return;
    // Not gated on consent: gtag and the container both read the Consent Mode
    // signals themselves. Holding events back would also strip GA4 of the
    // cookieless pings Consent Mode is designed to keep collecting while
    // consent is denied.
    if (useGtm && useGtag) setAnalyticsMode('both');
    else if (useGtm) setAnalyticsMode('gtm');
    else if (useGtag) setAnalyticsMode('gtag');
    else setAnalyticsMode('off');
  }, [hydrated, useGtm, useGtag]);

  // Fire page-view events on SPA navigation (the initial pageview is emitted by
  // each snippet's own init, so skip the first run). Keyed off the path rather
  // than the effect firing, so granting consent mid-visit doesn't manufacture a
  // page_view for a page the visitor is already on.
  useEffect(() => {
    if (lastPath.current === null || lastPath.current === pathname) {
      lastPath.current = pathname;
      return;
    }
    lastPath.current = pathname;
    if (useGtm && Array.isArray(window.dataLayer)) {
      // GTM's built-in Page View trigger only fires on the initial container
      // load, so route changes are published as a custom event. Pair it with a
      // "Custom Event: page_view" trigger on the GA4 tag in the GTM UI.
      window.dataLayer.push({
        event: 'page_view',
        page_path: pathname,
        page_location: window.location.href,
        page_title: document.title,
      });
    }
    if (useGtag && typeof window.gtag === 'function') {
      window.gtag('event', 'page_view', {
        page_path: pathname,
        page_location: window.location.href,
        page_title: document.title,
      });
    }
    if (shouldLoad && pixel && typeof window.fbq === 'function') {
      window.fbq('track', 'PageView');
    }
  }, [pathname, shouldLoad, useGtm, useGtag, ga4, pixel]);

  const record = (decision: 'granted' | 'denied') => {
    try {
      window.localStorage.setItem(CONSENT_KEY, decision);
    } catch {
      /* ignore persistence failures */
    }
    // Mirror the decision into a cookie so the server can read it too. Our own
    // activity API gates anonymous visitors on this: localStorage never leaves
    // the browser, and the tracking call has to know whether it may store the
    // visit before it writes the row.
    writeConsentCookie(decision);
    setConsent(decision);
    updateConsent(decision === 'granted');
  };

  const accept = () => record('granted');
  const decline = () => record('denied');

  if (!hasTracking) return null;

  return (
    <>
      {shouldLoad && pixel && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${pixel}');
            fbq('track', 'PageView');
          `}
        </Script>
      )}

      {showBanner && (
        <div className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-4">
          <div className="mx-auto max-w-3xl rounded-xl border border-line bg-white shadow-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <p className="text-sm text-ink-muted flex-1">
              We use cookies for analytics to understand how the site is used. You can accept
              or decline non-essential tracking.
            </p>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={decline}
                className="px-4 py-2 rounded-lg bg-surface border border-line text-ink text-sm font-medium hover:bg-line/40 transition-colors"
              >
                Decline
              </button>
              <button
                onClick={accept}
                className="px-4 py-2 rounded-lg bg-ink text-white text-sm font-semibold hover:bg-ink/90 transition-colors"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
