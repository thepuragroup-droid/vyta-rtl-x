/**
 * Tests for the per-order explanation behind the earnings split.
 *
 *   node --test --import tsx lib/analytics/order-source.test.ts
 *
 * The bucket rule has to agree with the summary route's split, so the list an
 * admin opens under a percentage is exactly the orders that percentage counts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { earningsGroupOf, explainOrderSource, isEarningsGroupKey } from './order-source';
import { CHANNELS, PAID_CHANNELS, parseTouch } from './attribution';

const SITE = 'https://aminocan.com';

const base = {
  kind: 'store' as const,
  attribution_campaign: null,
  attribution: null,
  referral_code: null,
  created_at: '2026-05-01T12:00:00+00:00',
};

test('every channel lands in exactly the bucket the split puts it in', () => {
  for (const channel of PAID_CHANNELS) assert.equal(earningsGroupOf(channel), 'paid');
  assert.equal(earningsGroupOf('affiliate'), 'affiliate');
  assert.equal(earningsGroupOf('direct'), 'direct');
  for (const channel of ['google_organic', 'meta_organic', 'email', 'referral']) {
    assert.equal(earningsGroupOf(channel), 'organic');
  }
  // Every known channel is covered by one of the four attributed buckets.
  for (const channel of CHANNELS) assert.notEqual(earningsGroupOf(channel), 'unattributed');
});

test('no channel is unattributed, never direct', () => {
  assert.equal(earningsGroupOf(null), 'unattributed');
  assert.equal(earningsGroupOf(undefined), 'unattributed');
  assert.equal(earningsGroupOf(''), 'unattributed');
});

test('group keys are validated', () => {
  assert.ok(isEarningsGroupKey('paid'));
  assert.ok(isEarningsGroupKey('unattributed'));
  assert.ok(!isEarningsGroupKey('google_ads'));
  assert.ok(!isEarningsGroupKey(null));
});

test('a Google Ads order names the gclid as its evidence', () => {
  const first = parseTouch({ url: `${SITE}/products/bpc?gclid=abc&utm_campaign=spring` });
  const out = explainOrderSource({
    ...base,
    attribution_channel: 'google_ads',
    attribution_campaign: 'spring',
    attribution: { first, last: first },
  });
  assert.equal(out.group, 'paid');
  assert.match(out.reason, /Google Ads ad click/);
  assert.match(out.reason, /gclid/);
  assert.deepEqual(out.evidence.find((e) => e.label === 'Click ID'), { label: 'Click ID', value: 'gclid' });
  assert.deepEqual(out.evidence.find((e) => e.label === 'Campaign'), { label: 'Campaign', value: 'spring' });
  assert.deepEqual(out.hints, []);
});

test('paid UTM tagging without a click ID is explained by the medium', () => {
  const first = parseTouch({ url: `${SITE}/?utm_source=facebook&utm_medium=paid_social` });
  const out = explainOrderSource({ ...base, attribution_channel: 'meta_ads', attribution: { first } });
  assert.equal(out.group, 'paid');
  assert.match(out.reason, /utm_medium=paid_social/);
  assert.match(out.reason, /utm_source=facebook/);
});

test('an affiliate order names its referral code', () => {
  const first = parseTouch({ url: `${SITE}/?ref=JANE2024` });
  const out = explainOrderSource({ ...base, attribution_channel: 'affiliate', attribution: { first } });
  assert.equal(out.group, 'affiliate');
  assert.match(out.reason, /referral code/i);
  assert.ok(out.evidence.some((e) => e.label === 'Referral code'));
});

test('a referral names the referring site', () => {
  const first = parseTouch({ url: `${SITE}/`, referrer: 'https://www.reddit.com/r/peptides' });
  const out = explainOrderSource({ ...base, attribution_channel: 'referral', attribution: { first } });
  assert.equal(out.group, 'organic');
  assert.match(out.reason, /reddit\.com/);
});

test('direct says why it is direct', () => {
  const first = parseTouch({ url: `${SITE}/` });
  const out = explainOrderSource({ ...base, attribution_channel: 'direct', attribution: { first } });
  assert.equal(out.group, 'direct');
  assert.match(out.reason, /no referrer/);
});

test('a hosted order attributed by email says so', () => {
  const out = explainOrderSource({ ...base, kind: 'hosted', attribution_channel: 'google_ads' });
  assert.equal(out.group, 'paid');
  assert.match(out.reason, /matched by email/);
});

test('an unattributed order placed before collecting began says so', () => {
  const out = explainOrderSource(
    { ...base, attribution_channel: null, created_at: '2026-01-10T00:00:00+00:00' },
    { attributionStartedAt: '2026-03-01T00:00:00+00:00' },
  );
  assert.equal(out.group, 'unattributed');
  assert.match(out.reason, /before attribution started/);
  assert.match(out.reason, /2026-03-01/);
});

test('an unattributed order placed after collecting began blames the cookie', () => {
  const out = explainOrderSource(
    { ...base, attribution_channel: null },
    { attributionStartedAt: '2026-03-01T00:00:00+00:00' },
  );
  assert.match(out.reason, /cookie/);
});

test('unattributed orders get hints but stay unattributed', () => {
  const out = explainOrderSource(
    { ...base, attribution_channel: null, referral_code: 'JANE2024' },
    { customerChannel: 'meta_ads', visitorChannel: 'google_ads', attributionStartedAt: null },
  );
  assert.equal(out.group, 'unattributed');
  assert.equal(out.channel, null);
  assert.deepEqual(
    out.hints.map((h) => h.channel),
    ['affiliate', 'meta_ads', 'google_ads'],
  );
});

test('the same channel from account and visitor is hinted once', () => {
  const out = explainOrderSource(
    { ...base, attribution_channel: null },
    { customerChannel: 'google_ads', visitorChannel: 'google_ads' },
  );
  assert.equal(out.hints.length, 1);
});

test('a malformed snapshot does not throw', () => {
  const out = explainOrderSource({ ...base, attribution_channel: 'referral', attribution: 'nonsense' });
  assert.equal(out.group, 'organic');
  assert.deepEqual(out.evidence, []);
});
