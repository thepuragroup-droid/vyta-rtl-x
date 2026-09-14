'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, Search } from 'lucide-react';

export interface AddressSuggestion {
  label: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (next: string) => void;
  onPick: (s: AddressSuggestion) => void;
  placeholder?: string;
  /** Optional id/name for the underlying input. */
  name?: string;
  disabled?: boolean;
  /** Fires whenever the lookup request starts/stops — lets the parent show
   *  a "Looking up address…" hint. */
  onLoadingChange?: (loading: boolean) => void;
}

// Photon/OpenStreetMap-backed autocomplete (Canada-only) via
// `/api/shipping/address-autocomplete`. Debounced typing, keyboard
// navigation (Arrow/Enter/Esc), and graceful text fallback if the
// endpoint is unreachable. Province names are converted to two-letter
// codes server-side. The suggestion list is portalled to <body> and
// pinned with fixed positioning so an ancestor's `overflow-hidden`
// (e.g. a collapsing accordion) can't clip it.
export default function AddressAutocomplete({
  value,
  onChange,
  onPick,
  placeholder = 'Start typing your street address…',
  name,
  disabled,
  onLoadingChange,
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const ignoreNextFetchRef = useRef(false);

  useEffect(() => setMounted(true), []);

  // Keep the parent informed of the lookup state.
  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  // Anchor the portalled dropdown to the input. Re-runs on scroll (capture,
  // to catch scrolling on any ancestor) and resize so it tracks the page.
  const reposition = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left, width: r.width });
  }, []);

  useEffect(() => {
    if (!open) return;
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, reposition, suggestions.length]);

  // Click-outside — a click inside either the input wrapper or the portalled
  // dropdown counts as "inside".
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (listRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Debounced fetch.
  useEffect(() => {
    if (ignoreNextFetchRef.current) {
      ignoreNextFetchRef.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/shipping/address-autocomplete?q=${encodeURIComponent(q)}`,
        );
        if (!res.ok) {
          setSuggestions([]);
          return;
        }
        const data = await res.json();
        const next = (data.suggestions ?? []) as AddressSuggestion[];
        setSuggestions(next);
        setActive(-1);
        setOpen(next.length > 0);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [value]);

  function pick(s: AddressSuggestion) {
    // Skip the next debounced fetch — the parent is about to overwrite
    // `value` with the resolved street and we don't want to re-query.
    ignoreNextFetchRef.current = true;
    onPick(s);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, -1));
    } else if (e.key === 'Enter') {
      if (active >= 0) {
        e.preventDefault();
        pick(suggestions[active]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <input
          type="text"
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
          disabled={disabled}
          className="w-full pl-10 pr-4 py-3 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-transparent text-sm bg-white text-ink placeholder-ink-muted"
        />
        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-ink-muted">
          {loading ? (
            <Search className="w-4 h-4 animate-pulse" />
          ) : (
            <MapPin className="w-4 h-4" />
          )}
        </div>
      </div>

      {mounted &&
        open &&
        suggestions.length > 0 &&
        pos &&
        createPortal(
          <ul
            ref={listRef}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width: pos.width,
            }}
            className="z-[300] bg-white border border-line rounded-xl shadow-lg max-h-72 overflow-auto"
            role="listbox"
          >
            {suggestions.map((s, i) => (
              <li
                key={`${s.label}-${i}`}
                role="option"
                aria-selected={active === i}
                onMouseDown={(e) => {
                  // mousedown (not click) so input doesn't blur first.
                  e.preventDefault();
                  pick(s);
                }}
                onMouseEnter={() => setActive(i)}
                className={`px-3 py-2 text-sm cursor-pointer ${
                  active === i ? 'bg-teal/10 text-ink' : 'text-ink'
                }`}
              >
                <div className="font-medium">{s.address}</div>
                <div className="text-xs text-ink-muted">
                  {[s.city, s.state, s.postalCode].filter(Boolean).join(' · ')}
                </div>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}
