-- ============================================================
-- Stealth Health SKUs (vyta- namespace)
-- ============================================================
--
-- Points products.puramass_sku (case) and products.puramass_sku_vial (single
-- vial) at the new Stealth Health `vyta-…-case` / `vyta-…-vial` ids, from the
-- 250-row vyta-store-products export (125 products x case + vial).
--
-- Products are matched by NAME, since the new ids do not reuse the old
-- `aminocan-` stems. Each Stealth Health row carries a few match keys: its own
-- name, its id stem, and the name with abbreviations spelled out ("Tirz" ->
-- Tirzepatide, "GLP-3" -> Retatrutide, "Selnk" -> Selank, ...). Keys and product
-- names are compared lower-cased with everything but letters and digits
-- removed, so "BPC-157 10mg", "BPC157 10mg" and slug "bpc-157-10mg" all agree.
--
-- A product's name, name + strength, and slug are all tried. ONLY 1:1 matches
-- are written: a product matching two rows, or a row matching two products, is
-- left alone and shows up in the review query at the bottom.
--
-- Run in the Supabase SQL editor, one step at a time: step 1 and the PREVIEW
-- first. If the preview looks right, run step 2, then the review queries in
-- step 3. Step 4 drops the two working tables. Safe to re-run.

-- 1. The Stealth Health id list ------------------------------------------
DROP TABLE IF EXISTS _sh_sku_map;
CREATE TABLE _sh_sku_map (sh_name text, case_sku text, vial_sku text, match_keys text[]);
INSERT INTO _sh_sku_map (sh_name, case_sku, vial_sku, match_keys) VALUES
  ('GHK(CU) 100mg', 'vyta-ghk-cu-100mg-case', 'vyta-ghk-cu-100mg-vial', ARRAY['ghkcu100mg']),
  ('Pinaleon 20mg', 'vyta-pinaleon-20mg-case', 'vyta-pinaleon-20mg-vial', ARRAY['pinaleon20mg', 'pinealon20mg']),
  ('E Spray', 'vyta-e-spray-case', 'vyta-e-spray-vial', ARRAY['espray']),
  ('PT141 10mg', 'vyta-pt141-10mg-case', 'vyta-pt141-10mg-vial', ARRAY['pt14110mg']),
  ('Vilon 20mg', 'vyta-vilon-20mg-case', 'vyta-vilon-20mg-vial', ARRAY['vilon20mg']),
  ('DSIP 5mg', 'vyta-dsip-5mg-case', 'vyta-dsip-5mg-vial', ARRAY['dsip5mg']),
  ('KLOW 80mg', 'vyta-klow-80mg-case', 'vyta-klow-80mg-vial', ARRAY['klow80mg']),
  ('Tesa 10mg', 'vyta-tesa-10mg-case', 'vyta-tesa-10mg-vial', ARRAY['tesa10mg', 'tesamorelin10mg']),
  ('Tirz 20mg', 'vyta-tirz-20mg-case', 'vyta-tirz-20mg-vial', ARRAY['tirz20mg', 'tirzepatide20mg']),
  ('KPV 5mg', 'vyta-kpv-5mg-case', 'vyta-kpv-5mg-vial', ARRAY['kpv5mg']),
  ('HGH 191AA 10 IU', 'vyta-hgh-191aa-10-iu-case', 'vyta-hgh-191aa-10-iu-vial', ARRAY['hgh191aa10iu', 'hgh191aasomatropin10iu']),
  ('Alprostadil 20mcg', 'vyta-alprostadil-20mcg-case', 'vyta-alprostadil-20mcg-vial', ARRAY['alprostadil20mcg']),
  ('FOX04 10mg', 'vyta-fox04-10mg-case', 'vyta-fox04-10mg-vial', ARRAY['fox0410mg', 'foxo410mg']),
  ('KPV 10mg', 'vyta-kpv-10mg-case', 'vyta-kpv-10mg-vial', ARRAY['kpv10mg']),
  ('Tirz 10mg', 'vyta-tirz-10mg-case', 'vyta-tirz-10mg-vial', ARRAY['tirz10mg', 'tirzepatide10mg']),
  ('Cagri 10mg', 'vyta-cagri-10mg-case', 'vyta-cagri-10mg-vial', ARRAY['cagri10mg', 'cagrilintide10mg']),
  ('BPC+ TB500 20mg', 'vyta-bpc-tb500-20mg-case', 'vyta-bpc-tb500-20mg-vial', ARRAY['bpctb50020mg']),
  ('MOTS C 40mg', 'vyta-mots-c-40mg-case', 'vyta-mots-c-40mg-vial', ARRAY['motsc40mg']),
  ('BPC157 10mg', 'vyta-bpc157-10mg-case', 'vyta-bpc157-10mg-vial', ARRAY['bpc15710mg']),
  ('BPC157 20mg', 'vyta-bpc157-20mg-case', 'vyta-bpc157-20mg-vial', ARRAY['bpc15720mg']),
  ('Tesa 5mg', 'vyta-tesa-5mg-case', 'vyta-tesa-5mg-vial', ARRAY['tesa5mg', 'tesamorelin5mg']),
  ('Tirz 40mg', 'vyta-tirz-40mg-case', 'vyta-tirz-40mg-vial', ARRAY['tirz40mg', 'tirzepatide40mg']),
  ('Epit 10mg', 'vyta-epit-10mg-case', 'vyta-epit-10mg-vial', ARRAY['epit10mg', 'epithalon10mg']),
  ('Tirz 30mg', 'vyta-tirz-30mg-case', 'vyta-tirz-30mg-vial', ARRAY['tirz30mg', 'tirzepatide30mg']),
  ('BPC157 5mg', 'vyta-bpc157-5mg-case', 'vyta-bpc157-5mg-vial', ARRAY['bpc1575mg']),
  ('TB500 10mg', 'vyta-tb500-10mg-case', 'vyta-tb500-10mg-vial', ARRAY['tb50010mg']),
  ('Bacteriostatic Water Pfizer 30mL', 'vyta-bacteriostatic-water-pfizer-30ml-case', 'vyta-bacteriostatic-water-pfizer-30ml-vial', ARRAY['bacteriostaticwaterpfizer30ml']),
  ('GHK(Cu) 50mg', 'vyta-ghk-cu-50mg-case', 'vyta-ghk-cu-50mg-vial', ARRAY['ghkcu50mg']),
  ('Snap8 10mg', 'vyta-snap8-10mg-case', 'vyta-snap8-10mg-vial', ARRAY['snap810mg']),
  ('GLP-3 10mg', 'vyta-glp-3-10mg-case', 'vyta-glp-3-10mg-vial', ARRAY['glp310mg', 'retatrutide10mg']),
  ('GLOW 70mg', 'vyta-glow-70mg-case', 'vyta-glow-70mg-vial', ARRAY['glow70mg']),
  ('GLP-3 20mg', 'vyta-glp-3-20mg-case', 'vyta-glp-3-20mg-vial', ARRAY['glp320mg', 'retatrutide20mg']),
  ('GLP-3 30mg', 'vyta-glp-3-30mg-case', 'vyta-glp-3-30mg-vial', ARRAY['glp330mg', 'retatrutide30mg']),
  ('Vitamin E', 'vyta-vitamin-e-case', 'vyta-vitamin-e-vial', ARRAY['vitamine']),
  ('Tirz 50mg', 'vyta-tirz-50mg-case', 'vyta-tirz-50mg-vial', ARRAY['tirz50mg', 'tirzepatide50mg']),
  ('GLP-3 40mg Pen', 'vyta-glp-3-40mg-pen-case', 'vyta-glp-3-40mg-pen-vial', ARRAY['glp340mgpen', 'retatrutide40mgpen']),
  ('5Amino(1MQ) 50mg', 'vyta-5amino-1mq-50mg-case', 'vyta-5amino-1mq-50mg-vial', ARRAY['5amino1mq50mg']),
  ('DSIP 15mg', 'vyta-dsip-15mg-case', 'vyta-dsip-15mg-vial', ARRAY['dsip15mg']),
  ('Semx 10mg + Selnk 10mg', 'vyta-semx-10mg-selnk-10mg-case', 'vyta-semx-10mg-selnk-10mg-vial', ARRAY['semax10mgselank10mg', 'semx10mgselnk10mg']),
  ('AOD9604 10mg', 'vyta-aod9604-10mg-case', 'vyta-aod9604-10mg-vial', ARRAY['aod960410mg']),
  ('5Amino(1MQ) 10mg', 'vyta-5amino-1mq-10mg-case', 'vyta-5amino-1mq-10mg-vial', ARRAY['5amino1mq10mg']),
  ('Sema 10mg', 'vyta-sema-10mg-case', 'vyta-sema-10mg-vial', ARRAY['sema10mg', 'semaglutide10mg']),
  ('GLP-3 40mg', 'vyta-glp-3-40mg-case', 'vyta-glp-3-40mg-vial', ARRAY['glp340mg', 'retatrutide40mg']),
  ('GLP-3 50mg', 'vyta-glp-3-50mg-case', 'vyta-glp-3-50mg-vial', ARRAY['glp350mg', 'retatrutide50mg']),
  ('Gonadorelin Acetate 2mg', 'vyta-gonadorelin-acetate-2mg-case', 'vyta-gonadorelin-acetate-2mg-vial', ARRAY['gonadorelin2mg', 'gonadorelinacetate2mg']),
  ('PE 2228 10mg', 'vyta-pe-2228-10mg-case', 'vyta-pe-2228-10mg-vial', ARRAY['pe222810mg']),
  ('AOD9604 5mg', 'vyta-aod9604-5mg-case', 'vyta-aod9604-5mg-vial', ARRAY['aod96045mg']),
  ('IGF 1LR3 1mg', 'vyta-igf-1lr3-1mg-case', 'vyta-igf-1lr3-1mg-vial', ARRAY['igf1lr31mg']),
  ('MK(677) 5mg', 'vyta-mk-677-5mg-case', 'vyta-mk-677-5mg-vial', ARRAY['mk6775mg']),
  ('Dihxa 10mg', 'vyta-dihxa-10mg-case', 'vyta-dihxa-10mg-vial', ARRAY['dihxa10mg']),
  ('GLP-3 10mg Pen', 'vyta-glp-3-10mg-pen-case', 'vyta-glp-3-10mg-pen-vial', ARRAY['glp310mgpen', 'retatrutide10mgpen']),
  ('Testagen 20mg', 'vyta-testagen-20mg-case', 'vyta-testagen-20mg-vial', ARRAY['testagen20mg']),
  ('Hexarlin Acetate 5mg', 'vyta-hexarlin-acetate-5mg-case', 'vyta-hexarlin-acetate-5mg-vial', ARRAY['hexarelin5mg', 'hexarelinacetate5mg', 'hexarlinacetate5mg']),
  ('Sema 20mg', 'vyta-sema-20mg-case', 'vyta-sema-20mg-vial', ARRAY['sema20mg', 'semaglutide20mg']),
  ('NAD 100mg', 'vyta-nad-100mg-case', 'vyta-nad-100mg-vial', ARRAY['nad100mg']),
  ('LL37 5mg', 'vyta-ll37-5mg-case', 'vyta-ll37-5mg-vial', ARRAY['ll375mg']),
  ('IPAM 10mg', 'vyta-ipam-10mg-case', 'vyta-ipam-10mg-vial', ARRAY['ipam10mg', 'ipamorelin10mg']),
  ('Sema 5mg', 'vyta-sema-5mg-case', 'vyta-sema-5mg-vial', ARRAY['sema5mg', 'semaglutide5mg']),
  ('MOTS C 20mg', 'vyta-mots-c-20mg-case', 'vyta-mots-c-20mg-vial', ARRAY['motsc20mg']),
  ('Tesa 12mg + IPAM 6mg', 'vyta-tesa-12mg-ipam-6mg-case', 'vyta-tesa-12mg-ipam-6mg-vial', ARRAY['tesa12mgipam6mg', 'tesamorelin12mgipamorelin6mg']),
  ('Selnk 10mg', 'vyta-selnk-10mg-case', 'vyta-selnk-10mg-vial', ARRAY['selank10mg', 'selnk10mg']),
  ('CJC 1295 without DAC + IPAM 10mg', 'vyta-cjc-1295-without-dac-ipam-10mg-case', 'vyta-cjc-1295-without-dac-ipam-10mg-vial', ARRAY['cjc1295withoutdacipam10mg', 'cjc1295withoutdacipamorelin10mg']),
  ('Thymosin (Alpha1) 10mg', 'vyta-thymosin-alpha1-10mg-case', 'vyta-thymosin-alpha1-10mg-vial', ARRAY['thymosinalpha110mg']),
  ('L Carnitine 1200mg', 'vyta-l-carnitine-1200mg-case', 'vyta-l-carnitine-1200mg-vial', ARRAY['lcarnitine1200mg']),
  ('GLP-3 30mg Pens', 'vyta-glp-3-30mg-pens-case', 'vyta-glp-3-30mg-pens-vial', ARRAY['glp330mgpens', 'retatrutide30mgpens']),
  ('Sermorlin Acetate 10mg', 'vyta-sermorlin-acetate-10mg-case', 'vyta-sermorlin-acetate-10mg-vial', ARRAY['sermorelin10mg', 'sermorelinacetate10mg', 'sermorlinacetate10mg']),
  ('PEG MGF 2mg', 'vyta-peg-mgf-2mg-case', 'vyta-peg-mgf-2mg-vial', ARRAY['pegmgf2mg']),
  ('CJC 1295 with DAC 5mg', 'vyta-cjc-1295-with-dac-5mg-case', 'vyta-cjc-1295-with-dac-5mg-vial', ARRAY['cjc1295withdac5mg']),
  ('Cagri 5mg', 'vyta-cagri-5mg-case', 'vyta-cagri-5mg-vial', ARRAY['cagri5mg', 'cagrilintide5mg']),
  ('Glutathione 1500mg', 'vyta-glutathione-1500mg-case', 'vyta-glutathione-1500mg-vial', ARRAY['glutathione1500mg']),
  ('KissPeptin10 5mg', 'vyta-kisspeptin10-5mg-case', 'vyta-kisspeptin10-5mg-vial', ARRAY['kisspeptin105mg']),
  ('Semx 10mg', 'vyta-semx-10mg-case', 'vyta-semx-10mg-vial', ARRAY['semax10mg', 'semx10mg']),
  ('AHK Cu 50mg', 'vyta-ahk-cu-50mg-case', 'vyta-ahk-cu-50mg-vial', ARRAY['ahkcu50mg']),
  ('MGF 2mg', 'vyta-mgf-2mg-case', 'vyta-mgf-2mg-vial', ARRAY['mgf2mg']),
  ('Sermorlin Acetate 5mg', 'vyta-sermorlin-acetate-5mg-case', 'vyta-sermorlin-acetate-5mg-vial', ARRAY['sermorelin5mg', 'sermorelinacetate5mg', 'sermorlinacetate5mg']),
  ('Bacteriostatic Water 30mL', 'vyta-bacteriostatic-water-30ml-case', 'vyta-bacteriostatic-water-30ml-vial', ARRAY['bacteriostaticwater30ml']),
  ('CJC 1295 without DAC 5mg', 'vyta-cjc-1295-without-dac-5mg-case', 'vyta-cjc-1295-without-dac-5mg-vial', ARRAY['cjc1295withoutdac5mg']),
  ('MT1 10mg', 'vyta-mt1-10mg-case', 'vyta-mt1-10mg-vial', ARRAY['melanotan110mg', 'mt110mg']),
  ('GHRP 2 Acetate 10mg', 'vyta-ghrp-2-acetate-10mg-case', 'vyta-ghrp-2-acetate-10mg-vial', ARRAY['ghrp210mg', 'ghrp2acetate10mg']),
  ('SLUPP332 5mg', 'vyta-slupp332-5mg-case', 'vyta-slupp332-5mg-vial', ARRAY['slupp3325mg']),
  ('HGH 191AA 36 IU', 'vyta-hgh-191aa-36-iu-case', 'vyta-hgh-191aa-36-iu-vial', ARRAY['hgh191aa36iu', 'hgh191aasomatropin36iu']),
  ('Thymalin 10mg', 'vyta-thymalin-10mg-case', 'vyta-thymalin-10mg-vial', ARRAY['thymalin10mg']),
  ('VIP 10mg', 'vyta-vip-10mg-case', 'vyta-vip-10mg-vial', ARRAY['vip10mg']),
  ('HGH 191AA 15 IU', 'vyta-hgh-191aa-15-iu-case', 'vyta-hgh-191aa-15-iu-vial', ARRAY['hgh191aa15iu', 'hgh191aasomatropin15iu']),
  ('Sema 30mg', 'vyta-sema-30mg-case', 'vyta-sema-30mg-vial', ARRAY['sema30mg', 'semaglutide30mg']),
  ('Tesa 20mg', 'vyta-tesa-20mg-case', 'vyta-tesa-20mg-vial', ARRAY['tesa20mg', 'tesamorelin20mg']),
  ('P21 10mg', 'vyta-p21-10mg-case', 'vyta-p21-10mg-vial', ARRAY['p2110mg']),
  ('HCG 10000 IU', 'vyta-hcg-10000-iu-case', 'vyta-hcg-10000-iu-vial', ARRAY['hcg10000iu']),
  ('KissPeptin10 10mg', 'vyta-kisspeptin10-10mg-case', 'vyta-kisspeptin10-10mg-vial', ARRAY['kisspeptin1010mg']),
  ('HGH 191AA 24 IU', 'vyta-hgh-191aa-24-iu-case', 'vyta-hgh-191aa-24-iu-vial', ARRAY['hgh191aa24iu', 'hgh191aasomatropin24iu']),
  ('Vitamin C', 'vyta-vitamin-c-case', 'vyta-vitamin-c-vial', ARRAY['vitaminc']),
  ('Thymosin (Alpha1) 5mg', 'vyta-thymosin-alpha1-5mg-case', 'vyta-thymosin-alpha1-5mg-vial', ARRAY['thymosinalpha15mg']),
  ('Epit 50mg', 'vyta-epit-50mg-case', 'vyta-epit-50mg-vial', ARRAY['epit50mg', 'epithalon50mg']),
  ('Pinelon 10mg', 'vyta-pinelon-10mg-case', 'vyta-pinelon-10mg-vial', ARRAY['pinealon10mg', 'pinelon10mg']),
  ('GLP-3 20mg Pen', 'vyta-glp-3-20mg-pen-case', 'vyta-glp-3-20mg-pen-vial', ARRAY['glp320mgpen', 'retatrutide20mgpen']),
  ('Acetic Acid Water', 'vyta-acetic-acid-water-case', 'vyta-acetic-acid-water-vial', ARRAY['aceticacidwater']),
  ('TB500 5mg', 'vyta-tb500-5mg-case', 'vyta-tb500-5mg-vial', ARRAY['tb5005mg']),
  ('HCG 5000 IU', 'vyta-hcg-5000-iu-case', 'vyta-hcg-5000-iu-vial', ARRAY['hcg5000iu']),
  ('MT2 10mg', 'vyta-mt2-10mg-case', 'vyta-mt2-10mg-vial', ARRAY['melanotan210mg', 'mt210mg']),
  ('5Amino(1MQ) 5mg', 'vyta-5amino-1mq-5mg-case', 'vyta-5amino-1mq-5mg-vial', ARRAY['5amino1mq5mg']),
  ('SS31 10mg', 'vyta-ss31-10mg-case', 'vyta-ss31-10mg-vial', ARRAY['ss3110mg']),
  ('AHK Cu 100mg', 'vyta-ahk-cu-100mg-case', 'vyta-ahk-cu-100mg-vial', ARRAY['ahkcu100mg']),
  ('HCG 2000 IU', 'vyta-hcg-2000-iu-case', 'vyta-hcg-2000-iu-vial', ARRAY['hcg2000iu']),
  ('CJC 1295 without DAC 10mg', 'vyta-cjc-1295-without-dac-10mg-case', 'vyta-cjc-1295-without-dac-10mg-vial', ARRAY['cjc1295withoutdac10mg']),
  ('Tirz 60mg', 'vyta-tirz-60mg-case', 'vyta-tirz-60mg-vial', ARRAY['tirz60mg', 'tirzepatide60mg']),
  ('Oxytocin Acetate 10mg', 'vyta-oxytocin-acetate-10mg-case', 'vyta-oxytocin-acetate-10mg-vial', ARRAY['oxytocin10mg', 'oxytocinacetate10mg']),
  ('IPAM 5mg', 'vyta-ipam-5mg-case', 'vyta-ipam-5mg-vial', ARRAY['ipam5mg', 'ipamorelin5mg']),
  ('Bacteriostatic Water 3mL', 'vyta-bacteriostatic-water-3ml-case', 'vyta-bacteriostatic-water-3ml-vial', ARRAY['bacteriostaticwater3ml']),
  ('Epit 40mg', 'vyta-epit-40mg-case', 'vyta-epit-40mg-vial', ARRAY['epit40mg', 'epithalon40mg']),
  ('Oxytocin Acetate 2mg', 'vyta-oxytocin-acetate-2mg-case', 'vyta-oxytocin-acetate-2mg-vial', ARRAY['oxytocin2mg', 'oxytocinacetate2mg']),
  ('Dermorphin 5mg', 'vyta-dermorphin-5mg-case', 'vyta-dermorphin-5mg-vial', ARRAY['dermorphin5mg']),
  ('Bacteriostatic Water 10mL', 'vyta-bacteriostatic-water-10ml-case', 'vyta-bacteriostatic-water-10ml-vial', ARRAY['bacteriostaticwater10ml']),
  ('Oxytocin Acetate 5mg', 'vyta-oxytocin-acetate-5mg-case', 'vyta-oxytocin-acetate-5mg-vial', ARRAY['oxytocin5mg', 'oxytocinacetate5mg']),
  ('Adamax 5mg', 'vyta-adamax-5mg-case', 'vyta-adamax-5mg-vial', ARRAY['adamax5mg']),
  ('Aicar 50mg', 'vyta-aicar-50mg-case', 'vyta-aicar-50mg-vial', ARRAY['aicar50mg']),
  ('Cerebrolysin 60mg', 'vyta-cerebrolysin-60mg-case', 'vyta-cerebrolysin-60mg-vial', ARRAY['cerebrolysin60mg']),
  ('PNC 10mg', 'vyta-pnc-10mg-case', 'vyta-pnc-10mg-vial', ARRAY['pnc10mg', 'pnc2710mg']),
  ('DSIP 10mg', 'vyta-dsip-10mg-case', 'vyta-dsip-10mg-vial', ARRAY['dsip10mg']),
  ('GHRP 6 Acetate 10mg', 'vyta-ghrp-6-acetate-10mg-case', 'vyta-ghrp-6-acetate-10mg-vial', ARRAY['ghrp610mg', 'ghrp6acetate10mg']),
  ('SS31 50mg', 'vyta-ss31-50mg-case', 'vyta-ss31-50mg-vial', ARRAY['ss3150mg']),
  ('ARA290 10mg', 'vyta-ara290-10mg-case', 'vyta-ara290-10mg-vial', ARRAY['ara29010mg']),
  ('BPC+ TB500 10mg', 'vyta-bpc-tb500-10mg-case', 'vyta-bpc-tb500-10mg-vial', ARRAY['bpctb50010mg']),
  ('MOTS C 10mg', 'vyta-mots-c-10mg-case', 'vyta-mots-c-10mg-vial', ARRAY['motsc10mg']),
  ('NAD 1000mg', 'vyta-nad-1000mg-case', 'vyta-nad-1000mg-vial', ARRAY['nad1000mg']),
  ('NAD 500mg', 'vyta-nad-500mg-case', 'vyta-nad-500mg-vial', ARRAY['nad500mg']);

