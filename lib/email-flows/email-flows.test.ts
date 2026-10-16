/**
 * Unit tests for the email flows' pure parts — welcome and cart abandonment:
 * when an email goes out, what it says, the cart it shows, and the signed
 * links it carries.
 *
 * These are the rules that go wrong in front of a customer — an email at 3 AM,
 * two emails in one morning, "20% OFF" on a 10% code, an unsubscribe link
 * anybody could forge — so they are pinned here rather than found in an inbox.
 *
 *   npx tsx --test lib/email-flows/email-flows.test.ts
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
import { absoluteUrl, mergeTagProblems, mergeTags, renderFlowEmail, withUtm, type RenderContext } from './render';
import { ALL_TEST_EMAILS, TEST_LIMITS, parseEmailRefs, parseRecipients, shapeTestSendInput, testSubject } from './test-send';
import { ICONS, delayLabel, iconForLabel, isSafeLink, normalizeCode, normalizeHighlights, requiresCode, shapeSettingsInput, shapeStepInput, stepsMissingCode } from './types';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_STEPS, defaultStep as dflt, shapeStepRow as shapeRow } from './defaults';
import { cartLineViews, cartSignature, linesFromCheckout, restoreCartLines, restoreUrls, sanitizeCartLines } from './carts';
import { clickUrl, idToken, readClick, readIdToken } from './tokens';

process.env.EMAIL_FLOWS_SECRET = 'test-secret';

// The welcome-flow cases below predate the cart flow; these keep them short.
const defaultStep = (n: 1 | 2 | 3 | 4 | 5) => dflt('welcome', n);
const shapeStepRow = (row: any) => shapeRow('welcome', row);
const renderWelcomeEmail = renderFlowEmail;

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
  delayHours: 48,
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
  const e1 = decide(timing({ step: 1, delayHours: 0, enrolledAt: night, lastSentAt: null }), night);
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
  const r = decide(timing({ step: 3, delayHours: 96, lastSentAt: new Date('2026-10-30T12:30:00Z') }), now);
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
  unsubscribeUrl: `${SITE}/api/email-flows/unsubscribe?t=x`,
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
  assert.match(mergeTagProblems({ ...defaultStep(2), body: '{{nope}}' })[0], /Unknown merge tag/);
  // {{offer_ends}} needs a deadline; cart links only exist in the cart flow.
  assert.match(mergeTagProblems({ ...defaultStep(2), body: 'Ends {{offer_ends}}' })[0], /deadline/);
  assert.match(mergeTagProblems({ ...defaultStep(2), cta_url: '{{cart_url}}' })[0], /cart abandonment flow/);
});

test('every default email of both flows is clean, except the code nobody has chosen yet', () => {
  for (const flow of ['welcome', 'cart'] as const) {
    for (const step of DEFAULT_STEPS[flow]) {
      const problems = mergeTagProblems(step);
      if (requiresCode(flow, step.step)) {
        assert.equal(problems.length, 1, `${flow} email ${step.step}`);
        assert.match(problems[0], /Choose the discount code/);
        assert.deepEqual(mergeTagProblems({ ...step, promo_code: 'VYTA20' }), [], `${flow} email ${step.step} with a code`);
      } else {
        assert.deepEqual(problems, [], `${flow} email ${step.step}`);
      }
    }
  }
});

test('no discount code is ever pre-filled; offer emails must be given one', () => {
  for (const flow of ['welcome', 'cart'] as const) {
    for (const step of DEFAULT_STEPS[flow]) assert.equal(step.promo_code, null, `${flow} email ${step.step}`);
  }
  assert.deepEqual(stepsMissingCode(DEFAULT_STEPS.welcome), [1, 4, 5]);
  assert.deepEqual(stepsMissingCode(DEFAULT_STEPS.cart), [3]);
  // A switched-off offer email needs nothing.
  assert.deepEqual(stepsMissingCode([{ ...dflt('cart', 3), enabled: false }]), []);

  const offer = dflt('welcome', 4);
  const refused = shapeStepInput('welcome', 4, { ...offer });
  assert.equal(refused.ok, false);
  assert.match(!refused.ok ? refused.error : '', /Choose the discount code/);
  assert.equal(shapeStepInput('welcome', 4, { ...offer, promo_code: 'vyta20' }).ok, true);
  assert.equal(shapeStepInput('welcome', 4, { ...offer, enabled: false }).ok, true);
  // The preview still renders a draft that has no code yet.
  assert.equal(shapeStepInput('welcome', 4, { ...offer }, { requireCode: false }).ok, true);
  // Emails that aren't offers don't need one.
  assert.equal(shapeStepInput('welcome', 2, { ...dflt('welcome', 2) }).ok, true);
});

test('every default email renders, with the offer stated from the code', () => {
  for (const step of DEFAULT_STEPS.welcome) {
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
  assert.match(named.html, /Use code <strong[^>]*>WELCOME10<\/strong>/);
  // Copy that doesn't name it gets the chip.
  const chip = renderWelcomeEmail({ ...defaultStep(1), card_body: 'At checkout.' }, ctx({ offer: { code: 'WELCOME10', label: '10%' } }));
  assert.ok(chip.html.includes('Code:'));
});

// ---------------------------------------------------------------------------
// Input shaping
// ---------------------------------------------------------------------------

test('shapeSettingsInput: rejects a bad zone, an empty window, out-of-range hours', () => {
  const base = { send_window_start: 9, send_window_end: 11, default_timezone: 'America/Toronto', min_gap_hours: 20, reentry_days: 30 };
  assert.equal(shapeSettingsInput(base).ok, true);
  assert.equal(shapeSettingsInput({ ...base, default_timezone: 'Mars/Base' }).ok, false);
  assert.equal(shapeSettingsInput({ ...base, send_window_end: 9 }).ok, false);
  assert.equal(shapeSettingsInput({ ...base, reentry_days: -1 }).ok, false);
  assert.equal(shapeSettingsInput({ ...base, send_window_start: 9.5 }).ok, false);
});

test('shapeStepInput: needs a subject, safe links, normalises the code and highlights', () => {
  const ok = shapeStepInput('welcome', 1, { ...defaultStep(1), promo_code: ' first-order-10 ', highlights: 'A\n\nB\n' });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.promo_code, 'FIRSTORDER10');
    assert.deepEqual(ok.value.highlights, [{ label: 'A', icon: 'check' }, { label: 'B', icon: 'check' }]);
  }
  assert.equal(shapeStepInput('welcome', 1, { ...defaultStep(1), subject: ' ' }).ok, false);
  assert.equal(shapeStepInput('welcome', 1, { ...defaultStep(1), cta_url: 'javascript:alert(1)' }).ok, false);
  assert.equal(shapeStepInput('welcome', 1, { ...defaultStep(1), delay_hours: -1 }).ok, false);
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

// ---------------------------------------------------------------------------
// Cart abandonment
// ---------------------------------------------------------------------------

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const product = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: id === P1 ? 'BPC-157' : 'TB-500',
  price: 300,
  vial_price: 40,
  vials_per_box: 10,
  pack_sizes: [1, 3, 10],
  stock_quantity: 30,
  strength: '10mg',
  image_url: `/img/${id}.png`,
  active: true,
  ...over,
});

test('sanitizeCartLines: keeps clean lines, merges duplicates, drops junk', () => {
  const lines = sanitizeCartLines([
    { productId: P1, packSize: 3, quantity: 1 },
    { productId: P1.toUpperCase(), packSize: 3, quantity: 2 },
    { productId: 'not-a-uuid', packSize: 1, quantity: 1 },
    { productId: P2, packSize: 0, quantity: 1 },
    { productId: P2, packSize: 1, quantity: 0 },
    { productId: P2, packSize: 1, quantity: 5000 },
    null,
  ]);
  assert.deepEqual(lines, [
    { productId: P1, packSize: 3, quantity: 3 },
    { productId: P2, packSize: 1, quantity: 999 },
  ]);
  assert.deepEqual(sanitizeCartLines('nope'), []);
});

test('cartSignature: order does not matter, quantity does', () => {
  const a = [{ productId: P1, packSize: 1, quantity: 1 }, { productId: P2, packSize: 3, quantity: 2 }];
  assert.equal(cartSignature(a), cartSignature([...a].reverse()));
  assert.notEqual(cartSignature(a), cartSignature([{ ...a[0], quantity: 2 }, a[1]]));
});

test('restoreCartLines: today\'s price and stock; dropped when gone', () => {
  const { lines, dropped } = restoreCartLines(
    [
      { productId: P1, packSize: 3, quantity: 50 },
      { productId: P2, packSize: 1, quantity: 1 },
    ],
    [product(P1), product(P2, { active: false })],
  );
  assert.equal(dropped, 1);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].price, 120); // 3 × $40 vial price
  assert.equal(lines[0].quantity, 10); // 30 vials in stock ÷ 3 per pack
  assert.equal(lines[0].unit, 'case');
  // A pack size the product no longer sells is dropped, not guessed at.
  assert.equal(restoreCartLines([{ productId: P1, packSize: 7, quantity: 1 }], [product(P1)]).dropped, 1);
});

test('cartLineViews and linesFromCheckout', () => {
  const views = cartLineViews(
    linesFromCheckout([{ sku: 'X', product_id: P1, pack_size: 3, quantity: 2 }, { sku: 'Y' }]),
    [product(P1)],
  );
  assert.deepEqual(views, [{ productId: P1, name: 'BPC-157', packLabel: views[0].packLabel, quantity: 2, imageUrl: `/img/${P1}.png` }]);
  assert.ok(views[0].packLabel.length > 0);
});

test('restoreUrls: the checkout link carries the code; the cart link does not', () => {
  const u = restoreUrls(SITE, 'tok', 'VYTA20');
  assert.equal(u.cartUrl, `${SITE}/cart?restore=tok`);
  assert.equal(u.checkoutUrl, `${SITE}/cart?restore=tok&next=checkout&discount=VYTA20`);
  assert.equal(restoreUrls(SITE, 'tok', null).checkoutUrl, `${SITE}/cart?restore=tok&next=checkout`);
});

const cartCtx = (over: Partial<RenderContext> = {}) =>
  ctx({
    offer: null,
    cart: {
      lines: [{ productId: P1, name: 'BPC-157', packLabel: '3 vials', quantity: 2, imageUrl: '/img/p1.png' }],
      cartUrl: `${SITE}/cart?restore=tok`,
      checkoutUrl: `${SITE}/cart?restore=tok&next=checkout`,
    },
    ...over,
  });

test('every cart email renders: the cart, a restore link, no unmerged tags', () => {
  for (const step of DEFAULT_STEPS.cart) {
    const offer = step.promo_code ? { code: step.promo_code, label: '20%' } : null;
    const out = renderFlowEmail(step, cartCtx({ offer, offerEndsAt: step.deadline_hours ? new Date('2026-10-21T14:00:00Z') : null }));
    assert.ok(!out.html.includes('{{'), `cart email ${step.step} has an unmerged tag`);
    assert.ok(out.html.includes('restore=tok'), `cart email ${step.step} has no way back to the cart`);
    assert.ok(out.html.includes('left items in your cart'), 'cart footer explains why they got it');
    assert.ok(out.html.includes('utm_source=cart_flow'));
    if (step.show_cart) {
      assert.ok(out.html.includes('BPC-157'), `cart email ${step.step} should list the cart`);
      assert.match(out.text, /BPC-157 \(3 vials\) × 2/);
    }
  }
  const offer = renderFlowEmail(dflt('cart', 3), cartCtx({ offer: { code: 'VYTA20', label: '20%' }, offerEndsAt: new Date('2026-10-22T14:00:00Z') }));
  assert.match(offer.html, /20% OFF/);
  assert.match(offer.html, /next=checkout/);
  assert.match(offer.html, /Offer valid until Thu, Oct 22/);
  const last = renderFlowEmail(dflt('cart', 5), cartCtx({ offerEndsAt: new Date('2026-10-21T14:00:00Z') }));
  assert.match(last.html, /#C8102E/, 'last chance CTA is the urgent red');
  assert.match(last.html, /Days/);
});

test('cart merge tags resolve per recipient', () => {
  assert.equal(mergeTags('{{cart_url}}', cartCtx()), `${SITE}/cart?restore=tok`);
  assert.equal(mergeTags('{{checkout_url}}', ctx()), '');
  assert.equal(isSafeLink('{{cart_url}}'), true);
  assert.equal(isSafeLink('{{cart_url}}/x'), false);
});

test('delayLabel', () => {
  assert.equal(delayLabel(0, 'signup'), 'Immediately after signup');
  assert.equal(delayLabel(1, 'x'), '1 hour later');
  assert.equal(delayLabel(48, 'x'), '2 days later');
  assert.equal(delayLabel(30, 'x'), '30 hours later');
});

test('shapeStepInput: show_cart only sticks in the cart flow; deadline optional', () => {
  const w = shapeStepInput('welcome', 1, { ...defaultStep(1), show_cart: true });
  assert.equal(w.ok && w.value.show_cart, false);
  const c = shapeStepInput('cart', 1, { ...dflt('cart', 1), deadline_hours: '' });
  assert.equal(c.ok && c.value.show_cart, true);
  assert.equal(c.ok && c.value.deadline_hours, null);
  assert.equal(shapeStepInput('cart', 3, { ...dflt('cart', 3), deadline_hours: 0 }).ok, false);
});

// ---------------------------------------------------------------------------
// Brand header and icons — as in the designs
// ---------------------------------------------------------------------------

const PUBLIC = join(__dirname, '..', '..', 'public');

test('every icon the editor offers exists in both colours', () => {
  for (const key of Object.keys(ICONS)) {
    for (const tone of ['navy', 'white']) {
      assert.ok(existsSync(join(PUBLIC, 'images', 'email', 'icons', `${key}-${tone}.png`)), `${key}-${tone}.png`);
    }
  }
  assert.ok(existsSync(join(PUBLIC, 'images', 'email', 'vyta-lockup.png')));
  assert.ok(existsSync(join(PUBLIC, 'images', 'email', 'vyta-word-white.png')));
});

test('the default badges carry the icons from the designs', () => {
  const icons = (flow: 'welcome' | 'cart', n: 1 | 2 | 3 | 4 | 5) => dflt(flow, n).highlights.map((h) => h.icon);
  assert.deepEqual(icons('welcome', 1), ['shield-check', 'maple-leaf', 'shield-check', 'truck']);
  assert.deepEqual(icons('welcome', 2), ['heart-pulse', 'sun', 'hand-heart', 'sprout']);
  assert.deepEqual(icons('welcome', 3), ['shield-check', 'file-text', 'snowflake', 'leaf']);
  assert.deepEqual(icons('cart', 1), ['maple-leaf', 'shield-check', 'truck']);
  assert.deepEqual(icons('cart', 2), ['flask-conical', 'shield-check', 'leaf']);
  assert.deepEqual(icons('cart', 4), ['circle-help', 'truck', 'shield-check', 'credit-card']);
});

test('badges render their own icon — navy on light, white on the dark band', () => {
  const html = renderFlowEmail(defaultStep(1), ctx()).html;
  assert.match(html, /icons\/maple-leaf-navy\.png/);
  assert.match(html, /icons\/truck-navy\.png/);
  const reminder = renderFlowEmail(defaultStep(5), ctx({ offerEndsAt: new Date('2026-10-21T14:00:00Z') })).html;
  assert.match(reminder, /icons\/truck-white\.png/);
});

test('normalizeHighlights: objects kept, plain strings get an icon from their wording', () => {
  assert.deepEqual(normalizeHighlights([{ label: ' Canadian Owned ', icon: 'maple-leaf' }, 'Fast shipping', { label: 'x', icon: 'nope' }, '']), [
    { label: 'Canadian Owned', icon: 'maple-leaf' },
    { label: 'Fast shipping', icon: 'truck' },
    { label: 'x', icon: 'check' },
  ]);
  assert.equal(iconForLabel('Batch-Specific COA'), 'file-text');
  assert.equal(iconForLabel('Ordering & payments'), 'credit-card');
  assert.equal(iconForLabel('Something else'), 'check');
});

test('header: the lockup, and "View in browser" only when there is a page to view', () => {
  const withView = renderFlowEmail(defaultStep(2), ctx({ viewUrl: `${SITE}/api/email-flows/view?t=x` })).html;
  assert.match(withView, /vyta-lockup\.png/);
  assert.match(withView, /View in browser/);
  assert.ok(!renderFlowEmail(defaultStep(2), ctx()).html.includes('View in browser'));
});

test('welcome title: "VYTA" is set in the wordmark over the hero photo', () => {
  const html = renderFlowEmail(defaultStep(1), ctx()).html;
  // White, low on the darkened side of the photo, as designed.
  assert.match(html, /vyta-word-white\.png/);
  assert.match(html, />Welcome to</);
  assert.match(html, /background-image: url\('https:\/\/www\.vytabio\.com\/images\/email\/photos\/woman-lake-dark\.jpg'\)/);
  assert.match(html, /class="ef-cover ef-cover-wash"[^>]*valign="bottom"/);
  // Navy text sits high, on the sky.
  const dark = renderFlowEmail({ ...defaultStep(1), hero_text_tone: 'dark' }, ctx()).html;
  assert.match(dark, /vyta-word-navy\.png/);
  assert.match(dark, /class="ef-cover ef-cover-wash"[^>]*valign="top"/);
  // An edited title that doesn't end in VYTA is just text.
  const plain = renderFlowEmail({ ...defaultStep(1), headline: 'Hello there' }, ctx()).html;
  assert.ok(!plain.includes('vyta-word-white'));
  assert.match(plain, />Hello there</);
});

// ---------------------------------------------------------------------------
// The supplied covers, with the text over them
// ---------------------------------------------------------------------------

test('each photo goes where its mockup puts it, at the mockup proportions', () => {
  const at = (flow: 'welcome' | 'cart', n: 1 | 2 | 3 | 4 | 5) => {
    const s = dflt(flow, n);
    return [s.hero_image_url.replace('/images/email/photos/', ''), s.hero_overlay];
  };
  assert.deepEqual(at('welcome', 1), ['woman-lake-dark.jpg', true]);
  assert.deepEqual(at('welcome', 2), ['woman-portrait.jpg', true]);
  assert.deepEqual(at('welcome', 3), ['quality-vials.jpg', true]);
  assert.deepEqual(at('welcome', 4), ['offer-cover.jpg', true]);
  assert.deepEqual(at('welcome', 5), ['man-lake-sky.jpg', true]);
  // No placeholder art left in the welcome series.
  for (const step of DEFAULT_STEPS.welcome) {
    assert.ok(!/\/images\/email\/welcome\//.test(`${step.hero_image_url} ${step.card_image_url}`), `welcome ${step.step}`);
  }
  assert.deepEqual(at('cart', 1), ['cart-woman-lake.jpg', true]);
  assert.deepEqual(at('cart', 2), ['cart-woman-sun.jpg', true]);
  assert.deepEqual(at('cart', 3), ['cart-offer-cover.jpg', true]);
  assert.deepEqual(at('cart', 4), ['questions-cover.jpg', true]);
  assert.deepEqual(at('cart', 5), ['last-chance-cover.jpg', true]);
  assert.equal(dflt('cart', 1).card_image_url, '/images/email/photos/vial-rock.jpg');
  assert.equal(dflt('cart', 4).card_image_url, '/images/email/photos/support-agent-full.jpg');
  for (const flow of ['welcome', 'cart'] as const) {
    for (const step of DEFAULT_STEPS[flow]) {
      for (const url of [step.hero_image_url, step.card_image_url].filter(Boolean)) {
        assert.ok(existsSync(join(PUBLIC, url)), `${flow} ${step.step}: ${url}`);
      }
      // Nothing towers over the email the way the uncropped covers did.
      if (step.hero_image_ratio) assert.ok(step.hero_image_ratio <= 1.6, `${flow} ${step.step} ratio ${step.hero_image_ratio}`);
    }
  }
});

test('an overlay hero carries its text, keeps its shape, and works in Outlook and on phones', () => {
  const html = renderFlowEmail(dflt('cart', 1), cartCtx()).html;
  const cover = html.slice(html.indexOf('class="ef-cover'), html.indexOf('</v:rect>'));
  assert.match(cover, /cart-woman-lake\.jpg/);
  assert.match(cover, />Still thinking about it\?</);
  assert.match(cover, />Your cart is waiting\.</);
  assert.match(html, /height="408"/, '600 × 0.68');
  assert.match(html, /<v:fill type="frame" src="https:\/\/www\.vytabio\.com\/images\/email\/photos\/cart-woman-lake\.jpg"/);
  assert.match(html, /\.ef-cover, \.ef-cover-fill \{ height: calc\(\(100vw - 22px\) \* 0\.68\) !important; \}/);
  // Large type on desktop, set back on phones.
  assert.match(html, /class="ef-cr-h1" style="[^"]*font-size: 46px;/);
  assert.ok(html.includes('.ef-cr-h1 { font-size: 30px !important; max-width: 200px !important; }'));
  // Below the cover: the line, the cart (no button of its own), one wide
  // button, the badges, and the vials photo to close.
  const after = html.slice(html.indexOf('</v:rect>'));
  assert.ok(after.indexOf('Great choices!') < after.indexOf('BPC-157'));
  assert.ok(after.indexOf('BPC-157') < after.indexOf('Return to Cart'));
  assert.equal(after.split('Return to Cart').length - 1, 1, 'one Return to Cart button');
  assert.match(after, /class="ef-btn-wide"/);
  assert.ok(after.indexOf('Canadian Owned') < after.indexOf('vial-rock.jpg'));
});

test('cart 2: the education cover without a button, then the cart panel with it', () => {
  const html = renderFlowEmail(dflt('cart', 2), cartCtx()).html;
  const cover = coverOf(html);
  for (const text of ['Invest in a Healthier You', 'Research. Quality. Peace of Mind.', 'Third-Party Tested', 'Premium Sourcing']) assert.ok(cover.includes(text), text);
  assert.ok(!cover.includes('Return to Cart'), 'no button in the cover');
  const after = html.slice(html.indexOf('</v:rect>'));
  assert.ok(after.indexOf('Your cart is still waiting.') < after.indexOf('BPC-157'));
  assert.ok(after.indexOf('BPC-157') < after.indexOf('Return to Cart'));
  assert.ok(after.indexOf('Return to Cart') < after.indexOf('We Show Our Work'));
  assert.match(after, /class="ef-panel-title" style="[^"]*font-size: 26px;/);
  assert.match(after, /lab-vial\.jpg/);
  assert.ok(html.includes('.ef-panel-title { font-size: 19px !important; }'));
  // Bold benefits: heavy labels and the bold icon set in ink rings.
  assert.match(cover, /flask-conical-navy-bold\.png/);
  assert.match(cover, /class="ef-check-label"[^>]*font-weight: 800;/);
  // A short tagline column, so it breaks after "Quality."
  assert.match(cover, /width="230" class="ef-edu-subcol-short"/);
  assert.ok(html.includes('.ef-edu-subcol-short { width: 170px !important; }'));
  for (const step of DEFAULT_STEPS.welcome.concat(DEFAULT_STEPS.cart)) {
    for (const h of step.highlights) {
      assert.ok(existsSync(join(PUBLIC, `/images/email/icons/${h.icon}-navy-bold.png`)), `${h.icon} bold icon`);
    }
  }
});

test('cart 4: the help topics over the photo as written, then the cart and support panels', () => {
  const html = renderFlowEmail(dflt('cart', 4), cartCtx()).html;
  const cover = coverOf(html);
  for (const text of ['Have Questions?', 'We&#39;ve Got You Covered.', 'Product information', 'Ordering &amp; payments']) assert.ok(cover.includes(text), text);
  assert.match(cover, /class="ef-check-label"[^>]*font-size: 22px; font-weight: 600; letter-spacing: 0;/, 'sentence case, not small caps');
  assert.match(cover, /class="ef-q-h1" style="[^"]*font-size: 44px;/);
  // This email alone is narrower: 560px, the cover sized to match.
  assert.match(html, /<table role="presentation" width="560"[^>]*max-width: 560px; border-collapse: separate;/);
  assert.match(html, /style="width:560px;height:560px;"/);
  assert.match(renderFlowEmail(dflt('cart', 2), cartCtx()).html, /<table role="presentation" width="600"[^>]*max-width: 600px; border-collapse: separate;/, 'the others stay 600px');
  assert.ok(!/class="ef-check-label"[^>]*text-transform: uppercase/.test(cover));
  const after = html.slice(html.indexOf('</v:rect>'));
  assert.ok(after.indexOf('Your cart is still saved.') < after.indexOf('Return to Cart'));
  assert.ok(after.indexOf('Return to Cart') < after.indexOf('Real People. Real Support.'));
  // The support photo whole, inside the panel's padding, with rounded corners.
  assert.match(after, /<td class="ef-card-pic" width="46%" valign="middle" style="padding: 16px 0 16px 16px;"><img src="[^"]*support-agent-full\.jpg"[^>]*border-radius: 8px;/);
  assert.ok(html.includes('.ef-card-pic { width: 36% !important; }'));
});

test('cart 5: final reminder band, headline, countdown and red button over the sky', () => {
  const html = renderFlowEmail(dflt('cart', 5), cartCtx({ offerEndsAt: new Date('2026-10-21T14:00:00Z') })).html;
  assert.ok(html.indexOf('Final reminder') < html.indexOf('class="ef-cover'));
  const cover = coverOf(html);
  for (const text of ['Last Chance to Complete Your Order', 'Your cart will expire soon.', 'Minutes', 'Complete My Order']) assert.ok(cover.includes(text), text);
  assert.match(cover, /last-chance-cover\.jpg/);
  assert.match(cover, /class="ef-lc-h1" style="[^"]*font-size: 46px;/);
  assert.ok(cover.includes(`background: ${'#C8102E'}`), 'the red button');
  const after = html.slice(html.indexOf('</v:rect>'));
  assert.ok(after.includes('BPC-157'), 'the cart is listed');
  assert.ok(!after.includes('Complete My Order'), 'no second button');
  assert.ok(html.includes('.ef-lc-h1 { font-size: 30px !important; }'));
});

test('saved cart emails still on an old default image get the new one', () => {
  const one = shapeRow('cart', { step: 1, hero_image_url: '/images/email/photos/man-lake.jpg', hero_image_ratio: 1.3483, card_image_url: '/images/email/photos/man-lake-vial.jpg' });
  assert.equal(one.hero_image_url, '/images/email/photos/cart-woman-lake.jpg');
  assert.equal(one.hero_image_ratio, 0.68);
  assert.equal(one.card_image_url, '/images/email/photos/vial-rock.jpg');
  const five = shapeRow('cart', { step: 5, hero_image_url: '/images/email/photos/lab-vial.jpg', hero_overlay: false });
  assert.equal(five.hero_image_url, '/images/email/photos/last-chance-cover.jpg');
  assert.equal(five.hero_overlay, true);
});

/** The cover cell of an email: from its opening tag to the end of the VML box. */
const coverOf = (html: string) => html.slice(html.indexOf('class="ef-cover'), html.indexOf('</v:rect>'));

