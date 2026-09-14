/**
 * Unit tests for the PuraMass SKU matcher.
 *
 * The repo has no test runner wired up, so these use Node's built-in
 * `node:test` + `node:assert` (zero dependencies). Run with a TS-aware loader,
 * e.g. `node --test --import tsx lib/payments/puramass-catalog.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeName,
  matchProductToPuramass,
  type PuramassCatalogEntry,
} from './puramass-catalog';

const CATALOG: PuramassCatalogEntry[] = [
  { sku: 'puramass-bpc-157-10mg-10-pack', name: 'BPC-157 10mg' },
  { sku: 'puramass-5-amino-1mq-10mg-10-pack', name: '5-Amino-1MQ 10mg' },
  { sku: 'puramass-ghrp-2-10mg-10-pack', name: 'GHRP-2 10mg' },
  { sku: 'puramass-ghrp-6-10mg-10-pack', name: 'GHRP-6 10mg' },
  { sku: 'puramass-bpc-157-20mg-10-pack', name: 'BPC-157 20mg' },
  { sku: 'puramass-hgh-10iu-10-pack', name: 'HGH 10 IU' },
];

test('normalizeName glues number + unit into one dose token', () => {
  assert.equal(normalizeName('BPC-157 10 mg'), 'bpc 157 10mg');
  assert.equal(normalizeName('HGH 10 IU'), 'hgh 10iu');
  assert.equal(normalizeName('Ipamorelin®  5mg'), 'ipamorelin 5mg');
  assert.equal(normalizeName('CJC-1295 (no DAC)'), 'cjc 1295 no dac');
});

test('exact match on identical normalized names', () => {
  const r = matchProductToPuramass('BPC-157 10mg', null, CATALOG);
  assert.equal(r.status, 'exact');
  assert.equal(r.sku, 'puramass-bpc-157-10mg-10-pack');
});

test('exact match using name + strength', () => {
  const r = matchProductToPuramass('BPC-157', '10mg', CATALOG);
  assert.equal(r.status, 'exact');
  assert.equal(r.sku, 'puramass-bpc-157-10mg-10-pack');
});

test('matched: fewest extra words wins with unique minimum', () => {
  const r = matchProductToPuramass('5-Amino 10mg', null, CATALOG);
  assert.equal(r.status, 'matched');
  assert.equal(r.sku, 'puramass-5-amino-1mq-10mg-10-pack');
});

test('ambiguous: GHRP 10mg ties GHRP-2 vs GHRP-6', () => {
  const r = matchProductToPuramass('GHRP', '10mg', CATALOG);
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.sku, null);
  assert.equal(r.candidates.length, 2);
  const skus = r.candidates.map((c) => c.sku).sort();
  assert.deepEqual(skus, [
    'puramass-ghrp-2-10mg-10-pack',
    'puramass-ghrp-6-10mg-10-pack',
  ]);
});

test('dose must match: 10mg never crosses to 20mg', () => {
  // "BPC-157" alone (no dose) would word-match both 10mg and 20mg, but with a
  // 10mg strength only the 10mg entry qualifies.
  const r = matchProductToPuramass('BPC-157', '10mg', CATALOG);
  assert.equal(r.entry?.name, 'BPC-157 10mg');
});

test('unmatched: nothing shares dose + words', () => {
  const r = matchProductToPuramass('Vitamin C', '1000mg', CATALOG);
  assert.equal(r.status, 'unmatched');
  assert.equal(r.sku, null);
  assert.equal(r.candidates.length, 0);
});
