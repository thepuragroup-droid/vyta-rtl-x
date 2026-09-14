/**
 * Address normalisation for the store report's location breakdown.
 *
 * Addresses reach us from three places that disagree about spelling: the
 * storefront checkout form (free text), the customer record, and the PuraMass
 * hosted checkout. Without normalising, "ON", "Ontario" and "ontario" become
 * three rows and the state view looks empty per row instead of ranked.
 *
 * Pure and dependency-free so both the API route and the admin UI can use it.
 */

/** Canadian provinces and territories, code → name. */
const CA_REGIONS: Record<string, string> = {
  AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador', NS: 'Nova Scotia', NT: 'Northwest Territories',
  NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec',
  SK: 'Saskatchewan', YT: 'Yukon',
};

/** US states, DC and the inhabited territories, code → name. */
const US_REGIONS: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin',
  WY: 'Wyoming', AS: 'American Samoa', GU: 'Guam', MP: 'Northern Mariana Islands',
  PR: 'Puerto Rico', VI: 'U.S. Virgin Islands',
};

const REGIONS_BY_COUNTRY: Record<string, Record<string, string>> = {
  CA: CA_REGIONS,
  US: US_REGIONS,
};

/** name (lower-cased) → code, per country. Built once. */
const CODE_BY_NAME: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(REGIONS_BY_COUNTRY).map(([country, table]) => [
    country,
    Object.fromEntries(Object.entries(table).map(([code, name]) => [name.toLowerCase(), code])),
  ]),
);

function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t ? t : null;
}

/** ISO-3166 alpha-2 when the value looks like one, otherwise the trimmed text. */
export function normalizeCountry(v: unknown): string | null {
  const t = clean(v);
  if (!t) return null;
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  // A handful of spellings we actually see typed into the checkout form.
  const named: Record<string, string> = {
    canada: 'CA', 'united states': 'US', 'united states of america': 'US',
    usa: 'US', 'u.s.a.': 'US', 'u.s.': 'US', america: 'US',
  };
  return named[t.toLowerCase()] ?? t;
}

export interface NormalizedRegion {
  /** Grouping key — the two-letter code where we know one, else the cleaned text. */
  code: string;
  /** Display name — the full province/state name where we know one. */
  name: string;
}

/**
 * Collapse a state/province to one key per real place. "ON", "on" and
 * "Ontario" all become { code: 'ON', name: 'Ontario' }; anything unrecognised
 * keeps its own text so a non-CA/US address is never silently merged.
 */
export function normalizeRegion(country: string | null, v: unknown): NormalizedRegion | null {
  const t = clean(v);
  if (!t) return null;
  const table = country ? REGIONS_BY_COUNTRY[country] : undefined;
  if (table) {
    const upper = t.toUpperCase();
    if (table[upper]) return { code: upper, name: table[upper] };
    const byName = CODE_BY_NAME[country!]?.[t.toLowerCase()];
    if (byName) return { code: byName, name: table[byName] };
  }
  return { code: t.toLowerCase(), name: titleCase(t) };
}

/** "toronto" / "TORONTO" / " Toronto " all become "Toronto". */
export function normalizeCity(v: unknown): NormalizedRegion | null {
  const t = clean(v);
  if (!t) return null;
  return { code: t.toLowerCase(), name: titleCase(t) };
}

/**
 * The postal *area*, not the full code: a Canadian forward sortation area
 * ("M1S 3L6" → "M1S") or a US ZIP3 ("90210-1234" → "902"). Coarse on purpose —
 * it is the level ad platforms target at, and a full postal code plus an order
 * value identifies a household.
 */
export function normalizePostalArea(country: string | null, v: unknown): NormalizedRegion | null {
  const t = clean(v);
  if (!t) return null;
  const compact = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!compact) return null;
  if (country === 'CA') {
    const fsa = compact.slice(0, 3);
    return /^[A-Z]\d[A-Z]$/.test(fsa) ? { code: fsa, name: fsa } : null;
  }
  if (country === 'US') {
    const zip3 = compact.slice(0, 3);
    return /^\d{3}$/.test(zip3) ? { code: zip3, name: `${zip3}xx` } : null;
  }
  const head = compact.slice(0, 4);
  return head ? { code: head, name: head } : null;
}

/** Title-case a place name, leaving short all-caps tokens (codes) alone. */
export function titleCase(s: string): string {
  return s
    .split(' ')
    .map((word) =>
      word.length <= 3 && word === word.toUpperCase()
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(' ');
}
