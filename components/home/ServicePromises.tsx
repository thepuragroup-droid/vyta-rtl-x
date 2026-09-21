'use client';

import React from 'react';
import { CreditCard, Headphones, PackageCheck, RotateCcw } from 'lucide-react';

/**
 * The four service promises that close the homepage: what happens after the
 * order, rather than what is in the vial. Sits directly above the footer, on
 * its own hairline-separated row.
 */

const PROMISES = [
  { icon: PackageCheck, title: 'Discreet Packaging', detail: 'Your privacy matters' },
  { icon: CreditCard, title: 'Multiple Payment Options', detail: 'Secure checkout' },
  { icon: Headphones, title: 'Dedicated Support', detail: "We're here to help" },
  { icon: RotateCcw, title: 'Easy Returns', detail: 'Hassle-free process' },
];

export default function ServicePromises() {
  return (
    <section className="border-y border-line bg-white">
      <ul className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 py-8 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-8">
        {PROMISES.map(({ icon: Icon, title, detail }) => (
          <li key={title} className="flex items-center gap-3">
            <Icon className="w-6 h-6 text-ink flex-shrink-0" strokeWidth={1.25} />
            <span className="min-w-0">
              <span className="block text-xs sm:text-sm font-semibold text-ink leading-tight">
                {title}
              </span>
              <span className="block text-[11px] sm:text-xs text-ink-muted mt-0.5">{detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
