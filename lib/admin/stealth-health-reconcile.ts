/**
 * Reconciling the partner's settlement ledger against ours.
 *
 * There are now two independent answers to "what does Stealth Health owe us
 * for this window":
 *
 *   ours    — lib/admin/stealth-health.ts computes it from our hand-off ledger
 *             (`puramass_orders.subtotal_cents`) under the commercial terms an
 *             admin typed into /admin/stealth-health.
 *   theirs  — `partner_split` from GET /partner/settlement, produced by the
 *             same engine as the White Label Pay ledger they invoice from.
 *
 * Theirs is the one that gets invoiced, so it is the figure to reconcile
 * against; ours stays as the independent expectation that catches a mistake on
 * either side. This module puts the two next to each other. It never overwrites
 * one with the other and never "corrects" a partner figure — a reconciliation
 * that silently adopts the other side's number has stopped being one.
 *
 * The join is the honest weak point. Their rows are keyed by `appointment_id`;
 * our ledger knows a hand-off by `transaction_id` (theirs, from the store API)
 * and `partner_reference` (ours). Nothing in our schema is called an
 * appointment. So matching is exact-only — case-insensitive equality against
 * those two columns, plus any link an operator has confirmed — and everything
 * it cannot place is reported as unmatched rather than guessed at. Fuzzy
 * matching financial records invents links that look authoritative and are not.
 *
 * Because of that, the window-level aggregate is the figure that always works:
 * it needs no join at all. Per-appointment detail is a bonus that arrives once
 * the identifiers line up.
 */
import {
  computeOrderSettlement,
  isSettleable,
  type SettlementOrderInput,
  type SettlementTerms,
} from '@/lib/admin/stealth-health';
import type {
  SettlementRow,
  SettlementCaveat,
  SettlementTotalsReported,
} from '@/lib/payments/puramass-settlement';

/** How a partner row was tied to one of our hand-offs. */
export type MatchMethod =
  /** An operator-confirmed link stored on the snapshot row. */
  | 'stored'
  /** appointment_id equals puramass_orders.transaction_id. */
  | 'transaction_id'
  /** appointment_id equals puramass_orders.partner_reference. */
  | 'partner_reference'
  /** No hand-off could be tied to this appointment. */
  | 'none';

/** Our ledger row, plus the identifiers a match can key on. */
export type LedgerRow = SettlementOrderInput & {
  transaction_id?: string | null;
  partner_reference?: string | null;
};

/** One appointment set against the hand-off it matched, if any. */
export interface ReconcileLine {
  appointment_id: string;
  created_at: string | null;
  condition: string | null;
  medication: string | null;
  split_model: string | null;
  white_label_account_settled: boolean;
  /** What they say they owe us for this appointment. */
  partner_split_cents: number;
  partner_revenue_cents: number;
  match: MatchMethod;
  /** puramass_orders.id, when matched. */
  order_id: string | null;
  /** What our own terms compute for that hand-off. Null when unmatched. */
  our_due_cents: number | null;
  /** theirs − ours. Positive = they report more than we expected. */
  variance_cents: number | null;
}

/** A paid hand-off of ours that no appointment in the window accounted for. */
export interface UnmatchedOrder {
  order_id: string;
  transaction_id: string | null;
  partner_reference: string | null;
  day: string | null;
  our_due_cents: number;
  gross_cents: number;
}

export interface ReconcileSummary {
  window: { start: string; end: string };

  /** Their side of the window. */
  partner: {
    appointments: number;
    split_cents: number;
    revenue_cents: number;
    processing_fee_cents: number;
    consult_fee_cents: number;
    /** Null when no appointment in the window shipped anything. */
    shipping_cents: number | null;
    /**
     * True when the figures above came from the partner's own `totals` block
     * (which covers the whole window) rather than from summing the rows we
     * hold. Their totals are authoritative; ours are a fallback.
     */
    from_reported_totals: boolean;
    /**
     * Reported total minus the sum of the rows we actually received. Non-zero
     * means we are not holding the whole window — a dropped page, or rows the
     * feed did not return — and the detail below is incomplete.
     */
    totals_row_delta_cents: number | null;
  };

