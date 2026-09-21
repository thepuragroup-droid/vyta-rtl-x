'use client';

import React from 'react';
import Link from 'next/link';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSiteConfig } from '@/contexts/SiteConfigContext';
import { Mail, MapPin, Instagram, Beaker, ShieldCheck, Microscope, FileCheck, MessageCircle } from 'lucide-react';
import BrandLockup from '@/components/BrandLockup';

export default function Footer() {
  const { t } = useLanguage();
  const { config } = useSiteConfig();

  return (
    <footer className="surface-navy">
      {/* Main Footer Content */}
      <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 py-12 md:py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12 mb-10">
          {/* Company Info */}
          <div className="col-span-2">
            {/* Logo */}
            <div className="mb-4">
              <BrandLockup
                name={config.store_name}
                tagline={config.store_tagline}
                logoUrl={config.logo_url}
                tone="dark"
                size="md"
              />
            </div>

            <p className="text-white/60 mb-6 leading-relaxed text-sm max-w-sm">
              {t.footer.description}
            </p>

            {/* Certifications */}
            <div className="flex flex-wrap gap-2 sm:gap-3 mb-6">
              <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 bg-white/5 rounded-lg border border-white/10">
                <ShieldCheck className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-teal-light" />
                <span className="text-[10px] sm:text-xs text-white/60 font-medium">GMP Certified</span>
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 bg-white/5 rounded-lg border border-white/10">
                <Microscope className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-teal-light" />
                <span className="text-[10px] sm:text-xs text-white/60 font-medium">HPLC Tested</span>
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 bg-white/5 rounded-lg border border-white/10">
                <FileCheck className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-teal-light" />
                <span className="text-[10px] sm:text-xs text-white/60 font-medium">COA Included</span>
              </div>
            </div>

            {/* Social */}
            <div className="flex space-x-3">
              <a
                href="https://www.instagram.com/vytabiosciences/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="VYTA Biosciences on Instagram"
                className="w-10 h-10 bg-white hover:bg-white/90 rounded-xl flex items-center justify-center text-ink transition-all duration-300"
              >
                <Instagram className="w-4 h-4" aria-hidden="true" />
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider">
              {t.footer.quickLinks}
            </h4>
            <ul className="space-y-3">
              <li>
                <Link href="/" className="text-white/60 hover:text-white transition-colors text-sm">
                  {t.nav.home}
                </Link>
              </li>
              <li>
                <Link href="/products" className="text-white/60 hover:text-white transition-colors text-sm">
                  {t.nav.products}
                </Link>
              </li>
              <li>
                <Link href="/articles" className="text-white/60 hover:text-white transition-colors text-sm">
                  Articles
                </Link>
              </li>
              <li>
                <Link href="/about" className="text-white/60 hover:text-white transition-colors text-sm">
                  About Us
                </Link>
              </li>
              <li>
                <Link href="/contact" className="text-white/60 hover:text-white transition-colors text-sm">
                  {t.nav.contact}
                </Link>
              </li>
              <li>
                <Link href="/terms" className="text-white/60 hover:text-white transition-colors text-sm">
                  Terms &amp; Conditions
                </Link>
              </li>
              <li>
                <Link href="/affiliate/signup" className="text-teal-light hover:text-white transition-colors text-sm">
                  Affiliate Program
                </Link>
              </li>
            </ul>
          </div>

          {/* Support */}
          <div>
            <h4 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider">
              {t.footer.support}
            </h4>
            <ul className="space-y-4">
              <li>
                <a
                  href="mailto:support@vytabio.com"
                  className="flex items-start gap-3 text-white/60 hover:text-white transition-colors group"
                >
                  <div className="w-8 h-8 bg-white/5 rounded-lg flex items-center justify-center flex-shrink-0 border border-white/10 group-hover:border-white/20 transition-colors">
                    <Mail className="w-4 h-4 text-teal-light" />
                  </div>
                  <div className="pt-1">
                    <span className="text-sm block">support@vytabio.com</span>
                  </div>
                </a>
              </li>
              <li>
                <a
                  href="https://wa.me/15147013824"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 text-white/60 hover:text-white transition-colors group"
                >
                  <div className="w-8 h-8 bg-white/5 rounded-lg flex items-center justify-center flex-shrink-0 border border-white/10 group-hover:border-white/20 transition-colors">
                    <MessageCircle className="w-4 h-4 text-teal-light" />
                  </div>
                  <div className="pt-1">
                    <span className="text-sm block">Contact us on WhatsApp</span>
                  </div>
                </a>
              </li>
              <li>
                <div className="flex items-start gap-3 text-white/60">
                  <div className="w-8 h-8 bg-white/5 rounded-lg flex items-center justify-center flex-shrink-0 border border-white/10">
                    <MapPin className="w-4 h-4 text-teal-light" />
                  </div>
                  <div className="pt-1">
                    <span className="text-sm block">Shipping to Canada Only</span>
                  </div>
                </div>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-white/10 pt-6 sm:pt-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-white/40 text-[10px] sm:text-xs text-center sm:text-left order-2 sm:order-1">{t.footer.copyright}</p>
            <div className="flex items-center gap-2 px-3 py-2 sm:py-1.5 bg-teal/10 rounded-lg border border-teal/20 order-1 sm:order-2">
              <Beaker className="w-3.5 h-3.5 text-teal-light flex-shrink-0" />
              <span className="text-[10px] sm:text-xs text-teal-light/90 text-center sm:text-left">
                Research only. Not for human consumption.
              </span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
