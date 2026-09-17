'use client';

import React, { useState } from 'react';
import {
  BarChart3, ChevronDown, ChevronUp, Copy, GripVertical, Heading2, Image as ImageIcon,
  Images, Info, List, Minus, MousePointerClick, Plus, Quote, Trash2, Type, Video,
} from 'lucide-react';
import ImageField from '@/components/admin/content/ImageField';
import {
  BLOCK_LIBRARY,
  createBlock,
  newBlockId,
  type BlockType,
  type CalloutTone,
  type ContentBlock,
} from '@/lib/content/blocks';

/**
 * The block editor behind both the page editor (About Us) and the article
 * builder.
 *
 * It edits the SAME array the storefront renders, so the preview pane beside it
 * is not a simulation — it is `BlockRenderer` on the live value. Blocks are
 * added from a palette, reordered with the arrows (or dragged by the handle),
 * duplicated, and deleted; each type shows only the fields it actually has.
 *
 * Text fields accept the small inline syntax documented in
 * lib/content/blocks.ts — **bold**, *italic*, `code` and [label](url) — which
 * is parsed into React nodes, never HTML.
 */

const ICONS: Record<string, React.ElementType> = {
  Heading2, Type, Image: ImageIcon, Images, List, Quote, Info, BarChart3,
  MousePointerClick, Video, Minus,
};

interface BlockEditorProps {
  blocks: ContentBlock[];
  onChange: (blocks: ContentBlock[]) => void;
}

const inputClass =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40';
const labelClass = 'block text-xs font-medium text-ink-muted mb-1';

export default function BlockEditor({ blocks, onChange }: BlockEditorProps) {
  const [openPalette, setOpenPalette] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const update = (index: number, next: ContentBlock) =>
    onChange(blocks.map((b, i) => (i === index ? next : b)));

  const insertAt = (index: number, type: BlockType) => {
    const next = [...blocks];
    next.splice(index, 0, createBlock(type));
    onChange(next);
    setOpenPalette(null);
  };

  const remove = (index: number) => onChange(blocks.filter((_, i) => i !== index));

  const duplicate = (index: number) => {
    const next = [...blocks];
    // A duplicate needs its own id or React keys collide and the two blocks
    // edit as one.
    next.splice(index + 1, 0, { ...blocks[index], id: newBlockId() });
    onChange(next);
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= blocks.length || from === to) return;
    const next = [...blocks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {blocks.length === 0 && (
        <div className="rounded-xl border border-dashed border-line bg-surface p-8 text-center">
          <p className="text-sm font-medium text-ink">This page is empty</p>
          <p className="mt-1 text-xs text-ink-muted">Add your first block below.</p>
        </div>
      )}

      {blocks.map((block, index) => (
        <React.Fragment key={block.id}>
          {openPalette === index && (
            <Palette onPick={(type) => insertAt(index, type)} onClose={() => setOpenPalette(null)} />
          )}

          <div
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null) move(dragIndex, index);
              setDragIndex(null);
            }}
            onDragEnd={() => setDragIndex(null)}
            className={`rounded-xl border bg-white transition-colors ${
              dragIndex === index ? 'border-teal opacity-60' : 'border-line'
            }`}
          >
            {/* Block chrome */}
            <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2">
              <GripVertical className="h-4 w-4 cursor-grab text-ink-muted" />
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                {BLOCK_LIBRARY.find((b) => b.type === block.type)?.label ?? block.type}
              </span>
              <div className="ml-auto flex items-center gap-0.5">
                <IconButton title="Move up" onClick={() => move(index, index - 1)} disabled={index === 0}>
                  <ChevronUp className="h-4 w-4" />
                </IconButton>
                <IconButton
                  title="Move down"
                  onClick={() => move(index, index + 1)}
                  disabled={index === blocks.length - 1}
                >
                  <ChevronDown className="h-4 w-4" />
                </IconButton>
                <IconButton title="Duplicate" onClick={() => duplicate(index)}>
                  <Copy className="h-4 w-4" />
                </IconButton>
                <IconButton title="Delete block" onClick={() => remove(index)} danger>
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </div>
            </div>

            <div className="p-3">
              <BlockFields block={block} onChange={(next) => update(index, next)} />
            </div>
          </div>

          {/* Insert between blocks */}
          <AddRow
            onClick={() => setOpenPalette(openPalette === index + 1 ? null : index + 1)}
            open={openPalette === index + 1}
          />
        </React.Fragment>
      ))}

      {blocks.length === 0 && (
        <AddRow onClick={() => setOpenPalette(openPalette === 0 ? null : 0)} open={openPalette === 0} />
      )}

      {openPalette === blocks.length && blocks.length > 0 && (
        <Palette onPick={(type) => insertAt(blocks.length, type)} onClose={() => setOpenPalette(null)} />
      )}
      {openPalette === 0 && blocks.length === 0 && (
        <Palette onPick={(type) => insertAt(0, type)} onClose={() => setOpenPalette(null)} />
      )}
    </div>
  );
}

