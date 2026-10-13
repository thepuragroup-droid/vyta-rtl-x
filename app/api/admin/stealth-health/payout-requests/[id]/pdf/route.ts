import { NextRequest, NextResponse } from 'next/server';
import {
  requireReader,
  loadPayoutData,
  payoutErrorResponse,
} from '@/lib/admin/stealth-health-data';
import { renderPayoutRequestPdf } from '@/lib/admin/stealth-health-payout-pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/stealth-health/payout-requests/[id]/pdf — the payout request
 * as `{payout_number}.pdf`, built from its orders as they stand.
 * Admin + assistant.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireReader(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  const { id } = await params;

  try {
    const data = await loadPayoutData();
    const request = data.requests.find((r) => r.id === id);
    if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const orders = data.orders
      .filter((o) => o.payout_request_id === id)
      .sort((a, b) => String(a.paid_at ?? '').localeCompare(String(b.paid_at ?? '')));

    const pdf = await renderPayoutRequestPdf({ request, orders });
    const filename = `${request.payout_number.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return payoutErrorResponse(err);
  }
}
