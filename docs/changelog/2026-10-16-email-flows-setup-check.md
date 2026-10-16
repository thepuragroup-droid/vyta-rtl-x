# 2026-10-16 — Email flows: setup check

## Summary

A new **Setup check** tab on **Admin → Email Flows** checks that everything the
welcome and cart-abandonment flows need is configured and working. Each check
shows **OK**, **Warning**, **Problem** or **Info**, and every warning or
problem says how to fix it. The check runs when you open the tab, and
**Check again** runs it once more. It also appears on its own while the
database migration hasn't been run, when the other tabs have nothing to show.

| Group | What it checks |
|---|---|
| Sending | `SMTP_HOST` / `SMTP_USER` / `SMTP_PASSWORD` are set; the port; a **real sign-in to the SMTP server** (nothing is sent); the From address and whether its domain matches the SMTP login; SPF and DMARC on the From domain; the CASL footer address |
| Database | every table and column the flows read and write, including the store tables they depend on (`customers`, `discount_codes`, `puramass_orders`, …), and the open/click counter |
| Scheduler | `CRON_SECRET`; the Supabase Cron job (scheduled, active, last run, failures in the last 24 h); the Vault secrets `app_base_url` (matches the live site) and `cron_secret` (matches the app's `CRON_SECRET`); and **when a scheduled run last reached the app** |
| Links | `EMAIL_FLOWS_SECRET`, which signs the unsubscribe, open and click links |
| Each flow | on or off; discount codes chosen and usable; merge tags; whether storefront carts are being saved (cart flow) |
| Recent sends | emails sent, failed (with the latest error) and cut off mid-send in the last 7 days |

A problem that only matters once a flow is live (a missing code, the
scheduler) is a **Warning** while the flow is off and a **Problem** once it is on.

The same check runs from the command line and exits 1 when anything fails:

```
npx tsx scripts/email-flows-check.ts            # every check
npx tsx scripts/email-flows-check.ts --issues   # only problems and warnings
```

## To do once

Run **`email-flows-health-migration.sql`** in the Supabase SQL editor. It adds:

- `email_flow_settings.last_cron_at`, stamped by `/api/cron/email-flows` on
  every authorised call. This shows the scheduler reaches the app with the
  right secret.
- `email_flows_cron_status()`, which lets the app see the pg_cron job and the
  Vault secrets. The cron secret itself is never returned. The function
  returns only its SHA-256 hash, which the check compares with the app's.

The check still runs without the migration. It just reports that it can't see
the scheduler.

## Also fixed

`/api/cron/email-flows` now refuses every call when `CRON_SECRET` is unset.
Before, the header `Authorization: Bearer undefined` was accepted.

## Files

- `lib/email-flows/health-rules.ts`: the verdicts (pure and unit-tested).
- `lib/email-flows/health.ts`: the probes (SMTP, DNS, Supabase).
- `lib/email-flows/health.test.ts`: `npx tsx --test lib/email-flows/health.test.ts`
- `app/api/admin/email-flows/health/route.ts`: `GET`, staff only.
- `components/admin/email-flows/HealthTab.tsx`
- `lib/smtp.ts`: `verifySmtp()` signs in to the SMTP server with short timeouts.
- `scripts/email-flows-check.ts`
- `email-flows-health-migration.sql`
