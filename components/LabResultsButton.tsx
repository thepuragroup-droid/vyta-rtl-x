'use client';

import React from 'react';
import Link from 'next/link';
import { FlaskConical } from 'lucide-react';

/**
 * Links to the public /lab-results page pre-filtered to a product. Rendered
 * only when a product actually has a COA (caller guards on `coa_url`).
 *
 * - `compact` — icon (+ "Lab" on ≥sm) pill for product cards, sits beside Add.
 * - `detail`  — full-height bordered button for the product detail page, sits
 *   beside the Add to Cart button.
 */
export default function LabResultsButton({
  productName,
  variant = 'compact',
  className = '',
}: {
  productName: string;
  variant?: 'compact' | 'detail';
  className?: string;
}) {
  const href = `/lab-results?q=${encodeURIComponent(productName)}`;

  if (variant === 'detail') {
    return (
      <Link
        href={href}
        className={`shrink-0 font-semibold py-3 sm:py-4 px-4 sm:px-5 rounded-xl border border-line bg-white text-ink hover:border-ink/30 hover:bg-surface transition-all flex items-center justify-center gap-2 text-sm ${className}`}
      >
        <FlaskConical className="w-5 h-5 text-teal-dark" />
        <span>Lab Results</span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      onClick={(e) => e.stopPropagation()}
      title="Lab Results"
      aria-label="Lab Results"
      className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-line bg-white text-ink-muted hover:text-ink hover:border-ink/20 transition-all text-xs font-medium ${className}`}
    >
      <FlaskConical className="w-3.5 h-3.5 text-teal-dark" />
      <span className="hidden sm:inline">Lab</span>
    </Link>
  );
}
