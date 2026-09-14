'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Search, Edit2, X, Loader2, Briefcase, Power, PowerOff, ChevronLeft, ChevronRight } from 'lucide-react';
import { useUserRole } from '../layout';
import { canEdit } from '@/lib/permissions';
import {
  getSalesPersons,
  createSalesPerson,
  updateSalesPerson,
  deleteSalesPerson,
} from '@/lib/admin/sales-persons';
import type { SalesPerson } from '@/lib/types/ecommerce';

const PAGE_SIZE = 20;

const EMPTY_FORM = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  commission_rate: '5',
  notes: '',
};

export default function SalesPersonsPage() {
  const userRole = useUserRole();
  const editable = canEdit(userRole);

  const [salesPersons, setSalesPersons] = useState<SalesPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SalesPerson | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setSalesPersons(await getSalesPersons());
    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormErr('');
    setShowForm(true);
  }

  function openEdit(sp: SalesPerson) {
    setEditing(sp);
    setForm({
      first_name: sp.first_name,
      last_name: sp.last_name,
      email: sp.email ?? '',
      phone: sp.phone ?? '',
      commission_rate: String(sp.commission_rate),
      notes: sp.notes ?? '',
    });
    setFormErr('');
    setShowForm(true);
  }

  async function handleSave() {
    setFormErr('');
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setFormErr('First and last name are required');
      return;
    }
    const rate = parseFloat(form.commission_rate);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      setFormErr('Commission rate must be between 0 and 100');
      return;
    }

    setSaving(true);
    const payload = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      commission_rate: rate,
      notes: form.notes.trim() || undefined,
    };

    const result = editing
      ? await updateSalesPerson(editing.id, payload)
      : await createSalesPerson(payload);

    setSaving(false);

    if (!result.success) {
      setFormErr(result.error ?? 'Failed to save');
      return;
    }
    setShowForm(false);
    await load();
  }

  async function handleToggleActive(sp: SalesPerson) {
    if (sp.active) {
      if (!confirm(`Deactivate ${sp.first_name} ${sp.last_name}?`)) return;
      await deleteSalesPerson(sp.id);
    } else {
      await updateSalesPerson(sp.id, { active: true });
    }
    await load();
  }

  const filtered = salesPersons.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.first_name.toLowerCase().includes(q) ||
      s.last_name.toLowerCase().includes(q) ||
      s.email?.toLowerCase().includes(q)
    );
  });

  // Reset to the first page whenever the search query changes.
  useEffect(() => { setPage(0); }, [search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const rangeStart = filtered.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(filtered.length, (page + 1) * PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">Sales People</h1>
          <p className="text-sm text-ink-muted mt-1">
            {salesPersons.length} total · manage commission rates and contact details
          </p>
        </div>
        {editable && (
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 bg-ink text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-ink/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> New Sales Person
          </button>
        )}
      </div>

      <div className="mb-4 relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
        <input
          type="text"
          placeholder="Search sales people…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-bronze/40"
        />
      </div>

      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                {['Name', 'Email', 'Phone', 'Commission %', 'Total Earnings', 'Status', ''].map((h) => (
                  <th
                    key={h}
                    className={`px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {loading && Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-ink-muted text-sm">
                    {search ? 'No sales people match your search' : 'No sales people yet. Add one to track invoice commissions.'}
                  </td>
                </tr>
              )}
              {!loading && paged.map((sp) => (
                <tr key={sp.id} className="hover:bg-surface transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                        <Briefcase className="w-3.5 h-3.5 text-purple-600" />
                      </div>
                      <div className="font-medium text-ink text-sm">
                        {sp.first_name} {sp.last_name}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sm text-ink-muted">{sp.email || '-'}</td>
                  <td className="px-5 py-4 text-sm text-ink-muted">{sp.phone || '-'}</td>
                  <td className="px-5 py-4 text-sm font-semibold text-ink tabular-nums">
                    {Number(sp.commission_rate).toFixed(2)}%
                  </td>
                  <td className="px-5 py-4 text-sm font-semibold text-emerald-600 tabular-nums">
                    ${Number(sp.total_earnings).toFixed(2)}
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                        sp.active
                          ? 'bg-emerald-500/10 text-emerald-600'
                          : 'bg-gray-500/10 text-gray-500'
                      }`}
                    >
                      {sp.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    {editable && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(sp)}
                          className="text-ink-muted hover:text-ink transition-colors"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleToggleActive(sp)}
                          className={`transition-colors ${
                            sp.active
                              ? 'text-ink-muted hover:text-red-500'
                              : 'text-ink-muted hover:text-emerald-600'
                          }`}
                          title={sp.active ? 'Deactivate' : 'Reactivate'}
                        >
                          {sp.active ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && filtered.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3 border-t border-line">
            <span className="text-sm text-ink-muted">
              Showing <span className="font-medium text-ink tabular-nums">{rangeStart}</span>–
              <span className="font-medium text-ink tabular-nums">{rangeEnd}</span> of{' '}
              <span className="font-medium text-ink tabular-nums">{filtered.length}</span>
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-muted">Page {page + 1} of {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line text-sm text-ink-muted hover:text-ink hover:border-ink/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" /> Prev
              </button>
              <button
                onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
                disabled={page + 1 >= totalPages}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line text-sm text-ink-muted hover:text-ink hover:border-ink/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-ink flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-purple-600" />
                {editing ? 'Edit Sales Person' : 'New Sales Person'}
              </h3>
              <button onClick={() => setShowForm(false)}>
                <X className="w-4 h-4 text-ink-muted" />
              </button>
            </div>
            {formErr && (
              <p className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{formErr}</p>
            )}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink-muted mb-1">First name *</label>
                  <input
                    type="text"
                    value={form.first_name}
                    onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                    className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bronze/40"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-muted mb-1">Last name *</label>
                  <input
                    type="text"
                    value={form.last_name}
                    onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                    className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bronze/40"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bronze/40"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink-muted mb-1">Phone</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bronze/40"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-muted mb-1">Commission %</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={form.commission_rate}
                    onChange={(e) => setForm({ ...form, commission_rate: e.target.value })}
                    className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bronze/40"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-bronze/40"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 px-4 py-2 border border-line rounded-lg text-sm text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editing ? 'Save Changes' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      <td className="px-5 py-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-surface flex-shrink-0" />
          <div className="h-3.5 w-32 bg-surface rounded" />
        </div>
      </td>
      <td className="px-5 py-4"><div className="h-3.5 w-40 bg-surface rounded" /></td>
      <td className="px-5 py-4"><div className="h-3.5 w-24 bg-surface rounded" /></td>
      <td className="px-5 py-4"><div className="h-3.5 w-12 bg-surface rounded" /></td>
      <td className="px-5 py-4"><div className="h-3.5 w-16 bg-surface rounded" /></td>
      <td className="px-5 py-4"><div className="h-5 w-16 bg-surface rounded-full" /></td>
      <td className="px-5 py-4">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-surface rounded" />
          <div className="w-4 h-4 bg-surface rounded" />
        </div>
      </td>
    </tr>
  );
}
