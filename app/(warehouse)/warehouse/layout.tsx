'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, Warehouse, KeyRound, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { apiFetch } from '@/lib/api-fetch';
import { canAccessWarehouse, type UserRole } from '@/lib/permissions';
import ChangePasswordForm from '@/components/ChangePasswordForm';

type AuthState = 'checking' | 'not_logged_in' | 'forbidden' | 'error' | 'ok';

interface ViewerContextValue {
  role: UserRole;
  canSendEmails: boolean;
  userId: string;
  email: string;
  displayName: string;
}

const ViewerContext = createContext<ViewerContextValue | null>(null);
export const useViewer = () => {
  const v = useContext(ViewerContext);
  if (!v) throw new Error('useViewer must be used inside WarehouseLayout');
  return v;
};

export default function WarehouseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<AuthState>('checking');
  const [viewer, setViewer] = useState<ViewerContextValue | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          setState('not_logged_in');
          return;
        }
        const { customer } = await apiFetch<{
          customer: {
            id: string;
            role: UserRole;
            email: string;
            first_name?: string | null;
            last_name?: string | null;
            can_send_fulfillment_emails?: boolean;
          };
        }>('/api/auth/customer', {
          method: 'POST',
          body: JSON.stringify({ accessToken: session.access_token }),
        });
        const role = (customer?.role ?? 'customer') as UserRole;
        if (!canAccessWarehouse(role)) {
          setState('forbidden');
          return;
        }
        setViewer({
          role,
          canSendEmails:
            role === 'admin' || !!customer?.can_send_fulfillment_emails,
          userId: customer.id,
          email: customer.email,
          displayName:
            [customer.first_name, customer.last_name]
              .filter(Boolean)
              .join(' ') || customer.email,
        });
        setState('ok');
      } catch (e) {
        console.error('warehouse auth failed', e);
        setState('error');
      }
    })();
  }, []);

  if (state === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface text-ink-muted">
        Loading…
      </div>
    );
  }
  if (state === 'not_logged_in') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface gap-4">
        <p className="text-ink-muted">Sign in to access the warehouse portal.</p>
        <Link
          href="/login?redirect=/warehouse"
          className="px-6 py-2 rounded-md bg-bronze text-white text-sm font-medium hover:bg-bronze-dark"
        >
          Sign in
        </Link>
      </div>
    );
  }
  if (state === 'forbidden') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface gap-2">
        <h1 className="text-2xl font-semibold text-ink">Access denied</h1>
        <p className="text-ink-muted">This portal is for warehouse staff only.</p>
      </div>
    );
  }
  if (state === 'error' || !viewer) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface text-ink-muted">
        Something went wrong loading the warehouse.
      </div>
    );
  }

  return (
    <ViewerContext.Provider value={viewer}>
      <div className="min-h-screen bg-surface text-ink">
        <header className="border-b border-line bg-white">
          <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Warehouse className="w-5 h-5 text-bronze" />
              <h1 className="font-semibold tracking-wide">AMINOCAN — Fulfillment</h1>
              <span className="text-xs text-ink-muted ml-2 hidden md:inline">
                Signed in as {viewer.displayName} · {viewer.role}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {viewer.role === 'admin' && (
                <Link
                  href="/admin"
                  className="text-sm text-bronze hover:underline"
                >
                  Back to admin
                </Link>
              )}
              <button
                className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
                onClick={() => setShowPassword(true)}
              >
                <KeyRound className="w-4 h-4" /> Password
              </button>
              <button
                className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
                onClick={async () => {
                  await supabase.auth.signOut();
                  router.push('/login');
                }}
              >
                <LogOut className="w-4 h-4" /> Sign out
              </button>
            </div>
          </div>
        </header>
        <main className="max-w-[1400px] mx-auto px-6 py-6">{children}</main>

        {showPassword && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
            onClick={() => setShowPassword(false)}
          >
            <div
              className="w-full max-w-md bg-white rounded-xl border border-line shadow-xl p-5 sm:p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-ink flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-bronze" /> Change Password
                </h2>
                <button
                  onClick={() => setShowPassword(false)}
                  className="text-ink-muted hover:text-ink"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ChangePasswordForm variant="admin" />
            </div>
          </div>
        )}
      </div>
    </ViewerContext.Provider>
  );
}
