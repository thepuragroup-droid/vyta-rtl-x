'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import {
  FlaskConical,
  ShieldCheck,
  FileCheck,
  MapPin,
  ArrowRight,
  Pause,
  Play,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// LAB EXHIBIT VIDEO — paste the hosted video URL here when the render is ready.
//
//   const LAB_VIDEO_URL = 'https://cdn.example.com/one-clean-peak.mp4';
//
// Leave as '' to run the panel on the animated chromatogram placeholder. The
// clip should be a muted ~8–12s seamless loop, H.264 MP4 (or WebM), ideally
// ≤2 MB, audio stripped. It only loads on desktop, starts when scrolled into
// view, and pauses off-screen — the chromatogram stays as the poster layer and
// the mobile / reduced-motion fallback.
// ─────────────────────────────────────────────────────────────────────────────
const LAB_VIDEO_URL =
  'https://swpcvpkcfxihxmjpjqow.supabase.co/storage/v1/object/public/products/Multi-Shot_Video_-_Extreme_macro_on_a_dark_laboratory_monitor_a_thin_glowing_bronze-gold_line_slowly.mp4';

// The "one clean peak" HPLC trace: flat baseline with faint blips, one sharp
// peak right-of-center — the visual shape of a 99%+ purity claim.
const TRACE_D =
  'M 0 380 L 110 380 L 126 373 L 142 380 L 250 380 L 262 376 L 274 380 L 452 380 ' +
  'C 478 380 492 74 512 74 C 532 74 546 380 572 380 L 640 380 L 652 375 L 664 380 L 800 380';

const pillars = [
  {
    icon: ShieldCheck,
    title: 'Independent Lab Tested',
    description: 'Every compound is HPLC-UV purity tested by an accredited third-party lab, PPB Analytical Inc.',
  },
  {
    icon: FileCheck,
    title: 'COA on Every Order',
    description: 'A Certificate of Analysis backs each product — browse and verify the reports before you buy.',
  },
  {
    icon: MapPin,
    title: 'Canadian Supplier',
    description: 'Sourced and shipped from Canada, with documentation you can actually inspect.',
  },
];

