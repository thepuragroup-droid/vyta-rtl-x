'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Filter, RefreshCw, Trash2, RotateCcw, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getQueue, setRemovedFromQueue, type QueueFilters } from '@/lib/warehouse/api';
import type {
  QueueItem,
  QueueSummary,
} from '@/lib/warehouse/types';
import QueueRow from './_components/QueueRow';
import QueueDetail from './_components/QueueDetail';
import { useViewer } from './layout';

// Top-level tabs. "To Fulfill" is the working queue (pending/packed); records
// leave it once shipped/picked up (→ Fulfilled) or cancelled (→ Cancelled).
type QueueTab = 'active' | 'fulfilled' | 'cancelled' | 'removed';
const TAB_OPTIONS: Array<{ key: QueueTab; label: string }> = [
  { key: 'active', label: 'To Fulfill' },
  { key: 'fulfilled', label: 'Fulfilled' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'removed', label: 'Removed' },
];

const TYPE_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'shipment', label: 'Shipment' },
  { key: 'pickup', label: 'Pickup' },
] as const;

const LABEL_OPTIONS = [
  { key: 'all', label: 'Any label' },
  { key: 'generated', label: 'Has label' },
  { key: 'pending', label: 'Label pending' },
  { key: 'not_created', label: 'No label' },
  { key: 'failed', label: 'Label failed' },
] as const;

