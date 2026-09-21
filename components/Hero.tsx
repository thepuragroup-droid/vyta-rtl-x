'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import Link from 'next/link';
import { ArrowRight, FileText, FlaskConical, Pause, Play, ShieldCheck, Truck } from 'lucide-react';
import { useSiteConfig } from '@/contexts/SiteConfigContext';
import MapleLeaf, { MAPLE_RED } from '@/components/icons/MapleLeaf';

// ─────────────────────────────────────────────────────────────────────────────
// HERO MEDIA
//
// The clip and the still behind it fill the whole hero, and both are set in
// Admin → Branding & Tracking (`site_settings.hero_video_url` /
// `hero_image_url`), so swapping the hero for a new render is an upload, not a
// deploy. The constants below are only the fallbacks for a store that has
// never set them — and for the first paint, before the config has loaded.
//
// The clip should be a muted ~8–12s seamless loop, H.264 MP4 (or WebM),
// ideally ≤2 MB, with the audio track stripped. The still always renders
// first and stays as the mobile / reduced-motion / slow-connection fallback.
//
// docs/hero-media-prompt.md carries the generation brief for both.
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_HERO_VIDEO_URL =
  'https://didnmcyrxgubgesiaatj.supabase.co/storage/v1/object/public/products/Video%20Project.mp4';

const DEFAULT_HERO_IMAGE = '/images/hero-bg.jpeg';

// Film-grain texture overlay (inline SVG turbulence — no asset needed).
const GRAIN_TEXTURE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/**
 * The frosted ground the copy is read on. It is translucent the whole way
 * across — never a solid plate — and from the 40% mark it thins out in small
 * steps until there is nothing left of it at the far edge.
 *
 * It can afford to be this sheer because the media under it is graded to
 * Midnight Navy: even at 40% white the ground is light enough to hold navy
 * type. A brighter still would need these numbers raised.
 *
 * The tint gradient alone would leave a hard edge where the blur stops, so the
 * same shape is repeated as a mask — `backdrop-filter` is clipped by the
 * element's own alpha, which is what makes the blur itself thin out with the
 * white rather than ending in a line.
 */
const BAND_TINT_X =
  'linear-gradient(90deg, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0.74) 40%, rgba(255,255,255,0.62) 56%, rgba(255,255,255,0.42) 72%, rgba(255,255,255,0.2) 86%, rgba(255,255,255,0) 100%)';
const BAND_MASK_X =
  'linear-gradient(90deg, #000 0%, #000 40%, rgba(0,0,0,0.85) 56%, rgba(0,0,0,0.6) 72%, rgba(0,0,0,0.28) 86%, transparent 100%)';

// Stacked, the copy runs the full width, so the ground thins downward instead
// and hands the frame back above the badge strip. The fade starts lower down
// than it does across: there is copy all the way to the buttons.
const BAND_TINT_Y =
  'linear-gradient(180deg, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0.74) 50%, rgba(255,255,255,0.5) 70%, rgba(255,255,255,0.2) 84%, rgba(255,255,255,0) 94%)';
const BAND_MASK_Y =
  'linear-gradient(180deg, #000 0%, #000 50%, rgba(0,0,0,0.7) 70%, rgba(0,0,0,0.3) 84%, transparent 94%)';

const TRUST_BADGES = [
  { icon: ShieldCheck, label: '99%+\nPurity Guaranteed' },
  { icon: FlaskConical, label: 'Third-Party\nTested' },
  { icon: FileText, label: 'COAs\nAvailable' },
  { icon: MapleLeaf, label: 'Canadian\nCompany', accent: true },
  { icon: Truck, label: 'Free, Fast &\nDiscreet Shipping' },
];

