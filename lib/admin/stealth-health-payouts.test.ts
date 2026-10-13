/**
 * Unit tests for the Stealth Health payout rules: fee math, CAD conversion,
 * payout state, totals, date presets and request views.
 *
 * Run with `node --test --import tsx lib/admin/stealth-health-payouts.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FEE_RATES,
  buildPayoutOrder,
  buildRequestView,
  canVoid,
  dayIn,
  filterByState,
  formatRate,
  inRange,
  matchesSearch,
  normalizeFeeRates,
  orderPeriod,
  payoutState,
  requestBlocker,
  requestRef,
  requestStatusLabel,
  resolveDatePreset,
  rpcRow,
  splitFee,
  summaryCards,
  sumOrders,
  toCadCents,
  type PayoutOrderInput,
  type PayoutRequestRow,
  type RequestRef,
} from './stealth-health-payouts';

const TZ = 'America/New_York';

const input = (over: Partial<PayoutOrderInput> = {}): PayoutOrderInput => ({
  id: 'o1',
  partner_reference: 'vyta_1',
  transaction_id: 'txn_1',
  invoice_id: null,
  invoice_number: 'VYTA-1001',
  paid_at: '2026-10-05T15:00:00Z',
  created_at: '2026-10-05T14:00:00Z',
  total_cents: 10000,
  currency: 'cad',
  money_source: 'webhook',
  customer_name: 'Ada Lovelace',
  customer_email: 'ada@example.com',
  customer_source: 'webhook',
  refunded_cents: 0,
  sh_fee_type: 'catalog',
  sh_fee_rate: null,
  payout_request_id: null,
  paid_out_at: null,
  paid_out_gross: null,
  paid_out_fee: null,
  paid_out_net: null,
  ...over,
});

const noRequests = new Map<string, RequestRef>();
const build = (over: Partial<PayoutOrderInput> = {}, reqs = noRequests, usdRate = 0.72) =>
  buildPayoutOrder(input(over), DEFAULT_FEE_RATES, usdRate, reqs, TZ);

test('splitFee rounds the fee to the cent and nets the rest', () => {
  assert.deepEqual(splitFee(10000, 0.032), { fee_cents: 320, net_cents: 9680 });
  assert.deepEqual(splitFee(12345, 0.06), { fee_cents: 741, net_cents: 11604 });
  // fee + net always add back up to the gross
  for (const g of [1, 99, 1001, 33333, 98765]) {
    const { fee_cents, net_cents } = splitFee(g, 0.032);
    assert.equal(fee_cents + net_cents, g);
  }
});

test('toCadCents: CAD passes through, USD is divided by the CAD→USD rate', () => {
  assert.equal(toCadCents(10000, 'cad', 0.72), 10000);
  assert.equal(toCadCents(7200, 'usd', 0.72), 10000);
  assert.equal(toCadCents(7200, 'USD', 0.72), 10000);
  assert.equal(toCadCents(null, 'usd', 0.72), null);
  assert.equal(toCadCents(7200, 'usd', 0), null);
});

test('formatRate and normalizeFeeRates', () => {
  assert.equal(formatRate(0.032), '3.2%');
  assert.equal(formatRate(0.06), '6%');
  assert.deepEqual(normalizeFeeRates(null), DEFAULT_FEE_RATES);
  assert.deepEqual(normalizeFeeRates({ sh_fee_rate_catalog: '0.0350', sh_fee_rate_custom: 2 }), {
    catalog: 0.035,
    custom: 0.06,
  });
});

test('an order starts at the catalog rate and follows the custom rate when switched', () => {
  const a = build();
  assert.equal(a.fee_type, 'catalog');
  assert.equal(a.gross_cents, 10000);
  assert.equal(a.fee_cents, 320);
  assert.equal(a.net_cents, 9680);
  const b = build({ sh_fee_type: 'custom' });
  assert.equal(b.fee_cents, 600);
  assert.equal(b.net_cents, 9400);
});

test('USD orders are converted to CAD before the fee', () => {
  const o = build({ currency: 'usd', total_cents: 7200 });
  assert.equal(o.original_currency, 'USD');
  assert.equal(o.original_total_cents, 7200);
  assert.equal(o.gross_cents, 10000);
  assert.equal(o.fee_cents, 320);
});

test('unknown amount: no figures, cannot be requested', () => {
  const o = build({ total_cents: null });
  assert.equal(o.gross_cents, null);
  assert.equal(o.fee_cents, null);
  assert.equal(requestBlocker(o), 'amount unknown');
  assert.equal(sumOrders([o, build({ id: 'o2' })]).unknown_count, 1);
});

test('paid-out orders keep their locked rate and figures', () => {
  const o = build({
    sh_fee_type: 'catalog',
    sh_fee_rate: '0.0320',
    paid_out_at: '2026-10-10T00:00:00Z',
    paid_out_gross: '50.00',
    paid_out_fee: '1.60',
    paid_out_net: '48.40',
    total_cents: 99999,
  });
  assert.equal(o.state, 'paid_out');
  assert.equal(o.locked, true);
  assert.equal(o.gross_cents, 5000);
  assert.equal(o.fee_cents, 160);
  assert.equal(o.net_cents, 4840);
  // Changing Settings doesn't move it.
  const moved = buildPayoutOrder(input({
    sh_fee_rate: '0.0320', paid_out_at: '2026-10-10T00:00:00Z',
    paid_out_gross: '50.00', paid_out_fee: '1.60', paid_out_net: '48.40',
  }), { catalog: 0.05, custom: 0.08 }, 0.72, noRequests, TZ);
  assert.equal(moved.rate, 0.032);
  assert.equal(moved.fee_cents, 160);
});

test('payoutState is derived: paid out, on a non-void request, or not requested', () => {
  const reqs = new Map<string, RequestRef>([
    ['r1', { id: 'r1', payout_number: 'VY-PAY-2026-0001', status: 'requested' }],
    ['r2', { id: 'r2', payout_number: 'VY-PAY-2026-0002', status: 'void' }],
  ]);
  assert.equal(payoutState({ payout_request_id: 'r1' }, reqs), 'requested');
  assert.equal(payoutState({ payout_request_id: 'r2' }, reqs), 'not_requested');
  assert.equal(payoutState({ payout_request_id: 'r1', paid_out_at: 'x' }, reqs), 'paid_out');
  assert.equal(payoutState({}, reqs), 'not_requested');
  const o = build({ payout_request_id: 'r1' }, reqs);
  assert.equal(o.payout_number, 'VY-PAY-2026-0001');
  assert.equal(requestBlocker(o), 'already on VY-PAY-2026-0001');
  assert.equal(build({ payout_request_id: 'r2' }, reqs).payout_number, null);
});

test('rpcRow sends CAD dollars', () => {
  assert.deepEqual(rpcRow(build()), { id: 'o1', rate: 0.032, gross: 100, fee: 3.2, net: 96.8 });
});

test('summary cards split owed, requested and paid out', () => {
  const reqs = new Map<string, RequestRef>([
    ['r1', { id: 'r1', payout_number: 'VY-PAY-2026-0001', status: 'requested' }],
  ]);
  const orders = [
    build({ id: 'a' }, reqs),
    build({ id: 'b', payout_request_id: 'r1', sh_fee_type: 'custom' }, reqs),
    build({
      id: 'c', paid_out_at: '2026-10-10T00:00:00Z', sh_fee_rate: 0.032,
      paid_out_gross: 100, paid_out_fee: 3.2, paid_out_net: 96.8,
    }, reqs),
  ];
  const s = summaryCards(orders);
  assert.equal(s.owed.count, 2);
  assert.equal(s.owed.net_cents, 9680 + 9400);
  assert.equal(s.requested.count, 1);
  assert.equal(s.requested.open_requests, 1);
  assert.equal(s.paid_out.net_cents, 9680);
  assert.equal(s.all.fee_cents, 320 + 600 + 320);
  assert.equal(s.all.custom_count, 1);
  assert.equal(filterByState(orders, 'owed').length, 2);
  assert.equal(filterByState(orders, 'paid_out').length, 1);
  assert.equal(filterByState(orders, 'all').length, 3);
});

test('dayIn reads the day in the business time zone', () => {
  // 02:00 UTC on Oct 6 is still Oct 5 in New York.
  assert.equal(dayIn('2026-10-06T02:00:00Z', TZ), '2026-10-05');
  assert.equal(dayIn('2026-10-06', TZ), '2026-10-06');
  assert.equal(dayIn(null, TZ), null);
});

test('date presets resolve against today (weeks start Monday)', () => {
  const today = '2026-10-14'; // Wednesday
  assert.deepEqual(resolveDatePreset('today', today), { from: today, to: today });
  assert.deepEqual(resolveDatePreset('yesterday', today), { from: '2026-10-13', to: '2026-10-13' });
  assert.deepEqual(resolveDatePreset('this_week', today), { from: '2026-10-12', to: '2026-10-18' });
  assert.deepEqual(resolveDatePreset('last_week', today), { from: '2026-10-05', to: '2026-10-11' });
  assert.deepEqual(resolveDatePreset('last_7', today), { from: '2026-10-08', to: today });
  assert.deepEqual(resolveDatePreset('this_month', today), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(resolveDatePreset('last_month', today), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(resolveDatePreset('last_30', today), { from: '2026-09-15', to: today });
  assert.deepEqual(resolveDatePreset('this_quarter', today), { from: '2026-10-01', to: '2026-12-31' });
  assert.deepEqual(resolveDatePreset('last_quarter', today), { from: '2026-07-01', to: '2026-09-30' });
  assert.deepEqual(resolveDatePreset('last_quarter', '2026-02-10'), { from: '2025-10-01', to: '2025-12-31' });
  assert.deepEqual(resolveDatePreset('last_month', '2026-01-15'), { from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(resolveDatePreset('this_year', today), { from: '2026-01-01', to: '2026-12-31' });
  assert.deepEqual(resolveDatePreset('last_year', today), { from: '2025-01-01', to: '2025-12-31' });
  assert.deepEqual(resolveDatePreset('any', today), { from: null, to: null });
  assert.deepEqual(resolveDatePreset('custom', today, { from: '2026-01-01', to: null }), { from: '2026-01-01', to: null });
  // Sunday belongs to the week that started the Monday before.
  assert.deepEqual(resolveDatePreset('this_week', '2026-10-18'), { from: '2026-10-12', to: '2026-10-18' });
});

test('inRange, search and order period', () => {
  assert.equal(inRange('2026-10-05', { from: '2026-10-01', to: '2026-10-05' }), true);
  assert.equal(inRange('2026-10-06', { from: '2026-10-01', to: '2026-10-05' }), false);
  assert.equal(inRange(null, { from: '2026-10-01', to: null }), false);
  assert.equal(inRange(null, { from: null, to: null }), true);
  const o = build();
  assert.equal(matchesSearch(o, 'ada@'), true);
  assert.equal(matchesSearch(o, 'txn_1'), true);
  assert.equal(matchesSearch(o, 'vyta-1001'), true);
  assert.equal(matchesSearch(o, 'nobody'), false);
  assert.deepEqual(
    orderPeriod([build({ id: 'a', paid_at: '2026-10-09T12:00:00Z' }), build({ id: 'b', paid_at: '2026-10-02T12:00:00Z' })]),
    { from: '2026-10-02', to: '2026-10-09' },
  );
});

test('request view: live totals, paid count, changed since requested', () => {
  const row: PayoutRequestRow = {
    id: 'r1', payout_number: 'VY-PAY-2026-0001', status: 'requested',
    period_start: '2026-10-01', period_end: '2026-10-07', usd_rate: '0.720000',
    order_count: 2, requested_gross: '200.00', requested_fees: '6.40', requested_net: '193.60',
    received_amount: null, received_reference: null, received_at: null, notes: null,
    created_at: '2026-10-08T12:00:00Z',
  };
  const reqs = new Map([['r1', requestRef(row)]]);
  const orders = [build({ id: 'a', payout_request_id: 'r1' }, reqs), build({ id: 'b', payout_request_id: 'r1' }, reqs)];
  const v = buildRequestView(row, orders, TZ);
  assert.equal(v.changed, false);
  assert.equal(v.live.net_cents, 19360);
  assert.equal(requestStatusLabel(v), 'Requested');
  assert.equal(canVoid(v), true);

  const switched = [build({ id: 'a', payout_request_id: 'r1', sh_fee_type: 'custom' }, reqs), orders[1]];
  assert.equal(buildRequestView(row, switched, TZ).changed, true);

  const partPaid = [
    build({
      id: 'a', payout_request_id: 'r1', paid_out_at: '2026-10-10T00:00:00Z',
      sh_fee_rate: 0.032, paid_out_gross: 100, paid_out_fee: 3.2, paid_out_net: 96.8,
    }, reqs),
    orders[1],
  ];
  const pv = buildRequestView(row, partPaid, TZ);
  assert.equal(pv.paid_count, 1);
  assert.equal(pv.changed, false);
  assert.equal(requestStatusLabel(pv), 'Requested · 1 of 2 paid');
  assert.equal(canVoid(pv), false);

  const voided = buildRequestView({ ...row, status: 'void' }, orders, TZ);
  assert.equal(voided.live.count, 0);
  assert.equal(voided.changed, false);
  assert.equal(requestStatusLabel(voided), 'Void');
});
