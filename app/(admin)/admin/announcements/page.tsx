'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, ArrowRight, Check, Loader2, Megaphone, Plus, Radio, Save, Trash2, X,
} from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { usePermissions } from '@/lib/hooks/usePermissions';
import {
  ANNOUNCEMENT_THEMES,
  announcementStyle,
  isAnnouncementLive,
  type Announcement,
  type AnnouncementTheme,
} from '@/lib/content/announcements';

/**
 * Announcement bar manager.
 *
 * One row per banner, each with its own **Show on storefront** toggle — the
 * toggle IS `announcements.enabled`, so turning a campaign off never means
 * deleting the copy you will want again next month.
 *
 * Every card carries a live preview rendered with the same colours and marquee
 * the storefront uses, because "what does amber look like scrolling" is not a
 * question anyone should have to answer by publishing.
 */

/** The editable shape of one banner, as the form holds it. */
interface Draft {
  message: string;
  link_url: string;
  link_label: string;
  theme: AnnouncementTheme;
  bg_color: string;
  text_color: string;
  scrolling: boolean;
  speed_seconds: number;
  dismissible: boolean;
  sort_order: number;
  starts_at: string;
  ends_at: string;
}

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in LOCAL time, not an ISO string. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toDraft(a: Announcement): Draft {
  return {
    message: a.message,
    link_url: a.link_url ?? '',
    link_label: a.link_label ?? '',
    theme: a.theme,
    bg_color: a.bg_color ?? '#07203A',
    text_color: a.text_color ?? '#FFFFFF',
    scrolling: a.scrolling,
    speed_seconds: a.speed_seconds,
    dismissible: a.dismissible,
    sort_order: a.sort_order,
    starts_at: toLocalInput(a.starts_at),
    ends_at: toLocalInput(a.ends_at),
  };
}

const EMPTY_DRAFT: Draft = {
  message: '',
  link_url: '',
  link_label: '',
  theme: 'brand',
  bg_color: '#07203A',
  text_color: '#FFFFFF',
  scrolling: false,
  speed_seconds: 24,
  dismissible: false,
  sort_order: 0,
  starts_at: '',
  ends_at: '',
};

function draftEquals(a: Draft, b: Draft): boolean {
  return (Object.keys(EMPTY_DRAFT) as Array<keyof Draft>).every((key) => a[key] === b[key]);
}

