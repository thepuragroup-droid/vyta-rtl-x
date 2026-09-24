'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Send } from 'lucide-react';

const EMPTY = {
  name: '',
  email: '',
  paymentEmail: '',
  phone: '',
  website: '',
  audience: '',
  promotion: '',
  company: '', // honeypot
};

const inputClass =
  'w-full px-4 py-3 bg-white border border-line rounded-xl text-sm text-ink placeholder:text-ink-muted/60 focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal transition-colors';
const labelClass = 'block text-xs font-semibold text-ink mb-1.5';

export default function PartnerApplicationForm() {
  const [form, setForm] = useState(EMPTY);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const set = (key: keyof typeof EMPTY) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!agreedToTerms) {
      setError('Please agree to the Terms & Conditions to continue.');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/partner-applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, agreedToTerms }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        return;
      }
      setSubmitted(true);
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="bg-white rounded-2xl border border-line p-8 sm:p-10 text-center">
        <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <CheckCircle2 className="w-7 h-7 text-emerald-500" />
        </div>
        <h3 className="text-xl font-bold text-ink mb-2">Application received</h3>
        <p className="text-sm text-ink-muted max-w-sm mx-auto">
          Thanks, {form.name.split(' ')[0] || 'partner'}! Our team will review your application and
          email you at <span className="font-medium text-ink">{form.email}</span> within 24 hours.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-line p-6 sm:p-8 space-y-5">
      <div>
        <h3 className="text-lg font-bold text-ink">Apply to the Partner Program</h3>
        <p className="text-xs text-ink-muted mt-1">All fields marked * are required.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="pa-name" className={labelClass}>Your name *</label>
          <input id="pa-name" required maxLength={120} value={form.name} onChange={set('name')} className={inputClass} autoComplete="name" />
        </div>
        <div>
          <label htmlFor="pa-email" className={labelClass}>Email *</label>
          <input id="pa-email" type="email" required maxLength={200} value={form.email} onChange={set('email')} className={inputClass} autoComplete="email" />
        </div>
        <div>
          <label htmlFor="pa-payment" className={labelClass}>Payment email (e-Transfer)</label>
          <input id="pa-payment" type="email" maxLength={200} value={form.paymentEmail} onChange={set('paymentEmail')} className={inputClass} placeholder="If different from above" />
        </div>
        <div>
          <label htmlFor="pa-phone" className={labelClass}>Phone</label>
          <input id="pa-phone" type="tel" maxLength={40} value={form.phone} onChange={set('phone')} className={inputClass} autoComplete="tel" />
        </div>
        <div>
          <label htmlFor="pa-website" className={labelClass}>Website or social handle</label>
          <input id="pa-website" maxLength={300} value={form.website} onChange={set('website')} className={inputClass} placeholder="@yourhandle or https://…" />
        </div>
        <div>
          <label htmlFor="pa-audience" className={labelClass}>Audience size</label>
          <select id="pa-audience" value={form.audience} onChange={set('audience')} className={inputClass}>
            <option value="">Select…</option>
            <option>Under 1,000</option>
            <option>1,000 – 10,000</option>
            <option>10,000 – 50,000</option>
            <option>50,000 – 250,000</option>
            <option>250,000+</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="pa-promotion" className={labelClass}>How will you promote VYTA? *</label>
        <textarea id="pa-promotion" required rows={5} maxLength={3000} value={form.promotion} onChange={set('promotion')} className={inputClass} placeholder="Tell us about your channels, audience and plans." />
      </div>

      {/* Honeypot — hidden from people, filled in by bots. */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor="pa-company">Company</label>
        <input id="pa-company" tabIndex={-1} autoComplete="off" value={form.company} onChange={set('company')} />
      </div>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={agreedToTerms}
          onChange={(e) => setAgreedToTerms(e.target.checked)}
          className="mt-0.5 w-4 h-4 rounded border-line text-teal focus:ring-teal/30"
        />
        <span className="text-xs text-ink-muted">
          I agree to the{' '}
          <Link href="/terms" target="_blank" className="text-teal-dark font-medium hover:underline">
            Terms &amp; Conditions
          </Link>{' '}
          and understand VYTA products are for research use only.
        </span>
      </label>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" />
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-ink hover:bg-ink/90 disabled:opacity-60 text-white font-semibold rounded-xl transition-all"
      >
        {isSubmitting ? (
          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          <Send className="w-4 h-4" />
        )}
        {isSubmitting ? 'Sending…' : 'Submit Application'}
      </button>
    </form>
  );
}
