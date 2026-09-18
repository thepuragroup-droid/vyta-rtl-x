'use client';

import React, { useState } from 'react';
import {
  ChevronDown,
  FileText,
  FlaskConical,
  MapPin,
  Microscope,
  ShieldCheck,
} from 'lucide-react';
import RichText from '@/components/content/RichText';

/**
 * The long-form half of the product page.
 *
 * Everything a customer reads rather than clicks — the description, what the
 * compound is studied for, how it is tested, how it ships — lives here, below
 * the image/buy block rather than beside it. Keeping it out of the right-hand
 * column is what lets the pack picker and Add to Cart sit above the fold.
 *
 * Laid out 8/10 + 2/10: the tabs take the width, and a narrow rail of
 * standing assurances (research use, purity, testing, where we ship from)
 * sits alongside them behind a hairline. The rail is a 2 x 2 grid wherever it
 * has the width for one, and stacks to a single column once it becomes the
 * narrow desktop rail — 90px cells cannot hold a label and a subtitle.
 */

interface ProductInfoTabsProps {
  product: {
    name: string;
    description: string | null;
    mechanism: string | null;
    purity: string | null;
    strength: string | null;
    form: string | null;
    category: string | null;
  };
  /** How many certificates are on file — 0 hides the "view" affordance. */
  coaCount: number;
  onViewCoa: () => void;
}

type TabId = 'overview' | 'applications' | 'quality' | 'shipping' | 'faqs';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'applications', label: 'Research Applications' },
  { id: 'quality', label: 'Quality & Testing' },
  { id: 'shipping', label: 'Shipping' },
  { id: 'faqs', label: 'FAQs' },
];

/** The standing assurances in the rail — the same four on every product. */
const ASSURANCES = [
  {
    icon: FlaskConical,
    title: 'Research Use Only',
    subtitle: 'Not for human consumption',
  },
  {
    icon: ShieldCheck,
    title: 'High Purity Standard',
    subtitle: '99% verified',
  },
  {
    icon: Microscope,
    title: 'Analytical Testing',
    subtitle: 'COA for every batch',
  },
  {
    icon: MapPin,
    title: 'Canadian Company',
    subtitle: 'Proudly based in Canada',
  },
];

const bodyClass = 'text-ink-muted leading-relaxed text-sm sm:text-base';

