import React from 'react';
import {
  BadgePercent, Gift, Rocket, Trophy, Zap, MapPin, LineChart, Package,
  UserPlus, MailCheck, Link2, Megaphone, Mail,
} from 'lucide-react';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import PartnerApplicationForm from './PartnerApplicationForm';

export const metadata = {
  title: 'Partner Program | VYTA',
  description:
    'Join the VYTA Partner Program. Earn commission on every sale, give your audience an exclusive discount, and compete in monthly sprints.',
};

// Program terms shown on the page — edit here to change the offer everywhere.
const COMMISSION = '20%';
const AUDIENCE_DISCOUNT = '10%';
const SPRINT_BONUS = '$500';

const HIGHLIGHTS = [
  { icon: Zap, label: 'Fast payouts' },
  { icon: MapPin, label: 'Ships across Canada' },
  { icon: LineChart, label: 'Custom affiliate dashboard' },
  { icon: Package, label: 'Wholesale pricing' },
];

const ADVANTAGES = [
  {
    icon: BadgePercent,
    title: `${COMMISSION} Base Commission`,
    body: `Earn up to ${COMMISSION} on every single sale you generate.`,
  },
  {
    icon: Gift,
    title: `${AUDIENCE_DISCOUNT} Audience Discount`,
    body: `Give your followers ${AUDIENCE_DISCOUNT} off with your custom code to drive higher conversion rates.`,
  },
  {
    icon: Rocket,
    title: 'Instant Entry',
    body: 'From the moment you are approved, every dollar you generate counts toward our performance prizes.',
  },
];

const STEPS = [
  { icon: UserPlus, title: 'Apply', body: 'Fill out the form below to apply for a VYTA Partner account.' },
  { icon: MailCheck, title: 'Get Approved', body: 'We review every application and email you within 24 hours.' },
  { icon: Link2, title: 'Get Your Toolkit', body: `Grab your unique referral link and custom ${AUDIENCE_DISCOUNT} discount code.` },
  {
    icon: Megaphone,
    title: 'Promote & Conquer',
    body: `Start sharing. Sales are tracked instantly and you're entered into the current month's ${SPRINT_BONUS} sprint.`,
  },
];

export default function PartnersPage() {
  return (
    <main className="min-h-screen bg-white">
      <Navigation />

      {/* Hero */}
      <section className="relative bg-brand-gradient overflow-hidden">
        <div className="relative max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 pt-40 sm:pt-44 pb-20 sm:pb-24 text-center">
          <span className="inline-block text-[10px] sm:text-xs font-semibold text-teal-light uppercase tracking-[0.25em] mb-5">
            VYTA Partner Program
          </span>
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold text-white tracking-tight leading-[1.1] max-w-3xl mx-auto">
            Power the Future of Research. Earn Like Never Before.
          </h1>
          <p className="mt-6 text-base sm:text-lg text-white/70 max-w-2xl mx-auto">
            Join the VYTA Partner Elite. Earn up to {COMMISSION} commission and give your audience{' '}
            {AUDIENCE_DISCOUNT} off every order.
          </p>

          <ul className="mt-8 flex flex-wrap justify-center gap-2 sm:gap-3">
            {HIGHLIGHTS.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="inline-flex items-center gap-2 px-3.5 py-2 bg-white/10 border border-white/15 rounded-full text-xs sm:text-sm text-white"
              >
                <Icon className="w-4 h-4 text-teal-light" />
                {label}
              </li>
            ))}
          </ul>

          <a
            href="#apply"
            className="mt-10 inline-flex items-center justify-center px-8 py-4 bg-white hover:bg-white/90 text-ink font-semibold rounded-xl transition-all w-full sm:w-auto"
          >
            Apply now
          </a>
        </div>
      </section>

      {/* Advantages */}
      <section className="py-16 sm:py-24">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-[10px] sm:text-xs font-semibold text-teal-dark uppercase tracking-[0.2em] mb-3 block">
              Why partner with VYTA?
            </span>
            <h2 className="text-2xl sm:text-4xl font-bold text-ink tracking-tight">The VYTA Advantage</h2>
            <p className="mt-3 text-ink-muted">Your earning potential, built around research-grade products your audience can trust.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {ADVANTAGES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="bg-surface rounded-2xl border border-line p-8 text-center">
                <div className="w-14 h-14 bg-white border border-line rounded-2xl flex items-center justify-center mx-auto mb-5">
                  <Icon className="w-7 h-7 text-teal-dark" />
                </div>
                <h3 className="text-lg font-bold text-ink mb-2">{title}</h3>
                <p className="text-sm text-ink-muted leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Monthly sprint */}
      <section className="pb-16 sm:pb-24">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
          <div className="bg-ink rounded-3xl p-8 sm:p-12 grid lg:grid-cols-2 gap-8 items-center">
            <div>
              <span className="text-[10px] sm:text-xs font-semibold text-teal-light uppercase tracking-[0.2em] mb-3 block">
                The VYTA Bonus Tier
              </span>
              <h2 className="text-2xl sm:text-4xl font-bold text-white tracking-tight">Monthly Sprints</h2>
              <p className="mt-3 text-white/60">We don&apos;t just reward the long game — we reward the monthly hustle.</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 sm:p-8 flex gap-5">
              <div className="w-14 h-14 bg-teal/20 rounded-2xl flex items-center justify-center flex-shrink-0">
                <Trophy className="w-7 h-7 text-teal-light" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white mb-2">The {SPRINT_BONUS} Monthly Sprint</h3>
                <p className="text-sm text-white/60 leading-relaxed">
                  Every month, the partner who generates the highest sales volume receives an extra{' '}
                  {SPRINT_BONUS} cash bonus — paid on top of your commissions. New month, new chance to win.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Steps */}
      <section className="py-16 sm:py-24 bg-surface border-y border-line">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
          <h2 className="text-2xl sm:text-4xl font-bold text-ink tracking-tight text-center mb-12">Simple Steps to Start</h2>
          <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="bg-white rounded-2xl border border-line p-6">
                <div className="flex items-center gap-3 mb-4">
                  <span className="w-8 h-8 rounded-full bg-ink text-white text-sm font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <Icon className="w-5 h-5 text-teal-dark" />
                </div>
                <h3 className="font-bold text-ink mb-1.5">{title}</h3>
                <p className="text-sm text-ink-muted leading-relaxed">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Application form */}
      <section id="apply" className="py-16 sm:py-24 scroll-mt-24">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 lg:px-12 grid lg:grid-cols-5 gap-10">
          <div className="lg:col-span-2">
            <span className="text-[10px] sm:text-xs font-semibold text-teal-dark uppercase tracking-[0.2em] mb-3 block">
              Partner Portal
            </span>
            <h2 className="text-2xl sm:text-4xl font-bold text-ink tracking-tight">Ready to earn with VYTA?</h2>
            <p className="mt-4 text-ink-muted">
              Tell us a little about yourself and how you plan to share VYTA. Every application is reviewed
              by our team, and you&apos;ll hear back by email within 24 hours.
            </p>
            <div className="mt-8 p-5 bg-surface border border-line rounded-2xl flex items-start gap-3">
              <Mail className="w-5 h-5 text-teal-dark flex-shrink-0 mt-0.5" />
              <p className="text-sm text-ink-muted">
                Questions first? Email us at{' '}
                <a href="mailto:Vytabiosciences@gmail.com" className="font-medium text-teal-dark hover:underline break-all">
                  Vytabiosciences@gmail.com
                </a>
              </p>
            </div>
          </div>
          <div className="lg:col-span-3">
            <PartnerApplicationForm />
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