export default function LabResultsShowcase() {
  const prefersReducedMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const userPausedRef = useRef(false);

  const [allowVideo, setAllowVideo] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);

  // Same gating as the hero: URL present, desktop-sized screen, motion allowed.
  useEffect(() => {
    if (!LAB_VIDEO_URL || prefersReducedMotion) {
      setAllowVideo(false);
      return;
    }
    const mq = window.matchMedia('(min-width: 768px)');
    const update = () => setAllowVideo(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [prefersReducedMotion]);

  // Only play while the panel is actually on screen (and the user hasn't
  // paused it) — the homepage never runs two background videos at once.
  useEffect(() => {
    if (!allowVideo) return;
    const panel = panelRef.current;
    if (!panel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const el = videoRef.current;
        if (!el) return;
        if (entry.isIntersecting) {
          if (!userPausedRef.current) {
            el.play().catch(() => {});
            setVideoPlaying(true);
          }
        } else {
          el.pause();
          setVideoPlaying(false);
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(panel);
    return () => observer.disconnect();
  }, [allowVideo]);

  const toggleVideo = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      userPausedRef.current = false;
      el.play().catch(() => {});
      setVideoPlaying(true);
    } else {
      userPausedRef.current = true;
      el.pause();
      setVideoPlaying(false);
    }
  };

  return (
    <section id="lab-results" className="py-16 sm:py-24 bg-ink text-white scroll-mt-[104px] overflow-hidden">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left — copy, proof pillars, CTA */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-bronze/20 border border-bronze/30 rounded-full mb-4">
              <FlaskConical className="w-3.5 h-3.5 text-bronze" />
              <span className="text-xs font-medium text-bronze">Third-Party Verified</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 leading-tight">
              We Show Our Work
            </h2>
            <p className="text-white/60 leading-relaxed">
              Anyone can claim 99% purity. We publish the third-party HPLC reports
              behind every batch — so you can check the numbers yourself before you buy.
            </p>

            <div className="mt-8 sm:mt-10 space-y-5">
              {pillars.map((pillar, index) => (
                <motion.div
                  key={pillar.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-start gap-3.5"
                >
                  <div className="w-11 h-11 bg-bronze/20 rounded-xl flex items-center justify-center flex-shrink-0">
                    <pillar.icon className="w-5 h-5 text-bronze" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white text-base mb-0.5">{pillar.title}</h3>
                    <p className="text-sm text-white/60 leading-relaxed">{pillar.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            <div className="mt-10">
              <Link
                href="/lab-results"
                className="inline-flex items-center gap-2 px-6 py-3 bg-bronze hover:bg-bronze-light text-ink font-semibold rounded-xl transition-colors"
              >
                Explore Lab Results
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </motion.div>

          {/* Right — the evidence panel */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="relative"
          >
            {/* Bronze corner ticks — "exhibit" framing */}
            <span aria-hidden="true" className="absolute -top-2 -left-2 w-5 h-5 border-t-2 border-l-2 border-bronze/50 rounded-tl-sm" />
            <span aria-hidden="true" className="absolute -top-2 -right-2 w-5 h-5 border-t-2 border-r-2 border-bronze/50 rounded-tr-sm" />
            <span aria-hidden="true" className="absolute -bottom-2 -left-2 w-5 h-5 border-b-2 border-l-2 border-bronze/50 rounded-bl-sm" />
            <span aria-hidden="true" className="absolute -bottom-2 -right-2 w-5 h-5 border-b-2 border-r-2 border-bronze/50 rounded-br-sm" />

            <div
              ref={panelRef}
              className="relative rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden"
            >
              <Link href="/lab-results" aria-label="Explore lab results" className="group block">
                <div className="relative aspect-video overflow-hidden">
                  {/* Chromatogram placeholder — a purity trace drawing itself */}
                  <svg
                    viewBox="0 0 800 450"
                    preserveAspectRatio="xMidYMid slice"
                    className="absolute inset-0 w-full h-full"
                    aria-hidden="true"
                  >
                    {Array.from({ length: 9 }).map((_, i) => (
                      <line
                        key={`v${i}`}
                        x1={(i + 1) * 80}
                        y1="0"
                        x2={(i + 1) * 80}
                        y2="450"
                        stroke="white"
                        strokeOpacity="0.04"
                      />
                    ))}
                    {Array.from({ length: 5 }).map((_, i) => (
                      <line
                        key={`h${i}`}
                        x1="0"
                        y1={(i + 1) * 75}
                        x2="800"
                        y2={(i + 1) * 75}
                        stroke="white"
                        strokeOpacity="0.04"
                      />
                    ))}
                    <line x1="0" y1="382" x2="800" y2="382" stroke="white" strokeOpacity="0.08" />
                    <path
                      d={TRACE_D}
                      pathLength={1}
                      fill="none"
                      stroke="#B8A876"
                      strokeWidth="7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="animate-chromatogram opacity-30 blur-[4px]"
                    />
                    <path
                      d={TRACE_D}
                      pathLength={1}
                      fill="none"
                      stroke="#9C8B5A"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="animate-chromatogram"
                    />
                  </svg>

                  {allowVideo && (
                    <video
                      ref={(el) => {
                        videoRef.current = el;
                        if (el) el.muted = true;
                      }}
                      className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${
                        videoReady ? 'opacity-100' : 'opacity-0'
                      }`}
                      src={LAB_VIDEO_URL}
                      muted
                      loop
                      playsInline
                      preload="none"
                      tabIndex={-1}
                      onPlaying={() => setVideoReady(true)}
                    />
                  )}

                  <div className="absolute inset-0 bg-bronze/0 group-hover:bg-bronze/5 transition-colors" />
                </div>
              </Link>

              {/* Caption bar — the exhibit label */}
              <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-t border-white/10 bg-white/[0.04]">
                <span className="inline-flex items-center gap-2 text-[10px] sm:text-[11px] uppercase tracking-[0.15em] text-white/50">
                  <FlaskConical className="w-3.5 h-3.5 text-bronze flex-shrink-0" />
                  HPLC-UV · PPB Analytical Inc.
                </span>
                <span className="text-[10px] sm:text-[11px] font-semibold text-bronze-light tabular-nums whitespace-nowrap">
                  99%+ Verified
                </span>
              </div>

              {allowVideo && videoReady && (
                <button
                  onClick={toggleVideo}
                  aria-label={videoPlaying ? 'Pause lab video' : 'Play lab video'}
                  className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-ink/50 hover:bg-ink/70 border border-white/20 backdrop-blur-md text-white/80 hover:text-white flex items-center justify-center transition-colors"
                >
                  {videoPlaying ? (
                    <Pause className="w-3 h-3" />
                  ) : (
                    <Play className="w-3 h-3 ml-0.5" />
                  )}
                </button>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
