/**
 * Unit tests for the conditions that decide WHO a bulk send goes to.
 *
 * These cover the two rules an admin sets on /admin/customers before ticking
 * anybody, because both of them are wrong in a customer-visible way rather than
 * a broken-page way:
 *   - a date range must mean whole local days at both ends, and must not
 *     quietly keep a row whose date we do not have;
 *   - "skip anyone already sent the restock email" must hold back exactly the
 *     people who had THAT email inside the window, and nobody else — over-
 *     suppressing loses a customer from a campaign, under-suppressing emails
 *     them the same thing twice.
 *
 * Plus the always-on recent-contact warning underneath them, which is wrong in
 * the same customer-visible way: a warning that never fires lets an admin send
 * a second nudge to somebody chased two days ago, and one that fires on
 * everybody is one nobody reads.
 *
 * The repo has no test runner wired up, so these use Node's built-in
 * `node:test` + `node:assert` (zero dependencies). Run with a TS-aware loader,
 * e.g. `npx tsx --test lib/customer/audience.test.ts`, the same way the other
 * tests in this folder run.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMAIL_TYPE_OPTIONS,
  EMPTY_AUDIENCE,
  MS_PER_DAY,
  RECENT_NUDGE_DAYS,
  activeConditionCount,
  describeAudience,
  describeNudge,
  emailTypeLabel,
  historyKey,
  isRecentlyNudged,
  localDayKey,
  matchesDateFilters,
  nudgeAgeDays,
  recentNudgeSince,
  recentlyNudged,
  suppressionReason,
  suppressionSince,
  withinDayRange,
  type AudienceFilters,
  type EmailHistoryIndex,
  type NudgeSummary,
} from './audience';

const filters = (patch: Partial<AudienceFilters> = {}): AudienceFilters => ({
  ...EMPTY_AUDIENCE,
  ...patch,
});

/** Local midday on the given local day — never near a timezone boundary. */
const atLocalNoon = (day: string): string => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
};

// ---- dates ---------------------------------------------------------------

test('a day key is the admin’s local day, not the UTC one', () => {
  // Whatever timezone the box runs in, 12:00 local is that same local date.
  assert.equal(localDayKey(atLocalNoon('2026-03-14')), '2026-03-14');
  assert.equal(localDayKey(null), null);
  assert.equal(localDayKey('not a date'), null);
});

test('both ends of a range are inclusive whole days', () => {
  const from = '2026-03-01';
  const to = '2026-03-31';
  assert.equal(withinDayRange(atLocalNoon('2026-03-01'), from, to), true, 'first day is in');
  assert.equal(withinDayRange(atLocalNoon('2026-03-31'), from, to), true, 'last day is in');
  assert.equal(withinDayRange(atLocalNoon('2026-02-28'), from, to), false);
  assert.equal(withinDayRange(atLocalNoon('2026-04-01'), from, to), false);
});

test('an open bound only constrains its own end', () => {
  assert.equal(withinDayRange(atLocalNoon('2020-01-01'), '', '2026-01-01'), true);
  assert.equal(withinDayRange(atLocalNoon('2027-01-01'), '', '2026-01-01'), false);
  assert.equal(withinDayRange(atLocalNoon('2027-01-01'), '2026-01-01', ''), true);
});

test('a row with no date is left OUT of a range, not quietly kept in', () => {
  // The safe direction: "joined since March" cannot honestly include somebody
  // whose join date we do not have, and keeping them puts them in the send.
  assert.equal(withinDayRange(null, '2026-03-01', ''), false);
  // With no range at all, though, nothing is being asked and they stay.
  assert.equal(withinDayRange(null, '', ''), true);
});

test('the two date pairs are independent of each other', () => {
  const row = {
    joinedAt: atLocalNoon('2026-01-10'),
    lastActiveAt: atLocalNoon('2026-06-20'),
  };
  assert.equal(matchesDateFilters(row, filters({ joinedFrom: '2026-01-01' })), true);
  assert.equal(matchesDateFilters(row, filters({ joinedFrom: '2026-02-01' })), false);
  assert.equal(
    matchesDateFilters(row, filters({ joinedFrom: '2026-01-01', activeTo: '2026-05-01' })),
    false,
    'a matching join date does not excuse a failing activity date',
  );
  // A buyer who has never logged in fails an activity range but passes a
  // join-only one.
  const never = { joinedAt: atLocalNoon('2026-01-10'), lastActiveAt: null };
  assert.equal(matchesDateFilters(never, filters({ joinedFrom: '2026-01-01' })), true);
  assert.equal(matchesDateFilters(never, filters({ activeFrom: '2026-01-01' })), false);
});

// ---- the suppression window ----------------------------------------------

test('"ever" reads the whole history; a window reads back whole days', () => {
  const now = Date.UTC(2026, 5, 30, 9, 0, 0);
  assert.equal(suppressionSince(filters(), now), null);
  assert.equal(suppressionSince(filters({ excludeWithinDays: 0 }), now), null);
  assert.equal(
    suppressionSince(filters({ excludeWithinDays: 30 }), now),
    new Date(now - 30 * MS_PER_DAY).toISOString(),
  );
});

