/**
 * Unit tests for the Stealth Health shipping-address plumbing: normalising the
 * `shipping` / `customer` blocks, building the additive ledger patch, and
 * formatting the address for the admin UI.
 *
 * The repo has no test runner wired up, so these use Node's built-in
 * `node:test` + `node:assert` (zero dependencies). Run with a TS-aware loader,
 * e.g. `node --test --import tsx lib/payments/puramass-address.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePuramassShipping,
  normalizePuramassContact,
  buildPuramassContactPatch,
} from './puramass';
import {
  toShippingAddress,
  formatAddressLines,
  formatAddressOneLine,
} from './puramass-address';
import { isMissingColumnError, stripUnmigratedFields } from './puramass-columns';

/** The order payload Stealth Health returns, verbatim from the partner docs. */
const SAMPLE_ORDER = {
  transaction_id: '2dyDrM7oFgACGsfjb4d5',
  status: 'paid',
  customer: {
    first_name: null,
    last_name: null,
    email: 'fsimmons001@gmail.com',
    phone: null,
  },
  shipping: {
    address: '2375 Brimley Road, Suite 827',
    address2: null,
    city: 'Scarborough',
    state: 'ON',
    zip: 'M1S 3L6',
    country: 'CA',
  },
};

// ---- normalizePuramassShipping -------------------------------------------

test('normalizes the sample shipping block', () => {
  assert.deepEqual(normalizePuramassShipping(SAMPLE_ORDER.shipping), {
    address: '2375 Brimley Road, Suite 827',
    address2: null,
    city: 'Scarborough',
    state: 'ON',
    zip: 'M1S 3L6',
    country: 'CA',
  });
});

test('treats missing / empty shipping as no address', () => {
  assert.equal(normalizePuramassShipping(undefined), null);
  assert.equal(normalizePuramassShipping(null), null);
  assert.equal(normalizePuramassShipping({}), null);
  assert.equal(normalizePuramassShipping({ address: '   ', city: '' }), null);
});

test('accepts the alternate field names some payloads use', () => {
  const addr = normalizePuramassShipping({
    line1: '1 Main St',
    line2: 'Apt 2',
    province: 'BC',
    postal_code: 'V5K 0A1',
    city: 'Vancouver',
    country: 'CA',
  });
  assert.equal(addr?.address, '1 Main St');
  assert.equal(addr?.address2, 'Apt 2');
  assert.equal(addr?.state, 'BC');
  assert.equal(addr?.zip, 'V5K 0A1');
});

// ---- normalizePuramassContact --------------------------------------------

test('normalizes a contact with null names', () => {
  assert.deepEqual(normalizePuramassContact(SAMPLE_ORDER.customer), {
    name: null,
    email: 'fsimmons001@gmail.com',
    phone: null,
  });
});

test('joins first + last into a display name', () => {
  const c = normalizePuramassContact({ first_name: ' Fred ', last_name: 'Simmons' });
  assert.equal(c.name, 'Fred Simmons');
});

test('falls back to a single provided name part', () => {
  assert.equal(normalizePuramassContact({ last_name: 'Simmons' }).name, 'Simmons');
});

// ---- buildPuramassContactPatch -------------------------------------------

test('writes the address onto a row that has none', () => {
  const patch = buildPuramassContactPatch(
    { shipping_address: null, customer_name: null, customer_phone: null, customer_email: 'a@b.c' },
    SAMPLE_ORDER,
  );
  // The address, plus the provenance stamped alongside it so a customer-typed
  // address can be told apart from a partner-reported one.
  assert.deepEqual(Object.keys(patch), [
    'shipping_address',
    'shipping_address_source',
    'shipping_address_updated_at',
  ]);
  assert.equal((patch.shipping_address as any).city, 'Scarborough');
  assert.equal(patch.shipping_address_source, 'puramass');
});

test('is a no-op when nothing changed', () => {
  const patch = buildPuramassContactPatch(
    {
      shipping_address: SAMPLE_ORDER.shipping,
      customer_name: null,
      customer_phone: null,
      customer_email: 'fsimmons001@gmail.com',
    },
    SAMPLE_ORDER,
  );
  assert.deepEqual(patch, {});
});

