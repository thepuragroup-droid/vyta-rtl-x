/**
 * Unit tests for reading the attribution cookies in the browser.
 *
 * The case that matters is the encoding: the touch cookies arrive DOUBLY
 * percent-encoded (encodeTouch encodes, NextResponse.cookies.set encodes
 * again), and `document.cookie` decodes nothing — so a reader that peels one
 * layer reports every ad visitor as organic. The literal below is a real
 * Set-Cookie value captured from the dev server.
 *
 * Run with a TS-aware loader, e.g.
 * `node --test --import tsx lib/analytics/attribution-client.test.ts`.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { encodeTouch, parseTouch } from './attribution';

/** Exactly what `middleware.ts` puts on the wire for ?utm_source=test&utm_medium=cpc. */
const DOUBLE_ENCODED =
  '%257B%2522c%2522%253A%2522other_paid%2522%252C%2522s%2522%253A%2522test%2522%252C' +
  '%2522m%2522%253A%2522cpc%2522%252C%2522n%2522%253A%2522sim%2522%252C%2522l%2522' +
  '%253A%2522%252F%2522%252C%2522a%2522%253A%25222026-09-11T15%253A49%253A33.766Z%2522%257D';

/**
 * `document.cookie` for a browserless test. Assigned before the module under
 * test is imported, because it reads `document` at call time only.
 */
function setCookies(value: string) {
  (globalThis as any).document = { cookie: value };
}

afterEach(() => {
  delete (globalThis as any).document;
});

async function client() {
  // Imported fresh each time so the module never caches a `document` snapshot.
  return import(`./attribution-client?t=${Math.random()}`);
}

test('a doubly-encoded cookie is read, not silently dropped', async () => {
  setCookies(`aminocan_vid=abc; aminocan_attr=${DOUBLE_ENCODED}`);
  const { readFirstTouch, isAdVisitor } = await client();
  assert.equal(readFirstTouch()?.channel, 'other_paid');
  assert.equal(readFirstTouch()?.campaign, 'sim');
  assert.equal(isAdVisitor(), true);
});

test('a singly-encoded cookie still reads, so the fix is not a new assumption', async () => {
  const touch = parseTouch({ url: 'https://x.test/?gclid=abc123' });
  setCookies(`aminocan_attr=${encodeTouch(touch)}`);
  const { readFirstTouch, isAdVisitor } = await client();
  assert.equal(readFirstTouch()?.channel, 'google_ads');
  assert.equal(isAdVisitor(), true);
});

test('last touch counts too — found the site organically, came back on an ad', async () => {
  const organic = parseTouch({ url: 'https://x.test/', referrer: 'https://www.google.com/' });
  setCookies(
    `aminocan_attr=${encodeTouch(organic)}; aminocan_attr_last=${DOUBLE_ENCODED}`,
  );
  const { readFirstTouch, readLastTouch, isAdVisitor, visitorChannels } = await client();
  assert.equal(readFirstTouch()?.channel, 'google_organic');
  assert.equal(readLastTouch()?.channel, 'other_paid');
  assert.equal(isAdVisitor(), true);
  assert.deepEqual(visitorChannels(), ['google_organic', 'other_paid']);
});

test('an organic visitor is not reported as an ad visitor', async () => {
  const organic = parseTouch({ url: 'https://x.test/', referrer: 'https://www.google.com/' });
  setCookies(`aminocan_attr=${encodeTouch(organic)}`);
  const { isAdVisitor } = await client();
  assert.equal(isAdVisitor(), false);
});

test('no cookies, junk cookies and bad escapes all read as no touch', async () => {
  for (const jar of ['', 'aminocan_attr=not-json', 'aminocan_attr=%E0%A4%A', 'other=1']) {
    setCookies(jar);
    const { readFirstTouch, isAdVisitor } = await client();
    assert.equal(readFirstTouch(), null, jar);
    assert.equal(isAdVisitor(), false, jar);
  }
});
