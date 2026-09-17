'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowRight, Info, CheckCircle2, AlertTriangle, Lightbulb } from 'lucide-react';
import RichText, { renderInline } from '@/components/content/RichText';
import { safeUrl, videoEmbedUrl, type CalloutTone, type ContentBlock } from '@/lib/content/blocks';

/**
 * The single renderer for a content-block document. Used by the storefront
 * (/about, /articles/[slug]) AND by the admin editor's preview pane — the
 * preview is the real thing, not an approximation of it.
 *
 * Layout notes: the article column is a readable ~68ch measure. `full` and
 * `wide` images break out of it with negative margins so a document can
 * breathe without the caller needing a second container.
 */

const CALLOUT_STYLES: Record<CalloutTone, { wrap: string; icon: React.ElementType; iconClass: string }> = {
  info:    { wrap: 'bg-teal-50 border-teal-200',       icon: Info,          iconClass: 'text-teal-dark' },
  success: { wrap: 'bg-emerald-50 border-emerald-200', icon: CheckCircle2,  iconClass: 'text-emerald-600' },
  warning: { wrap: 'bg-amber-50 border-amber-200',     icon: AlertTriangle, iconClass: 'text-amber-600' },
  tip:     { wrap: 'bg-violet-50 border-violet-200',   icon: Lightbulb,     iconClass: 'text-violet-600' },
};

const IMAGE_WIDTH_CLASS: Record<string, string> = {
  // Negative margins let an image escape the text measure on wide viewports
  // while staying flush inside the column on a phone.
  full: 'lg:-mx-24 xl:-mx-32',
  wide: 'lg:-mx-10',
  inline: 'max-w-md mx-auto',
};

function BlockImage({ url, alt, className }: { url: string; alt: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- storefront images
    // come straight from Supabase Storage; see components/FadeInImage.tsx.
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className={className}
    />
  );
}

function CtaButton({ label, url }: { label: string; url: string }) {
  const href = safeUrl(url);
  const className =
    'inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-ink text-white text-sm font-semibold hover:bg-ink/90 transition-colors';
  const content = (
    <>
      {label}
      <ArrowRight className="w-4 h-4" />
    </>
  );
  if (!href) return <span className={`${className} opacity-50`}>{content}</span>;
  if (href.startsWith('/') || href.startsWith('#')) {
    return <Link href={href} className={className}>{content}</Link>;
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {content}
    </a>
  );
}

