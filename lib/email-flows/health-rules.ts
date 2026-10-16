/**
 * Email flows — the setup check's rules.
 *
 * Turns what the server found (env vars, the SMTP login, the scheduler, each
 * flow's settings, recent sends) into a list of plain-language checks, each
 * passing, warning or failing with the fix spelled out. The probing itself is
 * in ./health.ts; everything here is pure, so the admin page can import the
 * types and the tests can pin the verdicts.
 *
 *   pass  configured and working
 *   warn  works, but something will bite later (or blocks switching a flow on)
 *   fail  emails will not go out, or go out wrong, until it is fixed
 *   info  worth knowing, nothing to fix
 */
import {
  FLOWS,
  MAX_SEND_ATTEMPTS,
  MISSING_CODE_MESSAGE,
  normalizeCode,
  requiresCode,
  type CodeCheck,
  type FlowKey,
  type FlowSettings,
  type FlowStep,
} from './types';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info';

export const CHECK_GROUPS = ['Sending', 'Database', 'Scheduler', 'Links', 'Welcome Flow', 'Cart Abandonment', 'Recent sends'] as const;
export type CheckGroup = (typeof CHECK_GROUPS)[number];

export interface HealthCheck {
  id: string;
  group: CheckGroup;
  label: string;
  status: CheckStatus;
  detail: string;
  /** What to do about it — only on warn / fail. */
  fix?: string;
}

export interface HealthReport {
  checkedAt: string;
  /** No failures. Warnings don't stop email going out. */
  ok: boolean;
  counts: Record<CheckStatus, number>;
  checks: HealthCheck[];
}

export const MIGRATION = 'email-flows-migration.sql';
export const HEALTH_MIGRATION = 'email-flows-health-migration.sql';
export const TRACKING_MIGRATION = 'email-flows-tracking-migration.sql';
export const CRON_FILE = 'supabase-cron-email-flows.sql';
/** The cron runs every 15 minutes; this long without one means it has stopped. */
export const CRON_STALE_MINUTES = 45;
/** A send left 'sending' this long was cut off mid-SMTP — and is never retried. */
export const STUCK_SENDING_MINUTES = 30;

type Env = Record<string, string | undefined>;

export function summarize(checks: HealthCheck[], now = new Date()): HealthReport {
  const counts: Record<CheckStatus, number> = { pass: 0, warn: 0, fail: 0, info: 0 };
  for (const c of checks) counts[c.status]++;
  return { checkedAt: now.toISOString(), ok: counts.fail === 0, counts, checks };
}

