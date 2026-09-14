/**
 * Unit tests for the missing-shipping-address flow: validating what the
 * customer types, the emailed token, and the guard that stops a later PuraMass
 * poll from overwriting an address the buyer gave us themselves.
 *
 * The repo has no test runner wired up, so these use Node's built-in
 * `node:test` + `node:assert` (zero dependencies). Run with a TS-aware loader,
 * e.g. `node --test --import tsx lib/payments/puramass-missing-address.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateShippingAddress } from './puramass-address';
import {
  addressRequestLink,
  generateAddressToken,
  hashAddressToken,
  looksLikeAddressToken,
  parseCcList,
  MAX_CC_RECIPIENTS,
} from './puramass-address-request';
import { buildPuramassContactPatch } from './puramass';
import { stripUnmigratedFields } from './puramass-columns';

// ---- validateShippingAddress ---------------------------------------------

const COMPLETE = {
  full_name: '  Dana Reyes ',
  phone: ' 416-555-0199 ',
  address: ' 2375 Brimley Road ',
  address2: ' Suite 827 ',
  city: ' Scarborough ',
  state: 'on',
  zip: ' M1S 3L6 ',
  country: 'ca',
};

test('accepts a complete address and normalises it', () => {
  const { ok, errors, value } = validateShippingAddress(COMPLETE);
  assert.equal(ok, true);
  assert.deepEqual(errors, {});
  assert.equal(value.full_name, 'Dana Reyes');
  assert.equal(value.phone, '416-555-0199');
  assert.deepEqual(value.address, {
    address: '2375 Brimley Road',
    address2: 'Suite 827',
    city: 'Scarborough',
    state: 'on',
    zip: 'M1S 3L6',
    // Country is upper-cased so it always matches the ISO code PuraMass uses.
    country: 'CA',
  });
});

test('an omitted apartment line and phone become null, not empty strings', () => {
  const { value } = validateShippingAddress({ ...COMPLETE, address2: '   ', phone: '' });
  assert.equal(value.address.address2, null);
  assert.equal(value.phone, null);
});

test('flags every missing required field at once', () => {
  const { ok, errors } = validateShippingAddress({});
  assert.equal(ok, false);
  assert.ok(errors.full_name);
  assert.ok(errors.address);
  assert.ok(errors.city);
  assert.ok(errors.zip);
  assert.ok(errors.country);
});

test('requires a region in the US and Canada, but not elsewhere', () => {
  const us = validateShippingAddress({ ...COMPLETE, country: 'US', state: '' });
  assert.equal(us.ok, false);
  assert.ok(us.errors.state);

  const ca = validateShippingAddress({ ...COMPLETE, country: 'CA', state: '' });
  assert.equal(ca.ok, false);
  assert.ok(ca.errors.state);

  // Plenty of countries have no region in an address at all.
  const sg = validateShippingAddress({ ...COMPLETE, country: 'SG', state: '' });
  assert.equal(sg.ok, true);
  assert.equal(sg.errors.state, undefined);
});

test('caps absurdly long values instead of rejecting them', () => {
  const { ok, value } = validateShippingAddress({ ...COMPLETE, address: 'x'.repeat(500) });
  assert.equal(ok, true);
  assert.equal(value.address.address!.length, 200);
});

// ---- tokens ---------------------------------------------------------------

test('a generated token is url-safe and recognised by the shape check', () => {
  const token = generateAddressToken();
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.equal(looksLikeAddressToken(token), true);
  assert.equal(encodeURIComponent(token), token);
});

test('tokens are unique and hash deterministically', () => {
  const a = generateAddressToken();
  const b = generateAddressToken();
  assert.notEqual(a, b);
  assert.equal(hashAddressToken(a), hashAddressToken(a));
  assert.notEqual(hashAddressToken(a), hashAddressToken(b));
  // Hex sha256.
  assert.match(hashAddressToken(a), /^[0-9a-f]{64}$/);
});

test('junk tokens are rejected before touching the database', () => {
  for (const junk of ['', 'short', 'has spaces in it', 'drop/table', 'x'.repeat(200)]) {
    assert.equal(looksLikeAddressToken(junk), false, junk);
  }
});

test('the emailed link points at the customer page for that token', () => {
  const token = generateAddressToken();
  assert.ok(addressRequestLink(token).endsWith(`/shipping-address/${token}`));
});

// ---- provenance guard -----------------------------------------------------

const PARTNER_PAYLOAD = {
  shipping: {
    address: '1 Partner Way',
    city: 'Toronto',
    state: 'ON',
    zip: 'M5V 1A1',
    country: 'CA',
  },
  customer: { first_name: 'Dana', last_name: 'Reyes', email: null, phone: null },
};

test('a partner address is stored with its provenance', () => {
  const patch = buildPuramassContactPatch({ shipping_address: null }, PARTNER_PAYLOAD);
  assert.ok(patch.shipping_address);
  assert.equal(patch.shipping_address_source, 'puramass');
  assert.ok(patch.shipping_address_updated_at);
});

test('a partner poll never overwrites an address the customer typed', () => {
  const patch = buildPuramassContactPatch(
    {
      shipping_address: { address: '2375 Brimley Road', city: 'Scarborough', country: 'CA' },
      shipping_address_source: 'customer',
    },
    PARTNER_PAYLOAD,
  );
  assert.equal(patch.shipping_address, undefined);
  assert.equal(patch.shipping_address_source, undefined);
  // Contact details are still additive — only the address is protected.
  assert.equal(patch.customer_name, 'Dana Reyes');
});

test('a partner address does replace an earlier partner address', () => {
  const patch = buildPuramassContactPatch(
    {
      shipping_address: { address: 'Old Street', city: 'Toronto', country: 'CA' },
      shipping_address_source: 'puramass',
    },
    PARTNER_PAYLOAD,
  );
  assert.ok(patch.shipping_address);
});

test('the missing-column fallback drops the provenance columns too', () => {
  const stripped = stripUnmigratedFields({
    status: 'paid',
    shipping_address: { address: '1 Partner Way' },
    shipping_address_source: 'puramass',
    shipping_address_updated_at: '2026-08-18T00:00:00.000Z',
    address_requested_at: '2026-08-18T00:00:00.000Z',
  });
  assert.deepEqual(stripped, { status: 'paid' });
});

// ---- CC recipients --------------------------------------------------------

test('parses a comma-separated CC field', () => {
  const { list, invalid, truncated } = parseCcList('a@b.co,  c@d.co ');
  assert.deepEqual(list, ['a@b.co', 'c@d.co']);
  assert.deepEqual(invalid, []);
  assert.equal(truncated, false);
});

test('accepts semicolons, newlines and arrays too', () => {
  assert.deepEqual(parseCcList('a@b.co; c@d.co').list, ['a@b.co', 'c@d.co']);
  assert.deepEqual(parseCcList('a@b.co\nc@d.co').list, ['a@b.co', 'c@d.co']);
  assert.deepEqual(parseCcList(['a@b.co', ' c@d.co ']).list, ['a@b.co', 'c@d.co']);
});

test('an empty or absent CC field is simply no copies', () => {
  for (const raw of [undefined, null, '', '   ', ',,', []]) {
    assert.deepEqual(parseCcList(raw).list, [], JSON.stringify(raw));
  }
});

test('reports junk entries instead of dropping them silently', () => {
  const { list, invalid } = parseCcList('good@example.com, not-an-email');
  assert.deepEqual(list, ['good@example.com']);
  assert.deepEqual(invalid, ['not-an-email']);
});

test('drops the primary recipient and duplicates, case-insensitively', () => {
  const { list } = parseCcList('Buyer@Example.com, ops@example.com, OPS@example.com', 'buyer@example.com');
  assert.deepEqual(list, ['ops@example.com']);
});

test('flags a CC list longer than the cap', () => {
  const many = Array.from({ length: MAX_CC_RECIPIENTS + 2 }, (_, i) => `p${i}@example.com`);
  const { list, truncated } = parseCcList(many.join(','));
  assert.equal(list.length, MAX_CC_RECIPIENTS);
  assert.equal(truncated, true);
});
