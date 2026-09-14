import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

const SLOW_AFTER_MS = 4000;

/**
 * Small data-loading hook for authenticated admin/affiliate data.
 *
 * Accepts either:
 *   - a URL string  -> GETs it with the Supabase bearer token attached, or
 *   - an async fetcher fn -> awaited as-is (caller does its own fetching).
 *
 * Tracks loading/error, flags `slow` once a load runs past ~4s, and exposes
 * `reload()` for manual refresh.
 */
export function useSmartLoad<T = unknown>(
  source: string | (() => Promise<T>),
  deps: React.DependencyList = [],
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sourceRef = useRef(source);
  sourceRef.current = source;

  const load = useCallback(async () => {
    setLoading(true);
    setSlow(false);
    setError(null);
    if (slowTimer.current) clearTimeout(slowTimer.current);
    slowTimer.current = setTimeout(() => setSlow(true), SLOW_AFTER_MS);

    try {
      const src = sourceRef.current;
      if (typeof src === 'string') {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(src, {
          headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {},
        });
        if (!res.ok) {
          let message = `Request failed: ${res.status}`;
          try { message = (await res.json()).error ?? message; } catch {}
          throw new Error(message);
        }
        setData((await res.json()) as T);
      } else {
        setData(await src());
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load');
    } finally {
      if (slowTimer.current) clearTimeout(slowTimer.current);
      setSlow(false);
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    load();
    return () => {
      if (slowTimer.current) clearTimeout(slowTimer.current);
    };
  }, [load]);

  return { data, loading, slow, error, reload: load };
}
