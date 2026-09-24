/**
 * Minimal Klaviyo REST client (server only).
 *
 * Talks to the JSON:API endpoints under https://a.klaviyo.com/api with the
 * private key. Only the handful of calls the integration needs are wrapped:
 * events, profile upsert, list subscription, and the account/list reads the
 * admin "Test connection" button uses.
 *
 * The private key is a secret — nothing in here may be imported by client code.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { shapeKlaviyoSettings, type KlaviyoSettings } from './settings';
import {
  eventBody,
  isValidEmail,
  profileAttributes,
  type KlaviyoEventInput,
  type KlaviyoProfileInput,
} from './payload';

export { eventBody, isValidEmail, profileAttributes, toE164 } from './payload';
export type { KlaviyoEventInput, KlaviyoProfileInput } from './payload';

export const KLAVIYO_API_BASE = 'https://a.klaviyo.com/api';
/**
 * Pinned API revision. Klaviyo keeps each revision for two years after the
 * next one ships; bump this (and re-test) when it nears retirement.
 */
export const KLAVIYO_REVISION = '2025-07-15';

const DEFAULT_TIMEOUT_MS = 8000;

export class KlaviyoApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(`Klaviyo ${status}: ${detail}`);
    this.name = 'KlaviyoApiError';
  }
}

/** Read the singleton row and shape it. Never throws — a failed read means "off". */
export async function readKlaviyoSettings(db: SupabaseClient): Promise<KlaviyoSettings> {
  try {
    const { data } = await db.from('site_settings').select('*').limit(1).maybeSingle();
    return shapeKlaviyoSettings(data);
  } catch {
    return shapeKlaviyoSettings(null);
  }
}

export async function klaviyoFetch<T = any>(
  privateKey: string,
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = {},
): Promise<T | null> {
  const res = await fetch(`${KLAVIYO_API_BASE}${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers: {
      Authorization: `Klaviyo-API-Key ${privateKey}`,
      revision: KLAVIYO_REVISION,
      accept: 'application/vnd.api+json',
      ...(init.body !== undefined ? { 'content-type': 'application/vnd.api+json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    cache: 'no-store',
  });

  const text = await res.text();
  let json: any = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON body */
    }
  }
  if (!res.ok) {
    const first = Array.isArray(json?.errors) ? json.errors[0] : null;
    const detail = first?.detail || first?.title || text.slice(0, 200) || res.statusText;
    throw new KlaviyoApiError(res.status, String(detail));
  }
  return json as T | null;
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/** Create or update a profile, keyed on email. */
export async function upsertKlaviyoProfile(
  privateKey: string,
  profile: KlaviyoProfileInput,
): Promise<string | null> {
  const json = await klaviyoFetch<any>(privateKey, '/profile-import', {
    body: { data: { type: 'profile', attributes: profileAttributes(profile) } },
  });
  return json?.data?.id ?? null;
}

/**
 * Subscribe profiles to a list with EMAIL MARKETING consent.
 *
 * Only call this for people who actually opted in — Klaviyo records it as
 * explicit consent. Up to 1000 profiles per call (Klaviyo's job limit).
 */
export async function subscribeToKlaviyoList(
  privateKey: string,
  listId: string,
  profiles: KlaviyoProfileInput[],
  source = 'VYTA storefront',
): Promise<void> {
  const valid = profiles.filter((p) => isValidEmail(p.email));
  if (valid.length === 0) return;
  await klaviyoFetch(privateKey, '/profile-subscription-bulk-create-jobs', {
    body: {
      data: {
        type: 'profile-subscription-bulk-create-job',
        attributes: {
          custom_source: source,
          profiles: {
            data: valid.map((p) => ({
              type: 'profile',
              attributes: {
                email: p.email.trim().toLowerCase(),
                subscriptions: { email: { marketing: { consent: 'SUBSCRIBED' } } },
              },
            })),
          },
        },
        relationships: { list: { data: { type: 'list', id: listId } } },
      },
    },
    timeoutMs: 15000,
  });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export async function createKlaviyoEvent(privateKey: string, ev: KlaviyoEventInput): Promise<void> {
  await klaviyoFetch(privateKey, '/events', { body: eventBody(ev) });
}

// ---------------------------------------------------------------------------
// Account / lists — used by the admin "Test connection" button
// ---------------------------------------------------------------------------

export interface KlaviyoAccountInfo {
  id: string;
  organization_name: string | null;
  public_api_key: string | null;
  default_sender_email: string | null;
  timezone: string | null;
  preferred_currency: string | null;
}

export async function getKlaviyoAccount(privateKey: string): Promise<KlaviyoAccountInfo | null> {
  const json = await klaviyoFetch<any>(privateKey, '/accounts');
  const a = Array.isArray(json?.data) ? json.data[0] : null;
  if (!a) return null;
  const attrs = a.attributes ?? {};
  return {
    id: String(a.id),
    organization_name: attrs.contact_information?.organization_name ?? null,
    public_api_key: attrs.public_api_key ?? null,
    default_sender_email: attrs.contact_information?.default_sender_email ?? null,
    timezone: attrs.timezone ?? null,
    preferred_currency: attrs.preferred_currency ?? null,
  };
}

export async function listKlaviyoLists(
  privateKey: string,
  maxPages = 5,
): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  let path: string | null = '/lists?fields[list]=name';
  for (let page = 0; path && page < maxPages; page++) {
    const json: any = await klaviyoFetch<any>(privateKey, path);
    for (const l of json?.data ?? []) {
      out.push({ id: String(l.id), name: String(l.attributes?.name ?? l.id) });
    }
    const next: string | undefined = json?.links?.next;
    path = next ? next.replace(KLAVIYO_API_BASE, '') : null;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
