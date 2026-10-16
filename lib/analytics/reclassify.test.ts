/**
 * Tests for re-reading stored touches under the current rules.
 *
 *   npx tsx --test lib/analytics/reclassify.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { correctedChannel, groupArrivals, snapshotTouch, visitorTouches } from './reclassify';
import { parseTouch } from './attribution';

const touch = (over: Partial<Parameters<typeof correctedChannel>[0]>) => ({
  channel: 'meta_organic',
  source: null,
  medium: null,
  referrer_host: null,
  click_id_param: null,
  ref_code: null,
  ...over,
});

test('a Meta ad filed as organic under the old rules moves to Meta Ads', () => {
  assert.equal(correctedChannel(touch({ source: 'ig', medium: 'instagram_stories' })), 'meta_ads');
  assert.equal(correctedChannel(touch({ channel: 'referral', source: 'an', medium: 'audience_network_classic' })), 'meta_ads');
  assert.equal(correctedChannel(touch({ source: 'facebook', medium: 'paid_ads' })), 'meta_ads');
});

test('one-way only: nothing paid moves, nothing moves to an unpaid channel', () => {
  assert.equal(correctedChannel(touch({ channel: 'google_ads', source: 'ig', medium: 'instagram_stories' })), null);
  assert.equal(correctedChannel(touch({ source: 'instagram', medium: 'social' })), null, 'organic stays organic');
  assert.equal(correctedChannel(touch({ channel: 'direct' })), null);
  assert.equal(correctedChannel(touch({ channel: null })), null);
});

test('a touch recorded today needs no correction — the stored facts reproduce its channel', () => {
  const urls = [
    'https://vytabio.com/?utm_source=ig&utm_medium=Instagram_Stories',
    'https://vytabio.com/?fbclid=abc',
    'https://vytabio.com/?utm_source=instagram&utm_medium=social',
    'https://vytabio.com/',
  ];
  for (const url of urls) {
    const t = parseTouch({ url, referrer: 'https://l.instagram.com/', selfHost: 'vytabio.com' });
    const stored = {
      channel: t.channel,
      source: t.source,
      medium: t.medium,
      referrer_host: t.referrer_host,
      click_id_param: t.click_id_param,
      ref_code: t.ref_code,
    };
    assert.equal(correctedChannel(stored), null, url);
  }
});

test('reads visitor rows and order snapshots', () => {
  const { first, last } = visitorTouches({
    first_channel: 'meta_organic', first_source: 'fb', first_medium: 'facebook_mobile_feed',
    last_channel: 'direct',
  });
  assert.equal(correctedChannel(first), 'meta_ads');
  assert.equal(correctedChannel(last), null);

  const snap = snapshotTouch('referral', { first: { source: 'msg', medium: 'messenger_inbox' }, last: null });
  assert.equal(snap && correctedChannel(snap), 'meta_ads');
  assert.equal(snapshotTouch('referral', null), null);
});

test('groupArrivals: misfiled groups first, paid visitors left out', () => {
  const rows = [
    ...Array(3).fill({ first_channel: 'google_organic', first_source: 'google.com', first_referrer: 'google.com' }),
    ...Array(2).fill({ first_channel: 'meta_organic', first_source: 'ig', first_medium: 'instagram_reels' }),
    { first_channel: 'meta_ads', first_click_param: 'fbclid' },
  ];
  const groups = groupArrivals(rows);
  assert.deepEqual(groups.map((g) => [g.channel, g.visitors, g.corrected]), [
    ['meta_organic', 2, 'meta_ads'],
    ['google_organic', 3, null],
  ]);
});
