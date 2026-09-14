'use client';

import React, { useEffect, useState } from 'react';
import { ListChecks, Users } from 'lucide-react';
import { usePermissions } from '@/lib/hooks/usePermissions';
import PriceListsView from './_components/PriceListsView';
import CustomerOverridesView from './_components/CustomerOverridesView';

type View = 'lists' | 'overrides';

/**
 * Pricing shell — hosts two workspaces:
 *   • Price Lists      → reusable named lists that seed customer overrides
 *                        and default line prices in the invoice form.
 *   • Customer Pricing → per-customer product price overrides.
 *
 * The toggle is admin/assistant only (`canManageLists`). Affiliates are
 * forced to the overrides view — they manage overrides for their bound
 * customers but never see the global price lists.
 */
export default function PricingPage() {
  const { userRole } = usePermissions();
  const canManageLists = userRole === 'admin' || userRole === 'assistant';

  const [view, setView] = useState<View>(canManageLists ? 'lists' : 'overrides');

  // If the role changes (permissions rehydrate), keep affiliates on overrides.
  useEffect(() => {
    if (!canManageLists && view !== 'overrides') setView('overrides');
  }, [canManageLists, view]);

  const subtitle = view === 'lists'
    ? 'Manage reusable price lists and pick which one is active for the invoice form.'
    : 'Per-customer product prices. Overrides win over any active price list.';

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink mb-1">Pricing</h1>
          <p className="text-sm text-ink-muted">{subtitle}</p>
        </div>
        {canManageLists && (
          <div className="inline-flex rounded-lg border border-line bg-surface p-1 self-start">
            {([
              { v: 'lists', l: 'Price Lists', I: ListChecks },
              { v: 'overrides', l: 'Customer Pricing', I: Users },
            ] as const).map(({ v, l, I }) => (
              <button
                key={v}
                onClick={() => setView(v as View)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  view === v
                    ? 'bg-white text-ink shadow-sm border border-line'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                <I className="w-3.5 h-3.5" /> {l}
              </button>
            ))}
          </div>
        )}
      </div>

      {view === 'lists' && canManageLists ? (
        <PriceListsView />
      ) : (
        <CustomerOverridesView />
      )}
    </>
  );
}