test('the text sits on the photo in welcome 2, 3 and 5, as designed', () => {
  // Welcome 2: headline, benefits and button all over the photo.
  const two = coverOf(renderFlowEmail(defaultStep(2), ctx()).html);
  for (const text of ['Modern Wellness Starts with Knowledge', 'Supports Recovery', 'Builds a Stronger Tomorrow', 'Explore the Collection']) {
    assert.ok(two.includes(text), text);
  }
  // The copy fills the photo so the button sits at its foot, centred and wide.
  const twoHtml = renderFlowEmail(defaultStep(2), ctx()).html;
  assert.match(twoHtml, /class="ef-cover-fill" style="height: 780px;"/);
  assert.match(twoHtml, /class="ef-btn-wide"/);
  assert.match(twoHtml, /\.ef-btn-wide \{ padding: 15px 30px !important; font-size: 12px !important; \}/, 'narrower on phones');
  // Desktop gets the design's large type; phones set it back.
  assert.match(twoHtml, /class="ef-edu-h1" style="[^"]*font-size: 46px;/);
  assert.match(twoHtml, /class="ef-edu-sub" style="[^"]*font-size: 21px;/);
  assert.match(twoHtml, /class="ef-check-label"[^>]*font-size: 17px;/);
  const phone = twoHtml.slice(twoHtml.indexOf('@media'), twoHtml.indexOf('</style>'));
  assert.match(phone, /\.ef-edu-h1 \{ font-size: 28px !important; max-width: 100% !important; \}/);
  // Phones give the copy the full width, with slimmer side margins.
  assert.match(twoHtml, /class="ef-edu-pad"/);
  assert.match(phone, /\.ef-edu-pad \{ padding: 28px 20px 24px !important; \}/);
  assert.match(phone, /\.ef-edu-subcol \{ width: 100% !important; \}/);
  // The benefits keep a short label column, with larger icons.
  assert.match(phone, /\.ef-check-label \{ font-size: 12px !important; width: 150px !important; \}/);
  assert.match(phone, /\.ef-check-ring \{ width: 48px !important; height: 48px !important;/);
  assert.match(twoHtml, /class="ef-check-ring"[^>]*width="70" height="70"/);
  assert.match(twoHtml, /class="ef-check-label" valign="middle" width="200"/);
  assert.match(phone, /\.ef-edu-sub \{ font-size: 15px !important; \}/);
  // Welcome 3: headline over the photo, the badges and body below it.
  const threeHtml = renderFlowEmail(defaultStep(3), ctx()).html;
  const three = coverOf(threeHtml);
  assert.ok(three.includes('Quality You Can Trust'));
  assert.ok(!three.includes('We partner with independent laboratories'));
  assert.ok(threeHtml.includes('We partner with independent laboratories'));
  // Large type on desktop, set back on phones.
  assert.match(threeHtml, /class="ef-trust-h1" style="[^"]*font-size: 48px;/);
  assert.match(threeHtml, /class="ef-trust-body" style="[^"]*font-size: 17px;/);
  assert.match(threeHtml, /class="ef-card-title" style="[^"]*font-size: 28px;/);
  const threePhone = threeHtml.slice(threeHtml.indexOf('@media'), threeHtml.indexOf('</style>'));
  for (const rule of ['.ef-trust-h1 { font-size: 32px !important; }', '.ef-trust-subcol { width: 190px !important; }', '.ef-card-title { font-size: 19px !important; }']) {
    assert.ok(threePhone.includes(rule), rule);
  }
  // Welcome 4: the offer and its code over the navy top of one dark cover.
  const fourHtml = renderFlowEmail(defaultStep(4), ctx()).html;
  const four = coverOf(fourHtml);
  for (const text of ['Exclusive for our subscribers', '20% OFF', 'Your Order Today', 'VYTA20']) assert.ok(four.includes(text), text);
  assert.match(fourHtml, /class="ef-offer-h1" style="[^"]*font-size: 76px;/);
  assert.match(fourHtml, /\.ef-offer-cover \{ height: calc\(\(100vw - 22px\) \* 1\.25 \+ 120px\) !important;/, 'taller on phones, photo whole at the foot');
  // Welcome 4's button sits below the badges.
  assert.ok(!four.includes('Shop Now'));
  // Cart 3 shares the cover and puts its button in it, under the code.
  const cart3 = renderFlowEmail(dflt('cart', 3), cartCtx({ offer: { code: 'VYTA20', label: '20%' }, offerEndsAt: new Date('2026-10-22T14:00:00Z') })).html;
  const cart3Cover = coverOf(cart3);
  assert.match(cart3Cover, /cart-offer-cover\.jpg/);
  assert.ok(cart3Cover.indexOf('VYTA20') < cart3Cover.indexOf('Complete My Order'));
  assert.ok(cart3Cover.includes(`background: ${'#1D4F80'}`), 'the brighter button on the dark cover');
  assert.equal(cart3.split('Complete My Order').length - 1, 1, 'one button');
  // Welcome 5: question, countdown and button over the sky.
  const five = coverOf(renderFlowEmail(defaultStep(5), ctx({ offerEndsAt: new Date('2026-10-21T14:00:00Z') })).html);
  for (const text of ['Still Thinking About It?', 'Minutes', 'Claim 20% Off']) assert.ok(five.includes(text), text);
  // Large type and countdown on desktop; on phones they step down and the
  // cover grows, with the photo whole at its foot.
  const fiveHtml = renderFlowEmail(defaultStep(5), ctx({ offerEndsAt: new Date('2026-10-21T14:00:00Z') })).html;
  assert.match(fiveHtml, /class="ef-rem-h1" style="[^"]*font-size: 42px;/);
  assert.match(fiveHtml, /class="ef-count-n" style="[^"]*font-size: 36px;/);
  const fivePhone = fiveHtml.slice(fiveHtml.indexOf('@media'), fiveHtml.indexOf('</style>'));
  assert.ok(fivePhone.includes('.ef-count-n { font-size: 26px !important; }'));
  assert.match(fivePhone, /\.ef-rem-cover \{ height: calc\(\(100vw - 22px\) \* 1\.5 \+ 130px\) !important;/);
});