function IconButton({
  children, onClick, title, disabled, danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
        danger ? 'text-ink-muted hover:bg-red-50 hover:text-red-600' : 'text-ink-muted hover:bg-white hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function AddRow({ onClick, open }: { onClick: () => void; open: boolean }) {
  return (
    <div className="group flex items-center gap-2 py-0.5">
      <span className="h-px flex-1 bg-line transition-colors group-hover:bg-teal/40" />
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
          open
            ? 'border-teal bg-teal/10 text-teal-dark'
            : 'border-line bg-white text-ink-muted hover:border-teal/40 hover:text-ink'
        }`}
      >
        <Plus className="h-3 w-3" />
        Add block
      </button>
      <span className="h-px flex-1 bg-line transition-colors group-hover:bg-teal/40" />
    </div>
  );
}

function Palette({ onPick, onClose }: { onPick: (type: BlockType) => void; onClose: () => void }) {
  return (
    <div className="rounded-xl border border-teal/40 bg-teal-50/60 p-3">
      <div className="mb-2 flex items-center">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
          Add a block
        </p>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-[11px] text-ink-muted hover:text-ink"
        >
          Cancel
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {BLOCK_LIBRARY.map((entry) => {
          const Icon = ICONS[entry.icon] ?? Type;
          return (
            <button
              key={entry.type}
              type="button"
              onClick={() => onPick(entry.type)}
              className="flex items-start gap-2 rounded-lg border border-line bg-white p-2.5 text-left transition-colors hover:border-teal hover:bg-teal/5"
            >
              <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-teal-dark" />
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-ink">{entry.label}</span>
                <span className="block text-[10px] leading-tight text-ink-muted">{entry.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-type fields
// ---------------------------------------------------------------------------

function BlockFields({
  block, onChange,
}: {
  block: ContentBlock;
  onChange: (next: ContentBlock) => void;
}) {
  switch (block.type) {
    case 'heading':
      return (
        <div className="flex gap-2">
          <select
            value={block.level}
            onChange={(e) => onChange({ ...block, level: Number(e.target.value) === 3 ? 3 : 2 })}
            className="w-28 rounded-lg border border-line bg-surface px-2 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
          >
            <option value={2}>Section</option>
            <option value={3}>Sub-section</option>
          </select>
          <input
            value={block.text}
            onChange={(e) => onChange({ ...block, text: e.target.value })}
            placeholder="Heading text"
            className={inputClass}
          />
        </div>
      );

    case 'paragraph':
      return (
        <div>
          <textarea
            value={block.text}
            onChange={(e) => onChange({ ...block, text: e.target.value })}
            rows={4}
            placeholder="Write your copy. **bold**, *italic*, `code` and [links](https://example.com) all work. Leave a blank line to start a new paragraph."
            className={inputClass}
          />
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={block.lead === true}
              onChange={(e) => onChange({ ...block, lead: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-line accent-teal"
            />
            Lead paragraph (larger opening copy)
          </label>
        </div>
      );

    case 'image':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <ImageField
            value={block.url}
            onChange={(url) => onChange({ ...block, url })}
            label="Image"
          />
          <div className="space-y-3">
            <div>
              <label className={labelClass}>Alt text (for screen readers and SEO)</label>
              <input
                value={block.alt}
                onChange={(e) => onChange({ ...block, alt: e.target.value })}
                placeholder="What the image shows"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Caption (optional)</label>
              <input
                value={block.caption}
                onChange={(e) => onChange({ ...block, caption: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Width</label>
              <select
                value={block.width}
                onChange={(e) => onChange({ ...block, width: e.target.value as any })}
                className={inputClass}
              >
                <option value="inline">Inline — narrower than the text</option>
                <option value="wide">Wide — a little past the text</option>
                <option value="full">Full — the widest the layout allows</option>
              </select>
            </div>
          </div>
        </div>
      );

    case 'gallery':
      return (
        <div>
          <div className="mb-3 flex items-center gap-3">
            <label className="text-xs text-ink-muted">Columns</label>
            <select
              value={block.columns}
              onChange={(e) => onChange({ ...block, columns: Number(e.target.value) === 2 ? 2 : 3 })}
              className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
            >
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {block.images.map((img, i) => (
              <div key={i} className="rounded-lg border border-line p-2">
                <ImageField
                  value={img.url}
                  label=""
                  aspect="square"
                  compact
                  onChange={(url) =>
                    onChange({
                      ...block,
                      images: block.images.map((g, gi) => (gi === i ? { ...g, url } : g)),
                    })
                  }
                />
                <input
                  value={img.alt}
                  onChange={(e) =>
                    onChange({
                      ...block,
                      images: block.images.map((g, gi) => (gi === i ? { ...g, alt: e.target.value } : g)),
                    })
                  }
                  placeholder="Alt text"
                  className="mt-2 w-full rounded border border-line bg-white px-2 py-1 text-[11px] text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
                />
                <input
                  value={img.caption}
                  onChange={(e) =>
                    onChange({
                      ...block,
                      images: block.images.map((g, gi) => (gi === i ? { ...g, caption: e.target.value } : g)),
                    })
                  }
                  placeholder="Caption"
                  className="mt-1 w-full rounded border border-line bg-white px-2 py-1 text-[11px] text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
                />
                <button
                  type="button"
                  onClick={() => onChange({ ...block, images: block.images.filter((_, gi) => gi !== i) })}
                  className="mt-1.5 text-[11px] text-ink-muted hover:text-red-600"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              onChange({ ...block, images: [...block.images, { url: '', alt: '', caption: '' }] })
            }
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface"
          >
            <Plus className="h-3.5 w-3.5" />
            Add image
          </button>
        </div>
      );

    case 'quote':
      return (
        <div className="space-y-2">
          <textarea
            value={block.text}
            onChange={(e) => onChange({ ...block, text: e.target.value })}
            rows={2}
            placeholder="The quote"
            className={inputClass}
          />
          <input
            value={block.attribution}
            onChange={(e) => onChange({ ...block, attribution: e.target.value })}
            placeholder="Who said it (optional)"
            className={inputClass}
          />
        </div>
      );

    case 'list':
      return (
        <div>
          <div className="mb-2 flex gap-2">
            {(['bullet', 'number'] as const).map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => onChange({ ...block, style })}
                className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
                  block.style === style
                    ? 'border-teal bg-teal/10 text-teal-dark'
                    : 'border-line bg-white text-ink-muted hover:text-ink'
                }`}
              >
                {style === 'bullet' ? 'Bulleted' : 'Numbered'}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {block.items.map((item, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={item}
                  onChange={(e) =>
                    onChange({
                      ...block,
                      items: block.items.map((v, vi) => (vi === i ? e.target.value : v)),
                    })
                  }
                  onKeyDown={(e) => {
                    // Enter adds the next point, the way a list wants to be typed.
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const next = [...block.items];
                      next.splice(i + 1, 0, '');
                      onChange({ ...block, items: next });
                    }
                  }}
                  placeholder={`Point ${i + 1}`}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => onChange({ ...block, items: block.items.filter((_, vi) => vi !== i) })}
                  className="rounded p-2 text-ink-muted hover:bg-red-50 hover:text-red-600"
                  title="Remove point"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onChange({ ...block, items: [...block.items, ''] })}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface"
          >
            <Plus className="h-3.5 w-3.5" />
            Add point
          </button>
        </div>
      );

    case 'callout':
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {(['info', 'success', 'warning', 'tip'] as CalloutTone[]).map((tone) => (
              <button
                key={tone}
                type="button"
                onClick={() => onChange({ ...block, tone })}
                className={`rounded-lg border px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  block.tone === tone
                    ? 'border-teal bg-teal/10 text-teal-dark'
                    : 'border-line bg-white text-ink-muted hover:text-ink'
                }`}
              >
                {tone}
              </button>
            ))}
          </div>
          <input
            value={block.title}
            onChange={(e) => onChange({ ...block, title: e.target.value })}
            placeholder="Callout title"
            className={inputClass}
          />
          <textarea
            value={block.text}
            onChange={(e) => onChange({ ...block, text: e.target.value })}
            rows={2}
            placeholder="Callout body"
            className={inputClass}
          />
        </div>
      );

    case 'cta':
      return (
        <div className="space-y-2">
          <textarea
            value={block.text}
            onChange={(e) => onChange({ ...block, text: e.target.value })}
            rows={2}
            placeholder="The line above the button"
            className={inputClass}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={block.button_label}
              onChange={(e) => onChange({ ...block, button_label: e.target.value })}
              placeholder="Button label"
              className={inputClass}
            />
            <input
              value={block.button_url}
              onChange={(e) => onChange({ ...block, button_url: e.target.value })}
              placeholder="/products or https://…"
              className={inputClass}
            />
          </div>
        </div>
      );

    case 'stats':
      return (
        <div>
          <div className="grid gap-2 sm:grid-cols-2">
            {block.items.map((stat, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={stat.value}
                  onChange={(e) =>
                    onChange({
                      ...block,
                      items: block.items.map((s, si) => (si === i ? { ...s, value: e.target.value } : s)),
                    })
                  }
                  placeholder="99.4%"
                  className="w-24 rounded-lg border border-line bg-surface px-2 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
                />
                <input
                  value={stat.label}
                  onChange={(e) =>
                    onChange({
                      ...block,
                      items: block.items.map((s, si) => (si === i ? { ...s, label: e.target.value } : s)),
                    })
                  }
                  placeholder="Average purity"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => onChange({ ...block, items: block.items.filter((_, si) => si !== i) })}
                  className="rounded p-2 text-ink-muted hover:bg-red-50 hover:text-red-600"
                  title="Remove stat"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onChange({ ...block, items: [...block.items, { value: '', label: '' }] })}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface"
          >
            <Plus className="h-3.5 w-3.5" />
            Add stat
          </button>
        </div>
      );

    case 'video':
      return (
        <div className="space-y-2">
          <input
            value={block.url}
            onChange={(e) => onChange({ ...block, url: e.target.value })}
            placeholder="https://www.youtube.com/watch?v=… or https://vimeo.com/…"
            className={inputClass}
          />
          <input
            value={block.caption}
            onChange={(e) => onChange({ ...block, caption: e.target.value })}
            placeholder="Caption (optional)"
            className={inputClass}
          />
        </div>
      );

    case 'divider':
      return <p className="text-xs text-ink-muted">A horizontal rule. Nothing to configure.</p>;
  }
}
