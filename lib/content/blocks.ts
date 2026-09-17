/**
 * The content-block document — one shared model behind the editable About Us
 * page (`site_pages`) and the article builder (`articles`).
 *
 * A document is an ORDERED ARRAY of typed blocks stored as `jsonb`. Keeping it
 * as data (rather than an HTML string) is what makes the admin preview honest:
 * the editor and the storefront render the same array through the same
 * component, so "preview" is literally the published output.
 *
 * Text inside a block is plain text with a tiny inline syntax — `**bold**`,
 * `*italic*`, `` `code` `` and `[label](url)`. It is parsed into React nodes at
 * render time (see components/content/RichText.tsx), never injected as HTML,
 * so an editor can never introduce a script into the storefront.
 *
 * Everything coming out of the database goes through `normalizeBlocks` first:
 * unknown types are dropped and missing fields are defaulted, so a document
 * written by an older build of the editor can never crash a page.
 */

export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'image'
  | 'gallery'
  | 'quote'
  | 'list'
  | 'callout'
  | 'cta'
  | 'stats'
  | 'video'
  | 'divider';

export type CalloutTone = 'info' | 'success' | 'warning' | 'tip';
export type ImageWidth = 'full' | 'wide' | 'inline';

export interface GalleryImage {
  url: string;
  alt: string;
  caption: string;
}

export interface StatItem {
  value: string;
  label: string;
}

interface BaseBlock {
  id: string;
  type: BlockType;
}

export interface HeadingBlock extends BaseBlock {
  type: 'heading';
  /** 2 = section, 3 = sub-section. H1 belongs to the page/article title. */
  level: 2 | 3;
  text: string;
}

export interface ParagraphBlock extends BaseBlock {
  type: 'paragraph';
  text: string;
  /** Larger, lighter lead paragraph — typically the opener. */
  lead?: boolean;
}

export interface ImageBlock extends BaseBlock {
  type: 'image';
  url: string;
  alt: string;
  caption: string;
  width: ImageWidth;
}

export interface GalleryBlock extends BaseBlock {
  type: 'gallery';
  images: GalleryImage[];
  columns: 2 | 3;
}

export interface QuoteBlock extends BaseBlock {
  type: 'quote';
  text: string;
  attribution: string;
}

export interface ListBlock extends BaseBlock {
  type: 'list';
  style: 'bullet' | 'number';
  items: string[];
}

export interface CalloutBlock extends BaseBlock {
  type: 'callout';
  tone: CalloutTone;
  title: string;
  text: string;
}

export interface CtaBlock extends BaseBlock {
  type: 'cta';
  text: string;
  button_label: string;
  button_url: string;
}

export interface StatsBlock extends BaseBlock {
  type: 'stats';
  items: StatItem[];
}

export interface VideoBlock extends BaseBlock {
  type: 'video';
  /** A YouTube or Vimeo watch/share URL — converted to an embed at render. */
  url: string;
  caption: string;
}

export interface DividerBlock extends BaseBlock {
  type: 'divider';
}

export type ContentBlock =
  | HeadingBlock
  | ParagraphBlock
  | ImageBlock
  | GalleryBlock
  | QuoteBlock
  | ListBlock
  | CalloutBlock
  | CtaBlock
  | StatsBlock
  | VideoBlock
  | DividerBlock;

/** Editor palette metadata — label, one-line hint and Lucide icon name. */
export const BLOCK_LIBRARY: Array<{
  type: BlockType;
  label: string;
  hint: string;
  icon: string;
}> = [
  { type: 'heading',   label: 'Heading',   hint: 'Section title',                 icon: 'Heading2' },
  { type: 'paragraph', label: 'Text',      hint: 'A paragraph of copy',           icon: 'Type' },
  { type: 'image',     label: 'Image',     hint: 'Upload or paste an image URL',  icon: 'Image' },
  { type: 'gallery',   label: 'Gallery',   hint: 'A row of images',               icon: 'Images' },
  { type: 'list',      label: 'List',      hint: 'Bulleted or numbered points',   icon: 'List' },
  { type: 'quote',     label: 'Quote',     hint: 'A pull quote with attribution', icon: 'Quote' },
  { type: 'callout',   label: 'Callout',   hint: 'A highlighted note or warning', icon: 'Info' },
  { type: 'stats',     label: 'Stats',     hint: 'Big numbers with labels',       icon: 'BarChart3' },
  { type: 'cta',       label: 'Call to action', hint: 'A line of copy and a button', icon: 'MousePointerClick' },
  { type: 'video',     label: 'Video',     hint: 'Embed a YouTube or Vimeo clip', icon: 'Video' },
  { type: 'divider',   label: 'Divider',   hint: 'A horizontal rule',             icon: 'Minus' },
];

