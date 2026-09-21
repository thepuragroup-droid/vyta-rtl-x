'use client';

import React, { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { ArrowRight, FileText, FlaskConical, ShieldCheck, Truck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSiteConfig } from '@/contexts/SiteConfigContext';

// ─────────────────────────────────────────────────────────────────────────────
// HERO MEDIA
//
// The hero is a light, split layout: the promise on the left, the product on
// the right. The right-hand visual is still admin-controlled — both the clip
// and the still come from Admin → Branding & Tracking
// (`site_settings.hero_video_url` / `hero_image_url`), so swapping the first
// screen of the site is an upload, not a deploy.
//
// With neither set, the stage falls back to the live featured compound's own
// vial render, which is the shot the reference layout is built around. The
// clip should be a muted ~8–12s seamless loop, H.264 MP4 (or WebM), ideally
// ≤2 MB, with the audio track stripped; the still always renders first and
// stays as the mobile / reduced-motion / slow-connection fallback.
//
// docs/hero-media-prompt.md carries the generation brief for both.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Light wash behind the whole hero: white under the copy, easing into a soft
 * Aqua/Mist bloom under the product so the vial sits in light rather than on a
 * flat panel.
 */
const HERO_WASH =
  'radial-gradient(46rem 34rem at 76% 40%, rgba(110, 178, 184, 0.20) 0%, transparent 70%), ' +
  'radial-gradient(34rem 26rem at 98% 92%, rgba(187, 214, 214, 0.30) 0%, transparent 72%), ' +
  'linear-gradient(112deg, #FFFFFF 0%, #FFFFFF 40%, #F3F9FA 70%, #E4F0F3 100%)';

/** Canadian maple leaf — the one badge the lucide set has no glyph for. */
function MapleLeaf(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="none">
      <path d="M12 2l1.4 3.6 2.6-1-.8 3.6 3.4-.8-.8 2.6 3.8.6-2.2 2 1.6 1.8-4.8.8.4 2.2-3.7-.8V22h-1.8v-5.4l-3.7.8.4-2.2-4.8-.8 1.6-1.8-2.2-2 3.8-.6-.8-2.6 3.4.8-.8-3.6 2.6 1L12 2z" />
    </svg>
  );
}

const TRUST_BADGES = [
  { icon: ShieldCheck, label: '99%+\nPurity Guaranteed' },
  { icon: FlaskConical, label: 'Third-Party\nTested' },
  { icon: FileText, label: 'COAs\nAvailable' },
  { icon: MapleLeaf, label: 'Canadian\nCompany', accent: true },
  { icon: Truck, label: 'Free, Fast &\nDiscreet Shipping' },
];

