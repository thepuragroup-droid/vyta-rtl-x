/**
 * Where an invoice's parcel goes.
 *
 * Easyship was wired to `orders` only, which left every invoice that has no
 * order behind it unable to book a shipment at all. The biggest group is
 * Stealth Health / PuraMass: those invoices are materialised from the hosted
 * checkout, deliberately carry no order row, and keep their ship-to on the
 * hand-off ledger (`puramass_orders.shipping_address`) — see
 * lib/payments/puramass-fulfillment.ts. Drop-ship and plain customer invoices
 * raised in this admin have the same problem whenever they aren't order-bound.
 *
 * This module answers "where does this invoice ship to, and who signs for it"
 * from whichever source actually holds the answer, in the order the data is
 * most likely to be right:
 *
 *   1. the linked order's `shipping_address` (it was captured at checkout)
 *   2. the PuraMass hand-off ledger, for a Stealth Health invoice
 *   3. the drop-ship client (`invoices.client_id`), when ships_to_client is on
 *   4. the customer's saved shipping profile
 *
 * Everything is tolerant of missing data — an invoice PuraMass hasn't reported
 * an address for yet is the normal case, not an error, so it resolves to null
 * with a `reason` the caller can show or log rather than throwing.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { toShippingAddress } from '@/lib/payments/puramass-address';
import { countryAlpha2 } from '@/lib/shipping/regions';

/** Where the address came from — surfaced so the UI never presents an address
 *  PuraMass reported and one an admin typed here as the same thing. */
export type InvoiceDestinationSource =
  | 'order'
  | 'puramass'
  | 'client'
  | 'customer';

/**
 * A destination in the shape `orders.shipping_address` already uses, so the
 * shipment helper can consume an order's address and this one interchangeably.
 */
export interface InvoiceDestination {
  firstName: string;
  lastName: string;
  address: string;
  address2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  /** ISO alpha-2 — Easyship rejects anything else. */
  country: string;
  phone?: string | null;
  email?: string | null;
  source: InvoiceDestinationSource;
}

/** The invoice columns this module reads. Selected by the caller so a route
 *  that already loaded the invoice doesn't fetch it twice. */
export interface InvoiceRowForDestination {
  id: string;
  order_id?: string | null;
  source?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  ships_to_client?: boolean | null;
  client_id?: string | null;
}

