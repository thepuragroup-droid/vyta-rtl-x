'use client';

import React, { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, PackageX } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import PurchaseOrderForm, { BackorderPrefill } from '../PurchaseOrderForm';

export default function NewPurchaseOrderPage() {
  const searchParams = useSearchParams();
  // `?backorder=` is the canonical param; `?backorder_id=` kept as a fallback.
  const backorderId = searchParams.get('backorder') ?? searchParams.get('backorder_id');

  const [prefill, setPrefill] = useState<BackorderPrefill | undefined>(undefined);
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!backorderId);

  // Fulfilling a backorder: pull its lines (via the service-role API, since
  // backorder tables are RLS-locked to anon clients) to seed the PO.
  useEffect(() => {
    if (!backorderId) return;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/admin/backorders/${backorderId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json().catch(() => null);
      const bo = res.ok ? data?.backorder : null;
      if (bo) {
        setInvoiceNumber(bo.invoice?.invoice_number ?? null);
        setPrefill({
          backorder_id: backorderId,
          items: (bo.items ?? []).map((bi: any) => ({
            product_id: bi.product_id,
            description: bi.description,
            // The shortfall is what needs purchasing; cost is filled in by staff.
            qty: Number(bi.qty_backordered) || 1,
            unit_price: 0,
          })),
        });
      }
      setLoading(false);
    })();
  }, [backorderId]);

  return (
    <>
      <div className="flex items-center gap-4 mb-6">
        <Link href="/admin/purchase-orders" className="text-ink-muted hover:text-ink transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-bold text-ink">
          {backorderId ? 'New Purchase Order — Fulfil Backorder' : 'New Purchase Order'}
        </h1>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="w-6 h-6 animate-spin text-ink-muted" />
        </div>
      ) : (
        <>
          {prefill && (
            <div className="mb-5 flex items-start gap-2 px-4 py-3 bg-bronze/10 border border-bronze/30 rounded-lg text-sm text-bronze">
              <PackageX className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                Fulfilling the backorder for invoice{' '}
                <strong className="font-semibold">{invoiceNumber ?? 'unknown'}</strong>. The backordered
                quantities are prefilled below — pick a supplier, set costs, and create the PO to clear
                the backorder.
              </span>
            </div>
          )}
          <PurchaseOrderForm mode="create" backorder={prefill} />
        </>
      )}
    </>
  );
}
