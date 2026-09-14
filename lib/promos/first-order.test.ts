/**
 * Unit tests for who still has their welcome discount.
 *
 * The repo has no test runner wired up, so these use Node's built-in
 * `node:test` + `node:assert` (zero dependencies). Run with a TS-aware loader,
 * e.g. `node --test --import tsx lib/promos/first-order.test.ts`.
 *
 * The Supabase client is stubbed down to the two shapes `isCustomerFirstOrder`
 * actually uses: a `maybeSingle()` read of the customer row, and a counting
 * `head` select over `puramass_orders`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCustomerFirstOrder,
  WELCOME_DISCOUNT_CONSUMING_STATUSES,
} from './first-order';

interface StubOpts {
  /** The legacy flag on the customer row. */
  completedFirstOrder?: boolean | null;
  /** Rows in puramass_orders matching the consuming statuses. */
  hostedOrders?: number;
  /** Make the customers read fail. */
  customerError?: boolean;
  /** Make the puramass_orders count fail. */
  ordersError?: boolean;
}

function stubDb(opts: StubOpts = {}) {
  const statusesAsked: string[][] = [];
  const db = {
    from(table: string) {
      if (table === 'customers') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                opts.customerError
                  ? { data: null, error: { message: 'boom' } }
                  : {
                      data: {
                        has_completed_first_order:
                          opts.completedFirstOrder ?? false,
                      },
                      error: null,
                    },
            }),
          }),
        };
      }
      if (table === 'puramass_orders') {
        return {
          select: () => ({
            eq: () => ({
              in: async (_col: string, statuses: string[]) => {
                statusesAsked.push(statuses);
                return opts.ordersError
                  ? { count: null, error: { message: 'boom' } }
                  : { count: opts.hostedOrders ?? 0, error: null };
              },
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { db: db as any, statusesAsked };
}

test('a signed-out visitor is never a first-order customer', async () => {
  const { db } = stubDb();
  assert.equal(await isCustomerFirstOrder(db, null), false);
  assert.equal(await isCustomerFirstOrder(db, undefined), false);
  assert.equal(await isCustomerFirstOrder(db, ''), false);
});

test('a customer with no orders at all still has the discount', async () => {
  const { db } = stubDb({ completedFirstOrder: false, hostedOrders: 0 });
  assert.equal(await isCustomerFirstOrder(db, 'cus_1'), true);
});

test('the legacy first-order flag spends it', async () => {
  const { db } = stubDb({ completedFirstOrder: true, hostedOrders: 0 });
  assert.equal(await isCustomerFirstOrder(db, 'cus_1'), false);
});

test('an existing hosted order spends it even when the legacy flag is unset', async () => {
  // The hosted checkout never writes has_completed_first_order, so the ledger
  // row is the only record that the order happened.
  const { db } = stubDb({ completedFirstOrder: false, hostedOrders: 1 });
  assert.equal(await isCustomerFirstOrder(db, 'cus_1'), false);
});

test('a pending hand-off counts, so the offer cannot be spent twice at once', async () => {
  const { db, statusesAsked } = stubDb({ hostedOrders: 0 });
  await isCustomerFirstOrder(db, 'cus_1');
  assert.deepEqual(statusesAsked[0], ['paid', 'payment_pending']);
});

test('abandoned checkouts do not count — expired and cancelled are excluded', async () => {
  const consuming = [...WELCOME_DISCOUNT_CONSUMING_STATUSES] as string[];
  assert.ok(!consuming.includes('expired'));
  assert.ok(!consuming.includes('cancelled'));
});

test('a failed customer read fails closed', async () => {
  const { db } = stubDb({ customerError: true });
  assert.equal(await isCustomerFirstOrder(db, 'cus_1'), false);
});

test('a failed order count fails closed', async () => {
  const { db } = stubDb({ ordersError: true });
  assert.equal(await isCustomerFirstOrder(db, 'cus_1'), false);
});