export default function Hero() {
  const prefersReducedMotion = useReducedMotion();
  // Admin-set hero media. The provider seeds from DEFAULT_SITE_CONFIG, so the
  // first render is the fallback either way and there is no hydration
  // mismatch — only a crossfade once the real media is fetched.
  const { config: siteSettings } = useSiteConfig();
  const heroVideoUrl = siteSettings.hero_video_url;
  const heroImageUrl = siteSettings.hero_image_url;

  const [featuredImage, setFeaturedImage] = useState<string | null>(null);
  const [allowVideo, setAllowVideo] = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  // An admin still is a framed photograph, so it fills the stage; a product
  // render is a cut-out on white, so it floats inside it.
  const stillUrl = heroImageUrl ?? featuredImage;
  const stillIsProductShot = !heroImageUrl && !!featuredImage;

  // Only load the video on desktop-sized screens with motion allowed — phones
  // and prefers-reduced-motion users get the still instead.
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

  // The fallback vial: the highest-priced featured compound in stock, which is
  // the same shot the storefront leads with elsewhere.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    async function fetchFeaturedImage() {
      try {
        const { data } = await supabase
          .from('products')
          .select('image_url')
          .eq('active', true)
          .eq('featured', true)
          .gt('stock_quantity', 0)
          .not('image_url', 'is', null)
          .order('price', { ascending: false })
          .limit(1)
          .abortSignal(controller.signal);
        if (data?.[0]?.image_url) setFeaturedImage(data[0].image_url);
      } catch {
        // timed out or failed — the stage falls back to the brand mark
      } finally {
        clearTimeout(timer);
      }
    }
    fetchFeaturedImage();
    return () => controller.abort();
  }, []);

  return (
    <section className="relative overflow-hidden bg-white" style={{ backgroundImage: HERO_WASH }}>
      <div className="relative max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 pt-28 sm:pt-32 pb-10 sm:pb-12">
        <div className="grid lg:grid-cols-12 gap-8 lg:gap-10 items-center">
          {/* Left — eyebrow, headline, promise, CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="lg:col-span-6 order-2 lg:order-1"
          >
            <p className="text-eyebrow mb-3 sm:mb-4">Premium Peptides</p>

            <h1 className="font-display text-4xl sm:text-5xl lg:text-[3.4rem] font-bold text-ink leading-[1.06] mb-4 sm:mb-5">
              A Higher
              <br />
              Standard for
              <br />
              Your Wellness Journey
            </h1>

            <p className="text-base sm:text-lg text-ink-muted leading-relaxed max-w-md mb-7 sm:mb-8">
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
                <button className="w-full sm:w-auto inline-flex items-center justify-center bg-white hover:bg-surface text-ink border border-line px-7 py-3.5 font-semibold text-sm rounded-full transition-colors">
                  View Lab Results
                </button>
              </Link>
            </div>
          </motion.div>

          {/* Right — the product stage */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="lg:col-span-6 order-1 lg:order-2"
          >
            <div className="relative mx-auto lg:mx-0 lg:-mr-6 xl:-mr-10 aspect-[4/3] sm:aspect-[16/11] max-w-[22rem] sm:max-w-md lg:max-w-none">
              {/* Light bloom the vial stands in */}
              <div
                aria-hidden="true"
                className="absolute inset-0 rounded-[2rem] bg-[radial-gradient(60%_60%_at_50%_45%,rgba(255,255,255,0.95)_0%,rgba(241,248,249,0.6)_55%,transparent_100%)]"
              />

              {stillUrl ? (
                <img
                  src={stillUrl}
                  alt=""
                  className={
                    stillIsProductShot
                      ? 'absolute inset-0 w-full h-full object-contain drop-shadow-[0_28px_45px_rgba(7,32,58,0.18)]'
                      : 'absolute inset-0 w-full h-full object-cover rounded-[2rem]'
                  }
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="absolute inset-0 rounded-[2rem] bg-brand-gradient-soft border border-line/70 flex items-center justify-center"
                >
                  <img src="/images/vyta-mark.png" alt="" className="w-24 h-24 object-contain opacity-70" />
                </div>
              )}

              {allowVideo && (
                <video
                  // Keyed on the URL so swapping the clip mounts a fresh
                  // element rather than leaving the browser on the old
                  // buffered source.
                  key={heroVideoUrl}
                  ref={(el) => {
                    // React can omit `muted` from server-rendered markup; set
                    // it imperatively so autoplay is never blocked.
                    if (el) el.muted = true;
                  }}
                  className={`absolute inset-0 w-full h-full object-cover rounded-[2rem] transition-opacity duration-1000 ${
                    videoReady ? 'opacity-100' : 'opacity-0'
                  }`}
                  src={heroVideoUrl ?? undefined}
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  tabIndex={-1}
                  aria-hidden="true"
                  onCanPlay={() => setVideoReady(true)}
                />
              )}
            </div>
          </motion.div>
        </div>

        {/* Trust badges — the promises the storefront is held to */}
        <motion.ul
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-10 sm:mt-12 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-8"
        >
          {TRUST_BADGES.map(({ icon: Icon, label, accent }) => (
            <li key={label} className="flex flex-col items-center text-center gap-2.5">
              <Icon
                className={`w-7 h-7 ${accent ? 'text-[#D52B1E]' : 'text-ink'}`}
                strokeWidth={1.5}
              />
              <span className="text-[11px] sm:text-xs font-medium text-ink leading-snug whitespace-pre-line">
                {label}
              </span>
            </li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}
