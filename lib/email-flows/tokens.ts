/**
 * Email flows — signed links.
 *
 * Three kinds of link leave in every email and come back to public routes, so
 * each carries an HMAC that only this server can produce:
 *
 *   unsubscribe  /api/email-flows/unsubscribe?t=<entryId>.<sig>
 *   open pixel   /api/email-flows/open?t=<sendId>.<sig>
 *   click        /api/email-flows/click?t=<sendId>&u=<url>&s=<sig>
 *   web view     /api/email-flows/view?t=<sendId>.<sig>
 *
 * The click signature covers the destination as well as the send, so the
 * tracker can't be turned into an open redirect by editing `u`, and nobody can
 * unsubscribe somebody else by guessing an id.
 *
 * Server-only (node:crypto).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * EMAIL_FLOWS_SECRET when set; otherwise CRON_SECRET, then the service-role
 * key — both already server-only secrets on every deployment, so the links
 * work the moment this ships. Rotating the secret invalidates links in emails
 * already sent, which is why a dedicated one is preferred.
 */
function secret(): string {
  const s =
    process.env.EMAIL_FLOWS_SECRET ||
    process.env.CRON_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    '';
  if (!s) throw new Error('No signing secret: set EMAIL_FLOWS_SECRET');
  return s;
}

export function sign(purpose: string, value: string): string {
  return createHmac('sha256', secret()).update(`${purpose}:${value}`).digest('base64url').slice(0, 32);
}

export function verify(purpose: string, value: string, sig: string): boolean {
  if (!value || !sig) return false;
  const expected = Buffer.from(sign(purpose, value));
  const given = Buffer.from(String(sig));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `<id>.<sig>` → the id, or null when tampered with. */
export function readIdToken(purpose: 'unsub' | 'open' | 'view', token: string | null): string | null {
  const [id, sig] = String(token ?? '').split('.');
  if (!id || !UUID.test(id)) return null;
  return verify(purpose, id, sig ?? '') ? id : null;
}

export function idToken(purpose: 'unsub' | 'open' | 'view', id: string): string {
  return `${id}.${sign(purpose, id)}`;
}

export function unsubscribeUrl(siteUrl: string, entryId: string): string {
  return `${siteUrl.replace(/\/$/, '')}/api/email-flows/unsubscribe?t=${idToken('unsub', entryId)}`;
}

export function openPixelUrl(siteUrl: string, sendId: string): string {
  return `${siteUrl.replace(/\/$/, '')}/api/email-flows/open?t=${idToken('open', sendId)}`;
}

/** "View in browser": the email exactly as it was sent, served from the stored copy. */
export function viewUrl(siteUrl: string, sendId: string): string {
  return `${siteUrl.replace(/\/$/, '')}/api/email-flows/view?t=${idToken('view', sendId)}`;
}

export function clickUrl(siteUrl: string, sendId: string, target: string): string {
  const q = new URLSearchParams({ t: sendId, u: target, s: sign('click', `${sendId}|${target}`) });
  return `${siteUrl.replace(/\/$/, '')}/api/email-flows/click?${q.toString()}`;
}

/** The verified destination of a click, or null. Only http(s) is ever returned. */
export function readClick(params: URLSearchParams): { sendId: string; target: string } | null {
  const sendId = params.get('t') ?? '';
  const target = params.get('u') ?? '';
  const sig = params.get('s') ?? '';
  if (!UUID.test(sendId) || !/^https?:\/\//i.test(target)) return null;
  return verify('click', `${sendId}|${target}`, sig) ? { sendId, target } : null;
}
