'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users, Search, Plus, Pencil, Power, Trash2, FileText, RefreshCw, Loader2,
  Tag, Send, KeyRound,
} from 'lucide-react';
import { toggleAffiliateActive } from '@/lib/admin/api';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import { useUserRole } from '../layout';
import { canEdit, canDelete } from '@/lib/permissions';
import { CONTACT_METHOD_LABEL, LEAD_STATUS_META, type Lead } from '@/lib/admin/customer-leads';
import PendingAffiliateRequests from './_components/PendingAffiliateRequests';
import PendingReferralCodeRequests from './_components/PendingReferralCodeRequests';
import CreateAffiliateModal from './_components/CreateAffiliateModal';
import EditAffiliateModal from './_components/EditAffiliateModal';
import DeleteAffiliateDialog from './_components/DeleteAffiliateDialog';

/** One row of /api/admin/affiliates/directory. */
interface AffiliateRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  wallet_address: string | null;
  active: boolean;
  created_at: string | null;
  commission_rate: number | null;
  referral_code: string | null;
  referral_uses: number;
  code_count: number;
  total_earnings: number;
  pending_earnings: number;
  paid_earnings: number;
  commission_count: number;
  bound_customers: number;
  customer_revenue: number;
  last_commission_at: string | null;
  lead: Lead | null;
}

interface Counts {
  all: number;
  active: number;
  inactive: number;
  claimed: number;
  unclaimed: number;
}

const EMPTY_COUNTS: Counts = { all: 0, active: 0, inactive: 0, claimed: 0, unclaimed: 0 };

type Segment = 'all' | 'active' | 'inactive';

const SEGMENTS: { key: Segment; label: string; countKey: keyof Counts }[] = [
  { key: 'all', label: 'All', countKey: 'all' },
  { key: 'active', label: 'Active', countKey: 'active' },
  { key: 'inactive', label: 'Inactive', countKey: 'inactive' },
];

type SortKey = 'newest' | 'oldest' | 'earnings' | 'customers' | 'name';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'earnings', label: 'Top earning' },
  { key: 'customers', label: 'Most referrals' },
  { key: 'name', label: 'A–Z' },
];

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
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

const fullName = (a: AffiliateRow) => `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim();

// The affiliate tables carry no currency column, so amounts keep the bare `$`
// this page has always used rather than asserting a currency the data lacks.
const fmtAmount = (n: number) => `$${(n ?? 0).toFixed(2)}`;

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return 'just now';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}d ago`;
  const months = Math.round(days / 30.4);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

