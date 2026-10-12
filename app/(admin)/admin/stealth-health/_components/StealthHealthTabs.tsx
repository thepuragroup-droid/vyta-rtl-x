'use client';

/**
 * Settlement / Payouts switch, shown in the header of both Stealth Health
 * pages. Settlement is the dashboard at /admin/stealth-health (earnings,
 * invoices, remittances); Payouts is the payout-request workflow at
 * /admin/stealth-health/payouts.
 */
import Link from 'next/link';
import { Handshake, Wallet } from 'lucide-react';

export default function StealthHealthTabs({ active }: { active: 'settlement' | 'payouts' }) {
  const tabs = [
    { key: 'settlement', label: 'Settlement', href: '/admin/stealth-health', icon: Handshake },
    { key: 'payouts', label: 'Payouts', href: '/admin/stealth-health/payouts', icon: Wallet },
  ] as const;
  return (
    <nav className="inline-flex items-center rounded-lg border border-line bg-white p-0.5" aria-label="Stealth Health sections">
      {tabs.map((t) => {
        const on = t.key === active;
        const Icon = t.icon;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={on ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              on ? 'bg-teal-dark text-white' : 'text-ink-muted hover:text-ink hover:bg-surface'
            }`}
          >
            <Icon className="w-4 h-4" /> {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
