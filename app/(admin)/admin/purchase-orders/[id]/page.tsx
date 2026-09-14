'use client';

import React, { useState, useEffect } from 'react';
import { ArrowLeft, Loader2, FileText } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { getPurchaseOrder } from '@/lib/admin/purchase-orders';
import { PO_STATUS_META } from '@/lib/admin/po-status';
import PurchaseOrderForm from '../PurchaseOrderForm';
import PurchaseOrderReceiving from '../PurchaseOrderReceiving';
import type { PurchaseOrderWithSupplier } from '@/lib/types/ecommerce';

export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [po, setPO] = useState<PurchaseOrderWithSupplier | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPurchaseOrder(id).then((data) => { setPO(data); setLoading(false); });
  }, [id]);

  async function openPdf() {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/admin/purchase-orders/${id}/pdf`, {
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
    });
    if (!res.ok) return;
    const html = await res.text();
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  if (loading) {
    return <div className="flex items-center justify-center py-32"><Loader2 className="w-6 h-6 animate-spin text-ink-muted" /></div>;
  }
  if (!po) {
    return (
      <div className="text-center py-24">
        <p className="text-ink-muted mb-4">Purchase order not found.</p>
        <Link href="/admin/purchase-orders" className="text-bronze hover:underline text-sm">← Back to list</Link>
      </div>
    );
  }

  const meta = PO_STATUS_META[po.status];

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/admin/purchase-orders" className="text-ink-muted hover:text-ink transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-ink font-mono">{po.po_number}</h1>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${meta.badge}`}>{meta.label}</span>
            </div>
            <p className="text-xs text-ink-muted mt-0.5">
              Created {new Date(po.created_at).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
        </div>
        <button onClick={openPdf} className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-line rounded-lg text-sm text-ink-muted hover:text-ink transition-colors">
          <FileText className="w-4 h-4" /> View PDF
        </button>
      </div>

      {/* Receiving panel (above the form) */}
      <div className="mb-6">
        <PurchaseOrderReceiving po={po} onReceived={setPO} />
      </div>

      {/* Edit form */}
      <PurchaseOrderForm mode="edit" po={po} onUpdated={setPO} />
    </>
  );
}
