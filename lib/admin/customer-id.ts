/**
 * How the admin addresses a person, in a module the browser can import.
 *
 * A registered customer is a `customers` UUID. Someone who only ever bought
 * through the Stealth Health hosted checkout has no account row at all, so the
 * email itself is the key — prefixed, so every consumer can tell it apart from
 * a UUID at a glance.
 *
 * Split out of lib/admin/customer-directory.ts (which reads the service-role
 * ledger and is server-only) so admin screens can BUILD one of these ids
 * without importing the directory. Two places writing `pm:` by hand is how the
 * prefix eventually stops matching.
 */

export const normalizeEmail = (email: string | null | undefined): string =>
  String(email ?? '').trim().toLowerCase();

export const PURAMASS_ID_PREFIX = 'pm:';

export const puramassId = (email: string): string =>
  `${PURAMASS_ID_PREFIX}${normalizeEmail(email)}`;

export const isPuramassId = (id: string): boolean =>
  id.startsWith(PURAMASS_ID_PREFIX);

export const emailFromPuramassId = (id: string): string =>
  normalizeEmail(id.slice(PURAMASS_ID_PREFIX.length));

/**
 * The id for whoever is behind a record that carries an optional account link
 * and an email — a Stealth Health ledger row, an invoice, a storefront order.
 * Null when there is neither, i.e. nobody to address.
 */
export function outreachIdFor(record: {
  customer_id?: string | null;
  customer_email?: string | null;
}): string | null {
  if (record.customer_id) return record.customer_id;
  const email = normalizeEmail(record.customer_email);
  return email ? puramassId(email) : null;
}
