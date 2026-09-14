import { NextRequest, NextResponse } from 'next/server';
import {
  requireReader,
  loadTerms,
  loadLedgerRows,
  settleableSettlements,
} from '@/lib/admin/stealth-health-server';
import { sumSettlements, computeOrderSettlement, isSettleable } from '@/lib/admin/stealth-health';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/stealth-health/orders — paid hand-offs seen as money owed,
 * with what each one contributes to the balance under the current terms.
 *
 * `unbilled=1` narrows it to what a new settlement invoice would pick up,
 * which is exactly what the "create invoice" dialog previews before anything
 * is written. `from`/`to` bound the settlement day (paid_at, else created_at).
 */
export async function GET(req: NextRequest) {
  if (!(await requireReader(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const from = sp.get('from');
  const to = sp.get('to');
  const unbilledOnly = sp.get('unbilled') === '1';
  const limit = Math.min(1000, Math.max(1, parseInt(sp.get('limit') ?? '200', 10) || 200));

  const { terms, migrated } = await loadTerms();
  const { rows, settlementColumns } = await loadLedgerRows({ from, to, unbilledOnly });

  // Totals cover every settleable row that matched; the list is capped so a
  // long period can't return thousands of rows to a dialog.
  const settlements = settleableSettlements(rows, terms);
  const totals = sumSettlements(settlements);

  const orders = rows.slice(0, limit).map((o) => {
    const s = computeOrderSettlement(o, terms);
    return {
      ...s,
      settleable: isSettleable(o),
      status: o.status ?? null,
      partner_reference: (o as any).partner_reference ?? null,
      transaction_id: (o as any).transaction_id ?? null,
      customer_email: (o as any).customer_email ?? null,
      paid_at: o.paid_at ?? null,
      created_at: o.created_at ?? null,
      invoice_id: (o as any).invoice_id ?? null,
      settlement_invoice_id: o.settlement_invoice_id ?? null,
    };
  });

  return NextResponse.json({
    orders,
    totals,
    truncated: rows.length > orders.length,
    matched: rows.length,
    migrated: migrated && settlementColumns,
  });
}
