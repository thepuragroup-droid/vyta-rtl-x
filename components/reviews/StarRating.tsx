'use client';

import React, { useState } from 'react';
import { Star } from 'lucide-react';

/**
 * The one star row the site uses — on product cards, in the review list, in
 * the write form and in the testimonial carousel.
 *
 * Read-only it renders partial stars (4.6 really does look like 4.6, not 5),
 * which a row of whole icons cannot do: each star is drawn twice, the filled
 * copy clipped to the width the score earns.
 */

const SIZES = {
  xs: 'w-3 h-3',
  sm: 'w-3.5 h-3.5',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
  xl: 'w-6 h-6',
} as const;

export type StarSize = keyof typeof SIZES;

export function StarRating({
  value,
  size = 'sm',
  className = '',
  label,
}: {
  value: number;
  size?: StarSize;
  className?: string;
  /** Screen-reader text. Defaults to "4.6 out of 5". */
  label?: string;
}) {
  const clamped = Math.min(5, Math.max(0, value));
  const cls = SIZES[size];

  return (
    <span
      className={`inline-flex items-center gap-0.5 ${className}`}
      role="img"
      aria-label={label ?? `${clamped.toFixed(1)} out of 5`}
    >
      {[0, 1, 2, 3, 4].map((i) => {
        // How much of THIS star is earned: 1 for a full star, 0.5 for a half,
        // 0 once the score runs out.
        const fill = Math.min(1, Math.max(0, clamped - i));
        return (
          <span key={i} className="relative inline-flex">
            <Star className={`${cls} text-line`} strokeWidth={1.5} />
            {fill > 0 && (
              <span
                className="absolute inset-0 overflow-hidden"
                style={{ width: `${fill * 100}%` }}
                aria-hidden="true"
              >
                <Star className={`${cls} text-amber-400 fill-amber-400`} strokeWidth={1.5} />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

/**
 * The write-a-review control. Hover previews the score under the pointer,
 * which is the whole reason a star picker beats a number field — and each
 * star is a real button, so it works from the keyboard too.
 */
export function StarInput({
  value,
  onChange,
  size = 'xl',
  disabled = false,
}: {
  value: number;
  onChange: (rating: number) => void;
  size?: StarSize;
  disabled?: boolean;
}) {
  const [hovered, setHovered] = useState(0);
  const shown = hovered || value;
  const cls = SIZES[size];

  return (
    <span className="inline-flex items-center gap-1" onMouseLeave={() => setHovered(0)}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={disabled}
          onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)}
          onFocus={() => setHovered(star)}
          onBlur={() => setHovered(0)}
          aria-label={`${star} star${star === 1 ? '' : 's'}`}
          aria-pressed={value === star}
          className="p-0.5 rounded transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:hover:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
        >
          <Star
            className={`${cls} transition-colors ${
              star <= shown ? 'text-amber-400 fill-amber-400' : 'text-line'
            }`}
            strokeWidth={1.5}
          />
        </button>
      ))}
    </span>
  );
}

/** Stars plus "(128)" — the compact form a product card carries. */
export function RatingSummary({
  average,
  count,
  size = 'xs',
  className = '',
}: {
  average: number;
  count: number;
  size?: StarSize;
  className?: string;
}) {
  if (count === 0) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <StarRating value={average} size={size} />
      <span className="text-[10px] sm:text-xs text-ink-muted tabular-nums">({count})</span>
    </span>
  );
}
