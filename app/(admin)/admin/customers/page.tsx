'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, Shield, ShieldOff, Mail, KeyRound, Pencil, Trash2, Loader2, Users, RefreshCw,
  MapPin, Phone, CreditCard, ArrowUpRight, Send,
} from 'lucide-react';
import { toggleCustomerAdmin } from '@/lib/admin/api';
import { useUserRole } from '../layout';
import { canEdit, canDelete, getRoleBadgeClasses } from '@/lib/permissions';
import type { UserRole } from '@/lib/permissions';
import { useToast } from '@/contexts/ToastContext';
import { normalizeCurrency } from '@/lib/currency';
import { LEAD_STATUS_META, type Lead } from '@/lib/admin/customer-leads';
import { supabase } from '@/lib/supabase';
import type { Customer } from '@/lib/supabase';
import EditUserModal from '../users/_components/EditUserModal';
import BulkEmailDialog from './_components/BulkEmailDialog';
import AudienceFilters from './_components/AudienceFilters';
import { MAX_BULK_RECIPIENTS } from '@/lib/customer/outreach-types';
import {
  EMPTY_AUDIENCE,
  RECENT_NUDGE_DAYS,
  emailTypeLabel,
  hasAudienceConditions,
  isRecentlyNudged,
  matchesDateFilters,
  suppressionReason,
  type AudienceFilters as Audience,
  type EmailHistoryIndex,
  type NudgeSummary,
} from '@/lib/customer/audience';

/** One row of the merged directory (see /api/admin/customers/directory). */
interface DirectoryRow {
  id: string;
  source: 'account' | 'puramass';
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  role: string | null;
  created_at: string;
  last_login_at: string | null;
  preferred_currency: string | null;
  active: boolean;
  claimed_by_id: string | null;
  claimed_by_name: string | null;
  affiliate_id: string | null;
  has_completed_first_order: boolean;
  lead: Lead | null;
  purchases: number;
  purchase_breakdown: { invoices: number; orders: number; puramass: number };
  /** Saved ships-to clients in this customer's address book. */
  clients: number;
  puramass_orders: number;
  puramass_paid_orders: number;
  puramass_paid_cents: number;
  puramass_last_order_at: string | null;
  /** The last outreach email we sent them, or null when we never have. */
  nudge: NudgeSummary | null;
}

interface Counts {
  all: number;
  customers: number;
  puramass: number;
  staff: number;
  claimed: number;
  unclaimed: number;
}

const EMPTY_COUNTS: Counts = {
  all: 0, customers: 0, puramass: 0, staff: 0, claimed: 0, unclaimed: 0,
};

/**
 * Who the list is showing. `customers` is the default and deliberately narrow:
 * paying customers only. Stealth Health buyers count as customers (they
 * bought), which is why they're in that bucket too.
 *
 * There is no affiliates option: affiliates are excluded from this page
 * entirely — they are partners, not buyers, and have their own desk at
 * /admin/affiliates with their own metrics and their own lead record. The
 * server drops them too, so `all` really is everyone this page covers.
 */
type Segment = 'customers' | 'puramass' | 'staff' | 'all';

const SEGMENTS: { key: Segment; label: string; countKey: keyof Counts }[] = [
  { key: 'customers', label: 'Customers', countKey: 'customers' },
  { key: 'puramass', label: 'Stealth Health', countKey: 'puramass' },
  { key: 'staff', label: 'Staff', countKey: 'staff' },
  { key: 'all', label: 'All', countKey: 'all' },
];

type SortKey = 'clients' | 'newest' | 'oldest' | 'name' | 'active';

/**
 * `clients` leads and is the default: the desk works this list by who has the
 * biggest ships-to address book, so the busiest resellers sit at the top
 * without anyone touching a pill.
 */
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'clients', label: 'Most clients' },
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'name', label: 'A–Z' },
  { key: 'active', label: 'Last active' },
];

const STAFF_ROLES = new Set(['admin', 'assistant', 'warehouse', 'analytics']);

/** The lead-desk view: who is on the hook, and how warm the lead is. */
type LeadFilter = 'any' | 'mine' | 'unclaimed' | 'hot' | 'warm' | 'cold';

