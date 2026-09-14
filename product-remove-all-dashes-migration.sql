-- ============================================================================
-- Remove EVERY dash, across the WHOLE catalog
-- ============================================================================
--
-- Supersedes the family-scoped rule in product-dash-removal-migration.sql and
-- product-url-slug-migration.sql. Those only touched BPC157 / CJC1295 / AHKCu /
-- GHKCu / Ipamorelin, which left the rest of the catalog inconsistent:
-- 5-Amino-1MQ, SLU-PP-332, ARA-290, Thymosin Alpha-1, PE 22-28 and FOX-04 all
-- kept their dashes. The rule is no dashes anywhere, so this applies it to
-- every product.
--
-- Covers:
--   products.name        every dash removed
--   products.url_slug    every dash removed
--   products.coa_url     every dash removed FROM THE FILENAME ONLY
--   lab_results          report_url + product_name, in lockstep with coa_url
--
-- products.slug (the internal SKU) is NOT touched — unchanged from before.
--
-- Examples:
--   5-Amino-1MQ 50mg       -> 5Amino1MQ 50mg
--   SLU-PP-332 5mg         -> SLUPP332 5mg
--   Thymosin Alpha-1 10mg  -> Thymosin Alpha1 10mg
--   PE 22-28 10mg          -> PE 2228 10mg
--   ARA-290 10mg           -> ARA290 10mg
--   FOX-04 10mg            -> FOX04 10mg
--
-- Descriptions are deliberately left alone. The only dashes in description copy
-- are ordinary English hyphenation ("non-pyrogenic", "multi-dose", "third-
-- party"), and stripping those produces misspellings rather than compliance.
-- The product-name mentions inside descriptions were already handled by
-- product-dash-removal-migration.sql.
--
-- Old URLs keep working: the product route resolves url_slug first and falls
-- back to slug, then redirects to the canonical URL.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Derivations
-- ---------------------------------------------------------------------------

-- Ipamorelin is still shortened to IPAM, and the IPA blend shorthand expanded,
-- BEFORE the dashes go — both rules depend on the dashes that delimit them.
create or replace function public.product_url_slug(slug text)
returns text
language sql
immutable
as $$
  select replace(
           regexp_replace(
             regexp_replace(lower($1), 'ipamorelin', 'ipam', 'g'),
             '(?<=-)ipa(?=-|$)', 'ipam', 'g'),
           '-', '')
$$;

comment on function public.product_url_slug(text) is
  'Public URL slug from a SKU slug: every dash removed, Ipamorelin shortened to ipam. Mirrors toUrlSlug() in lib/products/url.ts.';

-- Filename-only variant. coa_url holds absolute links, and a blanket strip
-- across the whole value would flatten the hostname too — a project ref such as
-- my-project.supabase.co would become myprojectsupabase.co and every
-- certificate would 404.
create or replace function public.undash_compound_url(value text)
returns text
language sql
immutable
as $$
  select case
    when value is null then null
    else coalesce(substring(value from '^(.*/)'), '') ||
         replace(
           regexp_replace(
             regexp_replace(lower(regexp_replace(value, '^.*/', '')), 'ipamorelin', 'ipam', 'g'),
             '(?<=-)ipa(?=-|\.|$)', 'ipam', 'g'),
           '-', '')
  end
$$;

comment on function public.undash_compound_url(text) is
  'COA link rewriter: removes every dash from the FILENAME only, leaving host and path intact.';

-- Product names keep their spaces; only dashes go.
create or replace function public.undash_product_name(value text)
returns text
language sql
immutable
as $$
  select case
    when value is null then null
    else replace(
           regexp_replace(
             regexp_replace(value, 'ipamorelin', 'IPAM', 'gi'),
             -- Case-insensitive so "Ipam" is normalised to "IPAM" too.
             '\mipam\M', 'IPAM', 'gi'),
           '-', '')
  end
$$;

comment on function public.undash_product_name(text) is
  'Product name normaliser: removes every dash, shortens Ipamorelin to IPAM and normalises Ipam casing. Spaces are preserved. The bare IPA shorthand is handled separately, scoped to DAC blends.';

-- ---------------------------------------------------------------------------
-- DRY RUN — uncomment to preview every row this would change.
-- ---------------------------------------------------------------------------
-- select name as name_before, public.undash_product_name(name) as name_after,
--        url_slug as url_before, public.product_url_slug(slug) as url_after
--   from products
--  where name is distinct from public.undash_product_name(name)
--     or url_slug is distinct from public.product_url_slug(slug)
--  order by name;

-- ---------------------------------------------------------------------------
-- 2. Names
-- ---------------------------------------------------------------------------
update products
   set name = public.undash_product_name(name)
 where name is distinct from public.undash_product_name(name);

-- "IPA" is the blend shorthand for Ipamorelin. Scoped to names that also
-- mention DAC rather than applied to every bare IPA: the letters are equally
-- the abbreviation for isopropyl alcohol, so an unscoped rule would silently
-- rename a future solvent product.
update products
   set name = regexp_replace(name, '\mipa\M', 'IPAM', 'gi')
 where name ~* '\mipa\M'
   and name ~* '\mdac\M'
   and name is distinct from regexp_replace(name, '\mipa\M', 'IPAM', 'gi');

-- ---------------------------------------------------------------------------
-- 3. URLs
--
-- Two passes so a rewrite can never collide. Removing dashes could produce a
-- value another product already uses as its slug or url_slug, and the route
-- resolves both — an ambiguous URL would silently serve the wrong product.
-- Pass 1 takes the rewritten value only when it is free; pass 2 leaves the row
-- on whatever it already had. The verification query at the end lists those.
-- ---------------------------------------------------------------------------
update products p
   set url_slug = public.product_url_slug(p.slug)
 where p.url_slug is distinct from public.product_url_slug(p.slug)
   and not exists (
     select 1 from products q
      where q.id <> p.id and q.slug = public.product_url_slug(p.slug)
   )
   and not exists (
     select 1 from products q
      where q.id <> p.id and q.url_slug = public.product_url_slug(p.slug)
   );

update products
   set url_slug = slug
 where url_slug is null or btrim(url_slug) = '';

-- ---------------------------------------------------------------------------
-- 4. COA links + lab_results, in lockstep (see product-dash-removal-migration)
-- ---------------------------------------------------------------------------
update products p
   set coa_url = sub.rewritten
  from (
    select p2.id,
           (select array_agg(public.undash_compound_url(u) order by ord)
              from unnest(p2.coa_url) with ordinality as t(u, ord)) as rewritten
      from products p2
     where p2.coa_url is not null and array_length(p2.coa_url, 1) > 0
  ) as sub
 where p.id = sub.id
   and p.coa_url is distinct from sub.rewritten;

-- report_url is UNIQUE: drop a row that would collide with one already holding
-- the rewritten value, rather than failing the migration part-way.
delete from lab_results old
 where public.undash_compound_url(old.report_url) <> old.report_url
   and exists (
     select 1 from lab_results keep
      where keep.report_url = public.undash_compound_url(old.report_url)
        and keep.id <> old.id
   );

update lab_results
   set report_url   = public.undash_compound_url(report_url),
       product_name = public.undash_product_name(product_name)
 where report_url   is distinct from public.undash_compound_url(report_url)
    or product_name is distinct from public.undash_product_name(product_name);

-- ---------------------------------------------------------------------------
-- 5. Verification
-- ---------------------------------------------------------------------------
-- Anything still carrying a dash in its name or URL (a pass-2 collision):
-- select id, name, slug, url_slug from products
--  where name ~ '-' or url_slug ~ '-' order by name;
--
-- Any COA link that no longer resolves to a lab report:
-- select p.name, u from products p cross join lateral unnest(p.coa_url) u
--  where p.coa_url is not null
--    and not exists (select 1 from lab_results lr where lr.report_url = u);
