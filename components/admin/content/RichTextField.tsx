'use client';

import React, { useRef, useState } from 'react';
import { Bold, Italic, Code, Link2 } from 'lucide-react';

/**
 * A text box with a Bold / Italic / Link / Code toolbar.
 *
 * Page and article copy is stored as PLAIN TEXT carrying a small inline syntax
 * — `**bold**`, `*italic*`, `` `code` `` and `[label](url)` — which the
 * storefront parses into React nodes rather than injecting as HTML (see
 * components/content/RichText.tsx). That is what stops an editor from putting
 * a script on the storefront, and it is why pasting raw HTML into these boxes
 * does nothing: the tags come out as literal text.
 *
 * The syntax was there all along, but nothing on screen said so, so the only
 * way to bold a word was to already know the markers. This wraps the box in
 * the three buttons that write them for you: select some words, press B, and
 * the selection comes back wrapped — press it again to unwrap. With nothing
 * selected the markers are inserted and the caret parked between them, so you
 * can just keep typing.
 *
 * Link asks for the URL and accepts anything the storefront will actually
 * render: an https:// address, a site-relative path like /products, a #anchor,
 * mailto: or tel:. Everything else is refused here rather than silently
 * dropped at render time.
 */

interface RichTextFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Multi-line (a textarea) or single-line (an input). */
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  className?: string;
  /** Hide the Code button where inline code makes no sense (a heading, a CTA). */
  allowCode?: boolean;
  /** A line under the box, e.g. the paragraph editor's "blank line = new
   *  paragraph" note. */
  hint?: React.ReactNode;
  ariaLabel?: string;
  /** Single-line fields only: what Enter should do instead of nothing — the
   *  list editor uses it to start the next point, the way a list wants to be
   *  typed. */
  onEnter?: () => void;
}

type Field = HTMLTextAreaElement | HTMLInputElement;

const inputClass =
  'w-full rounded-b-lg border border-t-0 border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40';

/** Same allowlist `safeUrl` enforces at render — stated here so the editor can
 *  say why a link was refused instead of quietly dropping it later. */
function isRenderableUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  return (
    trimmed.startsWith('/') ||
    trimmed.startsWith('#') ||
    /^https?:\/\//i.test(trimmed) ||
    /^mailto:/i.test(trimmed) ||
    /^tel:/i.test(trimmed)
  );
}

export default function RichTextField({
  value,
  onChange,
  multiline = false,
  rows = 4,
  placeholder,
  className = '',
  allowCode = true,
  hint,
  ariaLabel,
  onEnter,
}: RichTextFieldProps) {
  const ref = useRef<Field | null>(null);
  const [error, setError] = useState('');

  /**
   * Replace [start, end) with `next` and put the caret where the caller asks.
   * Goes through onChange (never the DOM) so React stays the source of truth,
   * then restores the selection on the next frame — a controlled field resets
   * the caret to the end on re-render otherwise, which would send you back to
   * the bottom of the box after every button press.
   */
  const splice = (start: number, end: number, next: string, caret: [number, number]) => {
    onChange(value.slice(0, start) + next + value.slice(end));
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret[0], caret[1]);
    });
  };

  /** Wrap the selection in `marker`, or unwrap it when it is already wrapped. */
  const toggleWrap = (marker: string) => {
    const el = ref.current;
    if (!el) return;
    setError('');
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    const selected = value.slice(start, end);
    const width = marker.length;

    // Already wrapped, either inside the selection or just outside it.
    if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length > width * 2) {
      const inner = selected.slice(width, -width);
      splice(start, end, inner, [start, start + inner.length]);
      return;
    }
    if (
      value.slice(Math.max(0, start - width), start) === marker &&
      value.slice(end, end + width) === marker
    ) {
      splice(start - width, end + width, selected, [start - width, end - width]);
      return;
    }

    if (selected.length === 0) {
      // Nothing selected: drop the markers in and park the caret between them,
      // so the next keystroke is already inside the formatting.
      splice(start, end, `${marker}${marker}`, [start + width, start + width]);
      return;
    }
    splice(start, end, `${marker}${selected}${marker}`, [start + width, end + width]);
  };

  const insertLink = () => {
    const el = ref.current;
    if (!el) return;
    setError('');
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    const selected = value.slice(start, end);

    const url = window.prompt(
      'Link to… (https://example.com, /products, #section, mailto: or tel:)',
      'https://',
    );
    // Cancelled — leave the text exactly as it was.
    if (url === null) return;
    if (!isRenderableUrl(url)) {
      setError(
        'That link was not added. Use a full https:// address, a path starting with /, a #anchor, mailto: or tel:.',
      );
      return;
    }

    const label = selected || window.prompt('Link text', '') || url.trim();
    const markup = `[${label}](${url.trim()})`;
    // Select the label so it can be typed over straight away.
    splice(start, end, markup, [start + 1, start + 1 + label.length]);
  };

  const buttons: Array<{ key: string; title: string; icon: React.ElementType; run: () => void }> = [
    { key: 'bold', title: 'Bold (**text**)', icon: Bold, run: () => toggleWrap('**') },
    { key: 'italic', title: 'Italic (*text*)', icon: Italic, run: () => toggleWrap('*') },
    { key: 'link', title: 'Insert link ([text](url))', icon: Link2, run: insertLink },
    ...(allowCode
      ? [{ key: 'code', title: 'Code (`text`)', icon: Code, run: () => toggleWrap('`') }]
      : []),
  ];

  /** Ctrl/⌘+B and Ctrl/⌘+I, because that is what everybody presses first. */
  const onKeyDown = (e: React.KeyboardEvent<Field>) => {
    if (onEnter && !multiline && e.key === 'Enter') {
      e.preventDefault();
      onEnter();
      return;
    }
    if (!(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'b') {
      e.preventDefault();
      toggleWrap('**');
    } else if (key === 'i') {
      e.preventDefault();
      toggleWrap('*');
    } else if (key === 'k') {
      e.preventDefault();
      insertLink();
    }
  };

  const shared = {
    value,
    placeholder,
    onChange: (e: React.ChangeEvent<Field>) => onChange(e.target.value),
    onKeyDown,
    className: `${inputClass} ${className}`.trim(),
    'aria-label': ariaLabel,
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-0.5 rounded-t-lg border border-line bg-surface-2 px-1.5 py-1">
        {buttons.map(({ key, title, icon: Icon, run }) => (
          <button
            key={key}
            type="button"
            title={title}
            aria-label={title}
            // The field loses focus (and its selection) on mousedown otherwise,
            // and the button would then wrap nothing.
            onMouseDown={(e) => e.preventDefault()}
            onClick={run}
            className="rounded p-1.5 text-ink-muted transition-colors hover:bg-white hover:text-ink"
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
        <span className="ml-auto pr-1 text-[10px] text-ink-muted">
          Select text, then format
        </span>
      </div>

      {multiline ? (
        <textarea
          {...shared}
          ref={(el) => { ref.current = el; }}
          rows={rows}
          className={`${shared.className} resize-y`}
        />
      ) : (
        <input {...shared} type="text" ref={(el) => { ref.current = el; }} />
      )}

      {error && (
        <p className="mt-1 text-[11px] text-red-600">{error}</p>
      )}
      {hint && <p className="mt-1 text-[11px] text-ink-muted">{hint}</p>}
    </div>
  );
}
