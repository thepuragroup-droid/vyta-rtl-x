-- ============================================================================
-- Remove dashes from compound names — BPC-157, CJC-1295, AHK-Cu, Ipamorelin
-- ============================================================================
--
-- Scope (deliberately narrow — only the families named in the request):
--   BPC-157      -> BPC157
--   CJC-1295     -> CJC1295
--   AHK-Cu       -> AHKCu       (see note on GHK below)
--   Ipamorelin   -> IPAM        (shortened, not just de-dashed)
--   IPA          -> IPAM        (blend shorthand; only in DAC blend names)
--
-- In COA FILENAMES every dash is removed, word separators included, per the
-- agency's rule: bpc-157-10mg.pdf -> bpc15710mg.pdf. Product names use spaces
-- rather than dashes as separators, so they are unaffected by that and only
-- lose the dash inside the compound.
--
-- Applied to `products.name`, `products.description`, `products.coa_url`, and
-- — in lockstep — to `lab_results.report_url` / `lab_results.product_name`.
--
-- `products.slug` is deliberately NOT touched: the live product URLs are
-- staying as they are, so there is nothing to redirect.
--
-- WHY lab_results moves too: there is no product_id foreign key between the
-- two tables. `lab_results.report_url` is matched against the `products.coa_url`
-- array at query time (see lab-results-migration.sql), so renaming a COA on one
-- side only would silently detach every report from its products and empty the
-- public Lab Results page.
--
-- NOTE ON GHK vs AHK: the request named GHK-CU, but the live catalog has no
-- GHK product — it has "AHK Cu 50mg" and "AHK Cu 100mg" (AHK-Cu and GHK-Cu are
-- different copper peptides). Per confirmation, AHK is correct, so the AHK rows
-- are the ones normalised here. The ghk- patterns are still handled so that any
-- historical row or COA file left over from the old naming is caught too.
--
-- IMPORTANT: this migration renames the *references* to the COA PDFs. The PDF
-- objects themselves live in the `certificates` Supabase Storage bucket and
-- must be renamed to match — run scripts/rename-coa-files.ts BEFORE this, or
-- the links will 404 in the window between the two.
--
-- Idempotent: every replacement is a no-op once applied, so re-running is safe.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper: apply the compound-name replacements to any text value.
-- Case-insensitive so it catches "BPC-157", "bpc-157" and "Bpc-157" alike.
-- Deliberately targeted rather than a blanket dash strip — a blanket strip
-- would also mangle unrelated hyphenation such as "third-party" or "non-
-- pyrogenic" in description copy.
-- ---------------------------------------------------------------------------
create or replace function public.undash_compound_names(value text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(value, 'ipamorelin', 'IPAM',   'gi'),
                                       'bpc-157',    'BPC157', 'gi'),
                                       'cjc-1295',   'CJC1295','gi'),
                                       'ahk-cu',     'AHKCu',  'gi'),
                                       'ghk-cu',     'GHKCu',  'gi')
$$;

comment on function public.undash_compound_names(text) is
  'Normalises BPC-157/CJC-1295/AHK-Cu/GHK-Cu/Ipamorelin tokens to their dashless forms. Case-insensitive; returns the canonical casing.';

-- URLs and filenames are lowercase by convention, so they get the same
-- replacements folded back down to lowercase.
create or replace function public.undash_compound_url(value text)
returns text
language sql
immutable
as $$
  select case
    when value is null then null
    -- Scoped to the named families; any other COA link is returned untouched.
    when lower(value) !~ '(bpc-157|cjc-1295|ghk-cu|ahk-cu|ipamorelin)' then value
    else
      -- Only the FILENAME is rewritten. coa_url holds absolute links, and a
      -- blanket dash strip would also flatten the hostname — a Supabase project
      -- ref such as my-project.supabase.co would become myprojectsupabase.co
      -- and every certificate would 404.
      coalesce(substring(value from '^(.*/)'), '') ||
      replace(
        regexp_replace(
          regexp_replace(lower(regexp_replace(value, '^.*/', '')), 'ipamorelin', 'ipam', 'g'),
          -- "-ipa-" blend shorthand, expanded while the delimiting dashes still
          -- exist. Whole segment only, so it cannot clip a longer word.
          '(?<=-)ipa(?=-|\.|$)', 'ipam', 'g'),
        '-', '')
  end
$$;

comment on function public.undash_compound_url(text) is
  'Filename variant of undash_compound_names. Removes EVERY dash from the filename for the named families (bpc-157-10mg.pdf -> bpc15710mg.pdf); leaves the directory/host portion and all other links untouched.';

