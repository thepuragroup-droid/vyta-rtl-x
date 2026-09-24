import { NextRequest, NextResponse } from 'next/server';
import { logAuditServer } from '@/lib/admin/audit';
import {
  db,
  requireReader,
  requireAdmin,
  loadTerms,
  loadLedgerRows,
} from '@/lib/admin/stealth-health-server';
import {
  fetchPartnerSettlement,
  resolveWindow,
  DEFAULT_PAGE_LIMIT,
  type SettlementWindow,
} from '@/lib/payments/puramass-settlement';
import { PuramassApiError, isPuramassConfigured } from '@/lib/payments/puramass';
import {
  reconcileSettlement,
  type LedgerRow,
  type ReconcileResult,
} from '@/lib/admin/stealth-health-reconcile';
import {
  savePull,
  loadAppointmentLinks,
  loadLatestPull,
  loadPullRows,
  totalsFromPull,
  loadRecentPulls,
  loadPullDrift,
  MIGRATION_HINT,
  type StoredPull,
  type PullDrift,
} from '@/lib/admin/partner-settlement-server';

export const dynamic = 'force-dynamic';

/**
 * The partner endpoint is off by default and switched on per account, needs
 * clinical tier, and — unlike the catalog endpoints — is not open in sandbox
 * because it returns real financial data. So a 401/403/404 here is far more
 * likely to mean "not enabled for us yet" than "we called it wrong", and
 * saying so is more useful than relaying a bare status code.
 */
const NOT_ENABLED_HINT =
  'The settlement endpoint is not enabled for this account. It is off by default and switched on per partner account, requires clinical tier, and is not available in sandbox. Ask Stealth Health to enable it.';

export interface PartnerSettlementResponse {
  window: SettlementWindow;
  /** Null on a read where the window has never been pulled. */
  reconcile: ReconcileResult | null;
  /** Provenance of the figures, when the snapshot schema is live. */
  pull: StoredPull | null;
  /** How the same window's answer has moved between the last two pulls. */
  drift: PullDrift | null;
  /** False when stealth-health-partner-settlement-migration.sql hasn't run. */
  migrated: boolean;
  /** False when no partner API key is configured in this environment. */
  configured: boolean;
}

/** Resolve start/end/year off the query string, or 400. */
function windowFromParams(sp: URLSearchParams): SettlementWindow {
  return resolveWindow({
    start: sp.get('start'),
    end: sp.get('end'),
    year: sp.get('year'),
  });
}

/** Turn a PuramassApiError into the clearest response we can give. */
function apiErrorResponse(err: PuramassApiError) {
  // 400 is ours (a window we rejected before calling); 503 means unconfigured.
  if (err.status === 400) {
    return NextResponse.json({ error: err.detail }, { status: 400 });
  }
  if (err.status === 401 || err.status === 403 || err.status === 404) {
    return NextResponse.json(
      { error: NOT_ENABLED_HINT, detail: err.detail, status: err.status },
      { status: 409 },
    );
  }
  return NextResponse.json(
    { error: err.detail, status: err.status },
    { status: err.status === 503 ? 409 : 502 },
  );
}

/** Our hand-offs for the window, with the identifiers a match can key on. */
async function ledgerForWindow(window: SettlementWindow): Promise<LedgerRow[]> {
  const { rows } = await loadLedgerRows({ from: window.start, to: window.end });
  return rows as LedgerRow[];
}

/**
 * GET /api/admin/stealth-health/partner-settlement
 *
 * Reads what we have already pulled — it never calls the partner. Pass
 * `start`+`end` (or `year`) for one window, or nothing for the list of recent
 * pulls. Reconciliation is recomputed from the stored snapshot against the
 * current ledger, so this stays honest as our own side changes.
 */
