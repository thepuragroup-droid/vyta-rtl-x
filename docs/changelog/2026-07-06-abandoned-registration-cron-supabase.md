# 2026-07-06 — Abandoned-Registration Cron: Vercel → Supabase Cron

## Summary
Switched the scheduling of the abandoned-registration alert from **Vercel Cron** to **Supabase Cron** (`pg_cron` + `pg_net`). The alert logic and the API endpoint are unchanged — only *what triggers it on a schedule* moved. Instead of Vercel calling the endpoint, a Postgres cron job inside Supabase now makes the hourly HTTPS call. The endpoint stays protected by `CRON_SECRET`.

---

## What Changed

- **Removed** the `crons` block from `vercel.json`.
- **Added** `supabase-cron-abandoned-registrations.sql` — a one-time script for the Supabase SQL Editor that:
  - Enables the `pg_cron` and `pg_net` extensions.
  - Stores the app base URL and `CRON_SECRET` in **Supabase Vault** (so they aren't hard-coded into the job).
  - Schedules an **hourly** job (`0 * * * *`) that calls `GET /api/cron/abandoned-registrations` with an `Authorization: Bearer <CRON_SECRET>` header.
  - Is safe to re-run (unschedules any prior copy of the job first) and includes helper queries to inspect job runs and HTTP responses.
- Updated the endpoint's doc comment (`app/api/cron/abandoned-registrations/route.ts`) to point at the Supabase cron file instead of Vercel Cron.

The endpoint itself did not change: it still verifies `CRON_SECRET` and applies the same rules (active customers registered past the configured delay, within the last 7 days, who have never placed an order).

---

## Setup / Deploy Notes

1. Ensure `CRON_SECRET` is set as an app environment variable (protects the endpoint).
2. Open `supabase-cron-abandoned-registrations.sql` and set the two Vault values:
   - `app_base_url` — your deployed app URL (e.g. `https://aminocan.com`, no trailing slash).
   - `cron_secret` — the same value as the app's `CRON_SECRET`.
3. Run the script **once** in the Supabase SQL Editor.

To verify it's running:
```sql
select * from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'abandoned-registrations')
order by start_time desc limit 10;
```

To change the URL/secret later, use the `vault.update_secret(...)` snippets included in the file (re-running `create_secret` with an existing name errors).

---

## Files Touched
- **Added:** `supabase-cron-abandoned-registrations.sql`
- **Modified:** `vercel.json` (removed `crons`), `app/api/cron/abandoned-registrations/route.ts` (doc comment)
