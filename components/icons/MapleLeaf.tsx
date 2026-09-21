import React from 'react';

/**
 * Canadian maple leaf — the one mark in the site's trust badges that the
 * lucide set has no glyph for. Drawn as a filled path rather than a stroked
 * outline, because at badge size an outlined maple leaf reads as a smudge.
 *
 * Takes the same props as a lucide icon (`className`, sizing utilities), so it
 * drops into the same badge rows; `strokeWidth` is accepted and ignored.
 */
export default function MapleLeaf(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="none">
      <path d="M12 2l1.4 3.6 2.6-1-.8 3.6 3.4-.8-.8 2.6 3.8.6-2.2 2 1.6 1.8-4.8.8.4 2.2-3.7-.8V22h-1.8v-5.4l-3.7.8.4-2.2-4.8-.8 1.6-1.8-2.2-2 3.8-.6-.8-2.6 3.4.8-.8-3.6 2.6 1L12 2z" />
    </svg>
  );
}

/** The flag red the leaf is drawn in wherever it carries the origin claim. */
export const MAPLE_RED = '#D52B1E';