const LEAD_FILTERS: { key: LeadFilter; label: string }[] = [
  { key: 'any', label: 'Any' },
  { key: 'mine', label: 'Mine' },
  { key: 'unclaimed', label: 'Unclaimed' },
  { key: 'hot', label: 'Hot' },
  { key: 'warm', label: 'Warm' },
  { key: 'cold', label: 'Cold' },
];

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token
    ? { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

const fullName = (c: DirectoryRow) =>
  `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();

/** "12 Aug 2026" — short enough for a table cell, unambiguous across locales. */
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "3d ago" / "5m ago" — the second line under a date. */
function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return 'just now';
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}d ago`;
  const months = Math.round(days / 30.4);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

/** Detail-page href. Stealth Health ids carry an email, so they must be encoded. */
const detailHref = (c: DirectoryRow) => `/admin/customers/${encodeURIComponent(c.id)}`;

export default function AdminCustomers() {
  const userRole = useUserRole();
  const router = useRouter();
  const toast = useToast();
  const editable = canEdit(userRole);
  const deletable = canDelete(userRole);

  const [rows, setRows] = useState<DirectoryRow[]>([]);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState<Segment>('customers');
  const [sort, setSort] = useState<SortKey>('clients');
  const [leadFilter, setLeadFilter] = useState<LeadFilter>('any');
  const [meId, setMeId] = useState<string | null>(null);
  const [leadsAvailable, setLeadsAvailable] = useState(true);
  // Whether the outreach log could be read for this view. False for an
  // affiliate's scoped list and until the CRM migration runs — the "Nudged"
  // column is dropped rather than drawn as a column of "never emailed".
  const [nudgesAvailable, setNudgesAvailable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<Customer | null>(null);
  // Rows ticked for a bulk send, keyed by the directory id — which is already
  // the outreach id the CRM routes address people by.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkEmailing, setBulkEmailing] = useState(false);
  // Who this email is FOR — dates, and the email types to skip. Held on the
  // page rather than inside the send dialog because the answer has to shape the
  // table the ticks are made against, not just the batch that leaves.
  const [audience, setAudience] = useState<Audience>(EMPTY_AUDIENCE);
  const [audienceOpen, setAudienceOpen] = useState(false);
  // The outreach log, keyed by address — only fetched while an "already sent"
  // condition is on, and only for the template keys it names.
  const [emailHistory, setEmailHistory] = useState<EmailHistoryIndex>({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyUnavailable, setHistoryUnavailable] = useState(false);
  // Where to draw the "click here to see more info" hint. Held here rather than
  // per row because a <div> is not valid inside <tbody> — the tooltip has to
  // live outside the table.
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (opts.silent) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch('/api/admin/customers/directory', {
        cache: 'no-store',
        headers: await authHeaders(),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load customers');
      setRows(json.customers ?? []);
      setCounts(json.counts ?? EMPTY_COUNTS);
      setLeadsAvailable(json.leadsAvailable !== false);
      setNudgesAvailable(json.nudgesAvailable === true);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load customers');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Needed for the "Mine" lead filter and the "that's you" marker.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMeId(data.user?.id ?? null));
  }, []);

  /**
   * Who has already had the kinds of email this batch is meant to skip.
   *
   * Only asked for while the condition is actually on, and only for the
   * template keys it names: with no condition set this page costs exactly what
   * it always did. Re-read whenever the condition changes, because narrowing
   * the window from "ever" to "last 7 days" must put people back in the list.
   */
  const excludeKey = audience.excludeTemplates.join(',');
  useEffect(() => {
    if (!excludeKey) {
      setEmailHistory({});
      setHistoryUnavailable(false);
      setHistoryLoading(false);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    (async () => {
      try {
        const params = new URLSearchParams({ history: '1', templates: excludeKey });
        if (audience.excludeWithinDays != null) {
          params.set('withinDays', String(audience.excludeWithinDays));
        }
        const res = await fetch(`/api/admin/customers/outreach?${params}`, {
          cache: 'no-store',
          headers: await authHeaders(),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error ?? 'Could not read the outreach history.');
        setEmailHistory(json.byEmail ?? {});
        setHistoryUnavailable(json.available === false);
      } catch {
        if (cancelled) return;
        // Reported rather than swallowed: an empty history would silently mean
        // "nobody has had this email", which is the wrong way to be wrong.
        setEmailHistory({});
        setHistoryUnavailable(true);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [excludeKey, audience.excludeWithinDays]);

  const matched = useMemo(() => {
    const q = search.trim().toLowerCase();

    const inSegment = (c: DirectoryRow) => {
      switch (segment) {
        case 'customers':
          // Everyone who is (or could be) a buyer: Stealth Health rows have no role.
          return c.source === 'puramass' || c.role === 'customer';
        case 'puramass':
          return c.puramass_orders > 0;
        case 'staff':
          return Boolean(c.role && STAFF_ROLES.has(c.role));
        default:
          return true;
      }
    };

    const inLeadFilter = (c: DirectoryRow) => {
      switch (leadFilter) {
        case 'mine':
          return Boolean(meId && c.lead?.claimed_by_id === meId);
        case 'unclaimed':
          return !c.lead?.claimed_by_id;
        case 'hot':
        case 'warm':
        case 'cold':
          return c.lead?.status === leadFilter;
        default:
          return true;
      }
    };

    // The date conditions. "Last active" falls back to the last Stealth Health
    // order, which for a buyer with no account is the only sighting we have.
    const inDateRange = (c: DirectoryRow) =>
      matchesDateFilters(
        {
          joinedAt: c.created_at,
          lastActiveAt: c.last_login_at ?? c.puramass_last_order_at,
        },
        audience,
      );

    const matches = (c: DirectoryRow) =>
      !q ||
      c.email?.toLowerCase().includes(q) ||
      fullName(c).toLowerCase().includes(q) ||
      (c.phone ?? '').toLowerCase().includes(q) ||
      (c.city ?? '').toLowerCase().includes(q) ||
      (c.state ?? '').toLowerCase().includes(q);

    const list = rows.filter(
      (c) => inSegment(c) && inLeadFilter(c) && inDateRange(c) && matches(c),
    );

    const byDate = (a: string | null, b: string | null, dir: 1 | -1) => {
      // Rows with no date sort last regardless of direction.
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      return a < b ? dir : a > b ? -dir : 0;
    };

    return [...list].sort((a, b) => {
      switch (sort) {
        case 'clients':
          // Most clients first; everyone on zero keeps the newest-first order
          // they'd have had anyway, so the tail never looks shuffled.
          return (b.clients ?? 0) - (a.clients ?? 0) ||
            byDate(a.created_at, b.created_at, 1);
        case 'oldest':
          return byDate(a.created_at, b.created_at, -1);
        case 'name':
          return (fullName(a) || a.email).localeCompare(fullName(b) || b.email);
        case 'active':
          return byDate(
            a.last_login_at ?? a.puramass_last_order_at,
            b.last_login_at ?? b.puramass_last_order_at,
            1,
          );
        default:
          return byDate(a.created_at, b.created_at, 1);
      }
    });
  }, [rows, search, segment, sort, leadFilter, meId, audience]);

  /**
   * The people the "already had this email" condition holds back.
   *
   * Kept as a map of the REASON rather than a set of ids, so the row can say
   * which email they already got instead of just vanishing — an admin who
   * cannot see why their list shrank will turn the condition off.
   */
  const suppressed = useMemo(() => {
    const out = new Map<string, { template: string; sentAt: string }>();
    if (audience.excludeTemplates.length === 0) return out;
    for (const row of matched) {
      const reason = suppressionReason(row.email, audience, emailHistory);
      if (reason) out.set(row.id, reason);
    }
    return out;
  }, [matched, audience, emailHistory]);

  const visible = useMemo(
    () => (suppressed.size === 0 ? matched : matched.filter((c) => !suppressed.has(c.id))),
    [matched, suppressed],
  );

  // Ticks are dropped when the list they were made against changes: a hidden
  // selection is a send to people the admin can no longer see.
  useEffect(() => {
    setSelected(new Set());
  }, [segment, leadFilter, search, audience]);

  const visibleIds = useMemo(() => visible.map((c) => c.id), [visible]);
  const selectedRows = useMemo(
    () => visible.filter((c) => selected.has(c.id)),
    [visible, selected],
  );
  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));
  // Data columns + the actions cell, plus the selection checkbox and the
  // outreach column when those are shown.
  const colSpan = 6 + (editable ? 1 : 0) + (nudgesAvailable ? 1 : 0);

  /**
   * How many of the ticked rows heard from us inside the window.
   *
   * The per-row column already says so, but a list long enough to need a bulk
   * send is a list nobody reads row by row — the count is what actually gets
   * seen before the composer opens.
   */
  const recentlyNudgedSelected = useMemo(
    () => selectedRows.filter((c) => isRecentlyNudged(c.nudge)).length,
    [selectedRows],
  );

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelected(allVisibleSelected ? new Set() : new Set(visibleIds));
  };

  /**
   * The selection split into who can be written to and who cannot.
   *
   * A directory row without an email is nobody to address — the id is built
   * from the address for a Stealth Health buyer, so a blank one cannot resolve.
   */
  const mailable = useMemo(() => {
    const ids: string[] = [];
    let noEmail = 0;
    for (const row of selectedRows) {
      if (row.email?.trim()) ids.push(row.id);
      else noEmail += 1;
    }
    return { ids, noEmail };
  }, [selectedRows]);

  const handleToggleAdmin = async (row: DirectoryRow) => {
    setBusy(row.id);
    try {
      const makeAdmin = row.role !== 'admin';
      const result = await toggleCustomerAdmin(row.id, makeAdmin);
      if (!result.success) throw new Error(result.error ?? 'Failed to update role');
      toast.success(makeAdmin ? 'Customer is now an admin' : 'Admin access removed');
      await load({ silent: true });
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to update role');
    } finally {
      setBusy(null);
    }
  };

  // Both actions mint the same Supabase recovery link; `purpose` only decides
  // whether the customer reads welcome copy or plain password-reset copy.
  const handleAccountLink = async (customerId: string, purpose: 'welcome' | 'reset') => {
    const label = purpose === 'reset' ? 'Password reset link' : 'Sign-in link';
    setBusy(customerId);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/magic-link`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ redirectPath: '/reset-password', purpose }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to send link');
      if (json.emailed) toast.success(`${label} emailed to the customer`);
      else if (json.action_link) {
        await navigator.clipboard?.writeText(json.action_link).catch(() => {});
        toast.success(`Mailer not configured — ${label.toLowerCase()} copied to clipboard`);
      } else toast.success(`${label} generated`);
    } catch (e: any) {
      toast.error(e.message ?? `Failed to send ${label.toLowerCase()}`);
    } finally {
      setBusy(null);
    }
  };

  const handleSignInLink = (customerId: string) => handleAccountLink(customerId, 'welcome');
  const handleResetLink = (customerId: string) => handleAccountLink(customerId, 'reset');

  const handleDelete = async (customerId: string, name: string) => {
    if (!window.confirm(`Delete ${name}? This removes their price overrides and cannot be undone.`)) return;
    setBusy(customerId);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}`, {
        method: 'DELETE', headers: await authHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Failed to delete');
      toast.success('Customer deleted');
      await load({ silent: true });
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to delete');
    } finally {
      setBusy(null);
    }
  };

  const openEdit = async (row: DirectoryRow) => {
    // The modal edits a full `customers` row, so fetch the record rather than
    // handing it the directory's trimmed projection.
    setBusy(row.id);
    try {
      const res = await fetch(`/api/admin/customers/${row.id}`, {
        cache: 'no-store',
        headers: await authHeaders(),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load customer');
      setEditingUser({ ...(json.customer as Customer), email: json.customer.email ?? row.email });
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load customer');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2.5">
            <Users className="h-6 w-6 text-teal-dark" />
            <h1 className="text-xl font-bold text-ink">Customers</h1>
          </div>
          <p className="max-w-2xl text-sm text-ink-muted">
            Everyone who has an account here, plus everyone who only ever bought through
            Stealth Health. Claim a customer to own the relationship, then track how the
            lead is doing. Click any row to open their full profile. Affiliates live on
            their own page.
          </p>
        </div>
        <button
          onClick={() => load({ silent: true })}
          disabled={loading || refreshing}
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filter + sort pills */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <PillGroup
          label="Show"
          options={SEGMENTS.map((s) => ({
            key: s.key,
            label: s.label,
            count: counts[s.countKey],
          }))}
          value={segment}
          onChange={(k) => setSegment(k as Segment)}
        />
        <PillGroup
          label="Sort"
          options={SORTS.map((s) => ({ key: s.key, label: s.label }))}
          value={sort}
          onChange={(k) => setSort(k as SortKey)}
        />
      </div>

      {/* Lead desk filter + search */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <PillGroup
          label="Lead"
          options={LEAD_FILTERS.map((f) => ({
            key: f.key,
            label: f.label,
            count:
              f.key === 'any' ? counts.all
              : f.key === 'unclaimed' ? counts.unclaimed
              : undefined,
          }))}
          value={leadFilter}
          onChange={(k) => setLeadFilter(k as LeadFilter)}
        />
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            type="text"
            placeholder="Search name, email, phone or city…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-line bg-white py-2.5 pl-10 pr-4 text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-teal/40"
          />
        </div>
      </div>

      {/* Who the next email is for. Above the table because it decides what the
          table shows — the ticks are made against whatever survives it. */}
      {editable && (
        <AudienceFilters
          value={audience}
          onChange={setAudience}
          open={audienceOpen}
          onToggleOpen={() => setAudienceOpen((o) => !o)}
          matched={visible.length}
          suppressed={suppressed.size}
          loading={historyLoading}
          historyUnavailable={historyUnavailable}
        />
      )}

      {!leadsAvailable && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Lead management is not set up on this database yet, so everyone reads as unclaimed.
          Run <code className="font-mono text-xs">customer-crm-migration.sql</code> to enable
          claiming, lead status and contact tracking.
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-line bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5 md:p-6">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <h2 className="text-lg font-bold text-ink">
              {SEGMENTS.find((s) => s.key === segment)?.label ?? 'Customers'}
            </h2>
            <span className="text-sm text-ink-muted">
              {visible.length} {visible.length === 1 ? 'result' : 'results'}
              {suppressed.size > 0 && (
                <span className="text-amber-700">
                  {' '}· {suppressed.size} hidden, already emailed
                </span>
              )}
            </span>
          </div>

          {/* Bulk email lives here, above the rows it acts on, so a send to
              many is reached the same way as a send to one — tick, click.
              Always visible (disabled until something is ticked) rather than
              appearing on selection, so it can be found before it is needed. */}
          {editable && (
            <div className="flex flex-wrap items-center gap-2">
              {selected.size > 0 && (
                <>
                  <span className="text-xs text-ink-muted">
                    {selected.size} selected
                    {recentlyNudgedSelected > 0 && (
                      <span className="text-amber-700">
                        {' '}· {recentlyNudgedSelected} already emailed in the last{' '}
                        {RECENT_NUDGE_DAYS} days
                      </span>
                    )}
                    {mailable.noEmail > 0 && (
                      <span className="text-amber-700">
                        {' '}· {mailable.noEmail} without an email
                      </span>
                    )}
                    {mailable.ids.length > MAX_BULK_RECIPIENTS && (
                      <span className="text-amber-700">
                        {' '}· one send reaches {MAX_BULK_RECIPIENTS}, so the rest wait for a second batch
                      </span>
                    )}
                  </span>
                  <button
                    onClick={() => setSelected(new Set())}
                    className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-ink/20 hover:text-ink"
                  >
                    Clear
                  </button>
                </>
              )}
              <button
                onClick={() => setBulkEmailing(true)}
                disabled={mailable.ids.length === 0}
                title={
                  mailable.ids.length === 0
                    ? 'Tick the customers you want to write to first.'
                    : `Write one email and send it to ${mailable.ids.length} customer${mailable.ids.length === 1 ? '' : 's'} — each gets their own copy`
                }
                className="inline-flex items-center gap-2 rounded-lg bg-teal-dark px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
                {mailable.ids.length > 0
                  ? `Email ${mailable.ids.length} customer${mailable.ids.length === 1 ? '' : 's'}`
                  : 'Email customers'}
              </button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                {editable && (
                  <th className="w-10 px-5 py-3">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      disabled={visible.length === 0}
                      aria-label="Select every customer in this list"
                      className="h-4 w-4 cursor-pointer rounded border-line text-teal-dark focus:ring-teal/40 disabled:cursor-not-allowed"
                    />
                  </th>
                )}
                <Th>Customer</Th>
                <Th>Location &amp; phone</Th>
                <Th>Created</Th>
                {nudgesAvailable && <Th>Nudged</Th>}
                <Th align="right">Clients</Th>
                <Th align="right">Purchases</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {loading ? (
                <tr>
                  <td colSpan={colSpan} className="px-5 py-16 text-center text-sm text-ink-muted">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                    Loading customers…
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="px-5 py-12 text-center text-sm text-ink-muted">
                    {suppressed.size > 0
                      ? `Everyone here has already had that email — ${suppressed.size} ${
                          suppressed.size === 1 ? 'person was' : 'people were'
                        } held back`
                      : hasAudienceConditions(audience)
                      ? 'Nobody matches these conditions'
                      : search
                      ? 'No customers match your search'
                      : 'Nothing here yet'}
                  </td>
                </tr>
              ) : (
                visible.map((c) => (
                  <CustomerRow
                    key={c.id}
                    row={c}
                    busy={busy === c.id}
                    editable={editable}
                    deletable={deletable}
                    selected={selected.has(c.id)}
                    showNudged={nudgesAvailable}
                    onToggleSelected={() => toggleOne(c.id)}
                    onOpen={() => router.push(detailHref(c))}
                    onHover={setTip}
                    meId={meId}
                    onEdit={() => openEdit(c)}
                    onSignInLink={() => handleSignInLink(c.id)}
                    onResetLink={() => handleResetLink(c.id)}
                    onToggleAdmin={() => handleToggleAdmin(c)}
                    onDelete={() => handleDelete(c.id, fullName(c) || c.email)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {tip && <RowTooltip x={tip.x} y={tip.y} />}

      {bulkEmailing && (
        <BulkEmailDialog
          ids={mailable.ids}
          noEmailCount={mailable.noEmail}
          // Carried through to the send so the route re-checks it against the
          // log as it is at send time, not as this page read it minutes ago.
          suppress={{
            templates: audience.excludeTemplates,
            withinDays: audience.excludeWithinDays,
          }}
          onClose={() => setBulkEmailing(false)}
          onSent={() => {
            setSelected(new Set());
            load({ silent: true });
          }}
        />
      )}

      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSuccess={async () => {
            setEditingUser(null);
            await load({ silent: true });
            toast.success('Customer updated');
          }}
        />
      )}
    </>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={`px-5 py-3 text-xs font-semibold uppercase tracking-wider text-ink-muted ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

function CustomerRow({
  row, busy, editable, deletable, meId, selected, showNudged, onToggleSelected,
  onOpen, onHover, onEdit, onSignInLink, onResetLink, onToggleAdmin, onDelete,
}: {
  row: DirectoryRow;
  busy: boolean;
  meId: string | null;
  editable: boolean;
  deletable: boolean;
  selected: boolean;
  /** Draw the outreach column. Off wherever the log could not be read. */
  showNudged: boolean;
  onToggleSelected: () => void;
  onOpen: () => void;
  onHover: (pos: { x: number; y: number } | null) => void;
  onEdit: () => void;
  onSignInLink: () => void;
  onResetLink: () => void;
  onToggleAdmin: () => void;
  onDelete: () => void;
}) {
  const isPuramass = row.source === 'puramass';
  const cur = normalizeCurrency(row.preferred_currency);
  const name = fullName(row) || (isPuramass ? 'Stealth Health buyer' : row.email);
  const location = [row.city, row.state].filter(Boolean).join(', ');

  return (
    <RowLink onOpen={onOpen} onHover={onHover} isPuramass={isPuramass} selected={selected}>
      {/* Bulk-send tick. Inside a clickable row, so it keeps its own clicks —
          ticking a customer must not navigate away from the list. */}
      {editable && (
        <td className="px-5 py-4" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelected}
            aria-label={`Select ${name}`}
            className="h-4 w-4 cursor-pointer rounded border-line text-teal-dark focus:ring-teal/40"
          />
        </td>
      )}

      {/* Customer */}
      <td className="px-5 py-4">
        <div className="flex items-start gap-3">
          {/* The Stealth Health accent bar — the fastest way to read the split. */}
          <span
            className={`mt-0.5 h-9 w-1 flex-shrink-0 rounded-full ${
              isPuramass ? 'bg-indigo-500' : 'bg-transparent'
            }`}
            aria-hidden
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium text-ink">{name}</span>
              {isPuramass ? (
                <Chip className="bg-indigo-500/10 text-indigo-700">
                  <CreditCard className="h-3 w-3" />
                  Stealth Health
                </Chip>
              ) : (
                <>
                  {row.role && row.role !== 'customer' && (
                    <Chip className={getRoleBadgeClasses(row.role as UserRole)}>
                      {roleLabel(row.role)}
                    </Chip>
                  )}
                  {row.puramass_orders > 0 && (
                    <Chip className="bg-indigo-500/10 text-indigo-700">
                      <CreditCard className="h-3 w-3" />
                      {row.puramass_orders} Stealth Health
                    </Chip>
                  )}
                  {!row.active && <Chip className="bg-red-100 text-red-700">Inactive</Chip>}
                </>
              )}
              <Chip
                className={
                  cur === 'USD'
                    ? 'bg-blue-500/10 text-blue-600'
                    : 'border border-line text-ink-muted'
                }
              >
                {cur}
              </Chip>
              {/* The lead's temperature, which the Lead filter above sorts on.
                  Who claimed them is on their profile — the column that used to
                  name them is gone. */}
              {row.lead?.status && (
                <Chip className={LEAD_STATUS_META[row.lead.status].chip}>
                  {LEAD_STATUS_META[row.lead.status].label}
                </Chip>
              )}
              {meId && row.lead?.claimed_by_id === meId && (
                <Chip className="bg-emerald-500/10 text-emerald-700">Yours</Chip>
              )}
            </div>
            <span className="mt-0.5 block truncate text-xs text-ink-muted">{row.email}</span>
          </div>
        </div>
      </td>

      {/* Location + phone, stacked */}
      <td className="px-5 py-4">
        {location || row.country ? (
          <span className="flex items-center gap-1.5 text-sm text-ink">
            <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-ink-muted" />
            {location || row.country}
          </span>
        ) : (
          <span className="text-sm text-ink-muted">No location</span>
        )}
        {row.phone ? (
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-muted">
            <Phone className="h-3 w-3 flex-shrink-0" />
            {row.phone}
          </span>
        ) : (
          <span className="mt-0.5 block text-xs text-ink-muted/70">No phone</span>
        )}
      </td>

      {/* Created */}
      <td className="px-5 py-4">
        <span className="block text-sm text-ink">{fmtDate(row.created_at)}</span>
        <span className="mt-0.5 block text-xs text-ink-muted">
          {isPuramass ? `first order · ${timeAgo(row.created_at)}` : timeAgo(row.created_at)}
        </span>
      </td>

      {/* Nudged — the last outreach email, and whether it was recent enough
          to think twice about sending another one. */}
      {showNudged && <NudgedCell nudge={row.nudge} />}

      {/* Ships-to clients */}
      <td className="px-5 py-4 text-right">
        {row.clients > 0 ? (
          <>
            <span className="block text-sm font-semibold tabular-nums text-ink">
              {row.clients}
            </span>
            <span className="mt-0.5 block text-xs text-ink-muted">
              {row.clients === 1 ? 'ship-to client' : 'ship-to clients'}
            </span>
          </>
        ) : (
          <>
            <span className="block text-sm tabular-nums text-ink-muted">0</span>
            <span className="mt-0.5 block text-xs text-ink-muted/70">no clients</span>
          </>
        )}
      </td>

      {/* Purchases */}
      <td className="px-5 py-4 text-right">
        {row.purchases > 0 ? (
          <>
            <span className="block text-sm font-semibold tabular-nums text-ink">
              {row.purchases}
            </span>
            <span className="mt-0.5 block text-xs text-ink-muted">
              {purchaseBreakdown(row.purchase_breakdown)}
            </span>
          </>
        ) : (
          <>
            <span className="block text-sm tabular-nums text-ink-muted">0</span>
            <span className="mt-0.5 block text-xs text-ink-muted/70">never bought</span>
          </>
        )}
      </td>

      {/* Actions */}
      <td className="px-5 py-4">
        <div
          className="flex items-center justify-end gap-1"
          // Actions live inside a clickable row — keep their clicks to themselves.
          onClick={(e) => e.stopPropagation()}
        >
          {isPuramass ? (
            <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
              No account
              <ArrowUpRight className="h-3.5 w-3.5" />
            </span>
          ) : editable ? (
            <>
              <IconAction label="Send sign-in link" onClick={onSignInLink} disabled={busy}>
                <Mail className="h-4 w-4" />
              </IconAction>
              <IconAction label="Send password reset link" onClick={onResetLink} disabled={busy}>
                <KeyRound className="h-4 w-4" />
              </IconAction>
              <IconAction label="Edit" onClick={onEdit} disabled={busy}>
                <Pencil className="h-4 w-4" />
              </IconAction>
              <IconAction
                label={row.role === 'admin' ? 'Remove admin' : 'Make admin'}
                onClick={onToggleAdmin}
                disabled={busy}
                tone={row.role === 'admin' ? 'danger' : 'teal'}
              >
                {row.role === 'admin' ? <ShieldOff className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
              </IconAction>
              {deletable && (
                <IconAction label="Delete" onClick={onDelete} disabled={busy} tone="danger">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </IconAction>
              )}
            </>
          ) : (
            <span className="text-xs italic text-ink-muted">View only</span>
          )}
        </div>
      </td>
    </RowLink>
  );
}

/**
 * When we last wrote to this person.
 *
 * Amber inside RECENT_NUDGE_DAYS and plain outside it, because the column is
 * only ever asking one question: is another email right now a second nudge? An
 * admin scanning the list for who to chase needs that answer at a glance, not
 * after reading a date.
 *
 * "Never emailed" is stated rather than left blank — an empty cell in a column
 * fed by a log reads as "we could not tell", and the whole point of the column
 * is that it can.
 */
function NudgedCell({ nudge }: { nudge: NudgeSummary | null }) {
  if (!nudge) {
    return (
      <td className="px-5 py-4">
        <span className="block text-sm text-ink-muted">—</span>
        <span className="mt-0.5 block text-xs text-ink-muted/70">never emailed</span>
      </td>
    );
  }

  const recent = isRecentlyNudged(nudge);
  return (
    <td className="px-5 py-4">
      <span
        className={`block text-sm ${recent ? 'font-semibold text-amber-700' : 'text-ink'}`}
        title={`Last email: ${emailTypeLabel(nudge.template)} on ${fmtDate(nudge.sentAt)}`}
      >
        {timeAgo(nudge.sentAt) || 'just now'}
      </span>
      <span className="mt-0.5 block truncate text-xs text-ink-muted">
        {emailTypeLabel(nudge.template)}
        {nudge.recentCount > 1 && (
          <span className="text-amber-700">
            {' '}· {nudge.recentCount}× in {RECENT_NUDGE_DAYS}d
          </span>
        )}
      </span>
    </td>
  );
}

/**
 * A whole-row link with a cursor-following tooltip.
 *
 * The tooltip is drawn at the pointer (fixed position) rather than anchored to
 * the row: a table row is far wider than the hint, so an anchored tooltip ends
 * up nowhere near where the user is actually looking.
 */
function RowLink({
  children, onOpen, onHover, isPuramass, selected,
}: {
  children: React.ReactNode;
  onOpen: () => void;
  onHover: (pos: { x: number; y: number } | null) => void;
  isPuramass: boolean;
  selected: boolean;
}) {
  // Skip the hint entirely on touch/coarse pointers — it would only ever flash
  // on tap.
  const fine = useRef(true);

  useEffect(() => {
    fine.current =
      typeof window === 'undefined' || window.matchMedia('(pointer: fine)').matches;
    return () => onHover(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <tr
      onClick={onOpen}
      onMouseMove={(e) => { if (fine.current) onHover({ x: e.clientX, y: e.clientY }); }}
      onMouseLeave={() => onHover(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      tabIndex={0}
      role="link"
      className={`cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal/50 ${
        selected
          ? 'bg-teal/5 hover:bg-teal/10'
          : isPuramass
            ? 'bg-indigo-50/40 hover:bg-indigo-50'
            : 'hover:bg-surface'
      }`}
    >
      {children}
    </tr>
  );
}

/** Roughly the rendered width/height, used to keep the hint on-screen. */
const TIP_W = 200;
const TIP_H = 32;

function RowTooltip({ x, y }: { x: number; y: number }) {
  // Flip to the other side of the cursor near the viewport edge rather than
  // letting the hint hang off the page.
  const vw = typeof window === 'undefined' ? Infinity : window.innerWidth;
  const vh = typeof window === 'undefined' ? Infinity : window.innerHeight;
  const left = x + 14 + TIP_W > vw ? Math.max(8, x - 14 - TIP_W) : x + 14;
  const top = y + 16 + TIP_H > vh ? Math.max(8, y - 16 - TIP_H) : y + 16;

  return (
    <div
      className="pointer-events-none fixed z-50 whitespace-nowrap rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink shadow-lg"
      style={{ left, top }}
      role="tooltip"
    >
      Click here to see more info
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

/** "3 invoices · 1 order" — what makes up the purchase count. */
function purchaseBreakdown(b: { invoices: number; orders: number; puramass: number }): string {
  const parts: string[] = [];
  if (b.invoices) parts.push(`${b.invoices} invoice${b.invoices === 1 ? '' : 's'}`);
  if (b.orders) parts.push(`${b.orders} order${b.orders === 1 ? '' : 's'}`);
  if (b.puramass) parts.push(`${b.puramass} Stealth Health`);
  return parts.join(' · ');
}

function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    admin: 'Admin',
    assistant: 'Assistant',
    affiliate: 'Affiliate',
    warehouse: 'Warehouse',
    analytics: 'Analytics',
  };
  return labels[role] ?? role;
}

function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium ${className ?? ''}`}
    >
      {children}
    </span>
  );
}

/**
 * A compact segmented control. The type is deliberately small — at body size
 * the two groups together are wider than the content column, and the last
 * options wrap onto their own line.
 */
function PillGroup({
  label, options, value, onChange,
}: {
  label: string;
  options: { key: string; label: string; count?: number }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </span>
      {/* flex-wrap is a narrow-viewport fallback only — at the compact size
          above, neither group wraps at any normal admin window width. */}
      <div className="flex flex-wrap items-center gap-0.5 rounded-full border border-line bg-white p-0.5">
        {options.map((o) => {
          const active = o.key === value;
          return (
            <button
              key={o.key}
              onClick={() => onChange(o.key)}
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                active ? 'bg-ink text-white' : 'text-ink-muted hover:bg-surface hover:text-ink'
              }`}
            >
              {o.label}
              {o.count !== undefined && (
                <span
                  className={`rounded-full px-1 text-[10px] tabular-nums ${
                    active ? 'bg-white/25 text-white' : 'bg-surface text-ink-muted'
                  }`}
                >
                  {o.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Icon-only action button with a floating white tooltip (downward arrow) on hover.
function IconAction({
  label, onClick, children, disabled, tone = 'neutral',
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  tone?: 'neutral' | 'teal' | 'danger';
}) {
  const toneCls =
    tone === 'danger'
      ? 'text-ink-muted hover:text-red-600 hover:bg-red-50'
      : tone === 'teal'
      ? 'text-ink-muted hover:text-teal-dark hover:bg-teal/10'
      : 'text-ink-muted hover:text-ink hover:bg-surface';
  return (
    <div className="relative group">
      <button
        onClick={onClick}
        disabled={disabled}
        className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-40 ${toneCls}`}
        aria-label={label}
      >
        {children}
      </button>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-white px-2.5 py-1 text-xs font-medium text-ink opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
        {label}
        <span className="absolute left-1/2 top-full -mt-1 h-2 w-2 -translate-x-1/2 rotate-45 border-b border-r border-line bg-white" />
      </span>
    </div>
  );
}