// ---- who is held back ----------------------------------------------------

const NOW = Date.UTC(2026, 5, 30, 9, 0, 0);
const daysAgo = (n: number): string => new Date(NOW - n * MS_PER_DAY).toISOString();

const history: EmailHistoryIndex = {
  'lapsed@example.com': { restock: daysAgo(90), promo: daysAgo(200) },
  'recent@example.com': { restock: daysAgo(3) },
  'other@example.com': { check_in: daysAgo(2) },
};

test('nobody is held back until an email type is actually named', () => {
  assert.equal(suppressionReason('recent@example.com', filters(), history, NOW), null);
});

test('someone who had that email is held back, and the reason names it', () => {
  const reason = suppressionReason(
    'recent@example.com',
    filters({ excludeTemplates: ['restock'] }),
    history,
    NOW,
  );
  assert.equal(reason?.template, 'restock');
  assert.equal(reason?.sentAt, daysAgo(3));
});

test('a different email type is not a reason to skip them', () => {
  assert.equal(
    suppressionReason('other@example.com', filters({ excludeTemplates: ['restock'] }), history, NOW),
    null,
  );
  assert.equal(
    suppressionReason('nobody@example.com', filters({ excludeTemplates: ['restock'] }), history, NOW),
    null,
  );
});

test('the window puts people back in the list once it no longer covers them', () => {
  const ever = filters({ excludeTemplates: ['restock'] });
  const month = filters({ excludeTemplates: ['restock'], excludeWithinDays: 30 });
  // Chased 90 days ago: skipped on "ever", fair game again inside 30 days.
  assert.equal(suppressionReason('lapsed@example.com', ever, history, NOW)?.template, 'restock');
  assert.equal(suppressionReason('lapsed@example.com', month, history, NOW), null);
  // Chased 3 days ago: skipped either way.
  assert.equal(suppressionReason('recent@example.com', month, history, NOW)?.template, 'restock');
});

test('with several types named, the reason is the most recent one', () => {
  const reason = suppressionReason(
    'lapsed@example.com',
    filters({ excludeTemplates: ['promo', 'restock'] }),
    history,
    NOW,
  );
  assert.equal(reason?.template, 'restock', 'restock at 90d beats promo at 200d');
});

test('the window is judged on instants, not on how Postgres spells a date', () => {
  // Supabase hands back `+00:00`; `toISOString()` produces `Z`. Same moment,
  // and `'+' < '.'`, so a string comparison would read a send as older than a
  // cutoff it is exactly on and let that person straight back into the batch.
  const cutoff = new Date(NOW - 30 * MS_PER_DAY);
  const pgStyle = cutoff.toISOString().replace(/\.\d+Z$/, '+00:00');
  const log: EmailHistoryIndex = { 'edge@example.com': { restock: pgStyle } };
  const reason = suppressionReason(
    'edge@example.com',
    filters({ excludeTemplates: ['restock'], excludeWithinDays: 30 }),
    log,
    NOW,
  );
  assert.equal(reason?.template, 'restock');
});

test('an unparseable timestamp in the log never holds anybody back', () => {
  const log: EmailHistoryIndex = { 'broken@example.com': { restock: 'whenever' } };
  assert.equal(
    suppressionReason('broken@example.com', filters({ excludeTemplates: ['restock'] }), log, NOW),
    null,
  );
});

test('addresses match however they were typed', () => {
  assert.equal(historyKey('  Recent@Example.COM '), 'recent@example.com');
  assert.equal(
    suppressionReason('Recent@Example.com', filters({ excludeTemplates: ['restock'] }), history, NOW)
      ?.template,
    'restock',
  );
});

// ---- describing the conditions -------------------------------------------

test('every email type an admin can skip is one the log actually stores', () => {
  const keys = EMAIL_TYPE_OPTIONS.map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length, 'no key is offered twice');
  // Both desks' templates are offered — a cart chase is an email too.
  assert.ok(keys.includes('restock'));
  assert.ok(keys.includes('recovery_reminder'));
  assert.equal(emailTypeLabel('restock'), 'Back in stock');
  // A key from a later release still reads as something rather than blank.
  assert.equal(emailTypeLabel('some_future_template'), 'some_future_template');
});

test('the conditions count what is switched on, not how many fields are filled', () => {
  assert.equal(activeConditionCount(EMPTY_AUDIENCE), 0);
  assert.equal(activeConditionCount(filters({ joinedFrom: '2026-01-01' })), 1);
  assert.equal(
    activeConditionCount(filters({ joinedFrom: '2026-01-01', joinedTo: '2026-02-01' })),
    1,
    'one range is one condition',
  );
  assert.equal(
    activeConditionCount(
      filters({ joinedFrom: '2026-01-01', activeTo: '2026-02-01', excludeTemplates: ['promo'] }),
    ),
    3,
  );
  // A window with no types chosen is not a condition — it has nothing to skip.
  assert.equal(activeConditionCount(filters({ excludeWithinDays: 30 })), 0);
});

