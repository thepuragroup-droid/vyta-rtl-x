-- ============================================================
-- SUPABASE CRON — PuraMass (Stealth Health) payment poller
-- ============================================================
--
-- Schedules the job that calls the app endpoint
--   GET /api/cron/puramass-poll
-- which polls the Stealth Health portal for the current status of this
-- project's pending hosted-checkout orders and, when one flips to `paid`,
-- confirms it locally and materialises the fulfillment invoice. This is the
-- pull-based fallback for when the portal's `store_order.payment_complete`
-- webhook isn't delivered to this project.
--
-- Runs entirely inside Postgres using two Supabase extensions:
--   * pg_cron  -> schedules the job (cron.schedule / cron.unschedule)
--   * pg_net   -> makes the outbound HTTPS request (net.http_get)
--
-- The endpoint is protected by a bearer secret: the job sends
--   Authorization: Bearer <secret>
-- where <secret> must equal the app's PURAMASS_CRON_SECRET env var (or
-- CRON_SECRET if PURAMASS_CRON_SECRET is not set — the route accepts either).
--
-- Run this ONCE in the Supabase SQL Editor. Safe to re-run — it unschedules
-- any prior copy of the job first.

-- ------------------------------------------------------------
-- 0. Enable the extensions.
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ------------------------------------------------------------
-- 1. App URL + cron secret in Supabase Vault.
--
--    If you already set these up for another cron job (e.g.
--    supabase-cron-abandoned-registrations.sql) they exist already — skip
--    this section. Otherwise create them once (must match your deployment;
--    cron_secret must equal the app's PURAMASS_CRON_SECRET env var, or
--    CRON_SECRET if you didn't set a dedicated one).
-- ------------------------------------------------------------
-- First time only (errors if the secret already exists — use update_secret then):
--   select vault.create_secret('https://aminocan.com', 'app_base_url');   -- no trailing slash
--   select vault.create_secret('YOUR_CRON_SECRET_HERE', 'cron_secret');   -- = the app's CRON_SECRET

-- ------------------------------------------------------------
-- 2. (Re)schedule the poll. Every 2 minutes — a customer pays within minutes,
--    and the 7-day (+6h grace) selection window keeps the work flat as history
--    grows.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'puramass-poll') THEN
    PERFORM cron.unschedule('puramass-poll');
  END IF;
END $$;

select cron.schedule(
  'puramass-poll',
  '*/2 * * * *',  -- every 2 minutes
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
           || '/api/cron/puramass-poll',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    )
  );
  $$
);

-- ------------------------------------------------------------
-- Handy checks
-- ------------------------------------------------------------
-- List the job:
--   select jobid, jobname, schedule, active from cron.job where jobname = 'puramass-poll';
--
-- Recent runs (status / return message):
--   select * from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'puramass-poll')
--   order by start_time desc limit 10;
--
-- Inspect the actual HTTP responses pg_net recorded:
--   select id, status_code, content from net._http_response order by id desc limit 10;
--
-- Remove the job entirely:
--   select cron.unschedule('puramass-poll');
