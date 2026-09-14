/**
 * PuraMass (Stealth Health) partner settlement ledger — GET /partner/settlement.
 *
 * SERVER-ONLY: shares the transport, base URL and live API key with
 * lib/payments/puramass.ts. Never import this from a client component.
 *
 * This is the partner's OWN per-appointment financials, read-only, scoped to
 * our white label automatically (we never pass one). Crucially it is not a
 * calculation built for the API — it is the same engine that produces the
 * White Label Pay ledger they invoice us from. So `partner_split` is the
 * number to reconcile against, and this module goes out of its way not to
 * "improve" it:
 *
 *   - Money is converted to integer cents once, on the way in, and never
 *     re-derived. We do not try to recompute a split from revenue and fees:
 *     the split model is theirs and is not published.
 *   - `shipping` stays NULL when nothing shipped. Null is not zero — zero
 *     would mean free shipping, which is a different fact.
 *   - `caveats[]` is carried through verbatim to every caller. Those
 *     footnotes are what stop a reconciliation disagreement later.
 *   - `split_model: null` means our revenue split has not been configured on
 *     their side. Every row then reports a 0 split. That is a SETUP GAP, not
 *     a balance of zero, and `split_model_unconfigured` marks it so no
 *     surface can render it as "you earned nothing".
 *
 * One property of this feed drives the whole storage design: it is NOT
 * stable over time. Their own caveats say store cost is joined from the
 * CURRENT catalog rather than stamped at checkout, so re-pulling January in
 * March can return different figures for the same appointments if a product
 * price moved in between. Callers therefore snapshot what they pulled rather
 * than treating a live read as the record.
 */
import { puramassFetch, PuramassApiError } from './puramass';

// ---- Contract constants ---------------------------------------------------

/** Longest window the endpoint accepts, in days (inclusive of both ends). */
export const MAX_WINDOW_DAYS = 400;

/** Page size bounds fixed by the partner API. */
export const DEFAULT_PAGE_LIMIT = 100;
export const MAX_PAGE_LIMIT = 500;

/**
 * Stop following `next_cursor` after this many pages. At the 500-row max that
 * is 100k appointments — far past any real window — so hitting it means the
 * cursor is not advancing, not that we have a genuinely huge ledger.
 */
const MAX_PAGES = 200;

/** Caveat code the partner sets when our revenue split is not configured. */
export const SPLIT_MODEL_UNCONFIGURED = 'split_model_unconfigured';

// ---- Types ----------------------------------------------------------------

/**
 * One appointment's financials, normalised to integer cents.
 *
 * The `*_cents` fields mirror the API's decimal fields one-for-one. Nothing is
 * computed here beyond the unit conversion.
 */
export interface SettlementRow {
  appointment_id: string;
  /** ISO timestamp as reported. */
  created_at: string | null;
  condition: string | null;
  medication: string | null;
  visit_type: string | null;
  source: string | null;
  /** e.g. 'revshare'. NULL means our split is not configured on their side. */
  split_model: string | null;
  white_label_account_settled: boolean;
  revenue_cents: number;
  processing_fee_cents: number;
  consult_fee_cents: number;
  /** NULL when nothing shipped — deliberately not coerced to 0. */
  shipping_cents: number | null;
  /** The contractual split for this appointment. The figure to reconcile. */
  partner_split_cents: number;
}

/** Window totals as the partner reports them. Never summed from our pages. */
export interface SettlementTotalsReported {
  appointments: number | null;
  revenue_cents: number;
  processing_fee_cents: number;
  consult_fee_cents: number;
  shipping_cents: number | null;
  partner_split_cents: number;
}

/** One footnote describing how the figures were constructed. */
export interface SettlementCaveat {
  /** Machine code when the partner sends one, else a slug of the message. */
  code: string;
  message: string;
}

export interface SettlementWindow {
  start: string;
  end: string;
}

export interface SettlementPull {
  window: SettlementWindow;
  rows: SettlementRow[];
  /**
   * Totals for the WHOLE window, as reported by the partner — not a sum of the
   * pages we happen to hold. Null when the response carried no totals block.
   */
  totals: SettlementTotalsReported | null;
  caveats: SettlementCaveat[];
  /**
   * True when the partner says our revenue split is unconfigured (either the
   * caveat code or a null `split_model` on any row). In this state every
   * `partner_split_cents` is 0 and the figures are not a balance.
   */
  split_model_unconfigured: boolean;
  pages_fetched: number;
  /** True when we stopped at MAX_PAGES with a cursor still outstanding. */
  truncated: boolean;
}

// ---- Money ----------------------------------------------------------------

