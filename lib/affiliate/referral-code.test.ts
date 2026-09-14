/**
 * Unit tests for the referral code FORMAT CONTRACT (lib/affiliate/utils.ts).
 *
 * This is the file middleware, the checkout field, the request form, the admin
 * editor and every server route measure against. A regression here does not
 * throw anywhere — a referral link simply stops setting its cookie and the
 * affiliate is never credited — so the shape is pinned down explicitly.
 *
 * The repo has no test runner wired up, so these use Node's built-in
 * `node:test` + `node:assert` (zero dependencies), matching the sibling suites
 * in lib/. Run with a TS-aware loader, e.g.
 *   node --test --import tsx lib/affiliate/referral-code.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REFERRAL_CODE_MAX_LENGTH,
  REFERRAL_CODE_MIN_LENGTH,
  generateReferralCode,
  isValidReferralCodeFormat,
  normalizeReferralCode,
  referralCodeFormatError,
  suggestReferralCode,
  suggestReferralCodeVariants,
} from './utils';

/* ------------------------------------------------------------------ */
/* normalizeReferralCode                                              */
/* ------------------------------------------------------------------ */

test('normalizing folds case and strips everything that is not [A-Z0-9]', () => {
  // Codes are compared with `=`, so these must not be allowed to become two
  // different things.
  assert.equal(normalizeReferralCode('amc smith-10'), 'AMCSMITH10');
  assert.equal(normalizeReferralCode('  AMCSMITH10  '), 'AMCSMITH10');
  assert.equal(normalizeReferralCode('a.m.c/smith_10'), 'AMCSMITH10');
  assert.equal(normalizeReferralCode(null), '');
  assert.equal(normalizeReferralCode(undefined), '');
});

/* ------------------------------------------------------------------ */
/* isValidReferralCodeFormat / referralCodeFormatError                */
/* ------------------------------------------------------------------ */

test('a code is 4 to 20 characters of A-Z and 0-9 — not a fixed 8', () => {
  assert.equal(REFERRAL_CODE_MIN_LENGTH, 4);
  assert.equal(REFERRAL_CODE_MAX_LENGTH, 20);

  assert.ok(isValidReferralCodeFormat('AMCSMITH10'));
  assert.ok(isValidReferralCodeFormat('ABCD'));
  assert.ok(isValidReferralCodeFormat('A'.repeat(20)));

  assert.equal(isValidReferralCodeFormat('ABC'), false);
  assert.equal(isValidReferralCodeFormat('A'.repeat(21)), false);
  assert.equal(isValidReferralCodeFormat('amcsmith10'), false);
  assert.equal(isValidReferralCodeFormat('AMC-SMITH-10'), false);
});

test('the format error explains itself to whoever typed the code', () => {
  assert.equal(referralCodeFormatError('AMCSMITH10'), null);
  // Punctuation and case are normalised away first, so they are never the
  // complaint.
  assert.equal(referralCodeFormatError('amc smith-10'), null);

  assert.equal(referralCodeFormatError(''), 'Enter a code using letters and numbers.');
  assert.equal(referralCodeFormatError('---'), 'Enter a code using letters and numbers.');
  assert.equal(referralCodeFormatError('ab'), 'Codes must be at least 4 characters.');
  assert.equal(
    referralCodeFormatError('A'.repeat(21)),
    'Codes can be at most 20 characters.',
  );
});

/* ------------------------------------------------------------------ */
/* suggestReferralCode                                                */
/* ------------------------------------------------------------------ */

test('the suggestion is the house prefix, the surname, and the discount', () => {
  assert.equal(suggestReferralCode('John', 'Smith'), 'AMCSMITH10');
  // No surname falls back to the first name.
  assert.equal(suggestReferralCode('John', ''), 'AMCJOHN10');
  assert.equal(suggestReferralCode('John', null), 'AMCJOHN10');
  // Neither yields letters or digits: the caller rolls a random code instead.
  assert.equal(suggestReferralCode('', ''), null);
  assert.equal(suggestReferralCode('—', '!!'), null);
});

test('a long surname is sliced so the suggestion still fits the column', () => {
  const code = suggestReferralCode('Anna', 'Vandenbergheveldhuizen');
  assert.equal(code, 'AMCVANDENBERGHEVEL10');
  assert.equal(code!.length, REFERRAL_CODE_MAX_LENGTH);
  assert.ok(isValidReferralCodeFormat(code!));
});

/* ------------------------------------------------------------------ */
/* suggestReferralCodeVariants — the collision ladder                 */
/* ------------------------------------------------------------------ */

test('the collision ladder is primary, then the initial, then digits', () => {
  const variants = suggestReferralCodeVariants('John', 'Smith');

  assert.equal(variants[0], 'AMCSMITH10');
  assert.equal(variants[1], 'AMCJSMITH10');
  assert.deepEqual(variants.slice(2), [
    'AMCSMITH102',
    'AMCSMITH103',
    'AMCSMITH104',
    'AMCSMITH105',
    'AMCSMITH106',
    'AMCSMITH107',
    'AMCSMITH108',
    'AMCSMITH109',
  ]);

  // Every rung has to be a code the column and the format will accept.
  for (const v of variants) assert.ok(isValidReferralCodeFormat(v), v);
  assert.equal(new Set(variants).size, variants.length);
});

test('the ladder is empty when there is no name to work from', () => {
  assert.deepEqual(suggestReferralCodeVariants('', ''), []);
});

/* ------------------------------------------------------------------ */
/* generateReferralCode — the fallback                                */
/* ------------------------------------------------------------------ */

test('a random code passes the same format contract, without lookalikes', () => {
  for (let i = 0; i < 200; i++) {
    const code = generateReferralCode();
    assert.equal(code.length, 8);
    assert.ok(isValidReferralCodeFormat(code), code);
    // I/1 and O/0 are excluded so a code can be read down a phone line.
    assert.equal(/[I1O0]/.test(code), false, code);
  }
});
