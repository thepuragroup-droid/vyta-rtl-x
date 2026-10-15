/**
 * Sends test copies of the flow emails — the same thing as Admin → Email
 * Flows → Test send, from the command line. Each email is rendered from its
 * saved settings in Supabase, with the details below in place of a real
 * customer's. Nobody is enrolled and nothing is tracked.
 *
 * Usage:
 *   npx tsx scripts/email-flows-test-send.ts --to you@example.com
 *   npx tsx scripts/email-flows-test-send.ts --to a@x.com,b@y.com --emails cart --name Sam --code VYTA20
 *   npx tsx scripts/email-flows-test-send.ts --emails welcome:1,welcome:4 --out ./email-tests   (write HTML, send nothing)
 *
 * Options (all optional except --to or --out):
 *   --to       Addresses, comma separated. Each gets its own copy. Up to 10.
 *   --emails   welcome:1 … cart:5, or a flow name for all five.   Default: all ten.
 *   --name     First name.                                         Default: Alex
 *   --code     Discount code for every email that offers one.      Default: each email's own.
 *   --tz       Time zone for the countdown's end time.             Default: the flow's.
 *   --cart     productId:packSize:quantity, comma separated.       Default: two catalogue products.
 *   --tag      Subject tag, "[Test · Cart 3] …". --tag "" for none. Default: Test
 *   --out      Also write each email to <dir>/<flow>-<step>.html. With no --to, only writes.
 *   --site     Origin for links and images.                         Default: the live site.
 *
 * Reads .env.local if present. Needs SUPABASE_SERVICE_ROLE_KEY (and
 * NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL), plus SMTP_HOST, SMTP_USER and
 * SMTP_PASSWORD to send. Credentials come from the environment on purpose —
 * never hardcode them into a committed file.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { SITE_URL } from '@/lib/config';
import { shapeTestSendInput } from '@/lib/email-flows/test-send';
import { renderTestEmails, sendTestEmails } from '@/lib/email-flows/test-runner';

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local — the environment has to carry everything.
}

const { values: args } = parseArgs({
  options: {
    to: { type: 'string' },
    emails: { type: 'string' },
    name: { type: 'string' },
    code: { type: 'string' },
    tz: { type: 'string' },
    cart: { type: 'string' },
    tag: { type: 'string' },
    out: { type: 'string' },
    site: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

async function main() {
  if (args.help) {
    console.log('See the comment at the top of scripts/email-flows-test-send.ts for usage.');
    return;
  }
  if (!args.to && !args.out) fail('Give --to with one or more addresses, or --out to write the emails to files.');

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail('Set SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL).');
  if (args.to && !process.env.SMTP_HOST) fail('Set SMTP_HOST, SMTP_USER and SMTP_PASSWORD to send.');
  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const cart = args.cart?.split(',').filter(Boolean).map((part) => {
    const [productId, packSize, quantity] = part.split(':');
    return { productId, packSize: Number(packSize || 1), quantity: Number(quantity || 1) };
  });
  const shaped = shapeTestSendInput({
    // Writing files only still needs an address to shape the request; nothing is sent to it.
    recipients: args.to ?? 'preview@example.com',
    emails: args.emails,
    firstName: args.name,
    code: args.code,
    timezone: args.tz,
    cart,
    subjectTag: args.tag,
  });
  if (!shaped.ok) fail(shaped.error);
  const input = shaped.value;
  const site = (args.site ?? SITE_URL).replace(/\/+$/, '');

  if (args.out) {
    const rendered = await renderTestEmails(db, input, site);
    if (!rendered.ok) fail(rendered.error);
    mkdirSync(args.out, { recursive: true });
    for (const r of rendered.renders) {
      if (!r.email) {
        console.log(`skip   ${r.name} — ${r.skipped}`);
        continue;
      }
      const file = join(args.out, `${r.flow}-${r.step}.html`);
      writeFileSync(file, r.email.html);
      console.log(`wrote  ${file}  ${r.email.subject}`);
    }
  }
  if (!args.to) return;

  const res = await sendTestEmails(db, input, site);
  if (!res.ok) fail(res.error);
  for (const r of res.summary.results) {
    console.log(`${r.status.padEnd(7)}${r.name} → ${r.to}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  const s = res.summary;
  console.log(`\n${s.sent} sent, ${s.skipped} skipped, ${s.failed} failed`);
  if (s.failed) process.exitCode = 1;
}

main().catch((err) => fail(err instanceof Error ? err.stack ?? err.message : String(err)));
