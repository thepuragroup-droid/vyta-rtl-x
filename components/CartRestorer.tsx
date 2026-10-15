'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useCart } from '@/contexts/CartContext';
import { useToast } from '@/contexts/ToastContext';

/**
 * Handles the "Return to cart" / "Complete my order" links in the cart
 * abandonment emails: /cart?restore=<token>[&next=checkout][&discount=CODE].
 *
 * Puts the saved cart back (merged into whatever this browser already has, at
 * today's prices and stock), cleans the URL, and — for "Complete my order" —
 * goes on to checkout with the email's code, which the checkout page applies
 * from `?discount=`.
 *
 * Reads window.location rather than useSearchParams so the cart page needs no
 * Suspense boundary.
 */
export default function CartRestorer() {
  const { restoreCart } = useCart();
  const toast = useToast();
  const router = useRouter();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('restore');
    if (!token) return;
    done.current = true;
    const next = params.get('next');
    const discount = (params.get('discount') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

    (async () => {
      try {
        const res = await fetch(`/api/cart/restore?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error('That cart link has expired — your saved items could not be found.');
        } else {
          if (Array.isArray(data.lines) && data.lines.length) restoreCart(data.lines);
          if (data.dropped > 0) {
            toast.info(`${data.dropped} item${data.dropped === 1 ? ' is' : 's are'} no longer available and ${data.dropped === 1 ? 'was' : 'were'} left out.`);
          }
        }
      } catch {
        toast.error('We could not restore your cart. Please try the link again.');
      }

      // Keep the UTM tags for analytics; drop the restore bits.
      ['restore', 'next', 'discount'].forEach((k) => params.delete(k));
      const rest = params.toString();
      if (next === 'checkout') {
        router.replace(`/checkout${discount ? `?discount=${discount}` : ''}`);
      } else {
        router.replace(`/cart${rest ? `?${rest}` : ''}`);
      }
    })();
  }, [restoreCart, router, toast]);

  return null;
}
