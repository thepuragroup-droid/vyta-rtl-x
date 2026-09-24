/**
 * Unit tests for the Stealth Health settlement arithmetic — what one paid
 * hand-off is worth to us, how those roll up into a balance, and how an
 * invoice's status follows the money paid against it.
 *
 * The repo has no test runner wired up, so these use Node's built-in
 * `node:test` + `node:assert` (zero dependencies). Run with a TS-aware loader,
 * e.g. `node --test --import tsx lib/admin/stealth-health.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TERMS,
  computeOrderSettlement,
  sumSettlements,
  deriveInvoiceStatus,
  isSettleable,
  normalizeTerms,
  settlementCurrency,
  describeTerms,
  dueDateFor,
  toAmount,
  toCents,
  type SettlementTerms,
} from './stealth-health';

const terms = (over: Partial<SettlementTerms> = {}): SettlementTerms => ({
  ...DEFAULT_TERMS,
  ...over,
});

const order = (over: Record<string, any> = {}) => ({
  id: 'o1',
  status: 'paid',
  currency: 'usd',
  subtotal_cents: 20000,
  refunded_total_cents: 0,
  paid_at: '2026-08-10T12:00:00.000Z',
  created_at: '2026-08-09T12:00:00.000Z',
  items: [{ sku: 'a-10-pack', quantity: 2 }],
  ...over,
});

test('default terms: they remit everything collected plus the shipment fee', () => {
  const s = computeOrderSettlement(order(), terms());
  assert.equal(s.gross_cents, 20000);
  assert.equal(s.net_cents, 20000);
  assert.equal(s.shipping_cents, 3500);
  assert.equal(s.fee_cents, 0);
  assert.equal(s.due_cents, 23500);
  assert.equal(s.units, 2);
  assert.equal(s.currency, 'USD');
  assert.equal(s.day, '2026-08-10');
});

test('commission is taken off net goods, not off the shipment fee', () => {
  const s = computeOrderSettlement(order(), terms({ commission_pct: 15 }));
  assert.equal(s.fee_cents, 3000);          // 15% of 20000
  assert.equal(s.due_cents, 20000 + 3500 - 3000);
});

test('flat per-order fee stacks on top of the commission', () => {
  const s = computeOrderSettlement(
    order(),
    terms({ commission_pct: 10, flat_fee_cents: 250 }),
  );
  assert.equal(s.fee_cents, 2000 + 250);
  assert.equal(s.due_cents, 20000 + 3500 - 2250);
});

test('refunds come off before the commission is computed', () => {
  const s = computeOrderSettlement(
    order({ refunded_total_cents: 5000 }),
    terms({ commission_pct: 20 }),
  );
  assert.equal(s.net_cents, 15000);
  assert.equal(s.fee_cents, 3000);          // 20% of the NET, not the gross
  assert.equal(s.due_cents, 15000 + 3500 - 3000);
});

test('a fully refunded sale owes us nothing, shipment fee included', () => {
  const s = computeOrderSettlement(order({ refunded_total_cents: 20000 }), terms());
  assert.equal(s.net_cents, 0);
  assert.equal(s.shipping_cents, 0);
  assert.equal(s.due_cents, 0);
});

test('over-refund never produces a negative balance', () => {
  const s = computeOrderSettlement(order({ refunded_total_cents: 99999 }), terms());
  assert.equal(s.net_cents, 0);
  assert.equal(s.due_cents, 0);
});

test('when the shipment fee is not remitted it is simply not billed', () => {
  const s = computeOrderSettlement(order(), terms({ shipping_remitted: false }));
  assert.equal(s.shipping_cents, 0);
  assert.equal(s.due_cents, 20000);
});

test('a flat fee larger than the order is capped, never negative', () => {
  const s = computeOrderSettlement(
    order({ subtotal_cents: 500 }),
    terms({ flat_fee_cents: 99999, shipping_remitted: false }),
  );
  assert.equal(s.fee_cents, 500);
  assert.equal(s.due_cents, 0);
});

test('missing subtotal / items are treated as zero, not NaN', () => {
  const s = computeOrderSettlement(
    { id: 'x', status: 'paid', subtotal_cents: null, items: null },
    terms({ shipping_remitted: false }),
  );
  assert.equal(s.gross_cents, 0);
  assert.equal(s.units, 0);
  assert.equal(s.due_cents, 0);
});

test('falls back to created_at when the order has no paid_at stamp', () => {
  const s = computeOrderSettlement(order({ paid_at: null }), terms());
  assert.equal(s.day, '2026-08-09');
});

test('totals are the sum of the per-order figures', () => {
  const t = terms({ commission_pct: 10 });
  const rows = [
    computeOrderSettlement(order({ id: 'a' }), t),
    computeOrderSettlement(order({ id: 'b', subtotal_cents: 10000 }), t),
  ];
  const totals = sumSettlements(rows);
  assert.equal(totals.order_count, 2);
  assert.equal(totals.gross_cents, 30000);
  assert.equal(totals.units, 4);
  assert.equal(totals.due_cents, rows[0].due_cents + rows[1].due_cents);
  assert.equal(totals.due_cents, (20000 + 3500 - 2000) + (10000 + 3500 - 1000));
});

test('only paid, non-excluded hand-offs are settleable', () => {
  assert.equal(isSettleable(order()), true);
  assert.equal(isSettleable(order({ status: 'payment_pending' })), false);
  assert.equal(isSettleable(order({ status: 'expired' })), false);
  assert.equal(isSettleable(order({ settlement_excluded: true })), false);
});

test('invoice status follows the money once it leaves draft', () => {
  assert.equal(deriveInvoiceStatus('draft', 10000, 10000), 'draft');
  assert.equal(deriveInvoiceStatus('void', 10000, 0), 'void');
  assert.equal(deriveInvoiceStatus('sent', 10000, 0), 'sent');
  assert.equal(deriveInvoiceStatus('sent', 10000, 4000), 'partial');
  assert.equal(deriveInvoiceStatus('sent', 10000, 10000), 'paid');
  assert.equal(deriveInvoiceStatus('partial', 10000, 12000), 'paid');   // overpaid
  assert.equal(deriveInvoiceStatus('paid', 10000, 0), 'sent');          // payout removed
  assert.equal(deriveInvoiceStatus('sent', 0, 0), 'sent');              // zero-value
});

test('currency normalises Stealth Health lower-case, defaulting to USD', () => {
  assert.equal(settlementCurrency('usd'), 'USD');
  assert.equal(settlementCurrency('cad'), 'CAD');
  assert.equal(settlementCurrency(null), 'USD');
  assert.equal(settlementCurrency('gbp'), 'USD');
});

test('terms normalise from a partial / junk DB row', () => {
  assert.deepEqual(normalizeTerms(null), DEFAULT_TERMS);
  const t = normalizeTerms({ commission_pct: 250, flat_fee_cents: -5, partner_name: '  ' });
  assert.equal(t.commission_pct, 100);   // clamped
  assert.equal(t.flat_fee_cents, 0);     // negative rejected → default
  assert.equal(t.partner_name, 'Stealth Health');
});

test('terms description states both sides of the deal', () => {
  assert.match(describeTerms(terms({ commission_pct: 12 })), /retains 12% commission/);
  assert.match(describeTerms(terms()), /retains nothing/);
  assert.match(describeTerms(terms({ shipping_remitted: false })), /stays with them/);
});

test('due date adds the payment terms in whole days', () => {
  assert.equal(dueDateFor('2026-08-24', terms({ payment_terms_days: 14 })), '2026-09-07');
  assert.equal(dueDateFor('2026-12-28', terms({ payment_terms_days: 7 })), '2027-01-04');
  assert.equal(dueDateFor('2026-08-24', terms({ payment_terms_days: 0 })), '2026-08-24');
});

test('cents <-> amount round-trip without float drift', () => {
  assert.equal(toAmount(23500), 235);
  assert.equal(toAmount(1), 0.01);
  assert.equal(toCents('19.99'), 1999);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents('nope'), 0);
});
