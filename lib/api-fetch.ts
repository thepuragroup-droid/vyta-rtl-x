import { supabase } from '@/lib/supabase';

/**
 * Bodies the browser must type itself. FormData in particular needs to append
 * its own `multipart/form-data; boundary=...` — forcing a Content-Type here
 * drops the boundary and the server's `request.formData()` throws.
 */
function browserSetsContentType(body: BodyInit | null | undefined): boolean {
  if (typeof FormData !== 'undefined' && body instanceof FormData) return true;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return true;
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return true;
  return false;
}

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

  const defaultContentType = browserSetsContentType(init.body)
    ? {}
    : { 'Content-Type': 'application/json' };

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { ...defaultContentType, ...authHeader, ...init.headers },
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
