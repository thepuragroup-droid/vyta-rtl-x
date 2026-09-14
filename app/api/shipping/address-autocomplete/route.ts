import { NextRequest, NextResponse } from 'next/server';

// GET /api/shipping/address-autocomplete?q=<query>
// Public storefront route. Proxies Photon (https://photon.komoot.io/) and
// returns Canada-only address suggestions in a normalized shape the
// checkout's AddressAutocomplete component can consume directly.
//
// Photon docs: https://photon.komoot.io/
//   - We restrict to Canada with a bounding box (`bbox`, a hard spatial
//     filter) plus a server-side `countrycode === 'CA'` check below. Do NOT
//     use `osm_tag=country:ca` for this — `osm_tag` filters features by their
//     OSM key:value tags (e.g. `place:city`), and street/house results carry
//     no `country=ca` tag, so that filter silently drops every result and the
//     autocomplete dropdown stays empty.
//   - The UI degrades gracefully to a plain text input when this endpoint is
//     unreachable.

const PHOTON_URL = 'https://photon.komoot.io/api/';

// Canada bounding box (minLon,minLat,maxLon,maxLat). Restricts Photon results
// to roughly Canadian territory; the rectangle also clips a sliver of the
// northern US, which the countrycode post-filter below removes.
const CANADA_BBOX = '-141.0,41.6,-52.6,83.2';

// Bias results toward the geographic centre of Canada so Canadian matches
// surface first within the bbox.
const CANADA_CENTER = { lat: '56.13', lon: '-106.35' };

const PROVINCE_TO_CODE: Record<string, string> = {
  alberta: 'AB',
  'british columbia': 'BC',
  manitoba: 'MB',
  'new brunswick': 'NB',
  'newfoundland and labrador': 'NL',
  'nova scotia': 'NS',
  'northwest territories': 'NT',
  nunavut: 'NU',
  ontario: 'ON',
  'prince edward island': 'PE',
  quebec: 'QC',
  saskatchewan: 'SK',
  yukon: 'YT',
};

function provinceCode(state?: string | null): string {
  if (!state) return '';
  const norm = String(state).trim().toLowerCase();
  if (norm.length === 2) return norm.toUpperCase();
  return PROVINCE_TO_CODE[norm] ?? state;
}

interface Suggestion {
  label: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q || q.length < 3) {
    return NextResponse.json({ suggestions: [] });
  }

  const params = new URLSearchParams({
    q,
    limit: '8',
    lang: 'en',
    // Hard spatial restriction to Canada + a bias toward its centre so the
    // most relevant Canadian results rank first.
    bbox: CANADA_BBOX,
    lat: CANADA_CENTER.lat,
    lon: CANADA_CENTER.lon,
    location_bias_scale: '0.2',
  });

  try {
    const res = await fetch(`${PHOTON_URL}?${params.toString()}`, {
      cache: 'no-store',
      // Photon/komoot's public instance is friendlier to requests that
      // identify themselves; a bare fetch UA can be throttled.
      headers: {
        'User-Agent': 'aminocan-cad/1.0 (+checkout address autocomplete)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      return NextResponse.json({ suggestions: [] });
    }
    const data = await res.json();
    const features = (data?.features ?? []) as any[];
    const suggestions: Suggestion[] = features
      .map((f) => {
        const p = f?.properties ?? {};
        // Only keep Canadian results.
        const countryCode = String(p.countrycode || '').toUpperCase();
        if (countryCode && countryCode !== 'CA') return null;
        if (!countryCode && String(p.country || '').toLowerCase() !== 'canada') {
          return null;
        }
        const houseStreet = [p.housenumber, p.street].filter(Boolean).join(' ');
        const address = houseStreet || p.name || '';
        const city = p.city || p.town || p.village || p.locality || '';
        const state = provinceCode(p.state);
        const postalCode = p.postcode || '';
        if (!address) return null;
        const labelParts = [
          [houseStreet, p.name && !houseStreet ? p.name : undefined]
            .filter(Boolean)
            .join(' '),
          city,
          state,
          postalCode,
        ].filter(Boolean);
        const label = labelParts.join(', ');
        return { label, address, city, state, postalCode, country: 'CA' };
      })
      .filter((s): s is Suggestion => !!s);

    return NextResponse.json({ suggestions });
  } catch (e: any) {
    return NextResponse.json(
      { suggestions: [], note: e?.message ?? 'photon unreachable' },
      { status: 200 },
    );
  }
}
