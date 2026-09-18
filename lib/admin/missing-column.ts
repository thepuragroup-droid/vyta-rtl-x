/**
 * Turn "a column this build writes is not in the database yet" into a message
 * that says what to do about it.
 *
 * Every feature that adds a column ships with a migration file, and until that
 * file is run the write fails. Supabase/PostgREST reports it as
 *
 *   Could not find the 'pack_options' column of 'products' in the schema cache
 *
 * which reads like a bug in the app rather than a step nobody has run yet, and
 * names no remedy. It also has a second, sneakier cause: the column IS there,
 * but PostgREST is still serving a cached copy of the schema from before it
 * was added — so the fix is a cache reload, not another migration.
 *
 * Both possibilities go in the message, because from the server's side they
 * are indistinguishable.
 */

/** Columns this build may write that arrived with a migration, and its file. */
const COLUMN_MIGRATIONS: Record<string, string> = {
  pack_options: 'pack-option-pricing-migration.sql',
  pack_sizes: 'pack-options-content-migration.sql',
  hero_video_url: 'hero-media-migration.sql',
  hero_image_url: 'hero-media-migration.sql',
};

/**
 * A friendlier message for a missing-column error, or null when the error is
 * something else entirely (in which case the caller keeps its own message —
 * this must never swallow a real failure behind "run a migration").
 */
export function missingColumnMessage(raw: string | null | undefined): string | null {
  const message = raw ?? '';
  // PostgREST's schema-cache wording, and Postgres's own, both appear
  // depending on whether the write goes through the API or a direct query.
  const match =
    /Could not find the '([a-z_]+)' column/i.exec(message) ??
    /column "?([a-z_]+)"? of relation .* does not exist/i.exec(message) ??
    /column "?products\.([a-z_]+)"? does not exist/i.exec(message);
  if (!match) return null;

  const column = match[1];
  const file = COLUMN_MIGRATIONS[column];
  if (!file) return null;

  return (
    `The database is missing the "${column}" column, so this could not be saved. ` +
    `Run ${file} against the database. ` +
    `If you have already run it, the API is still serving a cached copy of the old schema — ` +
    `run NOTIFY pgrst, 'reload schema'; or restart the API from the Supabase dashboard, then try again.`
  );
}