const ago = (from: Date, now: Date) => {
  const min = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60000));
  if (min < 1) return 'just now';
  if (min < 90) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} hours ago`;
  return `${Math.round(h / 24)} days ago`;
};

// ---------------------------------------------------------------------------
// Sending — SMTP settings and the From address
// ---------------------------------------------------------------------------

/** The address inside `Name <addr@domain>` or a bare address; null when there is none. */
export function fromAddress(from: string): string | null {
  const m = from.match(/<([^<>\s]+@[^<>\s]+)>/) ?? from.trim().match(/^([^\s<>]+@[^\s<>]+)$/);
  return m ? m[1].toLowerCase() : null;
}

export function emailDomain(addr: string | null | undefined): string | null {
  const at = String(addr ?? '').lastIndexOf('@');
  return at > 0 ? String(addr).slice(at + 1).toLowerCase() : null;
}

/** The From header every flow email carries — the same fallbacks as lib/smtp.ts. */
export function effectiveFrom(env: Env): { from: string; source: 'SMTP_FROM' | 'SMTP_USER' | 'EMAIL_FROM' | 'default' } {
  if (env.SMTP_FROM) return { from: env.SMTP_FROM, source: 'SMTP_FROM' };
  if (env.SMTP_USER) return { from: env.SMTP_USER, source: 'SMTP_USER' };
  if (env.EMAIL_FROM) return { from: env.EMAIL_FROM, source: 'EMAIL_FROM' };
  return { from: 'VYTA <noreply@aminocan.com>', source: 'default' };
}

/** True when SMTP_HOST, SMTP_USER and SMTP_PASSWORD are all set — the login can be tried. */
export function smtpConfigured(env: Env): boolean {
  return !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD);
}

export function smtpEnvChecks(env: Env): HealthCheck[] {
  const out: HealthCheck[] = [];
  const missing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'].filter((k) => !env[k]);
  out.push(
    missing.length
      ? {
          id: 'smtp-env',
          group: 'Sending',
          label: 'SMTP settings',
          status: 'fail',
          detail: `Not set: ${missing.join(', ')}. No email of any kind can be sent.`,
          fix: 'Add them to the deployment’s environment variables (Vercel → Settings → Environment Variables) and redeploy.',
        }
      : { id: 'smtp-env', group: 'Sending', label: 'SMTP settings', status: 'pass', detail: `${env.SMTP_HOST}, signing in as ${env.SMTP_USER}.` },
  );

  const rawPort = env.SMTP_PORT;
  const port = Number(rawPort) || 587;
  if (rawPort && !(Number(rawPort) > 0 && Number(rawPort) < 65536)) {
    out.push({
      id: 'smtp-port', group: 'Sending', label: 'SMTP port', status: 'fail',
      detail: `SMTP_PORT is "${rawPort}", which is not a port number.`,
      fix: 'Set SMTP_PORT to 587 (STARTTLS) or 465 (TLS).',
    });
  } else if (port === 25) {
    out.push({
      id: 'smtp-port', group: 'Sending', label: 'SMTP port', status: 'warn',
      detail: 'Port 25 is blocked by most hosting providers, including Vercel.',
      fix: 'Use 587 (STARTTLS) or 465 (TLS) if your mail server offers them.',
    });
  } else {
    out.push({
      id: 'smtp-port', group: 'Sending', label: 'SMTP port', status: 'pass',
      detail: `${port} — ${port === 465 ? 'TLS from the start' : 'STARTTLS required'}${rawPort ? '' : ' (SMTP_PORT not set; the default)'}.`,
    });
  }

  const { from, source } = effectiveFrom(env);
  const addr = fromAddress(from);
  const userDomain = emailDomain(env.SMTP_USER);
  if (!addr) {
    out.push({
      id: 'smtp-from', group: 'Sending', label: 'From address', status: 'fail',
      detail: `The From header would be "${from}" (from ${source}), which has no email address in it.`,
      fix: 'Set SMTP_FROM to something like "VYTA <hello@vytabio.com>".',
    });
  } else if (source === 'default') {
    out.push({
      id: 'smtp-from', group: 'Sending', label: 'From address', status: 'fail',
      detail: `Nothing sets the sender, so emails would go from the built-in fallback ${addr}.`,
      fix: 'Set SMTP_FROM to the address customers should see, e.g. "VYTA <hello@vytabio.com>".',
    });
  } else if (userDomain && emailDomain(addr) !== userDomain) {
    out.push({
      id: 'smtp-from', group: 'Sending', label: 'From address', status: 'warn',
      detail: `Emails go from ${addr}, but the server signs in as a ${userDomain} account. Many servers reject or rewrite a From address on another domain, and inboxes treat it as spoofing unless that domain authorises the server.`,
      fix: `Send from an address on ${userDomain}, or make sure the SMTP server is allowed to send for ${emailDomain(addr)} (SPF + DKIM).`,
    });
  } else {
    out.push({
      id: 'smtp-from', group: 'Sending', label: 'From address', status: 'pass',
      detail: `${from}${source === 'SMTP_FROM' ? '' : ` (from ${source}; set SMTP_FROM to add a display name)`}.`,
    });
  }
  return out;
}

export function smtpLoginCheck(res: { ok: boolean; error?: string; ms: number } | null): HealthCheck {
  if (!res) {
    return {
      id: 'smtp-login', group: 'Sending', label: 'SMTP sign-in', status: 'fail',
      detail: 'Not tried — the SMTP settings above are incomplete.',
      fix: 'Fix the SMTP settings, then run the check again.',
    };
  }
  if (res.ok) {
    return { id: 'smtp-login', group: 'Sending', label: 'SMTP sign-in', status: 'pass', detail: `Connected, secured and signed in (${res.ms} ms). Nothing was sent.` };
  }
  const e = res.error ?? '';
  const hint = /auth|535|534|credentials|username|password/i.test(e)
    ? 'The server rejected the login — check SMTP_USER and SMTP_PASSWORD (some providers need an app password).'
    : /timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(e)
      ? 'The server could not be reached — check SMTP_HOST and SMTP_PORT, and that the host accepts connections from the internet.'
      : /certificate|TLS|SSL|wrong version/i.test(e)
        ? 'The secure connection failed — 465 expects TLS from the start, 587 expects STARTTLS. Check SMTP_PORT matches the server.'
        : 'Check SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASSWORD.';
  return { id: 'smtp-login', group: 'Sending', label: 'SMTP sign-in', status: 'fail', detail: `Failed: ${e}`, fix: hint };
}

/** TXT records, or the DNS error code. */
export type TxtLookup = { records: string[] } | { error: string };

/** SPF and DMARC on the From domain — without them, flow emails land in spam. */
export function dnsChecks(domain: string | null, spf: TxtLookup | null, dmarc: TxtLookup | null): HealthCheck[] {
  if (!domain || !spf || !dmarc) return [];
  const out: HealthCheck[] = [];
  const spfRecs = 'records' in spf ? spf.records.filter((r) => /^v=spf1\b/i.test(r)) : [];
  if ('error' in spf && !/ENODATA|ENOTFOUND/.test(spf.error)) {
    out.push({ id: 'dns-spf', group: 'Sending', label: `SPF for ${domain}`, status: 'info', detail: `Couldn't look it up (${spf.error}).` });
  } else if (!spfRecs.length) {
    out.push({
      id: 'dns-spf', group: 'Sending', label: `SPF for ${domain}`, status: 'warn',
      detail: 'No SPF record — Gmail and Outlook are likely to send flow emails to spam, or refuse them.',
      fix: `Add a TXT record on ${domain} that includes your mail server, e.g. "v=spf1 include:<your provider> ~all".`,
    });
  } else if (spfRecs.length > 1) {
    out.push({
      id: 'dns-spf', group: 'Sending', label: `SPF for ${domain}`, status: 'warn',
      detail: `${spfRecs.length} SPF records — more than one makes SPF fail outright.`,
      fix: 'Merge them into a single "v=spf1 …" TXT record.',
    });
  } else {
    out.push({ id: 'dns-spf', group: 'Sending', label: `SPF for ${domain}`, status: 'pass', detail: spfRecs[0] });
  }

  const dmarcRecs = 'records' in dmarc ? dmarc.records.filter((r) => /^v=DMARC1\b/i.test(r)) : [];
  if ('error' in dmarc && !/ENODATA|ENOTFOUND/.test(dmarc.error)) {
    out.push({ id: 'dns-dmarc', group: 'Sending', label: `DMARC for ${domain}`, status: 'info', detail: `Couldn't look it up (${dmarc.error}).` });
  } else if (!dmarcRecs.length) {
    out.push({
      id: 'dns-dmarc', group: 'Sending', label: `DMARC for ${domain}`, status: 'warn',
      detail: 'No DMARC record. Gmail and Yahoo require one from anyone sending marketing email in volume.',
      fix: `Add a TXT record at _dmarc.${domain}, e.g. "v=DMARC1; p=none; rua=mailto:dmarc@${domain}". DKIM signing is set up with your mail provider.`,
    });
  } else {
    out.push({ id: 'dns-dmarc', group: 'Sending', label: `DMARC for ${domain}`, status: 'pass', detail: dmarcRecs[0] });
  }
  return out;
}

