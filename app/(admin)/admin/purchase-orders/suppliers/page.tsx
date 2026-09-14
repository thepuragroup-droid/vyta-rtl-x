'use client';

import React, { useState, useEffect } from 'react';
import {
  ArrowLeft, Plus, Search, Edit2, Trash2, Check, X, Loader2,
  Building2, Clock,
} from 'lucide-react';
import Link from 'next/link';
import {
  getAllSuppliers, createSupplier, updateSupplier, deleteSupplier,
} from '@/lib/admin/purchase-orders';
import type { Supplier } from '@/lib/types/ecommerce';

type SupplierDraft = {
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  lead_time_days: number;
  notes: string;
};

const EMPTY: SupplierDraft = {
  name: '', contact_name: '', email: '', phone: '', lead_time_days: 7, notes: '',
};

function SupplierForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: SupplierDraft;
  onSave: (d: SupplierDraft) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState(initial);

  const fields: { label: string; key: keyof SupplierDraft; type: string; span?: boolean }[] = [
    { label: 'Company Name *', key: 'name', type: 'text', span: true },
    { label: 'Contact Person', key: 'contact_name', type: 'text' },
    { label: 'Email', key: 'email', type: 'email' },
    { label: 'Phone', key: 'phone', type: 'tel' },
    { label: 'Lead Time (days)', key: 'lead_time_days', type: 'number' },
  ];

  return (
    <div className="p-5 bg-surface border-b border-line">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        {fields.map(({ label, key, type, span }) => (
          <div key={key} className={span ? 'sm:col-span-2' : ''}>
            <label className="block text-xs font-medium text-ink-muted mb-1">{label}</label>
            <input
              type={type}
              min={type === 'number' ? 1 : undefined}
              value={draft[key] as string | number}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  [key]: type === 'number' ? parseInt(e.target.value) || 1 : e.target.value,
                }))
              }
              className="w-full px-3 py-2 bg-white border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bronze/40"
            />
          </div>
        ))}
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-ink-muted mb-1">Notes</label>
          <textarea
            value={draft.notes}
            onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))}
            rows={2}
            className="w-full px-3 py-2 bg-white border border-line rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-bronze/40"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 border border-line rounded-lg text-xs text-ink-muted hover:text-ink"
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(draft)}
          disabled={saving || !draft.name.trim()}
          className="px-4 py-1.5 bg-ink text-white rounded-lg text-xs font-medium hover:bg-ink/90 disabled:opacity-50 flex items-center gap-1.5"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
          Save Supplier
        </button>
      </div>
    </div>
  );
}

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [showNewForm, setShowNewForm] = useState(false);
  const [savingNew, setSavingNew] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const data = await getAllSuppliers();
    setSuppliers(data);
    setLoading(false);
  }

  const filtered = suppliers.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.email?.toLowerCase().includes(q) ||
      s.contact_name?.toLowerCase().includes(q)
    );
  });

  async function handleCreate(draft: SupplierDraft) {
    if (!draft.name.trim()) return;
    setSavingNew(true);
    setError('');
    const result = await createSupplier({
      name: draft.name.trim(),
      contact_name: draft.contact_name.trim() || null,
      email: draft.email.trim() || null,
      phone: draft.phone.trim() || null,
      lead_time_days: draft.lead_time_days,
      notes: (draft.notes.trim() || null) as string | null,
    } as any);
    setSavingNew(false);
    if (!result.success) { setError(result.error ?? 'Failed to create supplier'); return; }
    setShowNewForm(false);
    await load();
  }

  async function handleUpdate(id: string, draft: SupplierDraft) {
    setSavingEdit(true);
    setError('');
    const result = await updateSupplier(id, {
      name: draft.name.trim(),
      contact_name: draft.contact_name.trim() || null,
      email: draft.email.trim() || null,
      phone: draft.phone.trim() || null,
      lead_time_days: draft.lead_time_days,
      notes: draft.notes.trim() || null,
    });
    setSavingEdit(false);
    if (!result.success) { setError(result.error ?? 'Failed to update supplier'); return; }
    setEditingId(null);
    await load();
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setError('');
    const result = await deleteSupplier(id);
    setDeletingId(null);
    setConfirmDeleteId(null);
    if (!result.success) { setError(result.error ?? 'Failed to delete supplier'); return; }
    setSuppliers((prev) => prev.filter((s) => s.id !== id));
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/admin/purchase-orders" className="text-ink-muted hover:text-ink transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-ink">Suppliers</h1>
            <p className="text-sm text-ink-muted mt-1">{suppliers.length} supplier{suppliers.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <button
          onClick={() => { setShowNewForm(true); setEditingId(null); }}
          className="inline-flex items-center gap-2 bg-ink text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-ink/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Supplier
        </button>
      </div>

      {error && (
        <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
        <input
          type="text"
          placeholder="Search by name, email, or contact…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-bronze/40"
        />
      </div>

      {/* New supplier form */}
      {showNewForm && (
        <div className="bg-white rounded-xl border border-line mb-4 overflow-hidden">
          <div className="px-5 py-3 border-b border-line bg-surface flex items-center gap-2">
            <Building2 className="w-4 h-4 text-ink-muted" />
            <span className="text-sm font-semibold text-ink">New Supplier</span>
          </div>
          <SupplierForm
            initial={EMPTY}
            onSave={handleCreate}
            onCancel={() => setShowNewForm(false)}
            saving={savingNew}
          />
        </div>
      )}

      {/* Supplier list */}
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        {loading && (
          <div className="flex justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-ink-muted" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="py-16 text-center text-ink-muted text-sm">
            {search ? 'No suppliers match your search' : 'No suppliers yet — add one above'}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="divide-y divide-line/50">
            {filtered.map((supplier) => (
              <div key={supplier.id}>
                {editingId === supplier.id ? (
                  <SupplierForm
                    initial={{
                      name: supplier.name,
                      contact_name: supplier.contact_name ?? '',
                      email: supplier.email ?? '',
                      phone: supplier.phone ?? '',
                      lead_time_days: supplier.lead_time_days ?? 7,
                      notes: (supplier as any).notes ?? '',
                    }}
                    onSave={(d) => handleUpdate(supplier.id, d)}
                    onCancel={() => setEditingId(null)}
                    saving={savingEdit}
                  />
                ) : (
                  <div className="flex items-center justify-between px-5 py-4 hover:bg-surface transition-colors">
                    <div className="flex items-start gap-4 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-bronze/10 flex items-center justify-center flex-shrink-0">
                        <Building2 className="w-4 h-4 text-bronze" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">{supplier.name}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                          {supplier.contact_name && (
                            <span className="text-xs text-ink-muted">{supplier.contact_name}</span>
                          )}
                          {supplier.email && (
                            <span className="text-xs text-ink-muted">{supplier.email}</span>
                          )}
                          {supplier.phone && (
                            <span className="text-xs text-ink-muted">{supplier.phone}</span>
                          )}
                        </div>
                        {supplier.lead_time_days && (
                          <div className="flex items-center gap-1 mt-1">
                            <Clock className="w-3 h-3 text-bronze" />
                            <span className="text-xs text-bronze">{supplier.lead_time_days} day lead time</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0 ml-4">
                      {confirmDeleteId === supplier.id ? (
                        <div className="flex items-center gap-2 mr-1">
                          <span className="text-xs text-ink-muted">Confirm delete?</span>
                          <button
                            onClick={() => handleDelete(supplier.id)}
                            disabled={deletingId === supplier.id}
                            className="px-2 py-1 bg-red-500 text-white rounded text-xs font-medium hover:bg-red-600 disabled:opacity-50 flex items-center gap-1"
                          >
                            {deletingId === supplier.id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : 'Delete'
                            }
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1 border border-line rounded text-xs text-ink-muted hover:text-ink"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => { setEditingId(supplier.id); setShowNewForm(false); }}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(supplier.id)}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-red-500 hover:bg-red-50 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
