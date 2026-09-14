'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  Eye,
  EyeOff,
  X,
  FlaskConical,
  ExternalLink,
  Beaker,
  AlertTriangle,
} from 'lucide-react';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useSmartLoad } from '@/lib/hooks/useSmartLoad';
import { useToast } from '@/contexts/ToastContext';
import { apiFetch } from '@/lib/api-fetch';
import FadeInImage from '@/components/FadeInImage';
import { SlowLoadingNotice, LoadingError } from '@/components/LoadingFeedback';

interface CoveredProduct {
  id: string;
  name: string;
  slug: string | null;
  strength: string | null;
  category: string | null;
  image_url: string | null;
  box_image_url: string | null;
}

interface LabResult {
  id: string;
  report_url: string;
  product_name: string;
  lab: string;
  sample_id: string | null;
  compound: string | null;
  cas_number: string | null;
  purity_pct: number | null;
  method: string;
  matrix: string | null;
  receiving_date: string | null;
  registration_date: string | null;
  report_date: string | null;
  active: boolean;
  products: CoveredProduct[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const month = MONTHS[parseInt(mo, 10) - 1];
  if (!month) return iso;
  return `${month} ${parseInt(d, 10)}, ${y}`;
}

export default function AdminLabResultsPage() {
  const { canEdit } = usePermissions();
  const readOnly = !canEdit;
  const toast = useToast();

  const { data, loading, slow, error, reload } = useSmartLoad<{ labResults: LabResult[] }>(
    '/api/admin/lab-results',
  );

  // Local mutable copy enabling optimistic updates.
  const [items, setItems] = useState<LabResult[]>([]);
  useEffect(() => {
    if (data?.labResults) setItems(data.labResults);
  }, [data]);

  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; item: LabResult } | null>(
    null,
  );
  const [deleting, setDeleting] = useState<LabResult | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((l) =>
      [l.product_name, l.compound ?? '', l.sample_id ?? '', l.lab]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [items, search]);

  const stats = useMemo(() => {
    const visible = items.filter((l) => l.active).length;
    const withPurity = items.filter((l) => l.purity_pct !== null && l.purity_pct !== undefined);
    const avg = withPurity.length
      ? withPurity.reduce((s, l) => s + (l.purity_pct as number), 0) / withPurity.length
      : null;
    return {
      total: items.length,
      visible,
      hidden: items.length - visible,
      avgPurity: avg,
    };
  }, [items]);

  async function toggleActive(item: LabResult) {
    if (readOnly) return;
    setBusyId(item.id);
    const next = !item.active;
    // Optimistic flip.
    setItems((cur) => cur.map((l) => (l.id === item.id ? { ...l, active: next } : l)));
    try {
      await apiFetch(`/api/admin/lab-results/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: next }),
      });
      toast.success(next ? 'Report is now visible' : 'Report hidden');
    } catch (e: any) {
      // Roll back.
      setItems((cur) => cur.map((l) => (l.id === item.id ? { ...l, active: item.active } : l)));
      toast.error(e?.message ?? 'Failed to update visibility');
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleting || readOnly) return;
    const target = deleting;
    setBusyId(target.id);
    const snapshot = items;
    // Optimistic removal.
    setItems((cur) => cur.filter((l) => l.id !== target.id));
    setDeleting(null);
    try {
      await apiFetch(`/api/admin/lab-results/${target.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': '' },
      });
      toast.success('Report deleted');
    } catch (e: any) {
      setItems(snapshot);
      toast.error(e?.message ?? 'Failed to delete report');
    } finally {
      setBusyId(null);
    }
  }

  function handleSaved(saved: LabResult, mode: 'create' | 'edit') {
    setItems((cur) => {
      if (mode === 'edit') return cur.map((l) => (l.id === saved.id ? { ...l, ...saved } : l));
      return [saved, ...cur];
    });
    setModal(null);
    toast.success(mode === 'create' ? 'Report added' : 'Report updated');
    // Re-derive covered products (they depend on report_url).
    reload();
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <FlaskConical className="w-6 h-6 text-bronze" />
            Lab Results
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            Manage the Certificates of Analysis shown on the public site.
          </p>
        </div>
        {!readOnly && (
          <button
            onClick={() => setModal({ mode: 'create' })}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink hover:bg-ink/90 text-white text-sm font-semibold rounded-lg transition-colors self-start"
          >
            <Plus className="w-4 h-4" />
            Add lab result
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total" value={String(stats.total)} tone="ink" />
        <StatCard label="Visible" value={String(stats.visible)} tone="emerald" />
        <StatCard label="Hidden" value={String(stats.hidden)} tone="amber" />
        <StatCard
          label="Avg. Purity"
          value={stats.avgPurity === null ? '—' : `${stats.avgPurity.toFixed(1)}%`}
          tone="bronze"
        />
      </div>

      {/* Search */}
      <div className="relative w-full sm:max-w-sm mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search product, compound, sample ID, lab…"
          className="w-full pl-10 pr-4 py-2.5 bg-white rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink"
        />
      </div>

      {slow && <SlowLoadingNotice onReload={reload} />}

      {error ? (
        <LoadingError message={error} onRetry={reload} />
      ) : loading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-white border border-line rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-sm text-ink-muted">
          {items.length === 0
            ? 'No lab results yet. Add one to get started.'
            : 'No reports match your search.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => (
            <LabResultRow
              key={item.id}
              item={item}
              readOnly={readOnly}
              busy={busyId === item.id}
              onToggle={() => toggleActive(item)}
              onEdit={() => setModal({ mode: 'edit', item })}
              onDelete={() => setDeleting(item)}
            />
          ))}
        </div>
      )}