export function footerCheck(settings: Pick<FlowSettings, 'footer_address'> | null): HealthCheck | null {
  if (!settings) return null;
  return settings.footer_address.trim()
    ? { id: 'footer', group: 'Sending', label: 'Footer mailing address', status: 'pass', detail: settings.footer_address }
    : {
        id: 'footer', group: 'Sending', label: 'Footer mailing address', status: 'fail',
        detail: 'Empty. Canadian anti-spam law (CASL) requires a mailing address in every commercial email.',
        fix: 'Add it in the Settings tab of either flow — it is shared by both.',
      };
}

// ---------------------------------------------------------------------------
// Database — tables, columns and the tables the flows read from
// ---------------------------------------------------------------------------

export interface TableProbe {
  table: string;
  columns: string;
  /** The flows' own tables are fixed by the migration; the rest are the store's. */
  own: boolean;
  why: string;
}

export const TABLE_PROBES: TableProbe[] = [
  { table: 'email_flow_settings', own: true, why: 'each flow’s switch and send window', columns: 'flow, enabled, enabled_at, send_window_start, send_window_end, default_timezone, min_gap_hours, reentry_days, footer_address, footer_disclaimer' },
  { table: 'email_flow_steps', own: true, why: 'the five emails of each flow', columns: 'flow, step, enabled, delay_hours, deadline_hours, show_cart, promo_code, hero_overlay, hero_text_tone, hero_image_ratio' },
  { table: 'email_flow_entries', own: true, why: 'who is in each flow', columns: 'id, flow, status, consent_basis, cart_id, last_step, paused_reason' },
  { table: 'email_flow_sends', own: true, why: 'every email sent, with opens and clicks', columns: 'id, entry_id, status, attempts, body_html' },
  { table: 'email_flow_suppressions', own: true, why: 'unsubscribes', columns: 'email, reason' },
  { table: 'saved_carts', own: true, why: 'the carts the cart flow emails about', columns: 'id, restore_token, items, status, checkout_ref, updated_at' },
  { table: 'customers', own: false, why: 'signups, consent and time zones', columns: 'id, email, first_name, role, active, contact_consent, has_completed_first_order, shipping_state, shipping_country, created_at' },
  { table: 'discount_codes', own: false, why: 'the codes the offer emails print', columns: 'id, code, active, discount_type, discount_value, starts_at, expires_at, max_uses' },
  { table: 'puramass_orders', own: false, why: 'purchases that stop a flow, and unpaid checkouts', columns: 'partner_reference, customer_id, customer_email, subtotal_cents, currency, status, paid_at, discount_code_id, created_at' },
  { table: 'orders', own: false, why: 'purchases on the older checkout', columns: 'order_number, customer_id, email, total, status, created_at' },
  { table: 'visitor_attribution', own: false, why: 'the email behind a guest’s cart', columns: 'anonymous_id, customer_email, customer_id' },
  { table: 'customer_emails', own: false, why: 'the customer desk’s email history', columns: 'id' },
];