export async function GET(req: NextRequest) {
  if (!(await requireReader(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const hasWindow = sp.get('start') || sp.get('end') || sp.get('year');

  if (!hasWindow) {
    const { pulls, migrated } = await loadRecentPulls(
      parseInt(sp.get('limit') ?? '20', 10) || 20,
    );
    return NextResponse.json({
      pulls,
      migrated,
      configured: isPuramassConfigured(),
    });
  }

  let window: SettlementWindow;
  try {
    window = windowFromParams(sp);
  } catch (err) {
    if (err instanceof PuramassApiError) return apiErrorResponse(err);
    throw err;
  }

  const { pull, migrated } = await loadLatestPull(window);

  // Re-reconcile the stored snapshot against the ledger AS IT STANDS NOW,
  // rather than replaying the verdict recorded at pull time. Our side moves —
  // an order gets excluded, the terms change, a refund lands — and the whole
  // point of the tab is to show the current gap between the two ledgers.
  // Their side is deliberately NOT re-fetched: that is what POST is for.
  let reconcile: ReconcileResult | null = null;
  if (pull) {
    const [rows, { terms }, ledger, links] = await Promise.all([
      loadPullRows(pull.id),
      loadTerms(),
      ledgerForWindow(window),
      loadAppointmentLinks(),
    ]);
    reconcile = reconcileSettlement({
      window,
      rows,
      ledger,
      terms,
      totals: totalsFromPull(pull),
      caveats: pull.caveats,
      splitModelUnconfigured: pull.split_model_unconfigured,
      links,
    });
  }

  const body: PartnerSettlementResponse = {
    window,
    reconcile,
    pull,
    drift: pull ? await loadPullDrift(window) : null,
    migrated,
    configured: isPuramassConfigured(),
  };

  return NextResponse.json(body);
}

/**
 * POST — pull the window live from GET /partner/settlement, set it against our
 * own ledger, and snapshot it.
 *
 * Admin only. The call itself is read-only on their side, but it writes a
 * financial snapshot here and the figures it returns are what an invoice gets
 * argued from.
 *
 * The pull is returned even when it could not be filed (schema not migrated
 * yet): the numbers are still useful, and failing the whole request because we
 * couldn't keep a copy would be the wrong trade.
 */
export async function POST(req: NextRequest) {
  const actor = await requireAdmin(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  let body: Record<string, any> = {};
  try {
    body = await req.json();
  } catch {
    // An empty body is fine; the window can come off the query string.
  }

  const sp = req.nextUrl.searchParams;

  let window: SettlementWindow;
  try {
    window = resolveWindow({
      start: body.start ?? sp.get('start'),
      end: body.end ?? sp.get('end'),
      year: body.year ?? sp.get('year'),
    });
  } catch (err) {
    if (err instanceof PuramassApiError) return apiErrorResponse(err);
    throw err;
  }

  if (!isPuramassConfigured()) {
    return NextResponse.json(
      { error: 'No Stealth Health partner API key is configured in this environment.' },
      { status: 409 },
    );
  }

  // ---- Live pull ----------------------------------------------------------
  let pull;
  try {
    pull = await fetchPartnerSettlement({
      start: window.start,
      end: window.end,
      limit: Number(body.limit ?? sp.get('limit') ?? DEFAULT_PAGE_LIMIT),
    });
  } catch (err) {
    if (err instanceof PuramassApiError) return apiErrorResponse(err);
    console.error('[partner-settlement] pull failed:', err);
    return NextResponse.json({ error: 'Could not reach the settlement endpoint' }, { status: 502 });
  }

  // ---- Set it against our own ledger --------------------------------------
  const [{ terms }, ledger, links] = await Promise.all([
    loadTerms(),
    ledgerForWindow(window),
    loadAppointmentLinks(),
  ]);

  const reconcile = reconcileSettlement({
    window: pull.window,
    rows: pull.rows,
    ledger,
    terms,
    totals: pull.totals,
    caveats: pull.caveats,
    splitModelUnconfigured: pull.split_model_unconfigured,
    links,
  });

  // ---- File it ------------------------------------------------------------
  const stored = await savePull({ pull, reconcile, actor });

  await logAuditServer(db, { actor_id: actor.id, actor_email: actor.email }, {
    action: 'read',
    entity_type: 'stealth_health_settlement_pull',
    entity_id: stored?.id ?? `${window.start}..${window.end}`,
  });

  const response: PartnerSettlementResponse & { migration_hint?: string } = {
    window: pull.window,
    reconcile,
    pull: stored,
    drift: stored ? await loadPullDrift(window) : null,
    migrated: stored !== null,
    configured: true,
  };
  if (!stored) response.migration_hint = MIGRATION_HINT;

  return NextResponse.json(response);
}
