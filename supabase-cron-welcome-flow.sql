-- ============================================================
-- SUPABASE CRON — welcome email flow
-- ============================================================
--
-- Calls GET /api/cron/welcome-flow every 15 minutes. Each run enrolls
-- consenting new signups, stops anyone who has purchased, and sends each
-- subscriber whatever email is due inside their local send window (9-11 AM by
-- default). 15 minutes keeps a two-hour window well covered; overlapping runs
-- are harmless — every send is claimed in the database before it goes out.
--
-- Uses the same Vault secrets as supabase-cron-abandoned-registrations.sql
-- (`app_base_url`, `cron_secret`). If you have not run that file, create them
-- first:
--   select vault.create_secret('https://www.vytabio.com', 'app_base_url');
--   select vault.create_secret('YOUR_CRON_SECRET_HERE', 'cron_secret');
--
-- Run welcome-flow-migration.sql before this. Safe to re-run.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'welcome-flow') THEN
    PERFORM cron.unschedule('welcome-flow');
  END IF;
END $$;

select cron.schedule(
  'welcome-flow',
  '*/15 * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
           || '/api/cron/welcome-flow',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);

-- Recent runs:
--   select * from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'welcome-flow')
--   order by start_time desc limit 10;
--
-- Stop it:
--   select cron.unschedule('welcome-flow');