test('on phones the photo under the copy is lightened; desktop is untouched', () => {
  const html = renderFlowEmail(defaultStep(2), ctx()).html;
  const media = html.slice(html.indexOf('@media'), html.indexOf('</style>'));
  assert.match(media, /\.ef-cover-wash \{ background-image: linear-gradient\(90deg[^)]*\)[^;]*url\('https:\/\/www\.vytabio\.com\/images\/email\/photos\/woman-portrait\.jpg'\)/);
  // White text gets a navy wash instead.
  const light = renderFlowEmail({ ...defaultStep(2), hero_text_tone: 'light' }, ctx()).html;
  assert.match(light, /\.ef-cover-wash \{ background-image: linear-gradient\(90deg, rgba\(5,24,43,/);
});

test('welcome 1 offer: the copy over the picture, the code in bold', () => {
  const html = renderFlowEmail(defaultStep(1), ctx({ offer: { code: 'WELCOME10', label: '10%' } })).html;
  const banner = html.slice(html.indexOf('class="ef-banner"'));
  assert.match(banner, /^class="ef-banner" background="https:\/\/www\.vytabio\.com\/images\/email\/photos\/offer-card\.jpg"/);
  assert.match(banner, /<v:fill type="frame" src="https:\/\/www\.vytabio\.com\/images\/email\/photos\/offer-card\.jpg"/);
  assert.match(banner, />Enjoy 10% Off Your First Order</);
  assert.match(banner, /Use code <strong[^>]*>WELCOME10<\/strong> at checkout\./);
  // Phones lighten the picture behind the copy.
  assert.match(html, /\.ef-banner \{ background-image: linear-gradient/);
  // Copy that doesn't name the code gets it on a line of its own.
  const noCode = renderFlowEmail({ ...defaultStep(1), card_body: 'Applies at checkout.' }, ctx({ offer: { code: 'WELCOME10', label: '10%' } })).html;
  assert.match(noCode, /Code: <strong[^>]*>WELCOME10<\/strong>/);
  // Without a picture it falls back to the side-by-side panel.
  const bare = renderFlowEmail({ ...defaultStep(1), card_image_url: '' }, ctx({ offer: { code: 'WELCOME10', label: '10%' } })).html;
  assert.ok(!bare.includes('ef-banner'));
  assert.match(bare, />Enjoy 10% Off Your First Order</);
});

test('switching the overlay off falls back to headline-then-photo', () => {
  const html = renderFlowEmail({ ...defaultStep(3), hero_overlay: false }, ctx()).html;
  assert.ok(!html.includes('ef-cover'));
  assert.match(html, /<img src="https:\/\/www\.vytabio\.com\/images\/email\/photos\/quality-vials\.jpg"/);
  // The reminder puts the question and countdown above the photo.
  const five = renderFlowEmail({ ...defaultStep(5), hero_overlay: false }, ctx({ offerEndsAt: new Date('2026-10-21T14:00:00Z') })).html;
  const photo = five.indexOf('man-lake-sky.jpg');
  assert.ok(five.indexOf('Still Thinking About It?') < photo);
  assert.ok(five.indexOf('Claim 20% Off') < photo);
});

test('saved welcome emails still on an old default image get the new one; uploads are kept', () => {
  // Seeded before this change: the old placeholder and the old crop.
  const one = shapeRow('welcome', { step: 1, hero_image_url: '/images/email/welcome/welcome-hero.png', hero_image_ratio: 0.6, hero_overlay: true, hero_text_tone: 'light', card_image_url: '/images/email/welcome/welcome-card.png', headline: 'Hi VYTA' });
  assert.equal(one.hero_image_url, '/images/email/photos/woman-lake-dark.jpg');
  assert.equal(one.hero_image_ratio, 0.8);
  assert.equal(one.hero_text_tone, 'light');
  assert.equal(one.card_image_url, '/images/email/photos/offer-card.jpg');
  assert.equal(one.headline, 'Hi VYTA', 'copy is left alone');
  const five = shapeRow('welcome', { step: 5, hero_image_url: '/images/email/photos/vials-mountains.jpg', hero_overlay: false });
  assert.equal(five.hero_image_url, '/images/email/photos/man-lake-sky.jpg');
  assert.equal(five.hero_overlay, true);
  // An admin's own upload stays, overlay setting and all.
  const mine = 'https://cdn.example.com/my-photo.jpg';
  const kept = shapeRow('welcome', { step: 2, hero_image_url: mine, hero_overlay: false, hero_image_ratio: 0.7 });
  assert.equal(kept.hero_image_url, mine);
  assert.equal(kept.hero_overlay, false);
  assert.equal(kept.hero_image_ratio, 0.7);
  // Cart 2 moves on from the lake photo, Cart 4 from the plain dropper photo.
  const cart2 = shapeRow('cart', { step: 2, hero_image_url: '/images/email/photos/woman-lake.jpg', card_image_url: '/images/email/cart/educate-card.png' });
  assert.equal(cart2.hero_image_url, '/images/email/photos/cart-woman-sun.jpg');
  assert.equal(cart2.card_image_url, '/images/email/photos/lab-vial.jpg');
  const cart4 = shapeRow('cart', { step: 4, hero_image_url: '/images/email/photos/dropper.jpg', hero_overlay: false });
  assert.equal(cart4.hero_image_url, '/images/email/photos/questions-cover.jpg');
  assert.equal(cart4.hero_overlay, true);
});

test('shapeStepInput keeps the overlay settings and a sane ratio', () => {
  const ok = shapeStepInput('welcome', 2, { ...defaultStep(2), hero_text_tone: 'light', hero_image_ratio: 2.5 });
  assert.equal(ok.ok && ok.value.hero_overlay, true);
  assert.equal(ok.ok && ok.value.hero_text_tone, 'light');
  assert.equal(ok.ok && ok.value.hero_image_ratio, 2.5);
  const odd = shapeStepInput('welcome', 2, { ...defaultStep(2), hero_text_tone: 'neon', hero_image_ratio: 99 });
  assert.equal(odd.ok && odd.value.hero_text_tone, 'dark');
  assert.equal(odd.ok && odd.value.hero_image_ratio, null);
});

// ---------------------------------------------------------------------------
// Test sends
// ---------------------------------------------------------------------------

test('test recipients: split on commas, semicolons and new lines, lowercased and deduplicated', () => {
  const r = parseRecipients('A@x.com, b@y.com;\nc@z.com a@X.com');
  assert.deepEqual(r.emails, ['a@x.com', 'b@y.com', 'c@z.com']);
  assert.deepEqual(r.invalid, []);
  assert.deepEqual(parseRecipients(['a@x.com', 'nope']).invalid, ['nope']);
});

test('test emails: all ten by default, a flow name means its five, flow:step picks one', () => {
  assert.equal(parseEmailRefs(undefined)?.length, 10);
  assert.deepEqual(parseEmailRefs('cart')?.map((r) => r.step), [1, 2, 3, 4, 5]);
  assert.deepEqual(parseEmailRefs('cart:3,welcome:1'), [{ flow: 'welcome', step: 1 }, { flow: 'cart', step: 3 }]);
  assert.deepEqual(parseEmailRefs([{ flow: 'welcome', step: 4 }]), [{ flow: 'welcome', step: 4 }]);
  assert.equal(parseEmailRefs('welcome:6'), null);
  assert.equal(parseEmailRefs('promo'), null);
});

test('a test request needs only addresses; everything else has a default', () => {
  const r = shapeTestSendInput({ recipients: 'qa@vyta.test' });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.value.recipients, ['qa@vyta.test']);
  assert.deepEqual(r.value.emails, ALL_TEST_EMAILS);
  assert.equal(r.value.firstName, 'Alex');
  assert.equal(r.value.code, null);
  assert.equal(r.value.timezone, null);
  assert.equal(r.value.cart, null);
  assert.equal(r.value.subjectTag, 'Test');
});

test('a test request takes the details it is given', () => {
  const r = shapeTestSendInput({
    to: ['a@x.com', 'b@y.com'],
    emails: 'cart:3',
    firstName: '  Sam ',
    code: ' vyta20 ',
    timezone: 'America/Vancouver',
    cart: [{ productId: '1b4e28ba-2fa1-11d2-883f-0016d3cca427', packSize: 3, quantity: 2 }],
    subjectTag: '',
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.value.recipients, ['a@x.com', 'b@y.com']);
  assert.equal(r.value.firstName, 'Sam');
  assert.equal(r.value.code, 'VYTA20');
  assert.equal(r.value.timezone, 'America/Vancouver');
  assert.equal(r.value.cart?.length, 1);
  assert.equal(r.value.subjectTag, '');
});

test('a test request refuses what it cannot send', () => {
  assert.equal(shapeTestSendInput({}).ok, false);
  assert.equal(shapeTestSendInput({ recipients: 'a@x.com, oops' }).ok, false);
  const many = Array.from({ length: TEST_LIMITS.recipients + 1 }, (_, i) => `q${i}@x.com`);
  assert.equal(shapeTestSendInput({ recipients: many }).ok, false);
  assert.equal(shapeTestSendInput({ recipients: 'a@x.com', emails: 'nope:1' }).ok, false);
  assert.equal(shapeTestSendInput({ recipients: 'a@x.com', timezone: 'Mars/Base' }).ok, false);
  assert.equal(shapeTestSendInput({ recipients: 'a@x.com', cart: [{ productId: 'not-a-uuid', packSize: 1, quantity: 1 }] }).ok, false);
});

test('test subjects say which email they are, unless the tag is cleared', () => {
  assert.equal(testSubject('Test', { flow: 'cart', step: 3 }, '20% off'), '[Test · Cart 3] 20% off');
  assert.equal(testSubject('', { flow: 'welcome', step: 1 }, 'Welcome'), 'Welcome');
  const r = shapeTestSendInput({ recipients: 'a@x.com', subjectTag: '[QA]\n' });
  assert.equal(r.ok && r.value.subjectTag, 'QA');
});