// ---------------------------------------------------------------------------
// Coercion helpers — every field is defaulted, nothing can be undefined.
// ---------------------------------------------------------------------------

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function trimmed(v: unknown, fallback = ''): string {
  return str(v, fallback).trim();
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((item) => str(item)).filter((item) => item.trim().length > 0) : [];
}

/** Collision-resistant enough for block ids inside a single document. */
export function newBlockId(): string {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** A fresh block of `type`, pre-filled with placeholder-friendly empties. */
export function createBlock(type: BlockType): ContentBlock {
  const id = newBlockId();
  switch (type) {
    case 'heading':   return { id, type, level: 2, text: '' };
    case 'paragraph': return { id, type, text: '' };
    case 'image':     return { id, type, url: '', alt: '', caption: '', width: 'wide' };
    case 'gallery':   return { id, type, images: [{ url: '', alt: '', caption: '' }], columns: 3 };
    case 'quote':     return { id, type, text: '', attribution: '' };
    case 'list':      return { id, type, style: 'bullet', items: [''] };
    case 'callout':   return { id, type, tone: 'info', title: '', text: '' };
    case 'cta':       return { id, type, text: '', button_label: '', button_url: '' };
    case 'stats':     return { id, type, items: [{ value: '', label: '' }, { value: '', label: '' }] };
    case 'video':     return { id, type, url: '', caption: '' };
    case 'divider':   return { id, type };
  }
}

/**
 * Normalise one raw row into a valid block, or null when the type is unknown.
 * Defensive on purpose: documents are user data and outlive editor versions.
 */
function normalizeBlock(raw: unknown): ContentBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const id = trimmed(b.id) || newBlockId();

  switch (b.type) {
    case 'heading':
      return { id, type: 'heading', level: b.level === 3 ? 3 : 2, text: str(b.text) };

    case 'paragraph':
      return { id, type: 'paragraph', text: str(b.text), lead: b.lead === true };

    case 'image':
      return {
        id, type: 'image',
        url: trimmed(b.url),
        alt: str(b.alt),
        caption: str(b.caption),
        width: b.width === 'full' || b.width === 'inline' ? b.width : 'wide',
      };

    case 'gallery':
      return {
        id, type: 'gallery',
        columns: b.columns === 2 ? 2 : 3,
        images: Array.isArray(b.images)
          ? b.images.map((img) => {
              const i = (img ?? {}) as Record<string, unknown>;
              return { url: trimmed(i.url), alt: str(i.alt), caption: str(i.caption) };
            })
          : [],
      };

    case 'quote':
      return { id, type: 'quote', text: str(b.text), attribution: str(b.attribution) };

    case 'list':
      return {
        id, type: 'list',
        style: b.style === 'number' ? 'number' : 'bullet',
        items: strArray(b.items),
      };

    case 'callout': {
      const tone = b.tone;
      return {
        id, type: 'callout',
        tone: tone === 'success' || tone === 'warning' || tone === 'tip' ? tone : 'info',
        title: str(b.title),
        text: str(b.text),
      };
    }

    case 'cta':
      return {
        id, type: 'cta',
        text: str(b.text),
        button_label: str(b.button_label),
        button_url: trimmed(b.button_url),
      };

    case 'stats':
      return {
        id, type: 'stats',
        items: Array.isArray(b.items)
          ? b.items.map((item) => {
              const s = (item ?? {}) as Record<string, unknown>;
              return { value: str(s.value), label: str(s.label) };
            })
          : [],
      };

    case 'video':
      return { id, type: 'video', url: trimmed(b.url), caption: str(b.caption) };

    case 'divider':
      return { id, type: 'divider' };

    default:
      return null;
  }
}

