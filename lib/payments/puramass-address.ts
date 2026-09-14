/**
 * Client-safe display helpers for the shipping address PuraMass reports back on
 * an order (`puramass_orders.shipping_address`).
 *
 * Kept out of lib/payments/puramass.ts on purpose: that module is server-only
 * (it holds the API key and imports node:crypto), while these helpers render in
 * the admin UI. Everything here is tolerant of missing/partial data — an order
 * PuraMass has not reported an address for is the normal case, not an error.
 */

export interface ShippingAddressLike {
  address?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
}

const FIELDS: (keyof ShippingAddressLike)[] = [
  'address',
  'address2',
  'city',
  'state',
  'zip',
  'country',
];

function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

/**
 * Coerce whatever came back from the ledger into an address object, or null
 * when there is nothing usable. Accepts an object (the JSONB column) or a JSON
 * string, and treats an all-blank object as "no address".
 */
export function toShippingAddress(raw: unknown): ShippingAddressLike | null {
  let value: unknown = raw;
  if (typeof value === 'string') {
    const text = value;
    try {
      value = JSON.parse(text);
    } catch {
      // A bare string isn't structured, but it is still an address the partner
      // gave us — surface it as the street line rather than dropping it.
      const t = text.trim();
      return t ? { address: t } : null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const out: ShippingAddressLike = {};
  for (const f of FIELDS) out[f] = clean(r[f]);
  return FIELDS.some((f) => out[f]) ? out : null;
}

/**
 * Render an address as display lines, skipping anything missing:
 *   ["2375 Brimley Road", "Suite 827", "Scarborough, ON M1S 3L6", "CA"]
 */
export function formatAddressLines(addr: ShippingAddressLike | null): string[] {
  if (!addr) return [];
  const lines: string[] = [];
  if (clean(addr.address)) lines.push(addr.address!.trim());
  if (clean(addr.address2)) lines.push(addr.address2!.trim());

  const cityState = [clean(addr.city), clean(addr.state)].filter(Boolean).join(', ');
  const localLine = [cityState, clean(addr.zip)].filter(Boolean).join(' ');
  if (localLine) lines.push(localLine);

  if (clean(addr.country)) lines.push(addr.country!.trim().toUpperCase());
  return lines;
}

/** The same address on one line, for tooltips and clipboard copies. */
export function formatAddressOneLine(addr: ShippingAddressLike | null): string {
  return formatAddressLines(addr).join(', ');
}

// ---- Customer-submitted addresses ----------------------------------------
//
// When PuraMass reports no address, we email the customer a link to
// /shipping-address/<token> and they type one in. The form and the route that
// stores it share the validation below so the browser and the server can never
// disagree about what a complete address is.

/** Raw form values, before validation. */
export interface ShippingAddressInput {
  full_name?: string;
  phone?: string;
  address?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

export interface ValidatedShippingAddress {
  /** The address block, shaped exactly like what PuraMass reports. */
  address: Required<Pick<ShippingAddressLike, 'address' | 'city' | 'state' | 'zip' | 'country'>> &
    ShippingAddressLike;
  full_name: string;
  phone: string | null;
}

export type ShippingAddressErrors = Partial<Record<keyof ShippingAddressInput, string>>;

/** Longest value accepted per field — generous, but bounded. */
const MAX_LEN: Record<keyof ShippingAddressInput, number> = {
  full_name: 120,
  phone: 40,
  address: 200,
  address2: 200,
  city: 100,
  state: 80,
  zip: 20,
  country: 40,
};

function trimTo(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/**
 * Validate and normalise a submitted address.
 *
 * Deliberately forgiving about shape (a region is only required where we know
 * the country has one) and strict about the four things a courier actually
 * needs: street, city, postal code, country.
 */
export function validateShippingAddress(input: ShippingAddressInput): {
  ok: boolean;
  errors: ShippingAddressErrors;
  value: ValidatedShippingAddress;
} {
  const full_name = trimTo(input.full_name, MAX_LEN.full_name);
  const phone = trimTo(input.phone, MAX_LEN.phone);
  const address = trimTo(input.address, MAX_LEN.address);
  const address2 = trimTo(input.address2, MAX_LEN.address2);
  const city = trimTo(input.city, MAX_LEN.city);
  const state = trimTo(input.state, MAX_LEN.state);
  const zip = trimTo(input.zip, MAX_LEN.zip);
  const country = trimTo(input.country, MAX_LEN.country).toUpperCase();

  const errors: ShippingAddressErrors = {};
  if (!full_name) errors.full_name = 'Please tell us who the parcel is addressed to.';
  if (!address) errors.address = 'Please enter a street address.';
  if (!city) errors.city = 'Please enter a city.';
  if (!zip) errors.zip = 'Please enter a postal or ZIP code.';
  if (!country) errors.country = 'Please choose a country.';
  // US and Canada always have one, and a courier label is rejected without it.
  if (!state && (country === 'US' || country === 'CA')) {
    errors.state = country === 'US' ? 'Please choose a state.' : 'Please choose a province.';
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: {
      address: {
        address,
        address2: address2 || null,
        city,
        state,
        zip,
        country,
      },
      full_name,
      phone: phone || null,
    },
  };
}
