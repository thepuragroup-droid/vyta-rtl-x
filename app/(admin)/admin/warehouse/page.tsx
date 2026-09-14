'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Mail, MailX, RefreshCw, ShieldCheck, UserPlus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatWhen, timeAgo } from '@/lib/warehouse/types';
import type {
  StaffPerformance,
  WarehouseActivity,
  WarehouseStaffAccount,
} from '@/lib/admin/warehouse-staff';
import CreateWarehouseModal from './_components/CreateWarehouseModal';

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchActivity(): Promise<WarehouseActivity> {
  const res = await fetch('/api/admin/warehouse/activity', {
    headers: await authHeaders(),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`activity ${res.status}`);
  return res.json();
}

async function patchUser(userId: string, can_send: boolean): Promise<void> {
  const res = await fetch(`/api/admin/users/${userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ can_send_fulfillment_emails: can_send }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `update ${res.status}`);
  }
}

export default function AdminWarehousePage() {
  const [activity, setActivity] = useState<WarehouseActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const next = await fetchActivity();
      setActivity(next);
    } catch (e: any) {
      setError(e.message || 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggleEmailPerm = async (acc: WarehouseStaffAccount) => {
    setBusy(acc.id);
    try {
      await patchUser(acc.id, !acc.can_send_fulfillment_emails);
      await refresh();
    } catch (e: any) {
      setError(e.message || 'Failed to update permission');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Warehouse</h1>
          <p className="text-sm text-ink-muted">
            Manage warehouse accounts and review fulfillment activity.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={refresh}
            className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/90 transition-colors"
          >
            <UserPlus className="w-4 h-4" /> Create account
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {loading && !activity ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <>
          <section className="rounded-lg border border-line bg-white">
            <header className="px-5 py-3 border-b border-line">
              <h2 className="font-semibold text-ink">Staff accounts</h2>
            </header>
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-muted uppercase tracking-wide">
                <tr>
                  <th className="text-left px-5 py-2">Name</th>
                  <th className="text-left px-5 py-2">Email</th>
                  <th className="text-left px-5 py-2">Active</th>
                  <th className="text-left px-5 py-2">Last login</th>
                  <th className="text-left px-5 py-2">Email permission</th>
                </tr>
              </thead>
              <tbody>
                {(activity?.accounts ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-6 text-ink-muted text-center">
                      No warehouse accounts yet.{' '}
                      <button
                        onClick={() => setShowCreate(true)}
                        className="text-bronze hover:underline"
                      >
                        Create one
                      </button>
                      .
                    </td>
                  </tr>
                )}
                {(activity?.accounts ?? []).map((a) => (
                  <tr key={a.id} className="border-t border-line">
                    <td className="px-5 py-2">
                      {[a.first_name, a.last_name].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="px-5 py-2 text-ink-muted">{a.email}</td>
                    <td className="px-5 py-2">
                      {a.active ? (
                        <span className="text-emerald-600">Active</span>
                      ) : (
                        <span className="text-ink-muted">Inactive</span>
                      )}
                    </td>
                    <td className="px-5 py-2 text-ink-muted">
                      {a.last_login_at ? timeAgo(a.last_login_at) : 'never'}
                    </td>
                    <td className="px-5 py-2">
                      <button
                        disabled={busy === a.id}
                        onClick={() => toggleEmailPerm(a)}
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs border ${
                          a.can_send_fulfillment_emails
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'
                            : 'border-line text-ink-muted'
                        } disabled:opacity-60`}
                      >
                        {a.can_send_fulfillment_emails ? (
                          <>
                            <Mail className="w-3.5 h-3.5" /> Can send
                          </>
                        ) : (
                          <>
                            <MailX className="w-3.5 h-3.5" /> Disabled
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="rounded-lg border border-line bg-white">
            <header className="px-5 py-3 border-b border-line flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-bronze" />
              <h2 className="font-semibold text-ink">Performance</h2>
            </header>
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-muted uppercase tracking-wide">
                <tr>
                  <th className="text-left px-5 py-2">Staff</th>
                  <th className="text-left px-5 py-2">Packed</th>
                  <th className="text-left px-5 py-2">Shipped</th>
                  <th className="text-left px-5 py-2">Picked up</th>
                  <th className="text-left px-5 py-2">Completed</th>
                  <th className="text-left px-5 py-2">Today</th>
                  <th className="text-left px-5 py-2">Last active</th>
                </tr>
              </thead>
              <tbody>
                {(activity?.performance ?? []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-6 text-ink-muted text-center">
                      No activity yet.
                    </td>
                  </tr>
                )}
                {(activity?.performance ?? []).map((p: StaffPerformance) => (
                  <tr key={p.actor_id} className="border-t border-line">
                    <td className="px-5 py-2">
                      <div className="text-ink">{p.display_name}</div>
                      <div className="text-xs text-ink-muted">{p.actor_email}</div>
                    </td>
                    <td className="px-5 py-2">{p.packed}</td>
                    <td className="px-5 py-2">{p.shipped}</td>
                    <td className="px-5 py-2">{p.picked_up}</td>
                    <td className="px-5 py-2 font-semibold">{p.completed}</td>
                    <td className="px-5 py-2">{p.completed_today}</td>
                    <td className="px-5 py-2 text-ink-muted">
                      {p.last_active ? timeAgo(p.last_active) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="rounded-lg border border-line bg-white">
            <header className="px-5 py-3 border-b border-line">
              <h2 className="font-semibold text-ink">Activity feed</h2>
              <p className="text-xs text-ink-muted">
                Last {activity?.logs?.length ?? 0} fulfillment events.
              </p>
            </header>
            <ul>
              {(activity?.logs ?? []).length === 0 && (
                <li className="px-5 py-6 text-ink-muted text-center text-sm">
                  No activity yet.
                </li>
              )}
              {(activity?.logs ?? []).map((l) => (
                <li
                  key={l.id}
                  className="px-5 py-3 border-t border-line flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-ink">
                      {l.actor_email ?? 'Unknown'} →{' '}
                      <span className="font-medium">{l.to_status ?? l.action}</span>
                    </div>
                    <div className="text-xs text-ink-muted">
                      {l.invoice_number ?? '—'}
                      {l.order_number ? ` · ${l.order_number}` : ''}
                    </div>
                  </div>
                  <div className="text-xs text-ink-muted whitespace-nowrap">
                    {formatWhen(l.created_at)}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {showCreate && (
        <CreateWarehouseModal
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            setShowCreate(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}