/** Normalise a whole stored document. Anything unrecognised is dropped. */
export function normalizeBlocks(raw: unknown): ContentBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: ContentBlock[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const block = normalizeBlock(item);
    if (!block) continue;
    // Duplicate ids break React keys and drag-and-drop; re-key the second one.
    if (seen.has(block.id)) block.id = newBlockId();
    seen.add(block.id);
    out.push(block);
  }
  return out;
}

/**
 * Drop blocks that would render as nothing — an empty paragraph, an image with
 * no URL, a list with no items. Applied on SAVE (not on read) so an editor can
 * leave a half-finished block in place while writing, but the storefront never
 * shows an empty shell.
 */
export function pruneEmptyBlocks(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.filter((b) => {
    switch (b.type) {
      case 'heading':   return b.text.trim().length > 0;
      case 'paragraph': return b.text.trim().length > 0;
      case 'image':     return b.url.length > 0;
      case 'gallery':   return b.images.some((img) => img.url.length > 0);
      case 'quote':     return b.text.trim().length > 0;
      case 'list':      return b.items.some((item) => item.trim().length > 0);
      case 'callout':   return b.title.trim().length > 0 || b.text.trim().length > 0;
      case 'cta':       return b.text.trim().length > 0 || b.button_label.trim().length > 0;
      case 'stats':     return b.items.some((s) => s.value.trim().length > 0);
      case 'video':     return b.url.length > 0;
      case 'divider':   return true;
    }
  });
}

/** Strip the inline syntax so a block's text can be measured or excerpted. */
export function stripInline(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → label
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

/** All readable copy in a document, as one plain string. */
export function blocksPlainText(blocks: ContentBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
      case 'paragraph':
      case 'quote':
        parts.push(stripInline(b.text));
        break;
      case 'list':
        parts.push(b.items.map(stripInline).join(' '));
        break;
      case 'callout':
        parts.push(stripInline(b.title), stripInline(b.text));
        break;
      case 'cta':
        parts.push(stripInline(b.text));
        break;
      case 'stats':
        parts.push(b.items.map((s) => `${s.value} ${s.label}`).join(' '));
        break;
      case 'image':
        parts.push(stripInline(b.caption));
        break;
      case 'gallery':
        parts.push(b.images.map((i) => stripInline(i.caption)).join(' '));
        break;
      default:
        break;
    }
  }
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** First ~`max` characters of readable copy, cut on a word boundary. */
export function excerptFromBlocks(blocks: ContentBlock[], max = 180): string {
  const text = blocksPlainText(blocks);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/** Reading time in whole minutes (200 wpm), never less than 1. */
export function readingMinutes(blocks: ContentBlock[]): number {
  const words = blocksPlainText(blocks).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** Word count — shown in the editor's status bar. */
export function wordCount(blocks: ContentBlock[]): number {
  return blocksPlainText(blocks).split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

/**
 * Only http(s), site-relative paths, mailto and tel are allowed anywhere a
 * block stores a link. Anything else (notably `javascript:`) resolves to '#'.
 */
export function safeUrl(raw: string): string {
  const url = (raw ?? '').trim();
  if (!url) return '';
  if (url.startsWith('/') || url.startsWith('#')) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (/^mailto:/i.test(url) || /^tel:/i.test(url)) return url;
  return '';
}

/**
 * Convert a YouTube / Vimeo share URL into its embed URL. Returns '' when the
 * URL isn't a recognised video host, which is how the renderer decides to show
 * a "can't embed" note instead of an empty iframe.
 */
export function videoEmbedUrl(raw: string): string {
  const url = safeUrl(raw);
  if (!url) return '';
  try {
    const parsed = new URL(url, 'https://example.com');
    const host = parsed.hostname.replace(/^www\./, '');

    if (host === 'youtu.be') {
      const id = parsed.pathname.slice(1);
      return id ? `https://www.youtube.com/embed/${id}` : '';
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (parsed.pathname.startsWith('/embed/')) return `https://www.youtube.com${parsed.pathname}`;
      const id = parsed.searchParams.get('v');
      return id ? `https://www.youtube.com/embed/${id}` : '';
    }
    if (host === 'vimeo.com') {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : '';
    }
    if (host === 'player.vimeo.com') return url;
  } catch {
    return '';
  }
  return '';
}

/** URL-safe slug from a title. Shared by the page and article editors. */
export function slugify(input: string): string {
  return (input ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
