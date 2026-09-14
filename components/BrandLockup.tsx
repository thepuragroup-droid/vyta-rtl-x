import React from 'react';

/**
 * The VYTA lockup — the one place the logo is assembled.
 *
 * Brand Identity Guidelines v1.0, LOGO USAGE:
 *   · Clear space: at least 1/2 icon width around the lockup.
 *   · Minimum digital width: 160px full lockup / 32px icon.
 *   · Preferred: full colour on white or very light backgrounds.
 *   · Never stretch, rotate, recolor randomly or add shadows.
 *
 * The mark is custom artwork, so it is always the supplied full-colour asset —
 * never recoloured, never re-drawn. On dark surfaces (the navy hero overlay,
 * the footer) the Midnight Navy half of the mark would lose contrast against
 * the ground, so instead of tinting the artwork the mark sits on a very light
 * tile — which is the background the guidelines prefer anyway.
 */

/** Whether the lockup sits on a light ground or a dark (navy) one. */
export type BrandTone = 'light' | 'dark';

const MARK_SRC = '/images/vyta-mark.png';

const SIZES = {
  sm: { mark: 'w-8 h-8', name: 'text-base', tagline: 'text-[9px]' },
  md: { mark: 'w-10 h-10', name: 'text-lg', tagline: 'text-[10px]' },
  lg: { mark: 'w-12 h-12', name: 'text-xl', tagline: 'text-[11px]' },
} as const;

export interface BrandLockupProps {
  /** Wordmark text — usually the configured store name. */
  name?: string;
  /** Kicker under the wordmark — usually the configured tagline. */
  tagline?: string | null;
  /** A custom logo from site settings replaces the mark when present. */
  logoUrl?: string | null;
  tone?: BrandTone;
  size?: keyof typeof SIZES;
  /** Mark only, no wordmark — for tight chrome. */
  markOnly?: boolean;
  className?: string;
}

/**
 * The icon on its own, with the clear space the guidelines require baked in as
 * tile padding. Minimum 32px — the `sm` size sits exactly on it.
 */
export function BrandMark({
  logoUrl,
  tone = 'light',
  size = 'md',
  className = '',
}: Pick<BrandLockupProps, 'logoUrl' | 'tone' | 'size' | 'className'>) {
  const s = SIZES[size];
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-xl ${s.mark} ${
        tone === 'dark' ? 'bg-white/95 p-1.5' : ''
      } ${className}`}
    >
      <img
        src={logoUrl || MARK_SRC}
        alt=""
        aria-hidden="true"
        className="h-full w-full object-contain"
      />
    </span>
  );
}

export default function BrandLockup({
  name = 'VYTA',
  tagline = 'Biosciences',
  logoUrl,
  tone = 'light',
  size = 'md',
  markOnly = false,
  className = '',
}: BrandLockupProps) {
  const s = SIZES[size];
  const dark = tone === 'dark';

  if (markOnly) {
    return <BrandMark logoUrl={logoUrl} tone={tone} size={size} className={className} />;
  }

  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <BrandMark logoUrl={logoUrl} tone={tone} size={size} />
      <span className="flex flex-col justify-center">
        <span
          className={`font-display font-semibold leading-none tracking-[0.18em] ${s.name} ${
            dark ? 'text-white' : 'text-ink'
          }`}
        >
          {name}
        </span>
        {tagline ? (
          <span
            className={`mt-1 font-medium uppercase leading-none tracking-[0.22em] ${s.tagline} ${
              dark ? 'text-mist' : 'text-teal-dark'
            }`}
          >
            {tagline}
          </span>
        ) : null}
      </span>
    </span>
  );
}