      {modal && (
        <LabResultModal
          mode={modal.mode}
          item={modal.mode === 'edit' ? modal.item : null}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete lab result?"
          message={`This permanently removes the report for "${deleting.product_name}". This can't be undone.`}
          confirmLabel="Delete"
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'ink' | 'emerald' | 'amber' | 'bronze';
}) {
  const toneClasses: Record<string, string> = {
    ink: 'text-ink',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    bronze: 'text-bronze-dark',
  };
  return (
    <div className="bg-white border border-line rounded-xl px-4 py-3">
      <div className={`text-2xl font-bold tabular-nums ${toneClasses[tone]}`}>{value}</div>
      <div className="text-xs text-ink-muted mt-0.5">{label}</div>
    </div>
  );
}

function LabResultRow({
  item,
  readOnly,
  busy,
  onToggle,
  onEdit,
  onDelete,
}: {
  item: LabResult;
  readOnly: boolean;
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const primary = item.products[0];
  const thumb = primary?.box_image_url ?? primary?.image_url ?? null;

  return (
    <div
      className={`bg-white border border-line rounded-xl p-3 sm:p-4 flex items-center gap-3 sm:gap-4 transition-opacity ${
        item.active ? '' : 'opacity-60'
      }`}
    >
      {/* Thumbnail */}
      <div className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-lg bg-surface overflow-hidden flex-shrink-0">
        {thumb ? (
          <FadeInImage src={thumb} alt={item.product_name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Beaker className="w-6 h-6 text-line" />
          </div>
        )}
      </div>

      {/* Meta */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-ink text-sm truncate">{item.product_name}</h3>
          {!item.active && (
            <span className="text-[10px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded-full font-medium flex-shrink-0">
              Hidden
            </span>
          )}
        </div>
        <p className="text-xs text-ink-muted truncate">
          {[item.compound, item.lab].filter(Boolean).join(' · ')}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] text-ink-light">
          {item.purity_pct !== null && item.purity_pct !== undefined && (
            <span className="tabular-nums">{Number(item.purity_pct).toFixed(2)}% purity</span>
          )}
          {item.sample_id && <span className="font-mono">{item.sample_id}</span>}
          <span>{formatDate(item.report_date)}</span>
          <span>
            {item.products.length} {item.products.length === 1 ? 'product' : 'products'}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <a
          href={item.report_url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 text-ink-muted hover:text-ink hover:bg-surface rounded-lg transition-colors"
          title="Open report"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
        {!readOnly && (
          <>
            <button
              onClick={onToggle}
              disabled={busy}
              className="p-2 text-ink-muted hover:text-ink hover:bg-surface rounded-lg transition-colors disabled:opacity-40"
              title={item.active ? 'Hide from site' : 'Show on site'}
            >
              {item.active ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
            <button
              onClick={onEdit}
              disabled={busy}
              className="p-2 text-ink-muted hover:text-ink hover:bg-surface rounded-lg transition-colors disabled:opacity-40"
              title="Edit"
            >
              <Edit2 className="w-4 h-4" />
            </button>
            <button
              onClick={onDelete}
              disabled={busy}
              className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  required,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink mb-1">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-ink-light mt-1">{hint}</span>}
    </label>
  );
}

const inputClass =
  'w-full px-3 py-2 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-bronze/40 text-sm text-ink';

function LabResultModal({
  mode,
  item,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  item: LabResult | null;
  onClose: () => void;
  onSaved: (saved: LabResult, mode: 'create' | 'edit') => void;
}) {
  const [form, setForm] = useState({
    product_name: item?.product_name ?? '',
    lab: item?.lab ?? 'PPB Analytical Inc.',
    report_url: item?.report_url ?? '',
    compound: item?.compound ?? '',
    cas_number: item?.cas_number ?? '',
    purity_pct: item?.purity_pct != null ? String(item.purity_pct) : '',
    method: item?.method ?? 'HPLC-UV',
    sample_id: item?.sample_id ?? '',
    matrix: item?.matrix ?? 'Other',
    report_date: item?.report_date ?? '',
    receiving_date: item?.receiving_date ?? '',
    registration_date: item?.registration_date ?? '',
    active: item?.active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!form.product_name.trim() || !form.report_url.trim()) {
      setFormError('Product name and report URL are required.');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form };
      if (mode === 'create') {
        const { labResult } = await apiFetch<{ labResult: LabResult }>(
          '/api/admin/lab-results',
          { method: 'POST', body: JSON.stringify(payload) },
        );
        onSaved({ ...labResult, products: [] }, 'create');
      } else if (item) {
        const { labResult } = await apiFetch<{ labResult: LabResult }>(
          `/api/admin/lab-results/${item.id}`,
          { method: 'PATCH', body: JSON.stringify(payload) },
        );
        onSaved({ ...item, ...labResult }, 'edit');
      }
    } catch (e: any) {
      setFormError(e?.message ?? 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-line px-5 py-4 flex items-center justify-between">
          <h2 className="font-bold text-ink">
            {mode === 'create' ? 'Add lab result' : 'Edit lab result'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-ink-muted hover:text-ink hover:bg-surface rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          {formError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {formError}
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Product name" required>
              <input
                className={inputClass}
                value={form.product_name}
                onChange={(e) => set('product_name', e.target.value)}
                placeholder="KLOW 80MG"
              />
            </Field>
            <Field label="Lab">
              <input
                className={inputClass}
                value={form.lab}
                onChange={(e) => set('lab', e.target.value)}
              />
            </Field>
          </div>

          <Field
            label="Report URL"
            required
            hint="Must match the product's COA URL for the covered-products link to resolve."
          >
            <input
              className={inputClass}
              value={form.report_url}
              onChange={(e) => set('report_url', e.target.value)}
              placeholder="https://…/certificates/report.pdf"
            />
          </Field>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Compound(s)" hint='Blends: separate with "; "'>
              <input
                className={inputClass}
                value={form.compound}
                onChange={(e) => set('compound', e.target.value)}
                placeholder="BPC-157; TB-500; GHK-Cu"
              />
            </Field>
            <Field label="CAS number(s)" hint="Aligned 1:1 with compounds">
              <input
                className={inputClass}
                value={form.cas_number}
                onChange={(e) => set('cas_number', e.target.value)}
                placeholder="137525-51-0; 885340-08-9"
              />
            </Field>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Purity %">
              <input
                type="number"
                step="0.01"
                className={inputClass}
                value={form.purity_pct}
                onChange={(e) => set('purity_pct', e.target.value)}
                placeholder="97.65"
              />
            </Field>
            <Field label="Method">
              <input
                className={inputClass}
                value={form.method}
                onChange={(e) => set('method', e.target.value)}
              />
            </Field>
            <Field label="Sample ID">
              <input
                className={inputClass}
                value={form.sample_id}
                onChange={(e) => set('sample_id', e.target.value)}
                placeholder="5026_0266"
              />
            </Field>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Matrix">
              <input
                className={inputClass}
                value={form.matrix}
                onChange={(e) => set('matrix', e.target.value)}
              />
            </Field>
            <Field label="Result date">
              <input
                type="date"
                className={inputClass}
                value={form.report_date}
                onChange={(e) => set('report_date', e.target.value)}
              />
            </Field>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Receiving date">
              <input
                type="date"
                className={inputClass}
                value={form.receiving_date}
                onChange={(e) => set('receiving_date', e.target.value)}
              />
            </Field>
            <Field label="Registration date">
              <input
                type="date"
                className={inputClass}
                value={form.registration_date}
                onChange={(e) => set('registration_date', e.target.value)}
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set('active', e.target.checked)}
              className="w-4 h-4 rounded border-line text-ink focus:ring-bronze/40"
            />
            <span className="text-sm text-ink">Visible on the public site</span>
          </label>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-ink-muted hover:text-ink transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-ink hover:bg-ink/90 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : mode === 'create' ? 'Add report' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl">
        <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center mb-4">
          <AlertTriangle className="w-5 h-5 text-red-500" />
        </div>
        <h3 className="font-bold text-ink mb-1.5">{title}</h3>
        <p className="text-sm text-ink-muted mb-5">{message}</p>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-ink-muted hover:text-ink transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
