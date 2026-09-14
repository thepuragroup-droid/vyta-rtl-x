'use client';

import React, { useState } from 'react';
import { X, Upload, Download, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import MultiSelectCustomer from '@/components/admin/MultiSelectCustomer';

interface CustomerOption { id: string; first_name: string | null; last_name: string | null; email: string }

interface Props {
  customers: CustomerOption[];
  onClose: () => void;
  onDone: (message: string) => void;
}

interface PreviewRow {
  sku: string;
  name: string;
  price: number | null;
  valid: boolean;
  reason?: string;
}

interface PreviewState {
  rows: PreviewRow[];
  valid: number;
  invalid: number;
}

async function token(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function parseDollar(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Very simple CSV parser (handles quoted fields, no XLSX support at preview stage). */
function parseCSVText(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];

  function splitLine(line: string): string[] {
    const result: string[] = [];
    let field = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { field += '"'; i++; }
        else { inQuote = !inQuote; }
      } else if (ch === ',' && !inQuote) {
        result.push(field); field = '';
      } else {
        field += ch;
      }
    }
    result.push(field);
    return result;
  }

  const headers = splitLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const vals = splitLine(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] ?? '').trim(); });
    return obj;
  });
}

export default function PriceListImportModal({ customers, onClose, onDone }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<'template' | 'validate' | 'apply' | null>(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<PreviewState | null>(null);

  async function downloadTemplate() {
    setBusy('template');
    const t = await token();
    const res = await fetch('/api/admin/price-overrides/import', {
      headers: t ? { Authorization: `Bearer ${t}` } : {},
    });
    setBusy(null);
    if (!res.ok) { setError('Could not load product catalogue'); return; }
    const { products } = await res.json();
    const header = 'SKU,Product,Price\n';
    const body = (products ?? [])
      .map((p: any) => `${p.sku ?? ''},"${String(p.name).replace(/"/g, '""')}",${Number(p.price).toFixed(2)}`)
      .join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'price-override-template.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function validateFile() {
    if (!file) { setError('Choose a file first'); return; }
    setBusy('validate');
    setError('');
    setPreview(null);

    try {
      const text = await file.text();
      const rows = parseCSVText(text);

      const previewRows: PreviewRow[] = rows.map((row) => {
        const sku = String(row['SKU'] ?? row['sku'] ?? '').trim();
        const name = String(row['Product'] ?? row['Product Name'] ?? row['name'] ?? '').trim();
        const price = parseDollar(row['Price'] ?? row['Override Price'] ?? row['override_price']);

        if (!sku && !name) {
          return { sku, name, price, valid: false, reason: 'Missing SKU and product name' };
        }
        if (price == null || price < 0) {
          return { sku, name, price, valid: false, reason: price == null ? 'Missing price' : 'Negative price' };
        }
        return { sku, name, price, valid: true };
      });

      const valid = previewRows.filter((r) => r.valid).length;
      const invalid = previewRows.length - valid;
      setPreview({ rows: previewRows, valid, invalid });
    } catch {
      setError('Could not read the file. Please use a CSV file.');
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (selectedIds.length === 0) { setError('Select at least one customer'); return; }
    if (!file) { setError('Choose a file'); return; }
    setBusy('apply');
    setError('');

    const t = await token();
    const results = await Promise.all(
      selectedIds.map(async (customerId) => {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('customer_id', customerId);
        const res = await fetch('/api/admin/price-overrides/import', {
          method: 'POST',
          headers: t ? { Authorization: `Bearer ${t}` } : {},
          body: fd,
        });
        const data = await res.json().catch(() => ({}));
        return res.ok ? data : null;
      })
    );

    setBusy(null);
    const succeeded = results.filter(Boolean);
    if (succeeded.length === 0) {
      setError('Import failed for all customers');
      return;
    }

    const totalMatched = succeeded.reduce((s: number, d: any) => s + (d?.matched ?? 0), 0);
    const totalSkipped = succeeded.reduce((s: number, d: any) => s + (d?.skipped ?? 0), 0);
    onDone(`${totalMatched} override${totalMatched === 1 ? '' : 's'} applied across ${succeeded.length} customer${succeeded.length === 1 ? '' : 's'}, ${totalSkipped} row${totalSkipped === 1 ? '' : 's'} skipped.`);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPreview(null);
    setError('');
  }

  const canApply = preview !== null && preview.valid > 0 && selectedIds.length > 0 && busy === null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-line w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line flex-shrink-0">
          <h2 className="font-semibold text-ink flex items-center gap-2">
            <Upload className="w-4 h-4 text-bronze" /> Import price list (CSV)
          </h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><X className="w-5 h-5" /></button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Customer multi-select */}
          <MultiSelectCustomer
            customers={customers}
            selectedIds={selectedIds}
            onChange={setSelectedIds}
            label="Customers"
          />

          {/* Template download */}
          <button
            onClick={downloadTemplate}
            disabled={busy === 'template'}
            className="inline-flex items-center gap-2 text-sm text-bronze hover:text-bronze/80 disabled:opacity-40"
          >
            {busy === 'template' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Download template (CSV)
          </button>

          {/* File picker */}
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">Upload completed file</label>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="w-full text-sm text-ink file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-ink file:text-white file:text-xs hover:file:bg-ink/90"
            />
            <p className="text-xs text-ink-muted mt-1">Columns: <span className="font-mono">SKU, Product, Price</span>. Rows match by SKU then name.</p>
          </div>

          {/* Validate button */}
          {file && !preview && (
            <button
              onClick={validateFile}
              disabled={busy === 'validate'}
              className="inline-flex items-center gap-2 px-4 py-2 bg-surface border border-line rounded-lg text-sm text-ink hover:bg-surface/80 disabled:opacity-40"
            >
              {busy === 'validate' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4 text-bronze" />}
              Validate &amp; Preview
            </button>
          )}

          {/* Preview */}
          {preview && (
            <div className="space-y-3">
              <div className="flex items-center gap-4 text-sm">
                <span className="text-emerald-700 font-medium">{preview.valid} valid row{preview.valid === 1 ? '' : 's'}</span>
                {preview.invalid > 0 && (
                  <span className="text-red-600 font-medium">{preview.invalid} invalid row{preview.invalid === 1 ? '' : 's'}</span>
                )}
                <button onClick={() => { setPreview(null); }} className="text-xs text-ink-muted hover:text-ink underline ml-auto">Re-validate</button>
              </div>
              <div className="border border-line rounded-lg overflow-hidden">
                <div className="max-h-56 overflow-auto">
                  <table className="w-full text-sm min-w-[400px]">
                    <thead>
                      <tr className="border-b border-line sticky top-0 bg-surface">
                        <th className="px-3 py-2 text-left text-xs text-ink-muted font-semibold uppercase tracking-wide">SKU</th>
                        <th className="px-3 py-2 text-left text-xs text-ink-muted font-semibold uppercase tracking-wide">Product</th>
                        <th className="px-3 py-2 text-right text-xs text-ink-muted font-semibold uppercase tracking-wide">Price</th>
                        <th className="px-3 py-2 text-center text-xs text-ink-muted font-semibold uppercase tracking-wide">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/50">
                      {preview.rows.map((row, i) => (
                        <tr key={i} className={row.valid ? '' : 'bg-red-50/50'}>
                          <td className="px-3 py-2 font-mono text-xs text-ink-muted">{row.sku || '—'}</td>
                          <td className="px-3 py-2 text-ink truncate max-w-[160px]">{row.name || '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                            {row.price != null ? `$${row.price.toFixed(2)}` : '—'}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {row.valid ? (
                              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 text-xs font-medium">Valid</span>
                            ) : (
                              <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 text-xs font-medium" title={row.reason}>
                                {row.reason ?? 'Invalid'}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-line flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 border border-line rounded-lg text-sm text-ink-muted hover:text-ink">Cancel</button>
          <button
            onClick={apply}
            disabled={!canApply}
            className="px-4 py-2 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/90 disabled:opacity-40 flex items-center gap-2"
          >
            {busy === 'apply' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Apply{selectedIds.length > 1 ? ` to ${selectedIds.length} customers` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