export function tableCheck(p: TableProbe, error: { code?: string; message?: string } | null): HealthCheck {
  const label = p.table;
  if (!error) return { id: `db-${p.table}`, group: 'Database', label, status: 'pass', detail: `Readable — ${p.why}.` };
  const msg = error.message ?? 'unknown error';
  const missingTable = error.code === '42P01' || error.code === 'PGRST205' || /relation .* does not exist|could not find the table/i.test(msg);
  const missingColumn = error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(msg);
  return {
    id: `db-${p.table}`,
    group: 'Database',
    label,
    status: 'fail',
    detail: missingTable ? `Missing — ${p.why} can’t be read.` : missingColumn ? `Out of date: ${msg}` : `Can’t be read: ${msg}`,
    fix: p.own
      ? `Run ${MIGRATION} in the Supabase SQL editor (safe to re-run).`
      : missingTable || missingColumn
        ? 'The flows read this from the store’s own schema — run the store migrations that add it.'
        : 'Check SUPABASE_SERVICE_ROLE_KEY and that the database is up.',
  };
}

export function trackFunctionCheck(error: { code?: string; message?: string } | null): HealthCheck {
  return error
    ? {
        id: 'db-track', group: 'Database', label: 'Open & click counter', status: 'warn',
        detail: `email_flow_track() can’t be called (${error.message ?? error.code}). Emails still send, but opens and clicks aren’t counted.`,
        fix: `Run ${MIGRATION} in the Supabase SQL editor.`,
      }
    : { id: 'db-track', group: 'Database', label: 'Open & click counter', status: 'pass', detail: 'email_flow_track() is in place.' };
}

/**
 * The post-send tracking (email_flow_events + entries.converted_via). Optional:
 * flows send and convert without it, so a gap is a warning, never a failure.
 */
