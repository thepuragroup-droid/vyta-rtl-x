-- ============================================================================
-- lab_results.compound — remove dashes from the compound names
-- ============================================================================
--
-- The certificate FILENAMES are already dashless; what still carries dashes in
-- this table is the `compound` column, which is rendered on the public Lab
-- Results page:
--
--   BPC-157                    -> BPC157
--   TB-500                     -> TB500
--   GHK-Cu                     -> GHKCu
--   MOTS-C                     -> MOTSC
--   PT-141                     -> PT141
--   IGF-1LR3                   -> IGF1LR3
--   BPC-157; TB-500; GHK-Cu    -> BPC157; TB500; GHKCu     (blends, "; " list)
--
-- ---------------------------------------------------------------------------
-- DELIBERATELY NOT TOUCHED
-- ---------------------------------------------------------------------------
-- cas_number   e.g. 137525-51-0
--     A CAS Registry Number. The format is XXXXXXX-YY-Z and the final digit is
--     a checksum over the digits either side of the dashes. Stripping them does
--     not "clean up" the value, it destroys a verifiable chemical identifier —
--     anyone checking the COA against a registry would find nothing.
--
-- sample_id    e.g. V260323-16 004
--     The testing lab's own reference, printed on the certificate PDF. Editing
--     it would make this table disagree with the document it describes.
--
-- report_url   the folder segments (pura-2026-06/, vanguard-2026-04/) also
--     contain dashes. Renaming those means MOVING files between folders in
--     storage, not just rewriting text, so it is left out of this migration.
--     The folders encode lab and date, which is real metadata.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

-- Compound lists are "; " separated for blends, so a plain dash strip over the
-- whole value is correct here — there is no prose to damage, unlike the product
-- descriptions.
update lab_results
   set compound = replace(compound, '-', '')
 where compound is not null
   and compound like '%-%';

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Should return no rows:
-- select id, product_name, compound from lab_results where compound like '%-%';
--
-- Should return EVERY row unchanged — confirms the identifiers were preserved:
-- select id, sample_id, cas_number from lab_results
--  where cas_number like '%-%' order by id;
