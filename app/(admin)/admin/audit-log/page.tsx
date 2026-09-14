'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { apiFetch } from '@/lib/api-fetch';

interface AuditLogRow {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
}

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [actorFilter, setActorFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState<string>('all');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setError('Not authenticated');
        setLoading(false);
        return;
      }
      const data = await apiFetch<{ logs: AuditLogRow[] }>('/api/admin/audit-logs?limit=500', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setRows(data.logs ?? []);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load audit logs');
    }
    setLoading(false);
  }

  const entityTypes = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.entity_type);
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (actorFilter && !(r.actor_email ?? '').toLowerCase().includes(actorFilter.toLowerCase())) {
        return false;
      }
      if (actionFilter && !r.action.toLowerCase().includes(actionFilter.toLowerCase())) {
        return false;
      }
      if (entityFilter !== 'all' && r.entity_type !== entityFilter) {
        return false;
      }
      return true;
    });
  }, [rows, actorFilter, actionFilter, entityFilter]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">Audit Log</h1>
        <p className="text-sm text-ink-muted mt-1">
          Append-only record of admin mutations. Newest first.
        </p>
      </div>

      <div className="bg-white border border-line rounded-lg p-4 mb-4 flex flex-wrap gap-3">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-ink-muted mb-1">Actor email</label>
          <input
            type="text"
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            placeholder="admin@..."
            className="w-full px-3 py-2 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-teal/40 text-sm text-ink"
          />
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-ink-muted mb-1">Action</label>
          <input
            type="text"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            placeholder="invoice.payment_recorded"
            className="w-full px-3 py-2 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-teal/40 text-sm text-ink"
          />
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-ink-muted mb-1">Entity</label>
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="w-full px-3 py-2 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-teal/40 text-sm text-ink"
          >
            <option value="all">All</option>
            {entityTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button
            onClick={load}
            className="bg-ink hover:bg-ink/90 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">
          {error}
        </div>
      )}

      <div className="bg-white border border-line rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-ink-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3 font-medium">When</th>
                <th className="text-left px-4 py-3 font-medium">Actor</th>
                <th className="text-left px-4 py-3 font-medium">Action</th>
                <th className="text-left px-4 py-3 font-medium">Entity</th>
                <th className="text-left px-4 py-3 font-medium">Entity ID</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-ink-muted">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-ink-muted">No audit log entries</td></tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="px-4 py-3 text-ink-muted whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-ink">{r.actor_email ?? <span className="text-ink-muted italic">unknown</span>}</td>
                    <td className="px-4 py-3 text-ink font-mono text-xs">{r.action}</td>
                    <td className="px-4 py-3 text-ink-muted">{r.entity_type}</td>
                    <td className="px-4 py-3 text-ink-muted font-mono text-xs break-all max-w-xs">{r.entity_id ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-ink-muted mt-3">
        Showing {filtered.length} of {rows.length} entries (max 500 fetched).
      </p>
    </div>
  );
}