export function trackingCheck(error: { code?: string; message?: string } | null): HealthCheck {
  return error
    ? {
        id: 'db-tracking', group: 'Database', label: 'Post-click tracking', status: 'warn',
        detail: 'Not recording what happens after an email is opened — mail-scanner clicks aren’t told apart from people, and checkouts and sales aren’t tied to the click that led to them.',
        fix: `Run ${TRACKING_MIGRATION} in the Supabase SQL editor (safe to re-run).`,
      }
    : {
        id: 'db-tracking', group: 'Database', label: 'Post-click tracking', status: 'pass',
        detail: 'Recording opens, clicks, checkouts and sales per email, with mail scanners filtered out.',
      };
}

// ---------------------------------------------------------------------------
// Scheduler — Supabase Cron → /api/cron/email-flows
// ---------------------------------------------------------------------------

/** What email_flows_cron_status() returns. */
export interface CronStatus {
  pg_cron: boolean;
  pg_net: boolean;
  vault: boolean;
  job: null | {
    schedule: string;
    active: boolean;
    calls_route: boolean;
    failed_24h?: number;
    last_run?: { status: string; start_time: string; end_time: string | null; message: string | null };
  };
  app_base_url?: string | null;
  cron_secret_sha256?: string | null;
}

export interface SchedulerInput {
  env: Env;
  siteUrl: string;
  /** null = email_flows_cron_status() isn't installed. */
  cron: CronStatus | null;
  /** SHA-256 hex of the app's CRON_SECRET. */
  cronSecretSha256: string | null;
  /** undefined = the last_cron_at column isn't there yet. */
  lastCronAt: string | null | undefined;
  anyFlowOn: boolean;
  now: Date;
}

const originOf = (u: string) => {
  try {
    return new URL(u).origin.replace('://www.', '://');
  } catch {
    return null;
  }
};

