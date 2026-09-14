'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Plus, Search, ListChecks, Table as TableIcon, LayoutGrid, Save, X,
  Loader2, ArrowRight, Trash2, Circle, CircleDot, Lock, ExternalLink,
  Copy, Package, Calendar, User, Users2, AlertTriangle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { usePermissions } from '@/lib/hooks/usePermissions';
import MultiSelectCustomer from '@/components/admin/MultiSelectCustomer';
import {
  getPricelists,
  createPricelist,
  updatePricelist,
  deletePricelist,
  applyPricelistToCustomer,
  type PricelistListItem,
} from '@/lib/admin/pricelists';

interface CustomerOption {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
}

type Layout = 'table' | 'card';

/**
 * Price Lists workspace — CRUD + activate + create modal.
 *
 * A pinned "Default Prices" pseudo-list always renders at the top of the
 * list (unless a search filter hides it). It represents `products.price`
 * and is Active when no custom list is active — clicking "Use default"
 * deactivates the currently-active list.
 */
export default function PriceListsView() {
  const { canCreate, canDelete } = usePermissions();

  const [lists, setLists] = useState<PricelistListItem[]>([]);
  const [activeProductCount, setActiveProductCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [layout, setLayout] = useState<Layout>('card');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newSource, setNewSource] = useState<string>('');

  // Per-row activity spinners so a slow API call doesn't lock the page.
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Apply-to-customer modal state.
  const [applyList, setApplyList] = useState<PricelistListItem | null>(null);
  const [applyCustomerIds, setApplyCustomerIds] = useState<string[]>([]);
  const [applyMode, setApplyMode] = useState<'override' | 'keep_existing'>('override');
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyResult, setApplyResult] = useState<{ applied: number; skipped: number } | null>(null);
  // Customers are fetched once (lazy on modal open) and shared across
  // subsequent opens — a workspace typically has < 500 customers so a
  // client-side list is fine.
  const [customers, setCustomers] = useState<CustomerOption[] | null>(null);
  const [customersLoading, setCustomersLoading] = useState(false);

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    setLoading(true);
    setError('');
    try {
      const [ls, prodCount] = await Promise.all([
        getPricelists(),
        fetchActiveProductCount(),
      ]);
      setLists(ls);
      setActiveProductCount(prodCount);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load price lists');
    }
    setLoading(false);
  }

  async function fetchActiveProductCount(): Promise<number> {
    // Count only active products so the Default pseudo-list matches the
    // catalogue that would actually be applied.
    const { count } = await supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('active', true);
    return Number(count) || 0;
  }

  const activeList = useMemo(() => lists.find((l) => l.is_active) ?? null, [lists]);
  const anyCustomActive = !!activeList;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return lists;
    return lists.filter(
      (l) =>
        l.name.toLowerCase().includes(q)
        || (l.description ?? '').toLowerCase().includes(q),
    );
  }, [lists, search]);

  // The Default row hides only when a search filter is on and the query
  // doesn't match "default"/"defaults".
  const showDefault = !search.trim() || 'default'.startsWith(search.trim().toLowerCase());

  function flashSuccess(msg: string) {
    setSuccess(msg);
    setTimeout(() => setSuccess(''), 3500);
  }

  async function activate(list: PricelistListItem) {
    setActivatingId(list.id);
    setError('');
    const res = await updatePricelist(list.id, { is_active: true });
    setActivatingId(null);
    if (!res.success) {
      setError(res.error ?? 'Failed to activate list');
      return;
    }
    flashSuccess(`Activated "${list.name}"`);
    fetchAll();
  }

  async function deactivate(list: PricelistListItem) {
    // "Deactivate" a list = fall back to default. Since the server enforces
    // a single-active invariant, simply flipping is_active=false is fine.
    setActivatingId(list.id);
    setError('');
    const res = await updatePricelist(list.id, { is_active: false });
    setActivatingId(null);
    if (!res.success) {
      setError(res.error ?? 'Failed to deactivate list');
      return;
    }
    flashSuccess('Now using default product prices');
    fetchAll();
  }

  async function useDefault() {
    if (!activeList) return;
    await deactivate(activeList);
  }

  async function handleDelete(list: PricelistListItem) {
    const yes = window.confirm(
      `Delete "${list.name}"? Any customer overrides previously applied from this list will remain in place — only the list itself is removed.`,
    );
    if (!yes) return;
    setDeletingId(list.id);
    const res = await deletePricelist(list.id);
    setDeletingId(null);
    if (!res.success) {
      setError(res.error ?? 'Failed to delete list');
      return;
    }
    flashSuccess(`Deleted "${list.name}"`);
    fetchAll();
  }

  async function fetchCustomersOnce() {
    if (customers !== null || customersLoading) return;
    setCustomersLoading(true);
    const { data } = await supabase
      .from('customers')
      .select('id, first_name, last_name, email')
      .eq('active', true)
      .order('last_name', { ascending: true });
    setCustomers((data ?? []) as CustomerOption[]);
    setCustomersLoading(false);
  }

  function openApply(list: PricelistListItem) {
    setApplyList(list);
    setApplyCustomerIds([]);
    setApplyMode('override');
    setApplyResult(null);
    fetchCustomersOnce();
  }

  function closeApply() {
    setApplyList(null);
    setApplyCustomerIds([]);
    setApplyResult(null);
    setApplyBusy(false);
  }

  async function confirmApply() {
    if (!applyList || applyCustomerIds.length !== 1) return;
    setApplyBusy(true);
    setError('');
    const customerId = applyCustomerIds[0];
    const res = await applyPricelistToCustomer(applyList.id, customerId, applyMode);
    setApplyBusy(false);
    if (!res.success) {
      setError(res.error ?? 'Failed to apply pricelist');
      return;
    }
    setApplyResult({ applied: res.applied ?? 0, skipped: res.skipped ?? 0 });
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    setError('');
    const res = await createPricelist({
      name: newName.trim(),
      description: newDescription.trim() || undefined,
      source_pricelist_id: newSource || undefined,
    });
    setCreating(false);
    if (!res.success) {
      setError(res.error ?? 'Failed to create list');
      return;
    }
    setShowCreate(false);
    setNewName('');
    setNewDescription('');
    setNewSource('');
    flashSuccess(`Created "${res.pricelist?.name}"`);
    fetchAll();
  }

  function fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-CA', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  function creatorName(list: PricelistListItem): string {
    const c: any = (list as any).creator;
    if (!c) return 'System';
    const full = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
    return full || c.email || 'Unknown';
  }

  return (
    <>
      {/* Alerts */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <p className="text-sm text-red-800 flex-1">{error}</p>
          <button onClick={() => setError('')} className="text-red-500 hover:text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {success && (
        <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-3">
          <p className="text-sm text-emerald-800 flex-1">{success}</p>
          <button onClick={() => setSuccess('')} className="text-emerald-600 hover:text-emerald-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <input
            type="text"
            placeholder="Search price lists…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
          />
        </div>

        <div className="inline-flex rounded-lg border border-line bg-surface p-1">
          {([
            { v: 'table', l: 'Table', I: TableIcon },
            { v: 'card', l: 'Cards', I: LayoutGrid },
          ] as const).map(({ v, l, I }) => (
            <button
              key={v}
              onClick={() => setLayout(v as Layout)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                layout === v
                  ? 'bg-white text-ink shadow-sm border border-line'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              <I className="w-3.5 h-3.5" /> {l}
            </button>
          ))}
        </div>

        {canCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90"
          >
            <Plus className="w-4 h-4" />
            New Price List
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-teal-dark" />
        </div>
      ) : layout === 'table' ? (
        renderTable()
      ) : (
        renderCards()
      )}

      {/* Apply-to-customer modal */}
      {applyList && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
                <Users2 className="w-5 h-5 text-teal-dark" /> Apply price list
              </h2>
              <button onClick={closeApply} className="text-ink-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>

            {applyResult ? (
              <div className="text-center py-6">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-600 mb-3">
                  <CircleDot className="w-6 h-6" />
                </div>
                <p className="text-ink font-medium">
                  Applied <strong>{applyResult.applied}</strong> price{applyResult.applied === 1 ? '' : 's'}
                  {applyResult.skipped > 0 && (
                    <> · skipped {applyResult.skipped} (already had override)</>
                  )}
                </p>
                <p className="text-xs text-ink-muted mt-2">
                  <em>{applyList.name}</em> is now stamped on the customer as their price list.
                </p>
                <button
                  onClick={closeApply}
                  className="mt-5 px-4 py-2 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <p className="text-sm text-ink-muted mb-4">
                  Copies every price in <strong className="text-ink">{applyList.name}</strong> onto a
                  customer&apos;s pricing overrides. The list stays linked to the customer so
                  future changes can be re-applied.
                </p>

                <div className="mb-4">
                  <label className="block text-xs font-medium text-ink-muted mb-1">Customer *</label>
                  {customersLoading ? (
                    <div className="inline-flex items-center gap-2 text-xs text-ink-muted">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading customers…
                    </div>
                  ) : (
                    <MultiSelectCustomer
                      customers={customers ?? []}
                      selectedIds={applyCustomerIds}
                      onChange={setApplyCustomerIds}
                      single
                      label="Pick one customer"
                    />
                  )}
                </div>

                <div className="mb-4">
                  <label className="block text-xs font-medium text-ink-muted mb-2">If they already have overrides…</label>
                  <div className="inline-flex rounded-lg border border-line bg-surface p-1">
                    {([
                      { v: 'override', l: 'List wins' },
                      { v: 'keep_existing', l: 'Keep existing' },
                    ] as const).map(({ v, l }) => (
                      <button
                        key={v}
                        onClick={() => setApplyMode(v as 'override' | 'keep_existing')}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                          applyMode === v
                            ? 'bg-white text-ink shadow-sm border border-line'
                            : 'text-ink-muted hover:text-ink'
                        }`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                  {applyMode === 'override' && (
                    <p className="mt-2 text-[11px] text-amber-700 inline-flex items-start gap-1">
                      <AlertTriangle className="w-3 h-3 mt-0.5" />
                      Every product in this list will overwrite the customer&apos;s existing overrides.
                    </p>
                  )}
                  {applyMode === 'keep_existing' && (
                    <p className="mt-2 text-[11px] text-ink-muted">
                      Only seeds prices for products the customer doesn&apos;t already have an override for.
                    </p>
                  )}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={closeApply}
                    className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg hover:bg-line/50 text-sm font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmApply}
                    disabled={applyBusy || applyCustomerIds.length !== 1}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-dark text-white rounded-lg text-sm font-semibold hover:bg-teal/90 disabled:opacity-50"
                  >
                    {applyBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users2 className="w-4 h-4" />}
                    Apply to customer
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
                <ListChecks className="w-5 h-5 text-teal-dark" /> New Price List
              </h2>
              <button onClick={() => setShowCreate(false)} className="text-ink-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">Name *</label>
                <input
                  type="text"
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Wholesale 2026"
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">Description</label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  rows={2}
                  placeholder="Optional — shown next to the list in admin views"
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal/40"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-ink-muted mb-1 inline-flex items-center gap-1">
                  <Copy className="w-3 h-3" /> Start from
                </label>
                <select
                  value={newSource}
                  onChange={(e) => setNewSource(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
                >
                  <option value="">Default product prices</option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>Copy from: {l.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg hover:bg-line/50 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90 disabled:opacity-50"
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Create List
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  // ---------- renderers ----------
  function renderTable() {
    return (
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-line bg-surface">
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Price List</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Products</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Created</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Created By</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {showDefault && renderDefaultRow(true)}
              {filtered.length === 0 && !showDefault && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-ink-muted text-sm">
                    No price lists match your search.
                  </td>
                </tr>
              )}
              {filtered.map((l) => (
                <tr key={l.id} className="hover:bg-surface">
                  <td className="px-5 py-4">
                    <Link href={`/admin/pricing/list/${l.id}`} className="text-ink font-medium hover:text-teal-dark">
                      {l.name}
                    </Link>
                    {l.description && (
                      <div className="text-xs text-ink-muted line-clamp-1">{l.description}</div>
                    )}
                  </td>
                  <td className="px-5 py-4 text-sm text-ink tabular-nums">{l.item_count}</td>
                  <td className="px-5 py-4 text-sm text-ink-muted">{fmtDate(l.created_at)}</td>
                  <td className="px-5 py-4 text-sm text-ink-muted">{creatorName(l)}</td>
                  <td className="px-5 py-4"><StatusBadge active={l.is_active} /></td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-1.5">
                      {l.is_active ? (
                        <button
                          onClick={() => deactivate(l)}
                          disabled={activatingId === l.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-surface border border-line text-ink-muted hover:text-ink disabled:opacity-50"
                        >
                          {activatingId === l.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Circle className="w-3 h-3" />}
                          Deactivate
                        </button>
                      ) : (
                        <button
                          onClick={() => activate(l)}
                          disabled={activatingId === l.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 disabled:opacity-50"
                        >
                          {activatingId === l.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CircleDot className="w-3 h-3" />}
                          Activate
                        </button>
                      )}
                      {canCreate && (
                        <button
                          onClick={() => openApply(l)}
                          className="p-1.5 hover:bg-surface rounded-lg text-ink-muted hover:text-teal-dark"
                          title="Apply to a customer"
                        >
                          <Users2 className="w-4 h-4" />
                        </button>
                      )}
                      <Link
                        href={`/admin/pricing/list/${l.id}`}
                        className="p-1.5 hover:bg-surface rounded-lg text-ink-muted hover:text-ink"
                        title="Open"
                      >
                        <ArrowRight className="w-4 h-4" />
                      </Link>
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(l)}
                          disabled={deletingId === l.id}
                          className="p-1.5 hover:bg-red-50 rounded-lg text-ink-muted hover:text-red-600 disabled:opacity-50"
                          title="Delete"
                        >
                          {deletingId === l.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderDefaultRow(isTableRow: boolean) {
    if (isTableRow) {
      return (
        <tr className="bg-teal/5">
          <td className="px-5 py-4">
            <div className="inline-flex items-center gap-2 text-ink font-medium">
              <Lock className="w-3.5 h-3.5 text-teal-dark" /> Default Prices
            </div>
            <div className="text-xs text-ink-muted">Products' base CAD price — always available</div>
          </td>
          <td className="px-5 py-4 text-sm text-ink tabular-nums">{activeProductCount}</td>
          <td className="px-5 py-4 text-sm text-ink-muted">—</td>
          <td className="px-5 py-4 text-sm text-ink-muted">System</td>
          <td className="px-5 py-4"><StatusBadge active={!anyCustomActive} /></td>
          <td className="px-5 py-4">
            <div className="flex items-center justify-end gap-1.5">
              {anyCustomActive && (
                <button
                  onClick={useDefault}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20"
                >
                  <CircleDot className="w-3 h-3" /> Use default
                </button>
              )}
              <Link
                href="/admin/products"
                className="p-1.5 hover:bg-surface rounded-lg text-ink-muted hover:text-ink"
                title="Manage in Products"
              >
                <ExternalLink className="w-4 h-4" />
              </Link>
              <button
                disabled
                className="p-1.5 rounded-lg text-ink-muted/30 cursor-not-allowed"
                title="Default prices can't be deleted"
              >
                <Lock className="w-4 h-4" />
              </button>
            </div>
          </td>
        </tr>
      );
    }
    return null;
  }

  function renderCards() {
    return (
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {showDefault && (
          <div className="bg-teal/5 rounded-xl border border-teal/30 p-5 flex flex-col">
            <div className="flex items-start justify-between mb-2">
              <div className="inline-flex items-center gap-2 text-ink font-semibold">
                <Lock className="w-4 h-4 text-teal-dark" /> Default Prices
              </div>
              <StatusBadge active={!anyCustomActive} />
            </div>
            <p className="text-xs text-ink-muted mb-4 line-clamp-2">
              Products&apos; base CAD price. Always available; can&apos;t be renamed or deleted.
            </p>
            <div className="grid grid-cols-3 gap-2 mb-4 text-center">
              <StatBox icon={Package} label="Products" value={String(activeProductCount)} />
              <StatBox icon={Calendar} label="Created" value="—" />
              <StatBox icon={User} label="By" value="System" />
            </div>
            <div className="mt-auto pt-3 border-t border-teal/20 flex items-center">
              {anyCustomActive ? (
                <button
                  onClick={useDefault}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20"
                >
                  <CircleDot className="w-3 h-3" /> Use default
                </button>
              ) : (
                <span className="text-xs text-ink-muted italic">Currently in effect</span>
              )}
              <Link
                href="/admin/products"
                className="ml-auto inline-flex items-center gap-1 text-xs text-teal-dark hover:underline"
              >
                Open Products <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
          </div>
        )}
        {filtered.length === 0 && !showDefault && (
          <div className="col-span-full py-16 text-center text-sm text-ink-muted">
            No price lists match your search.
          </div>
        )}
        {filtered.map((l) => (
          <div key={l.id} className="bg-white rounded-xl border border-line p-5 flex flex-col">
            <div className="flex items-start justify-between mb-2">
              <Link
                href={`/admin/pricing/list/${l.id}`}
                className="text-ink font-semibold hover:text-teal-dark truncate"
              >
                {l.name}
              </Link>
              <StatusBadge active={l.is_active} />
            </div>
            <p className="text-xs text-ink-muted mb-4 line-clamp-2 min-h-[2rem]">
              {l.description || <span className="italic opacity-70">No description.</span>}
            </p>
            <div className="grid grid-cols-3 gap-2 mb-4 text-center">
              <StatBox icon={Package} label="Products" value={String(l.item_count)} />
              <StatBox icon={Calendar} label="Created" value={fmtDate(l.created_at)} />
              <StatBox icon={User} label="By" value={creatorName(l)} />
            </div>
            <div className="mt-auto pt-3 border-t border-line flex items-center gap-2">
              {l.is_active ? (
                <button
                  onClick={() => deactivate(l)}
                  disabled={activatingId === l.id}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-surface border border-line text-ink-muted hover:text-ink disabled:opacity-50"
                >
                  {activatingId === l.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Circle className="w-3 h-3" />}
                  Deactivate
                </button>
              ) : (
                <button
                  onClick={() => activate(l)}
                  disabled={activatingId === l.id}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 disabled:opacity-50"
                >
                  {activatingId === l.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CircleDot className="w-3 h-3" />}
                  Activate
                </button>
              )}
              {canCreate && (
                <button
                  onClick={() => openApply(l)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-ink-muted hover:text-teal-dark hover:bg-teal/5"
                  title="Apply to a customer"
                >
                  <Users2 className="w-3 h-3" /> Apply
                </button>
              )}
              <Link
                href={`/admin/pricing/list/${l.id}`}
                className="ml-auto inline-flex items-center gap-1 text-xs text-teal-dark hover:underline"
              >
                Open <ArrowRight className="w-3 h-3" />
              </Link>
              {canDelete && (
                <button
                  onClick={() => handleDelete(l)}
                  disabled={deletingId === l.id}
                  className="p-1.5 hover:bg-red-50 rounded-lg text-ink-muted hover:text-red-600 disabled:opacity-50"
                  title="Delete"
                >
                  {deletingId === l.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }
}

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600">
      <CircleDot className="w-3 h-3" /> Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-surface text-ink-muted border border-line">
      <Circle className="w-3 h-3" /> Inactive
    </span>
  );
}

function StatBox({
  icon: Icon, label, value,
}: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface/60 border border-line py-2 px-1">
      <div className="text-[10px] uppercase tracking-wider text-ink-muted flex items-center justify-center gap-1">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className="text-xs font-semibold text-ink truncate mt-0.5">{value}</div>
    </div>
  );
}
