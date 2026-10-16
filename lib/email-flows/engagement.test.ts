/**
 * Tests for post-send tracking: person-or-machine, where clicks go, the click
 * cookie, reading a flow off an order, and crediting a conversion.
 *
 *   npx tsx --test lib/email-flows/engagement.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.EMAIL_FLOWS_SECRET = 'test-secret-for-engagement';

import {
  classifyHit,
  countsTowardSendStats,
  creditConversion,
  emailFlowTouchOf,
  flowClickPayload,
  flowFromUtm,
  linkKindOf,
  targetPathOf,
} from './engagement';
import { flowClickCookieValue, readFlowClickCookie, FLOW_CLICK_MAX_AGE } from './tokens';
import { withUtm } from './render';
import { parseTouch } from '@/lib/analytics/attribution';

const SITE = 'https://vytabio.com';
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const SEND = '11111111-2222-4333-8444-555555555555';

test('classifyHit: a browser click well after sending is a person', () => {
  const hit = classifyHit({ kind: 'click', userAgent: CHROME, sentAt: '2026-10-16T10:00:00Z', now: new Date('2026-10-16T12:00:00Z') });
  assert.deepEqual(hit, { machine: false, reason: null });
  assert.equal(countsTowardSendStats('click', hit), true);
});

test('classifyHit: scanners, link checkers and instant clicks are machines and do not count as clicks', () => {
  const now = new Date('2026-10-16T10:00:01Z');
  const cases = [
    classifyHit({ kind: 'click', method: 'HEAD', userAgent: CHROME }),
    classifyHit({ kind: 'click', userAgent: '' }),
    classifyHit({ kind: 'click', userAgent: 'Mozilla/5.0 (compatible; Barracuda Sentinel)' }),
    classifyHit({ kind: 'click', userAgent: 'python-requests/2.31' }),
    classifyHit({ kind: 'click', userAgent: CHROME, sentAt: '2026-10-16T10:00:00Z', now }),
  ];
  assert.deepEqual(cases.map((c) => c.reason), ['head_request', 'no_user_agent', 'scanner', 'scanner', 'too_fast']);
  for (const c of cases) {
    assert.equal(c.machine, true);
    assert.equal(countsTowardSendStats('click', c), false);
  }
});

test('classifyHit: Apple privacy prefetch is flagged but still counts as an open; Gmail’s proxy is a person', () => {
  const apple = classifyHit({ kind: 'open', userAgent: 'Mozilla/5.0' });
  assert.equal(apple.reason, 'privacy_proxy');
  assert.equal(countsTowardSendStats('open', apple), true);

  const gmail = classifyHit({ kind: 'open', userAgent: 'Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)' });
  assert.equal(gmail.machine, false);

  const scanner = classifyHit({ kind: 'open', userAgent: 'Mimecast URL Protect' });
  assert.equal(countsTowardSendStats('open', scanner), false);
});

test('targetPathOf drops the query (a cart link carries its restore token); linkKindOf names the page', () => {
  assert.equal(targetPathOf(`${SITE}/cart?restore=secret-token&utm_source=cart_flow`), '/cart');
  assert.equal(linkKindOf('/cart'), 'cart');
  assert.equal(linkKindOf('/products/bpc-157'), 'product');
  assert.equal(linkKindOf('/products'), 'shop');
  assert.equal(linkKindOf('/lab-results'), 'lab_results');
  assert.equal(linkKindOf('/'), 'home');
  assert.equal(linkKindOf('/about'), 'other');
});

test('flowFromUtm reads exactly what withUtm writes, and the storefront classifies it as email', () => {
  const tagged = new URL(withUtm(`${SITE}/cart`, SITE, 3, 'cart'));
  assert.deepEqual(
    flowFromUtm(tagged.searchParams.get('utm_source'), tagged.searchParams.get('utm_medium'), tagged.searchParams.get('utm_campaign')),
    { flow: 'cart', step: 3 },
  );
  const touch = parseTouch({ url: tagged, referrer: null, selfHost: 'vytabio.com' });
  assert.equal(touch.channel, 'email');
  assert.deepEqual(flowFromUtm(touch.source, touch.medium, touch.campaign), { flow: 'cart', step: 3 });

  assert.equal(flowFromUtm('newsletter', 'email', 'oct'), null, 'other email is not a flow');
  assert.equal(flowFromUtm('welcome_flow', 'cpc', 'welcome_1'), null, 'only medium=email');
});

test('click cookie: round-trips, rejects tampering, and expires with the attribution window', () => {
  const at = '2026-10-16T12:00:00.000Z';
  const value = flowClickCookieValue({ sendId: SEND, flow: 'welcome', step: 2, at });
  const now = new Date('2026-10-17T12:00:00Z');
  assert.deepEqual(readFlowClickCookie(value, now), { sendId: SEND, flow: 'welcome', step: 2, at });

  assert.equal(readFlowClickCookie(value.replace('.welcome.2.', '.welcome.5.'), now), null, 'step edited');
  assert.equal(readFlowClickCookie(value.replace('.welcome.', '.cart.'), now), null, 'flow edited');
  assert.equal(readFlowClickCookie('garbage', now), null);
  const late = new Date(Date.parse(at) + (FLOW_CLICK_MAX_AGE + 60) * 1000);
  assert.equal(readFlowClickCookie(value, late), null);
});

test('emailFlowTouchOf: the click cookie beats UTM tags; UTM on the last touch beats the first', () => {
  const click = { sendId: SEND, flow: 'cart' as const, step: 4 as const, at: '2026-10-16T12:00:00Z' };
  const fromClick = emailFlowTouchOf({
    first: { source: 'google', medium: 'cpc', campaign: 'brand' },
    last: { source: 'welcome_flow', medium: 'email', campaign: 'welcome_2' },
    email_flow: flowClickPayload(click),
  });
  assert.equal(fromClick?.evidence, 'click');
  assert.equal(fromClick?.flow, 'cart');
  assert.equal(fromClick?.step, 4);
  assert.equal(fromClick?.sendId, SEND);

  const fromUtm = emailFlowTouchOf({
    first: { source: 'google', medium: 'cpc' },
    last: { source: 'welcome_flow', medium: 'email', campaign: 'welcome_2' },
  });
  assert.deepEqual([fromUtm?.evidence, fromUtm?.flow, fromUtm?.step], ['utm', 'welcome', 2]);

  assert.equal(emailFlowTouchOf({ first: { source: 'google', medium: 'cpc' }, last: null }), null);
  assert.equal(emailFlowTouchOf(null), null);
});

test('creditConversion: the clicked email gets the credit, not just the last one sent', () => {
  const sends = [
    { id: 'a', step: 1, sent_at: '2026-10-01T10:00:00Z', clicked_at: null },
    { id: 'b', step: 2, sent_at: '2026-10-03T10:00:00Z', clicked_at: '2026-10-03T11:00:00Z' },
    { id: 'c', step: 3, sent_at: '2026-10-05T10:00:00Z', clicked_at: null },
  ];
  assert.deepEqual(creditConversion(sends, '2026-10-06T10:00:00Z', null), { via: 'click', step: 2, sendId: 'b' });

  // The checkout's own click wins over any other.
  assert.deepEqual(creditConversion(sends, '2026-10-06T10:00:00Z', { sendId: 'c' }), { via: 'click', step: 3, sendId: 'c' });

  // A click after the purchase proves nothing about it.
  const noClick = sends.map((s) => ({ ...s, clicked_at: s.id === 'b' ? '2026-10-07T00:00:00Z' : null }));
  assert.deepEqual(creditConversion(noClick, '2026-10-06T10:00:00Z', null), { via: 'email_match', step: 3, sendId: 'c' });

  // Checkout came from the flow but the send is unknown: still a click-through.
  assert.equal(creditConversion(noClick, '2026-10-06T10:00:00Z', { sendId: null }).via, 'click');

  // Bought before any email went.
  assert.deepEqual(creditConversion(sends, '2026-09-30T00:00:00Z', null), { via: 'email_match', step: null, sendId: null });
});
