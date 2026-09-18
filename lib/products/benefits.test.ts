/**
 * Unit tests for the product benefits list.
 *
 * The rules that matter: a legacy comma row keeps parsing exactly as it did,
 * a line-separated row is read one point per line, pasted markup is turned
 * into the points it describes rather than shown as tags, and anything the
 * editor saves reads back as the same points it saved.
 *
 * Run with:
 *   node --test --experimental-strip-types lib/products/benefits.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBenefits, parseBenefits } from './benefits.ts';

test('a legacy comma-separated row parses as it always did', () => {
  assert.deepEqual(parseBenefits('Tissue repair, Anti-inflammatory, Gut health'), [
    'Tissue repair',
    'Anti-inflammatory',
    'Gut health',
  ]);
  assert.deepEqual(parseBenefits('Single benefit'), ['Single benefit']);
});

test('line breaks mean one point per line, commas and all', () => {
  assert.deepEqual(
    parseBenefits('Supports repair, recovery and sleep\nReduces inflammation'),
    ['Supports repair, recovery and sleep', 'Reduces inflammation'],
  );
  // Windows line endings, and blank lines between points.
  assert.deepEqual(parseBenefits('One\r\n\r\nTwo\r\n'), ['One', 'Two']);
});

test('typed bullets and numbering are stripped, not shown twice', () => {
  assert.deepEqual(parseBenefits('- One\n• Two\n* Three\n1. Four\n2) Five'), [
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
  ]);
  // A dash INSIDE a point is copy, not a bullet.
  assert.deepEqual(parseBenefits('Anti-inflammatory\nGut-brain axis'), [
    'Anti-inflammatory',
    'Gut-brain axis',
  ]);
});

test('pasted HTML becomes the points it describes', () => {
  assert.deepEqual(
    parseBenefits('<ul><li>Tissue repair</li><li>Reduces inflammation</li></ul>'),
    ['Tissue repair', 'Reduces inflammation'],
  );
  assert.deepEqual(parseBenefits('First<br>Second<br/>Third'), ['First', 'Second', 'Third']);
  assert.deepEqual(parseBenefits('<p>Healing &amp; repair</p>'), ['Healing & repair']);
  // The inline syntax the storefront DOES understand survives untouched.
  assert.deepEqual(parseBenefits('**Fast** repair\n[Read the study](/articles/x)'), [
    '**Fast** repair',
    '[Read the study](/articles/x)',
  ]);
});

test('empty and whitespace-only values have no points', () => {
  assert.deepEqual(parseBenefits(null), []);
  assert.deepEqual(parseBenefits(undefined), []);
  assert.deepEqual(parseBenefits(''), []);
  assert.deepEqual(parseBenefits('   \n  \n '), []);
  assert.deepEqual(parseBenefits('<p></p>'), []);
});

test('whatever the editor saves reads back as the same points', () => {
  const cases: string[][] = [
    ['One'],
    ['One', 'Two', 'Three'],
    // The case a naive "join with newlines" gets wrong: one point, one comma.
    ['Supports repair, recovery and sleep'],
    ['Supports repair, recovery and sleep', 'Reduces inflammation'],
    ['**Bold** point', 'A [link](https://example.com) point'],
  ];
  for (const points of cases) {
    assert.deepEqual(parseBenefits(formatBenefits(points)), points);
  }
});

test('formatBenefits drops blank rows the editor left behind', () => {
  assert.equal(formatBenefits(['One', '  ', '', 'Two']), 'One\nTwo');
  assert.equal(formatBenefits([]), '');
});
