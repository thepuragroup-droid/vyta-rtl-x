'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { siteConfig } from '@/lib/config';

const Web3ProviderInner = siteConfig.cryptoPaymentsEnabled
  ? dynamic(() => import('./Web3ProviderInner'), { ssr: false })
  : null;

export function Web3Provider({ children }: { children: React.ReactNode }) {
  if (!Web3ProviderInner) return <>{children}</>;
  return <Web3ProviderInner>{children}</Web3ProviderInner>;
}
