'use client';

import React, { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { Search, Check, ChevronDown } from 'lucide-react';

interface CustomerOption {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email: string;
  preferred_currency?: string | null;
}

interface MultiSelectCustomerProps {
  customers: CustomerOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  single?: boolean;
  disabled?: boolean;
}

function displayName(c: CustomerOption): string {
  const full = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
  return full || c.email;
}

const PANEL_MAX_HEIGHT = 288; // px — matches max-h-72

export default function MultiSelectCustomer({
  customers,
  selectedIds,
  onChange,
  label = 'Customers',
  single = false,
  disabled = false,
}: MultiSelectCustomerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number; width: number; openUp: boolean }>({
    left: 0, top: 0, width: 0, openUp: false,
  });

  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        displayName(c).toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
    );
  }, [customers, query]);

  // Position the floating panel against the anchor. Fixed positioning escapes
  // any ancestor overflow:hidden (e.g. a modal) so the list is never clipped.
  const reposition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const openUp = spaceBelow < PANEL_MAX_HEIGHT + 8 && spaceAbove > spaceBelow;
    setCoords({
      left: r.left,
      width: r.width,
      top: openUp ? r.top : r.bottom,
      openUp,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    const onScroll = () => reposition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, reposition]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggle(id: string) {
    if (disabled) return;
    if (single) {
      onChange(selectedIds.includes(id) ? [] : [id]);
      setOpen(false);
    } else {
      onChange(
        selectedIds.includes(id)
          ? selectedIds.filter((x) => x !== id)
          : [...selectedIds, id]
      );
    }
  }

  const selectedCount = selectedIds.length;

  // Built lazily (only when open) so window is never read during SSR.
  const renderPanel = () => {
    const viewportH = typeof window !== 'undefined' ? window.innerHeight : 0;
    const panelStyle: React.CSSProperties = {
      position: 'fixed',
      left: coords.left,
      width: coords.width,
      maxHeight: PANEL_MAX_HEIGHT,
      ...(coords.openUp
        ? { bottom: viewportH - coords.top + 4 }
        : { top: coords.top + 4 }),
    };
    return (
    <div
      ref={panelRef}
      style={panelStyle}
      className="z-[100] bg-white border border-line rounded-lg shadow-xl overflow-y-auto divide-y divide-line/50"
    >
      {filtered.length === 0 ? (
        <p className="px-3 py-3 text-sm text-ink-muted text-center">No customers found</p>
      ) : (
        filtered.map((c) => {
          const checked = selectedIds.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              disabled={disabled}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface transition-colors ${
                checked ? 'bg-bronze/5' : ''
              } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <span
                className={`w-4 h-4 flex-shrink-0 rounded border flex items-center justify-center ${
                  checked ? 'bg-bronze border-bronze text-white' : 'border-line'
                } ${single ? 'rounded-full' : ''}`}
              >
                {checked && <Check className="w-3 h-3" />}
              </span>
              <span className="text-sm text-ink flex-1 min-w-0 truncate">{displayName(c)}</span>
              {c.preferred_currency === 'USD' && (
                <span className="text-[10px] font-medium text-blue-600 flex-shrink-0">USD</span>
              )}
              {displayName(c) !== c.email && (
                <span className="text-xs text-ink-muted ml-1 flex-shrink-0 truncate max-w-[120px]">{c.email}</span>
              )}
            </button>
          );
        })
      )}
    </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-xs font-medium text-ink-muted">{label}</label>
        {!single && selectedCount > 0 && (
          <span className="text-xs text-bronze font-medium">{selectedCount} selected</span>
        )}
      </div>
      <div ref={anchorRef} className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={
            !single && selectedCount > 0 ? `${selectedCount} selected — search to add…` : 'Search…'
          }
          disabled={disabled}
          className="w-full pl-9 pr-8 py-2 bg-surface border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-bronze/40 disabled:opacity-50"
        />
        <ChevronDown
          className={`absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted transition-transform pointer-events-none ${open ? 'rotate-180' : ''}`}
        />
      </div>
      {open && !disabled && renderPanel()}
    </div>
  );
}
