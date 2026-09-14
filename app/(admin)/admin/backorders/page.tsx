'use client';

import React, { useEffect, useState } from 'react';
import { PackageX, Wrench, ClipboardList, ExternalLink, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { INVOICE_STATUS_META } from '@/lib/admin/invoice-status';
import type { InvoiceStatus } from '@/lib/types/ecommerce';

type Tab = 'open' | 'fulfilled';

interface BackorderItem {
  id: string;
  product_id: string | null;
  description: string;
  qty_ordered: number;
  qty_available: number;
  qty_backordered: number;
  unit_price: number;
}

interface BackorderRow {
  id: string;
  status: string;
  created_at: string;
  fulfilled_at: string | null;
  purchase_order_id: string | null;
  invoice: {
    id: string;
    invoice_number: string;
    total: number;
    status: InvoiceStatus;
  } | null;
  purchase_order: { id: string; po_number: string } | null;
  items: BackorderItem[];
  customer_name_display: string | null;
  customer_email_display: string | null;
  item_count: number;
  total_backordered: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function BackordersPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('open');
  const [rows, setRows] = useState<BackorderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/admin/backorders?status=${tab}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json().catch(() => ({ backorders: [] }));
      if (!cancelled) {
        setRows(res.ok ? data.backorders ?? [] : []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab]);

  return (
    <>
      <div className="flex items-center gap-3 mb-1">
        <PackageX className="w-6 h-6 text-bronze" />
        <h1 className="text-xl font-bold text-ink">Backorders</h1>
      </div>
      <p className="text-sm text-ink-muted mb-6">Invoice line items ordered beyond available stock.</p>

      {/* Tabs */}
      <div className="flex gap-2 mb-5">
        {([['open', 'Open'], ['fulfilled', 'History']] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${
              tab === key
                ? 'bg-ink text-white font-medium'
                : 'bg-white border border-line text-ink-muted hover:text-ink hover:border-ink/20'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="border-b border-line bg-surface">
                <th className="px-5 py-3 text-left text-xs text-ink-muted font-semibold uppercase tracking-wide">Invoice</th>
                <th className="px-5 py-3 text-left text-xs text-ink-muted font-semibold uppercase tracking-wide">Customer</th>
                <th className="px-5 py-3 text-left text-xs text-ink-muted font-semibold uppercase tracking-wide">Backordered items</th>
                <th className="px-5 py-3 text-right text-xs text-ink-muted font-semibold uppercase tracking-wide">Invoice total</th>
                <th className="px-5 py-3 text-left text-xs text-ink-muted font-semibold uppercase tracking-wide">Invoice status</th>
                <th className="px-5 py-3 text-left text-xs text-ink-muted font-semibold uppercase tracking-wide">{tab === 'open' ? 'Created' : 'Fulfilled'}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-ink-muted">
                    <Loader2 className="w-5 h-5 animate-spin inline-block mr-2 align-middle" /> Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-ink-muted">
                    {tab === 'open' ? 'No open backorders 🎉' : 'No fulfilled backorders yet'}
                  </td>
                </tr>
              ) : rows.map((bo) => {
                const meta = bo.invoice ? INVOICE_STATUS_META[bo.invoice.status] : null;
                const summary = bo.items
                  .map((it) => `${it.description} ×${it.qty_backordered}`)
                  .join(', ');
                return (
                  <tr key={bo.id} className="hover:bg-surface transition-colors align-top">
                    <td className="px-5 py-4">
                      {bo.invoice ? (
                        <Link href={`/admin/invoices/${bo.invoice.id}`} className="font-mono text-sm text-ink hover:text-bronze">
                          {bo.invoice.invoice_number}
                        </Link>
                      ) : <span className="text-ink-muted">—</span>}
                    </td>
                    <td className="px-5 py-4">
                      <div className="text-sm text-ink">{bo.customer_name_display ?? '—'}</div>
                      {bo.customer_email_display && (
                        <div className="text-xs text-ink-muted">{bo.customer_email_display}</div>
                      )}
                    </td>
                    <td className="px-5 py-4 max-w-xs">
                      <div className="text-sm text-ink">
                        {plural(bo.item_count, 'item')} · {plural(bo.total_backordered, 'unit')}
                      </div>
                      {summary && <div className="text-xs text-ink-muted truncate">{summary}</div>}
                    </td>
                    <td className="px-5 py-4 text-right text-sm font-semibold text-ink tabular-nums">
                      {bo.invoice ? `$${Number(bo.invoice.total).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-5 py-4">
                      {meta && (
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${meta.badge}`}>{meta.label}</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-sm text-ink-muted whitespace-nowrap">
                      {tab === 'open'
                        ? new Date(bo.created_at).toLocaleDateString()
                        : bo.fulfilled_at
                          ? new Date(bo.fulfilled_at).toLocaleDateString()
                          : '—'}
                    </td>
                    <td className="px-5 py-4 text-right">
                      {tab === 'open' ? (
                        <button
                          onClick={() => router.push(`/admin/purchase-orders/new?backorder=${bo.id}`)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-ink text-white rounded-lg text-xs font-medium hover:bg-ink/90 transition-colors"
                        >
                          <Wrench className="w-3.5 h-3.5" /> Fulfill
                        </button>
                      ) : bo.purchase_order ? (
                        <Link
                          href={`/admin/purchase-orders/${bo.purchase_order.id}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-line rounded-lg text-xs text-ink hover:border-ink/20 transition-colors"
                        >
                          <ClipboardList className="w-3.5 h-3.5" /> {bo.purchase_order.po_number}
                        </Link>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                          <ExternalLink className="w-3.5 h-3.5" /> PO removed
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
