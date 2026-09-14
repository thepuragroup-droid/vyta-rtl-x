/**
 * Admin view switching — letting a real admin read the panel as another role
 * reads it.
 *
 * Today there are exactly two views: `admin` (the whole panel) and `analytics`
 * (what the external marketing/analytics partner sees — the ANALYTICS_PAGES
 * nav and the paid-ads-only figures). It exists because the analytics surface
 * is deliberately narrowed in ways nobody can check from an admin login: an
 * admin who wants to know what the partner is actually looking at had to be
 * handed a partner account.
 *
 * A view only ever NARROWS. `effectiveAdminRole` hands back the real role
 * unless the reader is genuinely allowed to switch AND asked for a view that is
 * smaller than what they already have, so the switch cannot be used to reach a
 * page or a figure the account was not already entitled to. The API routes
 * apply the same function to the query parameter, so the preview is scoped by
 * the server rather than merely hidden in the browser.
 *
 * Kept free of server and React imports so the layout, the client fetchers and
 * the route handlers can all agree on one definition.
 */
import type { UserRole } from '@/lib/permissions';

export type AdminViewMode = 'admin' | 'analytics';

export const ADMIN_VIEW_MODES: AdminViewMode[] = ['admin', 'analytics'];

export const ADMIN_VIEW_META: Record<AdminViewMode, { label: string; description: string }> = {
  admin: {
    label: 'Admin',
    description: 'The full panel — every page, every figure, the whole business.',
  },
  analytics: {
    label: 'Analytics staff',
    description:
      'What an external marketing partner sees: the analytics, products, categories and ' +
      'branding pages only, with sales figures counting paid-ads orders and no customer names.',
  },
};

/** Query parameter the routes read the requested view from. */
export const ADMIN_VIEW_PARAM = 'view';

/** Where the chosen view is remembered between page loads. */
const STORAGE_KEY = 'admin-view-mode';

/**
 * Who may switch views. Admin and assistant both reach every page, so for them
 * a view is a narrowing. A role that is already scoped (affiliate, analytics)
 * has nothing to narrow to and never sees the control.
 */
export function canSwitchAdminView(role: UserRole): boolean {
  return role === 'admin' || role === 'assistant';
}

/** Parse an untrusted value (query string, localStorage) into a view. */
export function parseAdminView(value: unknown): AdminViewMode {
  return value === 'analytics' ? 'analytics' : 'admin';
}

/**
 * The role the panel should behave as. Falls back to the real role whenever the
 * reader is not allowed to switch, which is what makes this safe to drive from
 * a query parameter: the worst a forged `?view=` can do is show an admin less.
 */
export function effectiveAdminRole(realRole: UserRole, view: AdminViewMode): UserRole {
  return view === 'analytics' && canSwitchAdminView(realRole) ? 'analytics' : realRole;
}

/**
 * Server-side twin of `effectiveAdminRole`, taking the raw query parameter.
 * Routes call this straight after resolving the reader's real role, then use
 * the result for every scope decision below it.
 */
export function previewedRole(realRole: UserRole, requestedView: string | null): UserRole {
  return effectiveAdminRole(realRole, parseAdminView(requestedView));
}

// ---- browser-side persistence ----

/**
 * The view the admin last chose. Read from storage on every call rather than
 * cached in a module variable: the client fetchers below run outside React and
 * must not depend on the layout having mounted first.
 */
export function readStoredAdminView(): AdminViewMode {
  if (typeof window === 'undefined') return 'admin';
  try {
    return parseAdminView(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // Private mode / storage disabled — the full panel is the safe default.
    return 'admin';
  }
}

export function storeAdminView(view: AdminViewMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, view);
  } catch {
    /* ignore persistence failures — the view still applies for this session */
  }
}

/**
 * `view=analytics` when the reader is previewing, otherwise nothing. Client
 * fetchers append this so the server narrows the data too — a preview that
 * only hid pages in the browser would still show whole-business revenue.
 */
export function appendAdminViewParam(params: URLSearchParams): URLSearchParams {
  const view = readStoredAdminView();
  if (view !== 'admin') params.set(ADMIN_VIEW_PARAM, view);
  return params;
}
