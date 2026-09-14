'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import Link from 'next/link';
import {
  ArrowRight,
  Award,
  Beaker,
  FileCheck,
  MapPin,
  Microscope,
  Pause,
  Play,
  ShieldCheck,
  ShoppingCart,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { siteConfig } from '@/lib/config';
import { casePriceFor, vialPriceFor } from '@/lib/pricing';
import { usePurchaseModal } from '@/contexts/PurchaseModalContext';
import { productPath } from '@/lib/products/url';

// ─────────────────────────────────────────────────────────────────────────────
// HERO VIDEO — paste the hosted video URL here when the render is ready.
//
//   const HERO_VIDEO_URL = '/videos/hero.mp4';           (file in /public/videos)
//   const HERO_VIDEO_URL = 'https://cdn.example.com/clarity.mp4';
//
// Leave as '' to run the hero on the graded still image only. The clip should
// be a muted ~8–12s seamless loop, H.264 MP4 (or WebM), ideally ≤2 MB, with
// the audio track stripped. The still below always renders first and stays as
// the mobile / reduced-motion / slow-connection fallback.
// ─────────────────────────────────────────────────────────────────────────────
const HERO_VIDEO_URL =
  'https://didnmcyrxgubgesiaatj.supabase.co/storage/v1/object/public/products/Video%20Project.mp4';

const HERO_FALLBACK_IMAGE = '/images/hero-bg.jpeg';

// Film-grain texture overlay (inline SVG turbulence — no asset needed).
const GRAIN_TEXTURE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

interface Product {
  id: string;
  name: string;
  slug: string;
  url_slug?: string | null;
  description_short: string | null;
  price: number;
  vial_price: number | null;
  purity: string | null;
  strength: string | null;
  image_url: string | null;
  box_image_url: string | null;
  stock_quantity: number;
  vials_per_box: number | null;
}

const TICKER_CLAIMS = [
  'HPLC-UV tested — PPB Analytical Inc.',
  'Full COA on every order',
  'GMP certified facilities',
  'Canadian supplier — ships from Canada',
  '50+ research compounds',
  '24h order processing',
];

const TRUST_CHIPS = [
  { icon: ShieldCheck, label: 'GMP Certified' },
  { icon: Microscope, label: 'HPLC Tested' },
  { icon: Award, label: '99%+ Purity' },
];

export default function Hero() {
  const { openPurchaseModal } = usePurchaseModal();
  const prefersReducedMotion = useReducedMotion();

  const sectionRef = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [featured, setFeatured] = useState<Product[]>([]);
  const [productLoading, setProductLoading] = useState(true);
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
    if (!HERO_VIDEO_URL || prefersReducedMotion) {
      setAllowVideo(false);
      return;
    }
    const mq = window.matchMedia('(min-width: 768px)');
    const update = () => setAllowVideo(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [prefersReducedMotion]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    async function fetchFeatured() {
      try {
        const { data } = await supabase
          .from('products')
          .select(
            'id, name, slug, description_short, price, vial_price, purity, strength, image_url, box_image_url, stock_quantity, vials_per_box',
          )
          .eq('active', true)
          .eq('featured', true)
          .gt('stock_quantity', 0)
          .order('price', { ascending: false })
          .limit(8)
          .abortSignal(controller.signal);
        if (data) setFeatured(data);
      } catch {
        // timed out or failed — the hero falls back to the static trust panel
      } finally {
        clearTimeout(timer);
        setProductLoading(false);
      }
    }
    fetchFeatured();
    return () => controller.abort();
  }, []);

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

  const scrollToLab = () => {
    document.getElementById('lab-results')?.scrollIntoView({ block: 'start' });
  };

  const product = featured[0] ?? null;
  const tickerItems = [
    ...TICKER_CLAIMS,
    ...featured
      .filter((p) => p.purity)
      .map((p) => `${p.name} — ${p.purity} verified`),
  ];

  return (
    <section
      ref={sectionRef}
      className="relative min-h-svh flex items-center overflow-hidden bg-ink text-white"
    >
      {/* Media layer — graded still first, video crossfades in when ready.
          Oversized vertically so the parallax drift never reveals an edge. */}
      <motion.div
        aria-hidden="true"
        style={prefersReducedMotion ? undefined : { y: mediaY }}
        className="absolute inset-x-0 -inset-y-[8%]"
      >
        <img
          src={HERO_FALLBACK_IMAGE}
          alt=""
          className="absolute inset-0 w-full h-full object-cover hero-still-grade"
        />
        {allowVideo && (
          <video
            ref={(el) => {
              videoRef.current = el;
              // React can omit `muted` from server-rendered markup; set it
              // imperatively so autoplay is never blocked.
              if (el) el.muted = true;
            }}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${
              videoReady ? 'opacity-100' : 'opacity-0'
            }`}
            src={HERO_VIDEO_URL}
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

      {/* Scrims — heavier on the left (text side), top (nav) and bottom (ticker) */}
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-ink/95 via-ink/65 to-ink/35" />
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-ink/70 via-transparent to-ink/85" />

      {/* Content */}
      <motion.div
        style={prefersReducedMotion ? undefined : { y: contentY, opacity: contentOpacity }}
        className="relative z-10 w-full max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 pt-32 sm:pt-36 pb-24 sm:pb-28"
      >
        <div className="grid lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          {/* Left — headline, CTAs, trust chips */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="lg:col-span-7"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-teal/20 border border-teal/30 rounded-full mb-4 sm:mb-6">
              <Beaker className="w-3.5 h-3.5 text-teal-light flex-shrink-0" />
              <span className="text-[10px] sm:text-xs font-medium text-teal-light">
                Pharmaceutical Grade Research
              </span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold mb-4 sm:mb-6 leading-[1.05] tracking-tight text-white">
              Advanced
              <br />
              Peptide Research
            </h1>

            <p className="text-base sm:text-lg text-white/70 mb-6 sm:mb-8 max-w-lg leading-relaxed">
              HPLC-verified peptides with 99%+ purity for scientific research.
              Each batch independently tested with full Certificate of Analysis.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mb-8 sm:mb-10">
              <Link href="/products" className="w-full sm:w-auto">
                <button className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white hover:bg-white/90 text-ink px-6 sm:px-7 py-3.5 sm:py-4 font-semibold text-sm rounded-xl transition-all">
                  Browse Catalog
                  <ArrowRight className="w-4 h-4" />
                </button>
              </Link>
              <Link href="/lab-results" className="w-full sm:w-auto">
                <button className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white/5 hover:bg-white/15 text-white border border-white/25 backdrop-blur-sm px-6 sm:px-7 py-3.5 sm:py-4 font-medium text-sm rounded-xl transition-colors">
                  View Lab Results
                </button>
              </Link>
            </div>

            {/* Interactive trust chips — jump to the lab documentation section */}
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
              {TRUST_CHIPS.map(({ icon: Icon, label }) => (
                <button
                  key={label}
                  onClick={scrollToLab}
                  aria-label={`${label} — view lab documentation`}
                  className="group inline-flex items-center gap-2 pl-2 pr-3.5 py-1.5 rounded-full bg-white/[0.07] hover:bg-white/[0.14] border border-white/15 backdrop-blur-md transition-all hover:-translate-y-0.5"
                >
                  <span className="w-6 h-6 rounded-full bg-teal/20 flex items-center justify-center">
                    <Icon className="w-3.5 h-3.5 text-teal-light" />
                  </span>
                  <span className="text-[10px] sm:text-xs font-medium text-white/80 group-hover:text-white transition-colors">
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </motion.div>

          {/* Right — live featured compound in a glass card */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.35 }}
            className="lg:col-span-5 w-full max-w-sm mx-auto lg:mx-0 lg:ml-auto"
          >
            {productLoading ? (
              <div className="backdrop-blur-xl bg-white/[0.08] border border-white/15 rounded-2xl shadow-2xl shadow-black/40 p-4 sm:p-5 animate-pulse">
                <div className="h-5 bg-white/10 rounded-full w-36 mb-4" />
                <div className="bg-white/10 rounded-xl aspect-[4/3] mb-4" />
                <div className="h-4 bg-white/10 rounded w-3/4 mb-2" />
                <div className="h-3 bg-white/10 rounded w-1/3 mb-4" />
                <div className="h-9 bg-white/10 rounded-lg w-full" />
              </div>
            ) : product ? (
              <div className="backdrop-blur-xl bg-white/[0.08] border border-white/15 rounded-2xl shadow-2xl shadow-black/40 p-4 sm:p-5">
                <div className="flex items-center justify-between gap-2 mb-4">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-teal/20 border border-teal/30 rounded-full text-[10px] font-medium text-teal-light">
                    <Beaker className="w-3 h-3" />
                    Featured Compound
                  </span>
                  {product.purity && (
                    <span className="text-[10px] font-semibold text-teal-light bg-teal/15 border border-teal/30 px-2 py-0.5 rounded-full">
                      {product.purity}
                    </span>
                  )}
                </div>

                <Link href={productPath(product)} className="group block">
                  <div className="relative bg-white/95 rounded-xl aspect-[4/3] p-4 mb-4 overflow-hidden">
                    {product.image_url ? (
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Beaker className="w-12 h-12 text-line" />
                      </div>
                    )}
                  </div>
                  <h3 className="font-semibold text-white group-hover:text-white/80 transition-colors line-clamp-1">
                    {product.name}
                  </h3>
                </Link>
                {product.strength && (
                  <p className="text-xs text-white/50 mt-0.5">{product.strength}</p>
                )}

                <div className="flex items-end justify-between gap-2 mt-3">
                  {product.price > 0 ? (
                    <span className="flex flex-col leading-tight">
                      <span className="text-xl font-bold text-white tabular-nums">
                        ${vialPriceFor(product).toFixed(2)}
                        <span className="text-[10px] font-medium text-white/50"> / vial</span>
                      </span>
                      <span className="text-[10px] text-white/50 tabular-nums">
                        Pack of {product.vials_per_box ?? 10} · $
                        {casePriceFor(product).toFixed(2)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-lg font-bold text-white/50">N/A</span>
                  )}
                  {siteConfig.ecommerceEnabled && product.price > 0 && (
                    <button
                      onClick={() => openPurchaseModal(product)}
                      aria-label={`Add ${product.name} to cart`}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-teal hover:bg-teal-light text-ink text-xs font-semibold rounded-lg transition-colors"
                    >
                      <ShoppingCart className="w-3.5 h-3.5" />
                      Add
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 mt-4 pt-3 border-t border-white/10 text-[10px] text-white/40">
                  <FileCheck className="w-3 h-3 text-teal-light flex-shrink-0" />
                  COA verified — PPB Analytical Inc.
                </div>
              </div>
            ) : (
              <div className="backdrop-blur-xl bg-white/[0.08] border border-white/15 rounded-2xl shadow-2xl shadow-black/40 p-5 sm:p-6 space-y-5">
                {[
                  {
                    icon: Award,
                    title: '99%+ Purity',
                    sub: 'HPLC-UV verified on every batch',
                  },
                  {
                    icon: FileCheck,
                    title: 'COA on Every Order',
                    sub: 'Published third-party lab reports',
                  },
                  {
                    icon: MapPin,
                    title: 'Canadian Supplier',
                    sub: 'Sourced and shipped from Canada',
                  },
                ].map(({ icon: Icon, title, sub }) => (
                  <div key={title} className="flex items-center gap-3.5">
                    <div className="w-11 h-11 bg-teal/20 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Icon className="w-5 h-5 text-teal-light" />
                    </div>
                    <div>
                      <p className="font-semibold text-white text-sm">{title}</p>
                      <p className="text-xs text-white/50">{sub}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </div>
      </motion.div>

      {/* Video pause/play — sits just above the ticker */}
      {allowVideo && videoReady && (
        <button
          onClick={toggleVideo}
          aria-label={videoPlaying ? 'Pause background video' : 'Play background video'}
          className="absolute bottom-16 right-5 sm:right-8 z-20 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 backdrop-blur-md text-white/80 hover:text-white flex items-center justify-center transition-colors"
        >
          {videoPlaying ? (
            <Pause className="w-3.5 h-3.5" />
          ) : (
            <Play className="w-3.5 h-3.5 ml-0.5" />
          )}
        </button>
      )}

      {/* Purity ticker — live batch results scrolling along the hero's base */}
      <div
        aria-hidden="true"
        className="absolute bottom-0 inset-x-0 z-10 border-t border-white/10 bg-ink/40 backdrop-blur-sm overflow-hidden"
      >
        <div className="flex w-max whitespace-nowrap animate-ticker py-3">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex items-center">
              {tickerItems.map((item, i) => (
                <span
                  key={`${copy}-${i}`}
                  className="flex items-center text-[10px] sm:text-[11px] font-medium uppercase tracking-[0.15em] text-white/45"
                >
                  {item}
                  <span className="mx-5 sm:mx-8 text-teal-light/60">•</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
