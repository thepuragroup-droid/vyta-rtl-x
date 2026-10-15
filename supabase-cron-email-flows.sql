-- ============================================================
-- SUPABASE CRON — email flows (welcome + cart abandonment)
-- ============================================================
--
-- Calls GET /api/cron/email-flows every 15 minutes. Each run enrolls newly
-- abandoned carts and consenting new signups, stops anyone who has purchased,
-- and sends whatever email is due inside each person's local send window
-- (9-11 AM by default; the first email of each flow is never held for it).
-- 15 minutes keeps the one-hour cart reminder close to on time and the
-- two-hour window well covered. Overlapping runs are harmless: every send is
-- claimed in the database before it goes out.
--
-- Uses the same Vault secrets as supabase-cron-abandoned-registrations.sql
-- (`app_base_url`, `cron_secret`). If you have not run that file, create them
-- first:
--   select vault.create_secret('https://www.vytabio.com', 'app_base_url');
--   select vault.create_secret('YOUR_CRON_SECRET_HERE', 'cron_secret');
--
-- Run email-flows-migration.sql before this. Safe to re-run. If you scheduled
-- the earlier 'welcome-flow' job from the first draft, this replaces it.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'welcome-flow') THEN
    PERFORM cron.unschedule('welcome-flow');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'email-flows') THEN
    PERFORM cron.unschedule('email-flows');
  END IF;
END $$;

select cron.schedule(
  'email-flows',
  '*/15 * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
           || '/api/cron/email-flows',
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
--   where jobid = (select jobid from cron.job where jobname = 'email-flows')
--   order by start_time desc limit 10;
--
-- Stop it:
--   select cron.unschedule('email-flows');