export default function WarehousePage() {
  const viewer = useViewer();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [summary, setSummary] = useState<QueueSummary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<QueueTab>('active');
  const [typeFilter, setTypeFilter] = useState<'all' | 'shipment' | 'pickup'>('all');
  const [labelFilter, setLabelFilter] = useState<string>('all');

  // Bulk selection (per-tab; cleared whenever the tab changes).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const filters = useMemo<QueueFilters>(() => {
    const out: QueueFilters = {};
    if (typeFilter !== 'all') out.fulfillment_type = typeFilter;
    if (labelFilter !== 'all') out.label_state = labelFilter;
    return out;
  }, [typeFilter, labelFilter]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await getQueue(filters);
      setItems(res.items);
      setSummary(res.summary);
      setSeenIds((prev) => {
        const next = new Set(prev);
        const fresh: string[] = [];
        for (const it of res.items) {
          if (!prev.has(it.id)) fresh.push(it.id);
          next.add(it.id);
        }
        if (fresh.length > 0) {
          setNewIds((p) => {
            const n = new Set(p);
            for (const id of fresh) n.add(id);
            return n;
          });
          // Drop the "new" badge after 8 seconds.
          setTimeout(() => {
            setNewIds((p) => {
              const n = new Set(p);
              for (const id of fresh) n.delete(id);
              return n;
            });
          }, 8000);
        }
        return next;
      });
    } catch (e: any) {
      setError(e.message || 'Failed to load queue');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // Initial + filter changes.
  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  // Realtime subscription on invoices.
  useEffect(() => {
    const channel = supabase
      .channel('warehouse-queue')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'invoices' },
        () => refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  // Partition into tabs: items removed from the queue first (a warehouse-only
  // hide), then cancelled orders (regardless of fulfillment status), then
  // fulfilled (shipped/picked up), then the active work queue.
  const partitions = useMemo(() => {
    const active: QueueItem[] = [];
    const fulfilled: QueueItem[] = [];
    const cancelled: QueueItem[] = [];
    const removed: QueueItem[] = [];
    for (const it of items) {
      if (it.removed_from_queue) removed.push(it);
      else if (it.status === 'cancelled' || it.order?.status === 'cancelled') cancelled.push(it);
      else if (it.fulfillment_status === 'shipped' || it.fulfillment_status === 'picked_up')
        fulfilled.push(it);
      else active.push(it);
    }
    return { active, fulfilled, cancelled, removed };
  }, [items]);

  const visibleItems = partitions[tab];

  const selected = useMemo(
    () => visibleItems.find((it) => it.id === selectedId) ?? null,
    [visibleItems, selectedId],
  );

  // Bulk selection is scoped to the items currently visible in the tab. Keep
  // the working set in sync so a selected id that scrolls out of view (e.g.
  // after a refresh) doesn't linger in the count.
  const selectedInView = useMemo(
    () => visibleItems.filter((it) => selectedIds.has(it.id)),
    [visibleItems, selectedIds],
  );
  const allSelected = visibleItems.length > 0 && selectedInView.length === visibleItems.length;

  const switchTab = useCallback((next: QueueTab) => {
    setTab(next);
    setSelectedId(null);
    setSelectedIds(new Set());
    setBulkError(null);
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      // If everything in view is already selected, clear; otherwise select all.
      const everySelected =
        visibleItems.length > 0 && visibleItems.every((it) => prev.has(it.id));
      if (everySelected) return new Set();
      return new Set(visibleItems.map((it) => it.id));
    });
  }, [visibleItems]);

  // Bulk remove/restore. `removed=true` hides the selected invoices from the
  // active queue; `removed=false` restores them. Runs the existing per-invoice
  // PATCH for each id, then refreshes.
  const bulkSetRemoved = useCallback(
    async (removed: boolean) => {
      const ids = selectedInView.map((it) => it.id);
      if (ids.length === 0) return;
      setBulkBusy(true);
      setBulkError(null);
      try {
        const results = await Promise.allSettled(
          ids.map((id) => setRemovedFromQueue(id, removed)),
        );
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed > 0) {
          setBulkError(
            `${failed} of ${ids.length} could not be updated. The rest were ${removed ? 'removed' : 'restored'}.`,
          );
        }
        setSelectedIds(new Set());
        setSelectedId(null);
        await refresh();
      } catch (e: any) {
        setBulkError(e?.message || 'Bulk action failed');
      } finally {
        setBulkBusy(false);
      }
    },
    [selectedInView, refresh],
  );

  return (
    <div className="space-y-6">
      <SummaryCards summary={summary} />

      {/* Tabs — route records between the working queue, fulfilled, and cancelled */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line">
        {TAB_OPTIONS.map((t) => {
          const count = partitions[t.key].length;
          const activeTab = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
                activeTab
                  ? 'border-bronze text-ink'
                  : 'border-transparent text-ink-muted hover:text-ink'
              }`}
            >
              {t.label}
              <span
                className={`text-[11px] rounded-full px-1.5 py-0.5 ${
                  activeTab ? 'bg-bronze text-white' : 'bg-surface text-ink-muted'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Filter className="w-4 h-4 text-ink-muted" />
        <ChipGroup
          label="Type"
          value={typeFilter}
          onChange={(v) => setTypeFilter(v as any)}
          options={TYPE_OPTIONS as any}
        />
        <ChipGroup
          label="Label"
          value={labelFilter}
          onChange={setLabelFilter}
          options={LABEL_OPTIONS as any}
        />
        <button
          onClick={() => refresh()}
          className="ml-auto inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6">
        <div className="space-y-2">
          {/* Bulk selection toolbar — select-all + the bulk action bar. */}
          {!loading && visibleItems.length > 0 && (
            <div className="flex items-center justify-between gap-2 px-1">
              <label className="inline-flex items-center gap-2 text-xs text-ink-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el)
                      el.indeterminate =
                        selectedInView.length > 0 && !allSelected;
                  }}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 accent-bronze"
                />
                {selectedInView.length > 0
                  ? `${selectedInView.length} selected`
                  : 'Select all'}
              </label>
              {selectedInView.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"
                >
                  <X className="w-3.5 h-3.5" /> Clear
                </button>
              )}
            </div>
          )}

          {selectedInView.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-bronze/40 bg-bronze/5 px-3 py-2">
              <span className="text-xs text-ink">
                {selectedInView.length} order{selectedInView.length === 1 ? '' : 's'} selected
              </span>
              {tab === 'removed' ? (
                <button
                  type="button"
                  onClick={() => bulkSetRemoved(false)}
                  disabled={bulkBusy}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-line bg-white text-sm text-ink px-3 py-1.5 hover:border-bronze disabled:opacity-60"
                >
                  <RotateCcw className="w-4 h-4" />
                  {bulkBusy ? 'Restoring…' : 'Restore to queue'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => bulkSetRemoved(true)}
                  disabled={bulkBusy}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white text-sm text-red-600 px-3 py-1.5 hover:bg-red-50 disabled:opacity-60"
                >
                  <Trash2 className="w-4 h-4" />
                  {bulkBusy ? 'Removing…' : 'Remove from queue'}
                </button>
              )}
            </div>
          )}

          {bulkError && (
            <div className="rounded-md border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-xs">
              {bulkError}
            </div>
          )}

          {loading ? (
            <p className="text-sm text-ink-muted">Loading queue…</p>
          ) : visibleItems.length === 0 ? (
            <p className="text-sm text-ink-muted">
              {tab === 'active'
                ? 'Nothing to fulfill.'
                : tab === 'fulfilled'
                  ? 'No fulfilled orders yet.'
                  : tab === 'cancelled'
                    ? 'No cancelled orders.'
                    : 'No removed orders.'}
            </p>
          ) : (
            visibleItems.map((it) => (
              <QueueRow
                key={it.id}
                item={it}
                active={selectedId === it.id}
                isNew={newIds.has(it.id)}
                onClick={() => setSelectedId(it.id)}
                selectable
                selected={selectedIds.has(it.id)}
                onToggleSelect={() => toggleSelect(it.id)}
              />
            ))
          )}
          <p className="text-[11px] text-ink-muted pt-2">
            {viewer.canSendEmails ? '' : 'You do not have notification permission. Ask an admin to enable it on your account.'}
          </p>
        </div>
        <div>
          {selected ? (
            <QueueDetail item={selected} onMutate={refresh} />
          ) : (
            <div className="rounded-lg border border-line bg-white px-6 py-16 text-center text-ink-muted">
              Select an order from the queue.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Summary cards ----------

function SummaryCards({ summary }: { summary: QueueSummary | null }) {
  const cards = [
    { key: 'toFulfill', label: 'To fulfill', value: summary?.toFulfill ?? 0 },
    { key: 'packed', label: 'Packed', value: summary?.packed ?? 0 },
    { key: 'shipped', label: 'Shipped', value: summary?.shipped ?? 0 },
    { key: 'pickedUp', label: 'Picked up', value: summary?.pickedUp ?? 0 },
    { key: 'shipments', label: 'Shipments', value: summary?.shipments ?? 0 },
    { key: 'pickups', label: 'Pickups', value: summary?.pickups ?? 0 },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
      {cards.map((c) => (
        <div
          key={c.key}
          className="rounded-md border border-line bg-white px-3 py-2"
        >
          <div className="text-[11px] uppercase tracking-wide text-ink-muted">
            {c.label}
          </div>
          <div className="text-xl font-semibold text-ink">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

// ---------- Chip group ----------

function ChipGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ key: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-ink-muted hidden sm:inline">{label}:</span>
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`text-xs px-2.5 py-1 rounded-full border ${
            value === o.key
              ? 'border-bronze bg-bronze text-white'
              : 'border-line text-ink-muted hover:border-bronze'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