export default function ProductInfoTabs({
  product,
  coaCount,
  onViewCoa,
}: ProductInfoTabsProps) {
  const [tab, setTab] = useState<TabId>('overview');
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const purity = product.purity?.trim() || '99%';

  const faqs: Array<{ q: string; a: string }> = [
    {
      q: `What is ${product.name} supplied as?`,
      a: `Each vial contains ${product.strength || 'the stated quantity'} of lyophilized ${
        product.form?.toLowerCase() || 'powder'
      }, sealed under vacuum. Vials are shipped at ambient temperature and should be stored refrigerated on arrival, protected from light.`,
    },
    {
      q: 'Is this material intended for human use?',
      a: 'No. Everything in our catalog is sold strictly as a laboratory reference material for in-vitro research and analytical work. It is not a drug, supplement or medical device, and it is not intended to diagnose, treat, cure or prevent any condition.',
    },
    {
      q: 'Do you provide a certificate of analysis?',
      a: 'Yes. Every batch is analysed by an independent third-party laboratory and the certificate is published against the product before the batch is released for sale.',
    },
    {
      q: 'How is reconstitution handled?',
      a: 'Bacteriostatic water is the usual diluent and is sold separately in the catalog. Reconstitution volumes are determined by the receiving laboratory — we do not supply dosing or protocol guidance of any kind.',
    },
    {
      q: 'How quickly do orders ship?',
      a: 'In-stock orders placed before the daily cut-off are packed and dispatched the same business day from our Canadian facility, in discreet, unbranded outer packaging.',
    },
  ];

  return (
    <section className="mb-10 sm:mb-16 border-t border-line pt-8 sm:pt-10">
      <div className="grid gap-8 lg:grid-cols-10 lg:gap-10">
        {/* Tabs — 8/10 of the width */}
        <div className="lg:col-span-8">
          {/* Nav: inactive is plain text, active carries a thick underline. */}
          <div
            role="tablist"
            aria-label="Product information"
            className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line"
          >
            {TABS.map(({ id, label }) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`product-tab-${id}`}
                  aria-selected={active}
                  aria-controls={`product-panel-${id}`}
                  onClick={() => setTab(id)}
                  className={`relative -mb-px pb-3 text-sm font-semibold transition-colors ${
                    active
                      ? 'text-ink border-b-[3px] border-ink'
                      : 'text-ink-muted border-b-[3px] border-transparent hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            id={`product-panel-${tab}`}
            aria-labelledby={`product-tab-${tab}`}
            className="pt-5 sm:pt-6"
          >
            {tab === 'overview' && (
              product.description ? (
                <RichText text={product.description} paragraphClassName={bodyClass} />
              ) : (
                <p className={bodyClass}>
                  {product.name} is supplied as a research-grade reference material for
                  laboratory use.
                </p>
              )
            )}

            {tab === 'applications' && (
              <div className="space-y-4">
                {product.mechanism ? (
                  <>
                    <h3 className="text-sm font-semibold text-ink">Mechanism of action</h3>
                    <p className={bodyClass}>{product.mechanism}</p>
                  </>
                ) : (
                  <p className={bodyClass}>
                    {product.name} is studied in controlled in-vitro and preclinical settings.
                    Published mechanism notes for this compound are added here as they are
                    reviewed.
                  </p>
                )}
                <p className={bodyClass}>
                  Investigators typically work with this material in assay development, receptor
                  and pathway characterisation, stability and purity method validation, and as a
                  comparator in analytical reference work. Applications are determined entirely
                  by the receiving laboratory — we supply the material and its analytical data,
                  never a protocol.
                </p>
                <p className="text-xs text-ink-muted">
                  For research use only. Not for human or veterinary consumption.
                </p>
              </div>
            )}

            {tab === 'quality' && (
              <div className="space-y-4">
                <p className={bodyClass}>
                  Every batch of {product.name} is released against an independent third-party
                  analysis. Identity is confirmed by mass spectrometry and purity by HPLC, with
                  a specification of {purity} or better.
                </p>
                <ul className="space-y-2">
                  {[
                    `HPLC purity verified to ${purity} or higher`,
                    'Mass-spectrometry identity confirmation on every lot',
                    'Independent third-party laboratory — no in-house self-certification',
                    'Lot-traceable certificate of analysis published per batch',
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-teal-dark" />
                      <span className="text-sm text-ink-muted">{line}</span>
                    </li>
                  ))}
                </ul>
                {coaCount > 0 && (
                  <button
                    type="button"
                    onClick={onViewCoa}
                    className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-white"
                  >
                    <FileText className="h-4 w-4 text-teal-dark" />
                    View certificate of analysis
                    {coaCount > 1 ? ` (${coaCount})` : ''}
                  </button>
                )}
              </div>
            )}

            {tab === 'shipping' && (
              <div className="space-y-4">
                <p className={bodyClass}>
                  Orders are packed and dispatched from our Canadian facility. In-stock orders
                  placed before the daily cut-off ship the same business day; anything after it
                  goes out the next.
                </p>
                <ul className="space-y-2">
                  {[
                    'Ships from Canada — domestic orders typically arrive in 2–5 business days',
                    'Plain, unbranded outer packaging with no product detail on the label',
                    'Tracking is emailed as soon as the parcel is scanned by the carrier',
                    'Vials are packed with protective insulation to survive transit',
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-teal-dark" />
                      <span className="text-sm text-ink-muted">{line}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-ink-muted">
                  International delivery times and any customs handling are determined by the
                  destination country.
                </p>
              </div>
            )}

            {tab === 'faqs' && (
              <div className="divide-y divide-line rounded-xl border border-line">
                {faqs.map((faq, idx) => {
                  const open = openFaq === idx;
                  return (
                    <div key={faq.q}>
                      <button
                        type="button"
                        onClick={() => setOpenFaq(open ? null : idx)}
                        aria-expanded={open}
                        className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left"
                      >
                        <span className="text-sm font-semibold text-ink">{faq.q}</span>
                        <ChevronDown
                          className={`h-4 w-4 flex-shrink-0 text-ink-muted transition-transform ${
                            open ? 'rotate-180' : ''
                          }`}
                        />
                      </button>
                      {open && (
                        <p className="px-4 pb-4 text-sm leading-relaxed text-ink-muted">
                          {faq.a}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Standing assurances — 2/10, behind a hairline */}
        <div className="lg:col-span-2 border-t border-line pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6 xl:pl-8">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-1">
            {ASSURANCES.map(({ icon: Icon, title, subtitle }) => (
              <div key={title} className="flex items-start gap-2.5">
                <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-teal-dark" />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold leading-snug text-ink">{title}</p>
                  <p className="mt-0.5 text-[11px] font-light leading-snug text-ink-muted">
                    {subtitle}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
