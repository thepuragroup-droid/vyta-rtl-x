import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getInvoiceCaller } from '@/lib/admin/invoice-access';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type LatLng = { lat: number; lng: number };

// Process-lifetime cache. Geocoding the same city repeatedly is wasteful and,
// on the keyless Nominatim path, would blow the usage policy. Survives across
// requests on a warm serverless instance.
const cache = new Map<string, LatLng | null>();

const MAPBOX_TOKEN =
  process.env.MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

function norm(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function geocodeMapbox(q: string): Promise<LatLng | null> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
    q,
  )}.json?limit=1&access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  const center = json.features?.[0]?.center;
  return Array.isArray(center) && center.length >= 2
    ? { lat: Number(center[1]), lng: Number(center[0]) }
    : null;
}

async function geocodeNominatim(q: string): Promise<LatLng | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    q,
  )}&format=json&limit=1`;
  const res = await fetch(url, {
    // Nominatim's usage policy requires an identifying User-Agent.
    headers: { 'User-Agent': 'Aminocan-Admin/1.0 (shipment tracking map)' },
  });
  if (!res.ok) return null;
  const json = await res.json();
  const hit = Array.isArray(json) ? json[0] : null;
  return hit?.lat && hit?.lon
    ? { lat: Number(hit.lat), lng: Number(hit.lon) }
    : null;
}

async function geocodeOne(q: string): Promise<LatLng | null> {
  const key = norm(q);
  if (cache.has(key)) return cache.get(key) ?? null;
  let value: LatLng | null = null;
  try {
    value = MAPBOX_TOKEN ? await geocodeMapbox(q) : await geocodeNominatim(q);
  } catch {
    value = null;
  }
  cache.set(key, value);
  return value;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST /api/admin/geocode  { queries: string[] }
 *
 * Resolves place labels (e.g. "Toronto, ON, CA") to coordinates for the
 * shipment map. Uses Mapbox when MAPBOX_TOKEN is set (fast, parallel-safe),
 * otherwise falls back to keyless Nominatim (sequential, rate-limit friendly).
 * Results are cached process-wide and returned keyed by the original query.
 */
export async function POST(req: NextRequest) {
  const caller = await getInvoiceCaller(db, req);
  if (!caller.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let body: { queries?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const raw = Array.isArray(body.queries) ? body.queries : [];
  // Dedupe (case-insensitively) and cap so a runaway list can't fan out.
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const q of raw) {
    if (typeof q !== 'string' || !q.trim()) continue;
    const key = norm(q);
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push(q);
    if (queries.length >= 12) break;
  }

  const results: Record<string, LatLng | null> = {};

  if (MAPBOX_TOKEN) {
    await Promise.all(
      queries.map(async (q) => {
        results[q] = await geocodeOne(q);
      }),
    );
  } else {
    // Keyless path: honor Nominatim's ~1 request/second policy for anything not
    // already cached.
    for (const q of queries) {
      const cached = cache.has(norm(q));
      results[q] = await geocodeOne(q);
      if (!cached) await sleep(1100);
    }
  }

  return NextResponse.json({ results });
}
