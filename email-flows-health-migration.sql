-- ============================================================
-- EMAIL FLOWS — setup check (Admin → Email Flows → Setup check)
-- ============================================================
--
-- Lets the setup check see the scheduler, which lives inside Postgres where
-- the app can't otherwise look:
--
--   email_flow_settings.last_cron_at   stamped by GET /api/cron/email-flows on
--                                      every authorised call — proof the
--                                      Supabase job actually reaches the app
--                                      with the right secret.
--   email_flows_cron_status()          the 'email-flows' pg_cron job (scheduled?
--                                      active? last run?) and whether the Vault
--                                      secrets it calls with exist. The cron
--                                      secret itself is never returned, only
--                                      its SHA-256, which the app compares with
--                                      a hash of its own CRON_SECRET.
--
-- Optional: without it the check still runs and says what it can't see.
-- Run after email-flows-migration.sql. Idempotent: safe to re-run.

ALTER TABLE email_flow_settings ADD COLUMN IF NOT EXISTS last_cron_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION email_flows_cron_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  out      JSONB := jsonb_build_object('pg_cron', false, 'pg_net', false, 'vault', false, 'job', NULL);
  job      RECORD;
  last_run RECORD;
  failed   INTEGER;
  base_url TEXT;
  secret   TEXT;
BEGIN
  out := out || jsonb_build_object('pg_net', EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net'));

  IF to_regclass('cron.job') IS NOT NULL THEN
    out := out || jsonb_build_object('pg_cron', true);
    EXECUTE 'SELECT jobid, schedule, active, command FROM cron.job WHERE jobname = $1 LIMIT 1'
      INTO job USING 'email-flows';
    IF job.jobid IS NOT NULL THEN
      out := out || jsonb_build_object('job', jsonb_build_object(
        'schedule', job.schedule,
        'active', job.active,
        'calls_route', position('/api/cron/email-flows' IN job.command) > 0
      ));
      IF to_regclass('cron.job_run_details') IS NOT NULL THEN
        EXECUTE 'SELECT status, start_time, end_time, return_message FROM cron.job_run_details
                 WHERE jobid = $1 ORDER BY start_time DESC LIMIT 1'
          INTO last_run USING job.jobid;
        EXECUTE 'SELECT count(*) FROM cron.job_run_details
                 WHERE jobid = $1 AND status = ''failed'' AND start_time > now() - interval ''24 hours'''
          INTO failed USING job.jobid;
        out := jsonb_set(out, '{job,failed_24h}', to_jsonb(COALESCE(failed, 0)));
        IF last_run.start_time IS NOT NULL THEN
          out := jsonb_set(out, '{job,last_run}', jsonb_build_object(
            'status', last_run.status,
            'start_time', last_run.start_time,
            'end_time', last_run.end_time,
            'message', left(last_run.return_message, 300)
          ));
        END IF;
      END IF;
    END IF;
  END IF;

  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    out := out || jsonb_build_object('vault', true);
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1' INTO base_url USING 'app_base_url';
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1' INTO secret USING 'cron_secret';
    out := out || jsonb_build_object(
      'app_base_url', base_url,
      'cron_secret_sha256', CASE WHEN secret IS NULL THEN NULL
                                 ELSE encode(sha256(convert_to(secret, 'UTF8')), 'hex') END
    );
  END IF;

  RETURN out;
END;
$$;

REVOKE ALL ON FUNCTION email_flows_cron_status() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION email_flows_cron_status() TO service_role;

NOTIFY pgrst, 'reload schema';

-- Verification:
--   select email_flows_cron_status();
