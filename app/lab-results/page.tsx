'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  FlaskConical,
  ShieldCheck,
  Search,
  Beaker,
  FileText,
  Hash,
  Calendar,
  Microscope,
  ExternalLink,
  ArrowRight,
} from 'lucide-react';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import FadeInImage from '@/components/FadeInImage';
import { useSmartLoad } from '@/lib/hooks/useSmartLoad';
import { SlowLoadingNotice, LoadingError } from '@/components/LoadingFeedback';
import { productPath } from '@/lib/products/url';
import { trackActivity } from '@/lib/customer/activity';

interface CoveredProduct {
  id: string;
  name: string;
  slug: string | null;
  url_slug?: string | null;
  strength: string | null;
  category: string | null;
  image_url: string | null;
  box_image_url: string | null;
}

interface LabResult {
  id: string;
  report_url: string;
  product_name: string;
  lab: string;
  sample_id: string | null;
  compound: string | null;
  cas_number: string | null;
  purity_pct: number | null;
  method: string;
  matrix: string | null;
  receiving_date: string | null;
  registration_date: string | null;
  report_date: string | null;
  active: boolean;
  products: CoveredProduct[];
}

// Split a "; "-separated compound string into trimmed parts, dropping empties.
function parseCompounds(s: string | null): string[] {
  if (!s) return [];
  return s
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean);
}

// Format a plain YYYY-MM-DD WITHOUT constructing a Date (avoids UTC shifting
// the day) → "Mar 27, 2026".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const month = MONTHS[parseInt(mo, 10) - 1];
  if (!month) return iso;
  return `${month} ${parseInt(d, 10)}, ${y}`;
}

// Map purity to a text colour for an at-a-glance quality read.
function purityTone(pct: number | null): string {
  if (pct === null || pct === undefined) return 'text-ink-muted';
  if (pct >= 99) return 'text-emerald-600';
  if (pct >= 97) return 'text-teal-dark';
  return 'text-amber-600';
}

