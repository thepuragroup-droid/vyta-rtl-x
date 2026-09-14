import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { readSiteConfigRow } from '@/lib/site-config';

const db = getSupabase();

// GET /api/site-config — public branding + tracking config (no secrets).
// GA4 / Meta Pixel IDs are public client-side identifiers.
export async function GET() {
  const config = await readSiteConfigRow(db);
  return NextResponse.json({ config });
}
