/**
 * Country / state reference data for shipping-address forms.
 *
 * Client-safe (pure data, no imports). Used by the customer-facing shipping
 * address page and by the server route that validates what it submits, so the
 * two can never disagree about what counts as a valid country or region code.
 *
 * The country list is the set PuraMass ships to in practice plus the usual
 * international destinations; `OTHER_COUNTRY` keeps the form usable for
 * anywhere not listed rather than blocking the customer.
 */

export interface Country {
  code: string;
  name: string;
}

/** ISO 3166-1 alpha-2. US/CA first — they are the bulk of orders. */
export const COUNTRIES: Country[] = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'IE', name: 'Ireland' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'PT', name: 'Portugal' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'BE', name: 'Belgium' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'AT', name: 'Austria' },
  { code: 'DK', name: 'Denmark' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'FI', name: 'Finland' },
  { code: 'IS', name: 'Iceland' },
  { code: 'PL', name: 'Poland' },
  { code: 'CZ', name: 'Czechia' },
  { code: 'SK', name: 'Slovakia' },
  { code: 'HU', name: 'Hungary' },
  { code: 'RO', name: 'Romania' },
  { code: 'BG', name: 'Bulgaria' },
  { code: 'GR', name: 'Greece' },
  { code: 'HR', name: 'Croatia' },
  { code: 'SI', name: 'Slovenia' },
  { code: 'EE', name: 'Estonia' },
  { code: 'LV', name: 'Latvia' },
  { code: 'LT', name: 'Lithuania' },
  { code: 'MX', name: 'Mexico' },
  { code: 'BR', name: 'Brazil' },
  { code: 'AR', name: 'Argentina' },
  { code: 'CL', name: 'Chile' },
  { code: 'CO', name: 'Colombia' },
  { code: 'PE', name: 'Peru' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'SG', name: 'Singapore' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'TH', name: 'Thailand' },
  { code: 'PH', name: 'Philippines' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'IN', name: 'India' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'IL', name: 'Israel' },
  { code: 'TR', name: 'Türkiye' },
  { code: 'ZA', name: 'South Africa' },
];

/**
 * Where the store actually ships: Canada, and nowhere else. The customer-facing
 * address forms offer only these, and the routes they post to reject anything
 * outside it. `COUNTRIES` above stays broad because it also names countries on
 * partner payloads and legacy orders.
 */
export const SHIPPING_COUNTRIES: Country[] = [{ code: 'CA', name: 'Canada' }];

export function isShippableCountry(code: string | null | undefined): boolean {
  const upper = (code ?? '').trim().toUpperCase();
  return SHIPPING_COUNTRIES.some((c) => c.code === upper);
}

/** Escape hatch so an unlisted destination can still submit an address. */
export const OTHER_COUNTRY: Country = { code: 'OTHER', name: 'Somewhere else' };

const COUNTRY_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export function countryName(code: string | null | undefined): string {
  if (!code) return '';
  const upper = code.trim().toUpperCase();
  return COUNTRY_BY_CODE.get(upper)?.name ?? upper;
}

export function isKnownCountry(code: string | null | undefined): boolean {
  if (!code) return false;
  return COUNTRY_BY_CODE.has(code.trim().toUpperCase());
}

const COUNTRY_BY_NAME = new Map(COUNTRIES.map((c) => [c.name.toLowerCase(), c]));
// Spellings that reach us from partner payloads and typed addresses but aren't
// the canonical name above.
const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'US',
  'u.s.': 'US',
  'u.s.a.': 'US',
  america: 'US',
  'united states of america': 'US',
  uk: 'GB',
  'great britain': 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
};

/**
 * ISO alpha-2 for whatever a caller has — a code already ('ca'), a country
 * name ('Canada'), or a common alias ('USA'). Falls back to `fallback` when
 * nothing matches, because Easyship rejects a shipment without a valid
 * `country_alpha2` and a wrong guess is worse than the origin default.
 */
export function countryAlpha2(
  value: string | null | undefined,
  fallback = 'CA',
): string {
  const raw = (value ?? '').trim();
  if (!raw) return fallback;
  const upper = raw.toUpperCase();
  if (upper.length === 2) return upper;
  const lower = raw.toLowerCase();
  return COUNTRY_BY_NAME.get(lower)?.code ?? COUNTRY_ALIASES[lower] ?? fallback;
}

export interface Region {
  code: string;
  name: string;
}

export const US_STATES: Region[] = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' }, { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' }, { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' }, { code: 'PR', name: 'Puerto Rico' },
  { code: 'RI', name: 'Rhode Island' }, { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' }, { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' }, { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' },
];

export const CA_PROVINCES: Region[] = [
  { code: 'AB', name: 'Alberta' },
  { code: 'BC', name: 'British Columbia' },
  { code: 'MB', name: 'Manitoba' },
  { code: 'NB', name: 'New Brunswick' },
  { code: 'NL', name: 'Newfoundland and Labrador' },
  { code: 'NS', name: 'Nova Scotia' },
  { code: 'NT', name: 'Northwest Territories' },
  { code: 'NU', name: 'Nunavut' },
  { code: 'ON', name: 'Ontario' },
  { code: 'PE', name: 'Prince Edward Island' },
  { code: 'QC', name: 'Quebec' },
  { code: 'SK', name: 'Saskatchewan' },
  { code: 'YT', name: 'Yukon' },
];

/**
 * The picker list for a country, or null when the form should fall back to a
 * free-text "State / Province / Region" input.
 */
export function regionsFor(country: string | null | undefined): Region[] | null {
  const code = (country ?? '').trim().toUpperCase();
  if (code === 'US') return US_STATES;
  if (code === 'CA') return CA_PROVINCES;
  return null;
}

/** What to call the region field, so the label matches the destination. */
export function regionLabel(country: string | null | undefined): string {
  const code = (country ?? '').trim().toUpperCase();
  if (code === 'US') return 'State';
  if (code === 'CA') return 'Province';
  return 'State / Province / Region';
}

/** What to call the postal-code field. */
export function postalLabel(country: string | null | undefined): string {
  const code = (country ?? '').trim().toUpperCase();
  if (code === 'US') return 'ZIP code';
  return 'Postal code';
}
