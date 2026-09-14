'use client';

import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { HelpCircle } from 'lucide-react';

const PANEL_W = 320;
const GAP = 10;      // between the trigger and the panel
const MARGIN = 12;   // smallest distance we let the panel sit from the edge

/**
 * A "why does it say that?" tooltip for figures that need a sentence of
 * explanation rather than a label.
 *
 * The admin already had two one-line hover hints (customers, affiliates); this
 * is their richer sibling, for content that has to hold a list or a rule.
 *
 * Positioned `fixed` from the trigger's bounding rect rather than absolutely,
 * because the cards these sit in are `overflow-hidden` and the channel table
 * scrolls sideways — an absolutely positioned panel would be clipped by both.
 *
 * Two ways in, because a figure people squint at gets read on a phone too:
 *
 *   • hover or keyboard focus — a preview, `pointer-events-none` so it can
 *     never swallow a click meant for what is underneath;
 *   • click or tap — pins it open, so the text can be read at leisure and
 *     selected. Escape, an outside click, or a second click closes it.
 */
export default function InfoTip({
  label,
  children,
  className = '',
}: {
  /** Accessible name for the trigger — say what it explains, not "help". */
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<
    { left: number; top: number; caret: number; below: boolean; maxH: number } | null
  >(null);

  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const open = hovered || pinned;

  const place = useCallback(() => {
    const btn = btnRef.current;
    const panel = panelRef.current;
    if (!btn || !panel) return;

    const r = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(PANEL_W, vw - MARGIN * 2);
    const h = panel.offsetHeight;

    // Above by default — these triggers sit in headers and rows, and a panel
    // dropping down would cover the very figure being explained. Flip below
    // only when there isn't room above.
    const above = r.top - GAP - MARGIN;
    const beneath = vh - r.bottom - GAP - MARGIN;

    let below: boolean;
    let maxH: number;
    if (h <= above) {
      below = false;
      maxH = h;
    } else if (h <= beneath) {
      below = true;
      maxH = h;
    } else {
      // Fits neither way — take the roomier side and let the panel scroll,
      // rather than running off the screen with the rest of the sentence.
      below = beneath > above;
      maxH = Math.max(140, below ? beneath : above);
    }

    const height = Math.min(h, maxH);
    const top = below ? r.bottom + GAP : Math.max(MARGIN, r.top - GAP - height);

    const centre = r.left + r.width / 2;
    const left = Math.min(Math.max(MARGIN, centre - w / 2), Math.max(MARGIN, vw - MARGIN - w));

    setPos({ left, top, caret: Math.min(Math.max(14, centre - left), w - 14), below, maxH });
  }, []);

  // Measure once the panel is in the DOM (rendered hidden), then show it.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
  }, [open, place]);

  // Keep it attached to its trigger while the page moves under it. `capture`
  // catches scrolling inside the tables and panes, not just the window.
  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, place]);

  // Pinned only: Escape and outside clicks let go of it.
  useEffect(() => {
    if (!pinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPinned(false);
        btnRef.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !panelRef.current?.contains(t)) setPinned(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [pinned]);

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setPinned((p) => !p)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        className="inline-flex items-center justify-center rounded-full text-ink-light transition-colors hover:text-bronze focus:text-bronze focus:outline-none focus-visible:ring-2 focus-visible:ring-bronze/40"
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden />
      </button>

      {open && (
        <div
          ref={panelRef}
          id={id}
          role="tooltip"
          className={`fixed z-[60] rounded-xl border border-line bg-white text-left shadow-xl ${
            pinned ? '' : 'pointer-events-none'
          }`}
          style={{
            width: PANEL_W,
            maxWidth: 'calc(100vw - 1.5rem)',
            left: pos?.left ?? -9999,
            top: pos?.top ?? -9999,
            visibility: pos ? 'visible' : 'hidden',
          }}
        >
          {/* The scroll box is inside the panel so the caret, a sibling, stays
              pinned to the trigger when a long tip has to scroll. */}
          <div
            className="overflow-y-auto p-3.5 text-xs leading-relaxed text-ink-muted [&_strong]:font-semibold [&_strong]:text-ink"
            style={{ maxHeight: pos?.maxH }}
          >
            {children}
          </div>
          {pos && (
            <span
              aria-hidden
              className={`absolute h-2 w-2 rotate-45 border-line bg-white ${
                pos.below ? '-top-1 border-l border-t' : '-bottom-1 border-b border-r'
              }`}
              style={{ left: pos.caret - 4 }}
            />
          )}
        </div>
      )}
    </span>
  );
}
