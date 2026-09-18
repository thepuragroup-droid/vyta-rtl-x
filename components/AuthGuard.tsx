'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useCustomer } from '@/contexts/CustomerContext';
import PeptideLoader from '@/components/PeptideLoader';
import { siteConfig } from '@/lib/config';

/**
 * The storefront is PUBLIC by default.
 *
 * This list is deliberately the inverse of what it used to be: an allowlist of
 * public paths meant every new marketing page (About Us, the article index, an
 * order-tracking link) silently arrived behind a login wall until someone
 * remembered to add it here — which is exactly what happened to /p/about.
 *
 * So: only the paths below ask for a customer account, and everything else —
 * catalog, product pages, editable pages, articles, cart, checkout, contact,
 * lab results, order tracking — is open to anyone, the way a shop should be.
 *
 * The staff portals (/admin, /warehouse) and the affiliate portal are NOT
 * listed: each runs its own, stricter check in its own layout, against roles
 * this customer-side guard knows nothing about. Adding them here would only
 * bounce a signed-out visitor to the wrong login screen.
 */
const PRIVATE_PREFIXES = [
  // The customer account area: dashboard, order history, a single order.
  '/account',
];

function isPrivatePath(pathname: string): boolean {
  return PRIVATE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { customer, isLoading } = useCustomer();
  const router = useRouter();
  const pathname = usePathname();

  // Auth disabled — let everyone through without any login gates
  if (!siteConfig.authEnabled) return <>{children}</>;

  const isPublic = !isPrivatePath(pathname);

  useEffect(() => {
    if (isPublic) return;
    if (isLoading) return;
    if (!customer) {
      router.replace('/login?redirect=' + encodeURIComponent(pathname));
    }
  }, [isPublic, isLoading, customer, pathname, router]);

  if (isPublic) return <>{children}</>;

  if (isLoading) return <PeptideLoader message="Loading..." />;

  if (!customer) return null;

  return <>{children}</>;
}
