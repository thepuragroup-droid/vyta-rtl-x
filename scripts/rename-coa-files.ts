/**
 * Renames COA PDFs in the `certificates` Supabase Storage bucket so their
 * filenames match the de-dashed compound names:
 *
 *   bpc-157-10mg.pdf                    -> bpc15710mg.pdf
 *   cjc-1295-with-dac-5mg.pdf           -> cjc1295withdac5mg.pdf
 *   cjc-1295-ipamorelin-no-dac-10mg.pdf -> cjc1295ipamnodac10mg.pdf
 *   ahk-cu-50mg.pdf                     -> ahkcu50mg.pdf
 *   ipamorelin-10mg.pdf                 -> ipam10mg.pdf
 *   cjc-1295-without-dac-ipa-5mg.pdf    -> cjc1295withoutdacipam5mg.pdf
 *
 * Every dash goes, across every certificate — tb-500-10mg.pdf becomes
 * tb50010mg.pdf too.
 *
 * RUN THIS BEFORE product-dash-removal-migration.sql. The migration rewrites
 * the database's references to these files; renaming the objects first means
 * the links are only briefly stale, never broken in the other direction.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/rename-coa-files.ts --dry-run
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/rename-coa-files.ts
 *
 * Credentials come from the environment on purpose — never hardcode a
 * service_role key into a committed file.
 */
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'certificates';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    'Missing credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n' +
      'The service role key is required — renaming storage objects is not permitted with the anon key.',
  );
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

/**
 * Same replacements as public.undash_compound_url() in the SQL migration —
 * keep the two in step, or the storage objects and the database references
 * will drift apart.
 *
 * Operates on a bare filename (the bucket is flat), so unlike the SQL version
 * there is no directory portion to protect. Every dash goes for the named
 * families; any other file is returned untouched.
 */
function undash(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/ipamorelin/g, 'ipam')
    // "-ipa-" blend shorthand, expanded while the delimiting dashes still
    // exist. Whole segment only, so it cannot clip a longer word.
    .replace(/(?<=-)ipa(?=-|\.|$)/g, 'ipam')
    .replace(/-/g, '');
}

async function main() {
  // The bucket is flat, but page through anyway rather than assuming it fits
  // in one response.
  const files: string[] = [];
  const PAGE = 100;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list('', { limit: PAGE, offset });
    if (error) {
      console.error(`Failed to list bucket "${BUCKET}":`, error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    files.push(...data.map((f) => f.name));
    if (data.length < PAGE) break;
  }

  const renames = files
    .map((from) => ({ from, to: undash(from) }))
    .filter((r) => r.from !== r.to);

  if (renames.length === 0) {
    console.log(`Nothing to rename — all ${files.length} file(s) already use the dashless names.`);
    return;
  }

  console.log(`${renames.length} of ${files.length} file(s) to rename${dryRun ? ' (dry run)' : ''}:\n`);

  let renamed = 0;
  let skipped = 0;

  for (const { from, to } of renames) {
    // Never clobber an existing object — a collision means someone has already
    // uploaded the new name, and the old file needs a human decision.
    if (files.includes(to)) {
      console.log(`  SKIP  ${from} -> ${to} (target already exists)`);
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`  DRY   ${from} -> ${to}`);
      continue;
    }

    const { error } = await supabase.storage.from(BUCKET).move(from, to);
    if (error) {
      console.log(`  FAIL  ${from} -> ${to}: ${error.message}`);
      skipped++;
      continue;
    }
    console.log(`  OK    ${from} -> ${to}`);
    renamed++;
  }

  console.log(
    dryRun
      ? `\nDry run complete — nothing changed. Re-run without --dry-run to apply.`
      : `\nDone: ${renamed} renamed, ${skipped} skipped.`,
  );

  if (!dryRun && renamed > 0) {
    console.log('Next: run product-dash-removal-migration.sql to update the database references.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