export interface ResolvedInvoiceDestination {
  destination: InvoiceDestination | null;
  /** Why there is no destination, for the readiness check and the attempt log. */
  reason: string | null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Split "Jane Q Doe" into first / last for Easyship's contact_name. */
function splitName(full: string | null | undefined): { first: string; last: string } {
  const parts = str(full).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

/** A destination is only usable when Easyship can price and address it. */
export function isShippableDestination(
  dest: InvoiceDestination | null,
): dest is InvoiceDestination {
  return !!dest && !!dest.postalCode && !!dest.city && !!dest.country;
}

/**
 * Read the PuraMass hand-off ledger for an invoice and normalise its ship-to.
 * Best-effort: a ledger row that can't be read (address columns not migrated
 * yet) resolves to null, exactly as the warehouse queue already degrades.
 */
async function puramassDestination(
  db: SupabaseClient,
  invoiceId: string,
): Promise<InvoiceDestination | null> {
  const { data } = await db
    .from('puramass_orders')
    .select('*')
    .eq('invoice_id', invoiceId)
    .maybeSingle();
  if (!data) return null;

  const addr = toShippingAddress((data as any).shipping_address);
  if (!addr) return null;

  const { first, last } = splitName((data as any).customer_name);
  return {
    firstName: first,
    lastName: last,
    address: str(addr.address),
    address2: addr.address2 ?? null,
    city: str(addr.city),
    state: str(addr.state),
    postalCode: str(addr.zip),
    country: countryAlpha2(addr.country),
    phone: (data as any).customer_phone ?? null,
    email: (data as any).customer_email ?? null,
    source: 'puramass',
  };
}

/**
 * Resolve the destination for an invoice. `invoice` may be a row the caller
 * already has; only `id` is required, anything missing is fetched.
 */
export async function resolveInvoiceDestination(
  db: SupabaseClient,
  invoice: InvoiceRowForDestination,
): Promise<ResolvedInvoiceDestination> {
  // 1. The linked order — captured at checkout, and the only source the
  //    order-anchored shipment path uses.
  if (invoice.order_id) {
    const { data: order } = await db
      .from('orders')
      .select('shipping_address, email')
      .eq('id', invoice.order_id)
      .maybeSingle();
    const addr: any = order?.shipping_address;
    if (addr && typeof addr === 'object') {
      const dest: InvoiceDestination = {
        firstName: str(addr.firstName),
        lastName: str(addr.lastName),
        address: str(addr.address),
        address2: addr.address2 ?? null,
        city: str(addr.city),
        state: str(addr.state),
        postalCode: str(addr.postalCode ?? addr.postal_code),
        country: countryAlpha2(addr.country),
        phone: addr.phone ?? invoice.customer_phone ?? null,
        email: addr.email ?? order?.email ?? invoice.customer_email ?? null,
        source: 'order',
      };
      if (isShippableDestination(dest)) return { destination: dest, reason: null };
    }
  }

  // 2. Stealth Health / PuraMass — the ledger owns the address.
  if (invoice.source === 'stealth_health') {
    const dest = await puramassDestination(db, invoice.id);
    if (isShippableDestination(dest)) return { destination: dest, reason: null };
    return {
      destination: null,
      reason:
        'Stealth Health has not reported a shipping address for this order yet — ask the customer for it from the Stealth Health tab.',
    };
  }

  // 3. Drop-ship client on the invoice.
  if (invoice.ships_to_client && invoice.client_id) {
    const { data: client } = await db
      .from('customer_clients')
      .select('first_name, last_name, address, city, state, postal_code, country, phone, email')
      .eq('id', invoice.client_id)
      .maybeSingle();
    if (client) {
      const dest: InvoiceDestination = {
        firstName: str(client.first_name),
        lastName: str(client.last_name),
        address: str(client.address),
        city: str(client.city),
        state: str(client.state),
        postalCode: str(client.postal_code),
        country: countryAlpha2(client.country),
        // A client with no contact details falls back to the customer's, so
        // the courier still has someone to call.
        phone: client.phone || invoice.customer_phone || null,
        email: client.email || invoice.customer_email || null,
        source: 'client',
      };
      if (isShippableDestination(dest)) return { destination: dest, reason: null };
      return {
        destination: null,
        reason: 'The drop-ship client is missing a city, postal code or country.',
      };
    }
  }

  // 4. The customer's saved shipping profile.
  if (invoice.customer_id) {
    const { data: customer } = await db
      .from('customers')
      .select(
        'first_name, last_name, email, phone, shipping_address, shipping_city, shipping_state, shipping_postal_code, shipping_country',
      )
      .eq('id', invoice.customer_id)
      .maybeSingle();
    if (customer) {
      const dest: InvoiceDestination = {
        firstName: str(customer.first_name),
        lastName: str(customer.last_name),
        address: str(customer.shipping_address),
        city: str(customer.shipping_city),
        state: str(customer.shipping_state),
        postalCode: str(customer.shipping_postal_code),
        country: countryAlpha2(customer.shipping_country),
        phone: customer.phone || invoice.customer_phone || null,
        email: customer.email || invoice.customer_email || null,
        source: 'customer',
      };
      if (isShippableDestination(dest)) return { destination: dest, reason: null };
    }
  }

  return {
    destination: null,
    reason:
      'No shipping address on this invoice — add one to the customer profile, the drop-ship client, or the linked order.',
  };
}

/**
 * Load the invoice columns this module needs and resolve in one call, for
 * routes that only have an invoice id.
 */
export async function resolveDestinationForInvoiceId(
  db: SupabaseClient,
  invoiceId: string,
): Promise<ResolvedInvoiceDestination & { invoice: InvoiceRowForDestination | null }> {
  const { data: invoice } = await db
    .from('invoices')
    .select(
      'id, order_id, source, customer_id, customer_name, customer_email, customer_phone, ships_to_client, client_id',
    )
    .eq('id', invoiceId)
    .maybeSingle();
  if (!invoice) {
    return { invoice: null, destination: null, reason: 'Invoice not found.' };
  }
  const resolved = await resolveInvoiceDestination(db, invoice as InvoiceRowForDestination);
  return { invoice: invoice as InvoiceRowForDestination, ...resolved };
}