-- ---------------------------------------------------------------------------
-- DRY RUN — uncomment to preview every row this migration would change
-- before committing to it.
-- ---------------------------------------------------------------------------
-- select id, name    as name_before,    public.undash_compound_names(name)    as name_after,
--            coa_url as coa_before,
--            (select array_agg(public.undash_compound_url(u)) from unnest(coa_url) u) as coa_after
--   from products
--  where name        ~* '(bpc-157|cjc-1295|ahk-cu|ghk-cu|ipamorelin|ipam)'
--     or description ~* '(bpc-157|cjc-1295|ahk-cu|ghk-cu|ipamorelin)'
--     or array_to_string(coa_url, ',') ~* '(bpc-157|cjc-1295|ahk-cu|ghk-cu|ipamorelin)';

-- ---------------------------------------------------------------------------
-- 1. products.name  — includes the Ipamorelin -> IPAM shortening, and catches
--    blend names such as "Tesa 12mg + Ipam 6mg" so IPAM is cased consistently.
-- ---------------------------------------------------------------------------
update products
   set name = public.undash_compound_names(name)
 where name ~* '(bpc-157|cjc-1295|ahk-cu|ghk-cu|ipamorelin)'
   and name is distinct from public.undash_compound_names(name);

-- Standalone "Ipam" rows: the token is already dashless but the request asked
-- for IPAM specifically, so normalise the casing wherever it appears as a
-- whole word. Whole-word anchored so it cannot corrupt a longer word that
-- merely starts with those letters.
update products
   set name = regexp_replace(name, '\mipam\M', 'IPAM', 'gi')
 where name ~* '\mipam\M'
   and name is distinct from regexp_replace(name, '\mipam\M', 'IPAM', 'gi');

-- "IPA" is the blend shorthand for Ipamorelin, confirmed for the one product
-- that uses it ("CJC 1295 without DAC + IPA 10mg"). Deliberately scoped to
-- names that also mention DAC rather than applied to every bare "IPA": the
-- letters are also the common abbreviation for isopropyl alcohol, so an
-- unscoped rule would silently rename any future solvent product.
update products
   set name = regexp_replace(name, '\mipa\M', 'IPAM', 'gi')
 where name ~* '\mipa\M'
   and name ~* '\mdac\M'
   and name is distinct from regexp_replace(name, '\mipa\M', 'IPAM', 'gi');

-- ---------------------------------------------------------------------------
-- 2. products.description
-- ---------------------------------------------------------------------------
update products
   set description = public.undash_compound_names(description)
 where description ~* '(bpc-157|cjc-1295|ahk-cu|ghk-cu|ipamorelin)'
   and description is distinct from public.undash_compound_names(description);

-- ---------------------------------------------------------------------------
-- 3. products.coa_url — a text[]; each element is rewritten individually.
-- ---------------------------------------------------------------------------
update products p
   set coa_url = sub.rewritten
  from (
    select p2.id,
           (select array_agg(public.undash_compound_url(u) order by ord)
              from unnest(p2.coa_url) with ordinality as t(u, ord)) as rewritten
      from products p2
     where p2.coa_url is not null
       and array_length(p2.coa_url, 1) > 0
       and array_to_string(p2.coa_url, ',') ~* '(bpc-157|cjc-1295|ahk-cu|ghk-cu|ipamorelin)'
  ) as sub
 where p.id = sub.id
   and p.coa_url is distinct from sub.rewritten;

-- ---------------------------------------------------------------------------
-- 4. lab_results — must move in lockstep with coa_url (see header note).
--    report_url is UNIQUE, so guard against a rewrite colliding with a row
--    that already holds the target URL; drop the now-redundant dashed row in
--    that case rather than failing the migration.
-- ---------------------------------------------------------------------------
delete from lab_results old
 where old.report_url ~* '(bpc-157|cjc-1295|ahk-cu|ghk-cu|ipamorelin)'
   and exists (
     select 1 from lab_results keep
      where keep.report_url = public.undash_compound_url(old.report_url)
        and keep.id <> old.id
   );

update lab_results
   set report_url   = public.undash_compound_url(report_url),
       product_name = public.undash_compound_names(product_name)
 where report_url   ~* '(bpc-157|cjc-1295|ahk-cu|ghk-cu|ipamorelin)'
    or product_name ~* '(bpc-157|cjc-1295|ahk-cu|ghk-cu|ipamorelin)';

-- ---------------------------------------------------------------------------
-- 5. Verification — every COA reference should now resolve to a lab_results
--    row. Any output here means a report came adrift and needs a look.
-- ---------------------------------------------------------------------------
-- select p.name, u as orphaned_coa_url
--   from products p
--   cross join lateral unnest(p.coa_url) as u
--   where p.coa_url is not null
--     and not exists (select 1 from lab_results lr where lr.report_url = u);