  /** Our side of the same window, under the configured commercial terms. */
  ours: {
    orders: number;
    due_cents: number;
    gross_cents: number;
  };

  /**
   * theirs − ours, at window level. This is the headline number and needs no
   * join to compute, so it is meaningful even when nothing matched.
   */
  variance_cents: number;

  matched: number;
  /** Appointments with no hand-off of ours behind them. */
  partner_only: number;
  /** Paid hand-offs of ours that no appointment accounted for. */
  ledger_only: number;
  /** Sum of theirs − ours across matched pairs only. */
  matched_variance_cents: number;
  /** Matched pairs where the two sides disagree at all. */
  disputed: number;

  /**
   * True when their split is not configured for us. Every partner_split is
   * then 0 and NONE of these figures are a balance — it is a setup gap to
   * raise with them before reconciling anything.
   */
  split_model_unconfigured: boolean;

  /**
   * True when our window holds a hand-off booked in something other than USD.
   * Their ledger sums CAD store products as USD-equivalent, so the comparison
   * then spans an FX conversion neither side has agreed a rate for.
   */
  currency_mixed: boolean;

  caveats: SettlementCaveat[];
}

export interface ReconcileResult {
  summary: ReconcileSummary;
  lines: ReconcileLine[];
  unmatched_orders: UnmatchedOrder[];
}

/** Trim + lower-case an identifier for comparison. Blank reads as null. */
function key(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const t = String(value).trim().toLowerCase();
  return t ? t : null;
}

/**
 * Set the partner's settlement rows against our hand-off ledger for a window.
 *
 * `links` carries appointment_id → puramass_orders.id for pairs already
 * confirmed; those win over identifier matching, because a human (or an
 * earlier confirmed pull) knows more than string equality does.
 */