test('never clears a stored address when the payload omits shipping', () => {
  const patch = buildPuramassContactPatch(
    { shipping_address: SAMPLE_ORDER.shipping, customer_email: 'a@b.c' },
    { customer: { phone: '+1 555 0100' } },
  );
  assert.deepEqual(patch, { customer_phone: '+1 555 0100' });
});

test('fills a missing email but never overwrites the hand-off email', () => {
  assert.equal(
    buildPuramassContactPatch({ customer_email: null }, SAMPLE_ORDER).customer_email,
    'fsimmons001@gmail.com',
  );
  assert.equal(
    'customer_email' in
      buildPuramassContactPatch({ customer_email: 'ours@aminocan.com' }, SAMPLE_ORDER),
    false,
  );
});

test('picks up a corrected address on a later event', () => {
  const patch = buildPuramassContactPatch(
    { shipping_address: SAMPLE_ORDER.shipping },
    { shipping: { ...SAMPLE_ORDER.shipping, address2: 'Unit 4' } },
  );
  assert.equal((patch.shipping_address as any).address2, 'Unit 4');
});

// ---- display helpers ------------------------------------------------------

test('formats the sample address into display lines', () => {
  assert.deepEqual(formatAddressLines(toShippingAddress(SAMPLE_ORDER.shipping)), [
    '2375 Brimley Road, Suite 827',
    'Scarborough, ON M1S 3L6',
    'CA',
  ]);
});

test('formats partial addresses without stray separators', () => {
  assert.deepEqual(formatAddressLines(toShippingAddress({ city: 'Toronto', country: 'ca' })), [
    'Toronto',
    'CA',
  ]);
  assert.deepEqual(formatAddressLines(toShippingAddress({ state: 'ON', zip: 'M1S 3L6' })), [
    'ON M1S 3L6',
  ]);
});

test('renders nothing for a missing address', () => {
  assert.deepEqual(formatAddressLines(toShippingAddress(null)), []);
  assert.deepEqual(formatAddressLines(toShippingAddress({})), []);
  assert.equal(formatAddressOneLine(toShippingAddress(undefined)), '');
});

test('tolerates an address stored as JSON text or a bare string', () => {
  assert.equal(toShippingAddress(JSON.stringify(SAMPLE_ORDER.shipping))?.city, 'Scarborough');
  assert.equal(toShippingAddress('2375 Brimley Road')?.address, '2375 Brimley Road');
  assert.equal(toShippingAddress('   '), null);
});

test('one-line form is comma joined', () => {
  assert.equal(
    formatAddressOneLine(toShippingAddress(SAMPLE_ORDER.shipping)),
    '2375 Brimley Road, Suite 827, Scarborough, ON M1S 3L6, CA',
  );
});

// ---- missing-column tolerance --------------------------------------------

test('recognises the errors that mean the migration is not visible yet', () => {
  assert.equal(isMissingColumnError({ code: '42703' }), true);
  assert.equal(isMissingColumnError({ code: 'PGRST204' }), true);
  assert.equal(
    isMissingColumnError({
      message: 'column puramass_orders.shipping_address does not exist',
    }),
    true,
  );
  assert.equal(
    isMissingColumnError({
      message: "Could not find the 'customer_name' column of 'puramass_orders' in the schema cache",
    }),
    true,
  );
});

test('does not mistake ordinary failures for a missing column', () => {
  assert.equal(isMissingColumnError(null), false);
  assert.equal(isMissingColumnError({ code: '23505', message: 'duplicate key value' }), false);
  assert.equal(isMissingColumnError({ message: 'relation does not exist' }), false);
});

test('strips only the migration columns from an update payload', () => {
  assert.deepEqual(
    stripUnmigratedFields({
      status: 'paid',
      paid_at: 'now',
      customer_email: 'a@b.c',
      shipping_address: { city: 'Scarborough' },
      customer_name: 'Fred',
      customer_phone: '+1',
    }),
    { status: 'paid', paid_at: 'now', customer_email: 'a@b.c' },
  );
});
