/**
 * Unit tests for the pure halves of the Klaviyo integration: settings shaping
 * (what counts as "on", where the key comes from, what the storefront may see)
 * and the JSON:API bodies sent to Klaviyo.
 *
 * Run with: node --test --experimental-strip-types lib/klaviyo/klaviyo.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  klaviyoOnsiteKey,
  klaviyoServerReady,
  shapeKlaviyoSettings,
} from './settings.ts';
import { eventBody, profileAttributes, toE164 } from './payload.ts';

test('an unmigrated row is off, with no key and every sub-switch defaulting on', () => {
  const s = shapeKlaviyoSettings({}, {});
  assert.equal(s.enabled, false);
  assert.equal(s.privateKey, '');
  assert.equal(s.keySource, null);
  assert.equal(s.onsiteEnabled, true);
  assert.equal(s.serverEventsEnabled, true);
  assert.equal(s.syncSignups, true);
  assert.equal(klaviyoServerReady(s), false);
});

test('the stored key wins over the env fallback, and the env fills in when empty', () => {
  const env = { KLAVIYO_PRIVATE_API_KEY: 'pk_env_key_1234567' };
  const fromDb = shapeKlaviyoSettings({ klaviyo_private_api_key: ' pk_db_key_1234567 ' }, env);
  assert.equal(fromDb.privateKey, 'pk_db_key_1234567');
  assert.equal(fromDb.keySource, 'db');
  const fromEnv = shapeKlaviyoSettings({ klaviyo_private_api_key: '' }, env);
  assert.equal(fromEnv.privateKey, 'pk_env_key_1234567');
  assert.equal(fromEnv.keySource, 'env');
});

test('server events need the master switch, the events switch and a key', () => {
  const row = { klaviyo_enabled: true, klaviyo_private_api_key: 'pk_x_1234567890' };
  assert.equal(klaviyoServerReady(shapeKlaviyoSettings(row, {})), true);
  assert.equal(
    klaviyoServerReady(shapeKlaviyoSettings({ ...row, klaviyo_server_events_enabled: false }, {})),
    false,
  );
  assert.equal(
    klaviyoServerReady(shapeKlaviyoSettings({ ...row, klaviyo_enabled: false }, {})),
    false,
  );
});

test('the storefront only gets a Site ID when enabled + onsite on + the id is well-formed', () => {
  const row = { klaviyo_enabled: true, klaviyo_public_key: 'AbC123' };
  assert.equal(klaviyoOnsiteKey(row), 'AbC123');
  assert.equal(klaviyoOnsiteKey({ ...row, klaviyo_onsite_enabled: false }), null);
  assert.equal(klaviyoOnsiteKey({ ...row, klaviyo_enabled: false }), null);
  assert.equal(klaviyoOnsiteKey({ ...row, klaviyo_public_key: '<script>' }), null);
});

test('the private key never leaks through the onsite key', () => {
  assert.equal(
    klaviyoOnsiteKey({ klaviyo_enabled: true, klaviyo_private_api_key: 'pk_secret_123456' }),
    null,
  );
});

test('phone numbers are only sent in E.164', () => {
  assert.equal(toE164('+1 (416) 555-0100'), '+14165550100');
  assert.equal(toE164('416-555-0100'), '+14165550100');
  assert.equal(toE164('1 416 555 0100'), '+14165550100');
  assert.equal(toE164('555-0100'), null);
  assert.equal(toE164(''), null);
  assert.equal(toE164(undefined), null);
});

test('profile attributes drop empties and normalise the email', () => {
  const attrs = profileAttributes({
    email: ' Jane@Example.COM ',
    first_name: 'Jane',
    last_name: '',
    phone_number: 'nope',
    location: { city: 'Toronto', zip: null },
  });
  assert.deepEqual(attrs, {
    email: 'jane@example.com',
    first_name: 'Jane',
    location: { city: 'Toronto' },
  });
});

test('an event body carries metric, profile, rounded value, currency and dedupe key', () => {
  const body = eventBody({
    metric: 'Placed Order',
    profile: { email: 'a@b.co' },
    properties: { OrderId: '42' },
    value: 10.005,
    currency: 'cad',
    uniqueId: 'order-42',
    time: '2026-01-02T03:04:05Z',
  });
  const a = body.data.attributes as Record<string, any>;
  assert.equal(body.data.type, 'event');
  assert.equal(a.metric.data.attributes.name, 'Placed Order');
  assert.equal(a.profile.data.attributes.email, 'a@b.co');
  assert.equal(a.value, 10.01);
  assert.equal(a.value_currency, 'CAD');
  assert.equal(a.unique_id, 'order-42');
  assert.equal(a.time, '2026-01-02T03:04:05.000Z');
  assert.deepEqual(a.properties, { OrderId: '42' });
});

test('an event without a value sends no value fields', () => {
  const a = eventBody({ metric: 'Created Account', profile: { email: 'a@b.co' } }).data
    .attributes as Record<string, any>;
  assert.equal('value' in a, false);
  assert.equal('value_currency' in a, false);
  assert.equal('unique_id' in a, false);
});
