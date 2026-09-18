/**
 * Unit tests for the missing-column message.
 *
 * The rule that matters most is the negative one: a genuine failure (a
 * constraint violation, a permissions error, a network fault) must pass
 * through untouched. Telling an operator to "run a migration" when the real
 * problem is a bad price would send them somewhere with nothing to fix.
 *
 * Run with:
 *   node --test --experimental-strip-types lib/admin/missing-column.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { missingColumnMessage } from './missing-column.ts';

test('the PostgREST schema-cache error names its migration', () => {
  const message = missingColumnMessage(
    "Could not find the 'pack_options' column of 'products' in the schema cache",
  );
  assert.ok(message);
  assert.match(message, /pack-option-pricing-migration\.sql/);
  assert.match(message, /pack_options/);
  // And the second cause, which no amount of re-running the migration fixes.
  assert.match(message, /reload schema/);
});

test("Postgres's own wording is recognised too", () => {
  assert.match(
    missingColumnMessage('column "hero_video_url" of relation "site_settings" does not exist') ?? '',
    /hero-media-migration\.sql/,
  );
  assert.match(
    missingColumnMessage('column products.pack_sizes does not exist') ?? '',
    /pack-options-content-migration\.sql/,
  );
});

test('a real failure is left alone for the caller to report', () => {
  const untouched = [
    'new row for relation "products" violates check constraint "products_pack_options_shape_chk"',
    'duplicate key value violates unique constraint "products_slug_key"',
    'permission denied for table products',
    'fetch failed',
    '',
    null,
    undefined,
  ];
  for (const raw of untouched) {
    assert.equal(missingColumnMessage(raw), null);
  }
});

test('a column with no migration of its own is left alone', () => {
  // Nothing useful to say about it, so the caller's own message stands.
  assert.equal(
    missingColumnMessage("Could not find the 'some_other_column' column of 'products' in the schema cache"),
    null,
  );
});
