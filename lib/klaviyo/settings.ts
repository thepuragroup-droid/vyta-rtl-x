/**
 * Klaviyo configuration, read from the `site_settings` singleton
 * (klaviyo-integration-migration.sql) and edited in Admin → Settings → Klaviyo.
 *
 * Pure — no I/O — so the storefront config, the admin settings route and the
 * server-side event sender all agree on what "switched on" means.
 */

/** Klaviyo's public key is its 6-character company id; allow a little slack. */
export const KLAVIYO_PUBLIC_KEY_RE = /^[A-Za-z0-9]{4,12}$/;
/** List ids are short alphanumerics too (e.g. "XyZ123"). */
export const KLAVIYO_LIST_ID_RE = /^[A-Za-z0-9]{4,16}$/;

export type KlaviyoKeySource = 'db' | 'env' | null;

export interface KlaviyoSettings {
  /** Master switch. Nothing is sent or loaded while this is off. */
  enabled: boolean;
  /** Private API key (pk_…). SERVER ONLY — never put this on the wire. */
  privateKey: string;
  /** Where the private key came from: the admin UI, the env fallback, or nowhere. */
  keySource: KlaviyoKeySource;
  /** Public key / Site ID used by klaviyo.js. Safe for the browser. */
  publicKey: string;
  /** List consenting signups are subscribed to. Empty = don't subscribe. */
  listId: string;
  /** Load klaviyo.js on the storefront (onsite events + signup forms). */
  onsiteEnabled: boolean;
  /** Send order / shipping / account events from the server. */
  serverEventsEnabled: boolean;
  /** Push new accounts to Klaviyo (and to the list, when they consented). */
  syncSignups: boolean;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function shapeKlaviyoSettings(
  row: Record<string, any> | null | undefined,
  env: Record<string, string | undefined> = process.env,
): KlaviyoSettings {
  const d = row ?? {};
  const dbKey = str(d.klaviyo_private_api_key);
  const envKey = str(env.KLAVIYO_PRIVATE_API_KEY);
  const publicKey = str(d.klaviyo_public_key);
  const listId = str(d.klaviyo_list_id);
  return {
    enabled: d.klaviyo_enabled === true,
    privateKey: dbKey || envKey,
    keySource: dbKey ? 'db' : envKey ? 'env' : null,
    publicKey: KLAVIYO_PUBLIC_KEY_RE.test(publicKey) ? publicKey : '',
    listId: KLAVIYO_LIST_ID_RE.test(listId) ? listId : '',
    onsiteEnabled: d.klaviyo_onsite_enabled !== false,
    serverEventsEnabled: d.klaviyo_server_events_enabled !== false,
    syncSignups: d.klaviyo_sync_signups !== false,
  };
}

/**
 * The Site ID the storefront should load klaviyo.js with, or null for none.
 * `fallback` applies only while no Site ID has been saved in Admin — once one
 * is, the saved key and its enabled / onsite switches decide.
 */
export function klaviyoOnsiteKey(
  row: Record<string, any> | null | undefined,
  fallback: string | null = null,
): string | null {
  const s = shapeKlaviyoSettings(row, {});
  if (!s.publicKey) return fallback;
  return s.enabled && s.onsiteEnabled ? s.publicKey : null;
}

/** Whether server-side events should be sent at all. */
export function klaviyoServerReady(s: KlaviyoSettings): boolean {
  return s.enabled && s.serverEventsEnabled && s.privateKey.length > 0;
}
