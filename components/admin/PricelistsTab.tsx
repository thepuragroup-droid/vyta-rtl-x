'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus, Tag, Check, Loader2, Trash2, Pencil, ChevronDown, ChevronUp,
  Search, Star, X,
} from 'lucide-react';
import {
  getPricelists, getPricelist, createPricelist, updatePricelist,
  setActivePricelist, deletePricelist,
  type PricelistListItem, type PricelistItemWithProduct,
} from '@/lib/admin/pricelists';
import { useUserRole } from '@/app/(admin)/admin/layout';

export default function PricelistsTab() {
  const role = useUserRole();
  const mayWrite = role === 'admin';

  const [lists, setLists] = useState<PricelistListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // create
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [cloneFrom, setCloneFrom] = useState('');
  const [creating, setCreating] = useState(false);

  // expanded editor
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setLists(await getPricelists());
    setLoading(false);
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    setError('');
    const res = await createPricelist(newName.trim(), cloneFrom || undefined);
    setCreating(false);
    if (!res.success) { setError(res.error ?? 'Failed to create pricelist'); return; }
    setShowNew(false); setNewName(''); setCloneFrom('');
    await load();
    if (res.pricelist) setExpandedId(res.pricelist.id);
  }

  async function handleActivate(id: string) {
    setBusyId(id);
    const res = await setActivePricelist(id);
    setBusyId(null);
    if (!res.success) { setError(res.error ?? 'Failed to activate'); return; }
    await load();
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    const res = await deletePricelist(id);
    setBusyId(null);
    setConfirmDeleteId(null);
    if (!res.success) { setError(res.error ?? 'Failed to delete'); return; }
    if (expandedId === id) setExpandedId(null);
    await load();
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Tag className="w-6 h-6 text-teal-dark" /> Pricelists
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            The active pricelist sets default invoice line prices.
          </p>
        </div>
        {mayWrite && (
          <button
            onClick={() => setShowNew((v) => !v)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink hover:bg-ink/90 text-white rounded-lg text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> New Pricelist
          </button>
        )}
      </div>

      {error && (
        <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* New pricelist */}
      {showNew && mayWrite && (
        <div className="bg-white rounded-xl border border-line p-5 mb-5">
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">New Pricelist</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">Name *</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Wholesale 2026"
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">Clone prices from</label>
              <select
                value={cloneFrom}
                onChange={(e) => setCloneFrom(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
              >
                <option value="">Catalog defaults</option>
                {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={() => { setShowNew(false); setNewName(''); setCloneFrom(''); }} className="px-3 py-1.5 border border-line rounded-lg text-xs text-ink-muted hover:text-ink">Cancel</button>
            <button onClick={handleCreate} disabled={creating || !newName.trim()} className="px-4 py-1.5 bg-ink text-white rounded-lg text-xs font-medium hover:bg-ink/90 disabled:opacity-50 flex items-center gap-1.5">
              {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Create
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-ink-muted" /></div>
        ) : lists.length === 0 ? (
          <div className="py-16 text-center text-ink-muted text-sm">No pricelists yet.</div>
        ) : (
          <div className="divide-y divide-line/50">
            {lists.map((pl) => (
              <div key={pl.id}>
                <div className="flex items-center justify-between px-5 py-4 hover:bg-surface transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-teal/10 flex items-center justify-center flex-shrink-0">
                      <Tag className="w-4 h-4 text-teal-dark" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-ink truncate">{pl.name}</p>
                        {pl.is_active && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 border border-emerald-200">
                            <Star className="w-2.5 h-2.5" /> Active
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-ink-muted">{pl.item_count} product{pl.item_count === 1 ? '' : 's'}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {mayWrite && !pl.is_active && (
                      <button onClick={() => handleActivate(pl.id)} disabled={busyId === pl.id} className="px-3 py-1.5 rounded-lg border border-line text-xs text-ink-muted hover:text-ink hover:border-ink/20 disabled:opacity-40 flex items-center gap-1.5">
                        {busyId === pl.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Star className="w-3 h-3" />} Set active
                      </button>
                    )}
                    <button
                      onClick={() => setExpandedId(expandedId === pl.id ? null : pl.id)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface transition-colors"
                      title="Edit prices"
                    >
                      {expandedId === pl.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    {mayWrite && (
                      confirmDeleteId === pl.id ? (
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleDelete(pl.id)} disabled={busyId === pl.id} className="px-2 py-1 bg-red-500 text-white rounded text-xs font-medium hover:bg-red-600 disabled:opacity-50">
                            {busyId === pl.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Delete'}
                          </button>
                          <button onClick={() => setConfirmDeleteId(null)} className="px-2 py-1 border border-line rounded text-xs text-ink-muted hover:text-ink">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDeleteId(pl.id)} className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-red-500 hover:bg-red-50 transition-colors" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )
                    )}
                  </div>
                </div>

                {expandedId === pl.id && (
                  <PricelistEditor id={pl.id} name={pl.name} mayWrite={mayWrite} onRenamed={load} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function PricelistEditor({
  id, name, mayWrite, onRenamed,
}: { id: string; name: string; mayWrite: boolean; onRenamed: () => void }) {
  const [items, setItems] = useState<PricelistItemWithProduct[]>([]);
  const [edited, setEdited] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    getPricelist(id).then((res) => {
      if (res) setItems(res.items);
      setLoading(false);
    });
  }, [id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => (i.product?.name ?? '').toLowerCase().includes(q));
  }, [items, search]);

  const dirty = Object.keys(edited).length;

  function priceOf(i: PricelistItemWithProduct) {
    return i.product_id in edited ? edited[i.product_id] : Number(i.price);
  }

  async function save() {
    setSaving(true);
    setError('');
    const itemPatch = Object.entries(edited).map(([product_id, price]) => ({ product_id, price }));
    const namePatch = editingName && draftName.trim() && draftName.trim() !== name ? { name: draftName.trim() } : {};
    const res = await updatePricelist(id, { ...namePatch, items: itemPatch });
    setSaving(false);
    if (!res.success) { setError(res.error ?? 'Failed to save'); return; }
    setItems((prev) => prev.map((i) => i.product_id in edited ? { ...i, price: edited[i.product_id] } : i));
    setEdited({});
    if (namePatch.name) { setEditingName(false); onRenamed(); }
  }

  return (
    <div className="bg-surface/50 border-t border-line px-5 py-4">
      {error && <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{error}</div>}

      <div className="flex flex-col sm:flex-row gap-3 mb-3">
        {mayWrite && editingName ? (
          <div className="flex items-center gap-2">
            <input value={draftName} onChange={(e) => setDraftName(e.target.value)} className="px-3 py-1.5 bg-white border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal/40" />
          </div>
        ) : mayWrite ? (
          <button onClick={() => { setEditingName(true); setDraftName(name); }} className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink">
            <Pencil className="w-3 h-3" /> Rename
          </button>
        ) : null}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter products…" className="w-full pl-9 pr-3 py-1.5 bg-white border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal/40" />
        </div>
        {mayWrite && (
          <button onClick={save} disabled={saving || (dirty === 0 && !editingName)} className="px-4 py-1.5 bg-ink text-white rounded-lg text-xs font-medium hover:bg-ink/90 disabled:opacity-40 flex items-center gap-1.5">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            {dirty > 0 ? `Save ${dirty}` : 'Save'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-4 h-4 animate-spin text-ink-muted" /></div>
      ) : (
        <div className="bg-white rounded-lg border border-line overflow-hidden max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0">
              <tr className="border-b border-line bg-surface">
                <th className="px-4 py-2 text-left text-xs text-ink-muted font-semibold uppercase tracking-wide">Product</th>
                <th className="px-4 py-2 text-right text-xs text-ink-muted font-semibold uppercase tracking-wide">Catalog</th>
                <th className="px-4 py-2 text-right text-xs text-ink-muted font-semibold uppercase tracking-wide w-36">List Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {filtered.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-2 text-ink">{i.product?.name ?? '—'}{i.product?.strength ? <span className="text-ink-muted"> · {i.product.strength}</span> : null}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-muted">${Number(i.product?.price ?? 0).toFixed(2)}</td>
                  <td className="px-4 py-2">
                    <div className="relative flex justify-end">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink-muted">$</span>
                      <input
                        type="number" min={0} step="0.01"
                        value={priceOf(i)}
                        disabled={!mayWrite}
                        onChange={(e) => setEdited((p) => ({ ...p, [i.product_id]: Math.max(0, parseFloat(e.target.value) || 0) }))}
                        className={`w-28 pl-5 pr-2 py-1 border rounded-lg text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-teal/40 ${i.product_id in edited ? 'bg-teal/5 border-teal/40' : 'bg-surface border-line'}`}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
