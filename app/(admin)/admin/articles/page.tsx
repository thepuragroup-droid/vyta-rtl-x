'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle, Check, Clock, ExternalLink, Loader2, Newspaper, Pencil, Plus, Search, Star,
  Trash2,
} from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { formatArticleDate, type ArticleSummary } from '@/lib/content/articles';

/**
 * The article library.
 *
 * Rows carry the two things an editor scans for — whether it is live and when
 * it went live — plus the status toggle itself, so publishing or pulling a post
 * never means opening it first. Writing happens in the builder
 * (/admin/articles/[id]).
 */

type StatusFilter = 'all' | 'published' | 'draft';

export default function ArticlesListPage() {
  const router = useRouter();
  const { canManageContent } = usePermissions();

  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ArticleSummary | null>(null);
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
      const data = await apiFetch<{ articles: ArticleSummary[] }>('/api/admin/articles');
      setArticles(data.articles ?? []);
      setError('');
    } catch (err: any) {
      setError(err?.message || 'Could not load articles');
    } finally {
      setLoading(false);
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return articles.filter((a) => {
      if (status !== 'all' && a.status !== status) return false;
      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        a.slug.toLowerCase().includes(q) ||
        (a.category ?? '').toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [articles, query, status]);

  const publishedCount = articles.filter((a) => a.status === 'published').length;

  const create = async () => {
    setCreating(true);
    setError('');
    try {
      const data = await apiFetch<{ article: ArticleSummary }>('/api/admin/articles', {
        method: 'POST',
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      // Straight into the builder — creating an article is never the goal.
      router.push(`/admin/articles/${data.article.id}`);
    } catch (err: any) {
      setError(err?.message || 'Could not create the article');
      setCreating(false);
    }
  };

  const patch = async (article: ArticleSummary, body: Record<string, unknown>) => {
    setBusyId(article.id);
    setError('');
    try {
      const data = await apiFetch<{ article: ArticleSummary }>(
        `/api/admin/articles/${article.id}`,
        { method: 'PATCH', body: JSON.stringify(body) },
      );
      setArticles((prev) => prev.map((a) => (a.id === article.id ? { ...a, ...data.article } : a)));
      if ('status' in body) {
        setSuccess(body.status === 'published' ? 'Article published' : 'Article moved to drafts');
      }
    } catch (err: any) {
      setError(err?.message || 'Could not update the article');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/admin/articles/${deleteTarget.id}`, { method: 'DELETE' });
      setArticles((prev) => prev.filter((a) => a.id !== deleteTarget.id));
      setSuccess('Article deleted');
      setDeleteTarget(null);
    } catch (err: any) {
      setError(err?.message || 'Could not delete the article');
    } finally {
      setDeleting(false);
    }
  };

  if (!canManageContent) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-line bg-white p-8 text-center">
          <AlertCircle className="mx-auto mb-3 h-6 w-6 text-ink-muted" />
          <p className="text-sm text-ink-muted">Your role can’t manage articles.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-ink">
            <Newspaper className="h-6 w-6 text-teal-dark" />
            Articles
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {articles.length} article{articles.length === 1 ? '' : 's'} · {publishedCount} live at{' '}
            <Link href="/articles" target="_blank" className="text-teal-dark underline underline-offset-2">
              /articles
            </Link>
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ink/90"
        >
          <Plus className="h-4 w-4" />
          New article
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

      {/* Filters */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title, URL, category or tag…"
            className="w-full rounded-xl border border-line bg-surface py-3 pl-11 pr-4 text-sm text-ink placeholder-ink-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-teal/40"
          />
        </div>
        <div className="inline-flex rounded-xl border border-line bg-surface p-1">
          {(['all', 'published', 'draft'] as StatusFilter[]).map((key) => (
            <button
              key={key}
              onClick={() => setStatus(key)}
              className={`rounded-lg px-4 py-2 text-sm font-medium capitalize transition-colors ${
                status === key ? 'bg-ink text-white shadow-sm' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-3 rounded-xl border border-line bg-white p-12 text-sm text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading articles…
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-white p-12 text-center">
          <Newspaper className="mx-auto mb-3 h-7 w-7 text-ink-muted" />
          <p className="text-sm font-medium text-ink">
            {articles.length === 0 ? 'No articles yet' : 'Nothing matches those filters'}
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
            {articles.length === 0
              ? 'Articles are the main way this site earns search traffic. Write one about a compound, a handling question, or how a batch is tested.'
              : 'Try a different search or switch the status filter.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-white">
          <ul className="divide-y divide-line/60">
            {visible.map((article) => (
              <li key={article.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                {article.cover_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={article.cover_image_url}
                    alt=""
                    className="h-12 w-16 flex-shrink-0 rounded-lg border border-line object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-16 flex-shrink-0 items-center justify-center rounded-lg border border-line bg-surface">
                    <Newspaper className="h-4 w-4 text-ink-muted" />
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/articles/${article.id}`}
                      className="truncate text-sm font-medium text-ink hover:text-teal-dark"
                    >
                      {article.title}
                    </Link>
                    {article.featured && (
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" aria-label="Featured" />
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        article.status === 'published'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {article.status === 'published' ? 'Published' : 'Draft'}
                    </span>
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 truncate text-xs text-ink-muted">
                    <span>/articles/{article.slug}</span>
                    {article.category && <span>· {article.category}</span>}
                    {article.published_at && <span>· {formatArticleDate(article.published_at)}</span>}
                    <span className="inline-flex items-center gap-1">
                      · <Clock className="h-3 w-3" />
                      {article.reading_minutes} min
                    </span>
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => void patch(article, { featured: !article.featured })}
                    disabled={busyId === article.id}
                    className={`rounded-lg p-2 transition-colors disabled:opacity-40 ${
                      article.featured
                        ? 'text-amber-500 hover:bg-amber-50'
                        : 'text-ink-muted hover:bg-surface hover:text-ink'
                    }`}
                    title={article.featured ? 'Remove from the top of the index' : 'Feature at the top of the index'}
                  >
                    <Star className={`h-4 w-4 ${article.featured ? 'fill-amber-400' : ''}`} />
                  </button>
                  {article.status === 'published' && (
                    <a
                      href={`/articles/${article.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface hover:text-ink"
                      title="View on the storefront"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                  <button
                    onClick={() =>
                      void patch(article, {
                        status: article.status === 'published' ? 'draft' : 'published',
                      })
                    }
                    disabled={busyId === article.id}
                    className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-medium text-ink hover:bg-surface disabled:opacity-40"
                  >
                    {busyId === article.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : article.status === 'published' ? (
                      'Unpublish'
                    ) : (
                      'Publish'
                    )}
                  </button>
                  <Link
                    href={`/admin/articles/${article.id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-surface"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Link>
                  <button
                    onClick={() => setDeleteTarget(article)}
                    className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-red-50 hover:text-red-600"
                    title="Delete article"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6">
            <h2 className="mb-1 text-lg font-bold text-ink">New article</h2>
            <p className="mb-4 text-sm text-ink-muted">
              Start with a working title — you can change it and the URL any time before publishing.
            </p>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newTitle.trim()) void create();
              }}
              autoFocus
              placeholder="How we test every batch"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
            />
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
                Start writing
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
              The article and everything in it are removed for good, and{' '}
              <span className="font-medium text-ink">/articles/{deleteTarget.slug}</span> will 404
              for anyone who has linked to it. To take it down without losing the copy, unpublish
              it instead.
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
