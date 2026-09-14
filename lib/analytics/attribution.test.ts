/**
 * Unit tests for marketing attribution: turning a landing URL + referrer into a
 * touch, classifying that touch into a reporting channel, and round-tripping it
 * through the cookie encoding the middleware writes.
 *
 * The repo has no test runner wired up, so these use Node's built-in
 * `node:test` + `node:assert` (zero dependencies). Run with a TS-aware loader,
 * e.g. `node --test --import tsx lib/analytics/attribution.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyChannel,
  parseTouch,
  isMeaningfulTouch,
  encodeTouch,
  decodeTouch,
  referrerHost,
  isSelfReferral,
  isPaidChannel,
} from './attribution';

const SITE = 'https://aminocan.com';

test('a gclid is a Google Ads click whatever the UTMs say', () => {
  // Auto-tagging adds gclid and nothing else — the common case, and the one
  // that must not fall through to "organic" just because utm_medium is absent.
  const bare = parseTouch({ url: `${SITE}/products?gclid=EAIaIQobChMI` });
  assert.equal(bare.channel, 'google_ads');
  assert.equal(bare.click_id, 'EAIaIQobChMI');
  assert.equal(bare.click_id_param, 'gclid');

  // A campaign that mistags itself as organic is still a paid click.
  const mistagged = parseTouch({
    url: `${SITE}/?gclid=abc123&utm_source=google&utm_medium=organic`,
  });
  assert.equal(mistagged.channel, 'google_ads');

  // iOS variants of the same identifier.
  assert.equal(parseTouch({ url: `${SITE}/?gbraid=xyz` }).channel, 'google_ads');
  assert.equal(parseTouch({ url: `${SITE}/?wbraid=xyz` }).channel, 'google_ads');
});

test('Meta, Bing, TikTok and LinkedIn clicks each land in their own channel', () => {
  assert.equal(parseTouch({ url: `${SITE}/?fbclid=IwAR0` }).channel, 'meta_ads');
  assert.equal(parseTouch({ url: `${SITE}/?msclkid=abc` }).channel, 'bing_ads');
  assert.equal(parseTouch({ url: `${SITE}/?ttclid=abc` }).channel, 'tiktok_ads');
  assert.equal(parseTouch({ url: `${SITE}/?li_fat_id=abc` }).channel, 'linkedin_ads');
});

test('paid UTM tagging is honoured when no click id is present', () => {
  // Meta campaigns often arrive tagged but without fbclid (iOS, or a stripped
  // link), so the medium is the only paid signal available.
  assert.equal(
    parseTouch({ url: `${SITE}/?utm_source=instagram&utm_medium=paid_social` }).channel,
    'meta_ads',
  );
  assert.equal(
    parseTouch({ url: `${SITE}/?utm_source=google&utm_medium=cpc` }).channel,
    'google_ads',
  );
  // A paid medium from a source we don't recognise is still spend.
  assert.equal(
    parseTouch({ url: `${SITE}/?utm_source=reddit&utm_medium=cpc` }).channel,
    'other_paid',
  );
});

test('unpaid arrivals are separated from paid ones', () => {
  // Same platform, no click id and no paid medium — organic, not spend.
  assert.equal(
    parseTouch({ url: `${SITE}/`, referrer: 'https://www.google.com/search?q=peptides' }).channel,
    'google_organic',
  );
  assert.equal(
    parseTouch({ url: `${SITE}/`, referrer: 'https://l.instagram.com/' }).channel,
    'meta_organic',
  );
  assert.equal(
    parseTouch({ url: `${SITE}/?utm_source=newsletter&utm_medium=email` }).channel,
    'email',
  );
  assert.equal(
    parseTouch({ url: `${SITE}/`, referrer: 'https://reddit.com/r/peptides' }).channel,
    'referral',
  );
  assert.equal(parseTouch({ url: `${SITE}/` }).channel, 'direct');
});

test('an affiliate ?ref= is its own channel, not a referral', () => {
  const touch = parseTouch({ url: `${SITE}/?ref=AB12CD34` });
  assert.equal(touch.channel, 'affiliate');
  assert.equal(touch.ref_code, 'AB12CD34');

  // A vanity code is a code. The format lives in lib/affiliate/utils and is
  // 4-20 characters, not a fixed 8.
  assert.equal(parseTouch({ url: `${SITE}/?ref=AMCSMITH10` }).ref_code, 'AMCSMITH10');

  // Punctuation and case are normalised away rather than rejected, so a link
  // written by hand still credits the affiliate — exactly what middleware.ts
  // stores in the cookie.
  assert.equal(parseTouch({ url: `${SITE}/?ref=amc-smith-10` }).ref_code, 'AMCSMITH10');

  // Junk in ?ref= must not be stored as a code: nothing that survives
  // normalisation could ever match a real one.
  assert.equal(parseTouch({ url: `${SITE}/?ref=___` }).ref_code, null);
  assert.equal(parseTouch({ url: `${SITE}/?ref=ab` }).ref_code, null);

  // A paid click that also carries ?ref= is still paid: we bought that visit.
  assert.equal(parseTouch({ url: `${SITE}/?ref=AB12CD34&gclid=x` }).channel, 'google_ads');
});

test('same-site referrers are not treated as arrivals', () => {
  assert.equal(isSelfReferral('https://aminocan.com/products', 'aminocan.com'), true);
  assert.equal(isSelfReferral('https://www.aminocan.com/', 'aminocan.com'), true);
  assert.equal(isSelfReferral('https://shop.aminocan.com/', 'aminocan.com'), true);
  assert.equal(isSelfReferral('https://google.com/', 'aminocan.com'), false);

  // Navigating between pages must stay `direct`, not become a self-referral.
  const internal = parseTouch({
    url: `${SITE}/checkout`,
    referrer: `${SITE}/products`,
    selfHost: 'aminocan.com',
  });
  assert.equal(internal.channel, 'direct');
  assert.equal(internal.referrer_host, null);
});

test('campaign detail is captured and normalised', () => {
  const touch = parseTouch({
    url: `${SITE}/products/bpc-157?utm_source=Google&utm_medium=CPC&utm_campaign=Brand_US&utm_term=BPC%20157&utm_content=Ad_A&gclid=xYz`,
  });
  // Everything but the click id is lower-cased so reports don't split on case.
  assert.equal(touch.source, 'google');
  assert.equal(touch.medium, 'cpc');
  assert.equal(touch.campaign, 'brand_us');
  assert.equal(touch.term, 'bpc 157');
  assert.equal(touch.content, 'ad_a');
  // Click ids are opaque and case-sensitive — they keep their case.
  assert.equal(touch.click_id, 'xYz');
  assert.equal(touch.landing_path, '/products/bpc-157');
});

test('an untagged referral falls back to the referring host as its source', () => {
  const touch = parseTouch({ url: `${SITE}/`, referrer: 'https://www.reddit.com/r/peptides' });
  assert.equal(touch.source, 'reddit.com');
  assert.equal(touch.referrer_host, 'reddit.com');
});

test('only meaningful touches may overwrite a stored last-touch', () => {
  // A bookmark visit carries nothing; letting it through would decay every
  // visitor to `direct` the moment they came back.
  assert.equal(isMeaningfulTouch(parseTouch({ url: `${SITE}/` })), false);
  assert.equal(isMeaningfulTouch(parseTouch({ url: `${SITE}/?gclid=x` })), true);
  assert.equal(
    isMeaningfulTouch(parseTouch({ url: `${SITE}/`, referrer: 'https://google.com/' })),
    true,
  );
});

test('a touch survives the cookie round trip', () => {
  const touch = parseTouch({
    url: `${SITE}/lab-results?utm_source=facebook&utm_medium=paid_social&utm_campaign=coa_proof&fbclid=IwAR0`,
    referrer: 'https://l.facebook.com/',
  });
  const decoded = decodeTouch(encodeTouch(touch));
  assert.deepEqual(decoded, touch);
});

test('a corrupt or stale attribution cookie decodes to null rather than throwing', () => {
  assert.equal(decodeTouch(null), null);
  assert.equal(decodeTouch(''), null);
  assert.equal(decodeTouch('not json'), null);
  // Right shape, unknown channel — an older cookie format, discarded.
  assert.equal(decodeTouch(encodeURIComponent(JSON.stringify({ c: 'carrier_pigeon' }))), null);
});

test('referrerHost tolerates junk without throwing', () => {
  assert.equal(referrerHost('https://www.Example.com/path?q=1'), 'example.com');
  assert.equal(referrerHost('android-app://com.google.android.gm'), null);
  assert.equal(referrerHost(''), null);
  assert.equal(referrerHost(null), null);
});

test('paid channels are exactly the ones that cost money', () => {
  assert.equal(isPaidChannel('google_ads'), true);
  assert.equal(isPaidChannel('meta_ads'), true);
  assert.equal(isPaidChannel('other_paid'), true);
  assert.equal(isPaidChannel('google_organic'), false);
  assert.equal(isPaidChannel('affiliate'), false);
  assert.equal(isPaidChannel('direct'), false);
  assert.equal(isPaidChannel(null), false);
});

test('classifyChannel is usable directly on stored row fields', () => {
  // The admin analytics route re-classifies historical rows, where all it has
  // is the stored columns rather than a URL.
  assert.equal(
    classifyChannel({ clickIdParam: null, source: 'google', medium: 'cpc' }),
    'google_ads',
  );
  assert.equal(classifyChannel({ referrerHost: 'news.ycombinator.com' }), 'referral');
  assert.equal(classifyChannel({}), 'direct');
});
