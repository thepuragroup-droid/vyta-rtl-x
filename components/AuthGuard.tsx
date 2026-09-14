'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useCustomer } from '@/contexts/CustomerContext';
import PeptideLoader from '@/components/PeptideLoader';
import { siteConfig } from '@/lib/config';

// Pages anyone can visit without an account
const PUBLIC_PATHS = [
  '/',
  '/login',
  '/signup',
  '/terms',
  '/forgot-password',
  '/reset-password',
  '/products',
  '/contact',
  '/lab-results',
  '/cart',
  '/checkout',
  // Reached from the "we didn't have your shipping address" email. The token in
  // the URL is the credential — requiring a login here would strand guests.
  '/shipping-address',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { customer, isLoading } = useCustomer();
  const router = useRouter();
  const pathname = usePathname();

  // Auth disabled — let everyone through without any login gates
  if (!siteConfig.authEnabled) return <>{children}</>;

  const isPublic = isPublicPath(pathname);

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
