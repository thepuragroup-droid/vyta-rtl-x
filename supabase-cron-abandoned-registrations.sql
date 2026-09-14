-- ============================================================
-- SUPABASE CRON — abandoned-registration alert
-- ============================================================
--
-- Schedules the hourly job that calls the app endpoint
--   GET /api/cron/abandoned-registrations
-- which emails the admins about customers who registered but never
-- checked out. Replaces the previous Vercel Cron entry in vercel.json.
--
-- Runs entirely inside Postgres using two Supabase extensions:
--   * pg_cron  -> schedules the job (cron.schedule / cron.unschedule)
--   * pg_net   -> makes the outbound HTTPS request (net.http_get)
--
-- The endpoint stays protected by CRON_SECRET: the job sends
--   Authorization: Bearer <CRON_SECRET>
-- exactly as the route expects (same value as the CRON_SECRET env var the
-- app is deployed with).
--
-- Run this ONCE in the Supabase SQL Editor. Safe to re-run — it unschedules
-- any prior copy of the job first.

-- ------------------------------------------------------------
-- 0. Enable the extensions (also available via
--    Dashboard → Database → Extensions).
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ------------------------------------------------------------
-- 1. Store the app URL + cron secret in Supabase Vault so they are
--    not hard-coded into the job definition.
--
--    Set these TWO values to match your deployment, then run once.
--    (Re-running create_secret with the same name errors, so update
--    instead if they already exist — see the UPDATE snippet below.)
-- ------------------------------------------------------------
-- First time only:
select vault.create_secret('https://aminocan.com', 'app_base_url');       -- no trailing slash
select vault.create_secret('YOUR_CRON_SECRET_HERE', 'cron_secret');       -- must equal the app's CRON_SECRET env var

-- To change them later instead of create_secret, use:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'app_base_url'),
--     'https://your-new-domain.com');
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'cron_secret'),
--     'your-new-secret');

-- ------------------------------------------------------------
-- 2. (Re)schedule the hourly job.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'abandoned-registrations') THEN
    PERFORM cron.unschedule('abandoned-registrations');
  END IF;
END $$;

select cron.schedule(
  'abandoned-registrations',
  '0 * * * *',  -- top of every hour
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
           || '/api/cron/abandoned-registrations',
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
--   select jobid, jobname, schedule, active from cron.job where jobname = 'abandoned-registrations';
--
-- Recent runs (status / return message):
--   select * from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'abandoned-registrations')
--   order by start_time desc limit 10;
--
-- Inspect the actual HTTP responses pg_net recorded:
--   select id, status_code, content from net._http_response order by id desc limit 10;
--
-- Remove the job entirely:
--   select cron.unschedule('abandoned-registrations');
