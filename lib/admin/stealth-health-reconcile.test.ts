/**
 * Unit tests for setting the partner's settlement ledger against ours.
 *
 * The behaviours worth pinning down are the ones that would quietly produce a
 * wrong balance: matching must never guess, a duplicate identifier must never
 * double-claim a hand-off, the window aggregate must work with no join at all,
 * and an unconfigured split must never read as a reconciled zero.
 *
 * Run with a TS-aware loader, e.g.
 * `node --test --import tsx lib/admin/stealth-health-reconcile.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileSettlement, type LedgerRow } from './stealth-health-reconcile';
import { DEFAULT_TERMS, type SettlementTerms } from './stealth-health';
import type { SettlementRow } from '@/lib/payments/puramass-settlement';

const WINDOW = { start: '2026-01-01', end: '2026-01-31' };

const terms = (over: Partial<SettlementTerms> = {}): SettlementTerms => ({
  ...DEFAULT_TERMS,
  // Keep the arithmetic obvious: no commission, no flat fee, no shipping
  // uplift, so our side of a hand-off is exactly its subtotal.
  shipping_fee_cents: 0,
  ...over,
});

const appointment = (over: Partial<SettlementRow> = {}): SettlementRow => ({
  appointment_id: 'appt_1',
  created_at: '2026-01-15T12:00:00.000Z',
  condition: 'Weight Loss',
  medication: 'Semaglutide 2.5mg/mL',
  visit_type: 'asynchronous',
  source: 'direct',
  split_model: 'revshare',
  white_label_account_settled: false,
  revenue_cents: 30000,
  processing_fee_cents: 960,
  consult_fee_cents: 1500,
  shipping_cents: null,
  partner_split_cents: 7016,
  ...over,
});

const order = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  id: 'order-1',
  status: 'paid',
  currency: 'usd',
  subtotal_cents: 7016,
  paid_at: '2026-01-15T12:00:00.000Z',
  transaction_id: 'appt_1',
  partner_reference: 'ref-1',
  ...over,
});

// ---- The aggregate, which needs no join ----------------------------------

test('the window aggregate works even when nothing matches', () => {
  const r = reconcileSettlement({
    window: WINDOW,
    rows: [appointment({ appointment_id: 'unknowable' })],
    ledger: [order({ transaction_id: 'something-else' })],
    terms: terms(),
  });
  assert.equal(r.summary.matched, 0);
  assert.equal(r.summary.partner_only, 1);
  assert.equal(r.summary.ledger_only, 1);
  // Both sides still total, and the headline variance is still meaningful.
  assert.equal(r.summary.partner.split_cents, 7016);
  assert.equal(r.summary.ours.due_cents, 7016);
  assert.equal(r.summary.variance_cents, 0);
});

test('the reported totals block wins over summing our pages', () => {
  const r = reconcileSettlement({
    window: WINDOW,
    rows: [appointment()],
    ledger: [],
    terms: terms(),
    // Window-wide totals covering appointments beyond the page we hold.
    totals: {
      appointments: 3,
      revenue_cents: 90000,
      processing_fee_cents: 2880,
      consult_fee_cents: 4500,
      shipping_cents: null,
      partner_split_cents: 21048,
    },
  });
  assert.equal(r.summary.partner.from_reported_totals, true);
  assert.equal(r.summary.partner.appointments, 3);
  assert.equal(r.summary.partner.split_cents, 21048);
  // And it says how far the rows we hold fall short of that window total.
  assert.equal(r.summary.partner.totals_row_delta_cents, 21048 - 7016);
});

test('with no totals block the row sum is used and flagged as such', () => {
  const r = reconcileSettlement({
    window: WINDOW,
    rows: [appointment(), appointment({ appointment_id: 'appt_2', partner_split_cents: 1000 })],
    ledger: [],
    terms: terms(),
  });
  assert.equal(r.summary.partner.from_reported_totals, false);
  assert.equal(r.summary.partner.split_cents, 8016);
  assert.equal(r.summary.partner.totals_row_delta_cents, null);
});

// ---- Matching -------------------------------------------------------------

test('an appointment matches a hand-off on transaction_id', () => {
  const r = reconcileSettlement({
    window: WINDOW,
    rows: [appointment()],
    ledger: [order()],
    terms: terms(),
  });
  assert.equal(r.lines[0].match, 'transaction_id');
  assert.equal(r.lines[0].order_id, 'order-1');
  assert.equal(r.lines[0].our_due_cents, 7016);
  assert.equal(r.lines[0].variance_cents, 0);
  assert.equal(r.summary.ledger_only, 0);
});

test('matching falls back to partner_reference', () => {
  const r = reconcileSettlement({
    window: WINDOW,
    rows: [appointment({ appointment_id: 'REF-1' })],
    ledger: [order({ transaction_id: 'tx-other' })],
    terms: terms(),
  });
  // Case-insensitive: the identifier is the same fact in either case.
  assert.equal(r.lines[0].match, 'partner_reference');
  assert.equal(r.lines[0].order_id, 'order-1');
});

test('a stored link beats identifier matching', () => {
  const r = reconcileSettlement({
    window: WINDOW,
    rows: [appointment({ appointment_id: 'appt_1' })],
    ledger: [order({ id: 'order-1', transaction_id: 'appt_1' }), order({ id: 'order-2', transaction_id: 'tx-2', partner_reference: 'ref-2' })],
    terms: terms(),
    links: { appt_1: 'order-2' },
  });
  assert.equal(r.lines[0].match, 'stored');
  assert.equal(r.lines[0].order_id, 'order-2');
});

test('matching never guesses: a near-miss identifier stays unmatched', () => {
  const r = reconcileSettlement({
    window: WINDOW,
    // Same digits, different prefix. A fuzzy matcher would link these.
    rows: [appointment({ appointment_id: 'appt_abc123' })],
    ledger: [order({ transaction_id: 'txn_abc123', partner_reference: 'ref_abc123' })],
    terms: terms(),
  });
  assert.equal(r.lines[0].match, 'none');
  assert.equal(r.lines[0].order_id, null);
  assert.equal(r.lines[0].our_due_cents, null);
  assert.equal(r.lines[0].variance_cents, null);
});

test('one hand-off is never claimed by two appointments', () => {
  const r = reconcileSettlement({
    window: WINDOW,
    rows: [
      appointment({ appointment_id: 'appt_1' }),
      appointment({ appointment_id: 'APPT_1', partner_split_cents: 500 }),
    ],
    ledger: [order()],
    terms: terms(),
  });
  assert.equal(r.lines.filter((l) => l.order_id === 'order-1').length, 1);
  assert.equal(r.summary.matched, 1);
  assert.equal(r.summary.partner_only, 1);
  // The double-count that would overstate what we are owed did not happen.
  assert.equal(r.summary.ours.due_cents, 7016);
});

test('a duplicate identifier in our ledger does not re-point an existing match', () => {
  const r = reconcileSettlement({
    window: WINDOW,
    rows: [appointment()],
    ledger: [
      order({ id: 'order-1', transaction_id: 'appt_1' }),
      order({ id: 'order-2', transaction_id: 'appt_1', partner_reference: 'ref-2' }),
    ],
    terms: terms(),
  });
  assert.equal(r.lines[0].order_id, 'order-1');
  assert.equal(r.summary.ledger_only, 1);
});

// ---- Variance -------------------------------------------------------------

test('variance is theirs minus ours, per line and in aggregate', () => {
  const r = reconcileSettlement({
    window: WINDOW,
    rows: [appointment({ partner_split_cents: 7016 })],
    ledger: [order({ subtotal_cents: 7000 })],
    terms: terms(),
  });
  assert.equal(r.lines[0].variance_cents, 16);
  assert.equal(r.summary.matched_variance_cents, 16);
  assert.equal(r.summary.variance_cents, 16);
  assert.equal(r.summary.disputed, 1);
});

test('unmatched lines contribute no matched variance but still move the window total', () => {
  const r = reconcileSettlement({
    window: WINDOW,
    rows: [appointment({ appointment_id: 'nope', partner_split_cents: 5000 })],
    ledger: [order({ subtotal_cents: 3000, transaction_id: 'tx', partner_reference: 'ref' })],
    terms: terms(),
  });
  assert.equal(r.summary.matched_variance_cents, 0);
  assert.equal(r.summary.disputed, 0);
  assert.equal(r.summary.variance_cents, 5000 - 3000);
});

// ---- Our side -------------------------------------------------------------

test('unpaid and excluded hand-offs are left out of our side entirely', () => {
  const r = reconcileSettlement({
    window: WINDOW,
    rows: [],
    ledger: [
      order({ id: 'paid', subtotal_cents: 1000 }),
      order({ id: 'pending', status: 'payment_pending', subtotal_cents: 9999, transaction_id: 't2', partner_reference: 'r2' }),
      order({ id: 'excluded', settlement_excluded: true, subtotal_cents: 8888, transaction_id: 't3', partner_reference: 'r3' }),
    ],
    terms: terms(),
  });
  assert.equal(r.summary.ours.orders, 1);
  assert.equal(r.summary.ours.due_cents, 1000);
  assert.equal(r.summary.ledger_only, 1);
});

test('our side honours the configured commercial terms', () => {
  const r = reconcileSettlement({
    window: WINDOW,
    rows: [],
    ledger: [order({ subtotal_cents: 10000 })],
    // They keep 30%, and the shipment fee comes back to us.
    terms: terms({ commission_pct: 30, shipping_fee_cents: 500, shipping_remitted: true }),
  });
  // net 10000 + shipping 500 − fee 3000 = 7500
  assert.equal(r.summary.ours.due_cents, 7500);
});

// ---- Flags ----------------------------------------------------------------

test('an unconfigured split is surfaced, not reported as a reconciled zero', () => {
  const r = reconcileSettlement({
    window: WINDOW,
    rows: [appointment({ split_model: null, partner_split_cents: 0 })],
    ledger: [order({ subtotal_cents: 7016 })],
    terms: terms(),
    splitModelUnconfigured: true,
  });
  assert.equal(r.summary.split_model_unconfigured, true);
  // The variance is the whole of our expectation — which is exactly the signal
  // that this is a setup gap rather than an agreed balance of nothing.
  assert.equal(r.summary.variance_cents, -7016);
});

test('a non-USD hand-off flags the FX assumption in their ledger', () => {
  const usdOnly = reconcileSettlement({
    window: WINDOW, rows: [], ledger: [order()], terms: terms(),
  });
  assert.equal(usdOnly.summary.currency_mixed, false);

  const withCad = reconcileSettlement({
    window: WINDOW, rows: [], ledger: [order({ currency: 'CAD' })], terms: terms(),
  });
  assert.equal(withCad.summary.currency_mixed, true);
});

test('caveats are carried through to the summary verbatim', () => {
  const caveats = [{ code: 'store_cost_current_catalog', message: 'Store cost joined from the current catalog.' }];
  const r = reconcileSettlement({
    window: WINDOW, rows: [], ledger: [], terms: terms(), caveats,
  });
  assert.deepEqual(r.summary.caveats, caveats);
});
