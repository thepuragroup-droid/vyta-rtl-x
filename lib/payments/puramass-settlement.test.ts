/**
 * Unit tests for the partner settlement feed — the parsing rules that keep a
 * reconciliation honest.
 *
 * The four the partner calls out explicitly all have coverage here: totals are
 * the window's and are never summed from pages; `shipping: null` is not zero;
 * `partner_split` is carried through untouched; and a null `split_model` is a
 * setup gap rather than a balance of zero.
 *
 * The repo has no test runner wired up, so these use Node's built-in
 * `node:test` + `node:assert` (zero dependencies). Run with a TS-aware loader,
 * e.g. `node --test --import tsx lib/payments/puramass-settlement.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  amountToCents,
  windowDays,
  resolveWindow,
  normalizeCaveat,
  normalizeSettlementRow,
  normalizeTotals,
  isSplitModelUnconfigured,
  MAX_WINDOW_DAYS,
  SPLIT_MODEL_UNCONFIGURED,
  type SettlementRow,
} from './puramass-settlement';

// The sample row from the partner's own documentation.
const SAMPLE = {
  appointment_id: 'appt_abc123',
  created_at: '2026-01-15T12:00:00.000Z',
  condition: 'Weight Loss',
  medication: 'Semaglutide 2.5mg/mL',
  visit_type: 'asynchronous',
  source: 'direct',
  split_model: 'revshare',
  white_label_account_settled: false,
  revenue: 300.0,
  processing_fee: 9.6,
  consult_fee: 15.0,
  shipping: null,
  partner_split: 70.16,
};

// ---- Money ----------------------------------------------------------------

test('amountToCents rounds binary-float amounts to exact cents', () => {
  assert.equal(amountToCents(300.0), 30000);
  assert.equal(amountToCents(9.6), 960);   // 9.6 * 100 === 959.9999... in binary
  assert.equal(amountToCents(70.16), 7016);
  assert.equal(amountToCents(0.1 + 0.2), 30);
});

test('amountToCents accepts numeric strings but keeps absence as null', () => {
  assert.equal(amountToCents('12.34'), 1234);
  assert.equal(amountToCents(null), null);
  assert.equal(amountToCents(undefined), null);
  assert.equal(amountToCents(''), null);
  assert.equal(amountToCents('not a number'), null);
});

test('amountToCents preserves a negative amount rather than flooring it', () => {
  // A credit or reversal must not silently become zero.
  assert.equal(amountToCents(-25.5), -2550);
});

// ---- Window resolution ----------------------------------------------------

test('windowDays counts both ends', () => {
  assert.equal(windowDays('2026-01-01', '2026-01-01'), 1);
  assert.equal(windowDays('2026-01-01', '2026-01-31'), 31);
  assert.equal(windowDays('2026-01-01', '2026-12-31'), 365);
});

test('year shorthand expands to the whole calendar year', () => {
  assert.deepEqual(resolveWindow({ year: 2026 }), {
    start: '2026-01-01',
    end: '2026-12-31',
  });
  assert.deepEqual(resolveWindow({ year: '2026' }), {
    start: '2026-01-01',
    end: '2026-12-31',
  });
});

test('explicit start/end passes through', () => {
  assert.deepEqual(resolveWindow({ start: '2026-01-01', end: '2026-01-31' }), {
    start: '2026-01-01',
    end: '2026-01-31',
  });
});

test('a window longer than the partner cap is rejected before the call', () => {
  assert.throws(
    () => resolveWindow({ start: '2026-01-01', end: '2027-12-31' }),
    /at most 400/,
  );
  // Exactly at the cap is fine.
  const end = new Date('2026-01-01T00:00:00.000Z');
  end.setUTCDate(end.getUTCDate() + MAX_WINDOW_DAYS - 1);
  assert.doesNotThrow(() =>
    resolveWindow({ start: '2026-01-01', end: end.toISOString().slice(0, 10) }),
  );
});

test('malformed or inverted windows are rejected', () => {
  assert.throws(() => resolveWindow({ start: 'January', end: '2026-01-31' }), /YYYY-MM-DD/);
  assert.throws(() => resolveWindow({ start: '2026-02-31', end: '2026-03-01' }), /YYYY-MM-DD/);
  assert.throws(() => resolveWindow({ start: '2026-01-31', end: '2026-01-01' }), /on or after/);
  assert.throws(() => resolveWindow({ year: 99 }), /four-digit/);
});

// ---- Row normalisation ----------------------------------------------------

test('the documented sample row normalises to integer cents', () => {
  const row = normalizeSettlementRow(SAMPLE)!;
  assert.equal(row.appointment_id, 'appt_abc123');
  assert.equal(row.condition, 'Weight Loss');
  assert.equal(row.split_model, 'revshare');
  assert.equal(row.white_label_account_settled, false);
  assert.equal(row.revenue_cents, 30000);
  assert.equal(row.processing_fee_cents, 960);
  assert.equal(row.consult_fee_cents, 1500);
  assert.equal(row.partner_split_cents, 7016);
});

test('shipping null stays null — it is not free shipping', () => {
  assert.equal(normalizeSettlementRow(SAMPLE)!.shipping_cents, null);
  // An actual zero is a different fact and survives as 0.
  assert.equal(normalizeSettlementRow({ ...SAMPLE, shipping: 0 })!.shipping_cents, 0);
  assert.equal(normalizeSettlementRow({ ...SAMPLE, shipping: 12.5 })!.shipping_cents, 1250);
});

test('partner_split is carried through, never re-derived from revenue and fees', () => {
  // revenue - processing - consult = 275.40, which is NOT the split. The split
  // model is theirs and is not published, so we must never try to recompute it.
  const row = normalizeSettlementRow(SAMPLE)!;
  assert.equal(row.partner_split_cents, 7016);
  assert.notEqual(
    row.partner_split_cents,
    row.revenue_cents - row.processing_fee_cents - row.consult_fee_cents,
  );
});

test('a row without an appointment id is dropped', () => {
  assert.equal(normalizeSettlementRow({ ...SAMPLE, appointment_id: '' }), null);
  assert.equal(normalizeSettlementRow(null), null);
});

test('a null split_model survives normalisation', () => {
  const row = normalizeSettlementRow({ ...SAMPLE, split_model: null, partner_split: 0 })!;
  assert.equal(row.split_model, null);
  assert.equal(row.partner_split_cents, 0);
});

// ---- Totals ---------------------------------------------------------------

test('totals normalise to cents and keep a null shipping total', () => {
  const totals = normalizeTotals({
    appointments: 42,
    revenue: 12600.0,
    processing_fee: 403.2,
    consult_fee: 630.0,
    shipping: null,
    partner_split: 2946.72,
  })!;
  assert.equal(totals.appointments, 42);
  assert.equal(totals.revenue_cents, 1260000);
  assert.equal(totals.processing_fee_cents, 40320);
  assert.equal(totals.shipping_cents, null);
  assert.equal(totals.partner_split_cents, 294672);
});

test('a missing totals block reads as null, not as zeroes', () => {
  // Zeroes would render as "the window is empty", which is a different claim.
  assert.equal(normalizeTotals(undefined), null);
  assert.equal(normalizeTotals(null), null);
});

// ---- Caveats --------------------------------------------------------------

test('caveats normalise from bare strings and from objects', () => {
  assert.deepEqual(normalizeCaveat(SPLIT_MODEL_UNCONFIGURED), {
    code: SPLIT_MODEL_UNCONFIGURED,
    message: SPLIT_MODEL_UNCONFIGURED,
  });
  assert.deepEqual(normalizeCaveat({ code: 'store_cost_current_catalog', message: 'Store cost is joined from the current catalog.' }), {
    code: 'store_cost_current_catalog',
    message: 'Store cost is joined from the current catalog.',
  });
  // A prose-only caveat still gets a stable code to switch on.
  assert.equal(
    normalizeCaveat('CAD store products are summed as USD-equivalent.')!.code,
    'cad_store_products_are_summed_as_usd_equivalent',
  );
  assert.equal(normalizeCaveat(''), null);
});

// ---- Unconfigured split ---------------------------------------------------

const row = (over: Partial<SettlementRow> = {}): SettlementRow => ({
  ...normalizeSettlementRow(SAMPLE)!,
  ...over,
});

test('the documented caveat code flags an unconfigured split', () => {
  assert.equal(
    isSplitModelUnconfigured([{ code: SPLIT_MODEL_UNCONFIGURED, message: 'not configured' }], []),
    true,
  );
});

test('a null split_model flags it even if the caveat wording changes', () => {
  assert.equal(
    isSplitModelUnconfigured([], [row({ split_model: null, partner_split_cents: 0 })]),
    true,
  );
});

test('a configured window with genuine zeroes is not a setup gap', () => {
  // A real appointment that happens to settle to 0 must not read as unconfigured.
  assert.equal(isSplitModelUnconfigured([], [row({ partner_split_cents: 0 })]), false);
  // Nor is an empty window.
  assert.equal(isSplitModelUnconfigured([], []), false);
});
