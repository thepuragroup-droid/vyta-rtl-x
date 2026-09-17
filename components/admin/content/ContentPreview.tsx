'use client';

import React, { useState } from 'react';
import { Monitor, Smartphone } from 'lucide-react';
import BlockRenderer from '@/components/content/BlockRenderer';
import type { ContentBlock } from '@/lib/content/blocks';

/**
 * The preview pane beside the block editor.
 *
 * It renders the draft through `BlockRenderer` — the SAME component the
 * storefront uses — inside the same type scale and measure the public page
 * gets. So this is not a mock-up of the result; it is the result, a save away.
 *
 * The phone/desktop switch just narrows the container, which is enough to
 * catch the two things that actually go wrong: a heading that wraps badly and
 * an image that eats the whole screen.
 */

interface ContentPreviewProps {
  title: string;
  subtitle?: string;
  heroImageUrl?: string;
  blocks: ContentBlock[];
  /** Small line above the title — a category, date or reading time. */
  eyebrow?: React.ReactNode;
  /** Shown instead of the body when the document is empty. */
  emptyHint?: string;
}

export default function ContentPreview({
  title, subtitle, heroImageUrl, blocks, eyebrow, emptyHint,
}: ContentPreviewProps) {
  const [width, setWidth] = useState<'desktop' | 'phone'>('desktop');

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-white">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Preview
        </span>
        <span className="text-[11px] text-ink-muted">· exactly how it will publish</span>
        <div className="ml-auto inline-flex rounded-lg border border-line bg-white p-0.5">
          {([
            ['desktop', Monitor, 'Desktop width'],
            ['phone', Smartphone, 'Phone width'],
          ] as const).map(([key, Icon, title]) => (
            <button
              key={key}
              type="button"
              onClick={() => setWidth(key)}
              title={title}
              aria-pressed={width === key}
              className={`rounded-md px-2 py-1 transition-colors ${
                width === key ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-white">
        <div
          className={`mx-auto px-5 py-8 transition-[max-width] sm:px-8 ${
            width === 'phone' ? 'max-w-[390px]' : 'max-w-2xl'
          }`}
        >
          {heroImageUrl && (
            <div className="mb-7 overflow-hidden rounded-xl border border-line bg-surface">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={heroImageUrl} alt="" className="block h-auto w-full" />
            </div>
          )}

          {eyebrow && (
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-teal-dark">
              {eyebrow}
            </div>
          )}

          <h1 className="font-display text-3xl font-bold leading-tight text-ink sm:text-4xl">
            {title || 'Untitled'}
          </h1>

          {subtitle && (
            <p className="mt-3 text-lg leading-relaxed text-ink-muted">{subtitle}</p>
          )}

          <div className="mt-6 h-px bg-brand-rule opacity-40" />

          {blocks.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-muted">
              {emptyHint ?? 'Add a block to see it here.'}
            </p>
          ) : (
            <BlockRenderer blocks={blocks} className="mt-2" />
          )}
        </div>
      </div>
    </div>
  );
}
