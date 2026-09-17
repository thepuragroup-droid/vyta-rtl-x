'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertCircle, ArrowLeft, Check, Clock, ExternalLink, Eye, Loader2, Save, Search, Star, X,
} from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { usePermissions } from '@/lib/hooks/usePermissions';
import BlockEditor from '@/components/admin/content/BlockEditor';
import ContentPreview from '@/components/admin/content/ContentPreview';
import ImageField from '@/components/admin/content/ImageField';
import { formatArticleDate, type Article } from '@/lib/content/articles';
import {
  excerptFromBlocks, readingMinutes, slugify, wordCount, type ContentBlock,
} from '@/lib/content/blocks';

/**
 * The article builder — block editor on the left, live preview on the right,
 * with the metadata that makes an article findable (URL, excerpt, cover, tags,
 * SEO title and description) in a column beneath the editor.
 *
 * The preview runs the storefront's own renderer over the working draft, so
 * "how will this look" is answered before publishing rather than after.
 *
 * Publishing is part of the save, not a separate switch: an article goes live
 * as one deliberate action, with the copy that is on screen.
 */
export default function ArticleBuilder() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = String(params?.id ?? '');
  const { canManageContent } = usePermissions();

  const [saved, setSaved] = useState<Article | null>(null);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [author, setAuthor] = useState('');
  const [category, setCategory] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [featured, setFeatured] = useState(false);
  const [publish, setPublish] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showPreviewOnMobile, setShowPreviewOnMobile] = useState(false);

  useEffect(() => {
    if (!id) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(''), 3500);
    return () => clearTimeout(timer);
  }, [success]);

  function apply(article: Article) {
    setSaved(article);
    setTitle(article.title);
    setSlug(article.slug);
    setExcerpt(article.excerpt ?? '');
    setCoverImageUrl(article.cover_image_url ?? '');
    setAuthor(article.author ?? '');
    setCategory(article.category ?? '');
    setTagsInput(article.tags.join(', '));
    setBlocks(article.blocks);
    setSeoTitle(article.seo_title ?? '');
    setSeoDescription(article.seo_description ?? '');
    setFeatured(article.featured);
    setPublish(article.status === 'published');
  }

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<{ article: Article }>(`/api/admin/articles/${id}`);
      apply(data.article);
      setError('');
    } catch (err: any) {
      setError(err?.message || 'Could not load this article');
    } finally {
      setLoading(false);
    }
  }

  const tags = useMemo(
    () => tagsInput.split(',').map((t) => t.trim()).filter(Boolean),
    [tagsInput],
  );

  const dirty = useMemo(() => {
    if (!saved) return false;
    return (
      title !== saved.title ||
      slug !== saved.slug ||
      excerpt !== (saved.excerpt ?? '') ||
      coverImageUrl !== (saved.cover_image_url ?? '') ||
      author !== (saved.author ?? '') ||
      category !== (saved.category ?? '') ||
      tags.join(',') !== saved.tags.join(',') ||
      seoTitle !== (saved.seo_title ?? '') ||
      seoDescription !== (saved.seo_description ?? '') ||
      featured !== saved.featured ||
      publish !== (saved.status === 'published') ||
      JSON.stringify(blocks) !== JSON.stringify(saved.blocks)
    );
  }, [
    saved, title, slug, excerpt, coverImageUrl, author, category, tags, seoTitle,
    seoDescription, featured, publish, blocks,
  ]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const save = async () => {
    if (!title.trim()) {
      setError('An article needs a title.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const data = await apiFetch<{ article: Article }>(`/api/admin/articles/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title,
          slug,
          excerpt,
          cover_image_url: coverImageUrl,
          author,
          category,
          tags,
          blocks,
          seo_title: seoTitle,
          seo_description: seoDescription,
          featured,
          status: publish ? 'published' : 'draft',
        }),
      });
      apply(data.article);
      setSuccess(
        data.article.status === 'published'
          ? 'Saved and live at /articles/' + data.article.slug
          : 'Saved as a draft',
      );
    } catch (err: any) {
      setError(err?.message || 'Could not save this article');
    } finally {
      setSaving(false);
    }
  };

  // What search engines will show, and what the card uses — derived when the
  // explicit fields are empty, exactly as the storefront derives them.
  const metaTitle = seoTitle.trim() || title;
  const effectiveExcerpt = excerpt.trim() || excerptFromBlocks(blocks, 180);
  const metaDescription = seoDescription.trim() || effectiveExcerpt;
  const minutes = readingMinutes(blocks);

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

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center gap-3 rounded-xl border border-line bg-white p-12 text-sm text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading article…
        </div>
      </div>
    );
  }

  const field =
    'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40';
  const label = 'block text-xs font-medium text-ink-muted mb-1';

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => router.push('/admin/articles')}
          className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Articles
        </button>
        <span className="text-ink-muted">/</span>
        <h1 className="min-w-0 truncate text-lg font-bold text-ink">{title || 'Untitled'}</h1>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            saved?.status === 'published'
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-amber-100 text-amber-700'
          }`}
        >
          {saved?.status === 'published' ? 'Published' : 'Draft'}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowPreviewOnMobile((s) => !s)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink hover:bg-surface xl:hidden"
          >
            <Eye className="h-4 w-4" />
            {showPreviewOnMobile ? 'Edit' : 'Preview'}
          </button>
          {saved?.status === 'published' && (
            <a
              href={`/articles/${saved.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink hover:bg-surface"
            >
              <ExternalLink className="h-4 w-4" />
              View
            </a>
          )}
          <button
            onClick={() => setFeatured((f) => !f)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
              featured
                ? 'border-amber-300 bg-amber-50 text-amber-700'
                : 'border-line bg-white text-ink-muted hover:text-ink'
            }`}
            title="Feature at the top of the article index"
          >
            <Star className={`h-4 w-4 ${featured ? 'fill-amber-400 text-amber-500' : ''}`} />
            Featured
          </button>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={publish}
              onChange={(e) => setPublish(e.target.checked)}
              className="h-4 w-4 rounded border-line accent-teal"
            />
            <span className="text-ink">Show on storefront</span>
          </label>
          <button
            onClick={() => void save()}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {dirty ? 'Save' : 'Saved'}
          </button>
        </div>
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

      <div className="grid gap-5 xl:grid-cols-2">
        {/* ---- Editor ---- */}
        <div className={`${showPreviewOnMobile ? 'hidden xl:block' : ''} space-y-5`}>
          <div className="space-y-3 rounded-xl border border-line bg-white p-4">
            <div>
              <label className={label}>Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
            </div>

            <div>
              <label className={label}>URL</label>
              <div className="flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-2">
                <span className="text-sm text-ink-muted">/articles/</span>
                <input
                  value={slug}
                  onChange={(e) => setSlug(slugify(e.target.value))}
                  className="min-w-0 flex-1 bg-transparent text-sm text-ink focus:outline-none"
                />
              </div>
              {saved?.status === 'published' && slug !== saved.slug && (
                <p className="mt-1 text-[11px] text-amber-600">
                  This article is live — changing the URL will break existing links to it.
                </p>
              )}
            </div>

            <div>
              <label className={label}>
                Excerpt{' '}
                <span className="font-normal">— the blurb on cards and in search results</span>
              </label>
              <textarea
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                rows={2}
                placeholder={excerptFromBlocks(blocks, 180) || 'Leave empty to use the opening copy'}
                className={field}
              />
            </div>

            <ImageField
              value={coverImageUrl}
              onChange={setCoverImageUrl}
              label="Cover image — the card and social preview"
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label}>Author</label>
                <input
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  className={field}
                  placeholder="VYTA Biosciences"
                />
              </div>
              <div>
                <label className={label}>Category</label>
                <input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className={field}
                  placeholder="Research"
                />
              </div>
            </div>

            <div>
              <label className={label}>Tags — comma separated, they become filter chips</label>
              <input
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                className={field}
                placeholder="peptides, storage, handling"
              />
              {tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-dark"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() =>
                          setTagsInput(tags.filter((t) => t !== tag).join(', '))
                        }
                        className="opacity-60 hover:opacity-100"
                        aria-label={`Remove ${tag}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-ink">Content</h2>
              <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
                {blocks.length} block{blocks.length === 1 ? '' : 's'} · {wordCount(blocks)} words ·
                <Clock className="h-3 w-3" />
                {minutes} min read
              </span>
            </div>
            <BlockEditor blocks={blocks} onChange={setBlocks} />
          </div>

          {/* SEO */}
          <div className="rounded-xl border border-line bg-white p-4">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
              <Search className="h-4 w-4 text-teal-dark" />
              Search engines
            </h2>
            <p className="mb-3 text-xs text-ink-muted">
              Leave these empty and the title and excerpt are used. This page also publishes
              structured data (an <code>Article</code> record) built from these same fields.
            </p>
            <div className="space-y-3">
              <div>
                <label className={label}>
                  SEO title{' '}
                  <span className={metaTitle.length > 60 ? 'text-amber-600' : ''}>
                    ({metaTitle.length}/60)
                  </span>
                </label>
                <input
                  value={seoTitle}
                  onChange={(e) => setSeoTitle(e.target.value)}
                  className={field}
                  placeholder={title}
                />
              </div>
              <div>
                <label className={label}>
                  Meta description{' '}
                  <span className={metaDescription.length > 160 ? 'text-amber-600' : ''}>
                    ({metaDescription.length}/160)
                  </span>
                </label>
                <textarea
                  value={seoDescription}
                  onChange={(e) => setSeoDescription(e.target.value)}
                  rows={2}
                  className={field}
                  placeholder={effectiveExcerpt}
                />
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-line bg-surface p-3">
              <p className="truncate text-[13px] text-[#1a0dab]">{metaTitle}</p>
              <p className="truncate text-[11px] text-emerald-700">vyta.com/articles/{slug}</p>
              <p className="mt-0.5 line-clamp-2 text-[11px] text-ink-muted">
                {metaDescription || 'Write some copy and this fills in.'}
              </p>
            </div>

            {saved?.published_at && (
              <p className="mt-3 text-[11px] text-ink-muted">
                First published {formatArticleDate(saved.published_at)} — editing keeps that date,
                so a fix doesn’t push the article back to the top of the index.
              </p>
            )}
          </div>
        </div>

        {/* ---- Preview ---- */}
        <div className={`${showPreviewOnMobile ? '' : 'hidden xl:block'} xl:sticky xl:top-6 xl:h-[calc(100vh-7rem)]`}>
          <ContentPreview
            title={title}
            subtitle={effectiveExcerpt}
            heroImageUrl={coverImageUrl}
            blocks={blocks}
            eyebrow={
              <span className="flex flex-wrap items-center gap-2">
                {category && <span>{category}</span>}
                <span className="inline-flex items-center gap-1 normal-case tracking-normal text-ink-muted">
                  <Clock className="h-3 w-3" />
                  {minutes} min read
                </span>
              </span>
            }
            emptyHint="Add a block on the left and it appears here."
          />
        </div>
      </div>
    </div>
  );
}