export function schedulerChecks(s: SchedulerInput): HealthCheck[] {
  const out: HealthCheck[] = [];
  // Off flows send nothing anyway — a scheduler problem only blocks once one is on.
  const bad: CheckStatus = s.anyFlowOn ? 'fail' : 'warn';

  out.push(
    s.env.CRON_SECRET
      ? { id: 'cron-secret', group: 'Scheduler', label: 'CRON_SECRET', status: 'pass', detail: 'Set in the app.' }
      : {
          id: 'cron-secret', group: 'Scheduler', label: 'CRON_SECRET', status: bad,
          detail: 'Not set, so /api/cron/email-flows refuses every call and nothing after Email 1 is ever sent.',
          fix: 'Add CRON_SECRET to the deployment’s environment variables (any long random string) and store the same value in the Supabase Vault as cron_secret.',
        },
  );

  if (!s.cron) {
    out.push({
      id: 'cron-job', group: 'Scheduler', label: 'Supabase Cron job', status: 'info',
      detail: 'Can’t be seen from the app yet.',
      fix: `Run ${HEALTH_MIGRATION} in the Supabase SQL editor so this check can read the job, its last run and the Vault secrets.`,
    });
  } else {
    const c = s.cron;
    if (!c.pg_cron || !c.pg_net) {
      const missing = [!c.pg_cron && 'pg_cron', !c.pg_net && 'pg_net'].filter(Boolean).join(' and ');
      out.push({
        id: 'cron-ext', group: 'Scheduler', label: 'Cron extensions', status: bad,
        detail: `${missing} ${missing.includes('and') ? 'are' : 'is'} not enabled in Supabase.`,
        fix: `Run ${CRON_FILE} — it enables both and schedules the job.`,
      });
    }
    if (!c.job) {
      if (c.pg_cron) {
        out.push({
          id: 'cron-job', group: 'Scheduler', label: 'Supabase Cron job', status: bad,
          detail: 'No "email-flows" job is scheduled, so only Email 1 of the welcome flow ever sends — and the cart flow sends nothing.',
          fix: `Run ${CRON_FILE} in the Supabase SQL editor.`,
        });
      }
    } else {
      const j = c.job;
      if (!j.active) {
        out.push({
          id: 'cron-job', group: 'Scheduler', label: 'Supabase Cron job', status: bad,
          detail: `"email-flows" is scheduled (${j.schedule}) but paused.`,
          fix: `Re-run ${CRON_FILE}, or: update cron.job set active = true where jobname = 'email-flows';`,
        });
      } else if (!j.calls_route) {
        out.push({
          id: 'cron-job', group: 'Scheduler', label: 'Supabase Cron job', status: bad,
          detail: '"email-flows" is scheduled but doesn’t call /api/cron/email-flows.',
          fix: `Re-run ${CRON_FILE} to replace it.`,
        });
      } else {
        out.push({ id: 'cron-job', group: 'Scheduler', label: 'Supabase Cron job', status: 'pass', detail: `"email-flows" runs on "${j.schedule}".` });
      }
      if (j.last_run) {
        const failed = j.last_run.status === 'failed';
        out.push({
          id: 'cron-last-run', group: 'Scheduler', label: 'Last scheduled run', status: failed ? bad : 'pass',
          detail: `${j.last_run.status}, ${ago(new Date(j.last_run.start_time), s.now)}${failed && j.last_run.message ? ` — ${j.last_run.message}` : ''}${j.failed_24h ? ` · ${j.failed_24h} failed in the last 24 h` : ''}.`,
          ...(failed ? { fix: 'Usually a missing Vault secret (app_base_url / cron_secret) or pg_net not enabled — see the checks above.' } : {}),
        });
      }
    }

    if (c.vault) {
      const base = c.app_base_url ?? null;
      if (!base) {
        out.push({
          id: 'cron-base-url', group: 'Scheduler', label: 'Vault: app_base_url', status: bad,
          detail: 'Missing — the job doesn’t know which site to call.',
          fix: `select vault.create_secret('${s.siteUrl}', 'app_base_url');`,
        });
      } else if (originOf(base) !== originOf(s.siteUrl)) {
        out.push({
          id: 'cron-base-url', group: 'Scheduler', label: 'Vault: app_base_url', status: 'warn',
          detail: `It is ${base}, but the live site is ${s.siteUrl}. The job may be calling the wrong deployment.`,
          fix: `select vault.update_secret((select id from vault.secrets where name = 'app_base_url'), '${s.siteUrl}');`,
        });
      } else {
        out.push({ id: 'cron-base-url', group: 'Scheduler', label: 'Vault: app_base_url', status: 'pass', detail: base });
      }

      if (!c.cron_secret_sha256) {
        out.push({
          id: 'cron-vault-secret', group: 'Scheduler', label: 'Vault: cron_secret', status: bad,
          detail: 'Missing — the job can’t authenticate with the app.',
          fix: "select vault.create_secret('<the same value as CRON_SECRET>', 'cron_secret');",
        });
      } else if (s.cronSecretSha256 && c.cron_secret_sha256 !== s.cronSecretSha256) {
        out.push({
          id: 'cron-vault-secret', group: 'Scheduler', label: 'Vault: cron_secret', status: bad,
          detail: 'Doesn’t match the app’s CRON_SECRET, so every scheduled call is refused (401).',
          fix: "select vault.update_secret((select id from vault.secrets where name = 'cron_secret'), '<the value of CRON_SECRET>');",
        });
      } else if (s.cronSecretSha256) {
        out.push({ id: 'cron-vault-secret', group: 'Scheduler', label: 'Vault: cron_secret', status: 'pass', detail: 'Matches the app’s CRON_SECRET.' });
      }
    }
  }

  // The proof: the job reached the app, with the right secret, recently.
  if (s.lastCronAt === undefined) {
    if (s.cron) {
      out.push({
        id: 'cron-heartbeat', group: 'Scheduler', label: 'Scheduler reaching the app', status: 'info',
        detail: 'Not recorded yet.',
        fix: `Re-run ${HEALTH_MIGRATION}.`,
      });
    }
  } else if (!s.lastCronAt) {
    out.push({
      id: 'cron-heartbeat', group: 'Scheduler', label: 'Scheduler reaching the app', status: bad,
      detail: 'No scheduled run has reached /api/cron/email-flows since this check was installed.',
      fix: `Allow up to 15 minutes after installing. If it stays like this, check the job, the Vault secrets and CRON_SECRET above.`,
    });
  } else {
    const at = new Date(s.lastCronAt);
    const stale = s.now.getTime() - at.getTime() > CRON_STALE_MINUTES * 60000;
    out.push({
      id: 'cron-heartbeat', group: 'Scheduler', label: 'Scheduler reaching the app', status: stale ? bad : 'pass',
      detail: `Last authorised run ${ago(at, s.now)}.${stale ? ' It should run every 15 minutes.' : ''}`,
      ...(stale ? { fix: 'The job has stopped, is paused, or is being refused — check the job, the Vault secrets and CRON_SECRET above.' } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Links — the signing secret behind unsubscribe, open and click links
// ---------------------------------------------------------------------------

export function signingSecretCheck(env: Env): HealthCheck {
  if (env.EMAIL_FLOWS_SECRET) {
    return { id: 'link-secret', group: 'Links', label: 'Link signing secret', status: 'pass', detail: 'EMAIL_FLOWS_SECRET is set.' };
  }
  const fallback = env.CRON_SECRET ? 'CRON_SECRET' : env.SUPABASE_SERVICE_ROLE_KEY ? 'SUPABASE_SERVICE_ROLE_KEY' : null;
  if (!fallback) {
    return {
      id: 'link-secret', group: 'Links', label: 'Link signing secret', status: 'fail',
      detail: 'No secret to sign unsubscribe, open and click links with — every flow email fails to build.',
      fix: 'Set EMAIL_FLOWS_SECRET (any long random string) in the deployment’s environment variables.',
    };
  }
  return {
    id: 'link-secret', group: 'Links', label: 'Link signing secret', status: 'warn',
    detail: `EMAIL_FLOWS_SECRET isn’t set, so links are signed with ${fallback}. Rotating ${fallback} would break the unsubscribe link in every email already sent.`,
    fix: 'Set EMAIL_FLOWS_SECRET to its own value. Do it before the flows have sent much — it also changes the links in emails already out.',
  };
}

// ---------------------------------------------------------------------------
// Each flow — switch, codes and copy
// ---------------------------------------------------------------------------

export interface FlowCheckInput {
  flow: FlowKey;
  settings: FlowSettings;
  steps: FlowStep[];
  /** Normalised code → its check against discount_codes. */
  codes: Map<string, CodeCheck>;
  /** Step → merge-tag problems. */
  problems: Map<number, string[]>;
  /** Cart flow: when the newest saved cart changed. undefined = not looked up. */
  latestCartAt?: string | null;
  now: Date;
}

export function flowChecks(f: FlowCheckInput): HealthCheck[] {
  const group = FLOWS[f.flow].label as CheckGroup;
  const id = (s: string) => `${f.flow}-${s}`;
  const on = f.settings.enabled;
  // On: the email is held right now. Off: it blocks switching on.
  const bad: CheckStatus = on ? 'fail' : 'warn';
  const out: HealthCheck[] = [];

  out.push({
    id: id('switch'), group, label: 'Switched on', status: 'info',
    detail: on
      ? `On since ${f.settings.enabled_at ? new Date(f.settings.enabled_at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'an unknown time'}.`
      : 'Off — nothing in this flow sends until it is switched on.',
  });

  const live = f.steps.filter((s) => s.enabled);
  if (!live.length) {
    out.push({
      id: id('steps'), group, label: 'Emails', status: 'warn',
      detail: 'All five emails are switched off — the flow would send nothing.',
      fix: 'Switch at least one email on in the Emails tab.',
    });
  }

  const codeIssues: string[] = [];
  for (const s of live) {
    if (requiresCode(f.flow, s.step) && !s.promo_code) {
      codeIssues.push(`Email ${s.step} offers a discount but has no code chosen.`);
      continue;
    }
    if (!s.promo_code) continue;
    const c = f.codes.get(normalizeCode(s.promo_code));
    if (c && !c.usable) codeIssues.push(`Email ${s.step}: ${c.problem}`);
  }
  const withCodes = live.filter((s) => s.promo_code).map((s) => `${s.promo_code}`);
  out.push(
    codeIssues.length
      ? {
          id: id('codes'), group, label: 'Discount codes', status: bad,
          detail: `${codeIssues.join(' ')}${on ? ' Those emails are on hold until it is fixed.' : ' The flow can’t be switched on until it is.'}`,
          fix: 'Choose a working code in the Emails tab, or fix the code in Discount Codes.',
        }
      : {
          id: id('codes'), group, label: 'Discount codes', status: 'pass',
          detail: withCodes.length ? `${[...new Set(withCodes)].join(', ')} — active and usable.` : 'No email in this flow uses a code.',
        },
  );

  // A missing code is already the Discount codes row's finding.
  const copyIssues = live.flatMap((s) =>
    (f.problems.get(s.step) ?? []).filter((p) => !p.startsWith(MISSING_CODE_MESSAGE)).map((p) => `Email ${s.step}: ${p}`),
  );
  out.push(
    copyIssues.length
      ? { id: id('copy'), group, label: 'Merge tags', status: 'warn', detail: copyIssues.join(' '), fix: 'Fix the wording in the Emails tab.' }
      : { id: id('copy'), group, label: 'Merge tags', status: 'pass', detail: 'Every {{tag}} in the live emails has a value.' },
  );

  const firstLive = live[0];
  if (f.flow === 'welcome' && firstLive && firstLive.step !== 1) {
    out.push({
      id: id('first'), group, label: 'First email', status: 'info',
      detail: `Email 1 is off, so the series starts with Email ${firstLive.step} — sent by the 15-minute scheduler rather than at signup.`,
    });
  }

  if (f.flow === 'cart' && f.latestCartAt !== undefined) {
    const stale = !f.latestCartAt || f.now.getTime() - Date.parse(f.latestCartAt) > 7 * 864e5;
    out.push(
      stale
        ? {
            id: id('carts'), group, label: 'Carts being saved', status: on ? 'warn' : 'info',
            detail: f.latestCartAt
              ? `The newest saved cart changed ${ago(new Date(f.latestCartAt), f.now)}. Storefront carts may not be reaching the server.`
              : 'No storefront cart has been saved yet. Abandoned Stealth Health checkouts still count.',
            ...(on ? { fix: 'Add something to the cart on the live site (signed in, or after accepting cookies) and run this check again.' } : {}),
          }
        : { id: id('carts'), group, label: 'Carts being saved', status: 'pass', detail: `Newest saved cart changed ${ago(new Date(f.latestCartAt!), f.now)}.` },
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Recent sends — what actually happened in the last 7 days
// ---------------------------------------------------------------------------

export interface RecentSendRow {
  flow: string;
  step: number;
  status: string;
  attempts: number;
  error: string | null;
  updated_at: string;
}

export function recentSendChecks(rows: RecentSendRow[], sentCount: number, now: Date): HealthCheck[] {
  const out: HealthCheck[] = [];
  out.push({
    id: 'sends-sent', group: 'Recent sends', label: 'Sent in the last 7 days', status: 'info',
    detail: `${sentCount} email${sentCount === 1 ? '' : 's'}.`,
  });

  const failed = rows.filter((r) => r.status === 'failed');
  if (failed.length) {
    const gaveUp = failed.filter((r) => r.attempts >= MAX_SEND_ATTEMPTS).length;
    const latest = [...failed].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    out.push({
      id: 'sends-failed', group: 'Recent sends', label: 'Failed sends', status: gaveUp ? 'fail' : 'warn',
      detail: `${failed.length} in the last 7 days${gaveUp ? `, ${gaveUp} given up on after ${MAX_SEND_ATTEMPTS} tries` : ', still being retried'}. Latest (${FLOWS[latest.flow as FlowKey]?.label ?? latest.flow} ${latest.step}): ${latest.error ?? 'no error recorded'}`,
      fix: 'Usually SMTP — see the Sending checks above. Each person’s history is in the people tab.',
    });
  } else {
    out.push({ id: 'sends-failed', group: 'Recent sends', label: 'Failed sends', status: 'pass', detail: 'None in the last 7 days.' });
  }

  const stuck = rows.filter((r) => r.status === 'sending' && now.getTime() - Date.parse(r.updated_at) > STUCK_SENDING_MINUTES * 60000);
  if (stuck.length) {
    out.push({
      id: 'sends-stuck', group: 'Recent sends', label: 'Interrupted sends', status: 'warn',
      detail: `${stuck.length} email${stuck.length === 1 ? ' was' : 's were'} cut off mid-send (still "sending" after ${STUCK_SENDING_MINUTES} min). They may or may not have arrived, and are not retried.`,
      fix: 'Usually the run hit its time limit while the SMTP server was slow. If it keeps happening, check how quickly the server answers (SMTP sign-in above).',
    });
  }
  return out;
}