export function reconcileSettlement(args: {
  window: { start: string; end: string };
  rows: SettlementRow[];
  ledger: LedgerRow[];
  terms: SettlementTerms;
  totals?: SettlementTotalsReported | null;
  caveats?: SettlementCaveat[];
  splitModelUnconfigured?: boolean;
  links?: Record<string, string>;
}): ReconcileResult {
  const { window, rows, ledger, terms } = args;
  const links = args.links ?? {};

  // ---- Our side: settle every paid, non-excluded hand-off in the window ----
  const settleable = ledger.filter(isSettleable);
  const settlementById = new Map<string, ReturnType<typeof computeOrderSettlement>>();
  const orderById = new Map<string, LedgerRow>();
  const byTransaction = new Map<string, string>();
  const byReference = new Map<string, string>();

  for (const order of settleable) {
    const id = String(order.id);
    settlementById.set(id, computeOrderSettlement(order, terms));
    orderById.set(id, order);
    const tx = key(order.transaction_id);
    // First writer wins: a duplicate identifier must not silently re-point an
    // existing match at a different hand-off.
    if (tx && !byTransaction.has(tx)) byTransaction.set(tx, id);
    const ref = key(order.partner_reference);
    if (ref && !byReference.has(ref)) byReference.set(ref, id);
  }

  // ---- Match ---------------------------------------------------------------
  const claimed = new Set<string>();
  const lines: ReconcileLine[] = [];

  for (const row of rows) {
    const appointment = key(row.appointment_id);

    let match: MatchMethod = 'none';
    let orderId: string | null = null;

    const stored = links[row.appointment_id];
    if (stored && settlementById.has(stored) && !claimed.has(stored)) {
      match = 'stored';
      orderId = stored;
    } else if (appointment) {
      const viaTx = byTransaction.get(appointment);
      const viaRef = byReference.get(appointment);
      if (viaTx && !claimed.has(viaTx)) {
        match = 'transaction_id';
        orderId = viaTx;
      } else if (viaRef && !claimed.has(viaRef)) {
        match = 'partner_reference';
        orderId = viaRef;
      }
    }

    if (orderId) claimed.add(orderId);

    const ourDue = orderId ? settlementById.get(orderId)!.due_cents : null;

    lines.push({
      appointment_id: row.appointment_id,
      created_at: row.created_at,
      condition: row.condition,
      medication: row.medication,
      split_model: row.split_model,
      white_label_account_settled: row.white_label_account_settled,
      partner_split_cents: row.partner_split_cents,
      partner_revenue_cents: row.revenue_cents,
      match,
      order_id: orderId,
      our_due_cents: ourDue,
      variance_cents: ourDue === null ? null : row.partner_split_cents - ourDue,
    });
  }

  // ---- Our hand-offs nothing accounted for --------------------------------
  const unmatchedOrders: UnmatchedOrder[] = [];
  for (const [id, settlement] of settlementById) {
    if (claimed.has(id)) continue;
    const order = orderById.get(id)!;
    unmatchedOrders.push({
      order_id: id,
      transaction_id: order.transaction_id ?? null,
      partner_reference: order.partner_reference ?? null,
      day: settlement.day,
      our_due_cents: settlement.due_cents,
      gross_cents: settlement.gross_cents,
    });
  }
  unmatchedOrders.sort((a, b) => String(a.day ?? '').localeCompare(String(b.day ?? '')));

  // ---- Aggregate ----------------------------------------------------------
  // Sum the rows we hold, so a reported total can be checked against them.
  const rowSum = rows.reduce(
    (acc, r) => {
      acc.split += r.partner_split_cents;
      acc.revenue += r.revenue_cents;
      acc.processing += r.processing_fee_cents;
      acc.consult += r.consult_fee_cents;
      if (r.shipping_cents !== null) {
        acc.shipping = (acc.shipping ?? 0) + r.shipping_cents;
      }
      return acc;
    },
    { split: 0, revenue: 0, processing: 0, consult: 0, shipping: null as number | null },
  );

  const totals = args.totals ?? null;
  const partnerSplit = totals ? totals.partner_split_cents : rowSum.split;

  const oursDue = [...settlementById.values()].reduce((s, r) => s + r.due_cents, 0);
  const oursGross = [...settlementById.values()].reduce((s, r) => s + r.gross_cents, 0);

  const matchedLines = lines.filter((l) => l.variance_cents !== null);

  return {
    summary: {
      window,
      partner: {
        appointments: totals?.appointments ?? rows.length,
        split_cents: partnerSplit,
        revenue_cents: totals ? totals.revenue_cents : rowSum.revenue,
        processing_fee_cents: totals ? totals.processing_fee_cents : rowSum.processing,
        consult_fee_cents: totals ? totals.consult_fee_cents : rowSum.consult,
        shipping_cents: totals ? totals.shipping_cents : rowSum.shipping,
        from_reported_totals: Boolean(totals),
        totals_row_delta_cents: totals ? totals.partner_split_cents - rowSum.split : null,
      },
      ours: {
        orders: settlementById.size,
        due_cents: oursDue,
        gross_cents: oursGross,
      },
      variance_cents: partnerSplit - oursDue,
      matched: matchedLines.length,
      partner_only: lines.length - matchedLines.length,
      ledger_only: unmatchedOrders.length,
      matched_variance_cents: matchedLines.reduce((s, l) => s + (l.variance_cents ?? 0), 0),
      disputed: matchedLines.filter((l) => l.variance_cents !== 0).length,
      split_model_unconfigured: Boolean(args.splitModelUnconfigured),
      currency_mixed: [...settlementById.values()].some((s) => s.currency !== 'USD'),
      caveats: args.caveats ?? [],
    },
    lines,
    unmatched_orders: unmatchedOrders,
  };
}