export default function AnnouncementsPage() {
  const { canManageContent } = usePermissions();

  const [rows, setRows] = useState<Announcement[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(''), 3500);
    return () => clearTimeout(timer);
  }, [success]);

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<{ announcements: Announcement[] }>('/api/admin/announcements');
      setRows(data.announcements ?? []);
      setDrafts(Object.fromEntries((data.announcements ?? []).map((a) => [a.id, toDraft(a)])));
      setError('');
    } catch (err: any) {
      setError(err?.message || 'Could not load announcements');
    } finally {
      setLoading(false);
    }
  }

  const liveCount = useMemo(() => rows.filter((a) => isAnnouncementLive(a)).length, [rows]);

  const setDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const isDirty = (a: Announcement) => {
    const draft = drafts[a.id];
    return !!draft && !draftEquals(draft, toDraft(a));
  };

  const create = async () => {
    setCreating(true);
    setError('');
    try {
      const data = await apiFetch<{ announcement: Announcement }>('/api/admin/announcements', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Free shipping on orders over $300 — worldwide.',
          theme: 'brand',
          sort_order: rows.length,
        }),
      });
      const created = data.announcement;
      setRows((prev) => [created, ...prev]);
      setDrafts((prev) => ({ ...prev, [created.id]: toDraft(created) }));
      setSuccess('Banner created — it is off until you switch it on.');
    } catch (err: any) {
      setError(err?.message || 'Could not create the banner');
    } finally {
      setCreating(false);
    }
  };

  /** PATCH one banner with `patch`, defaulting to its staged draft. */
  const save = async (a: Announcement, patch?: Record<string, unknown>) => {
    const draft = drafts[a.id];
    const body = patch ?? {
      ...draft,
      // Empty strings mean "no schedule"; the API turns them back into NULL.
      starts_at: draft.starts_at || '',
      ends_at: draft.ends_at || '',
    };
    setSavingId(a.id);
    setError('');
    try {
      const data = await apiFetch<{ announcement: Announcement }>(
        `/api/admin/announcements/${a.id}`,
        { method: 'PATCH', body: JSON.stringify(body) },
      );
      const saved = data.announcement;
      setRows((prev) => prev.map((row) => (row.id === saved.id ? saved : row)));
      setDrafts((prev) => ({ ...prev, [saved.id]: toDraft(saved) }));
      setSuccess(
        patch && 'enabled' in patch
          ? patch.enabled
            ? 'Banner is now showing on the storefront'
            : 'Banner hidden from the storefront'
          : 'Banner saved',
      );
    } catch (err: any) {
      setError(err?.message || 'Could not save the banner');
    } finally {
      setSavingId(null);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/admin/announcements/${deleteTarget.id}`, { method: 'DELETE' });
      setRows((prev) => prev.filter((row) => row.id !== deleteTarget.id));
      setSuccess('Banner deleted');
      setDeleteTarget(null);
    } catch (err: any) {
      setError(err?.message || 'Could not delete the banner');
    } finally {
      setDeleting(false);
    }
  };

  if (!canManageContent) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-line bg-white p-8 text-center">
          <AlertCircle className="mx-auto mb-3 h-6 w-6 text-ink-muted" />
          <p className="text-sm text-ink-muted">
            Your role can’t manage storefront announcements.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-ink">
            <Megaphone className="h-6 w-6 text-teal-dark" />
            Announcements
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            The sticky bar at the top of every storefront page.{' '}
            {liveCount > 0
              ? `${liveCount} banner${liveCount === 1 ? ' is' : 's are'} showing right now.`
              : 'Nothing is showing right now.'}{' '}
            Several live banners rotate every few seconds.
          </p>
        </div>
        <button
          onClick={() => void create()}
          disabled={creating}
          className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ink/90 disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          New banner
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <Check className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-3 rounded-xl border border-line bg-white p-12 text-sm text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading banners…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-white p-12 text-center">
          <Radio className="mx-auto mb-3 h-7 w-7 text-ink-muted" />
          <p className="text-sm font-medium text-ink">No banners yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
            Create one for a sale, a shipping notice or a compliance reminder. It stays off until
            you switch it on, so you can write and preview it first.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <AnnouncementCard
              key={row.id}
              row={row}
              draft={drafts[row.id] ?? EMPTY_DRAFT}
              dirty={isDirty(row)}
              saving={savingId === row.id}
              onChange={(patch) => setDraft(row.id, patch)}
              onSave={() => void save(row)}
              onToggle={() => void save(row, { enabled: !row.enabled })}
              onRevert={() => setDrafts((prev) => ({ ...prev, [row.id]: toDraft(row) }))}
              onDelete={() => setDeleteTarget(row)}
            />
          ))}
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6">
            <h2 className="mb-2 text-lg font-bold text-ink">Delete this banner?</h2>
            <p className="mb-5 text-sm text-ink-muted">
              “{deleteTarget.message.slice(0, 90)}
              {deleteTarget.message.length > 90 ? '…' : ''}” will be removed for good. If you only
              want it off the storefront, switch it off instead.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 rounded-lg bg-surface px-4 py-2.5 text-sm font-medium text-ink hover:bg-line/50"
              >
                Cancel
              </button>
              <button
                onClick={() => void remove()}
                disabled={deleting}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One banner
// ---------------------------------------------------------------------------

function AnnouncementCard({
  row, draft, dirty, saving, onChange, onSave, onToggle, onRevert, onDelete,
}: {
  row: Announcement;
  draft: Draft;
  dirty: boolean;
  saving: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onSave: () => void;
  onToggle: () => void;
  onRevert: () => void;
  onDelete: () => void;
}) {
  // Preview the DRAFT, not the saved row — the point is seeing an edit before
  // it ships.
  const previewStyle = announcementStyle({ ...row, ...draft } as Announcement);
  const live = isAnnouncementLive(row);
  const scheduled = !!(row.starts_at || row.ends_at);

  const field =
    'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40';
  const label = 'block text-xs font-medium text-ink-muted mb-1';

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white">
      {/* Live preview — the storefront's own colours and marquee */}
      <div style={previewStyle} className="text-xs sm:text-sm">
        {draft.scrolling ? (
          <div className="vyta-marquee overflow-hidden py-2">
            <div className="vyta-marquee-track" style={{ animationDuration: `${draft.speed_seconds}s` }}>
              {[0, 1].map((i) => (
                <span key={i} className="vyta-marquee-item" aria-hidden={i === 1}>
                  <span>{draft.message || 'Your announcement…'}</span>
                  {draft.link_url && (
                    <span className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
                      {draft.link_label || 'Learn more'}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-10 py-2 text-center">
            <span>{draft.message || 'Your announcement…'}</span>
            {draft.link_url && (
              <span className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
                {draft.link_label || 'Learn more'}
                <ArrowRight className="h-3.5 w-3.5" />
              </span>
            )}
          </div>
        )}
      </div>

      {/* Status strip */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2.5">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
            live
              ? 'bg-emerald-100 text-emerald-700'
              : row.enabled
                ? 'bg-amber-100 text-amber-700'
                : 'bg-surface-2 text-ink-muted'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-emerald-500' : row.enabled ? 'bg-amber-500' : 'bg-ink-muted/50'}`} />
          {live ? 'Showing now' : row.enabled ? 'On, outside its dates' : 'Off'}
        </span>
        {scheduled && (
          <span className="text-[11px] text-ink-muted">
            {row.starts_at ? `from ${new Date(row.starts_at).toLocaleString()}` : ''}
            {row.starts_at && row.ends_at ? ' · ' : ''}
            {row.ends_at ? `until ${new Date(row.ends_at).toLocaleString()}` : ''}
          </span>
        )}
        {dirty && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            Unsaved changes
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* The storefront toggle. Saved immediately — it is the one control
              people reach for in a hurry. */}
          <button
            onClick={onToggle}
            disabled={saving}
            role="switch"
            aria-checked={row.enabled}
            className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${
              row.enabled ? 'bg-teal' : 'bg-line'
            }`}
            title={row.enabled ? 'Hide from the storefront' : 'Show on the storefront'}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                row.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
            />
          </button>
          <span className="hidden text-xs text-ink-muted sm:inline">Show on storefront</span>
          <button
            onClick={onDelete}
            className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-red-50 hover:text-red-600"
            title="Delete banner"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <label className={label}>Message</label>
          <textarea
            value={draft.message}
            onChange={(e) => onChange({ message: e.target.value })}
            rows={2}
            className={field}
            placeholder="Free shipping on orders over $300 — worldwide."
          />
        </div>

        <div>
          <label className={label}>Link URL (optional)</label>
          <input
            value={draft.link_url}
            onChange={(e) => onChange({ link_url: e.target.value })}
            className={field}
            placeholder="/products or https://…"
          />
        </div>
        <div>
          <label className={label}>Link label</label>
          <input
            value={draft.link_label}
            onChange={(e) => onChange({ link_label: e.target.value })}
            className={field}
            placeholder="Shop now"
          />
        </div>

        <div className="lg:col-span-2">
          <label className={label}>Colour</label>
          <div className="flex flex-wrap gap-2">
            {ANNOUNCEMENT_THEMES.map((theme) => (
              <button
                key={theme.key}
                type="button"
                onClick={() => onChange({ theme: theme.key })}
                aria-pressed={draft.theme === theme.key}
                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  draft.theme === theme.key
                    ? 'border-teal bg-teal/10 text-teal-dark'
                    : 'border-line bg-white text-ink-muted hover:border-teal/40 hover:text-ink'
                }`}
              >
                <span
                  className="h-4 w-4 rounded-full border border-black/10"
                  style={{ background: theme.key === 'custom' ? draft.bg_color : theme.background }}
                />
                {theme.label}
              </button>
            ))}
          </div>
          {draft.theme === 'custom' && (
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-ink-muted">
                Background
                <input
                  type="color"
                  value={draft.bg_color}
                  onChange={(e) => onChange({ bg_color: e.target.value })}
                  className="h-8 w-12 cursor-pointer rounded border border-line bg-white"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-ink-muted">
                Text
                <input
                  type="color"
                  value={draft.text_color}
                  onChange={(e) => onChange({ text_color: e.target.value })}
                  className="h-8 w-12 cursor-pointer rounded border border-line bg-white"
                />
              </label>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={draft.scrolling}
              onChange={(e) => onChange({ scrolling: e.target.checked })}
              className="h-4 w-4 rounded border-line accent-teal"
            />
            Scroll the message (marquee)
          </label>
          {draft.scrolling && (
            <div>
              <label className={label}>
                One full pass takes {draft.speed_seconds}s — lower is faster
              </label>
              <input
                type="range"
                min={6}
                max={60}
                value={draft.speed_seconds}
                onChange={(e) => onChange({ speed_seconds: Number(e.target.value) })}
                className="w-full accent-teal"
              />
            </div>
          )}
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={draft.dismissible}
              onChange={(e) => onChange({ dismissible: e.target.checked })}
              className="h-4 w-4 rounded border-line accent-teal"
            />
            Visitors can dismiss it
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Starts (optional)</label>
            <input
              type="datetime-local"
              value={draft.starts_at}
              onChange={(e) => onChange({ starts_at: e.target.value })}
              className={field}
            />
          </div>
          <div>
            <label className={label}>Ends (optional)</label>
            <input
              type="datetime-local"
              value={draft.ends_at}
              onChange={(e) => onChange({ ends_at: e.target.value })}
              className={field}
            />
          </div>
          <div className="col-span-2">
            <label className={label}>Order (lower shows first)</label>
            <input
              type="number"
              value={draft.sort_order}
              onChange={(e) => onChange({ sort_order: Number(e.target.value) })}
              className={field}
            />
          </div>
        </div>
      </div>

      {/* Save bar */}
      <div className="flex items-center gap-2 border-t border-line bg-surface px-4 py-3">
        <p className="text-[11px] text-ink-muted">
          Scheduling is optional — leave both dates empty to run until you switch it off.
        </p>
        <div className="ml-auto flex items-center gap-2">
          {dirty && (
            <button
              onClick={onRevert}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink hover:bg-surface"
            >
              <X className="h-4 w-4" />
              Revert
            </button>
          )}
          <button
            onClick={onSave}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