export default function AdminAffiliates() {
  const userRole = useUserRole();
  const router = useRouter();
  const toast = useToast();
  const editable = canEdit(userRole);
  const deletable = canDelete(userRole);

  const [rows, setRows] = useState<AffiliateRow[]>([]);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [leadsAvailable, setLeadsAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState<Segment>('all');
  const [sort, setSort] = useState<SortKey>('newest');
  const [leadFilter, setLeadFilter] = useState<LeadFilter>('any');
  const [meId, setMeId] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editAffiliate, setEditAffiliate] = useState<AffiliateRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AffiliateRow | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (opts.silent) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch('/api/admin/affiliates/directory', {
        cache: 'no-store',
        headers: await authHeaders(),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load affiliates');
      setRows(json.affiliates ?? []);
      setCounts(json.counts ?? EMPTY_COUNTS);
      setLeadsAvailable(json.leadsAvailable !== false);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load affiliates');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMeId(data.user?.id ?? null));
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();

    const inSegment = (a: AffiliateRow) =>
      segment === 'all' ? true : segment === 'active' ? a.active : !a.active;

    const inLeadFilter = (a: AffiliateRow) => {
      switch (leadFilter) {
        case 'mine':
          return Boolean(meId && a.lead?.claimed_by_id === meId);
        case 'unclaimed':
          return !a.lead?.claimed_by_id;
        case 'hot':
        case 'warm':
        case 'cold':
          return a.lead?.status === leadFilter;
        default:
          return true;
      }
    };

    const matches = (a: AffiliateRow) =>
      !q ||
      fullName(a).toLowerCase().includes(q) ||
      a.email.toLowerCase().includes(q) ||
      (a.referral_code ?? '').toLowerCase().includes(q);

    const list = rows.filter((a) => inSegment(a) && inLeadFilter(a) && matches(a));

    const byDate = (x: string | null, y: string | null, dir: 1 | -1) => {
      if (!x && !y) return 0;
      if (!x) return 1;
      if (!y) return -1;
      return x < y ? dir : x > y ? -dir : 0;
    };

    return [...list].sort((a, b) => {
      switch (sort) {
        case 'oldest':
          return byDate(a.created_at, b.created_at, -1);
        case 'earnings':
          return b.total_earnings - a.total_earnings;
        case 'customers':
          return b.bound_customers - a.bound_customers;
        case 'name':
          return (fullName(a) || a.email).localeCompare(fullName(b) || b.email);
        default:
          return byDate(a.created_at, b.created_at, 1);
      }
    });
  }, [rows, search, segment, sort, leadFilter, meId]);

  const handleToggleActive = async (aff: AffiliateRow) => {
    setToggling(aff.id);
    await toggleAffiliateActive(aff.id, !aff.active);
    setToggling(null);
    load({ silent: true });
  };

  // Affiliates authenticate through Supabase auth — the `password_hash` column
  // on the affiliates row is legacy — so a recovery link is what actually lets
  // them set a new password.
  const handleResetLink = async (aff: AffiliateRow) => {
    setLinking(aff.id);
    try {
      const res = await fetch(`/api/admin/affiliates/${aff.id}/magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ redirectPath: '/reset-password', purpose: 'reset' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to send link');
      if (json.emailed) toast.success('Password reset link emailed to the affiliate');
      else if (json.action_link) {
        await navigator.clipboard?.writeText(json.action_link).catch(() => {});
        toast.success('Mailer not configured — password reset link copied to clipboard');
      } else toast.success('Password reset link generated');
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to send password reset link');
    } finally {
      setLinking(null);
    }
  };

  const downloadReport = async () => {
    setDownloading(true);
    try {
      const params = new URLSearchParams();
      if (segment !== 'all') params.set('status', segment);
      if (search) params.set('q', search);
      const qs = params.toString();
      const res = await fetch(`/api/admin/affiliates/report${qs ? `?${qs}` : ''}`, {
        headers: await authHeaders(),
      });
      if (!res.ok) {
        setError('Could not generate report');
        return;
      }
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), '_blank');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      {/* Pending requests (self-hides when empty) */}
      <PendingAffiliateRequests canReview={editable} onApproved={() => load({ silent: true })} />

      <PendingReferralCodeRequests canReview={editable} onDecided={() => load({ silent: true })} />

      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2.5">
            <Users className="h-6 w-6 text-bronze" />
            <h1 className="text-xl font-bold text-ink">Affiliates</h1>
          </div>
          <p className="max-w-2xl text-sm text-ink-muted">
            Claim an affiliate to own the relationship, track how it&apos;s going, and email them
            offers to push. Click any row to open their full profile.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => load({ silent: true })}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={downloadReport}
            disabled={downloading}
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface disabled:opacity-50"
          >
            <FileText className="h-4 w-4" />
            {downloading ? 'Generating…' : 'Report'}
          </button>
          {editable && (
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-ink/90"
            >
              <Plus className="h-4 w-4" />
              Add affiliate
            </button>
          )}
        </div>
      </div>

      {/* Filter + sort pills */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <PillGroup
          label="Show"
          options={SEGMENTS.map((s) => ({ key: s.key, label: s.label, count: counts[s.countKey] }))}
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
            placeholder="Search name, email or referral code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-line bg-white py-2.5 pl-10 pr-4 text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-bronze/40"
          />
        </div>
      </div>

      {!leadsAvailable && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Lead management is not set up on this database yet, so every affiliate reads as
          unclaimed. Run <code className="font-mono text-xs">customer-crm-migration.sql</code> to
          enable claiming, lead status and contact tracking.
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-line bg-white">
        <div className="flex items-center justify-between border-b border-line p-5 md:p-6">
          <h2 className="text-lg font-bold text-ink">
            {SEGMENTS.find((s) => s.key === segment)?.label ?? 'All'} affiliates
          </h2>
          <span className="text-sm text-ink-muted">
            {visible.length} {visible.length === 1 ? 'result' : 'results'}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead>
              <tr className="border-b border-line">
                <Th>Affiliate</Th>
                <Th>Referral code</Th>
                <Th align="right">Customers</Th>
                <Th align="right">Earnings</Th>
                <Th>Joined</Th>
                <Th>Claimed by</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center text-sm text-ink-muted">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                    Loading affiliates…
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-ink-muted">
                    {rows.length === 0 ? 'No affiliates yet' : 'No affiliates match your filters'}
                  </td>
                </tr>
              ) : (
                visible.map((aff) => (
                  <AffiliateTableRow
                    key={aff.id}
                    row={aff}
                    meId={meId}
                    editable={editable}
                    deletable={deletable}
                    toggling={toggling === aff.id}
                    onOpen={() => router.push(`/admin/affiliates/${aff.id}`)}
                    onHover={setTip}
                    onEdit={() => setEditAffiliate(aff)}
                    linking={linking === aff.id}
                    onResetLink={() => handleResetLink(aff)}
                    onToggleActive={() => handleToggleActive(aff)}
                    onDelete={() => setDeleteTarget(aff)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {tip && <RowTooltip x={tip.x} y={tip.y} />}

      {showCreate && (
        <CreateAffiliateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => load({ silent: true })}
        />
      )}
      {editAffiliate && (
        <EditAffiliateModal
          affiliate={{
            id: editAffiliate.id,
            first_name: editAffiliate.first_name ?? '',
            last_name: editAffiliate.last_name ?? '',
            email: editAffiliate.email,
            wallet_address: editAffiliate.wallet_address,
            active: editAffiliate.active,
          }}
          onClose={() => setEditAffiliate(null)}
          onSaved={() => { setEditAffiliate(null); load({ silent: true }); }}
        />
      )}
      {deleteTarget && (
        <DeleteAffiliateDialog
          affiliate={{
            id: deleteTarget.id,
            first_name: deleteTarget.first_name ?? '',
            last_name: deleteTarget.last_name ?? '',
            email: deleteTarget.email,
          }}
          onClose={() => setDeleteTarget(null)}
          onDone={() => { setDeleteTarget(null); load({ silent: true }); }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

function AffiliateTableRow({
  row, meId, editable, deletable, toggling, linking, onOpen, onHover, onEdit, onResetLink, onToggleActive, onDelete,
}: {
  row: AffiliateRow;
  meId: string | null;
  editable: boolean;
  deletable: boolean;
  toggling: boolean;
  linking: boolean;
  onOpen: () => void;
  onHover: (pos: { x: number; y: number } | null) => void;
  onEdit: () => void;
  onResetLink: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const name = fullName(row) || row.email;
  // Rates are stored as either a fraction (0.1) or a percentage (10).
  const ratePct =
    row.commission_rate == null
      ? null
      : row.commission_rate <= 1
        ? row.commission_rate * 100
        : row.commission_rate;

  return (
    <RowLink onOpen={onOpen} onHover={onHover}>
      {/* Affiliate */}
      <td className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-ink">{name}</span>
          <Chip
            className={
              row.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-500'
            }
          >
            {row.active ? 'Active' : 'Inactive'}
          </Chip>
          {ratePct != null && (
            <Chip className="border border-line text-ink-muted">{ratePct.toFixed(0)}%</Chip>
          )}
        </div>
        <span className="mt-0.5 block truncate text-xs text-ink-muted">{row.email}</span>
      </td>

      {/* Referral code + uses */}
      <td className="px-5 py-4">
        {row.referral_code ? (
          <span className="flex items-center gap-1.5 font-mono text-sm text-ink">
            <Tag className="h-3.5 w-3.5 flex-shrink-0 text-ink-muted" />
            {row.referral_code}
          </span>
        ) : (
          <span className="text-sm text-ink-muted">No code</span>
        )}
        <span className="mt-0.5 block text-xs text-ink-muted">
          {row.referral_uses} referral{row.referral_uses === 1 ? '' : 's'}
          {row.code_count > 1 ? ` · ${row.code_count} codes` : ''}
        </span>
      </td>

      {/* Bound customers + their spend */}
      <td className="px-5 py-4 text-right">
        <span className="block text-sm font-semibold tabular-nums text-ink">
          {row.bound_customers}
        </span>
        <span className="mt-0.5 block text-xs tabular-nums text-ink-muted">
          {row.customer_revenue > 0 ? `${fmtAmount(row.customer_revenue)} sales` : 'no sales yet'}
        </span>
      </td>

      {/* Earnings: total on top, pending below */}
      <td className="px-5 py-4 text-right">
        <span className="block text-sm font-semibold tabular-nums text-emerald-600">
          {fmtAmount(row.total_earnings)}
        </span>
        <span className="mt-0.5 block text-xs tabular-nums text-bronze">
          {row.pending_earnings > 0 ? `${fmtAmount(row.pending_earnings)} pending` : 'nothing pending'}
        </span>
      </td>

      {/* Joined */}
      <td className="px-5 py-4">
        <span className="block text-sm text-ink">{fmtDate(row.created_at)}</span>
        <span className="mt-0.5 block text-xs text-ink-muted">{timeAgo(row.created_at)}</span>
      </td>

      {/* Claimed by + lead status */}
      <td className="px-5 py-4">
        {row.lead?.claimed_by_id ? (
          <>
            <span className="block truncate text-sm text-ink">
              {row.lead.claimed_by_name || row.lead.claimed_by_email || 'An admin'}
              {meId && row.lead.claimed_by_id === meId && (
                <span className="ml-1 text-xs font-medium text-emerald-700">(you)</span>
              )}
            </span>
            <span className="mt-1 flex items-center gap-1.5">
              <Chip className={LEAD_STATUS_META[row.lead.status].chip}>
                {LEAD_STATUS_META[row.lead.status].label}
              </Chip>
              {row.lead.contact_method && (
                <span className="text-xs text-ink-muted">
                  via {CONTACT_METHOD_LABEL[row.lead.contact_method]}
                </span>
              )}
            </span>
          </>
        ) : (
          <>
            <span className="block text-sm text-ink-muted">Unclaimed</span>
            <span className="mt-0.5 block text-xs text-ink-muted/70">open to anyone</span>
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
          {editable ? (
            <>
              <IconAction label="Open profile" onClick={onOpen}>
                <Send className="h-4 w-4" />
              </IconAction>
              <IconAction label="Edit" onClick={onEdit}>
                <Pencil className="h-4 w-4" />
              </IconAction>
              <IconAction label="Send password reset link" onClick={onResetLink} disabled={linking}>
                {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              </IconAction>
              <IconAction
                label={row.active ? 'Deactivate' : 'Activate'}
                onClick={onToggleActive}
                disabled={toggling}
                tone={row.active ? 'warning' : 'bronze'}
              >
                {toggling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
              </IconAction>
              {deletable && (
                <IconAction label="Delete" onClick={onDelete} tone="danger">
                  <Trash2 className="h-4 w-4" />
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
 * A whole-row link with a cursor-following tooltip. The hint is drawn at the
 * pointer rather than anchored to the row, which is far wider than the hint.
 */
function RowLink({
  children, onOpen, onHover,
}: {
  children: React.ReactNode;
  onOpen: () => void;
  onHover: (pos: { x: number; y: number } | null) => void;
}) {
  // Skip the hint on touch/coarse pointers — it would only flash on tap.
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
      className="cursor-pointer transition-colors hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bronze/50"
    >
      {children}
    </tr>
  );
}

/** Roughly the rendered size, used to keep the hint on-screen. */
const TIP_W = 200;
const TIP_H = 32;

function RowTooltip({ x, y }: { x: number; y: number }) {
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

function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium ${className ?? ''}`}
    >
      {children}
    </span>
  );
}

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

function IconAction({
  label, onClick, children, disabled, tone = 'neutral',
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  tone?: 'neutral' | 'bronze' | 'warning' | 'danger';
}) {
  const toneCls =
    tone === 'danger'
      ? 'text-ink-muted hover:text-red-600 hover:bg-red-50'
      : tone === 'warning'
      ? 'text-ink-muted hover:text-amber-600 hover:bg-amber-50'
      : tone === 'bronze'
      ? 'text-ink-muted hover:text-bronze hover:bg-bronze/10'
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
