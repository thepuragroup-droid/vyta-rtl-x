import { supabase } from '@/lib/supabase';

export async function apiFetch<T = unknown>(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const { timeoutMs = 10_000, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Attach the Supabase access token. The session lives in the browser
  // (localStorage), so API routes can't read it from cookies — they expect a
  // Bearer token. Best-effort: anonymous requests just omit it.
  let authHeader: Record<string, string> = {};
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      authHeader = { Authorization: `Bearer ${session.access_token}` };
    }
  } catch {
    /* not in a browser / no session — send unauthenticated */
  }

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...authHeader, ...init.headers },
    });
    if (!res.ok) {
      let message = `Request failed: ${res.status}`;
      try { message = (await res.json()).error ?? message; } catch {}
      throw new Error(message);
    }
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}
