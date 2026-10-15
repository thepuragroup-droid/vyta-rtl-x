/**
 * Unit tests for the welcome flow's pure parts: when an email goes out, what it
 * says, and the signed links it carries.
 *
 * These are the rules that go wrong in front of a customer — an email at 3 AM,
 * two emails in one morning, "20% OFF" on a 10% code, an unsubscribe link
 * anybody could forge — so they are pinned here rather than found in an inbox.
 *
 *   npx tsx --test lib/welcome-flow/welcome-flow.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countdown,
  decide,
  formatDeadline,
  inSendWindow,
  nextStep,
  nextWindowOpening,
  timezoneFor,
  type TimingInput,
} from './schedule';
import { absoluteUrl, mergeTagProblems, mergeTags, renderWelcomeEmail, withUtm, type RenderContext } from './render';
import { defaultStep, DEFAULT_STEPS, isSafeLink, normalizeCode, shapeSettingsInput, shapeStepInput, shapeStepRow } from './types';
import { clickUrl, idToken, readClick, readIdToken } from './tokens';

process.env.WELCOME_FLOW_SECRET = 'test-secret';

const SITE = 'https://www.vytabio.com';

// ---------------------------------------------------------------------------
// Time zones and the send window
// ---------------------------------------------------------------------------

test('timezoneFor: reads a province, a state, and "CA" by country', () => {
  assert.equal(timezoneFor('BC', 'CA', 'America/Toronto'), 'America/Vancouver');
  assert.equal(timezoneFor('Alberta', 'Canada', 'America/Toronto'), 'America/Edmonton');
  assert.equal(timezoneFor('CA', 'US', 'America/Toronto'), 'America/Los_Angeles');
  assert.equal(timezoneFor('TX', 'US', 'America/Toronto'), 'America/Chicago');
  // No country: a province wins, a US-only code still resolves.
  assert.equal(timezoneFor('NS', null, 'America/Toronto'), 'America/Halifax');
  assert.equal(timezoneFor('WA', '', 'America/Toronto'), 'America/Los_Angeles');
  assert.equal(timezoneFor('', 'CA', 'America/Toronto'), 'America/Toronto');
  assert.equal(timezoneFor('ZZ', 'CA', 'America/Regina'), 'America/Regina');
});

test('inSendWindow: local hours, end exclusive, and a window across midnight', () => {
  // 13:30 UTC on Oct 20 2026 = 9:30 in Toronto (EDT), 6:30 in Vancouver (PDT).
  const at = new Date('2026-10-20T13:30:00Z');
  assert.equal(inSendWindow(at, 'America/Toronto', 9, 11), true);
  assert.equal(inSendWindow(at, 'America/Vancouver', 9, 11), false);
  assert.equal(inSendWindow(new Date('2026-10-20T15:00:00Z'), 'America/Toronto', 9, 11), false); // 11:00
  assert.equal(inSendWindow(new Date('2026-10-21T03:00:00Z'), 'America/Toronto', 22, 2), true); // 23:00
});

test('nextWindowOpening: the next local 9 AM, Newfoundland\'s half hour included', () => {
  const from = new Date('2026-10-20T13:30:00Z');
  assert.equal(nextWindowOpening(from, 'America/Vancouver', 9, 11).toISOString(), '2026-10-20T16:00:00.000Z');
  // Already inside: unchanged.
  assert.equal(nextWindowOpening(from, 'America/Toronto', 9, 11).toISOString(), from.toISOString());
  // 9:00 NDT = 11:30 UTC.
  assert.equal(nextWindowOpening(new Date('2026-10-20T15:00:00Z'), 'America/St_Johns', 9, 11).toISOString(), '2026-10-21T11:30:00.000Z');
});

// ---------------------------------------------------------------------------
// Which email, and when
// ---------------------------------------------------------------------------

test('nextStep: in order, past sent / skipped / in-flight / given-up steps', () => {
  assert.equal(nextStep([]), 1);
  assert.equal(nextStep([{ step: 1, status: 'sent', attempts: 1 }]), 2);
  assert.equal(nextStep([{ step: 1, status: 'sending', attempts: 1 }]), 2);
  assert.equal(nextStep([{ step: 1, status: 'failed', attempts: 1 }]), 1, 'a failure is retried');
  assert.equal(nextStep([{ step: 1, status: 'failed', attempts: 3 }, { step: 2, status: 'skipped', attempts: 0 }]), 3);
  assert.equal(nextStep([1, 2, 3, 4, 5].map((step) => ({ step, status: 'sent' as const, attempts: 1 }))), null);
});

const timing = (over: Partial<TimingInput>): TimingInput => ({
  step: 2,
  delayDays: 2,
  enrolledAt: new Date('2026-10-18T20:00:00Z'),
  lastSentAt: new Date('2026-10-18T20:00:00Z'),
  timezone: 'America/Toronto',
  windowStart: 9,
  windowEnd: 11,
  minGapHours: 20,
  ...over,
});

test('decide: email 1 ignores the window; later emails wait for it', () => {
  const night = new Date('2026-10-18T07:00:00Z'); // 3 AM Toronto
  const e1 = decide(timing({ step: 1, delayDays: 0, enrolledAt: night, lastSentAt: null }), night);
  assert.deepEqual(e1, { send: true });

  // Due on Oct 20 20:00Z (4 PM) — outside the window, so 9 AM the next day.
  const r = decide(timing({}), new Date('2026-10-20T20:30:00Z'));
  assert.equal(r.send, false);
  assert.equal(!r.send && r.reason, 'outside_window');
  assert.equal(!r.send && r.at.toISOString(), '2026-10-21T13:00:00.000Z');

  assert.deepEqual(decide(timing({}), new Date('2026-10-21T13:15:00Z')), { send: true });
});

test('decide: not due yet reports the window opening after the due date', () => {
  const r = decide(timing({}), new Date('2026-10-19T14:00:00Z'));
  assert.equal(!r.send && r.reason, 'not_due');
  assert.equal(!r.send && r.at.toISOString(), '2026-10-21T13:00:00.000Z');
});

test('decide: the minimum gap holds back a backlog', () => {
  // Email 3 is long overdue, but email 2 went out an hour ago.
  const now = new Date('2026-10-30T13:30:00Z');
  const r = decide(timing({ step: 3, delayDays: 4, lastSentAt: new Date('2026-10-30T12:30:00Z') }), now);
  assert.equal(r.send, false);
});

test('countdown and formatDeadline', () => {
  assert.deepEqual(countdown(new Date('2026-10-20T00:00:00Z'), new Date('2026-10-21T00:00:00Z')), { days: 1, hours: 0, minutes: 0 });
  assert.deepEqual(countdown(new Date('2026-10-20T00:00:30Z'), new Date('2026-10-21T00:00:00Z')), { days: 0, hours: 23, minutes: 59 });
  assert.deepEqual(countdown(new Date('2026-10-22T00:00:00Z'), new Date('2026-10-21T00:00:00Z')), { days: 0, hours: 0, minutes: 0 });
  assert.equal(formatDeadline(new Date('2026-10-21T14:15:00Z'), 'America/Toronto'), 'Wed, Oct 21 at 10:15 AM EDT');
});

// ---------------------------------------------------------------------------
// Merge tags and rendering
// ---------------------------------------------------------------------------

const ctx = (over: Partial<RenderContext> = {}): RenderContext => ({
  firstName: 'Sam',
  offer: { code: 'VYTA20', label: '20%' },
  offerEndsAt: null,
  now: new Date('2026-10-20T14:00:00Z'),
  timezone: 'America/Toronto',
  settings: { footer_address: '123 Example St, Toronto ON', footer_disclaimer: 'Research use only.' },
  siteUrl: SITE,
  unsubscribeUrl: `${SITE}/api/welcome-flow/unsubscribe?t=x`,
  ...over,
});

test('mergeTags: name, code, discount — and no ", there" when the name is missing', () => {
  assert.equal(mergeTags('Welcome to VYTA, {{first_name}}', ctx()), 'Welcome to VYTA, Sam');
  assert.equal(mergeTags('Welcome to VYTA, {{first_name}}', ctx({ firstName: '  ' })), 'Welcome to VYTA');
  assert.equal(mergeTags('Still thinking about it, {{first_name}}?', ctx({ firstName: null })), 'Still thinking about it?');
  assert.equal(mergeTags('Hi {{first_name}}', ctx({ firstName: null })), 'Hi there');
  assert.equal(mergeTags('{{discount}} OFF with {{ code }}', ctx()), '20% OFF with VYTA20');
  assert.equal(mergeTags('{{unknown}}', ctx()), '{{unknown}}');
});

test('mergeTagProblems: a code-dependent email with no code is flagged', () => {
  const offer = { ...defaultStep(4), promo_code: null };
  assert.equal(mergeTagProblems(offer).length, 1);
  assert.deepEqual(mergeTagProblems(defaultStep(4)), []);
  assert.match(mergeTagProblems({ ...defaultStep(2), body: '{{nope}}' })[0], /Unknown merge tag/);
});

test('every default email renders, with the offer stated from the code', () => {
  for (const step of DEFAULT_STEPS) {
    const out = renderWelcomeEmail(step, ctx({ offerEndsAt: new Date('2026-10-21T14:00:00Z') }));
    assert.ok(out.subject.length > 0, `email ${step.step} subject`);
    assert.ok(out.html.includes('role="presentation"'));
    assert.ok(!out.html.includes('{{'), `email ${step.step} has an unmerged tag`);
    assert.ok(out.html.includes('Unsubscribe'), `email ${step.step} has no unsubscribe link`);
    assert.ok(out.text.includes('Unsubscribe:'));
    assert.ok(out.html.includes('123 Example St'), 'CASL mailing address in the footer');
  }
  const offer = renderWelcomeEmail(defaultStep(4), ctx());
  assert.match(offer.html, /20% OFF/);
  assert.match(offer.html, /VYTA20/);
  assert.equal(offer.subject, '20% off your order — just for subscribers');
});

test('the reminder carries a per-recipient countdown and deadline', () => {
  const out = renderWelcomeEmail(defaultStep(5), ctx({ offerEndsAt: new Date('2026-10-21T14:00:00Z') }));
  assert.match(out.html, />01<\/p>[\s\S]*Days/);
  assert.match(out.html, /Offer ends Wed, Oct 21 at 10:00 AM EDT/);
  assert.match(out.text, /Offer ends Wed, Oct 21 at 10:00 AM EDT/);
});

test('links: site paths become absolute, UTM-tagged and tracked; javascript: never lands', () => {
  const tracked: string[] = [];
  const out = renderWelcomeEmail(
    { ...defaultStep(1), cta_url: '/products', card_link_label: 'Go', card_link_url: 'javascript:alert(1)' },
    ctx({ trackLink: (u) => (tracked.push(u), `${SITE}/t?u=${encodeURIComponent(u)}`) }),
  );
  assert.ok(tracked.some((u) => u.startsWith(`${SITE}/products?utm_source=welcome_flow`)));
  assert.ok(!out.html.includes('javascript:'));
  assert.equal(absoluteUrl('//evil.example', SITE), null);
  assert.equal(withUtm('https://other.example/x', SITE, 1), 'https://other.example/x');
});

test('user-typed copy is escaped', () => {
  const out = renderWelcomeEmail({ ...defaultStep(2), headline: '<script>x</script>' }, ctx());
  assert.ok(!out.html.includes('<script>x'));
  assert.ok(out.html.includes('&lt;script&gt;'));
});

test('the welcome card names the code once', () => {
  const none = renderWelcomeEmail({ ...defaultStep(1), promo_code: null }, ctx({ offer: null }));
  assert.ok(!none.html.includes('Code:'));
  // Default copy already says "Use code WELCOME10" — no second chip.
  const named = renderWelcomeEmail(defaultStep(1), ctx({ offer: { code: 'WELCOME10', label: '10%' } }));
  assert.ok(!named.html.includes('Code:'));
  assert.match(named.html, /Use code WELCOME10/);
  // Copy that doesn't name it gets the chip.
  const chip = renderWelcomeEmail({ ...defaultStep(1), card_body: 'At checkout.' }, ctx({ offer: { code: 'WELCOME10', label: '10%' } }));
  assert.ok(chip.html.includes('Code:'));
});

// ---------------------------------------------------------------------------
// Input shaping
// ---------------------------------------------------------------------------

test('shapeSettingsInput: rejects a bad zone, an empty window, out-of-range hours', () => {
  const base = { send_window_start: 9, send_window_end: 11, default_timezone: 'America/Toronto', final_offer_hours: 24, min_gap_hours: 20 };
  assert.equal(shapeSettingsInput(base).ok, true);
  assert.equal(shapeSettingsInput({ ...base, default_timezone: 'Mars/Base' }).ok, false);
  assert.equal(shapeSettingsInput({ ...base, send_window_end: 9 }).ok, false);
  assert.equal(shapeSettingsInput({ ...base, final_offer_hours: 0 }).ok, false);
  assert.equal(shapeSettingsInput({ ...base, send_window_start: 9.5 }).ok, false);
});

test('shapeStepInput: needs a subject, safe links, normalises the code and highlights', () => {
  const ok = shapeStepInput(1, { ...defaultStep(1), promo_code: ' welcome-10 ', highlights: 'A\n\nB\n' });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.promo_code, 'WELCOME10');
    assert.deepEqual(ok.value.highlights, ['A', 'B']);
  }
  assert.equal(shapeStepInput(1, { ...defaultStep(1), subject: ' ' }).ok, false);
  assert.equal(shapeStepInput(1, { ...defaultStep(1), cta_url: 'javascript:alert(1)' }).ok, false);
  assert.equal(shapeStepInput(1, { ...defaultStep(1), delay_days: -1 }).ok, false);
  assert.equal(isSafeLink('/lab-results'), true);
  assert.equal(isSafeLink('//evil.example'), false);
  assert.equal(normalizeCode('vyta 20'), 'VYTA20');
});

test('shapeStepRow: fills gaps from the defaults but keeps a cleared code cleared', () => {
  const row = shapeStepRow({ step: 4, promo_code: null, subject: 'Hi' });
  assert.equal(row.subject, 'Hi');
  assert.equal(row.promo_code, null);
  assert.equal(row.headline, defaultStep(4).headline);
});

// ---------------------------------------------------------------------------
// Signed links
// ---------------------------------------------------------------------------

test('tokens: round-trip, and a tampered id or destination is refused', () => {
  const id = '3f1c2a3b-1111-4222-8333-944455556666';
  const other = '3f1c2a3b-1111-4222-8333-944455556667';
  assert.equal(readIdToken('unsub', idToken('unsub', id)), id);
  assert.equal(readIdToken('unsub', `${other}.${idToken('unsub', id).split('.')[1]}`), null);
  assert.equal(readIdToken('open', idToken('unsub', id)), null, 'purposes do not cross');

  const url = new URL(clickUrl(SITE, id, `${SITE}/products`));
  assert.deepEqual(readClick(url.searchParams), { sendId: id, target: `${SITE}/products` });
  url.searchParams.set('u', 'https://evil.example/');
  assert.equal(readClick(url.searchParams), null);
});