/**
 * A decimal amount from the API → integer cents.
 *
 * The API sends money as JSON numbers (`300.00`, `9.60`). Binary floats can't
 * hold those exactly, so multiply and round once, here, and let every
 * downstream surface work in integers. Numeric strings are accepted too, in
 * case the encoding ever changes underneath us.
 *
 * Returns null for null/undefined/unparseable so a genuinely absent value
 * (`shipping`) survives as absent.
 */
export function amountToCents(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Same, but for fields that are always present; absent reads as 0. */
function requiredCents(value: unknown): number {
  return amountToCents(value) ?? 0;
}

// ---- Window helpers -------------------------------------------------------

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a YYYY-MM-DD day as UTC midnight. Returns null when malformed. */
function parseDay(day: string): Date | null {
  if (!ISO_DAY.test(day)) return null;
  const d = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Rejects things like 2026-02-31 that Date would roll forward.
  return d.toISOString().slice(0, 10) === day ? d : null;
}

/** Inclusive length of a window in days (same start and end = 1 day). */
export function windowDays(start: string, end: string): number {
  const a = parseDay(start);
  const b = parseDay(end);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / DAY_MS) + 1;
}

/**
 * Resolve the caller's request into a concrete window.
 *
 * `year` is the partner's shorthand for a whole calendar year and is expanded
 * here so everything downstream only ever deals in explicit start/end days.
 * Throws PuramassApiError(400) rather than letting a bad window make a live
 * call that will just be rejected.
 */
export function resolveWindow(input: {
  start?: string | null;
  end?: string | null;
  year?: string | number | null;
}): SettlementWindow {
  if (input.year !== null && input.year !== undefined && String(input.year).trim() !== '') {
    const y = Number(input.year);
    if (!Number.isInteger(y) || y < 2000 || y > 2999) {
      throw new PuramassApiError(400, 'year must be a four-digit calendar year');
    }
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }

  const start = String(input.start ?? '').trim();
  const end = String(input.end ?? '').trim();
  if (!parseDay(start) || !parseDay(end)) {
    throw new PuramassApiError(400, 'start and end must be YYYY-MM-DD dates');
  }
  if (end < start) {
    throw new PuramassApiError(400, 'end must be on or after start');
  }
  const days = windowDays(start, end);
  if (days > MAX_WINDOW_DAYS) {
    throw new PuramassApiError(
      400,
      `window is ${days} days; the settlement endpoint accepts at most ${MAX_WINDOW_DAYS}`,
    );
  }
  return { start, end };
}

// ---- Normalisation --------------------------------------------------------

function trimOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t ? t : null;
}

/** A caveat entry — a bare string, or an object carrying a code/message. */
export function normalizeCaveat(raw: unknown): SettlementCaveat | null {
  if (typeof raw === 'string') {
    const message = raw.trim();
    if (!message) return null;
    // A bare string may itself be the machine code (the partner documents
    // `split_model_unconfigured` that way); otherwise slug it so callers have
    // something stable to switch on.
    const code = /^[a-z0-9_]+$/.test(message)
      ? message
      : message.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
    return { code, message };
  }
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const code = trimOrNull(r.code ?? r.key ?? r.type);
    const message = trimOrNull(r.message ?? r.detail ?? r.description ?? r.text) ?? code;
    if (!code && !message) return null;
    return { code: code ?? 'caveat', message: message ?? code ?? '' };
  }
  return null;
}

/** One settlement row from the wire → integer-cents form. */
export function normalizeSettlementRow(raw: any): SettlementRow | null {
  const appointmentId = trimOrNull(raw?.appointment_id ?? raw?.appointmentId);
  if (!appointmentId) return null;
  return {
    appointment_id: appointmentId,
    created_at: trimOrNull(raw?.created_at),
    condition: trimOrNull(raw?.condition),
    medication: trimOrNull(raw?.medication),
    visit_type: trimOrNull(raw?.visit_type),
    source: trimOrNull(raw?.source),
    // Deliberately preserves null — it is the unconfigured-split signal.
    split_model: trimOrNull(raw?.split_model),
    white_label_account_settled: raw?.white_label_account_settled === true,
    revenue_cents: requiredCents(raw?.revenue),
    processing_fee_cents: requiredCents(raw?.processing_fee),
    consult_fee_cents: requiredCents(raw?.consult_fee),
    shipping_cents: amountToCents(raw?.shipping),
    partner_split_cents: requiredCents(raw?.partner_split),
  };
}

