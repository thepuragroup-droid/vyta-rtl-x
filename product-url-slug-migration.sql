-- ============================================================================
-- products.url_slug — a compliant public URL identifier, separate from the SKU
-- ============================================================================
--
-- `products.slug` is the internal SKU-style identifier. It is referenced by the
-- CSV import, admin uniqueness checks and historical data, so it stays exactly
-- as it is. This adds a SEPARATE column holding the public URL identifier, and
-- the storefront routes on that instead:
--
--   slug (SKU, unchanged)         url_slug (public URL)
--   ----------------------------  --------------------------
--   bpc-157-10mg                  bpc15710mg
--   cjc-1295-with-dac-5mg         cjc1295withdac5mg
--   cjc-1295-without-dac-ipa-5mg  cjc1295withoutdacipam5mg
--   ipamorelin-10mg               ipam10mg
--   ahk-cu-50mg                   ahkcu50mg
--
-- EVERY dash is removed for these families, word separators included. Products
-- outside them keep their URL exactly as it is: the instruction was scoped to
-- these names, and rewriting the whole catalog would move ~100 live URLs nobody
-- asked to change.
--
-- Old URLs keep working: the product route resolves url_slug first and falls
-- back to slug, then redirects to the canonical URL. So existing links, search
-- results and ad campaigns are not broken by this.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Column + unique index
-- ---------------------------------------------------------------------------
alter table products
  add column if not exists url_slug text;

comment on column products.url_slug is
  'Public URL identifier. Compliant naming (no dash inside a compound name). Separate from slug, which remains the internal SKU.';

-- ---------------------------------------------------------------------------
-- 2. Derivation — mirrors toUrlSlug() in lib/products/url.ts. Keep in step.
-- ---------------------------------------------------------------------------
create or replace function public.product_url_slug(slug text)
returns text
language sql
immutable
as $$
  select case
    -- Scoped to the named compound families; everything else is returned
    -- untouched so unrelated product URLs do not move.
    when lower($1) !~ '(bpc-157|cjc-1295|ghk-cu|ahk-cu|ipamorelin)' then lower($1)
    else replace(
           regexp_replace(
             regexp_replace(lower($1), 'ipamorelin', 'ipam', 'g'),
             -- "-ipa-" blend shorthand, expanded while the delimiting dashes
             -- still exist. Whole segment only, so it cannot clip a longer word.
             '(?<=-)ipa(?=-|$)', 'ipam', 'g'),
           '-', '')
  end
$$;

comment on function public.product_url_slug(text) is
  'Derives the compliant public URL slug from a SKU slug. Removes every dash for the BPC157/CJC1295/GHKCu/AHKCu/IPAM families; returns other slugs unchanged. Mirrors toUrlSlug() in lib/products/url.ts.';

-- ---------------------------------------------------------------------------
-- 3. Backfill
--
-- Two passes so a rewrite can never collide. Removing a dash could in principle
-- produce a value another product already uses as its slug or url_slug, and the
-- route resolves both — an ambiguous URL would silently serve the wrong
-- product. Pass 1 only takes the rewritten value when it is genuinely free;
-- pass 2 gives everything else its own slug, which is unique by definition.
-- Anything that lands in pass 2 with a dashed compound name is reported by the
-- verification query at the bottom.
-- ---------------------------------------------------------------------------
update products p
   set url_slug = public.product_url_slug(p.slug)
 where p.url_slug is null
   and not exists (
     select 1 from products q
      where q.id <> p.id
        and q.slug = public.product_url_slug(p.slug)
   )
   and not exists (
     select 1 from products q
      where q.id <> p.id
        and q.url_slug = public.product_url_slug(p.slug)
   );

update products
   set url_slug = slug
 where url_slug is null;

-- Unique once populated. Created after the backfill so a pre-existing clash
-- surfaces as a clear failure here rather than mid-update.
create unique index if not exists idx_products_url_slug
  on products (url_slug)
  where url_slug is not null;

-- Lookups go through this column on every product page load.
create index if not exists idx_products_url_slug_active
  on products (url_slug, active);

-- ---------------------------------------------------------------------------
-- 4. Keep new rows populated
--
-- The app sets url_slug explicitly, but a row inserted straight into the table
-- (SQL editor, CSV import, admin path that predates this) would otherwise have
-- none and drop out of the catalog entirely. This backstops that.
-- ---------------------------------------------------------------------------
create or replace function public.products_set_url_slug()
returns trigger as $$
begin
  if new.url_slug is null or btrim(new.url_slug) = '' then
    new.url_slug := public.product_url_slug(new.slug);
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_products_set_url_slug on products;
create trigger trg_products_set_url_slug
  before insert or update of slug, url_slug on products
  for each row execute function public.products_set_url_slug();

-- ---------------------------------------------------------------------------
-- 5. Verification — rows whose URL still carries a dashed compound name,
--    i.e. the ones pass 2 had to fall back on. Empty output means every
--    product got its compliant URL.
-- ---------------------------------------------------------------------------
-- select id, name, slug, url_slug
--   from products
--  where url_slug <> public.product_url_slug(slug)
--  order by name;
