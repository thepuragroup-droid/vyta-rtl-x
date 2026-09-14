/**
 * Wire shapes for the partner settlement feed, shared by the API route, the
 * storage layer and the browser.
 *
 * They live in their own module — with no runtime imports at all — so the
 * dashboard can name them without reaching into
 * lib/admin/partner-settlement-server.ts. That module builds a service-role
 * Supabase client at import time, and a stray non-`type` import of it from a
 * client component would drag SUPABASE_SERVICE_ROLE_KEY toward the browser
 * bundle. Keeping the types somewhere harmless removes the temptation.
 *
 * Money is integer cents throughout, formatted only at the last moment.
 */
import type { SettlementCaveat } from '@/lib/payments/puramass-settlement';

/** One snapshotted pull of GET /partner/settlement. */
export interface StoredPull {
  id: string;
  window_start: string;
  window_end: string;
  pulled_at: string;
  pulled_by_email: string | null;
  rows_returned: number;
  pages_fetched: number;
  /** True when we stopped following the cursor early — the snapshot is partial. */
  truncated: boolean;
  /** True when the partner sent a window-wide `totals` block. */
  totals_reported: boolean;
  total_appointments: number | null;
  revenue_cents: number;
  processing_fee_cents: number;
  consult_fee_cents: number;
  /** Null when nothing in the window shipped. Not the same as zero. */
  shipping_cents: number | null;
  partner_split_cents: number;
  caveats: SettlementCaveat[];
  /** True when our split is unconfigured on their side: a setup gap, not a balance. */
  split_model_unconfigured: boolean;
}

/**
 * How a window's answer moved between its two most recent pulls.
 *
 * Worth watching because the partner joins store cost from the CURRENT
 * catalog rather than stamping it at checkout, so a price change can move a
 * settled window after the fact.
 */
export interface PullDrift {
  previous: StoredPull;
  latest: StoredPull;
  /** latest − previous, in cents. Non-zero means the answer moved. */
  split_delta_cents: number;
  appointment_delta: number;
}