/** The window-wide `totals` block, if the response carried one. */
export function normalizeTotals(raw: any): SettlementTotalsReported | null {
  if (!raw || typeof raw !== 'object') return null;
  const count = raw.appointments ?? raw.count ?? raw.appointment_count;
  const n = Number(count);
  return {
    appointments: Number.isFinite(n) ? Math.round(n) : null,
    revenue_cents: requiredCents(raw.revenue),
    processing_fee_cents: requiredCents(raw.processing_fee),
    consult_fee_cents: requiredCents(raw.consult_fee),
    shipping_cents: amountToCents(raw.shipping),
    partner_split_cents: requiredCents(raw.partner_split),
  };
}

/**
 * True when the figures describe an unconfigured split rather than a balance.
 *
 * Two independent signals, either of which is enough: the documented caveat
 * code, or a row that came back with no split model at all. Checking both
 * means a caveat wording change on their side can't silently turn a setup gap
 * into a reported zero.
 */
export function isSplitModelUnconfigured(
  caveats: SettlementCaveat[],
  rows: SettlementRow[],
): boolean {
  if (caveats.some((c) => c.code === SPLIT_MODEL_UNCONFIGURED)) return true;
  return rows.length > 0 && rows.some((r) => r.split_model === null);
}

// ---- Fetch ----------------------------------------------------------------

/** Pull the rows array out of whichever envelope the response uses. */
function rowsOf(json: any): any[] {
  if (Array.isArray(json)) return json;
  for (const key of ['appointments', 'rows', 'data', 'results', 'settlements']) {
    if (Array.isArray(json?.[key])) return json[key];
  }
  return [];
}

/**
 * GET /partner/settlement — every appointment in the window, following
 * `pagination.next_cursor` until it comes back null.
 *
 * `totals` and `caveats` describe the whole window, so they are taken from the
 * first page and not re-derived per page. Read-only: safe to call any time.
 *
 * Throws PuramassApiError. Two statuses are worth handling specially at the
 * call site: 403/404 means the endpoint has not been switched on for this
 * account yet (it is off by default and enabled per account, and needs
 * clinical tier), and 503 means no API key is configured here.
 */
export async function fetchPartnerSettlement(input: {
  start?: string | null;
  end?: string | null;
  year?: string | number | null;
  /** Page size. Clamped to the partner's 1–500 range. */
  limit?: number | null;
}): Promise<SettlementPull> {
  const window = resolveWindow(input);
  const limit = Math.min(
    MAX_PAGE_LIMIT,
    Math.max(1, Math.round(Number(input.limit ?? DEFAULT_PAGE_LIMIT)) || DEFAULT_PAGE_LIMIT),
  );

  const rows: SettlementRow[] = [];
  const caveats: SettlementCaveat[] = [];
  const seenCaveats = new Set<string>();
  const seenCursors = new Set<string>();
  const seenAppointments = new Set<string>();

  let totals: SettlementTotalsReported | null = null;
  let cursor: string | null = null;
  let pages = 0;
  let truncated = false;

  do {
    const params = new URLSearchParams({
      start: window.start,
      end: window.end,
      limit: String(limit),
    });
    if (cursor) params.set('cursor', cursor);

    const json = await puramassFetch(`/partner/settlement?${params.toString()}`, {
      method: 'GET',
    });
    pages += 1;

    for (const raw of rowsOf(json)) {
      const row = normalizeSettlementRow(raw);
      // Guard against a page boundary repeating an appointment; double-counting
      // a split is the one error that would silently overstate what we are owed.
      if (row && !seenAppointments.has(row.appointment_id)) {
        seenAppointments.add(row.appointment_id);
        rows.push(row);
      }
    }

    for (const raw of Array.isArray(json?.caveats) ? json.caveats : []) {
      const caveat = normalizeCaveat(raw);
      if (caveat && !seenCaveats.has(caveat.code)) {
        seenCaveats.add(caveat.code);
        caveats.push(caveat);
      }
    }

    // Window-wide, so the first page that reports them wins.
    if (!totals) totals = normalizeTotals(json?.totals);

    const next = trimOrNull(json?.pagination?.next_cursor ?? json?.next_cursor);
    if (!next) {
      cursor = null;
    } else if (seenCursors.has(next)) {
      // A cursor that repeats would loop forever. Stop and say so.
      truncated = true;
      cursor = null;
    } else if (pages >= MAX_PAGES) {
      truncated = true;
      cursor = null;
    } else {
      seenCursors.add(next);
      cursor = next;
    }
  } while (cursor);

  return {
    window,
    rows,
    totals,
    caveats,
    split_model_unconfigured: isSplitModelUnconfigured(caveats, rows),
    pages_fetched: pages,
    truncated,
  };
}