export default function LabResultsPage() {
  const { data, loading, slow, error, reload } = useSmartLoad<{ labResults: LabResult[] }>(
    '/api/lab-results',
  );
  const labResults = useMemo(() => data?.labResults ?? [], [data]);

  const [query, setQuery] = useState('');
  const [selectedCompound, setSelectedCompound] = useState<string | null>(null);

  // Deep-link support: /lab-results?q=<product> pre-filters to that product
  // (used by the "Lab Results" buttons on the product cards / detail page).
  // Read from window rather than useSearchParams to avoid a Suspense boundary
  // and keep the page statically prerenderable.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) setQuery(q);
  }, []);

  // Headline stats.
  const stats = useMemo(() => {
    const withPurity = labResults.filter((l) => l.purity_pct !== null && l.purity_pct !== undefined);
    const avgPurity = withPurity.length
      ? withPurity.reduce((sum, l) => sum + (l.purity_pct as number), 0) / withPurity.length
      : null;
    const productIds = new Set<string>();
    labResults.forEach((l) => l.products.forEach((p) => productIds.add(p.id)));
    return {
      reports: labResults.length,
      avgPurity,
      productsCovered: productIds.size,
    };
  }, [labResults]);

  // Compound filter pills — blends contribute each of their constituents.
  const compoundOptions = useMemo(() => {
    const counts = new Map<string, number>();
    labResults.forEach((l) => {
      parseCompounds(l.compound).forEach((c) => {
        counts.set(c, (counts.get(c) ?? 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  }, [labResults]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return labResults.filter((l) => {
      if (selectedCompound) {
        const compounds = parseCompounds(l.compound);
        if (!compounds.includes(selectedCompound)) return false;
      }
      if (q) {
        const haystack = [
          l.product_name,
          l.compound ?? '',
          l.sample_id ?? '',
          ...l.products.map((p) => p.name),
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [labResults, query, selectedCompound]);

  return (
    <main className="min-h-screen bg-surface">
      <Navigation />

      {/* Spacer for the fixed nav. */}
      <div className="h-[104px]" />

      {/* Hero */}
      <section className="bg-white border-b border-line">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 py-12 sm:py-16">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="max-w-2xl"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-teal/10 border border-teal/20 rounded-full mb-4">
              <ShieldCheck className="w-3.5 h-3.5 text-teal-dark" />
              <span className="text-xs font-medium text-teal-dark">Third-Party Verified</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-ink mb-3">Lab Results</h1>
            <p className="text-ink-muted leading-relaxed">
              Independent HPLC-UV purity reports from PPB Analytical Inc. Browse the Certificates of
              Analysis behind our compounds and verify the numbers for yourself.
            </p>
          </motion.div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 sm:gap-6 mt-8 max-w-xl">
            <Stat label="Reports" value={loading ? '—' : String(stats.reports)} />
            <Stat
              label="Avg. Purity"
              value={loading || stats.avgPurity === null ? '—' : `${stats.avgPurity.toFixed(1)}%`}
            />
            <Stat
              label="Products Covered"
              value={loading ? '—' : String(stats.productsCovered)}
            />
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 py-8 sm:py-12">
        {slow && <SlowLoadingNotice onReload={reload} />}

        {error ? (
          <LoadingError message={error} onRetry={reload} />
        ) : (
          <>
            {/* Search + result count */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between mb-5">
              <div className="relative w-full sm:max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search reports, compounds, sample IDs…"
                  className="w-full pl-10 pr-4 py-2.5 bg-white rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-teal/40 text-sm text-ink"
                />
              </div>
              {!loading && (
                <p className="text-sm text-ink-muted whitespace-nowrap">
                  {filtered.length} {filtered.length === 1 ? 'report' : 'reports'}
                </p>
              )}
            </div>

            {/* Compound filter pills */}
            {compoundOptions.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-6">
                <Pill
                  active={selectedCompound === null}
                  onClick={() => setSelectedCompound(null)}
                  label="All"
                />
                {compoundOptions.map((c) => (
                  <Pill
                    key={c.name}
                    active={selectedCompound === c.name}
                    onClick={() =>
                      setSelectedCompound((cur) => (cur === c.name ? null : c.name))
                    }
                    label={c.name}
                    count={c.count}
                  />
                ))}
              </div>
            )}

            {/* Grid */}
            {loading ? (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState hasReports={labResults.length > 0} />
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filtered.map((lab, index) => (
                  <ReportCard key={lab.id} lab={lab} index={index} />
                ))}
              </div>
            )}

            {/* Trust strip */}
            <div className="mt-12 bg-white border border-line rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center gap-4 sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-teal/10 rounded-xl flex items-center justify-center flex-shrink-0">
                  <ShieldCheck className="w-5 h-5 text-teal-dark" />
                </div>
                <div>
                  <h3 className="font-semibold text-ink text-sm mb-0.5">
                    Every batch, independently verified
                  </h3>
                  <p className="text-sm text-ink-muted">
                    Reports are issued by PPB Analytical Inc., an accredited third-party lab.
                  </p>
                </div>
              </div>
              <Link
                href="/products"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink hover:bg-ink/90 text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap"
              >
                Browse products
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </>
        )}
      </div>

      <Footer />
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface rounded-xl border border-line px-4 py-3">
      <div className="text-2xl sm:text-3xl font-bold text-ink tabular-nums">{value}</div>
      <div className="text-[11px] sm:text-xs text-ink-muted mt-0.5">{label}</div>
    </div>
  );
}

function Pill({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
        active
          ? 'bg-ink text-white border-ink'
          : 'bg-white text-ink-muted border-line hover:text-ink hover:border-ink/20'
      }`}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span className={`tabular-nums ${active ? 'text-white/60' : 'text-ink-light'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function Meta({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-3.5 h-3.5 text-ink-light mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-ink-light">{label}</div>
        <div className={`text-xs text-ink truncate ${mono ? 'font-mono' : 'font-medium'}`}>
          {value}
        </div>
      </div>
    </div>
  );
}

function ReportCard({ lab, index }: { lab: LabResult; index: number }) {
  const primary = lab.products[0];
  const media = primary?.box_image_url ?? primary?.image_url ?? null;
  const purity = lab.purity_pct;

  // Meta rows shown only when the value is present — no hyphen placeholders.
  const metaItems = [
    lab.method ? { icon: Microscope, label: 'Method', value: lab.method } : null,
    lab.sample_id ? { icon: Hash, label: 'Sample ID', value: lab.sample_id, mono: true } : null,
    lab.report_date
      ? { icon: Calendar, label: 'Result Date', value: formatDate(lab.report_date) }
      : null,
    lab.cas_number ? { icon: FileText, label: 'CAS No.', value: lab.cas_number, mono: true } : null,
  ].filter(Boolean) as { icon: React.ComponentType<{ className?: string }>; label: string; value: string; mono?: boolean }[];

  const MediaBand = (
    <div className="relative aspect-[16/9] bg-surface overflow-hidden">
      {media ? (
        <FadeInImage src={media} alt={lab.product_name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Beaker className="w-12 h-12 text-line" />
        </div>
      )}
      {/* Lab badge */}
      <div className="absolute top-3 left-3">
        <span className="inline-flex items-center gap-1 bg-white/90 backdrop-blur-sm text-ink text-[10px] font-medium px-2 py-1 rounded-full border border-line/50">
          <Microscope className="w-3 h-3 text-teal-dark" />
          {lab.lab}
        </span>
      </div>
      {/* Purity badge — or, for identity-only reports, say what the report IS.
          Some COAs (e.g. HCG, where the lab confirms "matches standard" and
          notes that a bioassay rather than HPLC is required to determine IU)
          legitimately carry no purity figure. Naming the absence beats showing
          an empty metric that reads as a broken value. */}
      {purity !== null && purity !== undefined ? (
        <div className="absolute top-3 right-3">
          <span
            className={`bg-white/90 backdrop-blur-sm text-[11px] font-bold px-2 py-1 rounded-full border border-line/50 tabular-nums ${purityTone(
              purity,
            )}`}
          >
            {Number(purity).toFixed(2)}%
          </span>
        </div>
      ) : (
        <div className="absolute top-3 right-3">
          <span
            title="This certificate confirms identity against a reference standard; it does not report a purity percentage."
            className="inline-flex items-center gap-1 bg-white/90 backdrop-blur-sm text-[11px] font-semibold text-ink-muted px-2 py-1 rounded-full border border-line/50"
          >
            <ShieldCheck className="w-3 h-3 text-teal-dark" />
            Identity verified
          </span>
        </div>
      )}
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.05, 0.3) }}
      className="bg-white rounded-2xl border border-line overflow-hidden hover:shadow-lg hover:shadow-ink/5 transition-all flex flex-col"
    >
      {primary?.slug ? (
        <Link href={productPath(primary)}>{MediaBand}</Link>
      ) : (
        MediaBand
      )}

      <div className="p-5 flex flex-col flex-1">
        {/* Title block */}
        <h3 className="font-bold text-ink text-lg leading-tight">{lab.product_name}</h3>
        {lab.compound && (
          <p className="text-sm text-ink-muted mt-0.5">{lab.compound}</p>
        )}

        {/* Meta grid — only render fields that actually have data (no "—"
            placeholders on the customer-facing card). */}
        {metaItems.length > 0 && (
          <div className="grid grid-cols-2 gap-3 mt-4">
            {metaItems.map((m) => (
              <Meta key={m.label} icon={m.icon} label={m.label} value={m.value} mono={m.mono} />
            ))}
          </div>
        )}

        {/* Applies to */}
        {lab.products.length > 0 && (
          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-wide text-ink-light mb-1.5">
              Applies to
            </div>
            <div className="flex flex-wrap gap-1.5">
              {lab.products.map((p) =>
                p.slug ? (
                  <Link
                    key={p.id}
                    href={productPath(p)}
                    className="inline-flex items-center px-2.5 py-1 bg-surface hover:bg-surface-2 border border-line rounded-full text-xs text-ink-muted hover:text-ink transition-colors"
                  >
                    {p.name}
                  </Link>
                ) : (
                  <span
                    key={p.id}
                    className="inline-flex items-center px-2.5 py-1 bg-surface border border-line rounded-full text-xs text-ink-muted"
                  >
                    {p.name}
                  </span>
                ),
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-5 pt-4 border-t border-line flex items-center gap-3">
          {lab.receiving_date && (
            <span className="text-xs text-ink-light">
              Received {formatDate(lab.receiving_date)}
            </span>
          )}
          <a
            href={lab.report_url}
            target="_blank"
            rel="noopener noreferrer"
            // Opening a COA is the strongest trust signal on the site — the
            // people who read one are the ones deciding whether to buy — so it
            // is recorded alongside product views rather than left to GA4.
            onClick={() =>
              trackActivity({
                type: 'lab_result',
                productId: lab.products?.[0]?.id ?? null,
                productName: lab.product_name,
                metadata: {
                  lab_result_id: lab.id,
                  lab: lab.lab,
                  ...(lab.compound ? { compound: lab.compound } : {}),
                  ...(lab.sample_id ? { sample_id: lab.sample_id } : {}),
                },
              })
            }
            className="ml-auto inline-flex items-center gap-1.5 px-3.5 py-2 bg-ink hover:bg-ink/90 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            View full report
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </motion.div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl border border-line overflow-hidden animate-pulse">
      <div className="aspect-[16/9] bg-surface" />
      <div className="p-5 space-y-4">
        <div className="h-5 bg-surface rounded w-1/2" />
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-8 bg-surface rounded" />
          ))}
        </div>
        <div className="h-9 bg-surface rounded" />
      </div>
    </div>
  );
}

function EmptyState({ hasReports }: { hasReports: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center mb-4">
        <FlaskConical className="w-6 h-6 text-ink-light" />
      </div>
      <p className="text-sm text-ink-muted max-w-sm">
        {hasReports
          ? 'No reports match your search. Try a different term or clear the filters.'
          : 'No lab reports are available yet. Check back soon.'}
      </p>
    </div>
  );
}
