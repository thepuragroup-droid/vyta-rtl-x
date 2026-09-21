'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { FlaskConical, Gem, Truck, type LucideIcon } from 'lucide-react';
import MapleLeaf, { MAPLE_RED } from '@/components/icons/MapleLeaf';

/**
 * "Why Choose VYTA?" — the four value props, stated once in plain words.
 *
 * The same four claims the hero's badge strip makes, which is deliberate: the
 * hero states them before anyone has scrolled, this states them again after
 * they have seen the catalogue and the lab results, with the sentence that
 * backs each one up.
 */

interface Value {
  icon: LucideIcon | typeof MapleLeaf;
  title: string;
  detail: string;
  accent?: boolean;
}

const VALUES: Value[] = [
  { icon: Gem, title: 'Verified Purity', detail: '99%+ pure compounds' },
  { icon: FlaskConical, title: 'Third-Party Tested', detail: 'Independent lab testing' },
  { icon: MapleLeaf, title: 'Canadian Company', detail: 'Proudly based in Canada', accent: true },
  { icon: Truck, title: 'Free & Discreet Shipping', detail: 'Secure and reliable' },
];

export default function WhyChooseVyta() {
  return (
    <section className="py-14 sm:py-20 bg-white">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
        <div className="text-center mb-10 sm:mb-12">
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-ink">Why Choose VYTA?</h2>
          <p className="text-sm text-ink-muted mt-1.5">Premium quality. A better experience.</p>
        </div>

        <ul className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10">
          {VALUES.map(({ icon: Icon, title, detail, accent }, index) => (
            <motion.li
              key={title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: index * 0.06 }}
              viewport={{ once: true }}
              className="flex flex-col items-center text-center gap-3"
            >
              <Icon
                className="w-8 h-8 sm:w-9 sm:h-9 text-ink"
                style={accent ? { color: MAPLE_RED } : undefined}
                strokeWidth={1.25}
              />
              <span>
                <span className="block text-sm font-semibold text-ink">{title}</span>
                <span className="block text-xs text-ink-muted mt-1">{detail}</span>
              </span>
            </motion.li>
          ))}
        </ul>
      </div>
    </section>
  );
}
