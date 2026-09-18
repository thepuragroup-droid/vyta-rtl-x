'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, X } from 'lucide-react';
import {
  announcementStyle,
  liveAnnouncements,
  shapeAnnouncement,
  type Announcement,
} from '@/lib/content/announcements';
import { safeUrl } from '@/lib/content/blocks';

/**
 * The sticky site-wide announcement bar.
 *
 * ── How it stays at the top of every page ──────────────────────────────────
 * The bar is `fixed` at the very top of the viewport, so it survives scrolling
 * on every route without each page opting in. Two things keep the rest of the
 * layout honest:
 *
 *   1. It publishes its own height as the `--announcement-h` CSS variable on
 *      <html>. The main navigation (also `fixed`) offsets its `top` by that
 *      variable, so the two stack instead of overlapping.
 *   2. It renders an in-flow spacer of the same height BEFORE the page content,
 *      which pushes the document down by exactly the bar's height — so every
 *      page's existing padding-for-the-fixed-nav keeps working untouched.
 *
 * Both fall back to 0 when there is nothing to show, which is the common case,
 * so a site with no banners is pixel-identical to one without this component.
 *
 * ── Where it does NOT appear ───────────────────────────────────────────────
 * The admin, warehouse and affiliate portals are tools, not storefront: a
 * marketing banner over a fulfilment queue is noise. Those paths render
 * nothing at all.
 */

const HIDDEN_PREFIXES = ['/admin', '/warehouse', '/affiliate'];

/** Dismissals are per-browser and per-banner; the id keeps them independent. */
const DISMISS_KEY = 'vyta_dismissed_announcements';

function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    // Private windows and blocked site data both throw — treat as "nothing
    // dismissed" rather than hiding the bar or crashing the page.
    return [];
  }
}

function writeDismissed(ids: string[]): void {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(ids.slice(-50)));
  } catch {
    /* nothing we can do; the banner just comes back next visit */
  }
}

