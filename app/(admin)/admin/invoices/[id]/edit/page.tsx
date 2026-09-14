'use client';

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getInvoice } from '@/lib/admin/invoices';
import InvoiceForm, { type InvoiceFormInitial } from '@/components/admin/InvoiceForm';

export default function EditInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [initial, setInitial] = useState<InvoiceFormInitial | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getInvoice(id);
      if (cancelled) return;
      if (result) {
        setInitial({ invoice: result.invoice, line_items: result.line_items });
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-ink-muted" />
      </div>
    );
  }

  if (!initial) {
    return (
      <div className="text-center py-20">
        <p className="text-ink-muted mb-4">Invoice not found</p>
        <Link href="/admin/invoices" className="text-bronze hover:text-bronze/80 text-sm">
          Back to Invoices
        </Link>
      </div>
    );
  }

  return <InvoiceForm mode="edit" invoiceId={id} initial={initial} />;
}
