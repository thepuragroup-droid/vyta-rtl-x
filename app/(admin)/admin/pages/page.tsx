'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle, Check, ExternalLink, FileEdit, Loader2, Pencil, Plus, Trash2,
} from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { isSystemPage, type SitePage } from '@/lib/content/pages';
import { slugify } from '@/lib/content/blocks';

/**
 * Editable storefront pages.
 *
 * About Us ships seeded and is the reason this screen exists; any other
 * marketing page can be added here and lives at `/p/<slug>`. Each row carries
 * its own **Published** state — the storefront toggle — so a page can be
 * written, previewed and held back until it's ready.
 */
export default function SitePagesListPage() {
  const { canManageContent } = usePermissions();

  const [pages, setPages] = useState<SitePage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [creating, setCreating] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<SitePage | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(''), 3500);
    return () => clearTimeout(timer);
  }, [success]);

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<{ pages: SitePage[] }>('/api/admin/site-pages');
      const rows = data.pages ?? [];
      // The About page is seeded by the migration, but a database that hasn't
      // run it yet must still offer the row — the editor creates it on save.
      setPages(
        rows.some((p) => p.slug === 'about')
          ? rows
          : [
              {
                id: 'about-placeholder', slug: 'about', title: 'About VYTA Biosciences',
                subtitle: null, hero_image_url: null, blocks: [], seo_title: null,
                seo_description: null, published: false, created_at: '', updated_at: '',
              },
              ...rows,
            ],
      );
      setError('');
    } catch (err: any) {
      setError(err?.message || 'Could not load pages');
    } finally {
      setLoading(false);
    }
  }

  const create = async () => {
    setCreating(true);
    setError('');
    try {
      const data = await apiFetch<{ page: SitePage }>('/api/admin/site-pages', {
        method: 'POST',
        body: JSON.stringify({ title: newTitle, slug: newSlug || undefined }),
      });
      setPages((prev) => [...prev, data.page].sort((a, b) => a.slug.localeCompare(b.slug)));
      setShowCreate(false);
      setNewTitle('');
      setNewSlug('');
      setSuccess(`Created /${data.page.slug} — it stays off the storefront until you publish it.`);
    } catch (err: any) {
      setError(err?.message || 'Could not create the page');
    } finally {
      setCreating(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/admin/site-pages/${deleteTarget.slug}`, { method: 'DELETE' });
      setPages((prev) => prev.filter((p) => p.slug !== deleteTarget.slug));
      setSuccess('Page deleted');
      setDeleteTarget(null);
    } catch (err: any) {
      setError(err?.message || 'Could not delete the page');
    } finally {
      setDeleting(false);
    }
  };

  if (!canManageContent) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-line bg-white p-8 text-center">
          <AlertCircle className="mx-auto mb-3 h-6 w-6 text-ink-muted" />
          <p className="text-sm text-ink-muted">Your role can’t edit storefront pages.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-ink">
            <FileEdit className="h-6 w-6 text-teal-dark" />
            Pages
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Editable storefront pages. Each one has a block editor with a live preview, and its own
            published toggle.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ink/90"
        >
          <Plus className="h-4 w-4" />
          New page
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
          Loading pages…
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-white">
          <ul className="divide-y divide-line/60">
            {pages.map((page) => {
              const system = isSystemPage(page.slug);
              const url = system ? `/${page.slug}` : `/p/${page.slug}`;
              return (
                <li key={page.slug} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{page.title}</span>
                      {system && (
                        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                          built-in
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          page.published
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {page.published ? 'Published' : 'Draft'}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink-muted">
                      {url}
                      {page.blocks.length > 0 && ` · ${page.blocks.length} block${page.blocks.length === 1 ? '' : 's'}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {page.published && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface hover:text-ink"
                        title="View on the storefront"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                    <Link
                      href={`/admin/pages/${page.slug}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-surface"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Link>
                    {!system && (
                      <button
                        onClick={() => setDeleteTarget(page)}
                        className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-red-50 hover:text-red-600"
                        title="Delete page"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6">
            <h2 className="mb-4 text-lg font-bold text-ink">New page</h2>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-muted">Title</label>
                <input
                  value={newTitle}
                  onChange={(e) => {
                    setNewTitle(e.target.value);
                    // Keep the URL in step while it hasn't been touched.
                    if (!newSlug || newSlug === slugify(newTitle)) setNewSlug(slugify(e.target.value));
                  }}
                  autoFocus
                  placeholder="Shipping & Returns"
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-muted">URL</label>
                <div className="flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-2">
                  <span className="text-sm text-ink-muted">/p/</span>
                  <input
                    value={newSlug}
                    onChange={(e) => setNewSlug(slugify(e.target.value))}
                    placeholder="shipping-returns"
                    className="min-w-0 flex-1 bg-transparent text-sm text-ink focus:outline-none"
                  />
                </div>
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 rounded-lg bg-surface px-4 py-2.5 text-sm font-medium text-ink hover:bg-line/50"
              >
                Cancel
              </button>
              <button
                onClick={() => void create()}
                disabled={creating || !newTitle.trim()}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white hover:bg-ink/90 disabled:opacity-40"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6">
            <h2 className="mb-2 text-lg font-bold text-ink">Delete “{deleteTarget.title}”?</h2>
            <p className="mb-5 text-sm text-ink-muted">
              The page and its content are removed for good. To take it off the storefront without
              losing the copy, unpublish it instead.
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
