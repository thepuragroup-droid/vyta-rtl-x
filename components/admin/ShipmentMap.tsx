'use client';

import React, { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { Loader2, MapPin } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type LatLng = { lat: number; lng: number };

// Optional Mapbox tiles — set NEXT_PUBLIC_MAPBOX_TOKEN to upgrade from the
// keyless OpenStreetMap tiles. (Geocoding provider is chosen server-side.)
const MAPBOX = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const TILE_URL = MAPBOX
  ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=${MAPBOX}`
  : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = MAPBOX
  ? '© Mapbox © OpenStreetMap'
  : '© OpenStreetMap contributors';

const INK = '#07203A';
const BRONZE = '#438B9E';
const EMERALD = '#059669';

async function geocode(queries: string[]): Promise<Record<string, LatLng | null>> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/api/admin/geocode', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({ queries }),
  });
  if (!res.ok) throw new Error(`Geocode failed (${res.status})`);
  const json = await res.json();
  return json.results || {};
}

interface Props {
  /** Checkpoint place labels, oldest → newest. */
  checkpointLocations: string[];
  /** Destination place label (the parcel's endpoint). */
  destination: string | null;
}

/**
 * A geographic map of the shipment's journey: a marker per geocoded checkpoint
 * city joined by a line, the newest checkpoint highlighted, and the destination
 * pinned. Leaflet is imported lazily (client-only) so it never touches the SSR
 * pass. Coordinates come from the cached /api/admin/geocode route.
 */
export default function ShipmentMap({ checkpointLocations, destination }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');

  // Collapse consecutive duplicate cities so the path isn't a stack of dots.
  const orderedLocations = React.useMemo(() => {
    const out: string[] = [];
    for (const loc of checkpointLocations) {
      const v = (loc || '').trim();
      if (!v) continue;
      if (out.length && out[out.length - 1].toLowerCase() === v.toLowerCase()) continue;
      out.push(v);
    }
    return out;
  }, [checkpointLocations]);

  const key = `${orderedLocations.join('|')}::${destination ?? ''}`;

  useEffect(() => {
    let cancelled = false;
    let map: any = null;
    setStatus('loading');

    (async () => {
      try {
        const queries = Array.from(
          new Set([...orderedLocations, ...(destination ? [destination] : [])]),
        );
        if (queries.length === 0) {
          if (!cancelled) setStatus('empty');
          return;
        }

        const [L, coordsByQuery] = await Promise.all([import('leaflet'), geocode(queries)]);
        if (cancelled || !containerRef.current) return;

        const at = (q: string | null): LatLng | null =>
          (q && coordsByQuery[q]) || null;

        const checkpointPts = orderedLocations
          .map((loc) => ({ loc, pos: at(loc) }))
          .filter((p): p is { loc: string; pos: LatLng } => !!p.pos);
        const destPos = at(destination);

        if (checkpointPts.length === 0 && !destPos) {
          setStatus('empty');
          return;
        }

        map = L.map(containerRef.current, {
          scrollWheelZoom: false,
          attributionControl: true,
        });
        L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 18 }).addTo(map);

        const allLatLng: [number, number][] = [];

        // Solid path through the checkpoints in chronological order.
        const pathLatLng = checkpointPts.map((p) => [p.pos.lat, p.pos.lng] as [number, number]);
        if (pathLatLng.length > 1) {
          L.polyline(pathLatLng, { color: INK, weight: 2, opacity: 0.5 }).addTo(map);
        }

        checkpointPts.forEach((p, i) => {
          const isCurrent = i === checkpointPts.length - 1;
          L.circleMarker([p.pos.lat, p.pos.lng], {
            radius: isCurrent ? 7 : 5,
            color: isCurrent ? BRONZE : INK,
            fillColor: isCurrent ? BRONZE : INK,
            fillOpacity: isCurrent ? 1 : 0.55,
            weight: 2,
          })
            .addTo(map)
            .bindTooltip(`${isCurrent ? 'Current: ' : ''}${p.loc}`);
          allLatLng.push([p.pos.lat, p.pos.lng]);
        });

        // Dashed remaining leg + destination pin.
        if (destPos) {
          if (checkpointPts.length > 0) {
            const last = checkpointPts[checkpointPts.length - 1].pos;
            L.polyline(
              [
                [last.lat, last.lng],
                [destPos.lat, destPos.lng],
              ],
              { color: BRONZE, weight: 2, opacity: 0.7, dashArray: '5 6' },
            ).addTo(map);
          }
          L.circleMarker([destPos.lat, destPos.lng], {
            radius: 7,
            color: EMERALD,
            fillColor: '#ffffff',
            fillOpacity: 1,
            weight: 3,
          })
            .addTo(map)
            .bindTooltip(`Destination: ${destination}`);
          allLatLng.push([destPos.lat, destPos.lng]);
        }

        if (allLatLng.length === 1) {
          map.setView(allLatLng[0], 9);
        } else {
          map.fitBounds(L.latLngBounds(allLatLng).pad(0.25));
        }
        map.invalidateSize();
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      if (map) map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="relative rounded-lg overflow-hidden border border-line">
      <div ref={containerRef} className="h-72 w-full bg-surface" style={{ zIndex: 0 }} />
      {status !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface/80 text-sm text-ink-muted">
          {status === 'loading' && (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Mapping journey…
            </span>
          )}
          {status === 'empty' && (
            <span className="inline-flex items-center gap-2">
              <MapPin className="w-4 h-4" /> No locatable stops yet
            </span>
          )}
          {status === 'error' && (
            <span className="inline-flex items-center gap-2">
              <MapPin className="w-4 h-4" /> Map unavailable
            </span>
          )}
        </div>
      )}
    </div>
  );
}