export default function AnnouncementBar() {
  const pathname = usePathname() || '/';
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const marqueeRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  // How many copies of the message make up ONE marquee group. See `useEffect`
  // below: enough to cover the bar, so the loop never shows bare background.
  const [copies, setCopies] = useState(2);

  const hidden = HIDDEN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  useEffect(() => setDismissed(readDismissed()), []);

  // One fetch per mount. The bar is chrome, so every failure path resolves to
  // "no banner" rather than an error state.
  useEffect(() => {
    if (hidden) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/announcements', { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json().catch(() => null);
        const rows = Array.isArray(json?.announcements) ? json.announcements : [];
        if (alive) setAnnouncements(rows.map(shapeAnnouncement));
      } catch {
        /* offline / aborted — no banner */
      }
    })();
    return () => { alive = false; };
  }, [hidden]);

  // Re-check the schedule window on the client too: a tab left open across a
  // banner's end time should stop showing it.
  const visible = useMemo(
    () => liveAnnouncements(announcements).filter((a) => !dismissed.includes(a.id)),
    [announcements, dismissed],
  );

  const current = visible.length > 0 ? visible[index % visible.length] : null;

  // Several live banners rotate rather than stacking — one row of chrome is
  // the most a storefront should ever spend on this.
  useEffect(() => {
    if (visible.length < 2) return;
    const timer = setInterval(() => setIndex((i) => i + 1), 7000);
    return () => clearInterval(timer);
  }, [visible.length]);

  // ── Filling the marquee ──────────────────────────────────────────────────
  // The scroll is two identical groups translated by exactly half the track's
  // width, so the second is in place the moment the first leaves. That only
  // reads as a continuous loop if ONE group is at least as wide as the bar —
  // otherwise the group runs out mid-screen and the rest of the row is empty
  // background until the loop resets.
  //
  // A single short message ("Free shipping over $200") is far narrower than a
  // desktop bar, which is where that empty stretch came from. So measure one
  // copy against the bar and repeat it enough times to cover the full width,
  // plus one so the seam is always off-screen.
  useEffect(() => {
    const viewport = marqueeRef.current;
    const sample = measureRef.current;
    if (!viewport || !sample) return;

    const sync = () => {
      const barWidth = viewport.getBoundingClientRect().width;
      const itemWidth = sample.getBoundingClientRect().width;
      // Zero width means it hasn't laid out yet (or a font is still loading);
      // keep the current count rather than dividing by zero.
      if (barWidth <= 0 || itemWidth <= 0) return;
      setCopies(Math.max(2, Math.ceil(barWidth / itemWidth) + 1));
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(viewport);
    observer.observe(sample);
    return () => observer.disconnect();
    // Re-measure when the message itself changes: the rotation swaps in a
    // banner of a completely different length.
  }, [current?.id, current?.message, current?.link_label]);

  // Publish the bar's measured height so the fixed nav can sit below it, and
  // keep the in-flow spacer the same size. Measured (not hardcoded) because a
  // long message wraps to two lines on a phone.
  useEffect(() => {
    const el = barRef.current;
    if (!el || !current) {
      setHeight(0);
      document.documentElement.style.setProperty('--announcement-h', '0px');
      return;
    }
    const sync = () => {
      const next = el.getBoundingClientRect().height;
      setHeight(next);
      document.documentElement.style.setProperty('--announcement-h', `${next}px`);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    window.addEventListener('resize', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [current]);

  // Clear the variable when the component unmounts or the route hides the bar,
  // so the nav doesn't keep an offset for a bar that is gone.
  useEffect(() => {
    if (!hidden) return;
    document.documentElement.style.setProperty('--announcement-h', '0px');
  }, [hidden]);

  if (hidden || !current) return null;

  const style = announcementStyle(current);
  const href = current.link_url ? safeUrl(current.link_url) : '';
  const linkLabel = current.link_label || 'Learn more';

  const dismiss = () => {
    const next = [...dismissed, current.id];
    setDismissed(next);
    writeDismissed(next);
  };

  const cta = href ? (
    href.startsWith('/') || href.startsWith('#') ? (
      <Link href={href} className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
        {linkLabel}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    ) : (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 font-semibold underline underline-offset-2"
      >
        {linkLabel}
        <ArrowRight className="h-3.5 w-3.5" />
      </a>
    )
  ) : null;

  const content = (
    <>
      <span>{current.message}</span>
      {cta}
    </>
  );

  return (
    <>
      {/* In-flow spacer: pushes the page down by the bar's height so each
          page's own padding-for-the-fixed-nav still lands in the right place. */}
      <div style={{ height }} aria-hidden="true" />

      <div
        ref={barRef}
        // Above the nav (z-50) so the bar is never covered by it.
        className="fixed inset-x-0 top-0 z-[60] text-xs sm:text-sm"
        style={style}
        role="region"
        aria-label="Site announcement"
      >
        <div className="relative flex items-center">
          {current.scrolling ? (
            /* Marquee: two identical GROUPS side by side, the pair translated
               by exactly half its width, so the loop has no visible seam. Each
               group repeats the message `copies` times — enough to span the
               bar, so there is never a bare stretch waiting for the reset.
               `prefers-reduced-motion` stops it (globals.css) and leaves the
               message readable in place. */
            <div ref={marqueeRef} className="vyta-marquee flex-1 overflow-hidden py-2">
              <div
                className="vyta-marquee-track"
                /* One group scrolls past in `speed_seconds`, whatever it holds:
                   scaling the duration by the copy count keeps the text moving
                   at the same speed the operator set, instead of sprinting
                   whenever the bar happens to be wide. */
                style={{ animationDuration: `${current.speed_seconds * copies}s` }}
              >
                {Array.from({ length: copies * 2 }, (_, i) => (
                  <span
                    key={i}
                    className="vyta-marquee-item"
                    /* One copy is the real message; the rest are decoration a
                       screen reader should not read out again. */
                    aria-hidden={i === 0 ? undefined : true}
                  >
                    {content}
                  </span>
                ))}
              </div>
              {/* Off-screen ruler: one copy at its natural width, which is what
                  the effect above divides the bar by. Measuring a rendered item
                  instead would feed the count back into its own input. */}
              <span ref={measureRef} className="vyta-marquee-measure" aria-hidden="true">
                {content}
              </span>
            </div>
          ) : (
            <div className="flex flex-1 flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-10 py-2 text-center">
              {content}
            </div>
          )}

          {current.dismissible && (
            <button
              onClick={dismiss}
              aria-label="Dismiss announcement"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 opacity-70 transition-opacity hover:opacity-100"
              style={{ color: style.color }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