export function BlockView({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'heading': {
      if (block.level === 3) {
        return (
          <h3 className="font-display text-lg sm:text-xl font-semibold text-ink mt-8 mb-3">
            {renderInline(block.text)}
          </h3>
        );
      }
      return (
        <h2 className="font-display text-2xl sm:text-3xl font-bold text-ink mt-12 mb-4 scroll-mt-32">
          {renderInline(block.text)}
        </h2>
      );
    }

    case 'paragraph':
      return (
        <RichText
          text={block.text}
          className="my-5"
          paragraphClassName={
            block.lead
              ? 'text-lg sm:text-xl text-ink-muted leading-relaxed'
              : 'text-[15px] sm:text-base text-ink/90 leading-[1.75]'
          }
        />
      );

    case 'image': {
      if (!block.url) return null;
      return (
        <figure className={`my-8 ${IMAGE_WIDTH_CLASS[block.width] ?? ''}`}>
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            <BlockImage url={block.url} alt={block.alt} className="w-full h-auto block" />
          </div>
          {block.caption.trim() && (
            <figcaption className="mt-2.5 text-xs text-ink-muted text-center">
              {renderInline(block.caption)}
            </figcaption>
          )}
        </figure>
      );
    }

    case 'gallery': {
      const images = block.images.filter((img) => img.url);
      if (images.length === 0) return null;
      return (
        <div className={`my-8 grid gap-4 ${block.columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
          {images.map((img, i) => (
            <figure key={i}>
              <div className="aspect-[4/3] overflow-hidden rounded-xl border border-line bg-surface">
                <BlockImage url={img.url} alt={img.alt} className="w-full h-full object-cover" />
              </div>
              {img.caption.trim() && (
                <figcaption className="mt-2 text-xs text-ink-muted">{renderInline(img.caption)}</figcaption>
              )}
            </figure>
          ))}
        </div>
      );
    }

    case 'quote':
      return (
        <figure className="my-9 border-l-[3px] border-teal pl-5 sm:pl-6">
          <blockquote className="font-display text-xl sm:text-2xl leading-snug text-ink">
            {renderInline(block.text)}
          </blockquote>
          {block.attribution.trim() && (
            <figcaption className="mt-3 text-sm text-ink-muted">— {renderInline(block.attribution)}</figcaption>
          )}
        </figure>
      );

    case 'list': {
      const items = block.items.filter((item) => item.trim().length > 0);
      if (items.length === 0) return null;
      const Tag = block.style === 'number' ? 'ol' : 'ul';
      return (
        <Tag
          className={`my-6 space-y-2.5 text-[15px] sm:text-base text-ink/90 leading-relaxed ${
            block.style === 'number' ? 'list-decimal' : 'list-disc'
          } pl-5 marker:text-teal`}
        >
          {items.map((item, i) => (
            <li key={i} className="pl-1">{renderInline(item)}</li>
          ))}
        </Tag>
      );
    }

    case 'callout': {
      const style = CALLOUT_STYLES[block.tone];
      const Icon = style.icon;
      return (
        <aside className={`my-8 flex gap-3.5 rounded-xl border p-4 sm:p-5 ${style.wrap}`}>
          <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${style.iconClass}`} />
          <div className="min-w-0">
            {block.title.trim() && (
              <p className="font-semibold text-ink text-sm mb-1">{renderInline(block.title)}</p>
            )}
            {block.text.trim() && (
              <RichText text={block.text} paragraphClassName="text-sm text-ink/80 leading-relaxed" />
            )}
          </div>
        </aside>
      );
    }

    case 'cta':
      return (
        <div className="my-10 rounded-2xl border border-line bg-surface p-6 sm:p-8 text-center">
          {block.text.trim() && (
            <RichText
              text={block.text}
              className="mb-5"
              paragraphClassName="text-base sm:text-lg text-ink leading-relaxed"
            />
          )}
          {block.button_label.trim() && (
            <CtaButton label={block.button_label} url={block.button_url} />
          )}
        </div>
      );

    case 'stats': {
      const items = block.items.filter((s) => s.value.trim().length > 0);
      if (items.length === 0) return null;
      return (
        <div
          className={`my-9 grid gap-4 ${
            items.length >= 4 ? 'grid-cols-2 lg:grid-cols-4' : items.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'
          }`}
        >
          {items.map((stat, i) => (
            <div key={i} className="rounded-xl border border-line bg-white p-5 text-center">
              <div className="font-display text-3xl font-bold text-ink tabular-nums">{stat.value}</div>
              <div className="mt-1 text-xs uppercase tracking-wider text-ink-muted">{stat.label}</div>
            </div>
          ))}
        </div>
      );
    }

    case 'video': {
      const embed = videoEmbedUrl(block.url);
      if (!embed) {
        return (
          <div className="my-8 rounded-xl border border-dashed border-line bg-surface p-5 text-sm text-ink-muted text-center">
            Video URL isn’t a recognised YouTube or Vimeo link.
          </div>
        );
      }
      return (
        <figure className="my-8 lg:-mx-10">
          <div className="aspect-video overflow-hidden rounded-xl border border-line bg-navy">
            <iframe
              src={embed}
              title={block.caption || 'Embedded video'}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
          {block.caption.trim() && (
            <figcaption className="mt-2.5 text-xs text-ink-muted text-center">
              {renderInline(block.caption)}
            </figcaption>
          )}
        </figure>
      );
    }

    case 'divider':
      return <hr className="my-10 border-0 h-px bg-brand-rule opacity-40" />;
  }
}

export default function BlockRenderer({
  blocks,
  className = '',
}: {
  blocks: ContentBlock[];
  className?: string;
}) {
  if (blocks.length === 0) return null;
  return (
    <div className={className}>
      {blocks.map((block) => (
        <BlockView key={block.id} block={block} />
      ))}
    </div>
  );
}