export default function Hero() {
  const prefersReducedMotion = useReducedMotion();
  // Admin-set hero media, falling back to the shipped pair. The provider seeds
  // from DEFAULT_SITE_CONFIG, so the first render is the fallback either way
  // and there is no hydration mismatch — only a crossfade once the real clip
  // is fetched.
  const { config: siteSettings } = useSiteConfig();
  const heroVideoUrl = siteSettings.hero_video_url ?? DEFAULT_HERO_VIDEO_URL;
  const heroImageUrl = siteSettings.hero_image_url ?? DEFAULT_HERO_IMAGE;

  const sectionRef = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [allowVideo, setAllowVideo] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(true);

  // Subtle parallax: the media drifts slower than the page while the content
  // eases upward and dissolves as the hero scrolls out.
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end start'],
  });
  const mediaY = useTransform(scrollYProgress, [0, 1], ['0%', '10%']);
  const contentY = useTransform(scrollYProgress, [0, 1], [0, 60]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.6], [1, 0]);

  // Only load the video on desktop-sized screens with motion allowed — phones
  // and prefers-reduced-motion users get the graded still instead.
  useEffect(() => {
    if (!heroVideoUrl || prefersReducedMotion) {
      setAllowVideo(false);
      return;
    }
    const mq = window.matchMedia('(min-width: 768px)');
    const update = () => setAllowVideo(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [prefersReducedMotion, heroVideoUrl]);

  // A newly-set clip has to fade in on its own terms: without this the old
  // clip's `videoReady` would keep the new <video> visible before it can play.
  useEffect(() => setVideoReady(false), [heroVideoUrl]);

  const toggleVideo = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().catch(() => {});
      setVideoPlaying(true);
    } else {
      el.pause();
      setVideoPlaying(false);
    }
  };

  return (
    <section
      ref={sectionRef}
      className="relative min-h-svh flex flex-col overflow-hidden bg-ink"
    >
      {/* Media layer — graded still first, video crossfades in when ready.
          Oversized vertically so the parallax drift never reveals an edge. */}
      <motion.div
        aria-hidden="true"
        style={prefersReducedMotion ? undefined : { y: mediaY }}
        className="absolute inset-x-0 -inset-y-[8%]"
      >
        <img
          src={heroImageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover hero-still-grade"
        />
        {allowVideo && (
          <video
            // Keyed on the URL so swapping the clip mounts a fresh element
            // rather than leaving the browser on the old buffered source.
            key={heroVideoUrl}
            ref={(el) => {
              videoRef.current = el;
              // React can omit `muted` from server-rendered markup; set it
              // imperatively so autoplay is never blocked.
              if (el) el.muted = true;
            }}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${
              videoReady ? 'opacity-100' : 'opacity-0'
            }`}
            src={heroVideoUrl}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            tabIndex={-1}
            onCanPlay={() => setVideoReady(true)}
          />
        )}
      </motion.div>

      {/* Film grain */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.07] mix-blend-soft-light"
        style={{ backgroundImage: GRAIN_TEXTURE }}
      />

      {/* Scrims — the copy has the frosted band under it, so these only settle
          the media down behind the nav and the badge strip. */}
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-ink/30 via-ink/20 to-ink/10" />
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-ink/45 via-transparent to-ink/55" />

      {/* Frosted band — full height down the left, dissolving into the media
          before it reaches the middle. */}
      <motion.div
        aria-hidden="true"
        style={{
          backgroundImage: BAND_TINT_Y,
          maskImage: BAND_MASK_Y,
          WebkitMaskImage: BAND_MASK_Y,
          ...(prefersReducedMotion ? {} : { opacity: contentOpacity }),
        }}
        className="absolute inset-0 lg:hidden backdrop-blur-2xl"
      />
      <motion.div
        aria-hidden="true"
        style={{
          backgroundImage: BAND_TINT_X,
          maskImage: BAND_MASK_X,
          WebkitMaskImage: BAND_MASK_X,
          ...(prefersReducedMotion ? {} : { opacity: contentOpacity }),
        }}
        className="absolute inset-y-0 left-0 hidden lg:block w-[78%] xl:w-[74%] backdrop-blur-2xl"
      />

      {/* Content */}
      <div className="relative flex-1 flex items-center w-full">
        <motion.div
          style={prefersReducedMotion ? undefined : { y: contentY, opacity: contentOpacity }}
          className="w-full max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 pt-24 sm:pt-32 pb-10 sm:pb-16"
        >
          <div className="grid lg:grid-cols-12">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="lg:col-span-7 xl:col-span-6"
            >
              {/* Vital Blue rather than the eyebrow's default Bio Teal: on a ground
                  this sheer, the lighter teal drops under 3:1. */}
              <p className="text-eyebrow !text-teal-dark mb-3 sm:mb-4">Premium Peptides</p>

              <h1 className="font-display text-4xl sm:text-5xl lg:text-[3.2rem] font-bold text-ink leading-[1.06] mb-4 sm:mb-5">
                A Higher
                <br />
                Standard for
                <br />
                Your Wellness Journey
              </h1>

              <p className="text-base sm:text-lg text-ink/80 leading-relaxed max-w-md mb-7 sm:mb-8">
                Pure compounds. Verified quality. Trusted by a growing community
                across Canada and the US.
              </p>

              <div className="flex flex-col sm:flex-row gap-3">
                <Link href="/products" className="w-full sm:w-auto">
                  <button className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 bg-ink hover:bg-ocean text-white px-7 py-3.5 font-semibold text-sm rounded-full shadow-card transition-colors">
                    Shop Peptides
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </Link>
                <Link href="/lab-results" className="w-full sm:w-auto">
                  <button className="w-full sm:w-auto inline-flex items-center justify-center bg-white hover:bg-surface text-ink border border-line px-7 py-3.5 font-semibold text-sm rounded-full shadow-card transition-colors">
                    View Lab Results
                  </button>
                </Link>
              </div>
            </motion.div>
          </div>
        </motion.div>

        {/* Video pause/play — sits just above the badge strip */}
        {allowVideo && videoReady && (
          <button
            onClick={toggleVideo}
            aria-label={videoPlaying ? 'Pause background video' : 'Play background video'}
            className="absolute bottom-4 right-5 sm:right-8 w-9 h-9 rounded-full bg-white/15 hover:bg-white/30 border border-white/30 backdrop-blur-md text-white/90 hover:text-white flex items-center justify-center transition-colors"
          >
            {videoPlaying ? (
              <Pause className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5 ml-0.5" />
            )}
          </button>
        )}
      </div>

      {/* Trust badges — the promises the storefront is held to, on a frosted
          strip along the hero's base */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
        className="relative border-t border-white/40 bg-white/75 backdrop-blur-md"
      >
        <ul className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 py-4 sm:py-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-5 sm:gap-y-6">
          {TRUST_BADGES.map(({ icon: Icon, label, accent }, i) => (
            <li
              key={label}
              // Five badges in two columns leave the last one stranded in a
              // half-empty row, so on a phone it takes the whole width.
              className={`flex flex-col items-center text-center gap-1.5 sm:gap-2 ${
                i === TRUST_BADGES.length - 1 ? 'col-span-2 sm:col-span-1' : ''
              }`}
            >
              <Icon
                className="w-5 h-5 sm:w-7 sm:h-7 text-ink"
                style={accent ? { color: MAPLE_RED } : undefined}
                strokeWidth={1.5}
              />
              <span className="text-[10px] sm:text-xs font-medium text-ink leading-snug whitespace-pre-line">
                {label}
              </span>
            </li>
          ))}
        </ul>
      </motion.div>
    </section>
  );
}