DROP TABLE IF EXISTS _sh_sku_match;
CREATE TABLE _sh_sku_match AS
WITH prod AS (
  SELECT id, name, strength, slug,
         ARRAY[
           lower(regexp_replace(coalesce(name, ''), '[^a-zA-Z0-9]', '', 'g')),
           lower(regexp_replace(coalesce(name, '') || coalesce(strength, ''), '[^a-zA-Z0-9]', '', 'g')),
           lower(regexp_replace(coalesce(slug, ''), '[^a-zA-Z0-9]', '', 'g'))
         ] AS keys
  FROM products
),
pairs AS (
  SELECT DISTINCT p.id AS product_id, p.name AS product_name, m.sh_name, m.case_sku, m.vial_sku
  FROM prod p
  JOIN _sh_sku_map m ON p.keys && m.match_keys
)
SELECT pairs.*
FROM pairs
WHERE (SELECT count(*) FROM pairs x WHERE x.product_id = pairs.product_id) = 1
  AND (SELECT count(*) FROM pairs x WHERE x.case_sku = pairs.case_sku) = 1;

-- PREVIEW: what step 2 will write.
SELECT m.product_name, m.sh_name, p.puramass_sku AS old_case, m.case_sku AS new_case,
       p.puramass_sku_vial AS old_vial, m.vial_sku AS new_vial
FROM _sh_sku_match m JOIN products p ON p.id = m.product_id
ORDER BY m.product_name;

-- 2. Apply ---------------------------------------------------------------
UPDATE products p
SET puramass_sku = m.case_sku,
    puramass_sku_vial = m.vial_sku
FROM _sh_sku_match m
WHERE p.id = m.product_id;

-- 3. Review: what still needs a hand ------------------------------------
-- Active products with no vyta- mapping (unmatched or ambiguous):
SELECT id, name, strength, slug, puramass_sku, puramass_sku_vial
FROM products
WHERE active = true
  AND (coalesce(puramass_sku, '') NOT LIKE 'vyta-%' OR coalesce(puramass_sku_vial, '') NOT LIKE 'vyta-%')
ORDER BY name;

-- Stealth Health ids no product was matched to:
SELECT sh_name, case_sku, vial_sku
FROM _sh_sku_map m
WHERE NOT EXISTS (SELECT 1 FROM _sh_sku_match x WHERE x.case_sku = m.case_sku)
ORDER BY sh_name;

-- 4. Clean up the working tables ------------------------------------------
DROP TABLE IF EXISTS _sh_sku_match;
DROP TABLE IF EXISTS _sh_sku_map;
