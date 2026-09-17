'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertCircle, ArrowLeft, Check, ExternalLink, Eye, Loader2, Save, Search,
} from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { usePermissions } from '@/lib/hooks/usePermissions';
import BlockEditor from '@/components/admin/content/BlockEditor';
import ContentPreview from '@/components/admin/content/ContentPreview';
import ImageField from '@/components/admin/content/ImageField';
import { isSystemPage, type SitePage } from '@/lib/content/pages';
import { excerptFromBlocks, wordCount, type ContentBlock } from '@/lib/content/blocks';

/**
 * The page editor — block editor on the left, live preview on the right.
 *
 * The preview renders the working draft through the storefront's own
 * `BlockRenderer`, so there is no "publish and see what happens" step: what is
 * on the right is what visitors get when Publish is on and Save is pressed.
 *
 * `published` is the storefront toggle. It is part of the form (not an instant
 * switch) so unpublishing and editing are one deliberate save, rather than a
 * half-edited page briefly going live.
 */
export default function SitePageEditor() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = String(params?.slug ?? '');
  const { canManageContent } = usePermissions();

  const [saved, setSaved] = useState<SitePage | null>(null);
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [heroImageUrl, setHeroImageUrl] = useState('');
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [published, setPublished] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showPreviewOnMobile, setShowPreviewOnMobile] = useState(false);

  useEffect(() => {
    if (!slug) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(''), 3500);
    return () => clearTimeout(timer);
  }, [success]);

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<{ page: SitePage }>(`/api/admin/site-pages/${slug}`);
      const page = data.page;
      setSaved(page);
      setTitle(page.title);
      setSubtitle(page.subtitle ?? '');
      setHeroImageUrl(page.hero_image_url ?? '');
      setBlocks(page.blocks);
      setSeoTitle(page.seo_title ?? '');
      setSeoDescription(page.seo_description ?? '');
      setPublished(page.published);
      setError('');
    } catch (err: any) {
      setError(err?.message || 'Could not load this page');
    } finally {
      setLoading(false);
    }
  }

  const dirty = useMemo(() => {
    if (!saved) return false;
    return (
      title !== saved.title ||
      subtitle !== (saved.subtitle ?? '') ||
      heroImageUrl !== (saved.hero_image_url ?? '') ||
      seoTitle !== (saved.seo_title ?? '') ||
      seoDescription !== (saved.seo_description ?? '') ||
      published !== saved.published ||
      JSON.stringify(blocks) !== JSON.stringify(saved.blocks)
    );
  }, [saved, title, subtitle, heroImageUrl, seoTitle, seoDescription, published, blocks]);

  // Guard a reload/close with unsaved copy in the editor.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const save = async () => {
    if (!title.trim()) {
      setError('A page needs a title.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const data = await apiFetch<{ page: SitePage }>(`/api/admin/site-pages/${slug}`, {
        method: 'PUT',
        body: JSON.stringify({
          title,
          subtitle,
          hero_image_url: heroImageUrl,
          blocks,
          seo_title: seoTitle,
          seo_description: seoDescription,
          published,
        }),
      });
      const page = data.page;
      setSaved(page);
      setBlocks(page.blocks);
      setSuccess(page.published ? 'Saved and live on the storefront' : 'Saved as a draft');
    } catch (err: any) {
      setError(err?.message || 'Could not save this page');
    } finally {
      setSaving(false);
    }
  };

  const publicUrl = isSystemPage(slug) ? `/${slug}` : `/p/${slug}`;
  // What Google will show: the explicit SEO fields, else the page's own copy.
  const metaTitle = seoTitle.trim() || title;
  const metaDescription = seoDescription.trim() || subtitle.trim() || excerptFromBlocks(blocks, 160);

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

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center gap-3 rounded-xl border border-line bg-white p-12 text-sm text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading page…
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
          onClick={() => router.push('/admin/pages')}
          className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Pages
        </button>
        <span className="text-ink-muted">/</span>
        <h1 className="min-w-0 truncate text-lg font-bold text-ink">{title || slug}</h1>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-muted">
          {publicUrl}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowPreviewOnMobile((s) => !s)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink hover:bg-surface xl:hidden"
          >
            <Eye className="h-4 w-4" />
            {showPreviewOnMobile ? 'Edit' : 'Preview'}
          </button>
          {saved?.published && (
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink hover:bg-surface"
            >
              <ExternalLink className="h-4 w-4" />
              View
            </a>
          )}
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={published}
              onChange={(e) => setPublished(e.target.checked)}
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
              <label className={label}>Subtitle (optional)</label>
              <input
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                className={field}
                placeholder="One line under the title"
              />
            </div>
            <ImageField
              value={heroImageUrl}
              onChange={setHeroImageUrl}
              label="Hero image (optional)"
            />
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-sm font-semibold text-ink">Content</h2>
              <span className="text-xs text-ink-muted">
                {blocks.length} block{blocks.length === 1 ? '' : 's'} · {wordCount(blocks)} words
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
              Leave these empty and the page title and opening copy are used.
            </p>
            <div className="space-y-3">
              <div>
                <label className={label}>SEO title</label>
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
                  placeholder={metaDescription}
                />
              </div>
            </div>

            {/* Search-result preview: the other thing this page publishes. */}
            <div className="mt-4 rounded-lg border border-line bg-surface p-3">
              <p className="truncate text-[13px] text-[#1a0dab]">{metaTitle}</p>
              <p className="truncate text-[11px] text-emerald-700">
                vyta.com{publicUrl}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[11px] text-ink-muted">
                {metaDescription || 'Add some copy and this fills in.'}
              </p>
            </div>
          </div>

          <p className="text-xs text-ink-muted">
            Need a different page?{' '}
            <Link href="/admin/pages" className="text-teal-dark underline underline-offset-2">
              Back to all pages
            </Link>
          </p>
        </div>

        {/* ---- Preview ---- */}
        <div className={`${showPreviewOnMobile ? '' : 'hidden xl:block'} xl:sticky xl:top-6 xl:h-[calc(100vh-7rem)]`}>
          <ContentPreview
            title={title}
            subtitle={subtitle}
            heroImageUrl={heroImageUrl}
            blocks={blocks}
            emptyHint="Add a block on the left and it appears here."
          />
        </div>
      </div>
    </div>
  );
}
