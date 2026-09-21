'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertCircle, Check, Loader2, MessageSquareQuote, Plus, Save, Trash2, X,
} from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { StarInput, StarRating } from '@/components/reviews/StarRating';
import { TESTIMONIAL_QUOTE_MAX, type Testimonial } from '@/lib/content/testimonials';

/**
 * Testimonial manager — the quotes in the homepage carousel.
 *
 * One card per quote, each with its own **Show on storefront** toggle: the
 * toggle IS `testimonials.enabled`, so retiring a quote never means deleting
 * copy you will want back. New quotes are created switched off, so nothing
 * reaches the homepage before it has been read over.
 *
 * These are NOT product reviews. A review is written by a customer who bought
 * the thing, and no amount of admin access can write one — that is the point
 * of the "Verified purchase" badge beside it. Testimonials are the shop's own
 * marketing copy, which is why they live here and say so on the card.
 */

interface Draft {
  quote: string;
  author_name: string;
  author_label: string;
  rating: number;
  sort_order: number;
}

function toDraft(t: Testimonial): Draft {
  return {
    quote: t.quote,
    author_name: t.author_name,
    author_label: t.author_label ?? '',
    rating: t.rating,
    sort_order: t.sort_order,
  };
}

export default function TestimonialsAdminPage() {
  const { canManageContent } = usePermissions();

  const [rows, setRows] = useState<Testimonial[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Testimonial | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const flash = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 2500);
  };

  const load = async () => {
    try {
      const data = await apiFetch<{ testimonials: Testimonial[] }>('/api/admin/testimonials');
      setRows(data.testimonials);
      setDrafts(Object.fromEntries(data.testimonials.map((t) => [t.id, toDraft(t)])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load testimonials');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canManageContent) void load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageContent]);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const data = await apiFetch<{ testimonial: Testimonial }>('/api/admin/testimonials', {
        method: 'POST',
        body: JSON.stringify({
          quote: 'Exceptional quality and fast shipping.',
          author_name: 'Verified Customer',
          author_label: 'Verified Customer',
          rating: 5,
          // New quotes land at the end of the carousel rather than displacing
          // whatever is running.
          sort_order: rows.length,
        }),
      });
      setRows((prev) => [...prev, data.testimonial]);
      setDrafts((prev) => ({ ...prev, [data.testimonial.id]: toDraft(data.testimonial) }));
      flash('Testimonial created — switch it on when the wording is right.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the testimonial');
    } finally {
      setCreating(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>, message: string) => {
    setSavingId(id);
    setError(null);
    try {
      const data = await apiFetch<{ testimonial: Testimonial }>(`/api/admin/testimonials/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setRows((prev) => prev.map((t) => (t.id === id ? data.testimonial : t)));
      setDrafts((prev) => ({ ...prev, [id]: toDraft(data.testimonial) }));
      flash(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the testimonial');
    } finally {
      setSavingId(null);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/admin/testimonials/${deleteTarget.id}`, { method: 'DELETE' });
      setRows((prev) => prev.filter((t) => t.id !== deleteTarget.id));
      setDeleteTarget(null);
      flash('Testimonial deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the testimonial');
    } finally {
      setDeleting(false);
    }
  };

  if (!canManageContent) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-line bg-white p-8 text-center">
          <AlertCircle className="mx-auto mb-3 h-6 w-6 text-ink-muted" />
          <p className="text-sm text-ink-muted">Your role can&rsquo;t manage testimonials.</p>
        </div>
      </div>
    );
  }

  const liveCount = rows.filter((t) => t.enabled).length;

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-ink">
            <MessageSquareQuote className="h-6 w-6 text-teal-dark" />
            Testimonials
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            The quotes in the &ldquo;What Our Customers Say&rdquo; carousel on the home page.{' '}
            {liveCount > 0
              ? `${liveCount} ${liveCount === 1 ? 'is' : 'are'} showing right now.`
              : 'Nothing is showing right now — the section hides itself.'}{' '}
            Product star ratings are separate: those are written by customers who bought the
            product and cannot be edited here.
          </p>
        </div>
        <button
          onClick={() => void create()}
          disabled={creating}
          className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ink/90 disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          New testimonial
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
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading testimonials…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-white p-10 text-center">
          <MessageSquareQuote className="mx-auto mb-3 h-6 w-6 text-ink-light" />
          <p className="text-sm text-ink-muted">
            No testimonials yet. The home page simply leaves the section out until there is one.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => {
            const draft = drafts[row.id] ?? toDraft(row);
            const dirty =
              draft.quote !== row.quote ||
              draft.author_name !== row.author_name ||
              draft.author_label !== (row.author_label ?? '') ||
              draft.rating !== row.rating ||
              draft.sort_order !== row.sort_order;
            const set = (patchDraft: Partial<Draft>) =>
              setDrafts((prev) => ({ ...prev, [row.id]: { ...draft, ...patchDraft } }));

            return (
              <div key={row.id} className="rounded-xl border border-line bg-white p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={(e) =>
                        void patch(
                          row.id,
                          { enabled: e.target.checked },
                          e.target.checked ? 'Showing on the home page.' : 'Hidden from the home page.',
                        )
                      }
                      className="h-4 w-4 rounded border-line text-teal-dark focus:ring-teal/40"
                    />
                    <span className="text-sm font-medium text-ink">Show on storefront</span>
                  </label>
                  {row.enabled ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                      Live
                    </span>
                  ) : (
                    <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
                      Hidden
                    </span>
                  )}

                  <button
                    onClick={() => setDeleteTarget(row)}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>

                <div className="grid gap-4 lg:grid-cols-[1fr,260px]">
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-ink">Quote</label>
                      <textarea
                        value={draft.quote}
                        rows={3}
                        maxLength={TESTIMONIAL_QUOTE_MAX}
                        onChange={(e) => set({ quote: e.target.value })}
                        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
                      />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-ink">Name</label>
                        <input
                          type="text"
                          value={draft.author_name}
                          onChange={(e) => set({ author_name: e.target.value })}
                          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-ink">
                          Label <span className="font-normal text-ink-muted">(optional)</span>
                        </label>
                        <input
                          type="text"
                          value={draft.author_label}
                          placeholder="Verified Customer"
                          onChange={(e) => set({ author_label: e.target.value })}
                          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-ink">Rating</label>
                        <StarInput
                          value={draft.rating}
                          size="lg"
                          onChange={(rating) => set({ rating })}
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-ink">
                          Order <span className="font-normal text-ink-muted">(low first)</span>
                        </label>
                        <input
                          type="number"
                          value={draft.sort_order}
                          onChange={(e) => set({ sort_order: Number(e.target.value) })}
                          className="w-24 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
                        />
                      </div>
                    </div>

                    <button
                      onClick={() =>
                        void patch(
                          row.id,
                          {
                            quote: draft.quote,
                            author_name: draft.author_name,
                            author_label: draft.author_label,
                            rating: draft.rating,
                            sort_order: draft.sort_order,
                          },
                          'Testimonial saved.',
                        )
                      }
                      disabled={!dirty || savingId === row.id}
                      className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ink/90 disabled:opacity-50"
                    >
                      {savingId === row.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      Save changes
                    </button>
                  </div>

                  {/* Live preview, rendered with the carousel's own stars — the
                      wording reads differently in quote marks than in a field. */}
                  <div className="rounded-xl border border-line bg-surface p-5 text-center">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-light">
                      Home page
                    </p>
                    <StarRating value={draft.rating} size="md" className="mb-2 justify-center" />
                    <p className="text-sm leading-relaxed text-ink">
                      &ldquo;{draft.quote || 'Your quote appears here.'}&rdquo;
                    </p>
                    <p className="mt-2 text-xs text-ink-muted">
                      — {draft.author_name || 'Verified Customer'}
                      {draft.author_label && (
                        <span className="text-ink-light">, {draft.author_label}</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-3 flex items-start gap-3">
              <Trash2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
              <div>
                <h2 className="text-base font-bold text-ink">Delete this testimonial?</h2>
                <p className="mt-1 text-sm text-ink-muted">
                  This cannot be undone. To take it off the home page without losing the wording,
                  switch <span className="font-medium">Show on storefront</span> off instead.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-ink-muted hover:text-ink"
              >
                <X className="h-4 w-4" />
                Cancel
              </button>
              <button
                onClick={() => void remove()}
                disabled={deleting}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
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
