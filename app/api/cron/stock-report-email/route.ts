/**
 * Alias route matching the pg_cron job's HTTP target.
 *
 * The Supabase pg_cron job (`stock-report-email @ 0 13 * * *`) hits
 * `/api/cron/stock-report-email`. The cadence-aware handler lives at
 * `/api/cron/stock-report/route.ts` — this file just re-exports it so
 * the pg_cron URL doesn't need to be edited.
 *
 * pg_net also POSTs (with an empty body) rather than GETs, so we expose
 * POST as an alias for GET too.
 *
 * `runtime` / `dynamic` are declared here rather than re-exported: Next.js
 * reads those two statically and cannot follow a re-export, so a re-exported
 * pair is silently replaced by the defaults.
 */
export { GET } from '../stock-report/route';
export { GET as POST } from '../stock-report/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
