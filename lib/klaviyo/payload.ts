/**
 * Pure builders for Klaviyo JSON:API request bodies. No imports and no I/O,
 * so they can be unit-tested directly (see payload.test.ts).
 */

export interface KlaviyoProfileInput {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  /** Only sent when already E.164 — Klaviyo rejects the whole call otherwise. */
  phone_number?: string | null;
  /** Our customer id, so profiles can be matched back to accounts. */
  external_id?: string | null;
  location?: {
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    region?: string | null;
    zip?: string | null;
    country?: string | null;
  } | null;
  properties?: Record<string, unknown>;
}

const E164 = /^\+[1-9]\d{6,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && EMAIL.test(email.trim());
}

/** Best-effort E.164: keeps a valid +number, promotes a 10-digit NANP number. */
export function toE164(phone: unknown): string | null {
  if (typeof phone !== 'string') return null;
  const raw = phone.trim();
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, '');
  if (raw.startsWith('+') && E164.test(`+${digits}`)) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined || v === '') continue;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/** Profile attributes for the JSON:API body, with empties stripped. */
export function profileAttributes(p: KlaviyoProfileInput): Record<string, unknown> {
  return compact({
    email: p.email.trim().toLowerCase(),
    first_name: p.first_name?.trim() || null,
    last_name: p.last_name?.trim() || null,
    phone_number: toE164(p.phone_number),
    external_id: p.external_id || null,
    location: p.location ? compact(p.location) : null,
    properties: p.properties && Object.keys(p.properties).length > 0 ? p.properties : null,
  });
}

export interface KlaviyoEventInput {
  metric: string;
  profile: KlaviyoProfileInput;
  properties?: Record<string, unknown>;
  /** Monetary value — what Klaviyo attributes revenue from. */
  value?: number | null;
  currency?: string | null;
  /**
   * Dedupe key. Klaviyo drops a second event with the same metric, profile and
   * unique_id, so webhook retries and re-polls can't double-count.
   */
  uniqueId?: string | null;
  time?: string | Date | null;
}

export function eventBody(ev: KlaviyoEventInput) {
  const attributes: Record<string, unknown> = {
    properties: ev.properties ?? {},
    metric: { data: { type: 'metric', attributes: { name: ev.metric } } },
    profile: { data: { type: 'profile', attributes: profileAttributes(ev.profile) } },
  };
  if (typeof ev.value === 'number' && Number.isFinite(ev.value)) {
    attributes.value = Math.round(ev.value * 100) / 100;
    if (ev.currency) attributes.value_currency = ev.currency.toUpperCase();
  }
  if (ev.uniqueId) attributes.unique_id = ev.uniqueId;
  if (ev.time) attributes.time = new Date(ev.time).toISOString();
  return { data: { type: 'event', attributes } };
}
