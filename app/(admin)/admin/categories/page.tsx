'use client';

import React, { useEffect, useState } from 'react';
import {
  Tags, Plus, Save, Trash2, X, ChevronUp, ChevronDown, GripVertical,
  Eye, EyeOff, Star, AlertCircle, Check, Loader2, Info,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { apiFetch } from '@/lib/api-fetch';
import { usePermissions } from '@/lib/hooks/usePermissions';
import {
  getCategoryIcon, CATEGORY_ICON_KEYS, type StoreCategory,
} from '@/lib/categories';

interface Draft {
  slug: string;
  name: string;
  description: string;
  icon: string;
  active: boolean;
  featured: boolean;
}

function toDraft(c: StoreCategory): Draft {
  return {
    slug: c.slug,
    name: c.name,
    description: c.description ?? '',
    icon: c.icon,
    active: c.active,
    featured: c.featured,
  };
}

function draftEquals(a: Draft, b: Draft): boolean {
  return (
    a.slug === b.slug &&
    a.name === b.name &&
    a.description === b.description &&
    a.icon === b.icon &&
    a.active === b.active &&
    a.featured === b.featured
  );
}

export default function CategoriesManagementPage() {
  const { canManageCategories } = usePermissions();
  const canManage = canManageCategories;

  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState<Draft & { slug: string }>({
    slug: '', name: '', description: '', icon: 'Beaker', active: true, featured: false,
  });
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<StoreCategory | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getToken = async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? '';
  };

  const applyList = (list: StoreCategory[]) => {
    setCategories(list);
    setDrafts(Object.fromEntries(list.map((c) => [c.id, toDraft(c)])));
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const token = await getToken();
      const { categories: list } = await apiFetch<{ categories: StoreCategory[] }>(
        '/api/admin/categories',
        { headers: { Authorization: `Bearer ${token}` } },
      );
      applyList(list ?? []);
    } catch {
      setError('Failed to load categories');
    }
    setLoading(false);
  };

  const setDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const isDirty = (c: StoreCategory) => {
    const d = drafts[c.id];
    return d ? !draftEquals(d, toDraft(c)) : false;
  };

  const saveRow = async (c: StoreCategory) => {
    const d = drafts[c.id];
    if (!d || !d.name.trim()) { setError('Name cannot be empty'); return; }
    if (!d.slug.trim()) { setError('Slug cannot be empty'); return; }
    setSavingId(c.id);
    setError('');
    setSuccess('');
    try {
      const token = await getToken();
      const { category } = await apiFetch<{ category: StoreCategory }>(
        `/api/admin/categories/${c.id}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            slug: d.slug.trim(),
            name: d.name.trim(),
            description: d.description,
            icon: d.icon,
            active: d.active,
            featured: d.featured,
          }),
        },
      );
      setCategories((prev) => prev.map((x) => (x.id === c.id ? category : x)));
      setDrafts((prev) => ({ ...prev, [c.id]: toDraft(category) }));
      setSuccess('Category saved');
    } catch (err: any) {
      setError(err?.message || 'Failed to save category');
    }
    setSavingId(null);
  };

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= categories.length || reordering) return;
    const next = categories.slice();
    [next[index], next[target]] = [next[target], next[index]];
    setCategories(next);
    setReordering(true);
    setError('');
    try {
      const token = await getToken();
      const { categories: list } = await apiFetch<{ categories: StoreCategory[] }>(
        '/api/admin/categories',
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({ order: next.map((c) => c.id) }),
        },
      );
      applyList(list ?? next);
    } catch {
      setError('Failed to reorder categories');
      load();
    }
    setReordering(false);
  };

  const addCategory = async () => {
    if (!addForm.slug.trim() || !addForm.name.trim()) {
      setAddError('Slug and name are required');
      return;
    }
    setAddSaving(true);
    setAddError('');
    try {
      const token = await getToken();
      await apiFetch('/api/admin/categories', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          slug: addForm.slug.trim(),
          name: addForm.name.trim(),
          description: addForm.description || null,
          icon: addForm.icon,
          active: addForm.active,
          featured: addForm.featured,
        }),
      });
      setShowAddModal(false);
      setAddForm({ slug: '', name: '', description: '', icon: 'Beaker', active: true, featured: false });
      setSuccess('Category created');
      load();
    } catch (err: any) {
      setAddError(err?.message || 'Failed to create category');
    }
    setAddSaving(false);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const token = await getToken();
      await apiFetch(`/api/admin/categories/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': '' },
      });
      setDeleteTarget(null);
      setSuccess('Category deleted');
      load();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete category');
    }
    setDeleting(false);
  };

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink flex items-center gap-2">
            <Tags className="w-6 h-6 text-bronze" />
            Categories
          </h1>
          <p className="text-ink-muted text-sm mt-1">
            The controlled taxonomy that drives the products filter bar and homepage grid.
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => { setShowAddModal(true); setAddError(''); }}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Category
          </button>
        )}
      </div>

      {!canManage && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-2">
          <Info className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <p className="text-xs text-amber-700">Read-only access. Contact an administrator to make changes.</p>
        </div>
      )}

      {/* Alerts */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="flex-1 text-sm text-red-800">{error}</p>
          <button onClick={() => setError('')} className="text-red-500 hover:text-red-700"><X className="w-4 h-4" /></button>
        </div>
      )}
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-6 flex items-start gap-3">
          <Check className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
          <p className="flex-1 text-sm text-emerald-800">{success}</p>
          <button onClick={() => setSuccess('')} className="text-emerald-500 hover:text-emerald-700"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* List */}
      <div className="bg-white rounded-xl border border-line">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-ink-muted text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : categories.length === 0 ? (
          <div className="py-16 text-center text-ink-muted text-sm">No categories yet.</div>
        ) : (
          <div className="divide-y divide-line/60">
            {categories.map((c, index) => {
              const d = drafts[c.id] ?? toDraft(c);
              const Icon = getCategoryIcon(d.icon);
              const dirty = isDirty(c);
              return (
                <div key={c.id} className="flex flex-col lg:flex-row gap-4 p-4">
                  {/* Reorder */}
                  <div className="flex lg:flex-col items-center justify-center gap-1 text-ink-muted">
                    <button
                      onClick={() => move(index, -1)}
                      disabled={!canManage || index === 0 || reordering}
                      className="p-1 rounded hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move up"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <GripVertical className="w-4 h-4 text-line" />
                    <button
                      onClick={() => move(index, 1)}
                      disabled={!canManage || index === categories.length - 1 || reordering}
                      className="p-1 rounded hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move down"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Icon preview */}
                  <div className="flex-shrink-0">
                    <div className="w-11 h-11 rounded-lg bg-ink flex items-center justify-center">
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                  </div>

                  {/* Fields */}
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-ink-muted mb-1">Name</label>
                      <input
                        type="text"
                        value={d.name}
                        disabled={!canManage}
                        onChange={(e) => setDraft(c.id, { name: e.target.value })}
                        className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40 disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-ink-muted mb-1">Slug (product-join key)</label>
                      <input
                        type="text"
                        value={d.slug}
                        disabled={!canManage}
                        onChange={(e) => setDraft(c.id, { slug: e.target.value })}
                        className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink font-mono focus:outline-none focus:ring-2 focus:ring-bronze/40 disabled:opacity-60"
                      />
                      <p className="mt-1 text-[10px] text-ink-muted">Renaming updates all linked products.</p>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-ink-muted mb-1">Icon</label>
                      <select
                        value={d.icon}
                        disabled={!canManage}
                        onChange={(e) => setDraft(c.id, { icon: e.target.value })}
                        className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40 disabled:opacity-60"
                      >
                        {CATEGORY_ICON_KEYS.map((k) => (
                          <option key={k} value={k}>{k}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-ink-muted mb-1">Homepage subtitle</label>
                      <input
                        type="text"
                        value={d.description}
                        disabled={!canManage}
                        onChange={(e) => setDraft(c.id, { description: e.target.value })}
                        className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40 disabled:opacity-60"
                      />
                    </div>
                  </div>

                  {/* Actions column */}
                  <div className="flex flex-row lg:flex-col items-stretch gap-2 lg:w-40">
                    <button
                      onClick={() => canManage && setDraft(c.id, { active: !d.active })}
                      disabled={!canManage}
                      className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:cursor-not-allowed ${
                        d.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-gray-500/10 text-ink-muted'
                      }`}
                    >
                      {d.active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      {d.active ? 'Active' : 'Hidden'}
                    </button>
                    <button
                      onClick={() => canManage && setDraft(c.id, { featured: !d.featured })}
                      disabled={!canManage}
                      className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:cursor-not-allowed ${
                        d.featured ? 'bg-bronze/10 text-bronze' : 'bg-gray-500/10 text-ink-muted'
                      }`}
                    >
                      <Star className="w-3.5 h-3.5" />
                      {d.featured ? 'Homepage' : 'Not featured'}
                    </button>
                    {canManage && (
                      <div className="flex gap-2 lg:mt-1">
                        <button
                          onClick={() => saveRow(c)}
                          disabled={!dirty || savingId === c.id}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-ink text-white rounded-lg text-xs font-semibold hover:bg-ink/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {savingId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          Save
                        </button>
                        <button
                          onClick={() => setDeleteTarget(c)}
                          className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                          title="Delete category"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-ink">Add Category</h2>
              <button onClick={() => setShowAddModal(false)} className="text-ink-muted hover:text-ink"><X className="w-5 h-5" /></button>
            </div>
            {addError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-800">{addError}</p>
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Slug <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={addForm.slug}
                  onChange={(e) => setAddForm({ ...addForm, slug: e.target.value })}
                  placeholder="Weight Loss / Metabolic"
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
                />
                <p className="mt-1 text-[10px] text-ink-muted">Stable key — must equal the products&apos; category string. Cannot be changed later.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={addForm.name}
                  onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                  placeholder="Metabolic"
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Icon</label>
                <select
                  value={addForm.icon}
                  onChange={(e) => setAddForm({ ...addForm, icon: e.target.value })}
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
                >
                  {CATEGORY_ICON_KEYS.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Homepage subtitle</label>
                <input
                  type="text"
                  value={addForm.description}
                  onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
                />
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-ink">
                  <input type="checkbox" checked={addForm.active} onChange={(e) => setAddForm({ ...addForm, active: e.target.checked })} className="w-4 h-4 text-bronze border-line rounded focus:ring-bronze/40" />
                  Active
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-ink">
                  <input type="checkbox" checked={addForm.featured} onChange={(e) => setAddForm({ ...addForm, featured: e.target.checked })} className="w-4 h-4 text-bronze border-line rounded focus:ring-bronze/40" />
                  Featured (homepage)
                </label>
              </div>
            </div>
            <div className="flex gap-3 pt-6">
              <button onClick={() => setShowAddModal(false)} className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg text-sm font-medium hover:bg-line/50 transition-colors">Cancel</button>
              <button
                onClick={addCategory}
                disabled={addSaving}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90 transition-colors disabled:opacity-50"
              >
                {addSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-ink">Delete Category</h2>
              <button onClick={() => setDeleteTarget(null)} className="text-ink-muted hover:text-ink"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-ink-muted mb-6">
              Delete <strong>{deleteTarget.name}</strong>? Products tagged <span className="font-mono">{deleteTarget.slug}</span> keep
              their tag; the category simply stops appearing in the filter and homepage.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg text-sm font-medium hover:bg-line/50 transition-colors">Cancel</button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-red-500 text-white rounded-lg text-sm font-semibold hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
