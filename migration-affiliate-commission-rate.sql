-- Migration: Add per-affiliate commission rate
-- Run this in the Supabase SQL editor
-- Date: 2026-04-28

-- 1. Add commission_rate column to affiliates table
--    Stored as a decimal fraction (e.g. 0.10 = 10%, 0.15 = 15%)
--    Default is 10% to match the existing hardcoded behaviour
ALTER TABLE public.affiliates
  ADD COLUMN IF NOT EXISTS commission_rate numeric(5, 4) NOT NULL DEFAULT 0.10;

-- 2. Backfill all existing affiliates to 10% (they were already using 10% implicitly)
UPDATE public.affiliates
  SET commission_rate = 0.10
  WHERE commission_rate IS NULL;

-- 3. Add a check constraint so the rate stays in a sensible range (0% – 100%)
ALTER TABLE public.affiliates
  ADD CONSTRAINT affiliates_commission_rate_check
    CHECK (commission_rate >= 0 AND commission_rate <= 1);

-- Verify
SELECT id, email, commission_rate FROM public.affiliates ORDER BY created_at DESC LIMIT 10;