test('the summary reads back what will happen', () => {
  assert.deepEqual(describeAudience(EMPTY_AUDIENCE), []);
  const lines = describeAudience(
    filters({
      joinedFrom: '2026-01-01',
      joinedTo: '2026-03-01',
      excludeTemplates: ['restock'],
      excludeWithinDays: 30,
    }),
  );
  assert.deepEqual(lines, [
    'Joined 2026-01-01 → 2026-03-01',
    'Skipping anyone already sent Back in stock (last 30 days)',
  ]);
});


// ---- recent contact ------------------------------------------------------

const nudge = (patch: Partial<NudgeSummary> = {}): NudgeSummary => ({
  template: 'recovery_discount',
  sentAt: new Date().toISOString(),
  recentCount: 1,
  ...patch,
});

/** Like `daysAgo` above, but relative to a caller-supplied "now". */
const sentDaysAgo = (days: number, now: number): string =>
  new Date(now - days * MS_PER_DAY).toISOString();

test('"recently nudged" is the count the index built, not a second guess', () => {
  // The page can sit open for hours; re-deriving the answer from `sentAt` here
  // would let the flag and the count beside it disagree.
  assert.equal(isRecentlyNudged(nudge()), true);
  assert.equal(isRecentlyNudged(nudge({ recentCount: 0 })), false);
  assert.equal(isRecentlyNudged(null), false);
  assert.equal(isRecentlyNudged(undefined), false);
});

test('the recent cutoff is exactly RECENT_NUDGE_DAYS back', () => {
  const now = Date.parse('2026-06-30T09:00:00.000Z');
  assert.equal(recentNudgeSince(now), sentDaysAgo(RECENT_NUDGE_DAYS, now));
});

test('the age of a nudge is whole days, and null when the stamp is unusable', () => {
  const now = Date.now();
  assert.equal(nudgeAgeDays(nudge({ sentAt: sentDaysAgo(0, now) }), now), 0);
  assert.equal(nudgeAgeDays(nudge({ sentAt: sentDaysAgo(1, now) }), now), 1);
  assert.equal(nudgeAgeDays(nudge({ sentAt: sentDaysAgo(13, now) }), now), 13);
  assert.equal(nudgeAgeDays(nudge({ sentAt: 'not a date' }), now), null);
  assert.equal(nudgeAgeDays(null, now), null);
  // A clock skew must not render as "-1 days ago".
  assert.equal(nudgeAgeDays(nudge({ sentAt: sentDaysAgo(-2, now) }), now), 0);
});

test('a nudge describes itself with the email type an admin would recognise', () => {
  const now = Date.now();
  assert.equal(
    describeNudge(nudge({ sentAt: sentDaysAgo(0, now) }), now),
    'Discount nudge, today',
  );
  assert.equal(
    describeNudge(nudge({ sentAt: sentDaysAgo(1, now) }), now),
    'Discount nudge, yesterday',
  );
  assert.equal(
    describeNudge(nudge({ template: 'restock', sentAt: sentDaysAgo(3, now) }), now),
    'Back in stock, 3 days ago',
  );
  // More than one send in the window is the part that actually stops a batch.
  assert.equal(
    describeNudge(nudge({ sentAt: sentDaysAgo(2, now), recentCount: 3 }), now),
    `Discount nudge, 2 days ago · 3 emails in ${RECENT_NUDGE_DAYS} days`,
  );
});

test('the warning names only the people it is about, newest contact first', () => {
  const now = Date.now();
  const list = [
    { id: 'never', nudge: null },
    { id: 'old', nudge: nudge({ sentAt: sentDaysAgo(40, now), recentCount: 0 }) },
    { id: 'week', nudge: nudge({ sentAt: sentDaysAgo(7, now) }) },
    { id: 'yesterday', nudge: nudge({ sentAt: sentDaysAgo(1, now) }) },
  ];
  assert.deepEqual(
    recentlyNudged(list).map((r) => r.id),
    ['yesterday', 'week'],
    'somebody last emailed outside the window is not a recent contact',
  );
  assert.deepEqual(recentlyNudged([{ id: 'a', nudge: null }]), []);
  // A recipient shape with no nudge field at all is simply never warned about.
  assert.deepEqual(recentlyNudged([{ id: 'a' }]), []);
});

test('an unusable timestamp cannot scramble the order of the others', () => {
  const now = Date.now();
  const list = [
    { id: 'broken', nudge: nudge({ sentAt: 'not a date' }) },
    { id: 'old', nudge: nudge({ sentAt: sentDaysAgo(10, now) }) },
    { id: 'new', nudge: nudge({ sentAt: sentDaysAgo(2, now) }) },
  ];
  assert.deepEqual(
    recentlyNudged(list).map((r) => r.id),
    ['new', 'old', 'broken'],
  );
});
