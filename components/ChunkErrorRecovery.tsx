'use client';

import { useEffect } from 'react';

export default function ChunkErrorRecovery() {
  useEffect(() => {
    const handler = (e: ErrorEvent) => {
      if (
        e.message?.includes('ChunkLoadError') ||
        e.message?.includes('Failed to fetch dynamically imported module')
      ) {
        console.warn('[ChunkErrorRecovery] Stale chunk detected, reloading...');
        window.location.reload();
      }
    };
    window.addEventListener('error', handler);
    return () => window.removeEventListener('error', handler);
  }, []);

  return null;
}
