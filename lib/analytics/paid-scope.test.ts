/**
 * Tests for the paid-ads scoping the analytics/marketing role reads under.
 *
 *   node --test --import tsx lib/analytics/paid-scope.test.ts
 *
 * The point of every case here is that the scope FAILS CLOSED: when the filter
 * cannot be applied — the attribution columns aren't migrated, a chunk errors —
 * the scoped reader must end up with less, never with the unfiltered business.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAID_CHANNEL_KEYS,
  filterPaidOrderIds,
  isPaidAdsScoped,
  isPaidVisitorRow,
  loadPaidVisitorScope,
  paidChannelFilter,
  scopeToPaidAds,
} from './paid-scope';
import { PAID_CHANNELS } from './attribution';

/** Records the filters applied, and resolves like a PostgREST builder. */
function stubQuery(result: { data?: unknown[]; error?: unknown }) {
  const calls: Array<{ op: string; column: string; values: unknown }> = [];
  const builder: any = {
    calls,
    in(column: string, values: unknown[]) {
      calls.push({ op: 'in', column, values });
      return builder;
    },
    then(resolve: (v: unknown) => unknown) {
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null })
        .then(resolve);
    },
  };
  return builder;
}

/** A `db` with one table's response, recording what was asked of it. */
function stubDb(responses: Array<{ data?: unknown[]; error?: unknown }>) {
  const queries: any[] = [];
  return {
    queries,
    from() {
      const q = stubQuery(responses[queries.length] ?? { data: [] });
      q.select = () => q;
      q.limit = () => q;
      queries.push(q);
      return q;
    },
  } as any;
}

test('only the analytics role is scoped to paid ads', () => {
  assert.equal(isPaidAdsScoped('analytics'), true);
  for (const role of ['admin', 'assistant', 'affiliate', 'warehouse', 'customer'] as const) {
    assert.equal(isPaidAdsScoped(role), false);
  }
  assert.equal(isPaidAdsScoped(null), false);
});

test('the filter names exactly the paid channels', () => {
  assert.deepEqual(PAID_CHANNEL_KEYS, [...PAID_CHANNELS]);
  // Every earned channel stays out — this list is what "we paid for it" means.
  for (const earned of ['google_organic', 'meta_organic', 'email', 'affiliate', 'referral', 'direct']) {
    assert.equal(PAID_CHANNEL_KEYS.includes(earned), false, earned);
  }

  const q = stubQuery({ data: [] });
  paidChannelFilter(q);
  assert.deepEqual(q.calls, [{ op: 'in', column: 'attribution_channel', values: PAID_CHANNEL_KEYS }]);

  // The visitor table names the column differently.
  const v = stubQuery({ data: [] });
  paidChannelFilter(v, 'first_channel');
  assert.equal(v.calls[0].column, 'first_channel');
});

test('an unscoped reader gets an unfiltered query', () => {
  const q = stubQuery({ data: [] });
  scopeToPaidAds(q, false);
  assert.deepEqual(q.calls, []);
  scopeToPaidAds(q, true);
  assert.equal(q.calls.length, 1);
});

test('paid visitors are collected under both identities', async () => {
  const db = stubDb([{
    data: [
      { anonymous_id: 'v1', customer_id: 'c1' },
      { anonymous_id: 'v2', customer_id: null },
    ],
  }]);
  const scope = await loadPaidVisitorScope(db);

  assert.equal(scope.available, true);
  assert.equal(scope.truncated, false);
  assert.deepEqual([...scope.anonymousIds].sort(), ['v1', 'v2']);
  assert.deepEqual([...scope.customerIds], ['c1']);
  assert.equal(db.queries[0].calls[0].column, 'first_channel');

  // A visitor matches on either identity; a stranger matches on neither.
  assert.equal(isPaidVisitorRow(scope, { anonymous_id: 'v2' }), true);
  assert.equal(isPaidVisitorRow(scope, { customer_id: 'c1', anonymous_id: 'other' }), true);
  assert.equal(isPaidVisitorRow(scope, { anonymous_id: 'v9' }), false);
  assert.equal(isPaidVisitorRow(scope, {}), false);
});

test('an unreadable visitor table matches nobody rather than everybody', async () => {
  const db = stubDb([{ error: { message: 'column visitor_attribution.first_channel does not exist' } }]);
  const scope = await loadPaidVisitorScope(db);

  assert.equal(scope.available, false);
  assert.equal(isPaidVisitorRow(scope, { anonymous_id: 'v1' }), false);
});

test('order ids are narrowed to the ones a paid ad won', async () => {
  const db = stubDb([{ data: [{ id: 'o1' }, { id: 'o3' }] }]);
  const { ids, complete } = await filterPaidOrderIds(db, ['o1', 'o2', 'o3', 'o1']);

  assert.deepEqual([...ids].sort(), ['o1', 'o3']);
  assert.equal(complete, true);
  // Deduplicated before it reaches the query string, and channel-filtered.
  assert.deepEqual(db.queries[0].calls[0], { op: 'in', column: 'id', values: ['o1', 'o2', 'o3'] });
  assert.equal(db.queries[0].calls[1].column, 'attribution_channel');
});

test('a failed lookup contributes no ids', async () => {
  const db = stubDb([{ error: { message: 'boom' } }]);
  const { ids } = await filterPaidOrderIds(db, ['o1', 'o2']);
  assert.equal(ids.size, 0);
});

test('no ids to check is a complete, empty answer', async () => {
  const db = stubDb([]);
  const { ids, complete } = await filterPaidOrderIds(db, []);
  assert.equal(ids.size, 0);
  assert.equal(complete, true);
  assert.equal(db.queries.length, 0);
});
