'use client';

/**
 * Storefront promotions, resolved once for the whole app.
 *
 * Two offers run on the storefront and both need the same two facts — the
 * admin's promo settings, and who this visitor is:
 *
 *   • free shipping past a spend threshold (`FreeShippingToast`, the cart and
 *     checkout progress bars);
 *   • the paid-ads welcome discount (`AdDiscountBanner`, the cart and checkout
 *     totals, and the hand-off itself) — for ad visitors, on their first order
 *     only.
 *
 * Resolving them here rather than in each component means one settings fetch
 * per app load instead of one per screen, and one definition of "eligible" that
 * the nav strip, the cart and the checkout cannot drift apart on.
 *
 * NONE of this is trusted for money. `/api/checkout/puramass` re-reads the
 * settings, re-reads the attribution cookies and re-prices the cart from the
 * catalog before it discounts anything — what happens here only decides what
 * the buyer is told.
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useCustomer } from '@/contexts/CustomerContext';
import { supabase } from '@/lib/supabase';
import { visitorChannels } from '@/lib/analytics/attribution-client';
import {
  adDiscountAmount,
  DEFAULT_AD_DISCOUNT,
  isAdTraffic,
  qualifiesForAdDiscount,
  type AdDiscountSettings,
} from '@/lib/promos/ad-discount';

export interface FreeShippingPromo {
  /** The promo is on AND the checkout that honours it is the live one. */
  active: boolean;
  /** Goods subtotal in CAD that unlocks it. */
  threshold: number;
}

export interface PromosValue {
  /** False once the settings fetch has settled, either way. */
  loading: boolean;
  freeShipping: FreeShippingPromo;
  adDiscount: AdDiscountSettings & { active: boolean };
  /** This visitor arrived on a paid ad (first or last touch). */
  isAdVisitor: boolean;
  /**
   * This customer has not ordered yet, so the welcome discount is still theirs
   * to use. False for guests, and while the check is still in flight.
   */
  isFirstOrder: boolean;
  /** The ad discount applies to this visitor's order, here and now. */
  adDiscountEligible: boolean;
  /** What that takes off a given subtotal, in CAD. Zero when not eligible. */
  adDiscountOn: (subtotal: number) => number;
}

const EMPTY: PromosValue = {
  loading: true,
  freeShipping: { active: false, threshold: 0 },
  adDiscount: { ...DEFAULT_AD_DISCOUNT, active: false },
  isAdVisitor: false,
  isFirstOrder: false,
  adDiscountEligible: false,
  adDiscountOn: () => 0,
};

const PromosContext = createContext<PromosValue>(EMPTY);

export function PromosProvider({ children }: { children: React.ReactNode }) {
  const { customer } = useCustomer();
  const [loading, setLoading] = useState(true);
  const [freeShipping, setFreeShipping] = useState<FreeShippingPromo>(EMPTY.freeShipping);
  const [adDiscount, setAdDiscount] = useState(EMPTY.adDiscount);
  // Read in an effect, never during render: the cookies do not exist on the
  // server, so deriving this inline would hydrate to a different tree.
  const [channels, setChannels] = useState<(string | null)[]>([]);
  // Whether this customer still has their welcome discount. It cannot be read
  // off the customer row: `has_completed_first_order` is only written by the
  // legacy checkout, so the server joins it with their hosted orders for us.
  const [isFirstOrder, setIsFirstOrder] = useState(false);

  useEffect(() => {
    setChannels(visitorChannels());
  }, []);

  // Re-asked whenever the signed-in customer changes — on sign-out the answer
  // must fall back to false rather than linger from the previous account. Keyed
  // on the id rather than the object so a re-fetch that returns the same
  // customer does not re-run this.
  const customerId = customer?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    if (!customerId) {
      setIsFirstOrder(false);
      return;
    }
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;
        const res = await fetch('/api/promos/first-order', {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled) setIsFirstOrder(!!json?.firstOrder);
      } catch {
        /* Unknown means "not a first order": never advertise an offer the
           checkout would then refuse to honour. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // `no-store`: these decide what the buyer is offered, and a promo that
        // has just been switched off must not keep being advertised from cache.
        const res = await fetch('/api/admin/settings', { cache: 'no-store' });
        if (!res.ok) return;
        const s = (await res.json())?.settings ?? {};
        if (cancelled) return;
        setFreeShipping({
          active: !!s.puramass_free_shipping_active,
          threshold: Number(s.puramass_free_shipping_threshold) || 0,
        });
        setAdDiscount({
          enabled: !!s.ad_discount_enabled,
          percent: Number(s.ad_discount_percent) || 0,
          active: !!s.ad_discount_active,
        });
      } catch {
        /* No promo is shown if the settings can't be read — never block a page. */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<PromosValue>(() => {
    const settings: AdDiscountSettings = {
      enabled: adDiscount.active,
      percent: adDiscount.percent,
    };
    const eligible = qualifiesForAdDiscount(settings, {
      signedIn: !!customer,
      firstOrder: isFirstOrder,
      channels,
    });
    return {
      loading,
      freeShipping,
      adDiscount,
      isAdVisitor: isAdTraffic(channels),
      isFirstOrder,
      adDiscountEligible: eligible,
      adDiscountOn: (subtotal: number) =>
        eligible ? adDiscountAmount(subtotal, adDiscount.percent) : 0,
    };
  }, [loading, freeShipping, adDiscount, channels, customer, isFirstOrder]);

  return <PromosContext.Provider value={value}>{children}</PromosContext.Provider>;
}

export function usePromos(): PromosValue {
  return useContext(PromosContext);
}
