'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  BarChart3, Receipt, Users, Clock, DollarSign, Copy, Check, ArrowRight,
} from 'lucide-react';
import { useSmartLoad } from '@/lib/hooks/useSmartLoad';

type MeSummary = {
  firstName: string;
  referralCode: string | null;
  boundCustomers: number;
  pendingEarnings: number;
  paidEarnings: number;
  salesPerson: unknown;
};

type CommissionRow = {
  id: string;
  source: 'referral' | 'invoice';
  reference: string;
  base: number;
  amount: number;
  rate: number;
  status: string;
};

type CommissionsResponse = {
  rows: CommissionRow[];
  paid: number;
  pending: number;
  total: number;
};

const statusColors: Record<string, string> = {
  paid: 'bg-emerald-500/10 text-emerald-600',
  pending: 'bg-amber-500/10 text-amber-600',
  cancelled: 'bg-red-500/10 text-red-500',
};

function StatCard({
  icon: Icon, label, value, tone,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  tone: 'blue' | 'bronze' | 'emerald';
}) {
  const toneClasses = {
    blue: 'bg-blue-500/10 text-blue-500',
    bronze: 'bg-bronze/10 text-bronze',
    emerald: 'bg-emerald-500/10 text-emerald-500',
  }[tone];
  return (
    <div className="bg-white border border-line rounded-xl p-5">
      <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg mb-3 ${toneClasses}`}>
        <Icon className="w-4 h-4" />
      </div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="text-2xl font-bold text-ink tabular-nums mt-1">{value}</p>
    </div>
  );
}

function StatSkeleton() {
  return (
    <div className="bg-white border border-line rounded-xl p-5">
      <div className="w-9 h-9 rounded-lg bg-surface-2 animate-pulse mb-3" />
      <div className="h-3 w-20 bg-surface-2 animate-pulse rounded mb-2" />
      <div className="h-6 w-24 bg-surface-2 animate-pulse rounded" />
    </div>
  );
}

function OverviewTab() {
  const { data, loading } = useSmartLoad<MeSummary>('/api/affiliate/me');
  const [copied, setCopied] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://aminocan.com';
  const referralUrl = data?.referralCode ? `${origin}?ref=${data.referralCode}` : '';

  const copy = async () => {
    if (!referralUrl) return;
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {loading || !data ? (
          <>
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
          </>
        ) : (
          <>
            <StatCard icon={Users} tone="blue" label="Your Customers" value={String(data.boundCustomers)} />
            <StatCard icon={Clock} tone="bronze" label="Pending Earnings" value={`$${data.pendingEarnings.toFixed(2)}`} />
            <StatCard icon={DollarSign} tone="emerald" label="Paid Earnings" value={`$${data.paidEarnings.toFixed(2)}`} />
          </>
        )}
      </div>

      {/* Referral link */}
      <div className="bg-white border border-line rounded-xl p-5">
        <p className="text-sm font-semibold text-ink mb-1">Your Referral Link</p>
        <p className="text-xs text-ink-muted mb-3">Share this link — referred customers get 10% off and you earn 10% commission.</p>
        <div className="flex flex-col sm:flex-row gap-3">
          <code className="flex-1 px-4 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink font-mono break-all">
            {referralUrl || (loading ? 'Loading…' : 'No active referral code')}
          </code>
          <button
            onClick={copy}
            disabled={!referralUrl}
            className="inline-flex items-center justify-center gap-2 bg-ink text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-ink/90 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {copied ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy</>}
          </button>
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <QuickLink href="/admin/customers" title="Your Customers" subtitle="View customers you've referred" />
        <QuickLink href="/admin/invoices" title="Invoices" subtitle="Create & track customer invoices" />
      </div>
    </div>
  );
}

function QuickLink({ href, title, subtitle }: { href: string; title: string; subtitle: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between bg-white border border-line rounded-xl p-5 hover:border-ink/20 transition-colors group"
    >
      <div>
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>
      </div>
      <ArrowRight className="w-4 h-4 text-ink-muted group-hover:text-ink transition-colors" />
    </Link>
  );
}

function CommissionsTab() {
  const { data, loading } = useSmartLoad<CommissionsResponse>('/api/affiliate/commissions');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        {loading || !data ? (
          <>
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
          </>
        ) : (
          <>
            <StatCard icon={Clock} tone="bronze" label="Pending" value={`$${data.pending.toFixed(2)}`} />
            <StatCard icon={DollarSign} tone="emerald" label="Paid" value={`$${data.paid.toFixed(2)}`} />
            <StatCard icon={Receipt} tone="blue" label="Total" value={`$${data.total.toFixed(2)}`} />
          </>
        )}
      </div>

      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="p-5 border-b border-line">
          <h2 className="text-lg font-bold text-ink">Commission History</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-line">
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Date</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Source</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Reference</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Base</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Commission</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {(data?.rows || []).map((row) => (
                <tr key={`${row.source}-${row.id}`} className="hover:bg-surface transition-colors">
                  <td className="px-5 py-4 text-sm text-ink-muted">—</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                      row.source === 'invoice' ? 'bg-purple-500/10 text-purple-500' : 'bg-blue-500/10 text-blue-500'
                    }`}>
                      {row.source === 'invoice' ? 'Invoice' : 'Referral'}
                    </span>
                  </td>
                  <td className="px-5 py-4 font-mono text-sm text-ink">{row.reference}</td>
                  <td className="px-5 py-4 text-sm text-ink tabular-nums">${row.base.toFixed(2)}</td>
                  <td className="px-5 py-4 text-sm font-semibold text-emerald-600 tabular-nums">
                    ${row.amount.toFixed(2)} <span className="text-ink-muted font-normal">({row.rate}%)</span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium capitalize ${statusColors[row.status] || 'bg-gray-500/10 text-ink-muted'}`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && (!data || data.rows.length === 0) && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-ink-muted text-sm">
                    No commissions yet — share your referral link to start earning.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function AffiliateDashboard() {
  const [tab, setTab] = useState<'overview' | 'commissions'>('overview');

  return (
    <div>
      <div className="flex items-center gap-6 border-b border-line mb-6">
        <button
          onClick={() => setTab('overview')}
          className={`flex items-center gap-2 pb-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'overview' ? 'border-ink text-ink' : 'border-transparent text-ink-muted hover:text-ink'
          }`}
        >
          <BarChart3 className="w-4 h-4" /> Overview
        </button>
        <button
          onClick={() => setTab('commissions')}
          className={`flex items-center gap-2 pb-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'commissions' ? 'border-ink text-ink' : 'border-transparent text-ink-muted hover:text-ink'
          }`}
        >
          <Receipt className="w-4 h-4" /> Commissions
        </button>
      </div>

      {tab === 'overview' ? <OverviewTab /> : <CommissionsTab />}
    </div>
  );
}
