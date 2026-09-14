-- ============================================================================
-- Lab Results feature — schema + backfill
-- ============================================================================
-- Surfaces the third-party Certificates of Analysis (COAs) — HPLC-UV purity
-- tests performed by PPB Analytical Inc. — for the research compounds.
--
-- The link between a report and the products it covers is derived at query
-- time by matching `lab_results.report_url` against the `products.coa_url`
-- (text[]) array. There is deliberately NO product_id foreign key: multiple
-- product strengths share a single report PDF (e.g. DSIP 5/10/15mg all point
-- at the same file), so matching on report_url keeps one row per report while
-- still resolving the full set of covered products.
--
-- Idempotent: safe to run multiple times.
-- ============================================================================

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table if not exists public.lab_results (
  id                uuid not null default extensions.uuid_generate_v4(),
  report_url        text not null,                       -- canonical PDF link (natural key)
  product_name      text not null,                       -- label from the report, e.g. "KLOW 80MG"
  lab               text not null default 'PPB Analytical Inc.',
  sample_id         text null,                           -- lab's internal sample id, e.g. "5026_0266"
  compound          text null,                           -- "; " separated for blends
  cas_number        text null,                           -- aligned 1:1 with compound
  purity_pct        numeric null,                        -- overall HPLC-UV purity, e.g. 97.65
  method            text not null default 'HPLC-UV',
  matrix            text null default 'Other',
  receiving_date    date null,
  registration_date date null,
  report_date       date null,                           -- "Result Date" shown to customers
  active            boolean not null default true,       -- show/hide on the public site
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint lab_results_pkey primary key (id),
  constraint lab_results_report_url_key unique (report_url)
);

create index if not exists idx_lab_results_report_url on public.lab_results (report_url);
create index if not exists idx_lab_results_active     on public.lab_results (active);

-- ---------------------------------------------------------------------------
-- 2. updated_at touch trigger
-- ---------------------------------------------------------------------------
create or replace function public.lab_results_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_lab_results_updated_at on public.lab_results;
create trigger trg_lab_results_updated_at
  before update on public.lab_results
  for each row execute function public.lab_results_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Seed / backfill (data-driven)
-- ---------------------------------------------------------------------------
-- The real COA files live in the Supabase `certificates` storage bucket with
-- machine-generated filenames (e.g. `.../certificates/1776855744885-743ww9.pdf`),
-- so they can't be hard-coded reliably here. Instead we derive one lab_results
-- row per DISTINCT report URL already referenced by a product's `coa_url`,
-- taking the (alphabetically-first) covering product's name as the label.
--
-- This guarantees every seeded `report_url` resolves to at least one covered
-- product. `on conflict do nothing` makes re-runs non-destructive: rows an
-- admin has since enriched (compound / purity / dates) are left untouched.
insert into public.lab_results (report_url, product_name)
select url, name
from (
  select
    url,
    p.name,
    row_number() over (partition by url order by p.name asc) as rn
  from public.products p
  cross join lateral unnest(p.coa_url) as url
  where p.coa_url is not null
    and array_length(p.coa_url, 1) > 0
    and url is not null
    and btrim(url) <> ''
) ranked
where rn = 1
on conflict (report_url) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Enrichment (optional, manual)
-- ---------------------------------------------------------------------------
-- Report-level detail (compound, CAS number, headline purity, sample id, and
-- the receiving / registration / result dates) is NOT derivable from the
-- products table. Fill it in either from the Admin → Lab Results panel, or by
-- adapting the template below (match on report_url or product_name):
--
--   update public.lab_results
--     set compound   = 'BPC-157',
--         cas_number = '137525-51-0',
--         purity_pct = 100.00,
--         sample_id  = '5026_0266',
--         report_date = '2026-03-27'
--   where product_name ilike 'BPC-157%';
--
-- Blends carry "; "-separated, index-aligned compound / cas_number values, e.g.
--   compound   = 'BPC-157; TB-500; GHK-Cu'
--   cas_number = '137525-51-0; 885340-08-9; 89030-95-5'
--
-- Known gap: SS-31 50MG (SKU 2S50) — if its COA is not yet attached to the
-- product's coa_url it won't be backfilled above; add it from the admin panel
-- once the report is available.
-- ============================================================================
