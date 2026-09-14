'use client';

import React, { Suspense, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

// This page used to hard-code a "Payment Confirmed!" screen, which was
// misleading: Interac e-Transfer orders are created as `pending` and are not
// paid until the customer sends the transfer and an admin confirms it. It is no
// longer part of the checkout flow (checkout shows an inline confirmation), so
// any stale link/bookmark that lands here is forwarded to the real order
// tracker instead of asserting a payment that hasn't happened.
function OrderSuccessRedirect() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const order = searchParams.get('order');
  const email = searchParams.get('email');

  useEffect(() => {
    const params = new URLSearchParams();
    if (order) params.set('order', order);
    if (email) params.set('email', email);
    const qs = params.toString();
    router.replace(qs ? `/order/track?${qs}` : '/order/track');
  }, [order, email, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="flex items-center gap-3 text-ink">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Taking you to your order…</span>
      </div>
    </div>
  );
}

export default function OrderSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-white">
          <div className="text-ink text-sm">Loading…</div>
        </div>
      }
    >
      <OrderSuccessRedirect />
    </Suspense>
  );
}
