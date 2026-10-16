/**
 * Tests for the breakdown inside each earnings bucket, and the email-flow
 * report shown under Organic & referral.
 *
 *   npx tsx --test lib/analytics/earnings-breakdown.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  affiliateCodeOf,
  breakdownKeysOf,
  buildBreakdown,
  hasBreakdown,
  type BreakdownFact,
} from './earnings-breakdown';
import { buildEmailFlowReport } from './email-flow-report';

const fact = (over: Partial<BreakdownFact>): BreakdownFact => ({
  channel: null,
  campaign: null,
  referral_code: null,
  first_ref: null,
  first_source: null,
  first_medium: null,
  first_host: null,
  order_revenue: 0,
  hosted_revenue: 0,
  ...over,
});

test('only paid, affiliate and organic have a breakdown', () => {
  assert.deepEqual(
    (['paid', 'affiliate', 'organic', 'direct', 'unattributed'] as const).map(hasBreakdown),
    [true, true, true, false, false],
  );
  assert.deepEqual(buildBreakdown('direct', [fact({ channel: 'direct' })]), []);
});

test('paid ads split by platform, then by campaign, with shares of the bucket', () => {
  const rows = buildBreakdown('paid', [
    fact({ channel: 'google_ads', campaign: 'brand', order_revenue: 100 }),
    fact({ channel: 'google_ads', campaign: 'brand', hosted_revenue: 50 }),
    fact({ channel: 'google_ads', campaign: null, order_revenue: 20 }),
    fact({ channel: 'meta_ads', campaign: 'retarget', hosted_revenue: 80 }),
  ]);
  assert.deepEqual(rows.map((r) => [r.key, r.label, r.paid_orders, r.order_share]), [
    ['google_ads', 'Google Ads', 3, 75],
    ['meta_ads', 'Meta Ads', 1, 25],
  ]);
  const google = rows[0];
  assert.equal(google.order_revenue, 120);
  assert.equal(google.hosted_revenue, 50);
  assert.deepEqual(google.children.map((c) => [c.label, c.paid_orders]), [['brand', 2], ['No campaign tag', 1]]);
});

test('a platform with no campaign tags at all says how to fix it', () => {
  const [row] = buildBreakdown('paid', [fact({ channel: 'google_ads' }), fact({ channel: 'google_ads' })]);
  assert.match(row.detail ?? '', /utm_campaign/);
});

test('affiliate orders roll up to the affiliate who owns the code, codes as children', () => {
  const owners: Record<string, { affiliateId: string; name: string }> = {
    SMITH10: { affiliateId: 'a1', name: 'Jo Smith' },
    JOSMITH: { affiliateId: 'a1', name: 'Jo Smith' },
  };
  const lookup = (code: string) => owners[code] ?? null;
  const rows = buildBreakdown(
    'affiliate',
    [
      // The code on the order wins over the one on the first visit.
      fact({ channel: 'affiliate', referral_code: 'smith-10', first_ref: 'OTHER1' }),
      fact({ channel: 'affiliate', first_ref: 'JOSMITH' }),
      fact({ channel: 'affiliate', referral_code: 'ZZZZ99' }),
      fact({ channel: 'affiliate', first_source: 'partnerblog', first_medium: 'affiliate' }),
      fact({ channel: 'affiliate' }),
    ],
    lookup,
  );
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(byKey['affiliate:a1'].label, 'Jo Smith');
  assert.equal(byKey['affiliate:a1'].paid_orders, 2);
  assert.equal(byKey['affiliate:a1'].detail, 'Codes SMITH10, JOSMITH');
  assert.equal(byKey['code:ZZZZ99'].label, 'Code ZZZZ99 (no affiliate found)');
  assert.equal(byKey['source:partnerblog'].paid_orders, 1);
  assert.equal(byKey.unknown.label, 'Affiliate not recorded');
});

test('affiliateCodeOf normalises the way codes are stored', () => {
  assert.equal(affiliateCodeOf({ referral_code: ' amc smith-10 ', first_ref: null }), 'AMCSMITH10');
  assert.equal(affiliateCodeOf({ referral_code: null, first_ref: 'abcd' }), 'ABCD');
  assert.equal(affiliateCodeOf({ referral_code: '', first_ref: null }), null);
});

test('organic splits by source; referral by site, email by flow email', () => {
  const rows = buildBreakdown('organic', [
    fact({ channel: 'google_organic' }),
    fact({ channel: 'referral', first_host: 'reddit.com' }),
    fact({ channel: 'referral', first_host: 'reddit.com' }),
    fact({ channel: 'email', first_source: 'cart_flow', first_medium: 'email', campaign: 'cart_3' }),
    fact({ channel: 'email', first_source: 'newsletter', first_medium: 'email', campaign: 'october' }),
  ]);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.deepEqual(byKey.referral.children.map((c) => [c.label, c.paid_orders]), [['reddit.com', 2]]);
  assert.deepEqual(
    byKey.email.children.map((c) => c.label).sort(),
    ['Cart Abandonment · email 3 (Offer)', 'october'],
  );
  assert.equal(byKey.google_organic.children.length, 0);
});

test('the orders route and the summary agree on the row key', () => {
  const f = fact({ channel: 'meta_ads', campaign: 'x' });
  assert.equal(breakdownKeysOf('paid', f)?.row.key, buildBreakdown('paid', [f])[0].key);
});

test('a long tail of campaigns is folded into "N more"', () => {
  const facts = Array.from({ length: 12 }, (_, i) => fact({ channel: 'google_ads', campaign: `c${i}` }));
  const [row] = buildBreakdown('paid', facts);
  assert.equal(row.children.length, 9);
  assert.deepEqual([row.children[8].label, row.children[8].paid_orders], ['4 more', 4]);
});

test('email flow report: engagement net of scanners, conversions by click, and the orders flows closed', () => {
  const report = buildEmailFlowReport({
    range: { from: '2026-10-01', to: '2026-10-31' },
    tracking: true,
    conversionSplit: true,
    sends: [
      { id: 's1', flow: 'cart', step: 1, opened_at: 'x', clicked_at: 'x' },
      { id: 's2', flow: 'cart', step: 1, opened_at: 'x', clicked_at: null },
      { id: 's3', flow: 'cart', step: 3, opened_at: null, clicked_at: null },
      { id: 'w1', flow: 'welcome', step: 1, opened_at: null, clicked_at: null },
    ],
    events: [
      { send_id: 's1', flow: 'cart', step: 1, kind: 'click', machine: true, link_kind: 'cart', order_ref: null },
      { send_id: 's1', flow: 'cart', step: 1, kind: 'click', machine: false, link_kind: 'cart', order_ref: null },
      { send_id: 's2', flow: 'cart', step: 1, kind: 'open', machine: true, link_kind: null, order_ref: null },
      { send_id: 's3', flow: 'cart', step: 3, kind: 'click', machine: true, link_kind: 'product', order_ref: null },
      { send_id: 's1', flow: 'cart', step: 1, kind: 'checkout', machine: false, link_kind: null, order_ref: 'puramass:a' },
      { send_id: 's1', flow: 'cart', step: 1, kind: 'checkout', machine: false, link_kind: null, order_ref: 'puramass:a' },
      // An email sent outside the range: ignored for opens/clicks.
      { send_id: 'old', flow: 'cart', step: 1, kind: 'click', machine: false, link_kind: 'home', order_ref: null },
    ],
    conversions: [
      { flow: 'cart', attributed_step: 1, converted_via: 'click', converted_amount: 120, converted_currency: 'CAD' },
      { flow: 'cart', attributed_step: 3, converted_via: 'email_match', converted_amount: '40', converted_currency: 'cad' },
      { flow: 'welcome', attributed_step: null, converted_via: null, converted_amount: null, converted_currency: null },
    ],
    orders: [
      { kind: 'hosted', attribution_channel: 'google_ads', attribution: { email_flow: { flow: 'cart', step: 1, send_id: 's1' } }, amount: 120, currency: 'CAD' },
      { kind: 'hosted', attribution_channel: 'referral', attribution: { last: { source: 'welcome_flow', medium: 'email', campaign: 'welcome_2' } }, amount: 60, currency: 'CAD' },
      { kind: 'store', attribution_channel: 'google_ads', attribution: { last: { source: 'google', medium: 'cpc' } }, amount: 99, currency: 'CAD' },
    ],
  });

  const cart = report.flows.find((f) => f.flow === 'cart')!;
  assert.equal(cart.sent, 3);
  assert.equal(cart.opened, 2);
  assert.equal(cart.opened_automatic_only, 1, 's2 was only opened by a machine');
  assert.equal(cart.clicked, 1);
  assert.equal(cart.machine_clicked, 1, 's3 was clicked only by a scanner; s1 had a person too');
  assert.equal(cart.checkouts, 1, 'one order, however many checkout events');
  assert.deepEqual(cart.conversions, { click: 1, email_match: 1, unknown: 0 });
  assert.deepEqual(cart.revenue, [{ currency: 'CAD', amount: 160 }]);
  assert.deepEqual(cart.click_revenue, [{ currency: 'CAD', amount: 120 }]);
  assert.deepEqual(cart.links, [{ kind: 'cart', label: 'Cart / checkout', clicks: 1 }]);
  assert.equal(cart.steps.find((s) => s.step === 1)!.click_conversions, 1);

  const welcome = report.flows.find((f) => f.flow === 'welcome')!;
  assert.equal(welcome.conversions.unknown, 1);

  assert.equal(report.orders.total, 2);
  assert.deepEqual(report.orders.by_evidence, { click: 1, utm: 1 });
  assert.deepEqual(
    report.orders.by_bucket.map((b) => [b.group, b.orders]).sort(),
    [['organic', 1], ['paid', 1]],
  );
});
