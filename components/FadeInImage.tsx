'use client';

import React, { useState } from 'react';

interface FadeInImageProps {
  src: string;
  alt: string;
  /** Classes applied to the <img> element (e.g. `object-cover w-full h-full`). */
  className?: string;
}

/**
 * A thin <img> wrapper that renders a pulsing skeleton (absolute inset-0, so
 * the parent MUST be positioned) until the image decodes, then cross-fades the
 * image in via an opacity transition on onLoad.
 *
 * The rest of the codebase renders product images with a plain <img> straight
 * from Supabase Storage, so this stays consistent (no next/image optimizer /
 * remotePatterns dependency) while eliminating pop-in on image-heavy grids.
 */
export default function FadeInImage({ src, alt, className = '' }: FadeInImageProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <>
      {!loaded && (
        <div className="absolute inset-0 bg-surface animate-pulse" aria-hidden="true" />
      )}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        className={`${className} transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
    </>
  );
}
